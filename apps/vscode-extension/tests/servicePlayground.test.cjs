const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  ServicePlayground,
  estimateCost,
} = require('../dist/servicePlayground');
const { parseServiceInput } = require('../dist/servicePlaygroundIpc');
const { serverlessInvocation } = require('../dist/provider');
const { InferenceError } = require('../dist/inference');
const model = {
  id: 'mistral-small-3.2-24b-instruct-2506',
  label: 'Mistral',
  kind: 'serverless',
  status: 'general_availability',
};
const project = {
  id: '22222222-2222-2222-2222-222222222222',
  organizationId: '11111111-1111-1111-1111-111111111111',
  name: 'Test',
};
function setup(row = model) {
  const abort = new AbortController();
  const calls = [],
    states = [];
  let authorizations = 0;
  const scope = {
    project,
    signal: abort.signal,
    current: () => !abort.signal.aborted,
    authorize: () => {
      authorizations++;
      return '33333333-3333-3333-3333-333333333333';
    },
    dispose: () => abort.abort(),
  };
  const controller = new ServicePlayground(
    row,
    scope,
    (state) => states.push(state),
    (input, delta, usage) =>
      new Promise((resolve, reject) =>
        calls.push({ input, delta, usage, resolve, reject }),
      ),
  );
  return {
    controller,
    calls,
    states,
    abort,
    authorizations: () => authorizations,
  };
}
const run = { type: 'run', prompt: 'bonjour', maxTokens: 128 };
test('IPC denies URLs/keys/model override, extra fields and invalid bounds', () => {
  for (const value of [
    null,
    [],
    { ...run, url: 'https://evil.invalid' },
    { ...run, secretKey: 'x' },
    { ...run, model: 'other' },
    { type: 'cancel', runId: 1 },
    { ...run, prompt: ' ' },
    { ...run, maxTokens: 0 },
    { ...run, maxTokens: 2049 },
    { ...run, maxTokens: 1.1 },
    { ...run, prompt: 'a'.repeat(4097) },
  ])
    assert.equal(parseServiceInput(value), undefined);
  assert.deepEqual(parseServiceInput(run), run);
});
test('commercial models cannot enable inference through label matching', () => {
  assert.ok(serverlessInvocation(model));
  for (const row of [
    { ...model, id: 'unsafe model' },
    { ...model, kind: 'dedicated' },
    { ...model, status: 'end_of_life' },
  ])
    assert.equal(serverlessInvocation(row), undefined);
});
test('open and ready never authorize or infer; Run alone sends selected model/project once', async () => {
  const s = setup();
  await s.controller.receive({ type: 'ready' });
  assert.equal(s.authorizations(), 0);
  assert.equal(s.calls.length, 0);
  const pending = s.controller.receive(run);
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].input.modelId, model.id);
  assert.equal(s.calls[0].input.projectId, project.id);
  await s.controller.receive(run);
  assert.equal(s.calls.length, 1);
  s.calls[0].delta('Réponse');
  s.calls[0].usage({ inputTokens: 3, outputTokens: 1, totalTokens: 4 });
  s.calls[0].resolve();
  await pending;
  assert.equal(s.controller.state.output, 'Réponse');
  assert.equal(s.controller.state.running, false);
  assert.equal(s.controller.state.usage.totalTokens, 4);
  assert.equal(s.controller.state.cost, undefined);
  assert.ok(!JSON.stringify(s.states).includes(s.calls[0].input.secretKey));
  s.controller.dispose();
});
test('stop keeps partial; late callbacks/finally cannot contaminate next run', async () => {
  const s = setup();
  const first = s.controller.receive(run);
  s.calls[0].delta('partiel');
  await s.controller.receive({ type: 'cancel' });
  assert.ok(s.calls[0].input.signal.aborted);
  assert.equal(s.controller.state.output, 'partiel');
  const second = s.controller.receive({ ...run, prompt: 'nouveau' });
  s.calls[0].delta('tardif');
  s.calls[0].usage({ inputTokens: 9, outputTokens: 9, totalTokens: 18 });
  s.calls[0].resolve();
  await first;
  assert.equal(s.controller.state.running, true);
  assert.equal(s.controller.state.output, '');
  assert.equal(s.controller.state.usage, undefined);
  s.calls[1].delta('nouvelle réponse');
  s.calls[1].resolve();
  await second;
  assert.equal(s.controller.state.output, 'nouvelle réponse');
  s.controller.dispose();
});
for (const reason of ['logout', 'project', 'trust', 'dispose'])
  test(
    reason + ' aborts pinned scope and denies stale/new updates',
    async () => {
      const s = setup();
      const p = s.controller.receive(run);
      s.calls[0].delta('partial');
      if (reason === 'dispose') s.controller.dispose();
      else s.abort.abort();
      assert.ok(s.calls[0].input.signal.aborted);
      s.calls[0].delta('late');
      s.calls[0].reject(new Error('secret upstream body'));
      await p;
      assert.equal(s.controller.state.output, 'partial');
      await s.controller.receive(run);
      assert.equal(s.calls.length, 1);
      assert.ok(!JSON.stringify(s.states).includes('secret upstream'));
    },
  );
