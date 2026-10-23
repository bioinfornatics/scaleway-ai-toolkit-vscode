import { createHash, randomBytes } from 'node:crypto';
import { mkdir, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import * as vscode from 'vscode';
import {
  type AccessKeyMetadata,
  createAccessAPIKey,
  IAMAccessError,
  inspectAccessAPIKey,
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
  version: 1;
  id: string;
  ownerId: string;
  projectId: string;
  organizationId: string;
  modelId: string;
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
      r.version !== 1 ||
      !opaque(r.id) ||
      r.ownerId !== s.userId ||
      r.projectId !== s.project.id ||
      r.organizationId !== s.project.organizationId ||
      !text(r.modelId) ||
      !/^SCW[A-Z0-9]{17}$/.test(r.accessKey) ||
      !uuid(r.secretKey)
    )
      return;
    return r;
  } catch {
    return;
  }
}
type VerifiedAccess = { record: StoredAccess; row: ListedModel };
type RefreshProof = {
  metadata: AccessKeyMetadata;
  models?: Promise<Awaited<ReturnType<typeof listServerlessAvailability>>>;
};
/** Access metadata is not a deployed resource. Only fresh IAM+model discovery reaches rows.
 * Secrets, access keys and bearer IDs never enter public model/browser metadata. */
export class LlmAccessRegistry {
  // Entry identity is the binding generation, not the most recent proof.
  private verified = new Map<string, VerifiedAccess>();
  private generation = 0;
  private proofEpoch = 0;
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
        if (key === this.scopeKey + '.revision') {
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
        const metadata = await inspectAccessAPIKey(
          s.project.organizationId,
          record.accessKey,
          record.secretKey,
          s.signal,
        );
        if (!s.current()) throw new IAMAccessError('cancelled');
        if (metadata.expiresAt <= Date.now() + 30000)
          throw new IAMAccessError('expired');
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
    if (!s.current() || !models.some((m) => m.id === record.modelId)) return;
    if (metadata.expiresAt <= Date.now() + 30000)
      throw new IAMAccessError('expired');
    const created = models.find((m) => m.id === record.modelId)?.createdAt;
    return {
      record: { ...record, metadata },
      row: {
        ...model,
        id: record.modelId,
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
          const model = catalogue.find(
            (m) => m.kind === 'serverless' && m.id === record.modelId,
          ) ?? {
            id: record.modelId,
            label: record.modelId,
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
  async configure(
    model: ListedModel,
    s: LlmAccessScope,
  ): Promise<ListedModel | undefined> {
    if (
      this.disposed ||
      this.busy ||
      model.kind !== 'serverless' ||
      !s.current()
    )
      return;
    const generation = this.generation;
    const scope = s;
    s = {
      ...scope,
      current: () =>
        !this.disposed && this.generation === generation && scope.current(),
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
          text(parsed.modelId)
        ) {
          if (parsed.modelId !== model.id) {
            await vscode.window.showWarningMessage(
              `Une clé récupérable attend sa configuration pour ${parsed.modelId}. Utilisez ce modèle pour reprendre ; aucun nouveau secret ne sera généré.`,
            );
            return;
          }
          const action = await vscode.window.showWarningMessage(
            'Une clé créée a été conservée dans SecretStorage. Reprendre vérifie cette même clé et le modèle via API, sans créer une autre clé et sans inférence.',
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
      const plan = recovered
        ? { type: 'import' as const, ...recovered }
        : await chooseAccessPlan({
            modelId: model.id,
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
      let credentials: { accessKey: string; secretKey: string };
      let expectedBearer: import('./llmAccessIam').Bearer | undefined =
        recoveredBearer;
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
            modelId: model.id,
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
            modelId: model.id,
            bearer: plan.bearer,
            description: plan.description,
            credentials,
            pending: true,
          }),
        );
        if (!s.current()) return;
      }
      const record: StoredAccess = {
        version: 1,
        id: randomBytes(16).toString('hex'),
        ownerId: s.userId,
        projectId: s.project.id,
        organizationId: s.project.organizationId,
        modelId: model.id,
        ...credentials,
      };
      const revision = this.watch(record.id);
      const verified = await this.verify(record, model, s);
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
      // At most one credential binding per model in this workspace/project view.
      const previous: string[] = [];
      const superseded: { id: string; raw: string }[] = [];
      for (const id of ids) {
        const raw = await this.context.secrets.get(slot(id));
        const old = parse(raw, s);
        if (old?.modelId !== model.id) previous.push(id);
        else if (old.id === id && raw) superseded.push({ id, raw });
      }
      if (!s.current()) return;
      if (previous.length >= 32) throw new IAMAccessError('pagination_limit');
      const stored = JSON.stringify(verified.record);
      // Notify peers even when their globalState index has not propagated.
      // This is non-credential data in SecretStorage, not execution authority.
      await this.context.secrets.store(
        key + '.revision',
        randomBytes(16).toString('hex'),
      );
      const publicationEpoch = this.proofEpoch;
      if (!s.current()) return;
      await this.context.secrets.store(slot(record.id), stored);
      if (!s.current()) return;
      const storedRevision = this.watch(record.id);
      await this.context.globalState.update(key, [...previous, record.id]);
      if (!s.current()) return;
      // Retire only validated superseded binding records after the new index
      // is committed under the shared configuration lock. Never revoke remote
      // keys or touch generated .env copies; other model bindings stay intact.
      for (const old of superseded) {
        if (!s.current() || this.proofEpoch !== publicationEpoch) return;
        if ((await this.context.secrets.get(slot(old.id))) !== old.raw) return;
        if (!s.current() || this.proofEpoch !== publicationEpoch) return;
        await this.context.secrets.delete(slot(old.id));
      }
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
      for (const [id, v] of this.verified)
        if (v.record.modelId === model.id) {
          this.verified.delete(id);
          this.secretVersions.delete(id);
        }
      this.verified.set(record.id, verified);
      return structuredClone(verified.row);
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
      record.modelId !== model.id ||
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
