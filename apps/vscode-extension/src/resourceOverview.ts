import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { ListedModel } from './provider';

export type OverviewInput =
  | { type: 'catalog' | 'refresh'; token: string }
  | {
      type: 'open';
      kind: 'serverless' | 'dedicated';
      id: string;
      token: string;
    };

export function parseOverviewInput(value: unknown): OverviewInput | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const row = value as Record<string, unknown>;
  if (typeof row.token !== 'string' || !/^[a-f0-9]{48}$/.test(row.token))
    return;
  if (
    Object.keys(row).length === 2 &&
    (row.type === 'catalog' || row.type === 'refresh')
  ) {
    return { type: row.type, token: row.token };
  }
  if (
    Object.keys(row).length === 4 &&
    row.type === 'open' &&
    (row.kind === 'serverless' || row.kind === 'dedicated') &&
    typeof row.id === 'string' &&
    row.id.length > 0 &&
    row.id.length <= 512 &&
    !Array.from(row.id).some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  ) {
    return { type: 'open', kind: row.kind, id: row.id, token: row.token };
  }
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character] ?? character,
  );
}

function page(
  webview: vscode.Webview,
  root: vscode.Uri,
  title: string,
  body: string,
  token?: string,
): string {
  const css = webview.asWebviewUri(
    vscode.Uri.joinPath(root, 'media', 'resourceOverview.css'),
  );
  const js = webview.asWebviewUri(
    vscode.Uri.joinPath(root, 'media', 'resourceOverview.js'),
  );
  const scripts = token
    ? "script-src 'nonce-" + token + "';"
    : "script-src 'none';";
  return (
    '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${escapeHtml(webview.cspSource)}; ${scripts} connect-src 'none'; img-src 'none'; base-uri 'none'; form-action 'none';">` +
    '<title>' +
    escapeHtml(title) +
    '</title><link rel="stylesheet" href="' +
    escapeHtml(String(css)) +
    '"></head><body><main' +
    (token ? ' data-token="' + token + '"' : '') +
    '><h1>' +
    escapeHtml(title) +
    '</h1>' +
    body +
    '</main>' +
    (token
      ? '<script nonce="' +
        token +
        '" src="' +
        escapeHtml(String(js)) +
        '"></script>'
      : '') +
    '</body></html>'
  );
}

function creationDate(value: string | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: string) =>
    parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('day')}/${part('month')}/${part('year')} à ${part('hour')}:${part('minute')}`;
}

function deploymentState(row: ListedModel): string {
  if (row.kind === 'serverless')
    return row.llmAccess ? 'Accès configuré · IAM vérifié' : 'Non configuré';
  switch (row.status) {
    case 'ready':
      return 'Success';
    case 'error':
      return 'Failure';
    case 'creating':
      return 'Création en cours';
    case 'deploying':
      return 'Déploiement en cours';
    case 'scaling':
      return 'Redimensionnement en cours';
    case 'deleting':
      return 'Suppression en cours';
    case 'locked':
      return 'Verrouillé';
    default:
      return row.status ?? 'Inconnu';
  }
}

export function modelsOverviewHtml(
  webview: vscode.Webview,
  root: vscode.Uri,
  project: string | undefined,
  serverless: ListedModel[],
  dedicated: ListedModel[],
  dedicatedState: string,
): { html: string; token: string } {
  const token = randomBytes(24).toString('hex');
  const rows =
    project === undefined
      ? []
      : [
          ...serverless.filter(
            (row) => row.kind === 'serverless' && row.status !== 'deleted',
          ),
          ...dedicated.filter(
            (row) => row.kind === 'dedicated' && row.status !== 'deleted',
          ),
        ];
  const body =
    '<p class="subtitle">' +
    (project !== undefined
      ? 'Projet : ' + escapeHtml(project)
      : 'Choisissez un projet connecté et un espace de travail approuvé pour voir vos modèles.') +
    '</p>' +
    '<div class="actions"><button data-action="catalog">Ajouter un modèle</button><button data-action="refresh">Actualiser les ressources</button></div>' +
    '<p class="note">Serverless : Actualiser les ressources vérifie la présence du modèle dans la liste de l’API. Les accès affichés disposent d’une clé enregistrée, de métadonnées IAM vérifiées et d’un modèle annoncé par l’API. Ils ne prouvent pas une génération réussie. — signifie aucune vérification pour ce contexte ; une erreur ne signifie pas que le modèle est absent. Pour les déploiements dédiés, Success et Failure correspondent aux états ready et error retournés par l’API ; les états intermédiaires sont conservés. Date Serverless : création du modèle (created), pas de votre accès. Date dédiée : création du déploiement (created_at). Dates affichées dans le fuseau horaire local de VS Code. Une valeur absente, nulle ou invalide est affichée —. Ces états ne certifient pas l’accès à l’inférence.</p>' +
    (project !== undefined
      ? '<p role="status">Déploiements dédiés : ' +
        escapeHtml(dedicatedState) +
        '</p>'
      : '') +
    '<div class="table-scroll"><table><caption>Mes modèles</caption><thead><tr><th scope="col">Nom</th><th scope="col">Type d’inférence</th><th scope="col">status</th><th scope="col">Date de création</th><th scope="col">Action</th></tr></thead><tbody>' +
    rows
      .map(
        (row) =>
          '<tr><td>' +
          escapeHtml(row.label) +
          '</td><td>' +
          (row.kind === 'serverless' ? 'Serverless' : 'Dédié') +
          '</td><td>' +
          escapeHtml(deploymentState(row)) +
          '</td><td>' +
          escapeHtml(
            creationDate(
              row.kind === 'dedicated'
                ? row.deploymentInfo?.createdAt
                : row.serverlessCreatedAt,
            ),
          ) +
          '</td><td><button data-action="open" data-kind="' +
          row.kind +
          '" data-id="' +
          escapeHtml(row.id) +
          '" aria-label="Ouvrir ' +
          escapeHtml(row.label) +
          '">Ouvrir</button></td></tr>',
      )
      .join('') +
    (rows.length
      ? ''
      : '<tr><td colspan="5">Aucun modèle affiché. Ajoutez une référence depuis le catalogue ou actualisez les déploiements du projet.</td></tr>') +
    '</tbody></table></div>';
  return { html: page(webview, root, 'Modèles', body, token), token };
}