test('errors preserve partial and remain redacted, never default usage zero', async () => {
  const s = setup();
  const p = s.controller.receive(run);
  s.calls[0].delta('partial');
  s.calls[0].reject(new InferenceError('network_error'));
  await p;
  assert.equal(s.controller.state.output, 'partial');
  assert.match(s.controller.state.status, /Connexion/);
  assert.equal(s.controller.state.usage, undefined);
  s.controller.dispose();
});
test('non-chat selected model never replaced by a chat model', async () => {
  const s = setup({
    ...model,
    id: 'embedding-model',
    serverlessCapabilities: {
      tasks: ['embeddings'],
      supportedApis: ['/v1/embeddings'],
      textChat: 'unsupported',
      source: 'public-catalog',
    },
  });
  await s.controller.receive(run);
  assert.equal(s.calls.length, 0);
  assert.equal(s.authorizations(), 0);
  assert.ok(s.controller.state.blocked);
  s.controller.dispose();
});
test('exact public cost with explicit counts/prices; absent, cached, wrong mode/unit unavailable', () => {
  const usage = { inputTokens: 6, outputTokens: 22, totalTokens: 28 };
  const prices = [
    {
      amountEUR: '0.15',
      unit: 'token',
      size: 1000000,
      tokenType: 'input_token',
      consumptionMode: 'realtime',
    },
    {
      amountEUR: '0.35',
      unit: 'token',
      size: 1000000,
      tokenType: 'output_token',
      consumptionMode: 'realtime',
    },
  ];
  const row = { ...model, serverlessPrices: prices };
  assert.match(estimateCost(row, usage), /^0.000008600 EUR/);
  assert.equal(estimateCost(model, usage), undefined);
  assert.equal(
    estimateCost(row, { ...usage, cachedInputTokens: 1 }),
    undefined,
  );
  for (const p of [
    { ...prices[0], unit: 'unknown' },
    { ...prices[0], amountEUR: 'invalid' },
    { ...prices[0], consumptionMode: 'batch' },
    { ...prices[0], size: 0 },
  ])
    assert.equal(
      estimateCost({ ...model, serverlessPrices: [p, prices[1]] }, usage),
      undefined,
    );
  assert.match(
    estimateCost(row, { inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
    /^0.000000000/,
  );
});

for (const [status, label] of [
  [403, /permission/],
  [429, /quota/],
  [404, /remplacement/],
  [503, /indisponible/],
]) {
  test('HTTP actionable error ' + status, async () => {
    const s = setup();
    const pending = s.controller.receive(run);
    s.calls[0].reject(new InferenceError('http_error', status));
    await pending;
    assert.match(s.controller.state.status, label);
    assert.equal(s.calls.length, 1);
    s.controller.dispose();
  });
}

for (const id of [
  'vendor/new-model:fp8',
  'fixture-code-2',
  'never-live-tested-model',
]) {
  test(
    'shared text transport forwards configurable model identity ' + id,
    async () => {
      const row = { ...model, id };
      const s = setup(row);
      await s.controller.receive({ type: 'ready' });
      assert.equal(s.calls.length, 0);
      row.id = 'mutated-after-panel-open';
      const pending = s.controller.receive(run);
      assert.equal(s.calls.length, 1);
      assert.equal(s.calls[0].input.modelId, id);
      s.calls[0].delta('shared answer');
      s.calls[0].resolve();
      await pending;
      assert.equal(s.controller.state.output, 'shared answer');
      assert.equal(s.controller.state.running, false);
      s.controller.dispose();
    },
  );
}
test('unknown metadata permits explicit Run and warns instead of demanding a model-specific live test', async () => {
  const s = setup({ ...model, id: 'brand-new-chat' });
  assert.equal(s.controller.state.blocked, false);
  assert.match(s.controller.state.status, /non renseignée/);
  const pending = s.controller.receive(run);
  assert.equal(s.calls.length, 1);
  s.calls[0].reject(new InferenceError('http_error', 422));
  await pending;
  assert.equal(s.calls.length, 1);
  assert.equal(s.controller.state.output, '');
  s.controller.dispose();
});

test('HTTP parameter rejection reports actionable model-specific failure without replay or fallback', async () => {
  const s = setup({ ...model, id: 'new-model-parameters' });
  const pending = s.controller.receive(run);
  s.calls[0].reject(new InferenceError('http_error', 422));
  await pending;
  assert.match(s.controller.state.status, /paramètres/);
  assert.match(s.controller.state.status, /aucun retry/);
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].input.modelId, 'new-model-parameters');
  s.controller.dispose();
});

