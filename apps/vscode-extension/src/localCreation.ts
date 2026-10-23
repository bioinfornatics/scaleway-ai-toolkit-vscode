import { Buffer } from 'node:buffer';
import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { open as openFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  type AgentModelSource,
  agentModelLabel,
  composeAgentProject,
  deployedAgentModels,
} from './agentProject';
import { builtinTemplates, materializeTemplate } from './agentScaffold';
import { buildCreationView } from './buildCreationView';
import { withEndpointLaunch } from './endpointAgent';
import { openLocalAgentEntry } from './localAgentRunner';
import {
  configureCreatedCompiledIde,
  configureCreatedPythonIde,
  offerProjectActions,
  prepareCreatedAgentProject,
} from './projectActions';
import {
  privateEnvContent,
  projectTarget,
  protectProjectEnvironment,
} from './projectEnvironment';
import {
  prepareEmbeddedProject,
  renderProjectTemplate,
} from './projectGenerator';
import type { ListedModel } from './provider';
import { type Language, type StackChoice, stackChoices } from './stackScaffold';
import {
  discoverTemplates,
  parseTemplate,
  TEMPLATE_LIMITS,
  type TemplateDefinition,
  type TemplateEntry,
  type TemplateKind,
  writeTemplate,
} from './templateLibrary';

type Mode = 'create' | 'templates' | 'template-create';
type Action =
  | 'chooseStack'
  | 'chooseTemplate'
  | 'destination'
  | 'projectPath'
  | 'serverless'
  | 'dedicated'
  | 'backend'
  | 'ai'
  | 'key'
  | 'clearKey'
  | 'addKey'
  | 'model'
  | 'clearBackend'
  | 'clearAi'
  | 'clearModel'
  | 'refreshModels'
  | 'name'
  | 'refresh'
  | 'new'
  | 'import'
  | 'saveDraft'
  | 'preview'
  | 'clear'
  | 'language'
  | 'stack'
  | 'create'
  | 'edit';
export interface CreationInput {
  action: Action;
  token: string;
  index?: string;
  name?: string;
  path?: string;
}
/** Closed protocol: bounded name or opaque identity, explicit bounded project path or opaque identity, never content/secrets. */
export function parseCreationInput(value: unknown): CreationInput | undefined {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    return;
  const v = value as Record<string, unknown>;
  if (typeof v.token !== 'string' || !/^[a-f0-9]{48}$/.test(v.token)) return;
  if (v.action === 'projectPath') {
    if (
      Object.keys(v).sort().join(',') !== 'action,path,token' ||
      typeof v.path !== 'string' ||
      v.path.length > 4096 ||
      Array.from(v.path).some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    )
      return;
    return { action: 'projectPath', token: v.token, path: v.path };
  }
  if (v.action === 'name') {
    if (
      Object.keys(v).sort().join(',') !== 'action,name,token' ||
      typeof v.name !== 'string' ||
      v.name.length > 64 ||
      (v.name !== '' && !safeName(v.name))
    )
      return;
    return { action: 'name', token: v.token, name: v.name };
  }
  const indexed = [
    'backend',
    'ai',
    'key',
    'model',
    'preview',
    'create',
    'edit',
    'language',
    'stack',
  ].includes(v.action as string);
  if (
    ![
      'chooseStack',
      'chooseTemplate',
      'destination',
      'serverless',
      'dedicated',
      'clearBackend',
      'clearAi',
      'clearModel',
      'refreshModels',
      'backend',
      'ai',
      'key',
      'clearKey',
      'addKey',
      'model',
      'refresh',
      'clear',
      'new',
      'import',
      'saveDraft',
      'preview',
      'language',
      'stack',
      'create',
      'edit',
    ].includes(v.action as string) ||
    Object.keys(v).sort().join(',') !==
      (indexed ? 'action,index,token' : 'action,token')
  )
    return;
  if (
    indexed &&
    (typeof v.index !== 'string' || !/^[a-f0-9]{32}$/.test(v.index))
  )
    return;
  return {
    action: v.action as Action,
    token: v.token,
    ...(indexed ? { index: v.index as string } : {}),
  };
}
function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ] ?? c,
  );
}
function digest(value: TemplateDefinition): string {
  return createHash('sha256')
    .update(JSON.stringify(parseTemplate(value)))
    .digest('hex');
}
function safeName(value: string): boolean {
  return (
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value) &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value)
  );
}
/** Bounded Linux descriptor-anchored read, including all parent components.
 * No realpath-following, symlinks, hardlinks, devices, pipes or growing reads. */
