const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const {
  loadSource,
  domFromHtml,
  catalogHtml,
  forbidden,
} = require('./fixtures/htmlDom.cjs');
const { parseCatalogInput } = loadSource('catalog');
const modelId = '33333333-3333-3333-3333-333333333333';
const deploymentId = '44444444-4444-4444-4444-444444444444';
function renderer(markup = catalogHtml()) {
  class Element {
    constructor(tag) {
      this.tag = tag;
      this.children = [];
      this.events = {};
      this.value = '';
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
      return this.children.filter((item) => item.tag === tag);
    }
    setAttribute(name, value) {
      this[name] = value;
    }
    focus() {}
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
  const { get } = domFromHtml(markup, Element);
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
        postMessage: (message) =>
          sent.push(JSON.parse(JSON.stringify(message))),
        setState: forbidden,
        getState: forbidden,
      }),
      document: {
        getElementById: get,
        createElement: (tag) => new Element(tag),
      },
      window: {
        addEventListener: (_type, handler) => {
          receive = handler;
        },
      },
    },
  );
  return {
    get,
    sent,
    receive: (data) => receive({ data }),
    state: (data) =>
      receive({
        data: {
          type: 'catalog-state',
          serverless: [],
          dedicated: [],
          publicStatus: 'OK',
          dedicatedStatus: 'OK',
          scope: 'test',
          ...data,
        },
      }),
    cards: (kind) => get(`${kind}-list`).children,
  };
}
function button(card, name) {
  return card.children.find(
    (item) => item.tag === 'button' && item.textContent === name,
  );
}
test('serverless configure sends use intent and selected model can be configured again', () => {
  const ui = renderer();
  const row = {
    id: 'vendor/model-v1',
    label: '<img src=x onerror=evil()>',
    status: 'preview',
    serverlessPrices: [
      {
        consumptionMode: 'realtime',
        tokenType: 'input_token',
        amountEUR: '0.0018',
        unit: 'token',
        size: 1000,
      },
    ],
  };
  ui.state({ serverless: [row] });
  const card = ui.cards('public')[0];
  assert.equal(card.children[0].textContent, row.label);
  assert.equal(
    card.children.find((item) => item.className === 'model-prices').textContent,
    'Entrée : 0,0018 € / 1000 tokens',
  );
  button(card, 'Utiliser').events.click();
  assert.deepEqual(ui.sent.at(-1), { type: 'use', id: row.id });
  ui.state({ serverless: [row], selectedServerless: [row.id] });
  const added = button(ui.cards('public')[0], 'Choisir une clé API');
  assert.equal(added.disabled, false);
  const count = ui.sent.length;
  added.events.click();
  assert.equal(ui.sent.length, count + 1);
  assert.equal(button(ui.cards('public')[0], 'Ouvrir'), undefined);
  assert.ok(
    !ui
      .cards('public')[0]
      .children.some((item) =>
        /déployée|pas un déploiement/.test(item.textContent || ''),
      ),
  );
});
test('ready dedicated action deploys model identity; existing constructing resource reuses deployment identity', () => {
  const ui = renderer();
  const row = {
    id: modelId,
    label: 'Dedicated',
    dedicatedInfo: { status: 'ready' },
  };
  ui.state({ dedicated: [row] });
  button(ui.cards('dedicated')[0], 'Déployer').events.click();
  assert.deepEqual(ui.sent.at(-1), { type: 'deploy', id: modelId });
  ui.state({
    dedicated: [{ ...row, dedicatedInfo: { status: 'loading' } }],
    deployments: [
      { id: deploymentId, status: 'creating', deploymentInfo: { modelId } },
      { id: modelId, deploymentInfo: { modelId: deploymentId } },
    ],
  });
  const card = ui.cards('dedicated')[0];
  const open = button(card, 'Ouvrir le déploiement');
  assert.equal(open.disabled, false);
  open.events.click();
  assert.deepEqual(ui.sent.at(-1), {
    type: 'open-deployment',
    id: deploymentId,
  });
  assert.equal(button(card, 'Déployer'), undefined);
  ui.state({
    dedicated: [row],
    deployments: [
      { id: deploymentId, deploymentInfo: { modelId: deploymentId } },
    ],
  });
  assert.ok(button(ui.cards('dedicated')[0], 'Déployer'));
});
test('not-ready and unknown dedicated models cannot deploy; Voir pourquoi requests safe host details', () => {
  const ui = renderer();
  for (const status of ['loading', 'error', undefined]) {
    ui.state({
      dedicated: [
        { id: modelId, label: 'Not ready', dedicatedInfo: { status } },
      ],
    });
    const card = ui.cards('dedicated')[0];
    const action = button(card, 'Déployer');
    assert.equal(action.disabled, true);
    const count = ui.sent.length;
    action.events.click();
    assert.equal(ui.sent.length, count);
    button(card, 'Voir pourquoi').events.click();
    assert.deepEqual(ui.sent.at(-1), {
      type: 'details',
      kind: 'dedicated-catalog',
      id: modelId,
    });
  }
});
test('catalog action IPC is closed, bounded, exact and backwards-compatible', () => {
  for (const type of ['deploy', 'open-deployment', 'prepare']) {
    assert.deepEqual(parseCatalogInput({ type, id: modelId }), {
      type,
      id: modelId,
    });
    assert.equal(parseCatalogInput({ type, id: 'model-name' }), undefined);
    assert.equal(
      parseCatalogInput({ type, id: modelId, price: '0' }),
      undefined,
    );
  }
  for (const id of ['vendor/model-v1', 'x'.repeat(256)])
    assert.deepEqual(parseCatalogInput({ type: 'use', id }), {
      type: 'use',
      id,
    });
  for (const id of [
    '',
    'x'.repeat(257),
    `bad${String.fromCharCode(10)}name`,
    5,
    null,
  ])
    assert.equal(parseCatalogInput({ type: 'use', id }), undefined);
  assert.equal(
    parseCatalogInput({ type: 'use', id: 'model', token: 'secret' }),
    undefined,
  );
});
test('catalog renderer has no HTML sinks or browser transport', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../media/catalog.js'),
    'utf8',
  );
  assert.doesNotMatch(
    source,
    /innerHTML|outerHTML|insertAdjacentHTML|document[.]write|fetch[(]|XMLHttpRequest|WebSocket|eval[(]/,
  );
  assert.doesNotMatch(source, /type: 'prepare'/);
});

