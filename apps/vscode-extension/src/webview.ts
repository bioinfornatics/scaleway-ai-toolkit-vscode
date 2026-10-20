import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
export function playgroundHtml(
  webview: vscode.Webview,
  root: vscode.Uri,
): string {
  const nonce = randomBytes(24).toString('hex');
  const js = webview.asWebviewUri(
    vscode.Uri.joinPath(root, 'media', 'playground.js'),
  );
  const css = webview.asWebviewUri(
    vscode.Uri.joinPath(root, 'media', 'playground.css'),
  );
  return (
    '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src ' +
    webview.cspSource +
    "; script-src 'nonce-" +
    nonce +
    "'; connect-src 'none'; img-src 'none'; font-src 'none';\">" +
    '<link rel="stylesheet" href="' +
    css +
    '"></head><body><main>' +
    '<h1>Playground modèle</h1><p class="note">Tester une instruction, suivre la réponse et inspecter une expérience.</p>' +
    '<div class="badge">Démonstration hors ligne · aucun appel API · aucun coût</div>' +
    '<label for="model">Modèle de démonstration</label><select id="model"><option value="demo-general">General assistant</option><option value="demo-code">Coding assistant</option></select>' +
    '<label for="prompt">Instruction</label><textarea id="prompt" maxlength="4096" placeholder="Explique le rôle de cette extension"></textarea>' +
    '<div class="actions"><button id="run">▶ Exécuter</button><button id="stop" class="secondary" disabled>■ Arrêter</button><button id="experiment" class="secondary" disabled>Ouvrir l’expérience JSON</button></div>' +
    '<p id="status" role="status">Prêt · Ctrl+Entrée pour exécuter</p>' +
    '<h2>Réponse</h2><div id="response" aria-label="Réponse simulée" aria-busy="false">La réponse simulée apparaîtra ici.</div>' +
    '<p class="note">Votre instruction reste en mémoire. L’enregistrement est manuel depuis l’éditeur JSON.</p>' +
    '</main><script nonce="' +
    nonce +
    '" src="' +
    js +
    '"></script></body></html>'
  );
}