function dedicatedSetup(auth = 'iam', extra = {}) {
  const did = '33333333-3333-3333-3333-333333333333';
  const row = {
    id: did,
    kind: 'dedicated',
    label: 'Dedicated',
    status: 'ready',
    deploymentInfo: {
      projectId: project.id,
      region: 'fr-par',
      fetchedAt: 'synthetic',
      modelId: '55555555-5555-5555-5555-555555555555',
      modelName: 'meta/llama:fp8',
      endpoints: [
        {
          id: '44444444-4444-4444-4444-444444444444',
          url: 'https://' + did + '.ifr.fr-par.scaleway.com',
          authentication: auth,
          network: 'public',
        },
      ],
    },
  };
  const ep = row.deploymentInfo.endpoints[0];
  const approval = {
    organizationId: project.organizationId,
    projectId: project.id,
    region: 'fr-par',
    deploymentId: did,
    endpointId: ep.id,
    endpointUrl: ep.url,
    modelName: row.deploymentInfo.modelName,
    authentication: auth,
    allowUnauthenticated: auth === 'disabled',
    approvedAt: Date.now() - 1000,
    expiresAt: Date.now() + 1800000,
    ...extra,
  };
  const abort = new AbortController(),
    calls = [],
    states = [];
  let authorizations = 0;
  const scope = {
    project,
    signal: abort.signal,
    current: () => !abort.signal.aborted,
    authorize: () => {
      authorizations++;
      return 'synthetic-key';
    },
    dispose: () => abort.abort(),
  };
  const controller = new ServicePlayground(
    row,
    scope,
    (state) => states.push(state),
    () => {
      throw new Error('serverless forbidden');
    },
    {
      approval,
      invoke: (input, delta, usage) =>
        new Promise((resolve, reject) =>
          calls.push({ input, delta, usage, resolve, reject }),
        ),
    },
  );
  return {
    controller,
    calls,
    states,
    approval,
    row,
    abort,
    authorizations: () => authorizations,
  };
}
test('dedicated ready does not authorize, Run pins provider model name, no serverless cost, partial/cancel/next-run guards', async () => {
  const s = dedicatedSetup();
  await s.controller.receive({ type: 'ready' });
  assert.equal(s.calls.length, 0);
  assert.equal(s.authorizations(), 0);
  assert.equal(s.controller.state.blocked, false);
  s.approval.endpointUrl = 'https://evil.invalid';
  s.row.deploymentInfo.modelName = 'mutated';
  const first = s.controller.receive(run);
  assert.equal(
    s.calls[0].input.deployment.deploymentInfo.modelName,
    'meta/llama:fp8',
  );
  assert.equal(s.calls[0].input.modelId, undefined);
  assert.equal(s.authorizations(), 0);
  s.calls[0].input.authorize();
  assert.equal(s.authorizations(), 1);
  s.calls[0].delta('partial');
  await s.controller.receive({ type: 'cancel' });
  assert.throws(() => s.calls[0].input.authorize());
  const second = s.controller.receive(run);
  s.calls[0].delta('late');
  s.calls[0].resolve();
  await first;
  assert.equal(s.controller.state.output, '');
  assert.equal(s.controller.state.running, true);
  s.calls[1].delta('final');
  s.calls[1].usage({ inputTokens: 1, outputTokens: 1, totalTokens: 2 });
  s.calls[1].resolve();
  await second;
  assert.match(s.controller.state.cost, /durée/);
  assert.doesNotMatch(s.controller.state.cost, /EUR/);
  assert.equal(
    estimateCost(
      { ...model, kind: 'dedicated' },
      { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    ),
    undefined,
  );
  s.controller.dispose();
});
test('dedicated expiry is rechecked on Run and immediately before secret access', async () => {
  const original = Date.now;
  let now = original();
  Date.now = () => now;
  try {
    const s = dedicatedSetup('iam', { expiresAt: now + 10 });
    const pending = s.controller.receive(run);
    now += 11;
    assert.throws(() => s.calls[0].input.authorize());
    assert.equal(s.authorizations(), 0);
    s.calls[0].reject(new Error('private-body'));
    await pending;
    await s.controller.receive(run);
    assert.equal(s.calls.length, 1);
    assert.equal(s.controller.state.blocked, true);
    assert.ok(!JSON.stringify(s.states).includes('private-body'));
    s.controller.dispose();
  } finally {
    Date.now = original;
  }
});
test('dedicated scope loss denies authorization and freezes partial output', async () => {
  const s = dedicatedSetup('disabled');
  const pending = s.controller.receive(run);
  s.calls[0].delta('partial');
  s.abort.abort();
  assert.throws(() => s.calls[0].input.authorize());
  s.calls[0].delta('late');
  s.calls[0].reject(new InferenceError('network_error'));
  await pending;
  assert.equal(s.authorizations(), 0);
  assert.equal(s.controller.state.output, 'partial');
  assert.equal(s.controller.state.blocked, true);
  s.controller.dispose();
});
