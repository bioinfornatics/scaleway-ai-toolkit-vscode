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
  for (const field of ['access', 'secret']) {
    const input = {
      type: 'reveal-key',
      token,
      id: 'b'.repeat(32),
      field,
      request: 'c'.repeat(32),
    };
    assert.deepEqual(overview.parseOverviewInput(input), input);
    for (const bad of [
      { ...input, field: 'pair' },
      { ...input, request: 'raw' },
      { ...input, extra: 1 },
      { ...input, id: 'bad' },
      { ...input, request: undefined },
    ])
      assert.equal(overview.parseOverviewInput(bad), undefined);
  }
  assert.equal(
    overview.parseOverviewInput({
      type: 'reveal-key',
      token,
      id: 'b'.repeat(32),
    }),
    undefined,
  );
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

test('reveal button only for local rows, including expired copies; credentials and IAM paragraph absent', () => {
  for (const secretAvailable of [false, true]) {
    const { html } = overview.modelsOverviewHtml(
      webview,
      'root',
      'project',
      [
        key({
          secretAvailable,
          expiresAt: 1,
          accessKey: 'RAW_ACCESS',
          secretKey: 'RAW_SECRET',
        }),
      ],
      [],
      'ready',
    );
    assert.equal(
      (html.match(/data-action="reveal-key"/g) || []).length,
      secretAvailable ? 2 : 0,
    );
    assert.doesNotMatch(html, /Afficher access \+ secret/);
    if (secretAvailable) {
      assert.match(html, /data-field="access"/);
      assert.match(html, /data-field="secret"/);
      assert.match(html, /aria-pressed="false"/);
      assert.match(html, /<input readonly/);
    }
    assert.doesNotMatch(html, /RAW_ACCESS|RAW_SECRET|Une clé IAM appartient/);
  }
});

function rendererFixture() {
  const fs = require('node:fs'),
    vm = require('node:vm');
  const messages = [],
    events = {},
    documentEvents = {};
  const token = 'a'.repeat(48),
    id = 'b'.repeat(32);
  const buttons = ['access', 'secret'].map((field) => {
    const input = {
      value: field === 'access' ? 'SCW••••1234' : '••••••••',
      setAttribute() {},
    };
    return {
      dataset: { action: 'reveal-key', id, field },
      input,
      attributes: {},
      parentElement: { querySelector: () => input },
      setAttribute(k, v) {
        this.attributes[k] = v;
      },
      addEventListener(_event, fn) {
        this.click = fn;
      },
    };
  });
  const refresh = {
    dataset: { action: 'refresh' },
    addEventListener(_e, fn) {
      this.click = fn;
    },
  };
  const document = {
    hidden: false,
    querySelector: () => ({
      dataset: { token },
      querySelectorAll: () => [...buttons, refresh],
    }),
    addEventListener(e, fn) {
      documentEvents[e] = fn;
    },
  };
  let generation = 0;
  const source = fs.readFileSync('media/resourceOverview.js', 'utf8');
  assert.doesNotMatch(
    source,
    /setState|getState|localStorage|sessionStorage|clipboard|console\.|innerHTML|textContent\s*=\s*row/,
  );
  vm.runInNewContext(source, {
    acquireVsCodeApi: () => ({
      postMessage: (v) => messages.push(v),
      setState: () => assert.fail('no persistence'),
    }),
    crypto: {
      getRandomValues(bytes) {
        bytes.fill(++generation);
        return bytes;
      },
    },
    document,
    window: {
      addEventListener(e, fn) {
        events[e] = fn;
      },
    },
  });
  return {
    buttons,
    refresh,
    document,
    documentEvents,
    events,
    messages,
    reply(input, extra = {}) {
      events.message({
        data: {
          ...input,
          type: 'reveal-key-success',
          value:
            input.field === 'access'
              ? 'SCW12345678901234567'
              : '33333333-3333-3333-3333-333333333333',
          ...extra,
        },
      });
    },
  };
}

test('inline renderer reveals only requested field, clears on hide and ignores late/duplicate replies', () => {
  const f = rendererFixture(),
    [access, secret] = f.buttons;
  assert.equal(f.messages.length, 0);
  access.click();
  const first = f.messages[0];
  assert.equal(first.field, 'access');
  assert.match(first.request, /^[a-f0-9]{32}$/);
  access.click();
  f.reply(first);
  assert.equal(access.input.value, 'SCW••••1234');
  access.click();
  const second = f.messages[1];
  assert.notEqual(first.request, second.request);
  f.reply(first);
  assert.equal(access.input.value, 'SCW••••1234');
  f.reply(second);
  assert.equal(access.input.value, 'SCW12345678901234567');
  assert.equal(secret.input.value, '••••••••');
  assert.equal(access.attributes['aria-pressed'], 'true');
  secret.click();
  f.reply(f.messages[2]);
  assert.equal(secret.input.value, '33333333-3333-3333-3333-333333333333');
  access.click();
  assert.equal(access.input.value, 'SCW••••1234');
  assert.equal(access.attributes['aria-pressed'], 'false');
  f.reply(second);
  assert.equal(access.input.value, 'SCW••••1234');
  secret.click();
  assert.equal(secret.input.value, '••••••••');
});

test('renderer rejects malformed, forged, unrequested and wrong token/field responses', () => {
  const f = rendererFixture(),
    [access, secret] = f.buttons;
  access.click();
  const input = f.messages[0];
  for (const extra of [
    { token: 'c'.repeat(48) },
    { id: 'f'.repeat(32) },
    { field: 'secret' },
    { field: 'pair' },
    { request: 'c'.repeat(32) },
    { value: '<script>bad</script>' },
    { value: 12 },
    { extra: 1 },
    { type: 'reveal-key' },
    { token: undefined },
  ]) {
    f.reply(input, extra);
    assert.equal(access.input.value, 'SCW••••1234');
    assert.equal(secret.input.value, '••••••••');
  }
  for (const data of [null, [], {}, 'bad']) f.events.message({ data });
  f.reply(input, { type: 'reveal-key-error' }); // success-shaped error is rejected
  assert.equal(access.attributes['aria-pressed'], 'true');
  f.events.message({ data: { ...input, type: 'reveal-key-error' } });
  assert.equal(access.attributes['aria-pressed'], 'false');
  f.reply(input);
  assert.equal(access.input.value, 'SCW••••1234');
});

test('blur, pagehide, visibility and other actions clear all plaintext and pending responses', () => {
  for (const clear of [
    (f) => f.events.blur(),
    (f) => f.events.pagehide(),
    (f) => {
      f.document.hidden = true;
      f.documentEvents.visibilitychange();
    },
    (f) => f.refresh.click(),
  ]) {
    const f = rendererFixture(),
      [access, secret] = f.buttons;
    access.click();
    f.reply(f.messages[0]);
    secret.click();
    const pending = f.messages[1];
    clear(f);
    f.reply(pending);
    assert.equal(access.input.value, 'SCW••••1234');
    assert.equal(secret.input.value, '••••••••');
    assert.ok(f.buttons.every((b) => b.attributes['aria-pressed'] === 'false'));
  }
});
