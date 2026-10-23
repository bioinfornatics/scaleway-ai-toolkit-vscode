const assert = require('node:assert/strict');
const { test } = require('node:test');
process.env.TZ = 'Europe/Paris';
const Module = require('node:module');
const load = Module._load;
Module._load = function (name, ...args) {
  if (name === 'vscode')
    return { Uri: { joinPath: (_root, ...parts) => parts.join('/') } };
  return load.call(this, name, ...args);
};
let overview;
try {
  overview = require('../dist/resourceOverview');
} finally {
  Module._load = load;
}
const webview = {
  cspSource: 'vscode-webview:',
  asWebviewUri: (value) => value,
};

test('overview parser exact fields, identities, token and bounded IDs', () => {
  const token = 'a'.repeat(48),
    valid = { type: 'open', kind: 'serverless', id: 'model', token };
  assert.deepEqual(overview.parseOverviewInput(valid), valid);
  assert.deepEqual(overview.parseOverviewInput({ type: 'refresh', token }), {
    type: 'refresh',
    token,
  });
  assert.deepEqual(overview.parseOverviewInput({ type: 'catalog', token }), {
    type: 'catalog',
    token,
  });
  for (const input of [
    null,
    [],
    {},
    { ...valid, token: 'A'.repeat(48) },
    { ...valid, token: 'a'.repeat(47) },
    { ...valid, id: '' },
    { ...valid, id: 'a'.repeat(513) },
    { ...valid, id: String.fromCharCode(0) },
    { ...valid, id: String.fromCharCode(31) },
    { ...valid, id: String.fromCharCode(127) },
    { ...valid, kind: 'dedicated-catalog' },
    { ...valid, extra: 1 },
    { type: 'refresh', token, id: 'model' },
  ]) {
    assert.equal(overview.parseOverviewInput(input), undefined);
  }
});

test('models render escaped text, explicit reference status, CSP and no catalogue offers', () => {
  const row = {
    id: 'id"<&',
    label: '<script>secret</script>',
    kind: 'serverless',
  };
  const { html, token } = overview.modelsOverviewHtml(
    webview,
    'root',
    '<Project>',
    [row],
    [
      { id: 'offer', label: 'Commercial offer', kind: 'dedicated-catalog' },
      {
        id: 'deleted',
        label: 'Deleted deployment',
        kind: 'dedicated',
        status: 'deleted',
      },
      { id: 'dep', label: 'Deployment', kind: 'dedicated', status: '<error>' },
    ],
    '<state>',
  );
  assert.equal(token.length, 48);
  assert.doesNotMatch(
    html,
    /<script>secret|Commercial offer|Deleted deployment|<Project>|<state>|<error>/,
  );
  assert.match(html, /&lt;script&gt;secret/);
  assert.match(html, /métadonnées IAM vérifiées/);
  assert.ok(html.includes('<th scope="col">status</th>'));
  assert.ok(!html.includes('État / disponibilité'));
  assert.ok(html.includes('<th scope="col">Date de création</th>'));
  assert.ok(!html.includes('Date de création (modèle / déploiement)'));
  const dated = overview.modelsOverviewHtml(
    webview,
    'root',
    'Project',
    [{ ...row, serverlessCreatedAt: '2026-10-21T12:00:00.000Z' }],
    [],
    'Loaded',
  );
  assert.ok(dated.html.includes('21/10/2026 à 14:00'));
  assert.match(dated.html, /création du modèle/);
  assert.doesNotMatch(
    html,
    /Accès à l’inférence non testé|Référence locale · accès non vérifié/,
  );
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /nonce-/);
  const empty = overview.modelsOverviewHtml(
    webview,
    'root',
    undefined,
    [row],
    [],
    'error',
  );
  assert.doesNotMatch(empty.html, /secret/);
  assert.match(empty.html, /Aucun modèle affiché/);
  assert.notEqual(empty.token, token);
});

test('creation dates are readable in local time with DST and invalid fallback', () => {
  for (const [value, expected] of [
    ['2026-10-05T14:44:44.000Z', '05/10/2026 à 16:44'],
    ['2026-12-05T14:44:44.000Z', '05/12/2026 à 15:44'],
    [undefined, '—'],
    ['invalid', '—'],
  ]) {
    const { html } = overview.modelsOverviewHtml(
      webview,
      'root',
      'Project',
      [
        {
          id: 'model',
          label: 'Model',
          kind: 'serverless',
          serverlessCreatedAt: value,
        },
      ],
      [],
      'Loaded',
    );
    assert.ok(html.includes('<td>' + expected + '</td>'));
  }
});

test('removed preview actions are not accepted by the current model overview protocol', () => {
  const token = 'a'.repeat(48);
  for (const type of ['templates', 'back', 'template'])
    assert.equal(overview.parseOverviewInput({ type, token }), undefined);
});
