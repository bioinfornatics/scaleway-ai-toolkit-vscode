import { createHash, randomBytes } from 'node:crypto';
import { lstat, opendir } from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { LocalAgentRunner, type LocalRun } from './localAgentRunner';

export type LocalInventoryKind = 'agents' | 'tools';
const EXCLUDED = new Set([
  '.git',
  'node_modules',
  '.venv',
  'dist',
  '.scaleway-ai',
]);
const MARKERS = {
  agents: [
    'agent.json',
    'agent.authoring.json',
    'agent.creation.json',
    'agent.py',
  ],
  tools: ['tool.authoring.json', 'tool.py', 'server.py'],
};
const MAX_DIRS = 256;
const MAX_ENTRIES = 8192;
interface Root {
  name: string;
  uri: vscode.Uri;
}
interface Row {
  id: string;
  root: Root;
  directory: string;
  name: string;
  relative: string;
  markers: string[];
  marker: string;
  identity: string;
  readiness?: string;
  info?: [string, string][];
}
interface Scan {
  rows: Row[];
  incomplete: boolean;
  errors: number;
  directories: number;
}
type Input =
  | { action: 'create' | 'refresh'; token: string }
  | {
      action: 'open' | 'run' | 'configure' | 'stop' | 'logs' | 'remove';
      token: string;
      id: string;
    };
export function parseLocalInventoryInput(value: unknown): Input | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const input = value as Record<string, unknown>;
  if (typeof input.token !== 'string' || !/^[a-f0-9]{48}$/.test(input.token))
    return;
  const keys = Object.keys(input).sort().join(',');
  if (
    (input.action === 'create' || input.action === 'refresh') &&
    keys === 'action,token'
  )
    return { action: input.action, token: input.token };
  if (
    ['open', 'run', 'configure', 'stop', 'logs', 'remove'].includes(
      input.action as string,
    ) &&
    keys === 'action,id,token' &&
    typeof input.id === 'string' &&
    /^[a-f0-9]{32}$/.test(input.id)
  )
    return {
      action: input.action as
        | 'open'
        | 'run'
        | 'configure'
        | 'stop'
        | 'logs'
        | 'remove',
      token: input.token,
      id: input.id,
    };
}
function roots(): Root[] {
  return (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
    name: folder.name || path.basename(folder.uri.fsPath),
    uri: folder.uri,
  }));
}
function signature(items: Root[]): string {
  return JSON.stringify(items.map((root) => [root.name, root.uri.toString()]));
}
function identity(stat: Awaited<ReturnType<typeof lstat>>): string {
  return [
    stat.dev,
    stat.ino,
    stat.size,
    stat.mtimeMs,
    stat.ctimeMs,
    stat.birthtimeMs,
  ].join(':');
}
/** Repeated component checks reject symlinks, including ancestors of workspace roots.
 * VS Code's pathname-based editor API cannot eliminate a same-user replacement race.
 */
