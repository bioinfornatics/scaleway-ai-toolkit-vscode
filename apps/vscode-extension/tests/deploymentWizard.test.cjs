const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadSource } = require('./fixtures/htmlDom.cjs');
const project = {
  id: '11111111-1111-1111-1111-111111111111',
  organizationId: '22222222-2222-2222-2222-222222222222',
  name: 'Test',
};
const model = {
  id: '33333333-3333-3333-3333-333333333333',
  label: 'Model',
  kind: 'dedicated-catalog',
  dedicatedInfo: {
    status: 'ready',
    hasEula: true,
    supportedNodes: [
      {
        nodeTypeName: 'H100',
        quantizationBits: 8,
        allowed: true,
        maxContextSize: 100,
      },
    ],
  },
};
const nodes = [
  { name: 'H100', stockStatus: 'available', disabled: false, region: 'fr-par' },
];
function setup({
  cancelAt = -1,
  invalidateAt = -1,
  network = 'public',
  failOpen = false,
  pauseOpen,
} = {}) {
  let step = 0,
    current = true,
    warnings = 0;
  const documents = [];
  let opened = 0;
  const pick = (value) => {
    step++;
    if (step === invalidateAt) current = false;
    return step === cancelAt ? undefined : value;
  };
  const inputs = [
    'candidate',
    ...(network === 'private' ? [project.id] : []),
    '12.25',
  ];
  const vscode = {
    window: {
      showQuickPick: async (items) =>
        pick(items.find((i) => i.id === network) ?? items[0]),
      showInputBox: async () => pick(inputs.shift()),
      showInformationMessage: async (_message, _options, action) =>
        pick(action),
      showWarningMessage: async () => {
        warnings++;
      },
      showTextDocument: async (document) => documents.push(document),
    },
    workspace: {
      openTextDocument: async (options) => {
        opened++;
        pick(options); // distinct awaited boundary after final confirmation
        if (pauseOpen) await pauseOpen();
        if (failOpen) throw new Error('document unavailable');
        return options;
      },
    },
  };
  const wizard = loadSource('deploymentWizard', { vscode }).deploymentWizard;
  return {
    wizard,
    current: () => current,
    invalidate: () => {
      current = false;
    },
    documents,
    warnings: () => warnings,
    steps: () => step,
    opened: () => opened,
  };
}
test('native wizard completes public/private local plans without execution or EULA acceptance', async () => {
  for (const network of ['public', 'private']) {
    const s = setup({ network });
    assert.equal(await s.wizard(project, model, nodes, s.current), true);
    assert.equal(s.documents.length, 1);
    const plan = JSON.parse(s.documents[0].content);
    assert.equal(plan.executable, false);
    assert.equal(plan.network.type, network);
    assert.equal(plan.license.accepted, false);
    assert.equal(plan.budget.maxHourlyEUR, '12.25');
  }
});
test('cancel or stale account at every public/private prompt never displays a plan', async () => {
  for (const network of ['public', 'private']) {
    const prompts = network === 'public' ? 5 : 6;
    for (const key of ['cancelAt', 'invalidateAt']) {
      for (let step = 1; step <= prompts; step++) {
        const s = setup({ network, [key]: step });
        assert.equal(await s.wizard(project, model, nodes, s.current), false);
        assert.equal(s.steps(), step);
        assert.equal(s.opened(), 0);
        assert.equal(s.documents.length, 0);
      }
    }
  }
});
test('invalidation while opening the local document never displays it, including open failure', async () => {
  for (const network of ['public', 'private']) {
    for (const failOpen of [false, true]) {
      let entered, settle;
      const opened = new Promise((resolve) => {
        entered = resolve;
      });
      const suspended = new Promise((resolve) => {
        settle = resolve;
      });
      const s = setup({
        network,
        failOpen,
        pauseOpen: () => {
          entered();
          return suspended;
        },
      });
      const result = s.wizard(project, model, nodes, s.current);
      await opened; // host document API is genuinely still pending
      assert.equal(s.current(), true);
      assert.equal(s.documents.length, 0);
      s.invalidate();
      settle();
      if (failOpen) await assert.rejects(result, /document unavailable/);
      else assert.equal(await result, false);
      assert.equal(s.current(), false);
      assert.equal(s.opened(), 1);
      assert.equal(s.documents.length, 0);
    }
  }
});
test('no stock/compatibility or non-ready model produces no false deployment choice', async () => {
  const s = setup();
  assert.equal(await s.wizard(project, model, [], s.current), false);
  assert.equal(s.warnings(), 1);
  assert.equal(s.documents.length, 0);
});

test('wizard preserves public source amount and explicitly refuses hourly price interpretation', async () => {
  const s = setup();
  const price = {
    nodeTypeName: 'H100',
    sku: 'offer',
    region: 'fr-par',
    currency: 'EUR',
    amountEUR: '0.05666',
    unit: 'node',
    size: 1,
    period: 'unspecified-in-catalog',
    source: 'public-retail-not-account-price',
    fetchedAt: '2026-10-21T05:00:00Z',
  };
  assert.equal(await s.wizard(project, model, nodes, s.current, [price]), true);
  const plan = JSON.parse(s.documents[0].content);
  assert.equal(plan.publicPriceObservation.amountEUR, '0.05666');
  assert.equal(plan.checks.price, 'unknown');
  assert.equal(plan.executable, false);
  assert.match(plan.priceLimitations, /pas un tarif horaire/);
  assert.match(plan.priceLimitations, /sans trafic/);
});
