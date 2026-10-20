const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const Module = require('node:module');
const original = Module._load;
Module._load = function (name, ...args) {
  return name === 'vscode' ? {} : original.call(this, name, ...args);
};
const { parseCatalogInput } = require('../dist/catalog');
Module._load = original;
test('closed catalog IPC excludes credentials and arbitrary provider routes', () => {
  for (const value of [
    null,
    [],
    { type: 'ready', secret: 'x' },
    { type: 'refresh', endpoint: 'evil' },
    { type: 'run' },
    { type: 'project', uuid: 'x' },
  ])
    assert.equal(parseCatalogInput(value), undefined);
  for (const type of ['ready', 'refresh', 'project'])
    assert.deepEqual(parseCatalogInput({ type }), { type });
});
test('catalog renderer has text-only model cards and no browser HTTP', () => {
  const s = fs.readFileSync('media/catalog.js', 'utf8');
  assert.ok(!/innerHTML|fetch?\(/.test(s));
  assert.match(s, /title\.textContent\s*=\s*row\.label/);
  assert.ok(s.includes('root.replaceChildren()'));
  const host = fs.readFileSync('src/extension.ts', 'utf8');
  const a = host.indexOf("register('scalewayAI.openCatalog'");
  const b = host.indexOf("register('scalewayAI.disconnect'", a);
  assert.ok(
    host.slice(a, b).indexOf('createWebviewPanel') <
      host.slice(a, b).indexOf('await connection.loadPublicCatalog()'),
  );
});

test('implemented navigation separates discover, build, recent and local demo; project chooser is not cloud creation', () => {
  const source = fs.readFileSync('src/extension.ts', 'utf8');
  for (const text of [
    'Récents',
    'Ressources locales',
    'Construire',
    'scalewayAI.setProject',
    'Changer de projet',
  ])
    assert.ok(source.includes(text));
  assert.ok(!source.includes("label: 'Construire et tester'"));
  const pkg = require('../package.json');
  assert.ok(
    pkg.contributes.commands.some((c) => c.command === 'scalewayAI.setProject'),
  );
  assert.ok(
    !pkg.contributes.commands.some(
      (c) => c.command === 'scalewayAI.createProject',
    ),
  );
});

test('details IPC accepts bounded identity only, no routes or extra fields', () => {
  assert.deepEqual(
    parseCatalogInput({ type: 'details', kind: 'serverless', id: 'model' }),
    { type: 'details', kind: 'serverless', id: 'model' },
  );
  for (const value of [
    { type: 'details', kind: 'dedicated', id: 'model' },
    { type: 'details', kind: 'serverless', id: '' },
    { type: 'details', kind: 'serverless', id: 'a'.repeat(257) },
    { type: 'details', kind: 'serverless', id: 'model', endpoint: 'evil' },
  ])
    assert.equal(parseCatalogInput(value), undefined);
});
test('details resolved from host catalog, not browser-provided metadata', () => {
  const { catalogDetails } = require('../dist/catalogDetails');
  const rows = [
    { id: 'a', label: 'Actual model', kind: 'serverless', status: 'preview' },
    { id: 'b', label: 'Old', kind: 'serverless', status: 'retired' },
  ];
  assert.equal(
    catalogDetails(rows, 'serverless', 'missing', 'scope'),
    undefined,
  );
  assert.equal(catalogDetails(rows, 'serverless', 'b', 'scope'), undefined);
  assert.equal(
    catalogDetails(rows, 'dedicated-catalog', 'a', 'scope'),
    undefined,
  );
  const details = catalogDetails(rows, 'serverless', 'a', 'scope');
  assert.equal(details.label, 'Actual model');
  assert.match(details.limits, /hors ligne/);
  assert.ok(!('token' in details));
});

test('card click sends identity; details render text, focus and return to trigger', () => {
  const vm = require('node:vm');
  let focused;
  class Element {
    constructor() {
      this.children = [];
      this.events = {};
      this.value = '';
      this.isConnected = true;
    }
    append(child) {
      this.children.push(child);
    }
    replaceChildren() {
      this.children = [];
    }
    addEventListener(type, handler) {
      this.events[type] = handler;
    }
    setAttribute(name, value) {
      this[name] = value;
    }
    focus() {
      focused = this;
    }
  }
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const sent = [];
  let receive;
  vm.runInNewContext(fs.readFileSync('media/catalog.js', 'utf8'), {
    acquireVsCodeApi: () => ({ postMessage: (value) => sent.push(value) }),
    document: { getElementById: get, createElement: () => new Element() },
    window: {
      addEventListener: (_event, handler) => {
        receive = handler;
      },
    },
  });
  receive({
    data: {
      type: 'catalog-state',
      serverless: [{ id: 'a', label: 'Model', status: 'preview' }],
      dedicated: [],
      publicStatus: 'OK',
      dedicatedStatus: 'None',
      scope: 'Public',
    },
  });
  const button = get('public-list').children[0].children.at(-1);
  assert.equal(button.textContent, 'Voir les détails');
  assert.equal(button['aria-label'], 'Voir les détails de Model');
  button.events.click();
  assert.equal(
    JSON.stringify(sent.at(-1)),
    JSON.stringify({ type: 'details', kind: 'serverless', id: 'a' }),
  );
  receive({
    data: {
      type: 'catalog-details',
      label: '<unsafe>',
      status: 'preview',
      source: 'public',
      scope: 'fr-par',
      limits: 'No inference',
    },
  });
  assert.equal(get('detail-title').textContent, '<unsafe>');
  assert.equal(get('model-details').hidden, false);
  assert.equal(focused, get('detail-title'));
  get('close-details').events.click();
  assert.equal(get('model-details').hidden, true);
  assert.equal(focused, button);
});

test('navigation explicitly separates deployable dedicated catalog and existing resources', () => {
  const source = fs.readFileSync('src/extension.ts', 'utf8');
  assert.ok(source.includes('Serverless · offres disponibles'));
  assert.ok(source.includes('Dédiés · modèles à déployer'));
  assert.ok(source.includes('Dédiés · déploiements existants'));
  assert.ok(source.includes("children: realModelNodes('dedicated-catalog')"));
  assert.ok(source.includes("children: realModelNodes('dedicated')"));
});

test('deployment preparation IPC is exact UUID identity, never network/budget/acceptance payload', () => {
  const id = '33333333-3333-3333-3333-333333333333';
  assert.deepEqual(parseCatalogInput({ type: 'prepare', id }), {
    type: 'prepare',
    id,
  });
  for (const value of [
    { type: 'prepare', id: 'invalid' },
    { type: 'prepare', id, acceptEula: true },
    { type: 'prepare', id, endpoint: 'evil' },
  ])
    assert.equal(parseCatalogInput(value), undefined);
});
