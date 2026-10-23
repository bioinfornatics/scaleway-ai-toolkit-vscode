import { createHash, randomBytes } from 'node:crypto';
import { mkdir, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import * as vscode from 'vscode';
import {
  type AccessKeyInventory,
  type AccessKeyMetadata,
  createAccessAPIKey,
  IAMAccessError,
  inspectAccessAPIKey,
  listAccessAPIKeys,
  listAccessApplications,
} from './llmAccessIam';
import { chooseAccessPlan } from './llmAccessWizard';
import {
  type ListedModel,
  listServerlessAvailability,
  type Project,
  text,
  uuid,
} from './provider';

export interface LlmAccessScope {
  userId: string;
  project: Project;
  signal: AbortSignal;
  current(): boolean;
  controlCredential(): string;
  reuseCredential(): { accessKey: string; secretKey: string };
}
interface StoredAccess {
  version: 1 | 2;
  id: string;
  ownerId: string;
  projectId: string;
  organizationId: string;
  modelId?: string;
  accessKey: string;
  secretKey: string;
  metadata?: AccessKeyMetadata;
}
const opaque = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-f0-9]{32}$/.test(v);
const slot = (id: string) => `scalewayAI.llmAccess.secret.v1.${id}`;
const namespace = (s: LlmAccessScope) =>
  'scalewayAI.llmAccess.v1.' +
  createHash('sha256')
    .update(JSON.stringify([s.userId, s.project.organizationId, s.project.id]))
    .digest('hex');
function parse(
  raw: string | undefined,
  s: LlmAccessScope,
): StoredAccess | undefined {
  if (!raw || raw.length > 8192) return;
  try {
    const r = JSON.parse(raw) as StoredAccess;
    if (
      ![1, 2].includes(r.version) ||
      !opaque(r.id) ||
      r.ownerId !== s.userId ||
      r.projectId !== s.project.id ||
      r.organizationId !== s.project.organizationId ||
      (r.version === 1 && !text(r.modelId)) ||
      (r.version === 2 && r.modelId !== undefined) ||
      !/^SCW[A-Z0-9]{17}$/.test(r.accessKey) ||
      !uuid(r.secretKey)
    )
      return;
    return r;
  } catch {
    return;
  }
}
export interface ApiKeyResource {
  id: string;
  description: string;
  maskedAccessKey: string;
  bearerType: 'user' | 'application';
  expiresAt: number;
  createdAt?: string;
  secretAvailable: boolean;
}
const inventoryId = (organizationId: string, accessKey: string) =>
  createHash('sha256')
    .update(JSON.stringify([organizationId, accessKey]))
    .digest('hex')
    .slice(0, 32);
type VerifiedAccess = { record: StoredAccess; row: ListedModel };
type RefreshProof = {
  metadata: AccessKeyMetadata;
  models?: Promise<Awaited<ReturnType<typeof listServerlessAvailability>>>;
};
/** Key inventory is organization metadata, not a deployed resource or permission proof.
 * Only fresh IAM+model discovery reaches ephemeral model rows.
 * Secrets, access keys and bearer IDs never enter public model/browser metadata. */
