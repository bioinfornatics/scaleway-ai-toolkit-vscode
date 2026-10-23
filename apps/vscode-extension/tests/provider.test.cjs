const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  listProjects,
  listServerless,
  listDedicated,
  getJSON,
  sessionHeaders,
  listOrganizations,
  listDedicatedCatalog,
} = require('../dist/provider');
const org = '11111111-1111-1111-1111-111111111111',
  id = '22222222-2222-2222-2222-222222222222';
const key = 'eyJhbGciOiJSUzI1NiJ9.eyJleHAiOjQwMDAwMDAwMDB9.c3ludGhldGlj';
const signal = () => new AbortController().signal;
test('projects scoped GET and normalized safe fields', async () => {
  let count = 0;
  const rows = await listProjects(
    org,
    key,
    signal(),
    async (origin, path, k) => {
      count++;
      assert.equal(origin, 'control');
      assert.ok(path.includes(`organization_id=${org}`));
      assert.equal(k, key);
      return {
        projects: [{ id, name: 'Test', organization_id: org, secret: 'omit' }],
        total_count: 1,
      };
    },
  );
  assert.equal(count, 1);
  assert.deepEqual(rows, [{ id, name: 'Test', organizationId: org }]);
});
test('foreign project and malformed response reject instead of empty', async () => {
  await assert.rejects(
    listProjects(org, key, signal(), async () => ({
      projects: [{ id, name: 'Test', organization_id: id }],
      total_count: 1,
    })),
    { code: 'foreign_or_invalid_scope' },
  );
  await assert.rejects(
    listServerless(key, signal(), async () => ({ error: 'private error' })),
    { code: 'invalid_response' },
  );
});
test('public offering catalog groups variants without JWT; inference origin remains disabled', async () => {
  let sends = 0;
  const product = {
    sku: 'input',
    product: 'model-a',
    status: 'preview',
    locality: { region: 'fr-par' },
    properties: { generative_apis: {} },
  };
  const rows = await listServerless(key, signal(), async (o, p, k) => {
    sends++;
    assert.equal(o, 'control');
    assert.ok(
      p.startsWith(
        '/product-catalog/v2alpha1/public-catalog/products?product_types=generative_apis&region=fr-par',
      ),
    );
    assert.equal(k, '');
    return {
      products: [product, { ...product, sku: 'output' }],
      total_count: 2,
    };
  });
  assert.equal(sends, 1);
  assert.deepEqual(rows, [
    { id: 'model-a', label: 'model-a', kind: 'serverless', status: 'preview' },
  ]);
  assert.deepEqual(sessionHeaders(key), {
    'X-Session-Token': key,
    Accept: 'application/json',
  });
  await assert.rejects(getJSON('models', '/v1/models', key, signal()), {
    code: 'invalid_request',
  });
  assert.throws(() => sessionHeaders('api_key'), { code: 'invalid_request' });
});
test('dedicated deployments require exact project and region', async () => {
  const project = { id, name: 'Test', organizationId: org };
  await assert.rejects(
    listDedicated(project, key, signal(), async () => ({
      deployments: [
        { id, name: 'Deployment', project_id: org, region: 'fr-par' },
      ],
      total_count: 1,
    })),
    { code: 'foreign_or_invalid_scope' },
  );
  assert.deepEqual(
    await listDedicated(project, key, signal(), async () => ({
      deployments: [],
      total_count: 0,
    })),
    [],
  );
});
test('pagination has hard five-send ceiling', async () => {
  let sends = 0;
  await assert.rejects(
    listProjects(org, key, signal(), async () => {
      sends++;
      return {
        projects: Array.from({ length: 100 }, () => ({
          id,
          name: 'Test',
          organization_id: org,
        })),
        total_count: 1000,
      };
    }),
    { code: 'page_limit' },
  );
  assert.equal(sends, 5);
});
test('already cancelled dispatch and unknown routes never send', async () => {
  const c = new AbortController();
  c.abort();
  await assert.rejects(getJSON('models', '/v1/models', key, c.signal), {
    code: 'cancelled',
  });
  await assert.rejects(
    getJSON('models', '/v1/chat/completions', key, signal()),
    { code: 'invalid_request' },
  );
  await assert.rejects(
    getJSON('control', '/account/v3/projects?evil=x', key, signal()),
    { code: 'invalid_request' },
  );
});

