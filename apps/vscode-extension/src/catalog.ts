import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
export type CatalogInput = { type: 'ready' | 'refresh' | 'project' };
export function parseCatalogInput(value: unknown): CatalogInput | undefined {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1
  )
    return;
  const type = (value as { type?: unknown }).type;
  if (type === 'ready' || type === 'refresh' || type === 'project')
    return { type };
}
export function catalogHtml(webview: vscode.Webview, root: vscode.Uri): string {
  const nonce = randomBytes(24).toString('hex');
  const js = webview.asWebviewUri(
    vscode.Uri.joinPath(root, 'media', 'catalog.js'),
  );
  const css = webview.asWebviewUri(
    vscode.Uri.joinPath(root, 'media', 'catalog.css'),
  );
  return (
    '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src ' +
    webview.cspSource +
    "; script-src 'nonce-" +
    nonce +
    "'; connect-src 'none'; img-src 'none'; base-uri 'none';\">" +
    '<link rel="stylesheet" href="' +
    css +
    '"></head><body><main><h1>Catalogue de modèles Scaleway</h1>' +
    '<p>Découvrir les offres Serverless et les modèles dédiés à déployer. Ce catalogue ne lance aucune inférence et ne crée aucune ressource.</p>' +
    '<div class="actions"><button id="refresh">Actualiser</button><button id="project">Choisir le projet Scaleway</button></div>' +
    '<p id="scope" role="status">Catalogue public disponible sans connexion. Projet dédié non sélectionné.</p>' +
    '<label for="search">Rechercher un modèle</label><input id="search" type="search" placeholder="Nom du modèle ou statut">' +
    '<h2>Serverless · offres publiques</h2><p id="public-status" role="status">Chargement du catalogue public…</p><div id="public-list" class="grid"></div>' +
    '<h2>Modèles dédiés à déployer · fr-par</h2><p id="dedicated-status" role="status">Sélectionnez un projet pour le catalogue dédié.</p><div id="dedicated-list" class="grid"></div>' +
    '<p class="note">Source Serverless : catalogue commercial public Scaleway, variantes regroupées par produit. Le statut catalogue ne garantit pas l’accès à l’inférence. Les offres retirées sont conservées avec leur statut. Les déploiements existants sont dans Mes ressources.</p>' +
    '</main><script nonce="' +
    nonce +
    '" src="' +
    js +
    '"></script></body></html>'
  );
}
