const assert = require('node:assert/strict');
const { test } = require('node:test');
process.env.TZ = 'Europe/Paris';
const Module = require('node:module');
const provider = require('../dist/provider');
const old = Module._load;
Module._load = function (name, ...args) {
  return name === 'vscode'
    ? { Uri: { joinPath: (_root, ...parts) => parts.join('/') } }
    : old.call(this, name, ...args);
};
let overview;
try {
  overview = require('../dist/resourceOverview');
} finally {
  Module._load = old;
}
const project = {
  id: '11111111-1111-1111-1111-111111111111',
  organizationId: '22222222-2222-2222-2222-222222222222',
  name: 'Project',
};
const base = {
  id: '33333333-3333-3333-3333-333333333333',
  project_id: project.id,
  region: 'fr-par',
  name: 'Deployment',
};
const webview = { cspSource: 'vscode-webview:', asWebviewUri: (uri) => uri };
test('API deployment creation date is retained; missing/invalid date never invented', () => {
  const date = '2026-10-20T12:00:00Z';
  assert.equal(
    provider.parseDeployment({ ...base, created_at: date }, project)
      .deploymentInfo.createdAt,
    '2026-10-20T12:00:00.000Z',
  );
  for (const created_at of [undefined, null, 'bad', '<script>', 12]) {
    assert.equal(
      provider.parseDeployment({ ...base, created_at }, project).deploymentInfo
        .createdAt,
      undefined,
    );
  }
});
test('ready/error map to Success/Failure; intermediate states are not reported as failure', () => {
  for (const [status, expected] of [
    ['ready', 'Success'],
    ['error', 'Failure'],
    ['creating', 'Création en cours'],
    ['deploying', 'Déploiement en cours'],
    ['scaling', 'Redimensionnement en cours'],
    ['locked', 'Verrouillé'],
  ]) {
    const row = provider.parseDeployment(
      { ...base, status, created_at: '2026-10-20T12:00:00Z' },
      project,
    );
    const { html } = overview.modelsOverviewHtml(
      webview,
      'root',
      project.name,
      [],
      [row],
      'Loaded',
      'Non chargé',
      'dedicated',
    );
    assert.ok(html.includes(`<td>${expected}</td>`));
    assert.ok(html.includes('20/10/2026 à 14:00'));
  }
});
test('Serverless selection is never a key row or deployment success/creation date', () => {
  const selection = {
    id: 'deepseek-v4.1-flash',
    label: 'DeepSeek',
    kind: 'serverless',
    status: 'ready',
  };
  for (const mode of ['keys', 'dedicated']) {
    const { html } = overview.modelsOverviewHtml(
      webview,
      'root',
      project.name,
      [],
      [selection],
      'Loaded',
      'Non chargé',
      mode,
    );
    for (const forbidden of [
      'DeepSeek',
      'deepseek-v4.1-flash',
      '<td>Success</td>',
      'Accès configuré',
    ])
      assert.ok(!html.includes(forbidden));
    assert.ok(
      html.includes(
        mode === 'keys' ? 'Aucune clé affichée' : 'Aucun déploiement affiché',
      ),
    );
  }
});