export class LlmAccessRegistry {
  // Entry identity is the binding generation, not the most recent proof.
  private verified = new Map<string, VerifiedAccess>();
  private generation = 0;
  private proofEpoch = 0;
  private inventoryEpoch = 0;
  private localInventory = new Map<string, StoredAccess>();
  // Only active/in-flight slots are watched; refresh bounds these to 32 bindings.
  private secretVersions = new Map<string, object>();
  private watch(id: string): object {
    let version = this.secretVersions.get(id);
    if (!version) {
      version = {};
      this.secretVersions.set(id, version);
    }
    return version;
  }
  private disposed = false;
  private secretListener: vscode.Disposable;
  private scopeKey = '';
  private busy = false;
  constructor(private context: vscode.ExtensionContext) {
    this.secretListener = context.secrets.onDidChange(({ key }) => {
      if (/^scalewayAI\.llmAccess\.v1\.[a-f0-9]{64}\.revision$/.test(key)) {
        // SecretStorage is the cross-window invalidation bus. Memento snapshots
        // can lag; replacement must invalidate peer proofs before index writes.
        this.proofEpoch++;
        this.localInventory.clear();
        if (key === `${this.scopeKey}.revision`) {
          this.verified.clear();
          this.secretVersions.clear();
        }
        return;
      }
      const prefix = 'scalewayAI.llmAccess.secret.v1.';
      if (!key.startsWith(prefix)) return;
      // Never suppress own writes: a delayed event may also represent rotation.
      // Configure publishes only after its new slot has been stored/read back.
      const id = key.slice(prefix.length);
      this.inventoryEpoch++;
      this.localInventory.clear();
      this.secretVersions.delete(id);
      this.verified.delete(id);
    });
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.secretListener.dispose();
    this.clear();
  }
  clear(): void {
    this.generation++;
    this.localInventory.clear();
    this.verified.clear();
    this.secretVersions.clear();
    this.scopeKey = '';
  }
  rows(s: LlmAccessScope): ListedModel[] {
    if (this.disposed || !s.current() || this.scopeKey !== namespace(s))
      return [];
    return [...this.verified.values()]
      .filter((v) => (v.record.metadata?.expiresAt ?? 0) > Date.now() + 30000)
      .map((v) => structuredClone(v.row));
  }
  private ids(s: LlmAccessScope): string[] {
    const raw = this.context.globalState.get<unknown>(namespace(s));
    return Array.isArray(raw) && raw.length <= 32 && raw.every(opaque)
      ? [...new Set(raw)]
      : [];
  }
  private async inspect(
    record: StoredAccess,
    s: LlmAccessScope,
    checkBearer = true,
  ): Promise<AccessKeyMetadata> {
    const metadata = await inspectAccessAPIKey(
      s.project.organizationId,
      record.accessKey,
      record.secretKey,
      s.signal,
    );
    if (!s.current()) throw new IAMAccessError('cancelled');
    if (
      metadata.accessKey !== record.accessKey ||
      metadata.organizationId !== s.project.organizationId
    )
      throw new IAMAccessError('invalid_response');
    if (metadata.expiresAt <= Date.now() + 30000)
      throw new IAMAccessError('expired');
    if (
      checkBearer &&
      record.metadata &&
      (metadata.bearer.id !== record.metadata.bearer.id ||
        metadata.bearer.type !== record.metadata.bearer.type)
    )
      throw new IAMAccessError('invalid_response');
    return metadata;
  }
  private async keyInventory(
    s: LlmAccessScope,
  ): Promise<
    { id: string; metadata: AccessKeyInventory; secretAvailable: boolean }[]
  > {
    const generation = this.generation,
      epoch = this.proofEpoch,
      inventoryEpoch = this.inventoryEpoch;
    const current = () =>
      !this.disposed &&
      s.current() &&
      this.generation === generation &&
      this.proofEpoch === epoch &&
      this.inventoryEpoch === inventoryEpoch;
    if (!current()) return [];
    this.localInventory.clear();
    const keys = await listAccessAPIKeys(
      s.project.organizationId,
      s.controlCredential(),
      s.signal,
    );
    if (!current()) return [];
    if (keys.length > 500) throw new IAMAccessError('pagination_limit');
    const local = new Map<string, StoredAccess>();
    for (const id of this.ids(s)) {
      const revision = this.secretVersions.get(id);
      const record = parse(await this.context.secrets.get(slot(id)), s);
      if (!current()) return [];
      if (record?.id === id && this.secretVersions.get(id) === revision)
        if (!local.has(record.accessKey)) local.set(record.accessKey, record);
    }
    if (this.scopeKey !== namespace(s)) this.clear();
    this.scopeKey = namespace(s);
    this.localInventory = new Map(
      keys.flatMap((metadata) => {
        const record = local.get(metadata.accessKey);
        return record ? [[record.id, { ...record }] as const] : [];
      }),
    );
    return keys.map((metadata) => ({
      id:
        local.get(metadata.accessKey)?.id ??
        inventoryId(s.project.organizationId, metadata.accessKey),
      metadata,
      secretAvailable: local.has(metadata.accessKey),
    }));
  }
  /** Organization metadata only; local secret presence is scoped to this user/project.
   * Expired keys remain visible. Neither IAM permissions nor inference readiness is claimed. */
  async inventory(s: LlmAccessScope): Promise<ApiKeyResource[]> {
    return (await this.keyInventory(s)).map(
      ({ id, metadata, secretAvailable }) => ({
        id,
        description: metadata.description,
        maskedAccessKey: `SCW••••${metadata.accessKey.slice(-4)}`,
        bearerType: metadata.bearer.type,
        expiresAt: metadata.expiresAt,
        ...(metadata.createdAt ? { createdAt: metadata.createdAt } : {}),
        secretAvailable,
      }),
    );
  }
  /** Exact local lookup after explicit native reveal. No HTTP; expiry is not a read gate. */
  async revealLocal(
    s: LlmAccessScope,
    id: string,
  ): Promise<{
    current(): boolean;
    credentials(): { accessKey: string; secretKey: string };
  }> {
    const expected = this.localInventory.get(id);
    const generation = this.generation;
    const proofEpoch = this.proofEpoch;
    const inventoryEpoch = this.inventoryEpoch;
    if (!opaque(id) || !expected || this.scopeKey !== namespace(s))
      throw new IAMAccessError('invalid_request');
    const revision = this.watch(id);
    const current = () =>
      this.scopeKey === namespace(s) &&
      opaque(id) &&
      !this.disposed &&
      s.current() &&
      this.generation === generation &&
      this.proofEpoch === proofEpoch &&
      this.inventoryEpoch === inventoryEpoch &&
      this.secretVersions.get(id) === revision &&
      this.localInventory.get(id) === expected &&
      !!expected &&
      this.ids(s).includes(id);
    if (!current()) throw new IAMAccessError('invalid_request');
    const raw = await this.context.secrets.get(slot(id));
    const record = parse(raw, s);
    if (
      !current() ||
      !record ||
      record.id !== id ||
      record.accessKey !== expected?.accessKey ||
      record.secretKey !== expected?.secretKey ||
      JSON.stringify(record.metadata?.bearer) !==
        JSON.stringify(expected?.metadata?.bearer) ||
      raw !== (await this.context.secrets.get(slot(id))) ||
      !current()
    )
      throw new IAMAccessError('invalid_request');
    return {
      current,
      credentials: () => {
        if (!current()) throw new IAMAccessError('invalid_request');
        return { accessKey: record.accessKey, secretKey: record.secretKey };
      },
    };
  }
  /** Dedicated agents validate chosen IAM credentials, never substitute login. */
  async keyCredential(
    s: LlmAccessScope,
    id: string,
  ): Promise<{
    current(): boolean;
    secretKey(): string;
  }> {
    const local = await this.revealLocal(s, id);
    const pair = local.credentials();
    const expected = this.localInventory.get(id);
    if (!expected) throw new IAMAccessError('invalid_request');
    const metadata = await this.inspect(expected, s);
    const current = () =>
      local.current() && metadata.expiresAt > Date.now() + 30000;
    if (!current()) throw new IAMAccessError('invalid_request');
    return {
      current,
      secretKey: () => {
        if (!current()) throw new IAMAccessError('expired');
        return pair.secretKey;
      },
    };
  }
  async configureKey(s: LlmAccessScope, id?: string): Promise<boolean> {
    if (id !== undefined && !opaque(id)) return false;
    return !!(await this.register(undefined, s, id));
  }
  async configure(
    model: ListedModel,
    s: LlmAccessScope,
    preferredKeyId?: string,
  ): Promise<ListedModel | undefined> {
    if (
      this.disposed ||
      this.busy ||
      !s.current() ||
      model.kind !== 'serverless' ||
      (preferredKeyId !== undefined && !opaque(preferredKeyId))
    )
      return;
    const generation = this.generation,
      epoch = this.proofEpoch;
    const scope = s;
    s = {
      ...scope,
      current: () =>
        !this.disposed &&
        scope.current() &&
        this.generation === generation &&
        this.proofEpoch === epoch,
    };
    const entries: {
      label: string;
      description?: string;
      record?: StoredAccess;
    }[] = [];
    for (const id of this.ids(s)) {
      const record = parse(await this.context.secrets.get(slot(id)), s);
      if (!s.current()) return;
      if (record?.id === id)
        entries.push({
          label: record.metadata?.description || 'Clé API enregistrée',
          description: `SCW••••${record.accessKey.slice(-4)}`,
          record,
        });
    }
    const add = { label: 'Configurer / ajouter une clé API' };
    const choices = [
      ...entries.map(({ label, description }) => ({ label, description })),
      add,
    ];
    const preferredIndex = preferredKeyId
      ? entries.findIndex((e) => e.record?.id === preferredKeyId)
      : -1;
    if (preferredKeyId && preferredIndex < 0) return;
    const choice = preferredKeyId
      ? choices[preferredIndex]
      : await vscode.window.showQuickPick(choices, {
          title: `Clé API pour ${model.label}`,
          ignoreFocusOut: true,
          placeHolder:
            'Sélectionner une clé locale ; validation IAM et catalogue, sans inférence',
        });
    if (!s.current() || !choice || !choices.includes(choice)) return;
    if (choice === add) {
      // Registration publishes its own revision; do not retain this read epoch.
      const record = await this.register(model, scope);
      return record
        ? structuredClone(this.verified.get(record.id)?.row)
        : undefined;
    }
    const record = entries[choices.indexOf(choice)]?.record;
    if (!record) return;
    const expected = this.verified.get(record.id);
    const revision = this.watch(record.id);
    const raw = await this.context.secrets.get(slot(record.id));
    const persistedRecord = parse(raw, s);
    if (
      !s.current() ||
      persistedRecord?.id !== record.id ||
      persistedRecord.accessKey !== record.accessKey ||
      persistedRecord.secretKey !== record.secretKey
    )
      return;
    try {
      const verified = await this.verify(persistedRecord, model, s);
      if (!verified) throw new IAMAccessError('access_denied');
      if (
        this.verified.get(record.id) !== expected ||
        !s.current() ||
        revision !== this.secretVersions.get(record.id) ||
        raw !== (await this.context.secrets.get(slot(record.id))) ||
        !s.current() ||
        (verified.record.metadata?.expiresAt ?? 0) <= Date.now() + 30000
      )
        return;
      if (this.scopeKey !== namespace(s)) this.clear();
      this.scopeKey = namespace(s);
      // Preserve unchanged key identity so consumers for other models survive.
      const existing = this.verified.get(record.id);
      if (existing) {
        existing.record = verified.record;
        existing.row = verified.row;
      } else this.verified.set(record.id, verified);
      return structuredClone(verified.row);
    } catch {
      if (expected && this.verified.get(record.id) === expected) {
        this.verified.delete(record.id);
        this.secretVersions.delete(record.id);
      }
      return;
    }
  }
  private async verify(
    record: StoredAccess,
    model: ListedModel,
    s: LlmAccessScope,
    cache?: Map<string, Promise<RefreshProof>>,
  ): Promise<VerifiedAccess | undefined> {
    if (!s.current()) return;
    // Ephemeral, at most 32 entries; scope and both key parts are significant.
    const proofKey = JSON.stringify([
      namespace(s),
      record.accessKey,
      record.secretKey,
    ]);
    let proof = cache?.get(proofKey);
    if (!proof) {
      proof = (async () => {
        const metadata = await this.inspect(record, s, false);
        return { metadata };
      })();
      cache?.set(proofKey, proof);
    }
    const shared = await proof;
    const { metadata } = shared;
    if (!s.current()) return;
    if (metadata.expiresAt <= Date.now() + 30000)
      throw new IAMAccessError('expired');
    if (
      record.metadata &&
      (metadata.bearer.id !== record.metadata.bearer.id ||
        metadata.bearer.type !== record.metadata.bearer.type)
    )
      throw new IAMAccessError('invalid_response');
    // Even with shared reads, each binding must pass its own bearer check first.
    shared.models ??= listServerlessAvailability(record.secretKey, s.signal);
    const models = await shared.models;
    if (!s.current() || !models.some((m) => m.id === model.id)) return;
    if (metadata.expiresAt <= Date.now() + 30000)
      throw new IAMAccessError('expired');
    const created = models.find((m) => m.id === model.id)?.createdAt;
    return {
      record: { ...record, metadata },
      row: {
        ...model,
        id: model.id,
        kind: 'serverless',
        serverlessAvailability: 'Disponible',
        serverlessCreatedAt: created,
        llmAccess: {
          id: record.id,
          projectId: s.project.id,
          bearerType: metadata.bearer.type,
          expiresAt: metadata.expiresAt,
          verifiedAt: new Date().toISOString(),
        },
        status: 'Accès configuré · IAM vérifié',
      },
    };
  }
  async refresh(
    s: LlmAccessScope,
    catalogue: ListedModel[],
  ): Promise<ListedModel[]> {
    if (this.disposed || this.busy || !s.current()) return this.rows(s);
    this.busy = true;
    const key = namespace(s);
    const selectedViews = new Map(
      [...this.verified].map(([id, v]) => [id, v.row]),
    );
    // Invalidate old proofs before any network operation; failure cannot keep an active row.
    this.clear();
    this.scopeKey = key;
    const generation = this.generation;
    const proofEpoch = this.proofEpoch;
    const scope = s;
    s = {
      ...scope,
      current: () =>
        !this.disposed &&
        this.generation === generation &&
        this.proofEpoch === proofEpoch &&
        scope.current(),
    };
    const cache = new Map<string, Promise<RefreshProof>>();
    try {
      for (const id of this.ids(s)) {
        if (!s.current()) return [];
        const revision = this.watch(id);
        const record = parse(await this.context.secrets.get(slot(id)), s);
        if (!s.current() || !record || record.id !== id) {
          this.secretVersions.delete(id);
          continue;
        }
        try {
          const selected =
            selectedViews.get(id)?.id ??
            record.modelId ??
            catalogue.find((m) => m.kind === 'serverless')?.id;
          if (!selected) continue;
          const model = catalogue.find(
            (m) => m.kind === 'serverless' && m.id === selected,
          ) ?? {
            id: selected,
            label: selected,
            kind: 'serverless' as const,
          };
          const verified = await this.verify(record, model, s, cache);
          if (
            verified &&
            s.current() &&
            revision === this.secretVersions.get(id)
          )
            this.verified.set(id, verified);
        } catch {
          /* Invalid/revoked/inaccessible keys are hidden, not promoted to active. */
        } finally {
          if (!this.verified.has(id)) this.secretVersions.delete(id);
        }
      }
      return this.rows(s);
    } finally {
      cache.clear();
      this.busy = false;
    }
  }
  private async register(
    model: ListedModel | undefined,
    s: LlmAccessScope,
    selectedId?: string,
  ): Promise<StoredAccess | undefined> {
    if (
      this.disposed ||
      this.busy ||
      (model && model.kind !== 'serverless') ||
      !s.current()
    )
      return;
    const generation = this.generation;
    let registrationEpoch = this.proofEpoch;
    const scope = s;
    s = {
      ...scope,
      current: () =>
        !this.disposed &&
        this.generation === generation &&
        this.proofEpoch === registrationEpoch &&
        scope.current(),
    };
    this.busy = true;
    let lock: string | undefined;
    let locked = false;
    const key = namespace(s);
    const pendingSlot = `${key}.pending`;
    try {
      const root = this.context.globalStorageUri?.fsPath;
      if (root) {
        await mkdir(root, { recursive: true });
        lock = join(root, `llm-access-${key.split('.').at(-1)}.lock`);
        await mkdir(lock);
        locked = true;
      }
      if (!s.current()) return;
      const pending = await this.context.secrets.get(pendingSlot);
      if (!s.current()) return;
      let recovered: { accessKey: string; secretKey: string } | undefined;
      let recoveredBearer: import('./llmAccessIam').Bearer | undefined;
      if (pending) {
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(pending);
        } catch {
          /* Unknown outcome remains blocked. */
        }
        const candidate = parsed.credentials as
          | { accessKey?: unknown; secretKey?: unknown }
          | undefined;
        if (
          candidate &&
          typeof candidate.accessKey === 'string' &&
          /^SCW[A-Z0-9]{17}$/.test(candidate.accessKey) &&
          uuid(candidate.secretKey) &&
          (parsed.modelId === undefined || text(parsed.modelId))
        ) {
          const action = await vscode.window.showWarningMessage(
            'Une clé créée a été conservée dans SecretStorage. Reprendre vérifie cette même clé via IAM, sans créer une autre clé et sans inférence.',
            { modal: true },
            'Reprendre la configuration',
          );
          if (action !== 'Reprendre la configuration' || !s.current()) return;
          recovered = {
            accessKey: candidate.accessKey,
            secretKey: candidate.secretKey,
          };
          const bearer = parsed.bearer as
            | import('./llmAccessIam').Bearer
            | undefined;
          if (
            !bearer ||
            !uuid(bearer.id) ||
            !['user', 'application'].includes(bearer.type)
          )
            return;
          recoveredBearer = bearer;
        } else {
          const choice = await vscode.window.showWarningMessage(
            'Une création de clé LLM a un résultat inconnu. Aucun nouvel envoi. Vérifiez dans Scaleway et révoquez les clés issues de cette tentative avant de confirmer. Le secret d’une clé console ne peut pas être récupéré par l’API.',
            { modal: true },
            'Tentative vérifiée et clés révoquées',
          );
          if (choice === 'Tentative vérifiée et clés révoquées' && s.current())
            await this.context.secrets.delete(pendingSlot);
          return;
        }
      }
      let selected: AccessKeyInventory | undefined;
      if (selectedId) {
        const inventory = await this.keyInventory(s);
        selected = inventory.find((k) => k.id === selectedId)?.metadata;
        if (!selected || !s.current()) return;
      }
      const plan = recovered
        ? { type: 'import' as const, ...recovered }
        : await chooseAccessPlan({
            modelId: model?.id,
            selectedAccessKey: selected?.accessKey,
            userId: s.userId,
            projectName: s.project.name,
            current: s.current,
            applications: () =>
              listAccessApplications(
                s.project.organizationId,
                s.controlCredential(),
                s.signal,
              ),
          });
      if (!plan || !s.current()) return;
      if (
        selected &&
        (plan.type !== 'import' || plan.accessKey !== selected.accessKey)
      )
        throw new IAMAccessError('invalid_request');
      let credentials: { accessKey: string; secretKey: string };
      let expectedBearer: import('./llmAccessIam').Bearer | undefined =
        recoveredBearer ?? selected?.bearer;
      if (plan.type === 'reuse') credentials = s.reuseCredential();
      else if (plan.type === 'import') credentials = plan;
      else {
        if (plan.bearer.type === 'user' && plan.bearer.id !== s.userId)
          throw new IAMAccessError('invalid_request');
        expectedBearer = plan.bearer;
        if (plan.bearer.type === 'application') {
          const applications = await listAccessApplications(
            s.project.organizationId,
            s.controlCredential(),
            s.signal,
          );
          if (
            !s.current() ||
            !applications.some((a) => a.id === plan.bearer.id)
          )
            return;
        }
        // Marker BEFORE dispatch; unknown outcome never retries automatically.
        await this.context.secrets.store(
          pendingSlot,
          JSON.stringify({
            modelId: model?.id,
            bearer: plan.bearer,
            description: plan.description,
            pending: true,
          }),
        );
        if (!s.current()) {
          await this.context.secrets.delete(pendingSlot);
          return;
        }
        credentials = await createAccessAPIKey(
          s.project.organizationId,
          plan.bearer,
          s.controlCredential(),
          plan.description,
          plan.lifetimeMs,
          s.signal,
        );
        // Persist returned secret even if caller disconnected meanwhile: explicit recovery, never expose it.
        await this.context.secrets.store(
          pendingSlot,
          JSON.stringify({
            modelId: model?.id,
            bearer: plan.bearer,
            description: plan.description,
            credentials,
            pending: true,
          }),
        );
        if (!s.current()) return;
      }
      const record: StoredAccess = {
        version: 2,
        id: randomBytes(16).toString('hex'),
        ownerId: s.userId,
        projectId: s.project.id,
        organizationId: s.project.organizationId,
        ...credentials,
      };
      const revision = this.watch(record.id);
      const verified = model
        ? await this.verify(record, model, s)
        : {
            record: { ...record, metadata: await this.inspect(record, s) },
            row: { id: '', label: '', kind: 'serverless' as const },
          };
      if (
        !verified ||
        !s.current() ||
        revision !== this.secretVersions.get(record.id)
      )
        return;
      if (
        expectedBearer &&
        (verified.record.metadata?.bearer.type !== expectedBearer.type ||
          verified.record.metadata?.bearer.id !== expectedBearer.id)
      )
        throw new IAMAccessError('invalid_response');
      const ids = this.ids(s);
      // Preserve other keys and legacy records. Deduplicate only exact credentials.
      const previous: string[] = [];
      let duplicate: StoredAccess | undefined;
      for (const id of ids) {
        const old = parse(await this.context.secrets.get(slot(id)), s);
        previous.push(id);
        if (
          old?.id === id &&
          old.accessKey === credentials.accessKey &&
          old.secretKey === credentials.secretKey
        )
          duplicate ??= old;
      }
      if (!s.current()) return;
      if (duplicate) {
        const duplicateRevision = this.watch(duplicate.id);
        if (
          duplicate.metadata &&
          (duplicate.metadata.bearer.id !==
            verified.record.metadata?.bearer.id ||
            duplicate.metadata.bearer.type !==
              verified.record.metadata?.bearer.type)
        )
          throw new IAMAccessError('invalid_response');
        const storedDuplicate = parse(
          await this.context.secrets.get(slot(duplicate.id)),
          s,
        );
        if (
          !s.current() ||
          duplicateRevision !== this.secretVersions.get(duplicate.id) ||
          !storedDuplicate ||
          storedDuplicate.accessKey !== credentials.accessKey ||
          storedDuplicate.secretKey !== credentials.secretKey ||
          (verified.record.metadata?.expiresAt ?? 0) <= Date.now() + 30000
        )
          return;
        if (plan.type === 'create' || recovered)
          await this.context.secrets.delete(pendingSlot);
        if (
          !s.current() ||
          duplicateRevision !== this.secretVersions.get(duplicate.id) ||
          (verified.record.metadata?.expiresAt ?? 0) <= Date.now() + 30000
        )
          return;
        if (model) {
          verified.record = {
            ...duplicate,
            metadata: verified.record.metadata,
          };
          if (!verified.row.llmAccess) return;
          verified.row.llmAccess.id = duplicate.id;
          if (this.scopeKey !== key) this.clear();
          this.scopeKey = key;
          const existing = this.verified.get(duplicate.id);
          if (existing) {
            existing.record = verified.record;
            existing.row = verified.row;
          } else this.verified.set(duplicate.id, verified);
        }
        return duplicate;
      }
      if (previous.length >= 32) throw new IAMAccessError('pagination_limit');
      const stored = JSON.stringify(verified.record);
      // Notify peers even when their globalState index has not propagated.
      // This is non-credential data in SecretStorage, not execution authority.
      await this.context.secrets.store(
        `${key}.revision`,
        randomBytes(16).toString('hex'),
      );
      const publicationEpoch = this.proofEpoch;
      registrationEpoch = publicationEpoch;
      if (!s.current()) return;
      await this.context.secrets.store(slot(record.id), stored);
      if (!s.current()) return;
      const storedRevision = this.watch(record.id);
      await this.context.globalState.update(key, [...previous, record.id]);
      if (!s.current()) return;
      if (plan.type === 'create' || recovered)
        await this.context.secrets.delete(pendingSlot);
      if (!s.current()) return;
      const persisted = await this.context.secrets.get(slot(record.id));
      if (
        !s.current() ||
        storedRevision !== this.secretVersions.get(record.id) ||
        publicationEpoch !== this.proofEpoch ||
        (verified.record.metadata?.expiresAt ?? 0) <= Date.now() + 30000 ||
        persisted !== stored
      )
        return;
      if (this.scopeKey !== key) this.clear();
      this.scopeKey = key;
      if (model) this.verified.set(record.id, verified);
      return verified.record;
    } catch (error) {
      if (
        s.current() &&
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'EEXIST'
      ) {
        await vscode.window.showWarningMessage(
          `Accès LLM verrouillé par une autre fenêtre ou une opération interrompue. Aucun appel de création lancé. Fermez toutes les fenêtres VS Code avant de supprimer manuellement le dossier de verrou : ${lock}. Les identifiants en attente restent dans SecretStorage.`,
        );
      } else if (s.current())
        await vscode.window.showErrorMessage(
          'Accès LLM non configuré. Vérifiez vos droits IAM et votre clé. Aucun modèle sélectionné n’est ajouté comme service actif. Une création de clé déjà envoyée peut nécessiter une vérification dans la console.',
        );
      return;
    } finally {
      if (locked && lock) await rmdir(lock).catch(() => {});
      for (const id of this.secretVersions.keys())
        if (!this.verified.has(id)) this.secretVersions.delete(id);
      this.busy = false;
    }
  }
  async credential(
    s: LlmAccessScope,
    model: ListedModel,
  ): Promise<{ current(): boolean; secretKey(): string }> {
    const id = model.llmAccess?.id;
    if (this.disposed || !id || !s.current() || this.scopeKey !== namespace(s))
      throw new IAMAccessError('invalid_request');
    const expected = this.verified.get(id);
    if (!expected) throw new IAMAccessError('invalid_request');
    const revision = this.watch(id);
    const record = parse(await this.context.secrets.get(slot(id)), s);
    if (
      !record ||
      record.id !== id ||
      !this.ids(s).includes(id) ||
      record.secretKey !== expected.record.secretKey ||
      record.accessKey !== expected.record.accessKey ||
      (record.metadata &&
        (record.metadata.bearer.id !== expected.record.metadata?.bearer.id ||
          record.metadata.bearer.type !==
            expected.record.metadata?.bearer.type)) ||
      this.verified.get(id) !== expected ||
      revision !== this.secretVersions.get(id) ||
      !s.current()
    )
      throw new IAMAccessError('invalid_request');
    let refreshed: VerifiedAccess | undefined;
    try {
      refreshed = await this.verify(
        { ...record, metadata: expected.record.metadata },
        model,
        s,
      );
    } catch (error) {
      if (this.verified.get(id) === expected) {
        this.verified.delete(id);
        this.secretVersions.delete(id);
      }
      throw error;
    }
    if (
      !refreshed ||
      !s.current() ||
      revision !== this.secretVersions.get(id) ||
      this.verified.get(id) !== expected ||
      !this.ids(s).includes(id)
    ) {
      if (this.verified.get(id) === expected) {
        this.verified.delete(id);
        this.secretVersions.delete(id);
      }
      throw new IAMAccessError('access_denied');
    }
    // Renew proof in-place: every unchanged binding consumer survives renewal.
    expected.record = refreshed.record;
    expected.row = refreshed.row;
    const expiresAt = refreshed.record.metadata?.expiresAt ?? 0;
    const current = () =>
      !this.disposed &&
      s.current() &&
      this.scopeKey === namespace(s) &&
      this.verified.get(id) === expected &&
      this.ids(s).includes(id) &&
      Math.min(expiresAt, expected.record.metadata?.expiresAt ?? 0) >
        Date.now() + 30000;
    return {
      current,
      secretKey: () => {
        if (!current()) throw new IAMAccessError('expired');
        return record.secretKey;
      },
    };
  }
}
