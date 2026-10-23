const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {
  loadSource,
  domFromHtml,
  catalogHtml,
  forbidden,
} = require('./fixtures/htmlDom.cjs');
const { parseCatalogInput } = loadSource('catalog');
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
  const s = fs.readFileSync(
    path.join(__dirname, '../media/catalog.js'),
    'utf8',
  );
  assert.doesNotMatch(
    s,
    /innerHTML|outerHTML|insertAdjacentHTML|document[.]write|fetch\s*\(|XMLHttpRequest|WebSocket/,
  );
  assert.match(s, /title\.textContent\s*=\s*row\.label/);
  assert.ok(s.includes('root.replaceChildren()'));
  const host = fs.readFileSync(
    path.join(__dirname, '../src/extension.ts'),
    'utf8',
  );
  const a = host.indexOf("register('scalewayAI.openCatalog'");
  const b = host.indexOf("register('scalewayAI.disconnect'", a);
  assert.ok(a >= 0, 'catalog command exists');
  assert.ok(b > a, 'following disconnect command exists');
  const command = host.slice(a, b);
  const panel = command.indexOf('createWebviewPanel');
  const load = command.indexOf('await connection.loadPublicCatalog()');
  assert.ok(panel >= 0, 'panel creation exists');
  assert.ok(load >= 0, 'catalog load exists');
  assert.ok(panel < load);
});

test('implemented navigation separates discover, build, recent and local demo; project chooser is not cloud creation', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../src/extension.ts'),
    'utf8',
  );
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
  const { catalogDetails } = loadSource('catalogDetails');
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
  assert.equal(
    details.limits,
    'Utiliser prépare l’accès avec la clé API active et vérifie la liste API, sans inférence. Exécuter dans le playground lance un appel potentiellement facturé.',
  );
  assert.deepEqual(details.prices, []);
  assert.equal(details.pricingNote, 'Tarifs publics · temps réel');
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
    querySelectorAll(tag) {
      return tag === 'article'
        ? this.children.filter((child) => child.tag === 'article')
        : [];
    }
    setAttribute(name, value) {
      this[name] = value;
    }
    focus() {
      focused = this;
    }
    set innerHTML(_value) {
      throw new Error('HTML sink');
    }
    set outerHTML(_value) {
      throw new Error('HTML sink');
    }
    insertAdjacentHTML() {
      throw new Error('HTML sink');
    }
  }
  const { get } = domFromHtml(catalogHtml(), Element);
  const sent = [];
  let receive;
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../media/catalog.js'), 'utf8'),
    {
      fetch: forbidden,
      XMLHttpRequest: forbidden,
      WebSocket: forbidden,
      localStorage: { setItem: forbidden },
      acquireVsCodeApi: () => ({
        postMessage: (value) => sent.push(value),
        setState: forbidden,
        getState: forbidden,
      }),
      document: {
        getElementById: get,
        createElement: (tag) => Object.assign(new Element(), { tag }),
      },
      window: {
        addEventListener: (_event, handler) => {
          receive = handler;
        },
      },
    },
  );
  receive({
    data: {
      type: 'catalog-state',
      serverless: [
        {
          id: 'a',
          label: 'Model',
          status: 'preview',
          serverlessPrices: [
            {
              amountEUR: '0.0018',
              unit: 'token',
              size: 1000,
              tokenType: 'input_token',
              consumptionMode: 'realtime',
            },
            {
              amountEUR: '0.0009',
              unit: 'token',
              size: 1000,
              tokenType: 'input_token',
              consumptionMode: 'batch',
            },
          ],
        },
      ],
      dedicated: [],
      publicStatus: 'OK',
      dedicatedStatus: 'None',
      scope: 'Public',
    },
  });
  const pricing = get('public-list').children[0].children.find(
    (child) => child.className === 'model-prices',
  );
  assert.equal(pricing.textContent, 'Entrée : 0,0018 € / 1000 tokens');
  assert.ok(!pricing.textContent.includes('0,0009'));
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
  assert.equal(get('search-results').textContent, '1 résultat(s) affiché(s)');
  let prevented = false;
  get('model-details').events.keydown({
    key: 'Escape',
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  get('close-details').events.click();
  assert.equal(get('model-details').hidden, true);
  assert.equal(focused, button);
  get('search').value = 'no match';
  get('search').events.input();
  assert.equal(get('search-results').textContent, '0 résultat(s) affiché(s)');
  assert.equal(
    get('public-list').children[0].textContent,
    'Aucun résultat pour cette recherche.',
  );
});

