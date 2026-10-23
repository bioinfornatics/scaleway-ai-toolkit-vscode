const assert = require('node:assert/strict');
const { test } = require('node:test');
const { parseDeployment, getDeployment } = require('../dist/provider');
const project = {
  id: '11111111-1111-1111-1111-111111111111',
  organizationId: '22222222-2222-2222-2222-222222222222',
  name: 'Test',
};
const id = '33333333-3333-3333-3333-333333333333';
const modelId = '44444444-4444-4444-4444-444444444444';
const endpointId = '55555555-5555-5555-5555-555555555555';
const base = {
  id,
  name: 'Deployed Model',
  project_id: project.id,
  region: 'fr-par',
  status: 'ready',
  model_id: modelId,
  model_name: 'provider/model:variant',
  node_type_name: 'H100',
  endpoints: [
    {
      id: endpointId,
      url: 'https://returned.example.invalid/v1',
      disable_auth: false,
      public_network: {},
    },
  ],
  token: 'must-not-project',
};
test('deployment projection preserves model identity, returned URL/network/auth and fetch time', () => {
  const row = parseDeployment(base, project, new Date('2026-10-21T00:00:00Z'));
  assert.equal(row.kind, 'dedicated');
  assert.equal(row.deploymentInfo.modelId, modelId);
  assert.equal(row.deploymentInfo.fetchedAt, '2026-10-21T00:00:00.000Z');
  assert.equal(row.deploymentInfo.endpoints[0].url, base.endpoints[0].url);
  assert.equal(row.deploymentInfo.endpoints[0].network, 'public');
  assert.equal(row.deploymentInfo.endpoints[0].authentication, 'iam');
  assert.ok(!JSON.stringify(row).includes('must-not-project'));
});
test('private endpoints and disabled auth explicit; missing metadata remains unknown', () => {
  const row = parseDeployment(
    {
      ...base,
      endpoints: [
        {
          ...base.endpoints[0],
          public_network: undefined,
          private_network: { private_network_id: project.id },
          disable_auth: true,
        },
      ],
    },
    project,
  );
  assert.equal(row.deploymentInfo.endpoints[0].network, 'private');
  assert.equal(row.deploymentInfo.endpoints[0].authentication, 'disabled');
  assert.equal(row.deploymentInfo.endpoints[0].privateNetworkId, project.id);
  assert.equal(
    parseDeployment(
      { ...base, endpoints: undefined, status: 'future_state' },
      project,
    ).deploymentInfo.endpoints,
    undefined,
  );
  assert.equal(
    parseDeployment({ ...base, status: 'creating' }, project).status,
    'creating',
  );
});
test('foreign scopes, ambiguous network and credential/query-bearing URLs reject', () => {
  for (const change of [
    { project_id: project.organizationId },
    { region: 'nl-ams' },
    { model_id: 'bad' },
  ])
    assert.throws(() => parseDeployment({ ...base, ...change }, project));
  for (const endpoint of [
    {
      ...base.endpoints[0],
      private_network: { private_network_id: project.id },
    },
    { ...base.endpoints[0], public_network: undefined },
    {
      ...base.endpoints[0],
      public_network: undefined,
      private_network: { private_network_id: 'bad' },
    },
    ...[
      'http://bad.invalid',
      'https://user:secret@bad.invalid',
      'https://bad.invalid?token=secret',
      'https://bad.invalid#secret',
    ].map((url) => ({ ...base.endpoints[0], url })),
  ])
    assert.throws(() =>
      parseDeployment({ ...base, endpoints: [endpoint] }, project),
    );
});
test('detail is a single control GET, exact selected identity, no endpoint probe', async () => {
  const signal = new AbortController().signal;
  let calls = 0;
  const row = await getDeployment(
    project,
    id,
    'synthetic',
    signal,
    async (origin, path, key) => {
      calls++;
      assert.equal(origin, 'control');
      assert.equal(path, `/inference/v1/regions/fr-par/deployments/${id}`);
      assert.equal(key, 'synthetic');
      return base;
    },
  );
  assert.equal(calls, 1);
  assert.equal(row.id, id);
  await assert.rejects(
    getDeployment(project, id, 'synthetic', signal, async () => ({
      ...base,
      id: modelId,
    })),
    { code: 'foreign_or_invalid_scope' },
  );
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    getDeployment(project, id, 'synthetic', abort.signal, async () =>
      assert.fail('cancelled send'),
    ),
    { code: 'cancelled' },
  );
});
