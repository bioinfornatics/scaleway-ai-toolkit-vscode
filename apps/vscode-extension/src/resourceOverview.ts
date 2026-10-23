import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { ApiKeyResource } from './llmAccessRegistry';
import type { ListedModel } from './provider';

export type OverviewInput =
  | { type: 'catalog' | 'refresh' | 'add-key'; token: string }
  | { type: 'import-key' | 'use-key'; id: string; token: string }
  | {
      type: 'open';
      kind: 'dedicated';
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
    (row.type === 'catalog' || row.type === 'refresh' || row.type === 'add-key')
  ) {
    return { type: row.type, token: row.token };
  }
  if (
    Object.keys(row).length === 3 &&
    (row.type === 'import-key' || row.type === 'use-key') &&
    typeof row.id === 'string' &&
    /^[a-f0-9]{32}$/.test(row.id)
  )
    return { type: row.type, id: row.id, token: row.token };
  if (
    Object.keys(row).length === 4 &&
    row.type === 'open' &&
    row.kind === 'dedicated' &&
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
  keys: ApiKeyResource[],
  dedicated: ListedModel[],
  dedicatedState: string,
  keyState = 'Non chargé',
  mode: 'keys' | 'dedicated' = 'keys',
): { html: string; token: string } {
  const token = randomBytes(24).toString('hex');
  const rows =
    project === undefined
      ? []
      : dedicated.filter(
          (row) => row.kind === 'dedicated' && row.status !== 'deleted',
        );
  const inventory = project === undefined ? [] : keys;
  const scope =
    '<p class="subtitle">' +
    (project !== undefined
      ? 'Projet : ' +
        escapeHtml(project) +
        ' · clés de l’organisation, secrets locaux de ce contexte'
      : 'Choisissez un projet connecté et un workspace approuvé pour consulter les ressources.') +
    '</p>';
  const actions =
    '<div class="actions">' +
    (mode === 'keys'
      ? '<button data-action="add-key">+ Ajouter une clé API</button>'
      : '') +
    '<button data-action="catalog">Catalogue de modèles</button><button data-action="refresh">Actualiser</button></div>';
  const keyBody =
    '<p class="note">Une clé IAM appartient à un utilisateur ou une application, pas à un modèle. Elle est réutilisable selon les politiques IAM, les quotas et la disponibilité. Le secret n’est retourné qu’à la création : l’inventaire ne permet pas de le récupérer. « Présent localement » indique seulement un secret conservé dans SecretStorage pour ce contexte ; ni ses droits sur le projet ni une inférence réussie ne sont certifiés.</p>' +
    '<p role="status">Clés API : ' +
    escapeHtml(keyState) +
    '</p>' +
    '<div class="table-scroll"><table><caption>Clés API de l’organisation</caption><thead><tr><th scope="col">Description</th><th scope="col">Clé masquée</th><th scope="col">Titulaire</th><th scope="col">Expiration</th><th scope="col">Secret local</th><th scope="col">Action</th></tr></thead><tbody>' +
    inventory
      .map((key) => {
        const expired = key.expiresAt <= Date.now() + 30000;
        const expiry =
          key.expiresAt === Number.MAX_SAFE_INTEGER
            ? 'Sans expiration (IAM)'
            : creationDate(new Date(key.expiresAt).toISOString()) +
              (expired ? ' · expirée / imminente' : '');
        const action = expired
          ? 'Indisponible'
          : '<button data-action="' +
            (key.secretAvailable ? 'use-key' : 'import-key') +
            '" data-id="' +
            escapeHtml(key.id) +
            '">' +
            (key.secretAvailable ? 'Choisir un modèle' : 'Importer le secret') +
            '</button>';
        return (
          '<tr><td>' +
          escapeHtml(key.description || 'Sans description') +
          '</td><td>' +
          escapeHtml(key.maskedAccessKey) +
          '</td><td>' +
          (key.bearerType === 'application'
            ? 'Application IAM'
            : 'Utilisateur IAM') +
          '</td><td>' +
          escapeHtml(expiry) +
          '</td><td>' +
          (key.secretAvailable ? 'Présent localement' : 'Non enregistré') +
          '</td><td>' +
          action +
          '</td></tr>'
        );
      })
      .join('') +
    (inventory.length
      ? ''
      : '<tr><td colspan="6">Aucune clé affichée. Un inventaire non chargé ou refusé ne signifie pas qu’aucune clé existe.</td></tr>') +
    '</tbody></table></div>';
  const deploymentBody =
    '<p class="note">Ressources cloud dédiées, distinctes des modèles du catalogue et des clés API. Success / Failure correspondent à ready / error ; ces états ne certifient pas une inférence. Dates dans le fuseau horaire local.</p><p role="status">Déploiements dédiés : ' +
    escapeHtml(dedicatedState) +
    '</p><div class="table-scroll"><table><caption>Déploiements dédiés</caption><thead><tr><th scope="col">Nom</th><th scope="col">Modèle</th><th scope="col">status</th><th scope="col">Date de création</th><th scope="col">Action</th></tr></thead><tbody>' +
    rows
      .map(
        (row) =>
          '<tr><td>' +
          escapeHtml(row.label) +
          '</td><td>' +
          escapeHtml(
            row.deploymentInfo?.modelName ?? row.deploymentInfo?.modelId ?? '—',
          ) +
          '</td><td>' +
          escapeHtml(deploymentState(row)) +
          '</td><td>' +
          escapeHtml(creationDate(row.deploymentInfo?.createdAt)) +
          '</td><td><button data-action="open" data-kind="dedicated" data-id="' +
          escapeHtml(row.id) +
          '" aria-label="Ouvrir ' +
          escapeHtml(row.label) +
          '">Ouvrir</button></td></tr>',
      )
      .join('') +
    (rows.length
      ? ''
      : '<tr><td colspan="5">Aucun déploiement affiché. Actualisez pour vérifier l’inventaire du projet.</td></tr>') +
    '</tbody></table></div>';
  const title = mode === 'keys' ? 'Clés API' : 'Déploiements dédiés';
  return {
    html: page(
      webview,
      root,
      title,
      scope + actions + (mode === 'keys' ? keyBody : deploymentBody),
      token,
    ),
    token,
  };
}