test('navigation separates real resources from catalogue and removes explanatory suffixes', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../src/extension.ts'),
    'utf8',
  );
  const begin = source.indexOf('const resources =');
  const end = source.indexOf('const tools =', begin);
  assert.ok(begin >= 0, 'resource section exists');
  assert.ok(end > begin, 'following tools section exists');
  const resources = source.slice(begin, end);
  assert.ok(resources.includes("command: 'scalewayAI.openAPIKeys'"));
  assert.ok(resources.includes("command: 'scalewayAI.openDeployments'"));
  assert.ok(resources.includes("command: 'scalewayAI.openAgents'"));
  assert.ok(!resources.includes("label: 'Serverless'"));
  assert.ok(!resources.includes("label: 'Dédiés'"));
  assert.ok(!resources.includes('resourceNodes'));
  assert.ok(!resources.includes('dedicated-catalog'));
  assert.ok(!resources.includes('offres disponibles'));
  assert.ok(!resources.includes('modèles à déployer'));
  assert.ok(!resources.includes('serverlessState'));
  assert.ok(!resources.includes('dedicatedState'));
  assert.ok(source.includes('connection.serverlessResources'));
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

test('renderer acknowledgement IPC accepts bounded counts and exact shape only', () => {
  const valid = {
    type: 'rendered',
    revision: 1,
    publicCards: 17,
    dedicatedCards: 0,
  };
  assert.deepEqual(parseCatalogInput(valid), valid);
  for (const message of [
    { ...valid, revision: 0 },
    { ...valid, publicCards: -1 },
    { ...valid, publicCards: 501 },
    { ...valid, dedicatedCards: 1.2 },
    { ...valid, token: 'secret' },
  ])
    assert.equal(parseCatalogInput(message), undefined);
});

test('EULA IPC permits exact selected UUID only, never text or consent', () => {
  const id = '33333333-3333-3333-3333-333333333333';
  assert.deepEqual(parseCatalogInput({ type: 'eula', id }), {
    type: 'eula',
    id,
  });
  for (const value of [
    { type: 'eula', id: 'invalid' },
    { type: 'eula', id, accepted: true },
    { type: 'eula', id, content: 'terms' },
  ])
    assert.equal(parseCatalogInput(value), undefined);
  const renderer = fs.readFileSync(
    path.join(__dirname, '../media/catalog.js'),
    'utf8',
  );
  assert.match(renderer, /hasEula === true/);
  assert.match(renderer, /Lire l’EULA/);
  const host = fs.readFileSync(
    path.join(__dirname, '../src/extension.ts'),
    'utf8',
  );
  assert.match(host, /language: 'plaintext'/);
  assert.match(host, /input.type === 'eula'/);
});

test('model catalog contains no standalone infrastructure offers or GPU pricing section', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '../src/catalog.ts'),
    'utf8',
  );
  const renderer = fs.readFileSync(
    path.join(__dirname, '../media/catalog.js'),
    'utf8',
  );
  assert.ok(!html.includes('price-list'));
  assert.ok(!html.includes('Tarifs dédiés · infrastructure GPU'));
  assert.ok(!renderer.includes('renderPrices'));
  assert.ok(!renderer.includes('state.prices'));
  assert.ok(renderer.includes('row.serverlessPrices'));
  const id = '33333333-3333-3333-3333-333333333333';
  assert.equal(
    parseCatalogInput({
      type: 'rendered',
      revision: 1,
      publicCards: 17,
      dedicatedCards: 0,
      priceCards: 7,
    }),
    undefined,
  );
  assert.deepEqual(parseCatalogInput({ type: 'prepare', id }), {
    type: 'prepare',
    id,
  });
});