async function checkedParents(directory: string): Promise<void> {
  const absolute = path.resolve(directory);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of [
    '',
    ...absolute.slice(parsed.root.length).split(path.sep).filter(Boolean),
  ]) {
    if (part) current = path.join(current, part);
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error('unsafe parent');
  }
}
async function checkedMarker(row: Row): Promise<void> {
  const relative = path.relative(row.root.uri.fsPath, row.directory);
  if (
    row.root.uri.scheme !== 'file' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    !MARKERS.agents.concat(MARKERS.tools).includes(row.marker)
  )
    throw new Error('outside root');
  await checkedParents(row.directory);
  const stat = await lstat(path.join(row.directory, row.marker));
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    identity(stat) !== row.identity
  )
    throw new Error('changed marker');
}
async function scan(
  items: Root[],
  kind: LocalInventoryKind,
  valid: () => boolean,
): Promise<Scan> {
  const result: Scan = {
    rows: [],
    incomplete: false,
    errors: 0,
    directories: 0,
  };
  let entries = 0;
  const visited = new Set<string>();
  const projectBoundaries: string[] = [];
  const pending = items.map((root) => ({
    root,
    directory: root.uri.fsPath,
    depth: 0,
  }));
  while (pending.length && valid()) {
    if (result.directories >= MAX_DIRS || entries >= MAX_ENTRIES) {
      result.incomplete = true;
      break;
    }
    const item = pending.shift();
    if (!item) break;
    if (item.root.uri.scheme !== 'file') {
      result.errors++;
      result.incomplete = true;
      continue;
    }
    const directoryKey = path.resolve(item.directory);
    if (visited.has(directoryKey)) continue;
    visited.add(directoryKey);
    result.directories++;
    try {
      await checkedParents(item.directory);
      if (!valid()) break;
      const found = new Map<string, string>();
      const directory = await opendir(item.directory);
      try {
        for await (const entry of directory) {
          if (!valid()) break;
          if (++entries > MAX_ENTRIES) {
            result.incomplete = true;
            break;
          }
          if (EXCLUDED.has(entry.name)) continue;
          const target = path.join(item.directory, entry.name);
          const stat = await lstat(target);
          if (stat.isSymbolicLink()) continue;
          if (stat.isFile() && MARKERS[kind].includes(entry.name))
            found.set(entry.name, identity(stat));
          if (stat.isDirectory()) {
            if (
              item.depth < 3 &&
              result.directories + pending.length < MAX_DIRS
            )
              pending.push({
                ...item,
                directory: target,
                depth: item.depth + 1,
              });
            else result.incomplete = true;
          }
        }
      } finally {
        await directory.close().catch(() => undefined);
      }
      const markers = MARKERS[kind].filter((marker) => found.has(marker));
      const explicit = markers.some((marker) => marker.endsWith('.json'));
      const internal = projectBoundaries.some((parent) => {
        const relative = path.relative(parent, item.directory);
        return (
          relative !== '' &&
          relative !== '..' &&
          !relative.startsWith(`..${path.sep}`) &&
          !path.isAbsolute(relative)
        );
      });
      // Still scan descendants: a genuinely distinct nested JSON-marked project
      // remains discoverable; only unqualified internal scripts are suppressed.
      if (markers.length && (explicit || !internal)) {
        if (explicit) projectBoundaries.push(item.directory);
        const row: Row = {
          id: randomBytes(16).toString('hex'),
          root: item.root,
          directory: item.directory,
          name: path.basename(item.directory),
          relative: item.directory,
          markers,
          marker: markers[0],
          identity: found.get(markers[0]) as string,
        };
        await checkedMarker(row);
        result.rows.push(row);
      }
    } catch {
      result.errors++;
      result.incomplete = true;
    }
  }
  return result;
}
/** Removal is narrower than discovery: only a marked nested project, no repo
 * boundary, symlinks, child projects or unbounded tree may be trashed. */