test('IAM user connections provides organization names/IDs only with one scoped GET', async () => {
  let sends = 0;
  const rows = await listOrganizations(id, key, signal(), async (o, p, k) => {
    sends++;
    assert.equal(o, 'control');
    assert.equal(p, `/iam/v1alpha1/users/${id}/connections`);
    assert.equal(k, key);
    return {
      connections: [
        {
          organization: { id: org, name: 'Test organization', locked: false },
          user: { id, email: 'never retain' },
        },
      ],
    };
  });
  assert.equal(sends, 1);
  assert.deepEqual(rows, [
    { id: org, name: 'Test organization', locked: false },
  ]);
  await assert.rejects(
    listOrganizations('bad', key, signal(), async () => {
      assert.fail('invalid scope must not send');
    }),
    { code: 'invalid_scope' },
  );
  await assert.rejects(
    listOrganizations(id, key, signal(), async () => ({
      connections: [{ organization: { id: org, name: 'Test', locked: 'no' } }],
    })),
    { code: 'invalid_response' },
  );
  await assert.rejects(
    getJSON(
      'control',
      `/iam/v1alpha1/users/${id}/connections?extra=1`,
      key,
      signal(),
    ),
    { code: 'invalid_request' },
  );
  await assert.rejects(
    getJSON(
      'control',
      '/iam/v1alpha1/users/not-a-uuid/connections',
      key,
      signal(),
    ),
    { code: 'invalid_request' },
  );
});

test('dedicated model catalog distinct from deployments accepts provider sentinel and selected project only', async () => {
  const project = { id, name: 'Test', organizationId: org };
  const model = {
    id: org,
    name: 'Model',
    region: 'fr-par',
    project_id: '00000000-0000-0000-0000-000000000000',
    status: 'ready',
  };
  const rows = await listDedicatedCatalog(
    project,
    key,
    signal(),
    async (_o, p) => {
      assert.ok(p.startsWith('/inference/v1/regions/fr-par/models?'));
      return { models: [model], total_count: 1 };
    },
  );
  assert.equal(rows[0].kind, 'dedicated-catalog');
  assert.ok(rows[0].status.startsWith('Catalogue fournisseur'));
  await assert.rejects(
    listDedicatedCatalog(project, key, signal(), async () => ({
      models: [{ ...model, project_id: org }],
      total_count: 1,
    })),
    { code: 'foreign_or_invalid_scope' },
  );
});

test('safe names reject every ASCII control while preserving Unicode', () => {
  const { text } = require('../dist/provider');
  for (const code of [...Array.from({ length: 32 }, (_, i) => i), 127]) {
    assert.equal(text(`before${String.fromCharCode(code)}after`), false);
  }
  for (const name of ['Projet français', '模型 🚀', 'normal'])
    assert.equal(text(name), true);
  for (const value of ['', 'a'.repeat(257), null, 42])
    assert.equal(text(value), false);
});

test('Serverless public price projection preserves exact unit and realtime/batch distinction', async () => {
  const row = {
    sku: 'input',
    product: 'priced-model',
    status: 'preview',
    locality: { region: 'fr-par' },
    properties: {
      generative_apis: {
        token_type: 'input_token',
        consumption_mode: 'realtime',
      },
    },
    price: { retail_price: { currency_code: 'EUR', units: 0, nanos: 1800000 } },
    unit_of_measure: { unit: 'token', size: 1000 },
  };
  const result = await listServerless('', signal(), async () => ({
    products: [
      row,
      {
        ...row,
        sku: 'batch',
        properties: {
          generative_apis: {
            token_type: 'input_token',
            consumption_mode: 'batch',
          },
        },
      },
    ],
    total_count: 2,
  }));
  assert.equal(result[0].serverlessPrices.length, 2);
  assert.equal(result[0].serverlessPrices[0].amountEUR, '0.0018');
  assert.equal(result[0].serverlessPrices[0].size, 1000);
  assert.equal(result[0].serverlessPrices[1].consumptionMode, 'batch');
  const unknown = await listServerless('', signal(), async () => ({
    products: [
      {
        ...row,
        price: {
          retail_price: {
            currency_code: 'EUR',
            units: 9007199254740992,
            nanos: 0,
          },
        },
      },
    ],
    total_count: 1,
  }));
  assert.equal(unknown[0].serverlessPrices, undefined);
});

