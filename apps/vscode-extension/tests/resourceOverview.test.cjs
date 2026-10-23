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

const key = (extra = {}) => ({
  id: 'b'.repeat(32),
  description: '<script>description</script>',
  maskedAccessKey: 'SCW••••1234',
  bearerType: 'application',
  expiresAt: Number.MAX_SAFE_INTEGER,
  secretAvailable: false,
  ...extra,
});

test('parser exact fields, tokenized key actions and dedicated IDs only', () => {
  const token = 'a'.repeat(48),
    valid = { type: 'open', kind: 'dedicated', id: 'deployment', token };
  assert.deepEqual(overview.parseOverviewInput(valid), valid);
  for (const type of ['catalog', 'refresh', 'add-key'])
    assert.deepEqual(overview.parseOverviewInput({ type, token }), {
      type,
      token,
    });
  for (const type of ['import-key', 'use-key']) {
    const input = { type, id: 'b'.repeat(32), token };
    assert.deepEqual(overview.parseOverviewInput(input), input);
    for (const id of [
      '',
      'raw-key',
      'B'.repeat(32),
      'b'.repeat(31),
      'b'.repeat(33),
    ])
      assert.equal(overview.parseOverviewInput({ ...input, id }), undefined);
    assert.equal(
      overview.parseOverviewInput({ ...input, extra: true }),
      undefined,
    );
  }
  for (const input of [
    null,
    [],
    {},
    { ...valid, token: 'A'.repeat(48) },
    { ...valid, token: 'a'.repeat(47) },
    { ...valid, id: '' },
    { ...valid, id: 'a'.repeat(513) },
    ...[0, 31, 127].map((code) => ({
      ...valid,
      id: String.fromCharCode(code),
    })),
    { ...valid, kind: 'serverless' },
    { ...valid, kind: 'dedicated-catalog' },
    { ...valid, extra: 1 },
    { type: 'refresh', token, id: 'model' },
    ...['templates', 'back', 'template'].map((type) => ({ type, token })),
  ])
    assert.equal(overview.parseOverviewInput(input), undefined);
});

test('keys view escapes masked metadata, omits raw credentials and deployment rows', () => {
  const resource = key({
    accessKey: 'RAW_ACCESS_KEY',
    secretKey: 'RAW_SECRET_KEY',
    bearerId: 'PRIVATE_BEARER',
  });
  const { html, token } = overview.modelsOverviewHtml(
    webview,
    'root',
    '<Project>',
    [resource],
    [{ id: 'dep', label: 'Deployment only', kind: 'dedicated' }],
    '<dedicated-state>',
    '<key-state>',
  );
  assert.equal(token.length, 48);
  for (const text of [
    '<h1>Clés API</h1>',
    '&lt;script&gt;description&lt;/script&gt;',
    'SCW••••1234',
    '&lt;Project&gt;',
    '&lt;key-state&gt;',
    'Application IAM',
    'Sans expiration (IAM)',
    'Non enregistré',
    'data-action="import-key"',
    "connect-src 'none'",
    "default-src 'none'",
    'nonce-',
    'ni ses droits sur le projet ni une inférence réussie ne sont certifiés',
  ])
    assert.ok(html.includes(text), text);
  assert.doesNotMatch(
    html,
    /RAW_ACCESS_KEY|RAW_SECRET_KEY|PRIVATE_BEARER|<script>description|Deployment only|dedicated-state/,
  );
  const empty = overview.modelsOverviewHtml(
    webview,
    'root',
    undefined,
    [resource],
    [],
    'Loaded',
  );
  assert.doesNotMatch(empty.html, /description|SCW••••1234/);
  assert.match(empty.html, /Aucune clé affichée/);
  assert.notEqual(empty.token, token);
});

test('key actions distinguish local/absent secret and expired/imminent/unlimited keys', () => {
  for (const [extra, action, text] of [
    [{ secretAvailable: true }, 'use-key', 'Présent localement'],
    [{ secretAvailable: false }, 'import-key', 'Non enregistré'],
    [
      { expiresAt: Date.now() - 60000, secretAvailable: true },
      undefined,
      'Indisponible',
    ],
    [{ expiresAt: Date.now() + 10000 }, undefined, 'Indisponible'],
  ]) {
    const { html } = overview.modelsOverviewHtml(
      webview,
      'root',
      'Project',
      [key(extra)],
      [],
      'Loaded',
    );
    assert.ok(html.includes(text));
    if (action) assert.ok(html.includes(`data-action="${action}"`));
    else assert.doesNotMatch(html, /data-action="(?:import-key|use-key)"/);
  }
});

test('dedicated view excludes keys, Serverless, deleted deployments and catalogue offers', () => {
  const { html } = overview.modelsOverviewHtml(
    webview,
    'root',
    'Project',
    [key()],
    [
      { id: 'offer', label: 'Commercial offer', kind: 'dedicated-catalog' },
      { id: 'model', label: 'Serverless selection', kind: 'serverless' },
      {
        id: 'deleted',
        label: 'Deleted deployment',
        kind: 'dedicated',
        status: 'deleted',
      },
      {
        id: 'id"<&',
        label: '<Deployment>',
        kind: 'dedicated',
        status: '<error>',
        deploymentInfo: { modelName: '<Model>' },
      },
    ],
    '<state>',
    'key inventory',
    'dedicated',
  );
  for (const text of [
    '<h1>Déploiements dédiés</h1>',
    '&lt;Deployment&gt;',
    '&lt;Model&gt;',
    '&lt;error&gt;',
    '&lt;state&gt;',
    'data-id="id&quot;&lt;&amp;"',
    '<th scope="col">status</th>',
    '<th scope="col">Date de création</th>',
  ])
    assert.ok(html.includes(text), text);
  assert.doesNotMatch(
    html,
    /Commercial offer|Deleted deployment|Serverless selection|SCW••••1234|key inventory|data-action="add-key"/,
  );
});

test('deployment dates use local DST and invalid fallback', () => {
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
      [],
      [
        {
          id: 'dep',
          label: 'Deployment',
          kind: 'dedicated',
          deploymentInfo: { createdAt: value },
        },
      ],
      'Loaded',
      'Non chargé',
      'dedicated',
    );
    assert.ok(html.includes(`<td>${expected}</td>`));
  }
});