async function readNativeTemplate(target: string): Promise<TemplateDefinition> {
  if (
    process.platform !== 'linux' ||
    !path.isAbsolute(target) ||
    target.includes('\0') ||
    target.split('/').some((p) => p === '.' || p === '..')
  )
    throw new Error();
  const parts = target.split('/').filter(Boolean);
  let directory = await openFile(
    '/',
    constants.O_RDONLY | constants.O_DIRECTORY,
  );
  try {
    for (const part of parts.slice(0, -1)) {
      const next = await openFile(
        `/proc/self/fd/${directory.fd}/${part}`,
        constants.O_RDONLY |
          constants.O_DIRECTORY |
          constants.O_NOFOLLOW |
          constants.O_NONBLOCK,
      );
      await directory.close();
      directory = next;
    }
    const handle = await openFile(
      `/proc/self/fd/${directory.fd}/${parts[parts.length - 1]}`,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const before = await handle.stat();
      if (
        !before.isFile() ||
        before.nlink !== 1 ||
        before.size > TEMPLATE_LIMITS.fileBytes
      )
        throw new Error();
      const bytes = Buffer.alloc(TEMPLATE_LIMITS.fileBytes + 1);
      let total = 0;
      while (total < bytes.length) {
        const read = await handle.read(
          bytes,
          total,
          bytes.length - total,
          null,
        );
        if (!read.bytesRead) break;
        total += read.bytesRead;
      }
      const after = await handle.stat();
      if (
        total > TEMPLATE_LIMITS.fileBytes ||
        total !== before.size ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs
      )
        throw new Error();
      return parseTemplate(
        JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(
            bytes.subarray(0, total),
          ),
        ),
      );
    } finally {
      await handle.close();
    }
  } finally {
    await directory.close();
  }
}
interface Row {
  index: string;
  template: TemplateDefinition;
  entry?: TemplateEntry;
  stack?: StackChoice;
}
interface Snapshot {
  epoch: number;
  roots: string;
  folders: readonly vscode.WorkspaceFolder[];
  kind: TemplateKind;
  mode: Mode;
}
export class LocalCreation implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private readonly listeners: vscode.Disposable[] = [];
  private epoch = 0;
  private closed = false;
  private busy = false;
  private refreshing = false;
  private token = '';
  private rows: Row[] = [];
  private selected?: string;
  private creationTab: 'stack' | 'template' = 'stack';
  private stackSelected?: string;
  private templateSelected?: string;
  private lastFocus?: string;
  private backend?: string;
  private ai?: string;
  private agentName = '';
  private destination?: vscode.Uri;
  private projectPath: string | undefined;
  private pathEdited = false;
  private destinationRoots = '';
  private serviceKind: 'serverless' | 'dedicated' = 'serverless';
  private modelIndex?: string;
  private keyIndex?: string;
  private keyRows: {
    index: string;
    key: import('./llmAccessRegistry').ApiKeyResource;
  }[] = [];
  private keyScope = '';
  private modelRows: { index: string; model: ListedModel }[] = [];
  private modelKey = '';
  private modelScopeKey = '';
  private modelRevision = 0;
  private modelLoad?: Promise<void>;
  private language: Language = 'python';
  private languages = new Map<string, Language>();
  private kind: TemplateKind = 'agents';
  private mode: Mode = 'create';
  private draft?: vscode.TextDocument;
  private status = '';
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly modelSource?: AgentModelSource,
  ) {
    this.listeners.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        void this.refresh();
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(() => {
        void this.refresh();
      }),
    );
  }
  private rootsKey(): string {
    return JSON.stringify(
      (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.toString()),
    );
  }
  private snapshot(): Snapshot {
    return {
      epoch: this.epoch,
      roots: this.rootsKey(),
      folders: [...(vscode.workspace.workspaceFolders ?? [])],
      kind: this.kind,
      mode: this.mode,
    };
  }
  private valid(s: Snapshot): boolean {
    return (
      (!this.agentForm() ||
        !this.modelSource ||
        this.modelKey ===
          JSON.stringify([
            this.modelSource.current().key,
            this.modelSource.current().status,
            this.modelSource.current().rows,
            this.modelSource.current().apiKeys,
          ])) &&
      !this.closed &&
      !!this.panel &&
      s.epoch === this.epoch &&
      s.roots === this.rootsKey() &&
      s.kind === this.kind &&
      s.mode === this.mode &&
      vscode.workspace.isTrusted &&
      process.platform === 'linux'
    );
  }
  async open(kind: TemplateKind, mode: Mode = 'create'): Promise<void> {
    if (
      this.closed ||
      !['agents', 'tools'].includes(kind) ||
      !['create', 'templates', 'template-create'].includes(mode)
    )
      return;
    this.kind = kind;
    this.mode = mode;
    this.language = 'python';
    this.creationTab = 'stack';
    this.lastFocus = undefined;
    this.agentName = '';
    this.destination = undefined;
    this.projectPath = undefined;
    this.pathEdited = false;
    this.destinationRoots = '';
    this.serviceKind = 'serverless';
    this.keyIndex = undefined;
    this.draft = undefined;
    if (!this.panel) {
      const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
      this.panel = vscode.window.createWebviewPanel(
        'scalewayAI.localCreation',
        'Création locale',
        vscode.ViewColumn.One,
        { enableScripts: true, localResourceRoots: [media] },
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.epoch++;
        this.rows = [];
        this.token = '';
        this.draft = undefined;
      });
      this.panel.webview.onDidReceiveMessage((value) => this.receive(value));
    } else this.panel.reveal();
    await this.refresh();
    if (
      kind === 'agents' &&
      mode === 'create' &&
      this.kind === kind &&
      this.mode === mode &&
      this.panel &&
      !this.closed &&
      vscode.workspace.isTrusted &&
      process.platform === 'linux'
    ) {
      await this.loadDeployedModels();
    }
  }
  dispose(): void {
    this.closed = true;
    this.epoch++;
    this.panel?.dispose();
    this.panel = undefined;
    for (const listener of this.listeners) listener.dispose();
    this.rows = [];
    this.draft = undefined;
  }
  private async refresh(): Promise<void> {
    const roots = this.rootsKey();
    if (this.destinationRoots !== roots) {
      this.destination = undefined;
      this.projectPath = undefined;
      this.pathEdited = false;
      this.destinationRoots = roots;
      const local = (vscode.workspace.workspaceFolders ?? []).filter(
        (f) => f.uri.scheme === 'file',
      );
      if (local.length) this.destination = local[0].uri;
    }
    this.epoch++;
    this.rows = [];
    this.selected = undefined;
    this.stackSelected = this.templateSelected = undefined;
    this.backend = this.ai = undefined;
    this.syncModels(true);
    this.languages = new Map(
      (['rust', 'typescript', 'python'] as const).map((language) => [
        randomBytes(16).toString('hex'),
        language,
      ]),
    );
    this.status = '';
    this.render();
    const s = this.snapshot();
    if (!this.valid(s) || this.refreshing) return; // No untrusted reads or parallel browser-triggered inventories.
    this.refreshing = true;
    try {
      const local = s.folders
        .filter((f) => f.uri.scheme === 'file')
        .map((f) => f.uri.fsPath);
      const inventory = await discoverTemplates(local, homedir(), s.kind);
      if (!this.valid(s)) return;
      this.rows = [
        ...stackChoices(s.kind).map((stack) => ({
          template: prepareEmbeddedProject(stack.template, stack.language),
          stack,
        })),
        ...builtinTemplates(s.kind).map((template) => ({
          template: prepareEmbeddedProject(template, 'python'),
        })),
        ...inventory.entries.map((entry) => ({
          template: entry.template,
          entry,
        })),
      ].map((row) => ({ ...row, index: randomBytes(16).toString('hex') }));
      this.status = inventory.issues.length
        ? 'Certains templates ont été ignorés (invalides ou limites dépassées).'
        : '';
      if (local.length !== s.folders.length)
        this.status +=
          ' Espaces virtuels/non-file exclus : aucune conversion silencieuse de chemin.';
    } catch {
      if (this.valid(s))
        this.status =
          'Bibliothèque indisponible. Aucun contenu de diagnostic affiché.';
    } finally {
      this.refreshing = false;
      // Coalesce refreshes during an in-flight inventory; never publish its stale rows.
      if (!this.closed && this.panel && s.epoch !== this.epoch)
        void this.refresh();
    }
    if (this.valid(s)) this.render();
  }
  private syncModels(force = false): void {
    const context = this.modelSource?.current();
    const key = context
      ? JSON.stringify([
          context.key,
          context.status,
          context.rows,
          context.apiKeys,
        ])
      : '';
    if (!force && key === this.modelKey) return;
    this.modelKey = key;
    const keyScope = context
      ? JSON.stringify([context.key, context.projectId])
      : '';
    const previousKeys = this.keyScope === keyScope ? this.keyRows : [];
    this.keyScope = keyScope;
    this.keyRows = (context?.apiKeys ?? [])
      .filter(
        (key) => key.secretAvailable && key.expiresAt > Date.now() + 30000,
      )
      .slice(0, 500)
      .map((key) => ({
        key,
        index:
          previousKeys.find(
            (r) =>
              r.key.id === key.id &&
              r.key.maskedAccessKey === key.maskedAccessKey,
          )?.index ?? randomBytes(16).toString('hex'),
      }));
    if (!this.keyRows.some((r) => r.index === this.keyIndex))
      this.keyIndex = undefined;

    const scopeKey = context
      ? JSON.stringify([
          context.key,
          context.projectId,
          this.mode,
          this.serviceKind,
        ])
      : '';
    const previous =
      !force && this.modelScopeKey === scopeKey ? this.modelRows : [];
    this.modelScopeKey = scopeKey;
    const deployed =
      context && /Chargement/i.test(context.status) && previous.length
        ? previous.map((row) => row.model)
        : context
          ? deployedAgentModels(context)
          : [];
    this.modelRows = context
      ? deployed
          .filter(
            (model) =>
              this.mode !== 'create' ||
              !this.agentForm() ||
              model.kind === this.serviceKind,
          )
          .map((model) => ({
            index:
              previous.find(
                (r) => r.model.kind === model.kind && r.model.id === model.id,
              )?.index ?? randomBytes(16).toString('hex'),
            model,
          }))
      : [];
    if (!this.modelRows.some((r) => r.index === this.modelIndex))
      this.modelIndex = undefined;
  }
  private async loadDeployedModels(): Promise<void> {
    if (
      !this.modelSource ||
      this.closed ||
      !this.panel ||
      !vscode.workspace.isTrusted ||
      process.platform !== 'linux'
    )
      return;
    if (this.modelLoad) return this.modelLoad;
    const load = Promise.resolve().then(async () => {
      try {
        await this.modelSource?.refresh();
      } catch {
        if (
          this.panel &&
          !this.closed &&
          this.kind === 'agents' &&
          this.mode !== 'templates'
        ) {
          this.status =
            'Modèles indisponibles. Vérifiez la connexion et le projet.';
          this.render();
        }
      } finally {
        this.modelsChanged();
      }
    });
    this.modelLoad = load;
    try {
      await load;
    } finally {
      if (this.modelLoad === load) this.modelLoad = undefined;
    }
  }
  modelsChanged(): void {
    const previous = this.modelKey;
    this.syncModels();
    if (previous !== this.modelKey && this.panel && this.kind === 'agents') {
      this.epoch++;
      if (this.modelLoad && this.mode === 'create') {
        void this.panel.webview.postMessage({
          type: 'creation-models',
          token: this.token,
          revision: ++this.modelRevision,
          models: this.modelRows.map((r) => ({
            index: r.index,
            label: agentModelLabel(r.model),
          })),
          selected: this.modelIndex ?? '',
          ...(this.modelSource?.current().apiKeys !== undefined
            ? {
                keys: this.keyRows.map((r) => ({
                  index: r.index,
                  label: this.keyLabel(r.key),
                })),
                selectedKey: this.keyIndex ?? '',
              }
            : {}),
        });
      } else this.render();
    }
  }
  private keyLabel(key: import('./llmAccessRegistry').ApiKeyResource): string {
    return (
      (key.description || 'Clé API') +
      ' · ' +
      key.maskedAccessKey +
      ' · ' +
      (key.bearerType === 'application' ? 'Application IAM' : 'Utilisateur IAM')
    );
  }
  private agentForm(): boolean {
    return this.kind === 'agents';
  }
  private render(focus?: string): void {
    if (!this.panel) return;
    if (focus) this.lastFocus = focus;
    this.token = randomBytes(24).toString('hex');
    const webview = this.panel.webview;
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    const css = escapeHtml(
      webview
        .asWebviewUri(vscode.Uri.joinPath(media, 'localCreation.css'))
        .toString(),
    );
    const js = escapeHtml(
      webview
        .asWebviewUri(vscode.Uri.joinPath(media, 'localCreation.js'))
        .toString(),
    );
    const trusted = vscode.workspace.isTrusted && process.platform === 'linux';
    const button = (action: Action, label: string, index?: string) =>
      `<button type="button" data-action="${action}"${index ? ` data-index="${index}"` : ''}>${label}</button>`;
    const row = trusted
      ? this.rows.find((r) => r.index === this.selected)
      : undefined;
    const preview = row
      ? `<section aria-label="Aperçu"><h2>${escapeHtml(row.template.label)}</h2>${Object.entries(
          row.template.files,
        )
          .map(
            ([name, content]) =>
              `<details><summary>${escapeHtml(name)}</summary><pre>${escapeHtml(content)}</pre></details>`,
          )
          .join(
            '',
          )}${this.mode === 'templates' ? '' : button('create', this.mode === 'template-create' ? 'Créer le template' : 'Créer dans le projet', row.index)}</section>`
      : '';
    const noun = this.kind === 'agents' ? 'agent' : 'outil';
    const paths = `<code>.scaleway-ai/templates/${this.kind}/</code> et <code>~/.scaleway-ai/templates/${this.kind}/</code>`;
    if (this.mode === 'templates') {
      const personalRows = trusted
        ? this.rows
            .filter((item) => item.entry)
            .map(
              (item) =>
                `<tr><td>${escapeHtml(item.template.label)}</td><td>${escapeHtml(item.template.description)}</td><td>${item.entry?.origin === 'project' ? 'Projet' : 'Utilisateur'}</td><td>${button('preview', 'Aperçu', item.index)}${button('edit', 'Modifier', item.index)}</td></tr>`,
            )
            .join('')
        : '';
      this.panel.title =
        this.kind === 'agents'
          ? 'Mes templates · Agents'
          : 'Mes templates · Outils';
      webview.html = `<!doctype html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'none'; connect-src 'none'; style-src ${escapeHtml(webview.cspSource)}; script-src 'nonce-${this.token}';"><link rel="stylesheet" href="${css}"><title>${this.panel.title}</title></head><body data-token="${this.token}"><main><header><h1>${this.panel.title}</h1>${button('new', `+ Créer un ${noun}`)}</header>${button('refresh', 'Actualiser')}${trusted ? '' : '<p role="status">Workspace Trust requis (hôte Linux).</p>'}<div class="table-scroll"><table><thead><tr><th scope="col">Nom</th><th scope="col">Description</th><th scope="col">Origine</th><th scope="col">Actions</th></tr></thead><tbody>${personalRows}</tbody></table></div>${preview}<footer><p>Les templates proviennent de ${paths}. Le dossier projet est relatif à chaque racine du workspace ; ~ désigne le dossier utilisateur de l’hôte d’extension. À identifiant identique, le projet est prioritaire.</p></footer></main><script nonce="${this.token}" src="${js}"></script></body></html>`;
      return;
    }
    this.panel.title =
      this.mode === 'template-create'
        ? `Créer un template d’${noun}`
        : `Créer un ${noun}`;
    webview.html = buildCreationView({
      title: this.panel.title,
      agentForm: this.agentForm(),
      agentName: this.agentName,
      focus: this.lastFocus,
      creationTab:
        this.kind === 'agents' && this.mode === 'create'
          ? this.creationTab
          : undefined,
      destination:
        this.mode === 'create'
          ? (this.projectPath ??
            (this.destination && safeName(this.agentName)
              ? path.join(this.destination.fsPath, this.agentName)
              : ''))
          : undefined,
      destinationBase: this.destination?.fsPath,
      pathEdited: this.pathEdited,
      backend: this.backend,
      ai: this.ai,
      modelIndex: this.modelIndex,
      keys:
        this.modelSource?.current().apiKeys !== undefined
          ? this.keyRows.map((r) => ({
              index: r.index,
              label: this.keyLabel(r.key),
            }))
          : undefined,
      keyIndex: this.keyIndex,
      serviceKind: this.serviceKind,
      models: this.modelRows.map((r) => ({
        index: r.index,
        label: agentModelLabel(r.model),
      })),
      modelStatus: this.modelSource?.current().projectId
        ? this.mode === 'create'
          ? 'Catalogue / déploiements · ' +
            (this.serviceKind === 'serverless' ? 'Serverless.' : 'Dédié.')
          : 'Modèles de Catalogue / déploiements · Serverless et Dédiés.'
        : 'Choisissez un projet Scaleway, puis actualisez les modèles.',
      kind: this.kind,
      templateMode: this.mode === 'template-create',
      language: this.language,
      languages: this.languages,
      rows: this.rows.map((r) => {
        if (!this.agentForm() || r.index !== this.selected || !r.stack)
          return r;
        try {
          return {
            ...r,
            template: composeAgentProject(
              this.rows.find((x) => x.index === this.backend)?.stack,
              this.rows.find((x) => x.index === this.ai)?.stack,
              safeName(this.agentName) ? this.agentName : 'mon-agent',
              this.modelRows.find((x) => x.index === this.modelIndex)?.model,
            ),
          };
        } catch {
          return r;
        }
      }),
      selected: this.selected,
      trusted,
      status: this.status,
      draft: !!this.draft,
      token: this.token,
      css,
      js,
      csp: webview.cspSource,
    });
  }
  private async receive(value: unknown): Promise<void> {
    const input = parseCreationInput(value);
    if (!input || input.token !== this.token || this.closed) return;
    if (input.action === 'refresh') {
      await this.refresh();
      return;
    }
    this.modelsChanged();
    if (input.token !== this.token) return;
    const s = this.snapshot();
    if (!this.valid(s) || this.busy) return;
    if (['chooseStack', 'chooseTemplate'].includes(input.action)) {
      if (this.kind !== 'agents' || this.mode !== 'create') return;
      const tab = input.action === 'chooseStack' ? 'stack' : 'template';
      if (tab === this.creationTab) return;
      if (this.creationTab === 'stack') this.stackSelected = this.selected;
      else this.templateSelected = this.selected;
      this.creationTab = tab;
      this.selected =
        tab === 'stack' ? this.stackSelected : this.templateSelected;
      this.status = '';
      this.epoch++;
      this.render(input.action);
      return;
    }
    if (
      this.kind === 'agents' &&
      this.mode === 'create' &&
      this.creationTab !== 'stack' &&
      [
        'language',
        'backend',
        'ai',
        'clearBackend',
        'clearAi',
        'clear',
      ].includes(input.action)
    )
      return;
    if (['key', 'clearKey', 'addKey'].includes(input.action)) {
      if (
        !this.agentForm() ||
        this.mode !== 'create' ||
        this.modelSource?.current().apiKeys === undefined
      )
        return;
      if (input.action === 'addKey') {
        this.busy = true;
        try {
          await this.modelSource?.addKey?.();
        } catch {
          /* Never expose storage/native diagnostics. */
        } finally {
          this.busy = false;
        }
        if (
          !this.closed &&
          this.panel &&
          s.roots === this.rootsKey() &&
          s.kind === this.kind &&
          s.mode === this.mode &&
          vscode.workspace.isTrusted
        )
          await this.loadDeployedModels();
        return;
      }
      if (
        input.action === 'key' &&
        !this.keyRows.some((r) => r.index === input.index)
      )
        return;
      this.keyIndex = input.action === 'key' ? input.index : undefined;
      this.epoch++;
      this.render('key');
      return;
    }
    if (input.action === 'projectPath') {
      if (!this.agentForm() || this.mode !== 'create') return;
      this.projectPath = input.path ?? '';
      this.pathEdited = true;
      this.epoch++;
      return;
    }
    if (input.action === 'destination') {
      if (!this.agentForm() || this.mode !== 'create') return;
      const localRoots = s.folders.filter((f) => f.uri.scheme === 'file');
      const entered = this.projectPath;
      const base = this.destination?.fsPath ?? localRoots[0]?.uri.fsPath;
      const proposed =
        entered &&
        (path.isAbsolute(entered)
          ? entered
          : base
            ? path.resolve(base, entered)
            : undefined);
      const folders = await vscode.window.showOpenDialog({
        title: 'Choisir le dossier contenant le nouveau projet',
        openLabel: 'Choisir ce dossier',
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        defaultUri: proposed
          ? vscode.Uri.file(path.dirname(proposed))
          : (this.destination ??
            s.folders.find((f) => f.uri.scheme === 'file')?.uri),
      });
      if (!this.valid(s) || !folders || folders.length !== 1) return;
      const folder = folders[0];
      if (
        folder.scheme !== 'file' ||
        !path.isAbsolute(folder.fsPath) ||
        folder.query ||
        folder.fragment
      )
        return;
      this.destination = folder;
      const leaf =
        this.pathEdited && entered ? path.basename(entered) : this.agentName;
      this.projectPath = safeName(leaf)
        ? path.join(folder.fsPath, leaf)
        : undefined;
      this.epoch++;
      this.render(input.action);
      return;
    }
    if (['serverless', 'dedicated'].includes(input.action)) {
      if (!this.agentForm() || this.mode !== 'create') return;
      if (input.action === this.serviceKind) return;
      this.serviceKind = input.action as 'serverless' | 'dedicated';
      this.modelIndex = undefined;
      this.syncModels(true);
      this.epoch++;
      this.render(input.action);
      return;
    }
    if (
      input.action === 'name' &&
      this.agentForm() &&
      this.mode !== 'templates'
    ) {
      this.agentName = input.name ?? '';
      this.pathEdited = false;
      this.projectPath =
        this.destination && safeName(this.agentName)
          ? path.join(this.destination.fsPath, this.agentName)
          : undefined;
      this.epoch++;
      return;
    }
    if (
      input.action === 'refreshModels' &&
      this.agentForm() &&
      this.mode !== 'templates'
    ) {
      await this.loadDeployedModels();
      return;
    }
    if (
      ['clearBackend', 'clearAi'].includes(input.action) &&
      this.agentForm() &&
      this.mode !== 'templates'
    ) {
      if (input.action === 'clearBackend') this.backend = undefined;
      else this.ai = undefined;
      this.selected = this.backend ?? this.ai;
      this.epoch++;
      this.render(input.action);
      return;
    }
    if (
      input.action === 'clearModel' &&
      this.agentForm() &&
      this.mode !== 'templates'
    ) {
      this.modelIndex = undefined;
      this.epoch++;
      this.render(input.action);
      return;
    }
    if (
      input.action === 'model' &&
      this.agentForm() &&
      this.mode !== 'templates'
    ) {
      if (!this.modelRows.some((r) => r.index === input.index)) return;
      this.modelIndex = input.index;
      this.epoch++;
      this.render(input.action);
      return;
    }
    const row = input.index
      ? this.rows.find((r) => r.index === input.index)
      : undefined;
    if (input.action === 'clear') {
      if (this.mode === 'templates') return;
      this.epoch++;
      this.selected = undefined;
      this.backend = this.ai = undefined;
      this.render(input.action);
      return;
    }
    if (input.action === 'language') {
      const language = input.index
        ? this.languages.get(input.index)
        : undefined;
      if (!language || this.mode === 'templates') return;
      this.epoch++;
      this.language = language;
      this.backend = this.ai = undefined;
      this.selected = undefined;
      this.status = '';
      this.render(input.action);
      return;
    }
    if (input.index && !row) return;
    if (['backend', 'ai'].includes(input.action)) {
      if (
        !this.agentForm() ||
        this.mode === 'templates' ||
        !row?.stack ||
        row.stack.language !== this.language
      )
        return;
      if (
        input.action === 'backend' &&
        !['backend', 'basic'].includes(row.stack.category)
      )
        return;
      if (
        input.action === 'ai' &&
        !['agent', 'basic'].includes(row.stack.category)
      )
        return;
      if (input.action === 'backend') this.backend = row.index;
      else this.ai = row.stack.category === 'basic' ? undefined : row.index;
      this.selected = this.backend ?? this.ai;
      this.epoch++;
      this.status = '';
      this.render(input.action);
      return;
    }
    if (input.action === 'stack') {
      if (this.agentForm()) return;
      if (
        !row?.stack ||
        row.stack.language !== this.language ||
        this.mode === 'templates'
      )
        return;
      this.epoch++;
      this.selected = row.index;
      this.status = '';
      this.render(input.action);
      return;
    }
    if (input.action === 'preview' && row) {
      if (row.stack) return;
      this.epoch++;
      this.selected = row.index;
      if (this.kind === 'agents' && this.mode === 'create') {
        this.stackSelected = this.backend ?? this.ai;
        this.templateSelected = row.index;
        this.creationTab = 'template';
      } else this.backend = this.ai = undefined;
      this.render(input.action);
      return;
    }
    if (input.action === 'new' && this.mode === 'templates') {
      await this.open(this.kind, 'template-create');
      return;
    }
    if (
      input.action === 'create' &&
      (this.mode === 'templates' || !row || row.index !== this.selected)
    )
      return;
    this.busy = true;
    try {
      if (input.action === 'create' && row) await this.create(s, row);
      else if (input.action === 'edit' && row?.entry)
        await this.edit(s, row.entry);
      else if (input.action === 'new') {
        const sample = builtinTemplates(s.kind)[0];
        const document = await vscode.workspace.openTextDocument({
          language: 'json',
          content: JSON.stringify({ ...sample, id: 'my-template' }, null, 2),
        });
        if (!this.valid(s)) return;
        await vscode.window.showTextDocument(document);
        if (!this.valid(s)) return;
        this.draft = document;
        this.render(input.action);
      } else if (
        input.action === 'saveDraft' &&
        this.draft &&
        !this.draft.isClosed
      ) {
        const text = this.draft.getText();
        if (Buffer.byteLength(text) > TEMPLATE_LIMITS.fileBytes)
          throw new Error();
        const template = parseTemplate(JSON.parse(text));
        if (template.kind !== s.kind) throw new Error();
        await this.save(s, template);
      } else if (input.action === 'import') {
        const files = await vscode.window.showOpenDialog({
          canSelectMany: false,
          canSelectFiles: true,
          canSelectFolders: false,
          filters: { 'Template JSON': ['json'] },
          title: 'Importer un template local (hôte Linux)',
        });
        if (!this.valid(s) || !files || files.length !== 1) return;
        if (files[0].scheme !== 'file') throw new Error();
        const template = await readNativeTemplate(files[0].fsPath);
        if (!this.valid(s)) return;
        if (template.kind !== s.kind) throw new Error();
        await this.save(s, template);
      }
    } catch {
      if (this.valid(s)) {
        this.status =
          'Action refusée ou échouée. Vérifiez le JSON, les chemins et les fichiers existants. Aucun écrasement/suppression automatique ; un nouveau fichier partiel peut rester à examiner.';
        this.render(input.action);
      }
    } finally {
      this.busy = false;
    }
  }
  private async chooseWorkspace(
    s: Snapshot,
  ): Promise<vscode.WorkspaceFolder | undefined> {
    const candidates = s.folders.filter((f) => f.uri.scheme === 'file');
    if (!candidates.length) {
      this.status = 'Ouvrez un dossier de projet file sur l’hôte Linux.';
      this.render();
      return;
    }
    const selected = await vscode.window.showQuickPick(
      candidates.map((folder) => ({
        label: folder.name,
        description: folder.uri.fsPath,
        folder,
      })),
      { title: 'Choisir le dossier parent du projet' },
    );
    return this.valid(s) ? selected?.folder : undefined;
  }
  private async create(s: Snapshot, row: Row): Promise<void> {
    if (s.kind === 'agents') {
      if (!safeName(this.agentName)) {
        this.status =
          'Renseignez un nom : lettres, chiffres, tirets ou underscore.';
        this.render();
        return;
      }
      const model = this.modelRows.find(
        (r) => r.index === this.modelIndex,
      )?.model;
      if (s.mode === 'create' && !model) {
        this.status =
          this.serviceKind === 'serverless'
            ? 'Sélectionnez un modèle Serverless dans votre projet.'
            : 'Sélectionnez un déploiement dédié dans votre projet.';
        this.render();
        return;
      }
      const selectedKey = this.keyRows.find(
        (r) => r.index === this.keyIndex,
      )?.key;
      if (
        s.mode === 'create' &&
        this.modelSource?.current().apiKeys !== undefined &&
        (!selectedKey?.secretAvailable ||
          selectedKey.expiresAt <= Date.now() + 30000)
      ) {
        this.status =
          'Sélectionnez une clé API locale valide, ou ajoutez / importez une clé.';
        this.render();
        return;
      }
      const name = this.agentName;
      const selectedTemplate = composeAgentProject(
        row.stack
          ? this.rows.find((r) => r.index === this.backend)?.stack
          : undefined,
        row.stack
          ? this.rows.find((r) => r.index === this.ai)?.stack
          : undefined,
        name,
        model,
        row.stack ? undefined : row.template,
        this.modelSource?.current().projectId,
      );
      const prepared =
        row.entry || selectedTemplate.version === 2
          ? selectedTemplate
          : prepareEmbeddedProject(
              selectedTemplate,
              row.stack?.language ?? 'python',
            );
      if (s.mode === 'template-create') {
        if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) {
          this.status =
            'Identifiant template : minuscules, chiffres et tirets.';
          this.render();
          return;
        }
        await this.save(s, parseTemplate({ ...prepared, id: name }));
        return;
      }
      let template = protectProjectEnvironment(
        renderProjectTemplate(prepared, {
          name,
          modelId:
            model?.kind === 'serverless'
              ? model.id
              : model?.deploymentInfo?.modelId,
        }),
      );
      if (!row.entry)
        template = withEndpointLaunch(
          template,
          row.stack?.language ??
            (prepared.version === 2
              ? (prepared.project?.language ?? 'python')
              : 'python'),
        );
      const projectId = this.modelSource?.current().projectId;
      if (!model || !projectId || !this.modelSource?.credentialScope)
        throw new Error('credential_source_unavailable');
      const target = projectTarget(model, projectId);
      const enteredPath =
        this.projectPath ??
        (this.destination ? path.join(this.destination.fsPath, name) : '');
      const localRoots = s.folders.filter((f) => f.uri.scheme === 'file');
      const base = this.destination?.fsPath ?? localRoots[0]?.uri.fsPath;
      const finalPath =
        enteredPath &&
        (path.isAbsolute(enteredPath)
          ? path.resolve(enteredPath)
          : base
            ? path.resolve(base, enteredPath)
            : undefined);
      if (
        !this.valid(s) ||
        !finalPath ||
        !safeName(path.basename(finalPath)) ||
        (!path.isAbsolute(enteredPath) &&
          (enteredPath.split('/').includes('..') || enteredPath.includes('\\')))
      ) {
        this.status =
          'Saisissez un chemin final absolu, ou relatif au dossier de base, avec un nom de dossier valide.';
        this.render();
        return;
      }
      const folder = vscode.Uri.file(path.dirname(finalPath));
      const directoryName = path.basename(finalPath);
      const confirmed = await vscode.window.showWarningMessage(
        `Créer exclusivement ${finalPath} ?`,
        {
          modal: true,
          detail:
            'Fichiers :\n' +
            Object.keys(template.files).sort().join('\n') +
            '\n.env privé : la clé API de l’accès sélectionné sera copiée en clair (0600), avec le modèle et son endpoint. /.env est exclu de Git. Ne partagez pas ce fichier. Déconnexion et révocation ne suppriment pas cette copie.\nPréparation automatique des nouveaux agents intégrés : Python (uv sync), TypeScript (bun install puis bun run build), Rust (cargo build --all-targets) : téléchargements réseau et scripts de dépendances possibles ; les outils du langage doivent être installés. Aucun agent lancé ni appel modèle ni déploiement.',
        },
        'Créer dans le projet',
      );
      if (
        !this.valid(s) ||
        confirmed !== 'Créer dans le projet' ||
        (selectedKey && selectedKey.expiresAt <= Date.now() + 30000)
      )
        return;
      const credentials = await this.modelSource.credentialScope(
        projectId,
        model,
        selectedKey?.id,
      );
      let project: string;
      try {
        project = await materializeTemplate(
          folder.fsPath,
          directoryName,
          template,
          {
            current: () => this.valid(s) && credentials.current(),
            content: () => privateEnvContent(target, credentials.secretKey()),
          },
          () => this.valid(s),
        );
      } finally {
        credentials.dispose();
      }
      if (!this.valid(s)) return;
      const autoPrepare =
        !row.entry &&
        template.kind === 'agents' &&
        template.version === 2 &&
        !!template.project;
      const languageLabel = {
        python: 'Python',
        typescript: 'TypeScript',
        rust: 'Rust',
      }[
        template.version === 2
          ? (template.project?.language ?? 'python')
          : 'python'
      ];
      let dependenciesPrepared = false;
      if (autoPrepare) {
        this.status = 'Préparation de l’environnement ' + languageLabel + '…';
        this.render();
        dependenciesPrepared = await prepareCreatedAgentProject(
          project,
          template,
          () => this.valid(s),
        ).catch(() => false);
      }
      // Editing is independent of IDE readiness. Root registration below can
      // reload the extension host, so pin the verified source before attempting it.
      const entryOpened = await openLocalAgentEntry(project, () =>
        this.valid(s),
      );
      if (
        dependenciesPrepared &&
        template.version === 2 &&
        template.project?.language === 'python'
      ) {
        await configureCreatedPythonIde(
          project,
          this.context,
          () => this.valid(s),
          entryOpened,
        );
      }
      if (
        dependenciesPrepared &&
        template.version === 2 &&
        (template.project?.language === 'typescript' ||
          template.project?.language === 'rust')
      ) {
        await configureCreatedCompiledIde(
          project,
          template.project.language,
          this.context,
          () => this.valid(s),
          entryOpened,
        );
      }
      if (!this.valid(s)) return;
      this.status =
        (autoPrepare
          ? dependenciesPrepared
            ? 'Projet créé, environnement ' + languageLabel + ' préparé. '
            : 'Projet créé ; préparation ' + languageLabel + ' non terminée. '
          : 'Base locale créée. ') +
        (template.files['.vscode/scaleway-agent-run.json'] &&
        JSON.parse(template.files['.vscode/scaleway-agent-run.json']).ready
          ? 'Point d’entrée et lancement configurés. Aucun appel modèle effectué.'
          : 'Consultez le README pour le lancement de ce template.');
      if (this.valid(s)) this.render();
      await offerProjectActions(
        project,
        template,
        () => this.valid(s),
        dependenciesPrepared,
      );
      return;
    }
    if (s.mode === 'template-create') {
      const id = await vscode.window.showInputBox({
        title: 'Identifiant du nouveau template',
        prompt: `Lettres minuscules, chiffres et tirets. Template JSON dans .scaleway-ai/templates/${s.kind}/ ou ~/.scaleway-ai/templates/${s.kind}/`,
        validateInput: (value) =>
          /^[a-z0-9][a-z0-9-]{0,63}$/.test(value) && safeName(value)
            ? undefined
            : 'Utilisez des lettres minuscules, chiffres et tirets.',
      });
      if (!this.valid(s) || !id) return;
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || !safeName(id))
        throw new Error();
      const label = await vscode.window.showInputBox({
        title: 'Nom du template',
        value: id,
      });
      if (!this.valid(s) || !label) return;
      await this.save(s, parseTemplate({ ...row.template, id, label }));
      return;
    }
    const folder = await this.chooseWorkspace(s);
    if (!this.valid(s) || !folder) return;
    const name = await vscode.window.showInputBox({
      title: 'Nouveau répertoire (jamais écrasé)',
      prompt: 'Nom simple : lettres, chiffres, tiret ou underscore',
      validateInput: (v) =>
        safeName(v) ? undefined : 'Nom de répertoire non sûr.',
    });
    if (!this.valid(s) || !name) return;
    if (!safeName(name)) throw new Error();
    const template = renderProjectTemplate(row.template, { name });
    const confirmed = await vscode.window.showWarningMessage(
      `Créer exclusivement ${path.join(folder.uri.fsPath, name)} ?`,
      {
        modal: true,
        detail: `Fichiers :\n${Object.keys(template.files).sort().join('\n')}\nAucune exécution. Aucun écrasement. Des fichiers partiels peuvent rester en cas d’échec.`,
      },
      'Créer dans le projet',
    );
    if (!this.valid(s) || confirmed !== 'Créer dans le projet') return;
    const project = await materializeTemplate(
      folder.uri.fsPath,
      name,
      template,
      undefined,
      () => this.valid(s),
    );
    if (!this.valid(s)) return;
    this.status = 'Base locale créée. Rien n’a été exécuté.';
    if (!this.valid(s)) return;
    this.render();
    await offerProjectActions(project, template, () => this.valid(s));
  }
  private async save(s: Snapshot, template: TemplateDefinition): Promise<void> {
    const destination = await vscode.window.showQuickPick(
      ['Projet', 'Utilisateur'],
      { title: 'Destination du template : Utilisateur = home de l’hôte Linux' },
    );
    if (!this.valid(s) || !destination) return;
    let parent: string;
    if (destination === 'Projet') {
      const folder = await this.chooseWorkspace(s);
      if (!this.valid(s) || !folder) return;
      parent = folder.uri.fsPath;
    } else if (destination === 'Utilisateur') parent = homedir();
    else return;
    const root = path.join(parent, '.scaleway-ai', 'templates');
    const confirmed = await vscode.window.showWarningMessage(
      'Créer le template personnel ?',
      {
        modal: true,
        detail: `${path.join(root, template.kind, `${template.id}.json`)}\nContenu : ${Object.keys(template.files).sort().join(', ')}\nÉcriture exclusive, jamais de remplacement.`,
      },
      'Créer le template',
    );
    if (!this.valid(s) || confirmed !== 'Créer le template') return;
    await writeTemplate(root, template);
    if (!this.valid(s)) return;
    this.draft = undefined;
    if (s.mode === 'template-create') await this.open(s.kind, 'templates');
    else await this.refresh();
  }
  private async edit(s: Snapshot, entry: TemplateEntry): Promise<void> {
    const inventory = await discoverTemplates(
      s.folders.filter((f) => f.uri.scheme === 'file').map((f) => f.uri.fsPath),
      homedir(),
      s.kind,
    );
    if (!this.valid(s)) return;
    const current = inventory.entries.find(
      (e) =>
        e.filePath === entry.filePath &&
        e.root === entry.root &&
        e.origin === entry.origin,
    );
    if (
      !current ||
      digest(current.template) !== digest(entry.template) ||
      path.dirname(entry.filePath) !== path.join(entry.root, s.kind)
    )
      throw new Error();
    const checked = await readNativeTemplate(entry.filePath);
    if (!this.valid(s)) return;
    if (digest(checked) !== digest(entry.template)) throw new Error();
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.file(entry.filePath),
    );
    if (!this.valid(s)) return;
    if (
      Buffer.byteLength(document.getText()) > TEMPLATE_LIMITS.fileBytes ||
      digest(parseTemplate(JSON.parse(document.getText()))) !== digest(checked)
    )
      throw new Error();
    const latest = await readNativeTemplate(entry.filePath);
    if (!this.valid(s)) return;
    if (digest(latest) !== digest(checked)) throw new Error();
    await vscode.window.showTextDocument(document);
    if (!this.valid(s)) return;
    this.status =
      'Éditeur natif ouvert après vérification du contenu. Les sauvegardes manuelles relèvent de VS Code ; actualisez pour revalider. Aucun remplacement automatique.';
    this.render();
  }
}
