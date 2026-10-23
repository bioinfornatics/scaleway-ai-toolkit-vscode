import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rmdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { browserLogin, parseSession, type UserSession } from './browserLogin';
import {
  type DedicatedPriceObservation,
  listDedicatedPrices,
} from './dedicatedPrices';
import { DeploymentJournal } from './deploymentJournal';
import {
  type DeploymentOperation,
  followDeployment,
} from './deploymentLifecycle';
import { deploymentWizard } from './deploymentWizard';
import { createService, reviewService } from './deployService';
import { inventoryFailureReason } from './llmAccessIam';
import {
  type ApiKeyResource,
  LlmAccessRegistry,
  type LlmAccessScope,
} from './llmAccessRegistry';
import { getModelEula, type ModelEula } from './modelEula';
import { createProject } from './projectCreation';
import {
  getDeployment,
  type ListedModel,
  listDedicated,
  listDedicatedCatalog,
  listNodeTypes,
  listOrganizations,
  listProjects,
  listServerless,
  type Project,
  ReadError,
  text,
  uuid,
} from './provider';
import { listQuotaEvidence, type QuotaSnapshot } from './quotas';
import {
  createUserAPIKey,
  inspectExistingUserAPIKey,
  revokeUserAPIKey,
  SDKError,
} from './scalewaySdk';