test('details show exact realtime input/output/cache prices, not batch, and clear stale prices', () => {
  const { catalogDetails } = loadSource('catalogDetails');
  const ui = renderer();
  const row = {
    id: 'a',
    label: '<unsafe>',
    kind: 'serverless',
    status: 'preview',
    serverlessPrices: [
      {
        sku: 'i',
        consumptionMode: 'realtime',
        tokenType: 'input_token',
        amountEUR: '0.001800001',
        size: 1000,
        unit: 'token',
      },
      {
        sku: 'o',
        consumptionMode: 'realtime',
        tokenType: 'output_token',
        amountEUR: '0.0054',
        size: 1000,
        unit: 'token',
      },
      {
        sku: 'c',
        consumptionMode: 'realtime',
        tokenType: 'cached_input_token',
        amountEUR: '0',
        size: 1000,
        unit: 'token',
      },
      {
        sku: 'b',
        consumptionMode: 'batch',
        tokenType: 'input_token',
        amountEUR: '0.0009',
        size: 1000,
        unit: 'token',
      },
    ],
  };
  const details = catalogDetails([row], 'serverless', 'a', 'scope');
  assert.equal(details.prices.length, 3);
  ui.receive(details);
  assert.equal(ui.get('detail-title').textContent, '<unsafe>');
  assert.deepEqual(
    ui.get('detail-prices').children.map((line) => line.textContent),
    [
      'Entrée : 0,001800001 € / 1000 tokens',
      'Sortie : 0,0054 € / 1000 tokens',
      'Entrée en cache : 0 € / 1000 tokens',
    ],
  );
  assert.doesNotMatch(
    JSON.stringify(details),
    /hors ligne|Prix, capacités|démonstration|non établis/,
  );
  ui.receive(
    catalogDetails(
      [{ ...row, serverlessPrices: [] }],
      'serverless',
      'a',
      'scope',
    ),
  );
  assert.equal(ui.get('detail-prices').children.length, 1);
  assert.equal(
    ui.get('detail-prices').children[0].textContent,
    'Tarif temps réel non disponible',
  );
  ui.receive({ type: 'catalog-detail-unavailable' });
  assert.equal(ui.get('detail-prices').children.length, 0);
  assert.equal(ui.get('detail-pricing-note').textContent, '');
});
test('dedicated detail shows configuration-dependent price without inventing a model tariff', () => {
  const { catalogDetails } = loadSource('catalogDetails');
  const ui = renderer();
  const details = catalogDetails(
    [
      {
        id: modelId,
        kind: 'dedicated-catalog',
        label: 'Dedicated',
        status: 'ready',
      },
    ],
    'dedicated-catalog',
    modelId,
    'Project · fr-par',
  );
  ui.receive(details);
  assert.equal(ui.get('detail-prices').children.length, 0);
  assert.equal(
    ui.get('detail-pricing-note').textContent,
    'Tarif selon la configuration · affiché avant confirmation du déploiement',
  );
  assert.equal(ui.get('detail-scope').textContent, 'Project · fr-par');
  assert.doesNotMatch(details.limits, /préparation locale|aucune allocation/);
});
test('detail layout prioritizes prices before status and secondary metadata', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '../src/catalog.ts'),
    'utf8',
  );
  const positions = ['detail-prices', 'detail-status', 'detail-source'].map(
    (id) => html.indexOf('id="' + id + '"'),
  );
  assert.ok(
    positions.every((position) => position >= 0),
    'all ordered details exist',
  );
  assert.ok(positions[0] < positions[1]);
  assert.ok(positions[1] < positions[2]);
  const css = fs.readFileSync(
    path.join(__dirname, '../media/catalog.css'),
    'utf8',
  );
  assert.match(css, /#detail-prices p/);
});