async function removalProof(row: Row, current: () => boolean): Promise<string> {
  await checkedMarker(row);
  if (!row.markers.some((marker) => marker.endsWith('.json')))
    throw new Error('unattested_project');
  const folders = roots();
  if (
    !folders.some(
      (root) =>
        root.uri.scheme === 'file' &&
        path.resolve(root.uri.fsPath) !== path.resolve(row.directory) &&
        (() => {
          const relative = path.relative(root.uri.fsPath, row.directory);
          return (
            relative !== '..' &&
            !relative.startsWith(`..${path.sep}`) &&
            !path.isAbsolute(relative)
          );
        })(),
    )
  )
    throw new Error('protected_root');
  if (
    folders.some((root) => {
      const relative = path.relative(row.directory, root.uri.fsPath);
      return (
        root.uri.scheme === 'file' &&
        relative !== '' &&
        relative !== '..' &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative)
      );
    })
  )
    throw new Error('nested_workspace');
  if (
    (vscode.workspace.textDocuments ?? []).some((document) => {
      const relative = path.relative(row.directory, document.uri.fsPath);
      return (
        document.isDirty &&
        document.uri.scheme === 'file' &&
        relative !== '..' &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative)
      );
    })
  )
    throw new Error('unsaved_documents');
  const records: string[] = [];
  const pending = [row.directory];
  let directories = 0,
    entries = 0;
  while (pending.length) {
    if (!current() || ++directories > MAX_DIRS)
      throw new Error('changed_or_large');
    const directory = pending.shift() as string;
    await checkedParents(directory);
    records.push(JSON.stringify([directory, identity(await lstat(directory))]));
    const handle = await opendir(directory);
    try {
      for await (const entry of handle) {
        if (!current() || ++entries > MAX_ENTRIES || entry.name === '.git')
          throw new Error('protected_tree');
        const target = path.join(directory, entry.name),
          stat = await lstat(target);
        if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
          throw new Error('unsafe_tree');
        if (
          directory !== row.directory &&
          MARKERS.agents
            .concat(MARKERS.tools)
            .filter((marker) => marker.endsWith('.json'))
            .includes(entry.name)
        )
          throw new Error('nested_project');
        records.push(JSON.stringify([target, identity(stat)]));
        if (stat.isDirectory()) pending.push(target);
      }
    } finally {
      await handle.close().catch(() => undefined);
    }
  }
  await checkedMarker(row);
  if (!current()) throw new Error('changed_context');
  return createHash('sha256')
    .update(JSON.stringify(records.sort()))
    .digest('hex');
}
function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ] ?? c,
  );
}
function html(
  webview: vscode.Webview,
  extension: vscode.Uri,
  kind: LocalInventoryKind,
  token: string,
  result: Scan,
  state: string,
  runs: LocalRun[],
): string {
  const title = kind === 'agents' ? 'Agents locaux' : 'Outils locaux';
  const create = kind === 'agents' ? '+ Créer un agent' : '+ Créer un outil';
  const css = escapeHtml(
    String(
      webview.asWebviewUri(
        vscode.Uri.joinPath(extension, 'media', 'localInventory.css'),
      ),
    ),
  );
  const js = escapeHtml(
    String(
      webview.asWebviewUri(
        vscode.Uri.joinPath(extension, 'media', 'localInventory.js'),
      ),
    ),
  );
  const rows = result.rows
    .map((row) => {
      const readiness = row.readiness;
      const configured = readiness?.startsWith('Lancement configuré');
      const incomplete =
        readiness?.startsWith('Intégration requise') ||
        readiness?.startsWith('Configuration requise');
      const blocked =
        readiness?.startsWith('Point d’entrée absent') ||
        readiness?.startsWith('Configuration invalide') ||
        readiness?.startsWith('Indisponible');
      const label = configured
        ? 'Configuré'
        : incomplete
          ? 'À compléter'
          : blocked
            ? 'Bloqué'
            : 'Non vérifié';
      const tone = configured
        ? 'configured'
        : incomplete
          ? 'incomplete'
          : blocked
            ? 'blocked'
            : 'unverified';
      const explanation = escapeHtml(
        configured
          ? 'Configuration et point d’entrée présents ; endpoint et dépendances non vérifiés ; aucun état d’exécution déduit.'
          : readiness?.startsWith('Intégration requise')
            ? 'Lancement non activé dans ce projet ; ouvrez Configuration et consultez son README.'
            : readiness?.startsWith('Configuration requise')
              ? 'Configuration de lancement absente ; utilisez Configuration pour la définir.'
              : blocked
                ? 'Configuration ou point d’entrée inaccessible ; vérifiez Configuration et les fichiers du projet.'
                : 'Détection de fichiers uniquement ; configuration, endpoint et dépendances non vérifiés ; aucun état d’exécution déduit.',
      );
      const name = escapeHtml(row.name);
      return `<tr><td class="project"><strong>${name}</strong><span class="project-path">${escapeHtml(row.relative)}</span>${row.info?.length ? `<details><summary>Informations du projet</summary><dl>${row.info.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl></details>` : row.markers.some((marker) => marker.endsWith('.json')) ? '' : '<span class="project-kind">Fichier candidat — projet non identifié</span>'}</td><td class="project-state"><span class="status-wrap"><span class="inventory-status status-${tone}" role="img" tabindex="0" aria-label="${label}" aria-describedby="status-${row.id}" title="${explanation}"><span class="status-dot" aria-hidden="true"></span>${label}</span><span class="status-explanation" role="tooltip" id="status-${row.id}">${explanation}</span></span></td><td class="row-actions"><button type="button" data-action="open" data-id="${row.id}" aria-label="Ouvrir ${kind === 'agents' ? 'le code' : 'le marqueur'} de ${name}">Ouvrir</button>${kind === 'agents' ? `<button type="button" data-action="${configured ? 'run' : 'configure'}" data-id="${row.id}" aria-label="${configured ? 'Exécuter' : 'Configuration de'} ${name}">${configured ? 'Exécuter' : 'Configuration'}</button><button type="button" data-action="remove" data-id="${row.id}" aria-label="Retirer ${name}">Retirer…</button>` : ''}</td></tr>`;
    })
    .join('');
  const executionRows = runs
    .map(
      (run) =>
        `<li><strong>${escapeHtml(run.name)}</strong> · ${escapeHtml(run.state)} ${run.active ? `<button type="button" data-action="stop" data-id="${run.id}">■ Arrêter</button>` : ''}<button type="button" data-action="logs" data-id="${run.id}">Journal</button></li>`,
    )
    .join('');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; connect-src &#39;none&#39;; img-src &#39;none&#39;; style-src ${escapeHtml(webview.cspSource)}; script-src &#39;nonce-${token}&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;;"><title>${title}</title><link rel="stylesheet" href="${css}"></head><body data-token="${token}"><main><header><div><h1>${title}</h1><p>Projets détectés dans les dossiers du workspace</p></div><button type="button" data-action="create">${create}</button></header><section class="inventory-band">${state ? `<p role="status">${escapeHtml(state)}</p>` : ''}<button type="button" data-action="refresh">Actualiser</button></section><div class="table-scroll"><table aria-label="${title}"><thead><tr><th scope="col">Projet</th><th scope="col">État</th><th scope="col">Actions</th></tr></thead><tbody>${rows}</tbody></table></div>${executionRows ? `<section aria-label="Exécutions démarrées par l’extension"><h2>Exécutions locales</h2><p>Sortie du programme dans le terminal de tâche VS Code. Les commandes d’arrêt restent disponibles même si le projet disparaît de l’inventaire.</p><ul>${executionRows}</ul></section>` : ''}</main><script nonce="${token}" src="${js}"></script></body></html>`;
}
export class LocalInventory implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private token?: string;
  private kind: LocalInventoryKind = 'agents';
  private epoch = 0;
  private disposed = false;
  private rows = new Map<string, Row>();
  private scope = '';
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private readonly runner: LocalAgentRunner;
  private lastResult: Scan = {
    rows: [],
    incomplete: false,
    errors: 0,
    directories: 0,
  };
  private lastState = '';
  private removing = false;
  private readonly listeners: vscode.Disposable[];
  constructor(private readonly context: vscode.ExtensionContext) {
    this.runner = new LocalAgentRunner(() => {
      if (this.panel && !this.disposed)
        this.publish(this.lastResult, this.lastState);
    });
    this.listeners = [
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.invalidate()),
      vscode.workspace.onDidGrantWorkspaceTrust(() => this.invalidate()),
    ];
    const watcher = vscode.workspace.createFileSystemWatcher('**/*');
    const changed = (uri: vscode.Uri) => {
      if (
        uri.scheme !== 'file' ||
        path
          .normalize(uri.fsPath)
          .split(path.sep)
          .some((part) => EXCLUDED.has(part))
      )
        return;
      if (
        !roots().some((root) => {
          if (root.uri.scheme !== 'file') return false;
          const relative = path.relative(root.uri.fsPath, uri.fsPath);
          return (
            relative !== '..' &&
            !relative.startsWith(`..${path.sep}`) &&
            !path.isAbsolute(relative)
          );
        })
      )
        return;
      if (!this.panel || this.disposed) return;
      this.invalidate(); // Drop rows/IDs before any asynchronous rescan.
      clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => {
        this.refreshTimer = undefined;
        if (!this.disposed && this.panel) void this.refresh();
      }, 200);
    };
    this.listeners.push(
      watcher,
      watcher.onDidCreate(changed),
      watcher.onDidChange(changed),
      watcher.onDidDelete(changed),
    );
  }
  private invalidate(): void {
    this.epoch++;
    clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
    this.rows.clear();
    this.token = undefined;
    if (this.panel)
      this.publish(
        { rows: [], incomplete: false, errors: 0, directories: 0 },
        'Contexte modifié — cliquez sur Actualiser pour détecter les projets.',
      );
  }
  private valid(epoch: number, scope: string): boolean {
    return (
      !this.disposed &&
      !!this.panel &&
      this.epoch === epoch &&
      vscode.workspace.isTrusted &&
      signature(roots()) === scope
    );
  }
  private publish(result: Scan, state: string): void {
    if (!this.panel || this.disposed) return;
    this.lastResult = result;
    this.lastState = state;
    this.rows = new Map(result.rows.map((row) => [row.id, row]));
    this.token = randomBytes(24).toString('hex');
    this.scope = signature(roots());
    this.panel.title =
      this.kind === 'agents' ? 'Agents locaux' : 'Outils locaux';
    this.panel.webview.html = html(
      this.panel.webview,
      this.context.extensionUri,
      this.kind,
      this.token,
      result,
      state,
      this.runner.list(),
    );
  }
  async open(kind: LocalInventoryKind): Promise<void> {
    if (this.disposed || !['agents', 'tools'].includes(kind)) return;
    this.kind = kind;
    if (!this.panel) {
      const panel = vscode.window.createWebviewPanel(
        'scalewayAI.localInventory',
        'Inventaire local',
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          localResourceRoots: [
            vscode.Uri.joinPath(this.context.extensionUri, 'media'),
          ],
        },
      );
      this.panel = panel;
      const messages = panel.webview.onDidReceiveMessage((value: unknown) =>
        this.receive(value, panel),
      );
      panel.onDidChangeViewState(({ webviewPanel }) => {
        if (webviewPanel.visible && this.panel === panel && !this.disposed)
          void this.refresh();
      });
      panel.onDidDispose(() => {
        clearTimeout(this.refreshTimer);
        this.refreshTimer = undefined;
        messages.dispose();
        if (this.panel === panel) {
          this.panel = undefined;
          this.epoch++;
          this.rows.clear();
          this.token = undefined;
        }
      });
    } else this.panel.reveal(vscode.ViewColumn.One);
    await this.refresh();
  }
  private async refresh(): Promise<void> {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
    const epoch = ++this.epoch;
    const items = roots();
    const scope = signature(items);
    this.publish(
      { rows: [], incomplete: false, errors: 0, directories: 0 },
      !vscode.workspace.isTrusted
        ? 'Workspace non approuvé — aucune détection effectuée.'
        : 'Détection locale en cours…',
    );
    if (!this.valid(epoch, scope)) return;
    const result = await scan(items, this.kind, () => this.valid(epoch, scope));
    if (!this.valid(epoch, scope)) {
      if (this.epoch === epoch && !this.disposed) this.invalidate();
      return;
    }
    // Roots can overlap and be enumerated in either order. Hide weak internal
    // script rows even when an explicit ancestor was visited later.
    result.rows = result.rows.filter(
      (row) =>
        row.markers.some((marker) => marker.endsWith('.json')) ||
        !result.rows.some((parent) => {
          if (!parent.markers.some((marker) => marker.endsWith('.json')))
            return false;
          const relative = path.relative(parent.directory, row.directory);
          return (
            relative !== '' &&
            relative !== '..' &&
            !relative.startsWith(`..${path.sep}`) &&
            !path.isAbsolute(relative)
          );
        }),
    );
    const present: Row[] = [];
    for (const row of result.rows) {
      try {
        await checkedMarker(row);
        if (!this.valid(epoch, scope)) return;
        if (this.kind === 'agents') {
          row.readiness = await this.runner.readiness(row.directory);
          row.info = await this.runner.projectInfo(row.directory);
        }
        if (!this.valid(epoch, scope)) return;
        present.push(row);
      } catch {
        result.incomplete = true;
        result.errors++;
      }
    }
    if (!this.valid(epoch, scope)) return;
    result.rows = present;
    const state = !items.length
      ? 'Aucun dossier de workspace ouvert — aucune détection possible.'
      : result.incomplete || result.errors
        ? `Inventaire incomplet — ${result.rows.length} projet(s) reconnu(s), résultats partiels ; ${result.errors} erreur(s) de détection. ${result.rows.length ? 'Projets non exécutés.' : 'Aucun projet reconnu dans la partie inspectée ; absence non vérifiée.'}`
        : result.rows.length
          ? `Inventaire complet — ${result.rows.length} projet(s) reconnu(s) — non exécuté(s).`
          : 'Inventaire complet — aucun projet reconnu dans les dossiers inspectés.';
    this.publish(result, state);
  }
  private async receive(
    value: unknown,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    const input = parseLocalInventoryInput(value);
    if (
      !input ||
      this.panel !== panel ||
      input.token !== this.token ||
      this.disposed
    )
      return;
    // Refresh is the sole action allowed to recover from stale/untrusted context.
    if (input.action === 'refresh') {
      await this.refresh();
      return;
    }
    if (input.action === 'stop' || input.action === 'logs') {
      if (input.action === 'stop') this.runner.stop(input.id);
      else this.runner.logs(input.id);
      return; // Owned tasks remain stoppable after trust/root/inventory changes.
    }
    const epoch = this.epoch;
    const scope = this.scope;
    if (!this.valid(epoch, scope)) {
      this.invalidate();
      return;
    }
    try {
      if (input.action === 'create') {
        await vscode.commands.executeCommand(
          this.kind === 'agents'
            ? 'scalewayAI.createAgent'
            : 'scalewayAI.createTool',
        );
        if (!this.valid(epoch, scope)) {
          this.invalidate();
          return;
        }
        await this.refresh();
        return;
      }
      if (
        !['open', 'run', 'configure', 'remove'].includes(input.action) ||
        this.removing
      )
        return;
      if (!('id' in input)) return;
      const row = this.rows.get(input.id);
      if (!row) return;
      await checkedMarker(row);
      if (!this.valid(epoch, scope) || this.rows.get(input.id) !== row) return;
      if (input.action === 'remove') {
        if (this.kind !== 'agents') return;
        this.removing = true;
        try {
          await this.remove(
            row,
            () => this.valid(epoch, scope) && this.rows.get(input.id) === row,
          );
        } finally {
          this.removing = false;
        }
        return;
      }
      if (input.action === 'run' || input.action === 'configure') {
        if (this.kind !== 'agents') return;
        const current = () =>
          this.valid(epoch, scope) && this.rows.get(input.id) === row;
        if (input.action === 'run')
          await this.runner.start(row.directory, row.name, current);
        else await this.runner.configure(row.directory, current);
        return;
      }
      if (this.kind === 'agents') {
        await this.runner.openEntry(
          row.directory,
          () => this.valid(epoch, scope) && this.rows.get(input.id) === row,
          () => checkedMarker(row),
        );
        return;
      }
      const uri = vscode.Uri.file(path.join(row.directory, row.marker));
      const document = await vscode.workspace.openTextDocument(uri);
      if (
        !this.valid(epoch, scope) ||
        document.uri.toString() !== uri.toString() ||
        document.isClosed
      )
        return;
      await checkedMarker(row);
      if (!this.valid(epoch, scope) || this.rows.get(input.id) !== row) return;
      await vscode.window.showTextDocument(document, { preview: true });
      if (!this.valid(epoch, scope)) this.invalidate();
    } catch {
      if (this.valid(epoch, scope)) {
        this.invalidate();
        await vscode.window.showWarningMessage(
          'Ouverture ou création interrompue : contexte ou marqueur modifié, ou opération indisponible. Actualisez l’inventaire.',
        );
        if (!this.valid(this.epoch, this.scope)) this.invalidate();
      }
    }
  }
  private async remove(row: Row, current: () => boolean): Promise<void> {
    if (this.runner.isBusy(row.directory)) {
      await vscode.window.showWarningMessage(
        'Arrêtez d’abord l’exécution de cet agent et attendez la fin de la tâche.',
      );
      return;
    }
    const choice = await vscode.window.showQuickPick(
      [
        'Retirer du workspace — conserver les fichiers',
        'Mettre le projet à la corbeille…',
      ],
      { title: 'Retirer cet agent local', placeHolder: row.directory },
    );
    if (!current() || !choice) return;
    const folders = vscode.workspace.workspaceFolders ?? [];
    const index = folders.findIndex(
      (folder) =>
        folder.uri.scheme === 'file' &&
        path.resolve(folder.uri.fsPath) === path.resolve(row.directory),
    );
    if (choice === 'Retirer du workspace — conserver les fichiers') {
      if (index < 0) {
        await vscode.window.showInformationMessage(
          'Cet agent est imbriqué, pas une racine distincte du workspace. Ses fichiers resteront détectés tant qu’ils sont présents dans le parent.',
        );
        return;
      }
      const accepted = await vscode.window.showWarningMessage(
        'Retirer cette racine du workspace ?',
        {
          modal: true,
          detail:
            row.directory +
            '\nLes fichiers sont conservés. Un agent imbriqué peut rester découvert depuis la racine parent. Aucune ressource Scaleway ou clé API modifiée.',
        },
        'Retirer du workspace',
      );
      if (
        accepted !== 'Retirer du workspace' ||
        !current() ||
        this.runner.isBusy(row.directory)
      )
        return;
      await checkedMarker(row);
      if (!current()) return;
      if (!vscode.workspace.updateWorkspaceFolders(index, 1))
        await vscode.window.showWarningMessage(
          'VS Code n’a pas accepté le retrait. Aucun fichier supprimé.',
        );
      else if (!this.disposed && this.panel) await this.refresh();
      return;
    }
    if (choice !== 'Mettre le projet à la corbeille…') return;
    const first = await removalProof(row, current);
    if (!current() || this.runner.isBusy(row.directory)) return;
    const accepted = await vscode.window.showWarningMessage(
      'Mettre tout le projet local à la corbeille ?',
      {
        modal: true,
        detail:
          row.directory +
          '\nTout le dossier est concerné, y compris .env et fichiers non enregistrés sur disque. Aucun projet cloud supprimé, aucune clé API révoquée. Corbeille demandée au fournisseur VS Code ; aucun fallback de suppression définitive effectué par cette extension. Les modifications non sauvegardées dans l’éditeur ne sont pas incluses.',
      },
      'Mettre à la corbeille',
    );
    if (
      accepted !== 'Mettre à la corbeille' ||
      !current() ||
      this.runner.isBusy(row.directory)
    )
      return;
    if (
      first !== (await removalProof(row, current)) ||
      !current() ||
      this.runner.isBusy(row.directory)
    )
      throw new Error('changed_tree');
    const scope = signature(roots());
    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(row.directory), {
        recursive: true,
        useTrash: true,
      });
    } catch {
      if (!this.disposed)
        await vscode.window.showWarningMessage(
          'Mise à la corbeille échouée ou indisponible. Aucun essai de suppression définitive. Actualisez pour vérifier les fichiers.',
        );
      return;
    }
    if (this.disposed || !this.panel) return;
    // Filesystem watcher may invalidate the inventory during deletion. Only
    // unchanged roots allow removing the exact previously selected root slot.
    if (index >= 0 && signature(roots()) === scope) {
      if (!vscode.workspace.updateWorkspaceFolders(index, 1))
        await vscode.window.showWarningMessage(
          'Projet mis à la corbeille, mais racine non retirée du workspace. Retirez-la manuellement.',
        );
    } else if (index >= 0)
      await vscode.window.showWarningMessage(
        'Projet mis à la corbeille ; workspace modifié entre-temps, aucune racine retirée automatiquement.',
      );
    if (!this.disposed && this.panel) await this.refresh();
  }
  dispose(): void {
    this.disposed = true;
    this.runner.dispose();
    clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
    this.epoch++;
    this.rows.clear();
    this.token = undefined;
    for (const listener of this.listeners) listener.dispose();
    this.panel?.dispose();
    this.panel = undefined;
  }
}
