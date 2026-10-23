import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';

export type DeployedResourceKind = 'agents' | 'tools';
export interface DeployedResourceContext {
  projectName?: string;
  connected: boolean;
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
export function parseDeployedInput(
  value: unknown,
): { action: 'create'; token: string } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).sort().join(',') !== 'action,token' ||
    row.action !== 'create' ||
    typeof row.token !== 'string' ||
    !/^[a-f0-9]{48}$/.test(row.token)
  )
    return;
  return { action: 'create', token: row.token };
}
export function deployedResourcesHtml(
  webview: vscode.Webview,
  root: vscode.Uri,
  kind: DeployedResourceKind,
  context: DeployedResourceContext,
): { html: string; token: string } {
  const token = randomBytes(24).toString('hex');
  const title = kind === 'agents' ? 'Agents' : 'Tools';
  const create = kind === 'agents' ? '+ Créer un agent' : '+ Créer un outil';
  const css = webview.asWebviewUri(
    vscode.Uri.joinPath(root, 'media', 'deployedResources.css'),
  );
  const js = webview.asWebviewUri(
    vscode.Uri.joinPath(root, 'media', 'deployedResources.js'),
  );
  const scope = context.projectName
    ? 'Projet : ' +
      context.projectName +
      (context.connected ? '' : ' · à reconnecter')
    : 'Aucun projet sélectionné';
  const state = !vscode.workspace.isTrusted
    ? 'La lecture des ressources cloud nécessite un workspace approuvé.'
    : !context.projectName
      ? 'Choisissez un projet Scaleway pour consulter ses ressources déployées.'
      : !context.connected
        ? 'Reconnectez-vous pour consulter les ressources déployées de ce projet.'
        : 'La lecture de l’inventaire des services agents et outils déployés sur Scaleway n’est pas encore disponible dans cette version.';
  const html =
    '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'none'; img-src 'none'; style-src ${escapeHtml(webview.cspSource)}; script-src 'nonce-${token}'; base-uri 'none'; form-action 'none';">` +
    '<title>' +
    title +
    '</title><link rel="stylesheet" href="' +
    escapeHtml(String(css)) +
    '"></head><body data-token="' +
    token +
    '"><main><header><div><h1>' +
    title +
    '</h1><p>Ressources déployées sur Scaleway</p></div><button type="button" data-action="create">' +
    create +
    '</button></header><p class="scope">' +
    escapeHtml(scope) +
    '</p><section role="status"><h2>Inventaire non disponible</h2><p>' +
    escapeHtml(state) +
    '</p><p>Ce statut ne signifie pas qu’aucune ressource n’est déployée. Les projets locaux et les modèles dédiés ne sont pas des agents ou outils hébergés.</p></section>' +
    '<div class="table-scroll"><table><caption>' +
    (kind === 'agents' ? 'Agents déployés' : 'Outils déployés') +
    '</caption><thead><tr><th scope="col">Nom</th><th scope="col">Description</th><th scope="col">Service</th><th scope="col">Région</th><th scope="col">Statut</th></tr></thead><tbody><tr><td colspan="5">Inventaire non chargé — aucune liste cloud vérifiée.</td></tr></tbody></table></div><p class="note">Créer ouvre Ressources locales → ' +
    title +
    ' pour choisir un template et préparer le code. Cela ne déploie rien sur Scaleway.</p></main><script nonce="' +
    token +
    '" src="' +
    escapeHtml(String(js)) +
    '"></script></body></html>';
  return { html, token };
}
/** Cloud resource navigation only; no cloud adapter/false local inventory. */
export class DeployedResources implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private token?: string;
  private kind: DeployedResourceKind = 'agents';
  private disposed = false;
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly current: () => DeployedResourceContext,
  ) {}
  open(kind: DeployedResourceKind): void {
    if (this.disposed || !['agents', 'tools'].includes(kind)) return;
    this.kind = kind;
    if (!this.panel) {
      const origin = vscode.window.createWebviewPanel(
        'scalewayAI.deployedResources',
        kind === 'agents' ? 'Agents' : 'Tools',
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          localResourceRoots: [
            vscode.Uri.joinPath(this.context.extensionUri, 'media'),
          ],
        },
      );
      this.panel = origin;
      const messages = origin.webview.onDidReceiveMessage(
        async (value: unknown) => {
          if (this.disposed || this.panel !== origin) return;
          const input = parseDeployedInput(value);
          if (!input || !this.token || input.token !== this.token) return;
          await vscode.commands.executeCommand(
            this.kind === 'agents'
              ? 'scalewayAI.openLocalAgents'
              : 'scalewayAI.openLocalTools',
          );
        },
      );
      origin.onDidDispose(() => {
        messages.dispose();
        if (this.panel === origin) {
          this.panel = undefined;
          this.token = undefined;
        }
      });
    } else this.panel.reveal(vscode.ViewColumn.One);
    this.refresh();
  }
  refresh(): void {
    if (!this.panel || this.disposed) return;
    this.panel.title = this.kind === 'agents' ? 'Agents' : 'Tools';
    const rendered = deployedResourcesHtml(
      this.panel.webview,
      this.context.extensionUri,
      this.kind,
      this.current(),
    );
    this.token = rendered.token;
    this.panel.webview.html = rendered.html;
  }
  dispose(): void {
    this.disposed = true;
    this.token = undefined;
    this.panel?.dispose();
    this.panel = undefined;
  }
}