test('service toggle shows only chosen catalogue and preserves search', () => {
  const ui = renderer();
  ui.state({
    serverless: [{ id: 's', label: 'S' }],
    dedicated: [{ id: modelId, label: 'D' }],
  });
  ui.get('search').value = 'D';
  ui.get('service-dedicated').events.click();
  assert.equal(ui.get('service-dedicated')['aria-pressed'], 'true');
  assert.equal(ui.get('service-serverless')['aria-pressed'], 'false');
  assert.equal(ui.get('serverless-section').hidden, true);
  assert.equal(ui.get('dedicated-section').hidden, false);
  assert.equal(ui.get('search').value, 'D');
  ui.get('service-serverless').events.click();
  assert.equal(ui.get('service-serverless')['aria-pressed'], 'true');
  assert.equal(ui.get('service-dedicated')['aria-pressed'], 'false');
  assert.equal(ui.get('dedicated-section').hidden, true);
});

test('catalogue uses compact native toggle buttons instead of radios', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../src/catalog.ts'),
    'utf8',
  );
  assert.match(
    source,
    /class="service-toggle" role="group" aria-label="Type de service IA"/,
  );
  assert.match(source, /id="service-serverless" aria-pressed="true"/);
  assert.match(source, /id="service-dedicated" aria-pressed="false"/);
  assert.ok(!source.includes('type="radio"'));
});

test('HTML-derived fixture rejects every missing required static ID instead of inventing a node', () => {
  const markup = catalogHtml();
  // Remove each actual HTML ID and exercise initialization, rendering, toggles and details.
  const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(ids.includes('search'));
  for (const id of ids) {
    const mutated = markup.replace(
      'id="' + id + '"',
      'data-missing="' + id + '"',
    );
    assert.throws(
      () => {
        const ui = renderer(mutated);
        ui.state({ serverless: [], dedicated: [], scope: 'Local' });
        ui.get('service-dedicated').events.click();
        ui.get('service-serverless').events.click();
        ui.receive({
          type: 'catalog-details',
          label: 'Model',
          prices: [],
          status: 'ready',
          source: 'test',
          scope: 'test',
          limits: 'test',
        });
      },
      /Missing required HTML element/,
      'mutation must fail for ' + id,
    );
  }
});
