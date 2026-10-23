const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const https = require('node:https');
const Module = require('node:module');
const { createHash } = require('node:crypto');
const { test } = require('node:test');
const project = {
  id: '11111111-1111-1111-1111-111111111111',
  organizationId: '22222222-2222-2222-2222-222222222222',
  name: 'Test project',
};
const model = {
  id: '33333333-3333-3333-3333-333333333333',
  label: 'Vendor/Model Name!',
  kind: 'dedicated-catalog',
  dedicatedInfo: {
    status: 'ready',
    hasEula: false,
    supportedNodes: [
      {
        nodeTypeName: 'H100',
        quantizationBits: 8,
        allowed: true,
        maxContextSize: 4096,
      },
    ],
  },
};
const nodes = [
  { name: 'H100', region: 'fr-par', disabled: false, stockStatus: 'available' },
];
const secret = '44444444-4444-4444-4444-444444444444';
const signal = () => new AbortController().signal;
const price = () => ({
  nodeTypeName: 'H100',
  sku: '/ai/inference_dedicated/deployment/h100-1/fr-par',
  region: 'fr-par',
  currency: 'EUR',
  amountEUR: '0.05666',
  unit: 'node',
  size: 1,
  period: 'unspecified-in-catalog',
  source: 'public-retail-not-account-price',
  fetchedAt: new Date().toISOString(),
});
function setup({
  cancelAt,
  invalidateAt,
  pick,
  name,
  requireEula = false,
  prices = [price()],
} = {}) {
  let current = true;
  let step = 0;
  const calls = [];
  const m = structuredClone(model);
  m.dedicatedInfo.hasEula = requireEula;
  const content = '<script>not executed</script>\nLicense text';
  const eula = requireEula
    ? {
        modelId: m.id,
        projectId: project.id,
        organizationId: project.organizationId,
        region: 'fr-par',
        accepted: false,
        content,
        sha256: createHash('sha256').update(content).digest('hex'),
        fetchedAt: new Date().toISOString(),
      }
    : undefined;
  const answer = (value) => {
    step++;
    if (invalidateAt === step) current = false;
    return cancelAt === step ? undefined : value;
  };
  const vscode = {
    window: {
      showQuickPick: async (items, config) => {
        calls.push({ type: 'pick', items, config });
        return answer(pick ? pick(items) : items[0]);
      },
      showInputBox: async (config) => {
        calls.push({ type: 'input', config });
        return answer(name ?? config.value);
      },
      showInformationMessage: async (message, config, action) => {
        calls.push({ type: 'modal', message, config, action });
        return answer(action);
      },
      showWarningMessage: async (message) => {
        calls.push({ type: 'warning', message });
      },
      showTextDocument: async (document) => {
        calls.push({ type: 'document', document });
        answer(document);
      },
    },
    workspace: {
      openTextDocument: async (config) => {
        calls.push({ type: 'open', config });
        return answer(config);
      },
    },
  };
  const original = Module._load;
  Module._load = function (id, ...args) {
    return id === 'vscode' ? vscode : original.call(this, id, ...args);
  };
  delete require.cache[require.resolve('../dist/deployService')];
  let service;
  try {
    service = require('../dist/deployService');
  } finally {
    Module._load = original;
  }
  return {
    ...service,
    calls,
    model: m,
    eula,
    prices,
    invalidate: () => {
      current = false;
    },
    review() {
      return service.reviewService(
        project,
        m,
        nodes,
        prices,
        eula,
        () => current,
      );
    },
  };
}
function response(body = {}) {
  return JSON.stringify({
    id: secret,
    name: 'vendor-model-name',
    project_id: project.id,
    region: 'fr-par',
    model_id: model.id,
    node_type_name: 'H100',
    status: 'creating',
    ...body,
  });
}
function fakeHTTP(t, reply = {}, check) {
  const original = https.request;
  let sends = 0;
  https.request = (options, callback) => {
    sends++;
    const req = new EventEmitter();
    req.destroy = () => {};
    req.end = (body) => {
      check?.(options, body);
      process.nextTick(() => {
        if (reply.requestError) return req.emit('error', new Error(secret));
        if (reply.hang) return;
        const res = new EventEmitter();
        res.statusCode = reply.status ?? 201;
        res.headers = {
          'content-type': reply.contentType ?? 'application/json',
        };
        res.destroy = () => {};
        callback(res);
        if (res.statusCode < 200 || res.statusCode >= 300) return;
        if (reply.aborted) return res.emit('aborted');
        res.emit('data', Buffer.from(reply.body ?? response()));
        res.emit('end');
      });
    };
    return req;
  };
  t.after(() => {
    https.request = original;
  });
  return () => sends;
}
test('compact review confirms exact public price, cost, project and IAM; SDK actually emits exact POST once', async (t) => {
  const s = setup();
  const receipt = await s.review();
  assert.deepEqual(
    s.calls.map((c) => c.type),
    ['pick', 'input', 'modal'],
  );
  assert.equal(s.calls[1].config.value, 'vendor-model-name');
  assert.match(
    s.calls[0].items[0].detail,
    /0.05666 EUR\/min\/node.*3.3996 EUR\/h/,
  );
  const modal = s.calls[2];
  assert.equal(modal.action, 'Déployer');
  assert.equal(modal.config.modal, true);
  for (const fragment of [
    'PUBLIC',
    'Prix effectif du compte inconnu',
    'Aucun plafond',
    'arrêt automatique',
    'IAM',
    project.id,
    'Quotas',
    'non vérifiés',
    'sans trafic',
  ])
    assert.ok(modal.config.detail.includes(fragment));
  assert.deepEqual(receipt.body, {
    accept_eula: false,
    endpoints: [{ disable_auth: false, public_network: {} }],
    max_size: 1,
    min_size: 1,
    model_id: model.id,
    name: 'vendor-model-name',
    node_type_name: 'H100',
    project_id: project.id,
    quantization: { bits: 8 },
    tags: [],
  });
  const sends = fakeHTTP(t, {}, (options, body) => {
    assert.equal(options.hostname, 'api.scaleway.com');
    assert.equal(options.path, '/inference/v1/regions/fr-par/deployments');
    assert.equal(options.method, 'POST');
    assert.equal(options.agent, false);
    assert.equal(options.headers['X-Auth-Token'], secret);
    assert.equal(options.headers['X-Session-Token'], undefined);
    assert.equal(body, JSON.stringify(receipt.body));
  });
  const result = await s.createService(receipt, secret, signal());
  assert.equal(result.kind, 'dedicated');
  assert.equal(result.status, 'creating');
  assert.equal(result.deploymentInfo.endpoints, undefined); // no generated [] default
  assert.equal(result.deploymentInfo.modelId, model.id);
  assert.equal(sends(), 1);
  await assert.rejects(s.createService(receipt, secret, signal()), {
    code: 'invalid_approval',
  });
  assert.equal(sends(), 1);
});
test('EULA is plaintext with separate explicit acceptance before deployment confirmation', async () => {
  const s = setup({ requireEula: true });
  const receipt = await s.review();
  assert.equal(receipt.body.accept_eula, true);
  assert.deepEqual(
    s.calls.map((c) => c.type),
    ['pick', 'input', 'open', 'document', 'modal', 'modal'],
  );
  assert.equal(s.calls[2].config.language, 'plaintext');
  assert.equal(s.calls[2].config.content, s.eula.content);
  assert.equal(s.calls[4].action, 'Accepter la licence');
  assert.equal(s.calls[5].action, 'Déployer');
});
test('all native cancellation and stale context paths produce no receipt', async () => {
  for (const requireEula of [false, true]) {
    for (let step = 1; step <= (requireEula ? 6 : 3); step++) {
      const cancelled = setup({ requireEula, cancelAt: step });
      // open/show documents have no cancellation semantics; staleness is tested there instead.
      if (step !== 3 || !requireEula)
        if (step !== 4 || !requireEula)
          assert.equal(await cancelled.review(), undefined);
      const stale = setup({ requireEula, invalidateAt: step });
      assert.equal(await stale.review(), undefined);
    }
  }
});
test('missing, changed, duplicate, stale or unpinned prices block creation', async () => {
  for (const prices of [
    [],
    [{ ...price(), amountEUR: '99' }],
    [{ ...price(), sku: 'other' }],
    [price(), price()],
    [{ ...price(), fetchedAt: '2020-01-01T00:00:00Z' }],
  ]) {
    const s = setup({ prices });
    assert.equal(await s.review(), undefined);
    assert.equal(
      s.calls.some((c) => c.type === 'input'),
      false,
    );
    assert.equal(s.calls.at(-1).type, 'warning');
  }
});
test('license digest and scope fail closed, incompatible models and unknown license blocked', async () => {
  for (const field of [
    'sha256',
    'modelId',
    'projectId',
    'organizationId',
    'region',
    'fetchedAt',
  ]) {
    const s = setup({ requireEula: true });
    s.eula[field] = 'invalid';
    await assert.rejects(s.review(), { code: 'invalid_eula_response' });
  }
  for (const mutate of [
    (m) => {
      m.dedicatedInfo.status = 'loading';
    },
    (m) => {
      m.dedicatedInfo.hasEula = undefined;
    },
    (m) => {
      m.dedicatedInfo.supportedNodes[0].allowed = false;
    },
  ]) {
    const s = setup();
    mutate(s.model);
    assert.equal(await s.review(), undefined);
  }
});
test('host receipt rejects clones, foreign approval, changed context, stale age and body mutations', async (t) => {
  const sends = fakeHTTP(t);
  const s = setup();
  const receipt = await s.review();
  for (const forged of [
    structuredClone(receipt),
    { ...receipt, body: { ...receipt.body, project_id: secret } },
    { body: receipt.body },
  ])
    await assert.rejects(s.createService(forged, secret, signal()), {
      code: 'invalid_approval',
    });
  const foreign = setup();
  await assert.rejects(foreign.createService(receipt, secret, signal()), {
    code: 'invalid_approval',
  });
  assert.equal(Object.isFrozen(receipt), true);
  assert.equal(Reflect.set(receipt.body, 'project_id', secret), false);
  assert.equal(
    Reflect.set(receipt.body.endpoints[0], 'disable_auth', true),
    false,
  );
  assert.equal(Reflect.set(receipt.body.quantization, 'bits', 99), false);
  const now = Date.now;
  Date.now = () => now() + 300001;
  try {
    await assert.rejects(s.createService(receipt, secret, signal()), {
      code: 'invalid_approval',
    });
  } finally {
    Date.now = now;
  }
  s.model.label = 'changed';
  await assert.rejects(s.createService(receipt, secret, signal()), {
    code: 'invalid_approval',
  });
  assert.equal(sends(), 0);
});
test('invalid token or preflight abort never sends and consumes receipt', async (t) => {
  const sends = fakeHTTP(t);
  for (const aborted of [false, true]) {
    const s = setup();
    const receipt = await s.review();
    const controller = new AbortController();
    if (aborted) controller.abort();
    await assert.rejects(
      s.createService(
        receipt,
        aborted ? secret : 'jwt.token.value',
        controller.signal,
      ),
      { code: aborted ? 'cancelled' : 'invalid_request' },
    );
    await assert.rejects(s.createService(receipt, secret, signal()), {
      code: 'invalid_approval',
    });
  }
  assert.equal(sends(), 0);
});
test('definitive provider rejection is sanitized and never retried', async (t) => {
  for (const [status, code] of [
    [401, 'access_denied'],
    [403, 'access_denied'],
    [400, 'creation_rejected'],
    [422, 'creation_rejected'],
    [429, 'rate_limited'],
    [302, 'creation_outcome_unknown'],
    [500, 'creation_outcome_unknown'],
  ]) {
    await t.test(String(status), async (sub) => {
      const s = setup();
      const receipt = await s.review();
      const sends = fakeHTTP(sub, { status, body: secret });
      await assert.rejects(
        s.createService(receipt, secret, signal()),
        (error) => {
          assert.equal(error.code, code);
          assert.equal(error.message, code);
          assert.ok(!JSON.stringify(error).includes(secret));
          return true;
        },
      );
      assert.equal(sends(), 1);
      await assert.rejects(s.createService(receipt, secret, signal()), {
        code: 'invalid_approval',
      });
    });
  }
});
test('successful status with invalid raw response is an unknown outcome, never normalized success', async (t) => {
  for (const reply of [
    { body: '{}' },
    { body: response({ region: undefined }) },
    { body: response({ project_id: secret }) },
    { body: response({ model_id: secret }) },
    {
      body: response({
        endpoints: [
          {
            id: project.id,
            url: 'https://endpoint.invalid',
            public_network: {},
          },
        ],
      }),
    },
    { body: '{bad' },
    { body: 'x'.repeat(2 * 1024 * 1024 + 1) },
    { body: response(), contentType: 'text/html' },
    { aborted: true },
    { requestError: true },
  ]) {
    await t.test('unknown result', async (sub) => {
      const s = setup();
      const receipt = await s.review();
      const sends = fakeHTTP(sub, reply);
      await assert.rejects(s.createService(receipt, secret, signal()), {
        code: 'creation_outcome_unknown',
      });
      assert.equal(sends(), 1);
    });
  }
});
test('abort after POST and fixed 10-second deadline are unknown outcomes', async (t) => {
  await t.test('abort', async (sub) => {
    const s = setup();
    const receipt = await s.review();
    const sends = fakeHTTP(sub, { hang: true });
    const c = new AbortController();
    const promise = s.createService(receipt, secret, c.signal);
    setImmediate(() => c.abort());
    await assert.rejects(promise, { code: 'creation_outcome_unknown' });
    assert.equal(sends(), 1);
  });
  await t.test('deadline', async (sub) => {
    const s = setup();
    const receipt = await s.review();
    const sends = fakeHTTP(sub, { hang: true });
    const original = global.setTimeout;
    global.setTimeout = (callback, ms, ...args) => {
      assert.equal(ms, 10000);
      return original(callback, 5, ...args);
    };
    try {
      await assert.rejects(s.createService(receipt, secret, signal()), {
        code: 'creation_outcome_unknown',
      });
    } finally {
      global.setTimeout = original;
    }
    assert.equal(sends(), 1);
  });
});
