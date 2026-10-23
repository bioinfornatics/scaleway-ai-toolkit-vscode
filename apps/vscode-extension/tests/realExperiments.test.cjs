const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  parseRealExperiment,
  decodeRealExperiment,
  encodeRealExperiment,
  REAL_OUTPUT_BYTES,
  REAL_EXPERIMENT_BYTES,
} = require('../dist/realExperiments');
const project = '11111111-1111-1111-1111-111111111111';
const deployment = '22222222-2222-2222-2222-222222222222';
const endpoint = '33333333-3333-3333-3333-333333333333';
const experiment = () => ({
  version: 1,
  mode: 'real-provider',
  status: 'partial',
  timestamp: '2026-10-21T12:00:00.000Z',
  service: {
    kind: 'serverless',
    organizationId: project,
    projectId: project,
    modelId: 'model-id',
    modelName: 'display/name',
    destination: `https://api.scaleway.ai/${project}/v1/chat/completions`,
    authentication: 'iam',
  },
  prompt: 'Exact prompt "quotes" \\ paths 模型 🚀\n  ',
  maxTokens: 50,
  output: 'partial\n<script>x</script>',
  execution: { environment: 'live', billed: 'possible' },
  usage: {
    inputTokens: 10,
    outputTokens: 3,
    totalTokens: 13,
    cachedInputTokens: 2,
  },
  cost: {
    actual: 'unknown',
    billing: 'token',
    estimate: {
      source: 'public-catalog',
      currency: 'EUR',
      amount: 0.0003,
      retrievedAt: '2026-10-20T12:00:00.000Z',
    },
  },
});
const dedicated = () => ({
  ...experiment(),
  service: {
    kind: 'dedicated',
    organizationId: project,
    projectId: project,
    modelId: project,
    modelName: 'provider/model',
    destination: `https://${deployment}.ifr.fr-par.scaleway.com/v1/chat/completions`,
    authentication: 'disabled',
    region: 'fr-par',
    deploymentId: deployment,
    endpointId: endpoint,
    endpointUrl: `https://${deployment}.ifr.fr-par.scaleway.com/v1`,
  },
  cost: { actual: 'unknown', billing: 'deployment-duration' },
});
test('fresh deeply immutable roundtrip for all statuses, kinds, auth and execution provenance', () => {
  for (const value of [experiment(), dedicated()])
    for (const status of ['completed', 'cancelled', 'failed', 'partial']) {
      value.status = status;
      const parsed = parseRealExperiment(value);
      assert.deepEqual(parsed, value);
      assert.deepEqual(
        decodeRealExperiment(encodeRealExperiment(value)),
        value,
      );
      assert.notEqual(parsed, value);
      for (const v of [
        parsed,
        parsed.service,
        parsed.execution,
        parsed.usage,
        parsed.cost,
        parsed.cost.estimate,
      ].filter(Boolean))
        assert.ok(Object.isFrozen(v));
      const before = parsed.service.modelName;
      value.service.modelName = 'changed';
      assert.equal(parsed.service.modelName, before);
    }
  const mock = {
    ...experiment(),
    execution: { environment: 'local-mock', billed: 'none' },
  };
  assert.ok(parseRealExperiment(mock));
  const minimal = experiment();
  delete minimal.usage;
  delete minimal.cost;
  assert.ok(parseRealExperiment(minimal));
  const iam = dedicated();
  iam.service.authentication = 'iam';
  assert.ok(parseRealExperiment(iam));
});
test('exact keys at each level reject credentials, headers and arbitrary extras', () => {
  const paths = [
    [],
    ['service'],
    ['execution'],
    ['usage'],
    ['cost'],
    ['cost', 'estimate'],
  ];
  for (const path of paths)
    for (const key of ['secretKey', 'headers', 'token', 'extra', '__proto__']) {
      const e = experiment();
      let target = e;
      for (const p of path) target = target[p];
      Object.defineProperty(target, key, {
        value: 'not-a-secret',
        enumerable: true,
      });
      assert.equal(parseRealExperiment(e), undefined, path.join('.') + key);
    }
  const getter = experiment();
  Object.defineProperty(getter, 'output', {
    enumerable: true,
    get() {
      throw new Error('must not evaluate');
    },
  });
  assert.equal(parseRealExperiment(getter), undefined);
  const symbol = experiment();
  symbol[Symbol('extra')] = 1;
  assert.equal(parseRealExperiment(symbol), undefined);
  assert.equal(
    parseRealExperiment(
      Object.assign(Object.create({ injected: 1 }), experiment()),
    ),
    undefined,
  );
});
test('invalid fields, unknown versions, billing claims and invalid usage rejected', () => {
  for (const patch of [
    { version: 2 },
    { mode: 'offline-synthetic' },
    { status: 'exported' },
    { timestamp: '2026-02-30T12:00:00.000Z' },
    { timestamp: 'today' },
    { prompt: '' },
    { prompt: 'x'.repeat(4097) },
    { prompt: '\ud800' },
    { maxTokens: 0 },
    { maxTokens: 2049 },
    { maxTokens: 1.5 },
    { output: '\udfff' },
    { execution: { environment: 'live', billed: 'none' } },
    { execution: { environment: 'local-mock', billed: 'possible' } },
    { usage: undefined },
    { usage: { inputTokens: 2, outputTokens: 3, totalTokens: 4 } },
    {
      usage: {
        inputTokens: 2,
        outputTokens: 3,
        totalTokens: 5,
        cachedInputTokens: 3,
      },
    },
    { cost: { actual: 1, billing: 'token' } },
    { cost: { actual: 'unknown', billing: 'deployment-duration' } },
  ])
    assert.equal(parseRealExperiment({ ...experiment(), ...patch }), undefined);
  for (const value of [null, [], 'x', false])
    assert.equal(parseRealExperiment(value), undefined);
  for (const amount of [NaN, Infinity, -1]) {
    const e = experiment();
    e.cost.estimate.amount = amount;
    assert.equal(parseRealExperiment(e), undefined);
  }
  const e = dedicated();
  e.cost.estimate = experiment().cost.estimate;
  assert.equal(parseRealExperiment(e), undefined);
});
test('only exact fixed serverless path or narrow dedicated policy public endpoint accepted', () => {
  for (const destination of [
    `http://api.scaleway.ai/${project}/v1/chat/completions`,
    `https://api.scaleway.ai/${endpoint}/v1/chat/completions`,
    `${experiment().service.destination}?`,
    `${experiment().service.destination}#`,
    `${experiment().service.destination}/`,
    `https://user:pass@api.scaleway.ai/${project}/v1/chat/completions`,
    'https://localhost/v1/chat/completions',
  ]) {
    const e = experiment();
    e.service.destination = destination;
    assert.equal(parseRealExperiment(e), undefined);
  }
  for (const patch of [
    { endpointUrl: 'https://127.0.0.1/v1' },
    {
      endpointUrl: `https://${deployment}.ifr.fr-par.scaleway.com:443/v1`,
    },
    {
      endpointUrl: `https://${deployment}.ifr.fr-par.scaleway.com/a/../v1`,
    },
    { endpointUrl: `https://${deployment}.ifr.fr-par.scaleway.com/v1?` },
    { deploymentId: endpoint },
    { endpointId: 'bad' },
    { modelId: 'not-uuid' },
    { modelName: 'invalid name' },
    { region: 'nl-ams' },
    { authentication: 'jwt' },
    { network: 'private' },
  ]) {
    const e = dedicated();
    Object.assign(e.service, patch);
    assert.equal(parseRealExperiment(e), undefined);
  }
  const server = experiment();
  server.service.deploymentId = deployment;
  assert.equal(parseRealExperiment(server), undefined);
});
test('transport-sized output allowed, bounded file, fatal UTF8 and JSON decoding', () => {
  const e = experiment();
  e.output = '\u0000'.repeat(REAL_OUTPUT_BYTES);
  const bytes = encodeRealExperiment(e);
  assert.ok(bytes.byteLength <= REAL_EXPERIMENT_BYTES);
  assert.deepEqual(decodeRealExperiment(bytes), e);
  e.output += 'a';
  assert.equal(parseRealExperiment(e), undefined);
  assert.throws(() => encodeRealExperiment(e), /invalid_real_experiment/);
  assert.equal(
    decodeRealExperiment(new Uint8Array(REAL_EXPERIMENT_BYTES + 1)),
    undefined,
  );
  for (const bytes of [
    Buffer.from([255]),
    Buffer.from([0xc0, 0xaf]),
    Buffer.from('{broken'),
  ])
    assert.equal(decodeRealExperiment(bytes), undefined);
});
test('4096 UTF16 Unicode prompts preserve exact data up to 12288 UTF8 bytes', () => {
  for (const prompt of [
    '模'.repeat(4096),
    '🚀'.repeat(2048),
    'é'.repeat(4096),
    'a'.repeat(4096),
  ]) {
    const e = { ...experiment(), prompt };
    assert.equal(decodeRealExperiment(encodeRealExperiment(e)).prompt, prompt);
  }
  for (const prompt of [
    '模'.repeat(4097),
    `${'🚀'.repeat(2048)}a`,
    '\ud800'.repeat(4096),
  ])
    assert.equal(parseRealExperiment({ ...experiment(), prompt }), undefined);
});
test('optional sanitized failure and native execution status distinguish partial timeout and HTTP failure', () => {
  const { sanitizeRealFailure } = require('../dist/realExperiments');
  for (const failure of [
    { code: 'timeout' },
    { code: 'idle_timeout' },
    { code: 'http_error', status: 429 },
  ]) {
    const e = {
      ...experiment(),
      failure,
      execution: {
        ...experiment().execution,
        status: 'Délai total dépassé · réponse partielle conservée',
      },
    };
    assert.deepEqual(decodeRealExperiment(encodeRealExperiment(e)), e);
    assert.ok(Object.isFrozen(parseRealExperiment(e).failure));
  }
  for (const failure of [
    { code: 'secret body' },
    { code: 'timeout', status: 500 },
    { code: 'http_error', status: 200 },
    { code: 'http_error', status: 600 },
    { code: 'http_error', status: 429.5 },
    { code: 'http_error', status: '429' },
    { code: 'timeout', message: 'body' },
    undefined,
  ])
    assert.equal(parseRealExperiment({ ...experiment(), failure }), undefined);
  assert.equal(
    parseRealExperiment({
      ...experiment(),
      status: 'completed',
      failure: { code: 'timeout' },
    }),
    undefined,
  );
  assert.deepEqual(sanitizeRealFailure('http_error', 403), {
    code: 'http_error',
    status: 403,
  });
  assert.deepEqual(sanitizeRealFailure('secret body', 500), {
    code: 'access_denied',
  });
  assert.deepEqual(sanitizeRealFailure('timeout', 500), { code: 'timeout' });
  assert.deepEqual(sanitizeRealFailure('http_error', 200), {
    code: 'http_error',
  });
  for (const status of ['', '\ud800', 'x'.repeat(1025), undefined, {}])
    assert.equal(
      parseRealExperiment({
        ...experiment(),
        execution: { ...experiment().execution, status },
      }),
      undefined,
    );
});
test('public display estimate preserved with explicitly unknown retrieval provenance; actual stays unknown', () => {
  const publicEstimate = {
    source: 'public-catalog',
    currency: 'EUR',
    display: '0.000000003 EUR estimés HT (tarif public, non facture)',
    retrievedAt: 'unknown',
  };
  const e = experiment();
  e.cost.publicEstimate = publicEstimate;
  assert.deepEqual(decodeRealExperiment(encodeRealExperiment(e)), e);
  assert.ok(Object.isFrozen(parseRealExperiment(e).cost.publicEstimate));
  for (const patch of [
    { source: 'bill' },
    { display: 'secret body' },
    { retrievedAt: 'today' },
    { currency: 'USD' },
    { actual: 3 },
    { headers: {} },
  ]) {
    e.cost.publicEstimate = { ...publicEstimate, ...patch };
    assert.equal(parseRealExperiment(e), undefined);
  }
  const d = dedicated();
  d.cost.publicEstimate = publicEstimate;
  assert.equal(parseRealExperiment(d), undefined);
});
