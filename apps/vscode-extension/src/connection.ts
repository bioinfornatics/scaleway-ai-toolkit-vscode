import { Buffer } from 'node:buffer';
import * as vscode from 'vscode';
import { browserLogin, parseSession, type UserSession } from './browserLogin';
import { deploymentWizard } from './deploymentWizard';
import {
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

interface Metadata {
  name: string;
  organizationId: string;
  organizationName?: string;
}
const SESSION_SECRET = 'scalewayAI.userSession.v1';
const preferenceKey = (userId: string) => `scalewayAI.preferences.v1.${userId}`;
export class Connection implements vscode.Disposable {
  metadata: Metadata | undefined;
  project: Project | undefined;
  serverless: ListedModel[] = [];
  dedicated: ListedModel[] = [];
  dedicatedCatalog: ListedModel[] = [];
  serverlessState = 'Non chargé · catalogue public';
  dedicatedState = 'Non chargés';
  dedicatedCatalogState = 'Non chargé';
  busy = false;
  private session: UserSession | undefined;
  private generation = 0;
  private abort: AbortController | undefined;
  private expiry: ReturnType<typeof setTimeout> | undefined;
  private storage: Promise<void> = Promise.resolve();
  private disposed = false;
  readonly ready: Promise<void>;
  constructor(
    private context: vscode.ExtensionContext,
    private changed: () => void,
  ) {
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
      this.installSession(session);
    } catch {
      if (generation === this.generation && !this.disposed) {
        this.dropSession();
      }
    }
  }
  private installSession(session: UserSession) {
    this.session = session;
    this.metadata = { name: 'Utilisateur connecté', organizationId: '' };
    const saved = this.context.globalState.get<{
      organizationId: unknown;
      organizationName?: string;
      project?: Project;
    }>(preferenceKey(session.userId));
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
    clearTimeout(this.expiry);
    const expire = () => {
      if (this.session !== session || this.disposed) return;
      if (session.expiresAt <= Date.now() + 30000) this.dropSession();
      else
        this.expiry = setTimeout(
          expire,
          Math.min(session.expiresAt - Date.now() - 30000, 2147483647),
        );
    };
    expire();
    this.changed();
  }
  private clear() {
    this.generation++;
    this.abort?.abort();
    this.abort = undefined;
    this.project = undefined;
    this.serverless = [];
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
    if (!this.session || this.session.expiresAt <= Date.now() + 30000) {
      this.dropSession();
      throw new ReadError('session_expired');
    }
    return this.session.token;
  }
  get connected(): boolean {
    return !!this.session && this.session.expiresAt > Date.now() + 30000;
  }
  /** Command-level gate: login and project selection, then resume only if ready. */
  async ensureProject(): Promise<boolean> {
    await this.ready;
    if (this.busy || !vscode.workspace.isTrusted) return false;
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
    const code = error instanceof ReadError ? error.code : 'local_error';
    if (code === 'access_denied') this.dropSession();
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
    try {
      const consent = await vscode.window.showInformationMessage(
        'Ouvrir la connexion utilisateur Scaleway dans votre navigateur ? JWT conservé dans SecretStorage VS Code ; aucune clé API créée. Délai : 3 minutes.',
        { modal: true },
        'Se connecter',
      );
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
      this.installSession(session);
    } catch (error) {
      await this.report(error);
    } finally {
      this.busy = false;
      this.changed();
    }
    if (this.session && !this.project) await this.switchProject();
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
    this.project = pick.project;
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
  async loadModels(): Promise<void> {
    await this.ready;
    if (!this.session || !this.project) return this.switchProject();
    if (this.busy || !vscode.workspace.isTrusted) return;
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
      await this.report(error);
    } finally {
      this.busy = false;
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
      return await deploymentWizard(project, model, nodes, current);
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
    this.dropSession();
    await this.storage;
    if (userId)
      await this.write(() =>
        this.context.globalState.update(preferenceKey(userId), undefined),
      );
    await this.context.secrets.delete('scalewayAI.apiKey.v1');
    await this.context.globalState.update('scalewayAI.connection', undefined);
  }
  dispose() {
    // Shutdown clears memory only. Explicit logout/expiry removes persisted JWT.
    this.disposed = true;
    this.publicAbort?.abort();
    clearTimeout(this.expiry);
    this.expiry = undefined;
    this.session = undefined;
    this.metadata = undefined;
    this.clear();
  }
}
