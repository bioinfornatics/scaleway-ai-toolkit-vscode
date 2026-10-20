const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  prepareDeploymentDraft,
  deploymentOptions,
} = require('../dist/deployment');
const {
  reviewedDeploymentBody,
  DeploymentLifecycle,
  followDeployment,
  abortableDelay,
} = require('../dist/deploymentLifecycle');
const { ReadError } = require('../dist/provider');
const project = {
  id: '11111111-1111-1111-1111-111111111111',
  organizationId: '22222222-2222-2222-2222-222222222222',
  name: 'Test',
};
const id = '33333333-3333-3333-3333-333333333333';
const model = {
  id: '44444444-4444-4444-4444-444444444444',
  label: 'Model:fp4',
  kind: 'dedicated-catalog',
  dedicatedInfo: {
    status: 'ready',
    hasEula: false,
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
  { name: 'H100', region: 'fr-par', stockStatus: 'available', disabled: false },
];
const draft = () =>
  prepareDeploymentDraft(project, model, nodes, {
    name: 'Candidate',
    option: deploymentOptions(model, nodes)[0],
    network: { type: 'public', authentication: 'iam' },
    maxHourlyEUR: '12.0001',
  });
const review = () => ({
  reviewedAt: Date.now(),
  hourlyPriceEUR: '12.0001',
  priceSource: 'synthetic verified price',
  quota: 'verified-for-one-node',
  quotaSource: 'synthetic quota',
  rights: 'verified-create',
  writeContract: 'verified',
  license: { kind: 'no-eula-reviewed' },
  exposureConfirmed: true,
  billableCreationConfirmed: true,
});
const body = () =>
  reviewedDeploymentBody(draft(), project, model, nodes, review());
const raw = {
  id,
  name: 'Candidate',
  project_id: project.id,
  region: 'fr-par',
  model_id: model.id,
  model_name: model.label,
  node_type_name: 'H100',
  status: 'creating',
  endpoints: [],
};
const resource = (status) => ({
  id,
  label: 'Candidate',
  kind: 'dedicated',
  status,
  deploymentInfo: {
    projectId: project.id,
    region: 'fr-par',
    fetchedAt: new Date().toISOString(),
    endpoints: [],
  },
});
test('reviewed source body is explicit one-node IAM protected and exact decimal price checked', () => {
  const value = body();
  assert.equal(value.project_id, project.id);
  assert.equal(value.model_id, model.id);
  assert.equal(value.min_size, 1);
  assert.equal(value.max_size, 1);
  assert.deepEqual(value.quantization, { bits: 8 });
  assert.deepEqual(value.endpoints, [
    { disable_auth: false, public_network: {} },
  ]);
  assert.ok(!('accept_eula' in value));
  assert.throws(
    () =>
      reviewedDeploymentBody(draft(), project, model, nodes, {
        ...review(),
        hourlyPriceEUR: '12.0002',
      }),
    { code: 'price_exceeds_ceiling' },
  );
  for (const change of [
    { quota: 'unknown' },
    { writeContract: 'unknown' },
    { rights: 'unknown' },
    { priceSource: '' },
    { billableCreationConfirmed: false },
    { reviewedAt: Date.now() - 61000 },
    { reviewedAt: Date.now() + 10000 },
  ])
    assert.throws(
      () =>
        reviewedDeploymentBody(draft(), project, model, nodes, {
          ...review(),
          ...change,
        }),
      { code: 'deployment_review_required' },
    );
});
test('EULA absent/unknown cannot auto-accept; explicit reviewed digest required', () => {
  const eulaModel = {
    ...model,
    dedicatedInfo: { ...model.dedicatedInfo, hasEula: true },
  };
  assert.throws(
    () => reviewedDeploymentBody(draft(), project, eulaModel, nodes, review()),
    { code: 'license_review_required' },
  );
  assert.throws(
    () =>
      reviewedDeploymentBody(
        draft(),
        project,
        {
          ...model,
          dedicatedInfo: { ...model.dedicatedInfo, hasEula: undefined },
        },
        nodes,
        review(),
      ),
    { code: 'license_review_required' },
  );
  const value = reviewedDeploymentBody(draft(), project, eulaModel, nodes, {
    ...review(),
    license: { kind: 'eula-reviewed-and-accepted', digest: 'a'.repeat(64) },
  });
  assert.equal(value.accept_eula, true);
});
test('write-ahead state before single post, accepted is not ready; no repeat submission', async () => {
  const states = [],
    sends = [];
  const engine = new DeploymentLifecycle(
    project,
    model,
    'Candidate',
    async (operation) => states.push(operation.status),
    async (payload) => {
      sends.push(payload);
      assert.deepEqual(states, ['submitting']);
      return raw;
    },
  );
  const result = await engine.submit(body(), new AbortController().signal);
  assert.equal(result.status, 'creating');
  assert.equal(engine.snapshot.status, 'accepted');
  assert.equal(engine.snapshot.deploymentId, id);
  assert.deepEqual(states, ['submitting', 'accepted']);
  assert.equal(sends.length, 1);
  await assert.rejects(engine.submit(body(), new AbortController().signal), {
    code: 'reconcile_before_retry',
  });
});
test('storage failure, unreviewed copies and mutation never send', async () => {
  let sends = 0;
  const engine = new DeploymentLifecycle(
    project,
    model,
    'Candidate',
    async () => {
      throw new Error('disk');
    },
    async () => {
      sends++;
      return raw;
    },
  );
  await assert.rejects(engine.submit(body(), new AbortController().signal), {
    code: 'operation_storage_unavailable',
  });
  assert.equal(sends, 0);
  assert.equal(engine.snapshot.status, 'prepared');
  await assert.rejects(
    engine.submit(structuredClone(body()), new AbortController().signal),
    { code: 'deployment_review_required' },
  );
  const mutated = body();
  mutated.endpoints[0].disable_auth = true;
  await assert.rejects(engine.submit(mutated, new AbortController().signal), {
    code: 'deployment_review_required',
  });
  assert.equal(sends, 0);
});
test('transport ambiguity/foreign response becomes unknown, denies retry; denial distinct', async () => {
  for (const post of [
    async () => {
      throw new Error('transport');
    },
    async () => ({ ...raw, model_id: project.id }),
    async () => ({ ...raw, project_id: project.organizationId }),
  ]) {
    const states = [];
    const engine = new DeploymentLifecycle(
      project,
      model,
      'Candidate',
      async (value) => states.push(value.status),
      post,
    );
    await assert.rejects(engine.submit(body(), new AbortController().signal), {
      code: 'creation_outcome_unknown',
    });
    assert.equal(engine.snapshot.status, 'unknown');
    assert.deepEqual(states, ['submitting', 'unknown']);
    await assert.rejects(engine.submit(body(), new AbortController().signal), {
      code: 'reconcile_before_retry',
    });
  }
  const engine = new DeploymentLifecycle(
    project,
    model,
    'Candidate',
    async () => {},
    async () => {
      throw new ReadError('access_denied');
    },
  );
  await assert.rejects(engine.submit(body(), new AbortController().signal), {
    code: 'access_denied',
  });
  assert.equal(engine.snapshot.status, 'rejected');
});
test('cancel before send prevents effect; cancel after send does not claim rollback', async () => {
  const abort = new AbortController();
  let sends = 0;
  const engine = new DeploymentLifecycle(
    project,
    model,
    'Candidate',
    async () => abort.abort(),
    async () => {
      sends++;
      return raw;
    },
  );
  await assert.rejects(engine.submit(body(), abort.signal), {
    code: 'cancelled',
  });
  assert.equal(sends, 0);
  const sentAbort = new AbortController();
  const sent = new DeploymentLifecycle(
    project,
    model,
    'Candidate',
    async () => {},
    async () => {
      sentAbort.abort();
      return raw;
    },
  );
  assert.equal(
    (await sent.submit(body(), sentAbort.signal)).status,
    'creating',
  );
  assert.equal(sent.snapshot.status, 'accepted');
});
test('follow recognizes actual lifecycle, bounded five reads, no seventh read or endpoint probe', async () => {
  const signal = new AbortController().signal;
  const states = ['creating', 'deploying', 'ready'];
  const seen = [];
  let reads = 0;
  const result = await followDeployment(
    project,
    id,
    signal,
    async () => {
      reads++;
      return resource(states.shift());
    },
    (row) => seen.push(row.status),
    async () => {},
  );
  assert.equal(result.state, 'ready');
  assert.equal(reads, 3);
  assert.deepEqual(seen, ['creating', 'deploying', 'ready']);
  const pending = await followDeployment(
    project,
    id,
    signal,
    async () => resource('future_state'),
    () => {},
    async () => {},
  );
  assert.equal(pending.state, 'pending');
  assert.equal(pending.reads, 5);
  for (const [status, state] of [
    ['error', 'failed'],
    ['locked', 'failed'],
    ['deleted', 'deleted'],
  ]) {
    const terminal = await followDeployment(
      project,
      id,
      signal,
      async () => resource(status),
      () => {},
      async () => {},
    );
    assert.equal(terminal.state, state);
    assert.equal(terminal.reads, 1);
  }
});
test('follow cancellation/foreign scope/transport failure stops without optimistic success', async () => {
  const abort = new AbortController();
  const result = await followDeployment(
    project,
    id,
    abort.signal,
    async () => resource('creating'),
    () => {},
    async () => {
      abort.abort();
    },
  );
  assert.equal(result.state, 'cancelled');
  assert.equal(result.reads, 1);
  await assert.rejects(
    followDeployment(
      project,
      id,
      new AbortController().signal,
      async () => ({ ...resource('ready'), id: project.id }),
      () => assert.fail('foreign update'),
      async () => {},
    ),
    { code: 'foreign_or_invalid_scope' },
  );
  await assert.rejects(
    followDeployment(
      project,
      id,
      new AbortController().signal,
      async () => {
        throw new ReadError('access_denied');
      },
      () => {},
      async () => {},
    ),
    { code: 'access_denied' },
  );
  const waitAbort = new AbortController();
  const delay = abortableDelay(10000, waitAbort.signal);
  waitAbort.abort();
  await assert.rejects(delay, { code: 'cancelled' });
});
