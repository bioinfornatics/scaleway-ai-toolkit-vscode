import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { text, uuid } from './provider';
export type CatalogInput =
  | { type: 'ready' | 'refresh' | 'project' }
  | { type: 'prepare' | 'eula'; id: string }
  | {
      type: 'rendered';
      revision: number;
      publicCards: number;
      dedicatedCards: number;
      priceCards: number;
    }
  | { type: 'details'; kind: 'serverless' | 'dedicated-catalog'; id: string };
export function parseCatalogInput(value: unknown): CatalogInput | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const message = value as Record<string, unknown>;
  if (
    Object.keys(message).length === 1 &&
    (message.type === 'ready' ||
      message.type === 'refresh' ||
      message.type === 'project')
  )
    return { type: message.type };
  if (
    message.type === 'rendered' &&
    Object.keys(message).length === 5 &&
    Number.isSafeInteger(message.revision) &&
    Number(message.revision) > 0 &&
    Number.isSafeInteger(message.publicCards) &&
    Number(message.publicCards) >= 0 &&
    Number(message.publicCards) <= 500 &&
    Number.isSafeInteger(message.dedicatedCards) &&
    Number(message.dedicatedCards) >= 0 &&
    Number(message.dedicatedCards) <= 500 &&
    Number.isSafeInteger(message.priceCards) &&
    Number(message.priceCards) >= 0 &&
    Number(message.priceCards) <= 500
  )
    return {
      type: 'rendered',
      revision: Number(message.revision),
      publicCards: Number(message.publicCards),
      dedicatedCards: Number(message.dedicatedCards),
      priceCards: Number(message.priceCards),
    };
  if (
    (message.type === 'prepare' || message.type === 'eula') &&
    Object.keys(message).length === 2 &&
    uuid(message.id)
  )
    return { type: message.type, id: message.id };
  if (
    message.type === 'details' &&
    Object.keys(message).length === 3 &&
    (message.kind === 'serverless' || message.kind === 'dedicated-catalog') &&
    text(message.id)
  )
    return { type: 'details', kind: message.kind, id: message.id };
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
    '<label for="search">Rechercher un modèle</label><input id="search" type="search" placeholder="Nom du modèle ou statut" aria-describedby="search-results"><p id="search-results" role="status" aria-live="polite" aria-atomic="true"></p>' +
    '<section id="model-details" hidden aria-labelledby="detail-title"><h2 id="detail-title" tabindex="-1"></h2><p id="detail-status"></p><p id="detail-source"></p><p id="detail-scope"></p><p id="detail-limits"></p><button id="close-details">Fermer les détails</button></section>' +
    '<section aria-labelledby="price-title"><h2 id="price-title">Tarifs dédiés · infrastructure GPU</h2><p id="price-status" role="status">Chargement des tarifs publics…</p><p>Prix par nœud, pas par token. Choisissez un modèle dédié pour vérifier le matériel compatible. Tarif public HT, pas devis du compte ; facturation à la durée même sans trafic.</p><div id="price-list" class="grid"></div></section>' +
    '<h2>Serverless · offres publiques</h2><p>Prix publics HT par unité indiquée sur chaque carte (entrée/sortie en temps réel). Ce ne sont pas des prix de GPU dédié ; remises et free tier du compte non déduits.</p><p id="public-status" role="status">Chargement du catalogue public…</p><div id="public-list" class="grid"></div>' +
    '<h2>Modèles dédiés à déployer · fr-par</h2><p id="dedicated-status" role="status">Sélectionnez un projet pour le catalogue dédié.</p><div id="dedicated-list" class="grid"></div>' +
    '<p class="note">Source Serverless : catalogue commercial public Scaleway, variantes regroupées par produit. Le statut catalogue ne garantit pas l’accès à l’inférence. Les offres retirées (retired / end_of_life) sont masquées par défaut. Les déploiements existants sont dans Mes ressources.</p>' +
    '</main><script nonce="' +
    nonce +
    '" src="' +
    js +
    '"></script></body></html>'
  );
}
