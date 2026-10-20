const assert = require('node:assert/strict');
const { test } = require('node:test');
const Module = require('node:module');
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
function setup({ cancelAt = -1, invalidateAt = -1, network = 'public' } = {}) {
  let step = 0,
    current = true,
    warnings = 0;
  const documents = [];
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
    workspace: { openTextDocument: async (options) => options },
  };
  const original = Module._load;
  Module._load = function (name, ...args) {
    return name === 'vscode' ? vscode : original.call(this, name, ...args);
  };
  delete require.cache[require.resolve('../dist/deploymentWizard')];
  let wizard;
  try {
    wizard = require('../dist/deploymentWizard').deploymentWizard;
  } finally {
    Module._load = original;
  }
  return {
    wizard,
    current: () => current,
    documents,
    warnings: () => warnings,
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
test('cancel or stale account at each step never exports a plan', async () => {
  for (const key of ['cancelAt', 'invalidateAt']) {
    for (let step = 1; step <= 5; step++) {
      const s = setup({ [key]: step });
      assert.equal(await s.wizard(project, model, nodes, s.current), false);
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
