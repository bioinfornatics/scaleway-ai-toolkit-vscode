const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  deploymentOptions,
  prepareDeploymentDraft,
  validHourlyCeiling,
} = require('../dist/deployment');
const {
  parseDedicatedModelInfo,
  listDedicatedCatalog,
  listNodeTypes,
  getJSON,
} = require('../dist/provider');
const project = {
  id: '11111111-1111-1111-1111-111111111111',
  organizationId: '22222222-2222-2222-2222-222222222222',
  name: 'Test',
};
const modelId = '33333333-3333-3333-3333-333333333333';
const token = 'eyJhbGciOiJSUzI1NiJ9.eyJleHAiOjQwMDAwMDAwMDB9.c3ludGhldGlj';
const model = {
  id: modelId,
  label: 'provider/model:fp4',
  kind: 'dedicated-catalog',
  status: 'Catalogue fournisseur · ready',
  dedicatedInfo: {
    status: 'ready',
    hasEula: true,
    supportedNodes: [
      {
        nodeTypeName: 'H100',
        quantizationBits: 8,
        allowed: true,
        maxContextSize: 131072,
      },
      {
        nodeTypeName: 'L4',
        quantizationBits: 8,
        allowed: false,
        maxContextSize: 0,
      },
    ],
  },
};
const hardware = [
  { name: 'H100', stockStatus: 'available', disabled: false, region: 'fr-par' },
];
const rawModel = {
  id: modelId,
  name: model.label,
  project_id: '00000000-0000-0000-0000-000000000000',
  region: 'fr-par',
  status: 'ready',
  has_eula: true,
  nodes_support: [
    {
      nodes: [
        {
          node_type_name: 'H100',
          quantizations: [
            { quantization_bits: 8, allowed: true, max_context_size: 131072 },
          ],
        },
      ],
    },
  ],
};
const signal = () => new AbortController().signal;
const input = () => ({
  name: 'candidate',
  option: deploymentOptions(model, hardware)[0],
  network: { type: 'public', authentication: 'iam' },
  maxHourlyEUR: '12.3456',
});
test('model metadata preserves exact numeric bits and license; sentinel is not project ownership', async () => {
  const rows = await listDedicatedCatalog(
    project,
    token,
    signal(),
    async () => ({ models: [rawModel], total_count: 1 }),
  );
  assert.equal(rows[0].dedicatedInfo.supportedNodes[0].quantizationBits, 8);
  assert.equal(rows[0].dedicatedInfo.hasEula, true);
  assert.match(rows[0].status, /Catalogue fournisseur/);
  assert.equal(parseDedicatedModelInfo({ status: 'ready' }).hasEula, undefined);
  assert.deepEqual(parseDedicatedModelInfo({}).supportedNodes, []);
});
test('malformed and conflicting compatibility are rejected, not silently repaired', () => {
  assert.throws(() => parseDedicatedModelInfo({ has_eula: 'false' }), {
    code: 'invalid_response',
  });
  assert.throws(
    () =>
      parseDedicatedModelInfo({
        nodes_support: [
          {
            nodes: [
              {
                node_type_name: 'H100',
                quantizations: [
                  {
                    allowed: true,
                    quantization_bits: '8',
                    max_context_size: 1,
                  },
                ],
              },
            ],
          },
        ],
      }),
    { code: 'invalid_response' },
  );
  const row = structuredClone(rawModel);
  row.nodes_support[0].nodes[0].quantizations.push({
    quantization_bits: 8,
    allowed: false,
    max_context_size: 0,
  });
  assert.throws(() => parseDedicatedModelInfo(row), {
    code: 'conflicting_compatibility',
  });
});
test('only ready, explicitly allowed, enabled and stocked compatible nodes offered', () => {
  assert.equal(deploymentOptions(model, hardware).length, 1);
  for (const stockStatus of ['unknown_stock', 'out_of_stock', 'future_stock'])
    assert.deepEqual(
      deploymentOptions(model, [{ ...hardware[0], stockStatus }]),
      [],
    );
  assert.equal(
    deploymentOptions(model, [{ ...hardware[0], stockStatus: 'low_stock' }])
      .length,
    1,
  );
  assert.deepEqual(
    deploymentOptions(model, [{ ...hardware[0], disabled: true }]),
    [],
  );
  assert.deepEqual(
    deploymentOptions(model, [{ ...hardware[0], region: 'nl-ams' }]),
    [],
  );
  for (const status of ['error', 'preparing', 'unknown'])
    assert.deepEqual(
      deploymentOptions(
        { ...model, dedicatedInfo: { ...model.dedicatedInfo, status } },
        hardware,
      ),
      [],
    );
  assert.deepEqual(
    deploymentOptions({ ...model, kind: 'serverless' }, hardware),
    [],
  );
});
test('hardware uses source-backed bounded GET without project query or write', async () => {
  const paths = [];
  const rows = await listNodeTypes(
    token,
    signal(),
    async (origin, path, key) => {
      assert.equal(origin, 'control');
      assert.equal(key, token);
      paths.push(path);
      return {
        node_types: [
          {
            name: 'H100',
            stock_status: 'available',
            disabled: false,
            region: 'fr-par',
          },
        ],
        total_count: 1,
      };
    },
  );
  assert.deepEqual(rows, hardware);
  assert.deepEqual(paths, [
    '/inference/v1/regions/fr-par/node-types?include_disabled_types=true&page=1&page_size=100',
  ]);
  await assert.rejects(
    getJSON(
      'control',
      '/inference/v1/regions/fr-par/node-types?include_disabled_types=true&page=6&page_size=100',
      token,
      signal(),
    ),
    { code: 'invalid_request' },
  );
  await assert.rejects(
    listNodeTypes(token, signal(), async () => ({
      node_types: [
        {
          name: 'H100',
          stock_status: 'available',
          disabled: false,
          region: 'nl-ams',
        },
      ],
    })),
    { code: 'foreign_or_invalid_scope' },
  );
  await assert.rejects(
    listNodeTypes(token, signal(), async () => ({
      node_types: [
        {
          name: 'H100',
          stock_status: 'available',
          disabled: false,
          region: 'fr-par',
        },
        {
          name: 'H100',
          stock_status: 'available',
          disabled: false,
          region: 'fr-par',
        },
      ],
    })),
    { code: 'duplicate_id' },
  );
});
test('hourly ceiling is exact positive decimal, never assumed provider price', () => {
  for (const value of ['1', '0.0001', '12.3456', '999999.9999'])
    assert.equal(validHourlyCeiling(value), true);
  for (const value of [
    '0',
    '0.0000',
    '-1',
    '1e3',
    'NaN',
    '12,5',
    '01',
    '1.12345',
    '1000000',
    ' 1 ',
  ])
    assert.equal(validHourlyCeiling(value), false);
});
test('prepared plan is projected, unlicensed, non-executable and has explicit unknown blockers', () => {
  const draft = prepareDeploymentDraft(
    { ...project, token: 'must-not-leak' },
    { ...model, secret: 'must-not-leak' },
    hardware,
    input(),
    new Date('2026-10-21T00:00:00Z'),
  );
  assert.equal(draft.executable, false);
  assert.equal(draft.checks.allocation, 'not_requested');
  assert.equal(draft.checks.price, 'unknown');
  assert.equal(draft.checks.quota, 'unknown');
  assert.equal(draft.license.accepted, false);
  assert.equal(draft.infrastructure.quantizationBits, 8);
  assert.equal(draft.infrastructure.nodes, 1);
  assert.equal(draft.budget.maxHourlyEUR, '12.3456');
  assert.ok(!JSON.stringify(draft).includes('must-not-leak'));
  assert.match(draft.blockers.join(' '), /EULA/);
});
test('tampered option, network auth and budget fail closed; private UUID is explicit', () => {
  assert.throws(
    () =>
      prepareDeploymentDraft(project, model, hardware, {
        ...input(),
        option: { ...input().option, quantizationBits: 4 },
      }),
    { code: 'incompatible_or_unavailable_node' },
  );
  assert.throws(
    () =>
      prepareDeploymentDraft(project, model, hardware, {
        ...input(),
        network: { type: 'public', authentication: 'none' },
      }),
    { code: 'invalid_network' },
  );
  assert.throws(
    () =>
      prepareDeploymentDraft(project, model, hardware, {
        ...input(),
        maxHourlyEUR: '0',
      }),
    { code: 'invalid_preparation' },
  );
  assert.throws(
    () =>
      prepareDeploymentDraft(project, model, hardware, {
        ...input(),
        network: {
          type: 'private',
          authentication: 'iam',
          privateNetworkId: 'bad',
        },
      }),
    { code: 'invalid_network' },
  );
  const draft = prepareDeploymentDraft(project, model, hardware, {
    ...input(),
    network: {
      type: 'private',
      authentication: 'iam',
      privateNetworkId: project.id,
    },
  });
  assert.equal(draft.network.privateNetworkId, project.id);
});
