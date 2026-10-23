import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import {
  type DedicatedEndpointApproval,
  dedicatedInvocationPolicy,
} from './dedicatedInvocationPolicy';
import type { ListedModel, Project } from './provider';

function escapeHtml(value: string): string {
  const entities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return value.replace(/[&<>"']/g, (character) => entities[character]);
}

/** Real service presentation only. Credentials and transport stay in the host. */
export function servicePlaygroundHtml(
  webview: vscode.Webview,
  root: vscode.Uri,
  model: ListedModel,
  project: Project,
  supported: boolean,
  approval?: DedicatedEndpointApproval,
): string {
  const nonce = randomBytes(24).toString('hex');
  const script = escapeHtml(
    webview
      .asWebviewUri(vscode.Uri.joinPath(root, 'media', 'servicePlayground.js'))
      .toString(),
  );
  const css = escapeHtml(
    webview
      .asWebviewUri(vscode.Uri.joinPath(root, 'media', 'playground.css'))
      .toString(),
  );
  const decision = approval
    ? dedicatedInvocationPolicy(model, project, approval)
    : undefined;
  const dedicated = model.kind === 'dedicated';
  const allowedDedicated = decision?.allowed === true;
  const blocked = dedicated
    ? !allowedDedicated
    : model.kind !== 'serverless' || !supported;
  const destination = allowedDedicated
    ? escapeHtml(decision.url)
    : blocked
      ? model.kind !== 'serverless'
        ? 'Blocked: dedicated services are not supported in this text playground.'
        : 'Blocked: this offer is not applicable to the text chat operation or is retired.'
      : escapeHtml(`https://api.scaleway.ai/${project.id}/v1/chat/completions`);
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'none'; img-src 'none'; font-src 'none'; base-uri 'none'; form-action 'none';">
<link nonce="${nonce}" rel="stylesheet" href="${css}">
<title>Real service text playground</title>
</head>
<body><main id="service-playground" data-blocked="${blocked}">
<h1>Real service text playground</h1>
<div class="badge">Real Scaleway service · ${dedicated ? 'dedicated deployment-duration billing' : 'billable API request'}</div>
<section aria-label="Selected service">
<h2>${escapeHtml(model.label)}</h2>
<p>${dedicated ? 'Deployment' : 'Model'} ID: <code>${escapeHtml(model.id)}</code></p>
<p>Project: ${escapeHtml(project.name)} · UUID: <code>${escapeHtml(project.id)}</code></p>
<p>Destination: <code>${destination}</code></p>
${allowedDedicated ? '<p>Dedicated model: <code>' + escapeHtml(decision.modelName) + '</code></p><p>Endpoint authentication: ' + (decision.authentication === 'iam' ? 'IAM · API key sent on Run only' : 'DISABLED · public unauthenticated endpoint · no token sent') + '</p><p>Endpoint trust approval: 30 minutes (UI product policy, not a cloud-agent mandate). Connectivity and IAM permissions unverified.</p>' : ''}
<p id="blocked-note">${blocked ? 'Run is blocked. No demo response will be substituted.' : allowedDedicated ? 'Dedicated text chat · exact approved public endpoint.' : model.serverlessCapabilities?.textChat === 'supported' ? 'Serverless text chat completions.' : 'Chat capability metadata unavailable. You may explicitly Run; the provider may reject this operation or its parameters.'}</p>
</section>
<section aria-label="Billing warning">
<h2>Billing warning</h2>
<p id="billing-warning">${dedicated ? 'Dedicated billing is based on deployment duration, not tokens. No serverless token cost estimate applies. Billing may continue while this panel is closed. ' : ''}Seul Exécuter envoie un appel facturé. Only Run sends one billable request. Stop cancels locally; it is not guaranteed to stop server-side processing or billing. Opening this panel does not send an inference request.</p>
</section>
<label for="prompt">Prompt</label>
<textarea id="prompt" maxlength="4096" aria-describedby="billing-warning" placeholder="Enter a text instruction"></textarea>
<label for="maxTokens">Maximum output tokens (1–2048)</label>
<input id="maxTokens" type="number" min="1" max="2048" step="1" value="256">
<div class="actions"><button id="run" disabled>Exécuter</button><button id="stop" class="secondary" disabled>Arrêter</button></div>
<p id="status" role="status" aria-live="polite">${blocked ? 'Blocked: unsupported service.' : 'Waiting for the extension host · Ctrl+Enter to run.'}</p>
<h2>Response (plain text)</h2>
<div id="response" aria-label="Service response" aria-busy="false"></div>
<p id="usage">Tokens : indisponible</p>
<p id="cost">Coût : indisponible</p>
<div class="actions"><button id="saveExchange" class="secondary" disabled>Save exchange</button><button id="loadSnapshot" class="secondary" disabled>Load snapshot (review)</button><button id="exportExample" class="secondary" disabled>Export example</button></div>
<p id="action-status" role="status" aria-live="polite"></p>
<p class="note">Save and export include prompts and outputs explicitly. Review sensitive data before saving or sharing. No hidden storage. Loaded snapshots open read-only for review: no scope switch, restored consent, or automatic run. Export opens Python/TypeScript source only, never executes it.</p>
<hr>
<section aria-label="Offline demo separation"><h2>Offline demo — separate tool</h2><p class="note">This is not the offline playground. The separate offline demo uses simulated responses with no API request or cost. This panel never substitutes demo output for a real service.</p></section>
</main><script nonce="${nonce}" src="${script}"></script></body>
</html>`;
}