async function capabilityRows(properties) {
  return listServerless('', signal(), async () => ({
    products: properties.map((props, i) => ({
      sku: 'fixture-' + i,
      product: 'configurable-model',
      status: 'preview',
      locality: { region: 'fr-par' },
      properties: { generative_apis: props },
    })),
    total_count: properties.length,
  }));
}
for (const [name, props, expected] of [
  [
    'text chat',
    { tasks: ['chat'], supported_apis: ['/v1/chat/completions'] },
    'supported',
  ],
  ['code', { tasks: ['code'] }, 'supported'],
  ['route only', { supported_apis: ['/v1/chat/completions'] }, 'supported'],
  [
    'embeddings',
    { tasks: ['embeddings'], supported_apis: ['/v1/embeddings'] },
    'unsupported',
  ],
  ['transcription', { tasks: ['audio_transcription'] }, 'unsupported'],
  [
    'OCR on chat route is not general text chat',
    { tasks: ['ocr'], supported_apis: ['/v1/chat/completions'] },
    'unsupported',
  ],
  ['future modality', { tasks: ['future_task'] }, 'unknown'],
  ['vision alone', { tasks: ['vision'] }, 'unknown'],
  [
    'no chat route',
    { tasks: ['chat'], supported_apis: ['/v1/responses'] },
    'unsupported',
  ],
])
  test('capability projection: ' + name, async () => {
    const [row] = await capabilityRows([props]);
    assert.equal(row.serverlessCapabilities.textChat, expected);
    assert.deepEqual(row.serverlessCapabilities.tasks, props.tasks ?? []);
    const invocation = require('../dist/provider').serverlessInvocation(row);
    assert.equal(!!invocation, expected !== 'unsupported');
    if (invocation) assert.equal(invocation.modelId, 'configurable-model');
  });
test('missing/invalid metadata does not block models; conflicting SKU declarations remain unknown', async () => {
  for (const props of [
    {},
    { tasks: null, supported_apis: null },
    { tasks: 'chat', supported_apis: [42] },
  ]) {
    const [row] = await capabilityRows([props]);
    assert.equal(row.serverlessCapabilities, undefined);
    assert.equal(
      require('../dist/provider').serverlessInvocation(row).capability,
      'unknown',
    );
  }
  const [row] = await capabilityRows([
    { tasks: ['chat'] },
    { tasks: ['embeddings'] },
  ]);
  assert.equal(row.serverlessCapabilities.textChat, 'unknown');
  assert.ok(require('../dist/provider').serverlessInvocation(row));
});
test('model lifecycle blocks only entirely retired offerings, not live variants or similar substrings', () => {
  const { serverlessInvocation } = require('../dist/provider');
  for (const status of [
    'retired / preview',
    'general_availability',
    'future-eol-like-status',
  ])
    assert.ok(
      serverlessInvocation({ id: 'any-model', kind: 'serverless', status }),
    );
  for (const status of ['retired', 'end_of_life / eol', 'RETIRED'])
    assert.equal(
      serverlessInvocation({ id: 'any-model', kind: 'serverless', status }),
      undefined,
    );
});

test('actual project pagination rejects foreign later pages without returning partial success', async () => {
  let reads = 0;
  await assert.rejects(
    listProjects(org, key, signal(), async () => {
      reads++;
      return {
        projects: Array.from({ length: reads === 1 ? 100 : 1 }, () => ({
          id,
          name: 'Project',
          organization_id: reads === 1 ? org : id,
        })),
        total_count: 101,
      };
    }),
    { code: 'foreign_or_invalid_scope' },
  );
  assert.equal(reads, 2);
});