interface Metadata {
  name: string;
  organizationId: string;
  organizationName?: string;
}
const keyBootstraps = new Set<string>();
interface KeyPrincipal {
  mode: 'api-key';
  userId: string;
  expiresAt: number;
  token?: undefined;
}
type Principal = UserSession | KeyPrincipal;
const AUTH_CONFIGURATION = 'scalewayAI.authConfiguration.v1';
const IMPORTED_KEY_SECRET = 'scalewayAI.importedKey.v1';
const SESSION_SECRET = 'scalewayAI.userSession.v1';
const keySecret = (userId: string) => `scalewayAI.sdkKey.v1.${userId}`;
interface StoredAPIKey {
  userId: string;
  accessKey: string;
  secretKey: string;
  expiresAt: number;
}
function validKey(value: unknown, userId: string): value is StoredAPIKey {
  if (!value || typeof value !== 'object') return false;
  const key = value as StoredAPIKey;
  return (
    key.userId === userId &&
    typeof key.accessKey === 'string' &&
    /^SCW[A-Z0-9]{17}$/.test(key.accessKey) &&
    uuid(key.secretKey) &&
    Number.isFinite(key.expiresAt) &&
    key.expiresAt > Date.now() + 30000
  );
}
const preferenceKey = (userId: string) => `scalewayAI.preferences.v1.${userId}`;
export class Connection implements vscode.Disposable {
  metadata: Metadata | undefined;
  project: Project | undefined;
  serverless: ListedModel[] = [];
  serverlessResources: ListedModel[] = [];
  apiKeys: ApiKeyResource[] = [];
  apiKeysState = 'Non chargé';
  private apiKeysScope = '';
  private apiKeysEpoch = 0;
  dedicated: ListedModel[] = [];
  dedicatedCatalog: ListedModel[] = [];
  serverlessState = 'Non chargé · catalogue public';
  dedicatedState = 'Non chargés';
  dedicatedCatalogState = 'Non chargé';
  busy = false;
  private session: Principal | undefined;
  private apiKey: StoredAPIKey | undefined;
  private imported = false;
  private keyValidated = false;
  private generation = 0;
  private inferenceScopes = new Set<AbortController>();
  invalidateInference() {
    this.apiKeysEpoch++;
    this.apiKeys = [];
    this.apiKeysState = 'Non chargé';
    this.apiKeysScope = '';
    this.serverlessResources = this.serverlessResources.map(
      ({
        serverlessAvailability: _availability,
        serverlessCreatedAt: _createdAt,
        ...row
      }) => row,
    );
    for (const scope of this.inferenceScopes) scope.abort();
    this.inferenceScopes.clear();
  }
  /** Pin a panel to this session/project. Only Exécuter asks for a secret. */
  inferenceScope() {
    const project = this.project;
    const session = this.session;
    const generation = this.generation;
    if (
      !project ||
      !session ||
      !this.connected ||
      !vscode.workspace.isTrusted ||
      this.disposed
    )
      throw new ReadError('invalid_scope');
    const abort = new AbortController();
    this.inferenceScopes.add(abort);
    const current = () =>
      !abort.signal.aborted &&
      generation === this.generation &&
      project === this.project &&
      session === this.session &&
      this.connected &&
      vscode.workspace.isTrusted &&
      !this.disposed;
    const guard = setInterval(() => {
      if (!current()) abort.abort();
    }, 250);
    guard.unref();
    abort.signal.addEventListener('abort', () => clearInterval(guard), {
      once: true,
    });
    return {
      project,
      signal: abort.signal,
      current,
      authorize: () => {
        if (!current()) throw new ReadError('invalid_scope');
        return this.token();
      },
      dispose: () => {
        this.inferenceScopes.delete(abort);
        abort.abort();
      },
    };
  }
  private abort: AbortController | undefined;
  private expiry: ReturnType<typeof setTimeout> | undefined;
  private storage: Promise<void> = Promise.resolve();
  private disposed = false;
  private operationJournal:
    | { userId: string; project: Project; journal: DeploymentJournal }
    | undefined;
  readonly ready: Promise<void>;
  private readonly llmAccess: LlmAccessRegistry;
  constructor(
    private context: vscode.ExtensionContext,
    private changed: () => void,
  ) {
    this.llmAccess = new LlmAccessRegistry(context);
    this.ready = this.restoreSession();
  }
  private write(action: () => PromiseLike<void>): Promise<void> {
    const next = this.storage.then(async () => {
      await action();
    });
    this.storage = next.catch(() => {});
    return next;
  }
  private async restoreSession() {
    const generation = this.generation;
    if (vscode.env.remoteName) return;
    try {
      const configuration = this.context.globalState.get<{
        mode: string;
        userId?: string;
      }>(AUTH_CONFIGURATION);
      if (configuration?.mode === 'disconnected') return;
      if (configuration?.mode === 'api-key' && uuid(configuration.userId)) {
        const stored = await this.context.secrets.get(IMPORTED_KEY_SECRET);
        if (generation !== this.generation || this.disposed) return;
        let key: unknown;
        try {
          key = stored ? JSON.parse(stored) : undefined;
        } catch {
          /* Keep non-secret selections. */
        }
        this.restoreKeyWithoutBrowser(configuration.userId, key, true);
        return;
      }
      if (configuration?.mode === 'browser' && uuid(configuration.userId)) {
        const stored = await this.context.secrets.get(
          keySecret(configuration.userId),
        );
        if (generation !== this.generation || this.disposed) return;
        let key: unknown;
        try {
          key = stored ? JSON.parse(stored) : undefined;
        } catch {
          /* Keep non-secret selections. */
        }
        const saved = await this.context.secrets.get(SESSION_SECRET);
        if (generation !== this.generation || this.disposed) return;
        let browser: UserSession | undefined;
        try {
          const row = saved ? JSON.parse(saved) : undefined;
          if (row?.userId === configuration.userId)
            browser = parseSession(
              Buffer.from(
                JSON.stringify({
                  token: row.token,
                  jwt: {
                    audienceId: row.userId,
                    expiresAt: new Date(row.expiresAt).toISOString(),
                  },
                }),
              ).toString('base64'),
            );
        } catch {
          /* An expired browser JWT does not invalidate a separate API key. */
        }
        if (browser && validKey(key, configuration.userId)) {
          this.imported = false;
          this.apiKey = key;
          this.installSession(browser);
        } else {
          this.restoreKeyWithoutBrowser(configuration.userId, key, false);
        }
        return;
      }
      const saved = await this.context.secrets.get(SESSION_SECRET);
      if (generation !== this.generation || this.disposed || !saved) return;
      const row = JSON.parse(saved);
      const session = parseSession(
        Buffer.from(
          JSON.stringify({
            token: row.token,
            jwt: {
              audienceId: row.userId,
              expiresAt: new Date(row.expiresAt).toISOString(),
            },
          }),
        ).toString('base64'),
      );
      const storedKey = await this.context.secrets.get(
        keySecret(session.userId),
      );
      if (generation !== this.generation || this.disposed) return;
      if (storedKey) {
        const value: unknown = JSON.parse(storedKey);
        if (validKey(value, session.userId)) this.apiKey = value;
      }
      this.installSession(session);
    } catch {
      if (generation === this.generation && !this.disposed) {
        this.dropSession();
      }
    }
  }
  /** Restore selections only; this never certifies credentials or remote access. */
  private restorePreferences(userId: string) {
    this.metadata = { name: 'Utilisateur connecté', organizationId: '' };
    const saved = this.context.globalState.get<{
      organizationId: unknown;
      organizationName?: string;
      project?: Project;
    }>(preferenceKey(userId));
    if (saved && uuid(saved.organizationId)) {
      this.metadata.organizationId = saved.organizationId;
      if (
        typeof saved.organizationName === 'string' &&
        saved.organizationName.length <= 256
      )
        this.metadata.organizationName = saved.organizationName;
      const p = saved.project;
      if (
        p &&
        uuid(p.id) &&
        p.organizationId === saved.organizationId &&
        typeof p.name === 'string' &&
        p.name.length > 0 &&
        p.name.length <= 256 &&
        text(p.name)
      )
        this.project = {
          id: p.id,
          name: p.name,
          organizationId: p.organizationId,
        };
    }
    if (this.metadata)
      this.metadata.name = 'Configuration restaurée · accès non vérifié';
    this.changed();
  }
  private restoreKeyWithoutBrowser(
    userId: string,
    key: unknown,
    imported: boolean,
  ): boolean {
    this.imported = imported;
    this.keyValidated = false;
    this.restorePreferences(userId);
    if (!validKey(key, userId)) return false;
    this.apiKey = key;
    this.installSession({ mode: 'api-key', userId, expiresAt: key.expiresAt });
    return true;
  }
  private installSession(session: Principal) {
    this.session = session;
    this.restorePreferences(session.userId);
    this.restoreServerlessResources();
    clearTimeout(this.expiry);
    const expire = () => {
      if (this.session !== session || this.disposed) return;
      if (session.expiresAt <= Date.now() + 30000) {
        const key = this.apiKey,
          imported = this.imported;
        this.dropSession();
        this.restoreKeyWithoutBrowser(session.userId, key, imported);
      } else
        this.expiry = setTimeout(
          expire,
          Math.min(session.expiresAt - Date.now() - 30000, 2147483647),
        );
    };
    expire();
    this.changed();
  }
  private clear() {
    this.invalidateInference();
    this.generation++;
    this.abort?.abort();
    this.abort = undefined;
    this.project = undefined;
    this.operationJournal = undefined;
    this.serverless = [];
    this.serverlessResources = [];
    this.llmAccess.clear();
    this.dedicated = [];
    this.dedicatedCatalog = [];
    this.serverlessState = 'Non chargé · catalogue public';
    this.dedicatedCatalogState = 'Non chargé';
    this.dedicatedState = 'Non chargés';
    this.changed();
  }
  private dropSession() {
    clearTimeout(this.expiry);
    this.expiry = undefined;
    this.session = undefined;
    this.apiKey = undefined;
    this.metadata = undefined;
    this.clear();
    void this.write(() => this.context.secrets.delete(SESSION_SECRET)).catch(
      () => {
        if (!this.disposed)
          void vscode.window.showErrorMessage(
            'Scaleway : secret_storage_unavailable. Impossible de supprimer la session enregistrée.',
          );
      },
    );
  }
  private token(): string {
    if (this.session && 'mode' in this.session && !this.keyValidated)
      throw new ReadError('api_key_validation_required');
    if (!this.session || this.session.expiresAt <= Date.now() + 30000) {
      const previous = this.session,
        key = this.apiKey,
        imported = this.imported;
      this.dropSession();
      if (previous)
        this.restoreKeyWithoutBrowser(previous.userId, key, imported);
      throw new ReadError('session_expired');
    }
    if (!this.apiKey || !validKey(this.apiKey, this.session.userId))
      throw new ReadError('api_key_required');
    return this.apiKey.secretKey;
  }
  get connected(): boolean {
    return (
      !!this.session &&
      this.session.expiresAt > Date.now() + 30000 &&
      !!this.apiKey &&
      validKey(this.apiKey, this.session.userId)
    );
  }
  /** Command-level gate: login and project selection, then resume only if ready. */
  async ensureProject(silent = false): Promise<boolean> {
    await this.ready;
    if (this.busy || !vscode.workspace.isTrusted) return false;
    if (
      this.connected &&
      this.session &&
      'mode' in this.session &&
      !this.keyValidated
    ) {
      if (!(await this.validateImportedKey(silent))) return false;
    }
    if (silent && (!this.connected || !this.project)) return false;
    if (!this.connected) {
      this.dropSession();
      await this.login();
    } else if (!this.project) await this.switchProject();
    return (
      this.connected &&
      !!this.project &&
      !this.busy &&
      vscode.workspace.isTrusted
    );
  }
  private async report(error: unknown) {
    const code =
      error instanceof ReadError || error instanceof SDKError
        ? error.code
        : 'local_error';
    if (
      this.session &&
      'mode' in this.session &&
      ['invalid_api_key', 'api_key_expired'].includes(code)
    ) {
      this.keyValidated = false;
      this.invalidateInference();
      await vscode.window.showErrorMessage(
        'Clé API invalide ou expirée. Utilisez « Utiliser une clé existante » pour la remplacer, ou la connexion navigateur pour en créer une. Configuration conservée ; aucune clé créée.',
      );
      return;
    }
    if (code === 'access_denied' && this.session && !('mode' in this.session))
      this.dropSession();
    if (code !== 'cancelled')
      await vscode.window.showErrorMessage(
        'Scaleway : ' +
          code +
          '. Reconnectez-vous si nécessaire ; vérifiez organisation et permissions. Aucune inférence effectuée.',
      );
  }
  async login(): Promise<void> {
    await this.ready;
    if (this.busy) return;
    if (!vscode.workspace.isTrusted) {
      await vscode.window.showWarningMessage(
        'Connexion disponible uniquement dans un espace de travail approuvé.',
      );
      return;
    }
    if (vscode.env.remoteName) {
      await vscode.window.showWarningMessage(
        'Connexion navigateur disponible uniquement dans VS Code local pour cette preview (callback loopback).',
      );
      return;
    }
    this.busy = true;
    const operation = this.generation;
    let releaseKeyLock: (() => Promise<void>) | undefined;
    let pendingKey:
      | {
          key: StoredAPIKey;
          token: string;
          generation: number;
          created: boolean;
        }
      | undefined;
    try {
      const consent = await vscode.window.showInformationMessage(
        'Connexion Scaleway : utilisez une clé API existante ou connectez-vous dans le navigateur. Le parcours web réutilise la clé enregistrée ou propose sa création avec confirmation (30 jours). Secrets conservés dans SecretStorage VS Code ; aucune inférence. Délai navigateur : 3 minutes.',
        { modal: true },
        'Se connecter',
        'Utiliser une clé existante',
      );
      if (
        consent === 'Utiliser une clé existante' &&
        operation === this.generation &&
        vscode.workspace.isTrusted
      ) {
        this.busy = false;
        await this.useExistingAPIKey();
        return;
      }
      if (
        consent !== 'Se connecter' ||
        operation !== this.generation ||
        !vscode.workspace.isTrusted
      )
        return;
      this.dropSession();
      const generation = this.generation;
      const abort = new AbortController();
      this.abort = abort;
      const session = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Scaleway : connexion dans le navigateur',
          cancellable: true,
        },
        async (_, cancel) => {
          const sub = cancel.onCancellationRequested(() => abort.abort());
          try {
            return await browserLogin(
              async (url) =>
                await vscode.env.openExternal(vscode.Uri.parse(url)),
              abort.signal,
            );
          } finally {
            sub.dispose();
          }
        },
      );
      if (
        generation !== this.generation ||
        abort.signal.aborted ||
        !vscode.workspace.isTrusted
      )
        return;
      releaseKeyLock = await this.lockKeyBootstrap(session.userId);
      const bootstrapped = await this.bootstrapKey(session, generation, abort);
      if (!bootstrapped) return;
      const apiKey = bootstrapped.key;
      pendingKey = {
        key: apiKey,
        token: session.token,
        generation,
        created: bootstrapped.created,
      };
      // Migration: remove old API-key storage; never read/import it as a fallback.
      await this.context.secrets.delete('scalewayAI.apiKey.v1');
      await this.context.globalState.update('scalewayAI.connection', undefined);
      if (
        generation !== this.generation ||
        abort.signal.aborted ||
        !vscode.workspace.isTrusted
      )
        return;
      try {
        await this.write(() =>
          this.context.secrets.store(SESSION_SECRET, JSON.stringify(session)),
        );
      } catch {
        throw new ReadError('secret_storage_unavailable');
      }
      if (
        generation !== this.generation ||
        abort.signal.aborted ||
        this.disposed ||
        !vscode.workspace.isTrusted
      ) {
        await this.write(() => this.context.secrets.delete(SESSION_SECRET));
        return;
      }
      await this.write(() =>
        this.context.globalState.update(AUTH_CONFIGURATION, {
          mode: 'browser',
          userId: session.userId,
        }),
      );
      if (
        generation !== this.generation ||
        this.disposed ||
        !vscode.workspace.isTrusted ||
        abort.signal.aborted
      )
        return;
      this.imported = false;
      this.apiKey = apiKey;
      this.installSession(session);
      pendingKey = undefined;
    } catch (error) {
      await this.report(error);
    } finally {
      if (
        pendingKey?.created &&
        (pendingKey.generation !== this.generation ||
          this.disposed ||
          !vscode.workspace.isTrusted)
      ) {
        await this.cleanupKey(
          pendingKey.key,
          pendingKey.token,
          keySecret(pendingKey.key.userId),
        );
      }
      await releaseKeyLock?.();
      this.busy = false;
      this.changed();
    }
    if (this.connected && !this.project) await this.switchProject();
  }
  private async validateImportedKey(silent = false): Promise<boolean> {
    if (this.busy) return false;
    const key = this.apiKey,
      generation = this.generation;
    if (
      !key ||
      !this.session ||
      !('mode' in this.session) ||
      !vscode.workspace.isTrusted ||
      this.disposed
    )
      return false;
    const abort = new AbortController();
    this.abort = abort;
    this.busy = true;
    try {
      const inspected = await inspectExistingUserAPIKey(
        key.accessKey,
        key.secretKey,
        abort.signal,
      );
      if (
        this.generation !== generation ||
        abort.signal.aborted ||
        this.disposed ||
        !vscode.workspace.isTrusted
      )
        return false;
      if (inspected.userId !== key.userId)
        throw new SDKError('invalid_api_key');
      this.apiKey = { ...key, expiresAt: inspected.expiresAt };
      if (this.session && 'mode' in this.session)
        this.session.expiresAt = inspected.expiresAt;
      await this.write(() =>
        this.context.secrets.store(
          this.imported ? IMPORTED_KEY_SECRET : keySecret(key.userId),
          JSON.stringify(this.apiKey),
        ),
      );
      if (
        generation !== this.generation ||
        this.disposed ||
        abort.signal.aborted ||
        !vscode.workspace.isTrusted
      )
        return false;
      this.keyValidated = true;
      return true;
    } catch (error) {
      if (!silent) await this.report(error);
      return false;
    } finally {
      this.busy = false;
      if (this.abort === abort) this.abort = undefined;
      this.changed();
    }
  }
  async useExistingAPIKey(): Promise<void> {
    await this.ready;
    if (
      this.busy ||
      this.disposed ||
      !vscode.workspace.isTrusted ||
      vscode.env.remoteName
    )
      return;
    this.busy = true;
    const generation = this.generation,
      abort = new AbortController();
    this.abort = abort;
    const current = () =>
      generation === this.generation &&
      !abort.signal.aborted &&
      !this.disposed &&
      vscode.workspace.isTrusted;
    try {
      const stored = await this.context.secrets.get(IMPORTED_KEY_SECRET);
      let candidate: unknown;
      try {
        candidate = stored ? JSON.parse(stored) : undefined;
      } catch {
        /* Explicit input replaces corrupt storage. */
      }
      let access: string | undefined, secret: string | undefined;
      if (
        candidate &&
        typeof candidate === 'object' &&
        'userId' in candidate &&
        typeof candidate.userId === 'string' &&
        validKey(candidate, candidate.userId)
      ) {
        const choice = await vscode.window.showQuickPick(
          ['Réutiliser la clé enregistrée', 'Utiliser une autre clé'],
          { title: 'Clé API existante' },
        );
        if (!choice || !current()) return;
        if (choice === 'Réutiliser la clé enregistrée') {
          access = candidate.accessKey;
          secret = candidate.secretKey;
        }
      }
      if (!access) {
        access = await vscode.window.showInputBox({
          title: 'Access Key Scaleway',
          password: true,
          ignoreFocusOut: true,
          validateInput: (value) =>
            /^SCW[A-Z0-9]{17}$/.test(value)
              ? undefined
              : 'Access Key Scaleway requis.',
        });
        if (!access || !current()) return;
        secret = await vscode.window.showInputBox({
          title: 'Secret Key Scaleway',
          password: true,
          ignoreFocusOut: true,
          prompt:
            'Stockage sécurisé VS Code uniquement. Une lecture de validation IAM ; aucune création ni inférence.',
          validateInput: (value) =>
            uuid(value) ? undefined : 'Secret Key au format UUID requis.',
        });
      }
      if (!secret || !current()) return;
      const inspected = await inspectExistingUserAPIKey(
        access,
        secret,
        abort.signal,
      );
      if (!current()) return;
      const key: StoredAPIKey = { ...inspected, secretKey: secret };
      await this.write(() =>
        this.context.secrets.store(IMPORTED_KEY_SECRET, JSON.stringify(key)),
      );
      if (!current()) return;
      await this.write(() =>
        this.context.globalState.update(AUTH_CONFIGURATION, {
          mode: 'api-key',
          userId: key.userId,
        }),
      );
      if (!current()) {
        await this.write(() =>
          this.context.globalState.update(AUTH_CONFIGURATION, {
            mode: 'disconnected',
          }),
        );
        return;
      }
      this.dropSession();
      this.imported = true;
      this.keyValidated = true;
      this.apiKey = key;
      this.installSession({
        mode: 'api-key',
        userId: key.userId,
        expiresAt: key.expiresAt,
      });
    } catch (error) {
      const code =
        error instanceof SDKError ? error.code : 'secret_storage_unavailable';
      await vscode.window.showErrorMessage(
        'Scaleway : ' +
          code +
          '. Clé non connectée ; remplacez-la si invalide, ou utilisez la connexion navigateur. Aucune clé créée ni révoquée.',
      );
    } finally {
      this.busy = false;
      if (this.abort === abort) this.abort = undefined;
      this.changed();
    }
    if (this.connected && !this.project) await this.switchProject();
  }
  private async lockKeyBootstrap(userId: string): Promise<() => Promise<void>> {
    if (keyBootstraps.has(userId))
      throw new ReadError('api_key_bootstrap_busy');
    keyBootstraps.add(userId);
    // mkdir is atomic across extension hosts; never expire a lock by elapsed time.
    // A paused host could still complete its POST after a time-based lease expires.
    const root = this.context.globalStorageUri?.fsPath;
    const lock = root
      ? join(root, `api-key-bootstrap-${userId}.lock`)
      : undefined;
    try {
      if (root && lock) {
        await mkdir(root, { recursive: true });
        await mkdir(lock);
      }
    } catch {
      keyBootstraps.delete(userId);
      throw new ReadError('api_key_bootstrap_locked');
    }
    return async () => {
      try {
        if (lock) await rmdir(lock);
      } catch {
        await vscode.window.showWarningMessage(
          'Verrou de connexion non supprimé. Fermez toutes les fenêtres VS Code avant de supprimer le dossier api-key-bootstrap-*.lock dans le stockage global de cette extension.',
        );
      } finally {
        keyBootstraps.delete(userId);
      }
    };
  }
  private async bootstrapKey(
    session: UserSession,
    generation: number,
    abort: AbortController,
  ): Promise<{ key: StoredAPIKey; created: boolean } | undefined> {
    const current = () =>
      generation === this.generation &&
      !abort.signal.aborted &&
      !this.disposed &&
      vscode.workspace.isTrusted &&
      session.expiresAt > Date.now() + 30000;
    const slot = keySecret(session.userId);
    const stored = await this.context.secrets.get(slot);
    if (!current()) return;
    if (stored) {
      let row: unknown;
      try {
        row = JSON.parse(stored);
      } catch {
        throw new ReadError('invalid_saved_api_key');
      }
      if (validKey(row, session.userId)) return { key: row, created: false };
      if (
        row &&
        typeof row === 'object' &&
        'userId' in row &&
        row.userId !== session.userId
      )
        throw new ReadError('invalid_saved_api_key');
      if (row && typeof row === 'object' && 'pending' in row) {
        const resolved = await vscode.window.showWarningMessage(
          'Une tentative de création de clé a un résultat inconnu. Aucun nouvel envoi. Dans la console Scaleway, vérifiez et révoquez les clés « Generated by Scaleway AI Toolkit for VS Code » issues de cette tentative avant de confirmer. Relancez ensuite la connexion.',
          { modal: true },
          'Tentative vérifiée et clés révoquées',
        );
        if (resolved === 'Tentative vérifiée et clés révoquées' && current())
          await this.write(() => this.context.secrets.delete(slot));
        throw new ReadError('api_key_creation_outcome_unknown');
      }
    }
    const consent = await vscode.window.showInformationMessage(
      'Créer une clé API pour Scaleway AI Toolkit, valable 30 jours ? Elle hérite de vos droits IAM (pas limitée au projet sélectionné). SecretStorage uniquement. Une seule tentative ; aucune inférence. Déconnexion locale ne révoque pas la clé distante.',
      { modal: true },
      'Créer la clé API',
    );
    if (consent !== 'Créer la clé API' || !current()) return;
    // Persist BEFORE dispatch: a crash/timeout must never silently retry a possibly successful POST.
    await this.write(() =>
      this.context.secrets.store(
        slot,
        JSON.stringify({ userId: session.userId, pending: true }),
      ),
    );
    if (!current()) {
      await this.write(() => this.context.secrets.delete(slot));
      return;
    }
    let created: StoredAPIKey;
    try {
      created = {
        ...(await createUserAPIKey(
          session.userId,
          session.token,
          abort.signal,
        )),
        userId: session.userId,
      };
    } catch (error) {
      if (
        error instanceof SDKError &&
        ['access_denied', 'rate_limited', 'invalid_request'].includes(
          error.code,
        )
      )
        await this.write(() => this.context.secrets.delete(slot));
      if (
        !(error instanceof SDKError) ||
        !['access_denied', 'rate_limited', 'invalid_request'].includes(
          error.code,
        )
      )
        await vscode.window.showWarningMessage(
          'Résultat de création de clé inconnu. Aucun retry. Vérifiez les clés créées par Scaleway AI Toolkit dans la console ; la prochaine connexion proposera une récupération explicite.',
        );
      throw error;
    }
    if (!current()) {
      await this.cleanupKey(created, session.token, slot);
      return;
    }
    try {
      await this.write(() =>
        this.context.secrets.store(slot, JSON.stringify(created)),
      );
    } catch {
      await this.cleanupKey(created, session.token, slot);
      throw new ReadError('secret_storage_unavailable');
    }
    if (!current()) {
      await this.cleanupKey(created, session.token, slot);
      return;
    }
    return { key: created, created: true };
  }
  private async cleanupKey(
    key: StoredAPIKey,
    token: string,
    slot: string,
  ): Promise<void> {
    try {
      await revokeUserAPIKey(
        key.accessKey,
        token,
        new AbortController().signal,
      );
      await this.write(() => this.context.secrets.delete(slot));
    } catch {
      await vscode.window.showWarningMessage(
        'Clé API potentiellement créée : révocation automatique non confirmée. Vérifiez les clés « Generated by Scaleway AI Toolkit for VS Code » dans la console avant de réessayer.',
      );
    }
  }
  async revokeAPIKey(): Promise<void> {
    await this.ready;
    if (
      !this.session?.token ||
      this.imported ||
      !this.apiKey ||
      this.busy ||
      !vscode.workspace.isTrusted
    )
      return;
    const session = this.session;
    const key = this.apiKey;
    const generation = this.generation;
    const consent = await vscode.window.showInformationMessage(
      'Révoquer la clé API créée par cette extension et se déconnecter ? Cette action est irréversible.',
      { modal: true },
      'Révoquer la clé API',
    );
    if (
      consent !== 'Révoquer la clé API' ||
      this.session !== session ||
      generation !== this.generation ||
      this.busy ||
      !vscode.workspace.isTrusted ||
      session.expiresAt <= Date.now() + 30000
    )
      return;
    this.busy = true;
    const abort = new AbortController();
    this.abort = abort;
    try {
      this.invalidateInference();
      await revokeUserAPIKey(key.accessKey, session.token, abort.signal);
      await this.write(() =>
        this.context.secrets.delete(keySecret(session.userId)),
      );
      if (
        this.apiKey === key &&
        this.session === session &&
        generation === this.generation
      ) {
        this.apiKey = undefined;
        await this.disconnect();
      }
    } catch (error) {
      if (this.session === session && generation === this.generation)
        await this.report(error);
    } finally {
      this.busy = false;
      if (this.abort === abort) this.abort = undefined;
      this.changed();
    }
  }
  private async pickProject(projects: Project[], generation: number) {
    if (!projects.length) {
      await vscode.window.showInformationMessage(
        'Aucun projet accessible dans cette organisation.',
      );
      return;
    }
    const pick = await vscode.window.showQuickPick(
      projects.map((project) => ({
        label: project.name,
        description: project.id,
        project,
      })),
      { title: 'Changer de projet Scaleway' },
    );
    if (!pick || generation !== this.generation) return;
    const userId = this.session?.userId;
    this.token();
    this.invalidateInference();
    this.project = pick.project;
    this.restoreServerlessResources();
    this.changed();
    if (userId)
      await this.write(() =>
        this.context.globalState.update(preferenceKey(userId), {
          organizationId: pick.project.organizationId,
          organizationName: this.metadata?.organizationName,
          project: { ...pick.project },
        }),
      );
  }
  async switchProject(): Promise<void> {
    await this.ready;
    if (!this.connected) {
      this.dropSession();
      return this.login();
    }
    if (this.busy || !vscode.workspace.isTrusted) return;
    if (
      this.session &&
      'mode' in this.session &&
      !this.keyValidated &&
      !(await this.validateImportedKey())
    )
      return;
    this.busy = true;
    try {
      const operation = this.generation;
      const token = this.token();
      const session = this.session;
      if (!session) throw new ReadError('session_expired');
      const userId = session.userId;
      const abort = new AbortController();
      this.abort = abort;
      const organizations = await listOrganizations(
        userId,
        token,
        abort.signal,
      );
      if (
        operation !== this.generation ||
        abort.signal.aborted ||
        !vscode.workspace.isTrusted
      )
        return;
      const available = organizations.filter((org) => !org.locked);
      if (!available.length) {
        await vscode.window.showInformationMessage(
          'Aucune organisation déverrouillée retournée pour cet utilisateur.',
        );
        return;
      }
      const current = this.metadata?.organizationId;
      const pick = await vscode.window.showQuickPick(
        available.map((organization) => ({
          label: organization.name,
          description: organization.id,
          detail:
            organization.id === current ? 'Organisation actuelle' : undefined,
          organization,
        })),
        {
          title: 'Choisir une organisation Scaleway',
          placeHolder: 'Sélectionner une organisation liée à votre utilisateur',
          matchOnDescription: true,
        },
      );
      if (
        !pick ||
        operation !== this.generation ||
        abort.signal.aborted ||
        !vscode.workspace.isTrusted
      )
        return;
      this.token();
      const org = pick.organization;
      this.clear();
      const generation = this.generation;
      const readAbort = new AbortController();
      this.abort = readAbort;
      const projects = await listProjects(org.id, token, readAbort.signal);
      if (
        generation !== this.generation ||
        readAbort.signal.aborted ||
        !vscode.workspace.isTrusted
      )
        return;
      this.token();
      this.metadata = {
        name: 'Utilisateur connecté',
        organizationId: org.id,
        organizationName: org.name,
      };
      await this.pickProject(projects, generation);
    } catch (error) {
      await this.report(error);
    } finally {
      this.busy = false;
      this.changed();
    }
  }
  async createProject(): Promise<boolean> {
    await this.ready;
    if (this.busy || !vscode.workspace.isTrusted || vscode.env.remoteName)
      return false;
    if (!this.connected) await this.login();
    if (!this.connected || this.busy || !vscode.workspace.isTrusted)
      return false;
    const session = this.session;
    if (!session?.token) {
      await vscode.window.showInformationMessage(
        'La création de projet nécessite la connexion navigateur. La clé existante reste conservée.',
      );
      return false;
    }
    this.busy = true;
    const generation = this.generation;
    const abort = new AbortController();
    this.abort = abort;
    const current = () =>
      generation === this.generation &&
      !this.disposed &&
      !abort.signal.aborted &&
      this.session === session &&
      this.connected &&
      vscode.workspace.isTrusted;
    let created: Project | undefined;
    try {
      const organizations = await listOrganizations(
        session.userId,
        this.token(),
        abort.signal,
      );
      if (!current()) return false;
      const pick = await vscode.window.showQuickPick(
        organizations
          .filter((organization) => !organization.locked)
          .map((organization) => ({
            label: organization.name,
            description: organization.id,
            organization,
          })),
        { title: 'Organisation du nouveau projet Scaleway' },
      );
      if (!pick || !current()) return false;
      const name = await vscode.window.showInputBox({
        title: 'Nom du nouveau projet Scaleway',
        prompt:
          'Création d’un projet uniquement ; aucun modèle, GPU ou endpoint créé.',
        validateInput: (value) =>
          text(value)
            ? undefined
            : 'Nom requis, maximum256 caractères, sans contrôles.',
      });
      if (!name || !text(name) || !current()) return false;
      const confirmation = await vscode.window.showInformationMessage(
        `Créer le projet « ${name} » dans « ${pick.organization.name} » (${pick.organization.id}) et en faire le projet par défaut ? Un POST, aucun retry automatique. Aucune autre ressource créée.`,
        { modal: true },
        'Créer ce projet',
      );
      if (confirmation !== 'Créer ce projet' || !current()) return false;
      created = await createProject(
        { organizationId: pick.organization.id, name, confirmed: true },
        session.token,
        abort.signal,
      );
      if (!current()) {
        await vscode.window.showWarningMessage(
          'Le projet peut avoir été créé ; la session a changé. Aucun défaut enregistré, aucune nouvelle tentative.',
        );
        return false;
      }
      const previousPreferences = this.context.globalState.get<unknown>(
        preferenceKey(session.userId),
      );
      // Persist validated success before changing in-memory scope; restore previous preferences
      // if trust/session invalidates during the asynchronous state update (no late resurrection).
      await this.write(async () => {
        if (!current()) return;
        await this.context.globalState.update(preferenceKey(session.userId), {
          organizationId: created?.organizationId,
          organizationName: pick.organization.name,
          project: created,
        });
        if (!current())
          await this.context.globalState.update(
            preferenceKey(session.userId),
            this.session === session ? previousPreferences : undefined,
          );
      });
      if (!current()) return false;
      this.clear();
      this.metadata = {
        name: 'Utilisateur connecté',
        organizationId: created.organizationId,
        organizationName: pick.organization.name,
      };
      this.project = created;
      this.restoreServerlessResources();
      return true;
    } catch (error) {
      if (
        error instanceof ReadError &&
        error.code === 'creation_outcome_unknown'
      ) {
        await vscode.window.showWarningMessage(
          'Résultat de création inconnu : le projet peut exister. Aucun retry et ancien défaut conservé. Utilisez Changer de projet pour relire la liste avant toute nouvelle tentative.',
        );
      } else if (created) {
        await vscode.window.showWarningMessage(
          'Projet créé mais préférence locale non enregistrée. Ancien défaut conservé ; sélectionnez le projet existant, ne relancez pas la création.',
        );
      } else if (current()) await this.report(error);
      return false;
    } finally {
      this.busy = false;
      if (this.abort === abort) this.abort = undefined;
      this.changed();
    }
  }
  private publicAbort: AbortController | undefined;
  private publicPending: Promise<void> | undefined;
  async loadPublicCatalog(): Promise<void> {
    if (this.publicPending) return this.publicPending;
    if (!vscode.workspace.isTrusted) {
      this.serverlessState =
        'Workspace non approuvé · approuvez cet espace pour charger les offres';
      this.changed();
      return;
    }
    const abort = new AbortController();
    this.publicAbort = abort;
    this.publicPending = (async () => {
      this.serverlessState = 'Chargement…';
      this.changed();
      try {
        const rows = await listServerless('', abort.signal);
        if (
          !abort.signal.aborted &&
          !this.disposed &&
          vscode.workspace.isTrusted
        ) {
          this.serverless = rows;
          // Refresh ephemeral capabilities/prices without persisting provider config or secrets.
          this.serverlessResources = this.serverlessResources.map(
            (resource) => ({
              ...resource,
              ...rows.find((model) => model.id === resource.id),
            }),
          );
          this.serverlessState = rows.length
            ? 'Offres publiques · accès inférence non vérifié'
            : 'Aucune offre retournée';
        }
      } catch (error) {
        if (!abort.signal.aborted && !this.disposed)
          this.serverlessState =
            'Erreur · ' +
            (error instanceof ReadError ? error.code : 'local_error');
      } finally {
        this.changed();
      }
    })();
    try {
      await this.publicPending;
    } finally {
      this.publicPending = undefined;
    }
  }
  async loadCatalogs(): Promise<void> {
    // Public catalog must not wait on SecretStorage/login/project/dedicated failures.
    await this.loadPublicCatalog();
    await this.ready;
    if (
      this.busy ||
      !vscode.workspace.isTrusted ||
      !this.connected ||
      !this.project
    ) {
      this.dedicatedCatalogState = this.busy
        ? 'Opération de compte en cours'
        : 'Sélectionnez un projet pour le catalogue dédié';
      this.changed();
      return;
    }
    if (
      this.session &&
      'mode' in this.session &&
      !this.keyValidated &&
      !(await this.validateImportedKey())
    )
      return;
    this.busy = true;
    const operation = this.generation;
    const abort = new AbortController();
    this.abort = abort;
    try {
      this.dedicatedCatalog = [];
      this.dedicatedCatalogState = 'Chargement…';
      this.changed();
      const rows = await listDedicatedCatalog(
        this.project,
        this.token(),
        abort.signal,
      );
      if (operation === this.generation && !abort.signal.aborted) {
        this.dedicatedCatalog = rows;
        this.dedicatedCatalogState = rows.length
          ? 'Modèles à déployer · fr-par'
          : 'Aucun modèle retourné';
      }
    } catch (error) {
      if (operation === this.generation)
        this.dedicatedCatalogState =
          'Erreur · ' +
          (error instanceof ReadError ? error.code : 'local_error');
    } finally {
      this.busy = false;
      this.changed();
    }
  }
  async loadModels(silent = false): Promise<void> {
    await this.ready;
    if (!this.session || !this.project) {
      if (!silent) await this.switchProject();
      return;
    }
    if (this.busy || !vscode.workspace.isTrusted) return;
    if (
      this.session &&
      'mode' in this.session &&
      !this.keyValidated &&
      !(await this.validateImportedKey(silent))
    )
      return;
    this.busy = true;
    try {
      const operation = this.generation;
      this.token();
      // The Models action requests bounded read-only discovery; no redundant modal.
      const token = this.token();
      const project = this.project;
      if (!project) return;
      const abort = new AbortController();
      this.abort = abort;
      this.dedicatedState = 'Chargement…';
      this.changed();
      const rows = await listDedicated(project, token, abort.signal);
      if (
        operation !== this.generation ||
        abort.signal.aborted ||
        !vscode.workspace.isTrusted
      )
        return;
      this.token();
      this.dedicated = rows;
      this.dedicatedState = rows.length
        ? 'fr-par · projet sélectionné'
        : 'Aucun déploiement';
    } catch (error) {
      this.dedicatedState = 'Erreur · non vérifié';
      if (!silent) await this.report(error);
    } finally {
      this.busy = false;
      this.changed();
    }
  }
  /** Host-only identity/credentials for access configuration. Agent bearer remains separate. */
  private accessScope(
    scope: ReturnType<Connection['inferenceScope']>,
  ): LlmAccessScope {
    const userId = this.session?.userId;
    const session = this.session;
    if (!userId || !session) throw new ReadError('invalid_scope');
    return {
      ...scope,
      userId,
      controlCredential: () => {
        if (!scope.current()) throw new ReadError('invalid_scope');
        return session.token ?? scope.authorize();
      },
      reuseCredential: () => {
        scope.authorize();
        if (!this.apiKey || !scope.current())
          throw new ReadError('api_key_required');
        return {
          accessKey: this.apiKey.accessKey,
          secretKey: this.apiKey.secretKey,
        };
      },
    };
  }
  /** Organization IAM inventory. No Serverless model reads or inferred rights. */
  async refreshAPIKeys(silent = false): Promise<void> {
    if (!(await this.ensureProject(silent))) return;
    const scope = this.inferenceScope();
    const epoch = ++this.apiKeysEpoch;
    const key = JSON.stringify(scope.project);
    if (this.apiKeysScope !== key) this.apiKeys = [];
    this.apiKeysScope = key;
    this.apiKeysState = 'Chargement…';
    this.changed();
    try {
      const rows = await this.llmAccess.inventory(this.accessScope(scope));
      if (!scope.current() || epoch !== this.apiKeysEpoch) return;
      this.apiKeys = rows;
      this.apiKeysState = rows.length
        ? 'Inventaire IAM · organisation sélectionnée'
        : 'Aucune clé visible dans IAM';
    } catch (error) {
      if (scope.current() && epoch === this.apiKeysEpoch) {
        this.apiKeys = [];
        this.apiKeysState =
          'Erreur · inventaire IAM non vérifié · ' +
          inventoryFailureReason(error);
      }
    } finally {
      const current = scope.current() && epoch === this.apiKeysEpoch;
      scope.dispose();
      if (current) this.changed();
    }
  }
  invalidateAPIKeys(): void {
    this.apiKeysEpoch++;
    this.apiKeys = [];
    this.apiKeysScope = '';
    this.apiKeysState = 'À actualiser · stockage sécurisé modifié';
    this.changed();
  }
  async configureAPIKey(id?: string): Promise<boolean> {
    if (id !== undefined && !/^[a-f0-9]{32}$/.test(id)) return false;
    if (!(await this.ensureProject())) return false;
    if (
      id &&
      (this.apiKeysScope !== JSON.stringify(this.project) ||
        !this.apiKeys.some((k) => k.id === id))
    )
      return false;
    const scope = this.inferenceScope();
    let configured = false;
    try {
      configured = await this.llmAccess.configureKey(
        this.accessScope(scope),
        id,
      );
      if (!scope.current()) return false;
    } finally {
      scope.dispose();
    }
    if (configured) await this.refreshAPIKeys();
    return configured;
  }
  /** Explicit native-only disclosure. Never forward native/storage diagnostics. */
  async revealAPIKey(id: string): Promise<void> {
    if (
      !/^[a-f0-9]{32}$/.test(id) ||
      !this.connected ||
      !vscode.workspace.isTrusted ||
      !this.project ||
      this.apiKeysScope !== JSON.stringify(this.project) ||
      !this.apiKeys.some((key) => key.id === id && key.secretAvailable)
    )
      return;
    let scope: ReturnType<Connection['inferenceScope']> | undefined;
    const epoch = this.apiKeysEpoch;
    try {
      scope = this.inferenceScope();
      const local = await this.llmAccess.revealLocal(
        this.accessScope(scope),
        id,
      );
      const confirmed = await vscode.window.showWarningMessage(
        'Afficher la clé API complète et son secret en clair ?',
        {
          modal: true,
          detail:
            'Affichage natif uniquement. Évitez le partage d’écran et les captures. Aucun secret récupéré depuis IAM, copié ou enregistré ailleurs.',
        },
        'Afficher les credentials',
      );
      if (
        confirmed !== 'Afficher les credentials' ||
        !scope.current() ||
        epoch !== this.apiKeysEpoch ||
        !local.current() ||
        this.apiKeysScope !== JSON.stringify(this.project) ||
        !this.apiKeys.some((key) => key.id === id && key.secretAvailable)
      )
        return;
      const latest = await this.llmAccess.revealLocal(
        this.accessScope(scope),
        id,
      );
      if (!local.current() || !latest.current() || epoch !== this.apiKeysEpoch)
        return;
      const pair = latest.credentials();
      await vscode.window.showInformationMessage(
        'Credentials de la clé API locale',
        {
          modal: true,
          detail:
            'Access key : ' +
            pair.accessKey +
            String.fromCharCode(10) +
            'Secret key : ' +
            pair.secretKey,
        },
      );
    } catch {
      try {
        await vscode.window.showWarningMessage(
          'Affichage refusé ou indisponible. Actualisez les clés API.',
        );
      } catch {
        /* no diagnostics */
      }
    } finally {
      scope?.dispose();
    }
  }
  async useAPIKey(id: string): Promise<ListedModel | undefined> {
    if (!/^[a-f0-9]{32}$/.test(id) || !(await this.ensureProject())) return;
    const key = this.apiKeys.find((k) => k.id === id);
    if (
      !key?.secretAvailable ||
      key.expiresAt <= Date.now() + 30000 ||
      this.apiKeysScope !== JSON.stringify(this.project)
    )
      return;
    const scope = this.inferenceScope();
    try {
      if (!this.serverless.length) await this.loadPublicCatalog();
      if (!scope.current()) return;
      const choices = this.serverless.map((model) => ({
        label: model.label,
        description: model.id,
        model,
      }));
      const selected = await vscode.window.showQuickPick(choices, {
        title: 'Choisir un modèle Serverless',
        placeHolder:
          'La clé est réutilisable ; aucun appel modèle à cette étape',
        ignoreFocusOut: true,
      });
      if (!selected || !choices.includes(selected) || !scope.current()) return;
      const configured = await this.llmAccess.configure(
        selected.model,
        this.accessScope(scope),
        id,
      );
      if (!configured || !scope.current()) return;
      this.serverlessResources = this.llmAccess.rows(this.accessScope(scope));
      this.changed();
      return configured;
    } finally {
      scope.dispose();
    }
  }
  async refreshServerlessAvailability(silent = false): Promise<void> {
    if (!(await this.ensureProject(silent))) return;
    const scope = this.inferenceScope();
    // Unverified records are never shown as active while a refresh is pending.
    this.serverlessResources = [];
    this.changed();
    try {
      const rows = await this.llmAccess.refresh(
        this.accessScope(scope),
        this.serverless,
      );
      if (scope.current()) this.serverlessResources = rows;
    } finally {
      scope.dispose();
      this.changed();
    }
  }
  private restoreServerlessResources(): void {
    // Legacy workspace favourites have no IAM/secret binding: no automatic migration.
    this.serverlessResources = [];
    this.llmAccess.clear();
  }
  private serverlessUsePending = false;
  async useServerless(id: string): Promise<ListedModel | undefined> {
    if (!text(id) || this.serverlessUsePending) return;
    this.serverlessUsePending = true;
    let scope: ReturnType<Connection['inferenceScope']> | undefined;
    try {
      const offered = this.serverless.find((model) => model.id === id);
      if (!(await this.ensureProject())) return;
      const row = this.serverless.find((model) => model.id === id) ?? offered;
      if (row?.kind !== 'serverless') return;
      scope = this.inferenceScope();
      const accessScope = this.accessScope(scope);
      const configured = await this.llmAccess.configure(row, accessScope);
      if (!configured || !scope.current()) return;
      this.serverlessResources = this.llmAccess.rows(accessScope);
      this.changed();
      return configured;
    } finally {
      scope?.dispose();
      this.serverlessUsePending = false;
    }
  }
  /** Resolve and revalidate the selected access key, never silently use the login key. */
  async modelCredentialScope(
    projectId: string,
    model: ListedModel,
    preferredKeyId?: string,
  ) {
    const scope = this.inferenceScope();
    try {
      if (scope.project.id !== projectId) throw new ReadError('invalid_scope');
      if (
        preferredKeyId !== undefined &&
        (!/^[a-f0-9]{32}$/.test(preferredKeyId) ||
          this.apiKeysScope !== JSON.stringify(this.project) ||
          !this.apiKeys.some(
            (key) =>
              key.id === preferredKeyId &&
              key.secretAvailable &&
              key.expiresAt > Date.now() + 30000,
          ))
      )
        throw new ReadError('invalid_scope');
      if (model.kind !== 'serverless' && preferredKeyId !== undefined) {
        const credential = await this.llmAccess.keyCredential(
          this.accessScope(scope),
          preferredKeyId,
        );
        return { ...credential, dispose: scope.dispose };
      }
      if (model.kind !== 'serverless')
        return {
          current: scope.current,
          secretKey: scope.authorize,
          dispose: scope.dispose,
        };
      const accessScope = this.accessScope(scope);
      const selected =
        preferredKeyId !== undefined
          ? await this.llmAccess.configure(model, accessScope, preferredKeyId)
          : model.llmAccess
            ? model
            : await this.llmAccess.configure(model, accessScope);
      if (!selected || !scope.current()) throw new ReadError('invalid_scope');
      const credential = await this.llmAccess.credential(accessScope, selected);
      return { ...credential, dispose: scope.dispose };
    } catch (error) {
      scope.dispose();
      if (model.kind === 'serverless') {
        this.serverlessResources = this.serverlessResources.filter(
          (r) => r.llmAccess?.id !== model.llmAccess?.id,
        );
        this.changed();
      }
      throw error;
    }
  }
  async modelInferenceScope(model: ListedModel) {
    const scope = this.inferenceScope();
    try {
      if (model.kind !== 'serverless') return scope;
      const credential = await this.llmAccess.credential(
        this.accessScope(scope),
        model,
      );
      return {
        ...scope,
        current: credential.current,
        authorize: credential.secretKey,
      };
    } catch (error) {
      scope.dispose();
      throw error;
    }
  }
  async deployModel(id: string): Promise<ListedModel | undefined> {
    if (!uuid(id) || !(await this.ensureProject())) return;
    // Refresh resource inventory before deciding whether another allocation is needed.
    await this.loadModels();
    if (!this.connected || this.dedicatedState.startsWith('Erreur')) {
      await vscode.window.showWarningMessage(
        'Impossible de vérifier les services existants. Actualisez Mes ressources avant de déployer pour éviter une allocation en double.',
      );
      return;
    }
    const existing = this.dedicated.find(
      (row) => row.deploymentInfo?.modelId === id && row.status !== 'deleted',
    );
    if (existing) return existing;
    if (!this.dedicatedCatalog.some((row) => row.id === id))
      await this.loadCatalogs();
    const model = this.dedicatedCatalog.find((row) => row.id === id);
    const project = this.project;
    const session = this.session;
    if (!model || !project || !session || this.busy || !this.connected) return;
    const generation = this.generation;
    const abort = new AbortController();
    this.abort = abort;
    this.busy = true;
    const current = () =>
      generation === this.generation &&
      this.project === project &&
      this.session === session &&
      this.connected &&
      !this.disposed &&
      !abort.signal.aborted &&
      vscode.workspace.isTrusted;
    let release: (() => Promise<void>) | undefined;
    let operation: DeploymentOperation | undefined;
    let accepted: ListedModel | undefined;
    try {
      const journal = this.journal();
      // Shared local lock also serializes paid creation across extension windows.
      release = await this.lockKeyBootstrap(project.id);
      if (!current()) return;
      // Re-read under the shared allocation lock; another window may have allocated while we waited.
      const inventory = await listDedicated(
        project,
        this.token(),
        abort.signal,
      );
      if (!current()) return;
      this.dedicated = inventory;
      const deployed = inventory.find(
        (row) => row.deploymentInfo?.modelId === id && row.status !== 'deleted',
      );
      if (deployed) return deployed;
      const marker = this.context.globalStorageUri?.fsPath
        ? join(
            this.context.globalStorageUri.fsPath,
            `allocation-${project.id}-${id}.json`,
          )
        : undefined;
      if (marker) {
        let saved: DeploymentOperation | undefined;
        try {
          saved = JSON.parse(await readFile(marker, 'utf8'));
        } catch (error) {
          if (
            !(
              error &&
              typeof error === 'object' &&
              'code' in error &&
              error.code === 'ENOENT'
            )
          )
            throw new ReadError('invalid_operation_journal');
        }
        if (
          saved &&
          (!uuid(saved.id) ||
            saved.projectId !== project.id ||
            saved.organizationId !== project.organizationId ||
            saved.modelId !== id ||
            saved.region !== 'fr-par' ||
            !text(saved.name) ||
            ![
              'prepared',
              'submitting',
              'accepted',
              'unknown',
              'rejected',
            ].includes(saved.status) ||
            (saved.status === 'accepted' && !uuid(saved.deploymentId)))
        )
          throw new ReadError('invalid_operation_journal');
        if (
          saved &&
          saved.projectId === project.id &&
          saved.modelId === id &&
          ['unknown', 'submitting', 'accepted'].includes(saved.status)
        ) {
          if (saved.status === 'accepted' && saved.deploymentId) {
            const resource = await getDeployment(
              project,
              saved.deploymentId,
              this.token(),
              abort.signal,
            );
            if (!current()) return;
            if (resource.status !== 'deleted') {
              this.dedicated = [
                ...inventory.filter((row) => row.id !== resource.id),
                resource,
              ];
              return resource;
            }
          } else {
            const resolved = await vscode.window.showWarningMessage(
              'Résultat de création inconnu. Vérifiez et supprimez dans la console tout service issu de cette opération avant de confirmer. Aucun nouvel envoi sur ce clic.',
              { modal: true },
              'Services vérifiés et supprimés',
            );
            if (resolved !== 'Services vérifiés et supprimés' || !current())
              return;
          }
          await writeFile(
            marker,
            JSON.stringify({
              ...saved,
              status: 'rejected',
              deploymentId: undefined,
            }),
            { mode: 0o600 },
          );
          // Existing per-host journals remain conservative; a new name allows an explicitly new reviewed operation.
          await vscode.window.showInformationMessage(
            'Opération résolue. Relancez Déployer avec un nouveau nom de service.',
          );
          return;
        }
      }
      const nodes = await listNodeTypes(this.token(), abort.signal);
      if (!current()) return;
      const prices = await listDedicatedPrices(abort.signal);
      if (!current()) return;
      const eula =
        model.dedicatedInfo?.hasEula === true
          ? await getModelEula(project, model, this.token(), abort.signal)
          : undefined;
      if (!current()) return;
      const receipt = await reviewService(
        project,
        model,
        nodes,
        prices,
        eula,
        current,
      );
      if (!receipt || !current()) return;
      const prior = await journal.recover();
      let resolvedMarker = false;
      if (marker) {
        try {
          resolvedMarker =
            JSON.parse(await readFile(marker, 'utf8')).status === 'rejected';
        } catch {
          /* no previous operation */
        }
      }
      if (
        prior.some(
          (row) =>
            !resolvedMarker &&
            row.modelId === id &&
            ['unknown', 'submitting', 'accepted'].includes(row.status),
        )
      ) {
        await vscode.window.showWarningMessage(
          'Une opération existe pour ce modèle. Actualisez les ressources ou consultez son historique avant toute nouvelle création ; aucun retry automatique.',
        );
        return;
      }
      operation = {
        version: 1,
        id: randomUUID(),
        projectId: project.id,
        organizationId: project.organizationId,
        modelId: id,
        name: receipt.body.name,
        region: 'fr-par',
        status: 'prepared',
      };
      await journal.save(operation);
      if (!current()) return;
      operation = { ...operation, status: 'submitting' };
      await journal.save(operation);
      if (marker)
        await writeFile(marker, JSON.stringify(operation), { mode: 0o600 });
      if (!current()) {
        await journal.save({ ...operation, status: 'prepared' });
        return;
      }
      try {
        accepted = await createService(receipt, this.token(), abort.signal);
      } catch (error) {
        const rejected =
          error instanceof ReadError &&
          [
            'access_denied',
            'creation_rejected',
            'rate_limited',
            'deployment_confirmation_required',
            'invalid_approval',
            'invalid_request',
            'invalid_scope',
            'cancelled',
          ].includes(error.code);
        const result: DeploymentOperation = {
          ...operation,
          status: rejected ? 'rejected' : 'unknown',
        };
        if (marker)
          await writeFile(marker, JSON.stringify(result), { mode: 0o600 });
        await journal.save(result);
        if (current())
          await vscode.window.showWarningMessage(
            rejected
              ? 'Déploiement refusé. Vérifiez la configuration et vos droits dans les détails.'
              : 'Résultat du déploiement inconnu : le service peut exister. Actualisez Mes ressources avant toute nouvelle tentative.',
          );
        return;
      }
      const result: DeploymentOperation = {
        ...operation,
        status: 'accepted',
        deploymentId: accepted.id,
      };
      if (marker)
        await writeFile(marker, JSON.stringify(result), { mode: 0o600 });
      await journal.save(result);
      if (!current()) return;
      this.dedicated = [
        ...this.dedicated.filter((row) => row.id !== accepted?.id),
        accepted,
      ];
      this.dedicatedState = 'Déploiement accepté';
      this.changed();
    } catch (error) {
      if (accepted)
        await vscode.window.showWarningMessage(
          'Service accepté mais journal local non enregistré. Actualisez Mes ressources ; ne recréez pas le service.',
        );
      else if (current()) await this.report(error);
    } finally {
      await release?.();
      this.busy = false;
      if (this.abort === abort) this.abort = undefined;
      this.changed();
    }
    if (accepted && current()) {
      await this.followDeployment(accepted.id);
      return this.dedicated.find((row) => row.id === accepted?.id) ?? accepted;
    }
    return;
  }
  private journal(): DeploymentJournal {
    const session = this.session;
    const project = this.project;
    if (
      !session ||
      !project ||
      !this.connected ||
      this.disposed ||
      !vscode.workspace.isTrusted
    )
      throw new ReadError('invalid_scope');
    const cached = this.operationJournal;
    if (
      !cached ||
      cached.userId !== session.userId ||
      cached.project !== project
    )
      this.operationJournal = {
        userId: session.userId,
        project,
        journal: new DeploymentJournal(
          this.context.globalState,
          session.userId,
          project,
        ),
      };
    if (!this.operationJournal) throw new ReadError('invalid_scope');
    return this.operationJournal.journal;
  }
  /** Explicit local read only: never logs in, refreshes resources or sends HTTP. */
  async deploymentOperations(): Promise<DeploymentOperation[] | undefined> {
    await this.ready;
    if (
      !this.connected ||
      !this.project ||
      this.disposed ||
      !vscode.workspace.isTrusted
    )
      return;
    const session = this.session;
    const project = this.project;
    const generation = this.generation;
    try {
      const rows = await this.journal().recover();
      if (
        generation !== this.generation ||
        this.session !== session ||
        this.project !== project ||
        !this.connected ||
        this.disposed ||
        !vscode.workspace.isTrusted
      )
        return;
      return rows;
    } catch (error) {
      if (generation === this.generation) await this.report(error);
      return;
    }
  }
  /** One exact control-plane GET, only for an accepted ID from this scoped journal. */
  async reconcileDeploymentOperation(
    operationId: string,
  ): Promise<ListedModel | undefined> {
    if (!uuid(operationId)) return;
    await this.ready;
    const scopeProject = this.project;
    const scopeSession = this.session;
    const scopeGeneration = this.generation;
    const rows = await this.deploymentOperations();
    if (
      scopeProject !== this.project ||
      scopeSession !== this.session ||
      scopeGeneration !== this.generation
    )
      return;
    const operation = rows?.find((row) => row.id === operationId);
    if (
      operation?.status !== 'accepted' ||
      !operation.deploymentId ||
      this.busy
    )
      return;
    const project = this.project;
    const session = this.session;
    const generation = this.generation;
    if (!project || !session) return;
    this.busy = true;
    const abort = new AbortController();
    this.abort = abort;
    const current = () =>
      generation === this.generation &&
      this.session === session &&
      this.project === project &&
      !this.disposed &&
      !abort.signal.aborted &&
      this.connected &&
      vscode.workspace.isTrusted;
    try {
      const row = await getDeployment(
        project,
        operation.deploymentId,
        this.token(),
        abort.signal,
      );
      if (!current()) return;
      if (
        row.deploymentInfo?.modelId !== operation.modelId ||
        row.label !== operation.name
      )
        throw new ReadError('foreign_or_invalid_scope');
      this.dedicated = [
        ...this.dedicated.filter((old) => old.id !== row.id),
        row,
      ];
      this.dedicatedState =
        'Ressource retrouvée par son ID · endpoint et inférence non vérifiés';
      return row;
    } catch (error) {
      if (current()) await this.report(error);
      return;
    } finally {
      this.busy = false;
      if (this.abort === abort) this.abort = undefined;
      this.changed();
    }
  }
  async deploymentDetails(id: string): Promise<ListedModel | undefined> {
    if (!uuid(id) || !(await this.ensureProject())) return;
    const project = this.project;
    if (!project || !this.dedicated.some((row) => row.id === id)) return;
    this.busy = true;
    const generation = this.generation;
    const abort = new AbortController();
    this.abort = abort;
    try {
      const row = await getDeployment(project, id, this.token(), abort.signal);
      if (
        generation !== this.generation ||
        abort.signal.aborted ||
        !this.connected ||
        !vscode.workspace.isTrusted ||
        this.disposed
      )
        return;
      this.dedicated = this.dedicated.map((previous) =>
        previous.id === id ? row : previous,
      );
      return row;
    } catch (error) {
      if (generation === this.generation) await this.report(error);
      return;
    } finally {
      this.busy = false;
      if (this.abort === abort) this.abort = undefined;
      this.changed();
    }
  }
  get followingDeployment(): boolean {
    return !!this.followAbort;
  }
  cancelFollowDeployment(): void {
    this.followAbort?.abort();
  }
  private followAbort: AbortController | undefined;
  async followDeployment(id?: string): Promise<void> {
    if (id !== undefined && !uuid(id)) return;
    if (!(await this.ensureProject())) return;
    const project = this.project;
    if (!project) return;
    let selectedId = id;
    if (!selectedId) {
      const pick = await vscode.window.showQuickPick(
        this.dedicated.map((row) => ({
          label: row.label,
          description: row.status,
          id: row.id,
        })),
        {
          title: 'Suivre un déploiement existant',
          placeHolder:
            '5 lectures maximum, 15 secondes entre lectures ; aucun endpoint sondé',
        },
      );
      selectedId = pick?.id;
    }
    if (
      !selectedId ||
      this.project !== project ||
      this.busy ||
      !this.dedicated.some((row) => row.id === selectedId) ||
      !this.connected ||
      !vscode.workspace.isTrusted
    )
      return;
    this.busy = true;
    const generation = this.generation;
    const abort = new AbortController();
    this.abort = abort;
    this.followAbort = abort;
    const current = () =>
      generation === this.generation &&
      !this.disposed &&
      this.connected &&
      vscode.workspace.isTrusted &&
      this.project === project;
    try {
      this.dedicatedState =
        'Suivi en cours · 5 GET maximum · arrêter via Construire';
      this.changed();
      const result = await followDeployment(
        project,
        selectedId,
        abort.signal,
        async (scope, resourceId, signal) => {
          if (!current()) {
            abort.abort();
            throw new ReadError('cancelled');
          }
          return getDeployment(scope, resourceId, this.token(), signal);
        },
        (row) => {
          if (current()) {
            this.dedicated = this.dedicated.map((old) =>
              old.id === row.id ? row : old,
            );
            this.changed();
          }
        },
      );
      if (current())
        this.dedicatedState =
          result.state === 'ready'
            ? 'Déploiement ready · endpoint non sondé, inférence non vérifiée'
            : result.state === 'pending'
              ? 'Encore en cours · limite de suivi atteinte ; actualisez pour reprendre'
              : result.state === 'cancelled'
                ? 'Suivi arrêté · aucune ressource annulée/supprimée'
                : `État : ${result.state} · voir les détails`;
    } catch (error) {
      if (current()) {
        this.dedicatedState =
          'Suivi en erreur · dernier état conservé, potentiellement périmé';
        if (error instanceof ReadError && error.code === 'access_denied')
          this.dropSession();
      }
    } finally {
      this.busy = false;
      if (this.abort === abort) this.abort = undefined;
      if (this.followAbort === abort) this.followAbort = undefined;
      this.changed();
    }
  }
  async inspectModelEula(modelId?: string): Promise<ModelEula | undefined> {
    if (modelId !== undefined && !uuid(modelId)) return;
    if (!(await this.ensureProject())) return;
    const project = this.project;
    const session = this.session;
    const generation = this.generation;
    if (!project || !session || this.busy || this.disposed) return;
    const current = () =>
      this.project === project &&
      this.session === session &&
      generation === this.generation &&
      this.connected &&
      !this.disposed &&
      vscode.workspace.isTrusted;
    let model = this.dedicatedCatalog.find((row) => row.id === modelId);
    if (modelId === undefined) {
      const pick = await vscode.window.showQuickPick(
        this.dedicatedCatalog
          .filter((row) => row.dedicatedInfo?.hasEula === true)
          .map((row) => ({
            label: row.label,
            description: row.id,
            model: row,
          })),
        {
          title: 'Lire l’EULA du modèle',
          placeHolder: 'Lecture seulement, aucune acceptation de licence',
        },
      );
      model = pick?.model;
    }
    if (!current() || this.busy || model?.dedicatedInfo?.hasEula !== true)
      return;
    const abort = new AbortController();
    this.abort = abort;
    this.busy = true;
    try {
      const result = await getModelEula(
        project,
        model,
        this.token(),
        abort.signal,
      );
      if (!current() || abort.signal.aborted) return;
      return result;
    } catch (error) {
      if (current() && !abort.signal.aborted) await this.report(error);
      return;
    } finally {
      this.busy = false;
      if (this.abort === abort) this.abort = undefined;
      this.changed();
    }
  }
  async inspectQuotas(): Promise<QuotaSnapshot | undefined> {
    if (!(await this.ensureProject())) return;
    const project = this.project;
    const session = this.session;
    if (!project || !session || this.disposed || this.busy) return;
    const generation = this.generation;
    const abort = new AbortController();
    this.abort = abort;
    this.busy = true;
    const current = () =>
      generation === this.generation &&
      this.project === project &&
      this.session === session &&
      !this.disposed &&
      !abort.signal.aborted &&
      this.connected &&
      vscode.workspace.isTrusted;
    try {
      const snapshot = await listQuotaEvidence(
        project.organizationId,
        this.token(),
        abort.signal,
      );
      if (!current()) return;
      return snapshot;
    } catch (error) {
      if (current()) await this.report(error);
      return;
    } finally {
      this.busy = false;
      if (this.abort === abort) this.abort = undefined;
      this.changed();
    }
  }
  async prepareDeployment(modelId?: string): Promise<boolean> {
    if (modelId !== undefined && !uuid(modelId)) return false;
    if (!(await this.ensureProject())) return false;
    const project = this.project;
    if (!project) return false;
    this.busy = true;
    const generation = this.generation;
    const abort = new AbortController();
    this.abort = abort;
    const current = () =>
      !this.disposed &&
      !abort.signal.aborted &&
      generation === this.generation &&
      this.project === project &&
      this.connected &&
      vscode.workspace.isTrusted;
    try {
      const models = await listDedicatedCatalog(
        project,
        this.token(),
        abort.signal,
      );
      if (!current()) return false;
      this.dedicatedCatalog = models;
      this.dedicatedCatalogState = 'Modèles à déployer · fr-par';
      this.changed();
      let model = modelId
        ? models.find((row) => row.id === modelId)
        : undefined;
      if (!modelId) {
        const pick = await vscode.window.showQuickPick(
          models
            .filter((row) => row.dedicatedInfo?.status === 'ready')
            .map((row) => ({
              label: row.label,
              description: row.id,
              model: row,
            })),
          {
            title: 'Choisir le modèle dédié à préparer',
            placeHolder: 'Modèles ready · aucun déploiement créé',
          },
        );
        model = pick?.model;
      }
      if (!current() || !model) return false;
      const nodes = await listNodeTypes(this.token(), abort.signal);
      if (!current()) return false;
      let prices: DedicatedPriceObservation[] = [];
      try {
        prices = await listDedicatedPrices(abort.signal);
      } catch {
        /* Price unavailability is not a verified tariff. */
      }
      if (!current()) return false;
      return await deploymentWizard(project, model, nodes, current, prices);
    } catch (error) {
      if (current()) await this.report(error);
      return false;
    } finally {
      this.busy = false;
      if (this.abort === abort) this.abort = undefined;
      this.changed();
    }
  }
  async disconnect(): Promise<void> {
    const userId = this.session?.userId;
    const hadKey = !!this.apiKey;
    const imported = this.imported;
    this.dropSession();
    await this.write(() =>
      this.context.globalState.update(AUTH_CONFIGURATION, {
        mode: 'disconnected',
      }),
    );
    if (imported) {
      await this.storage;
      return;
    }
    await this.storage;
    if (userId)
      await this.write(() => this.context.secrets.delete(keySecret(userId)));
    if (userId)
      await this.write(() =>
        this.context.globalState.update(preferenceKey(userId), undefined),
      );
    await this.context.secrets.delete('scalewayAI.apiKey.v1');
    await this.context.globalState.update('scalewayAI.connection', undefined);
    if (hadKey)
      await vscode.window.showWarningMessage(
        'Déconnexion locale : la clé distante reste active jusqu’à expiration (30 jours). Révoquez-la dans la console Scaleway si nécessaire. Pour supprimer la clé avant déconnexion, utilisez Révoquer la clé API.',
      );
  }
  dispose() {
    // Shutdown clears memory only. Expiry removes JWT but preserves the key for renewed login.
    this.disposed = true;
    this.publicAbort?.abort();
    clearTimeout(this.expiry);
    this.expiry = undefined;
    this.session = undefined;
    this.apiKey = undefined;
    this.metadata = undefined;
    this.clear();
    this.llmAccess.dispose();
  }
}
