const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const Module = require('node:module');
const { test } = require('node:test');

const window = {};
const originalLoad = Module._load;
let LlmAccessRegistry, iam, provider, wizard;
try {
  Module._load = function (name, ...args) {
    return name === 'vscode'
      ? { window }
      : originalLoad.call(this, name, ...args);
  };
  ({ LlmAccessRegistry } = require('../dist/llmAccessRegistry'));
  iam = require('../dist/llmAccessIam');
  provider = require('../dist/provider');
  wizard = require('../dist/llmAccessWizard');
} finally {
  Module._load = originalLoad;
}
const userId = '11111111-1111-4111-8111-111111111111';
const appId = '22222222-2222-4222-8222-222222222222';
const project = {
  id: '33333333-3333-4333-8333-333333333333',
  organizationId: '44444444-4444-4444-8444-444444444444',
  name: 'Fake project',
};
const login = {
  accessKey: 'SCWABCDEFGHIJKLMNOPQ',
  secretKey: '55555555-5555-4555-8555-555555555555',
};
const applicationKey = {
  accessKey: 'SCW12345678901234567',
  secretKey: '66666666-6666-4666-8666-666666666666',
};
const control = 'fake.header.signature';
const model = { id: 'fake-model', label: 'Fake model', kind: 'serverless' };
const slot = (id) => `scalewayAI.llmAccess.secret.v1.${id}`;
const namespace = (scope) =>
  'scalewayAI.llmAccess.v1.' +
  createHash('sha256')
    .update(
      JSON.stringify([
        scope.userId,
        scope.project.organizationId,
        scope.project.id,
      ]),
    )
    .digest('hex');
const idAt = (n) => n.toString(16).padStart(32, '0');
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function setup(t, options = {}) {
  const state = options.state ?? new Map();
  const secrets = options.secrets ?? new Map();
  const events = [];
  const listeners = options.listeners ?? new Set();
  const emit = (key) => {
    for (const listener of [...listeners]) listener({ key });
  };
  const controller = new AbortController();
  let live = true;
  const scope = {
    userId,
    project,
    signal: controller.signal,
    current: () => live && !controller.signal.aborted,
    controlCredential: () => control,
    reuseCredential: () => ({ ...login }),
  };
  const context = {
    globalState: {
      get: (key) => state.get(key),
      update: async (key, value) => {
        events.push(['update', key]);
        state.set(key, structuredClone(value));
      },
    },
    secrets: {
      onDidChange: (listener) => {
        listeners.add(listener);
        return { dispose: () => listeners.delete(listener) };
      },
      get: async (key) => secrets.get(key),
      store: async (key, value) => {
        events.push(['store', key]);
        secrets.set(key, value);
        emit(key);
      },
      delete: async (key) => {
        events.push(['delete', key]);
        secrets.delete(key);
        emit(key);
      },
    },
  };
  function patch(object, name, replacement) {
    const previous = object[name];
    object[name] = replacement;
    t.after(() => {
      object[name] = previous;
    });
  }
  const metadata = (accessKey = login.accessKey) => ({
    accessKey,
    bearer:
      accessKey === applicationKey.accessKey
        ? { type: 'application', id: appId }
        : { type: 'user', id: userId },
    expiresAt: Date.now() + 3600000,
    organizationId: project.organizationId,
    description: 'Fake access',
  });
  const checkSignal = (signal) => {
    assert.equal(signal, scope.signal);
    if (signal.aborted) throw new iam.IAMAccessError('cancelled');
  };
  patch(
    iam,
    'inspectAccessAPIKey',
    async (org, accessKey, secretKey, signal) => {
      events.push(['inspect', org, accessKey, secretKey]);
      assert.equal(org, project.organizationId);
      checkSignal(signal);
      return metadata(accessKey);
    },
  );
  patch(iam, 'listAccessApplications', async (org, credential, signal) => {
    events.push(['applications', org, credential]);
    assert.equal(org, project.organizationId);
    assert.equal(credential, control);
    checkSignal(signal);
    return [{ id: appId, name: 'Fake app' }];
  });
  patch(
    iam,
    'createAccessAPIKey',
    async (org, bearer, credential, description, lifetimeMs, signal) => {
      events.push(['create', org, bearer, credential, description, lifetimeMs]);
      assert.equal(org, project.organizationId);
      assert.equal(credential, control);
      checkSignal(signal);
      assert.ok(
        secrets.has(`${namespace(scope)}.pending`),
        'marker must precede POST',
      );
      return bearer.type === 'application'
        ? { ...applicationKey }
        : { ...login };
    },
  );
  patch(provider, 'listServerlessAvailability', async (secret, signal) => {
    events.push(['models', secret]);
    checkSignal(signal);
    return [{ id: model.id, createdAt: '2026-10-01T00:00:00Z' }];
  });
  patch(wizard, 'chooseAccessPlan', async (input) => {
    events.push(['wizard', input]);
    assert.equal(input.userId, userId);
    assert.equal(input.modelId, options.keyOnly ? undefined : model.id);
    assert.equal(input.projectName, project.name);
    assert.equal(input.current(), true);
    return options.plan ?? { type: 'reuse' };
  });
  patch(window, 'showQuickPick', async (items) => {
    events.push(['pick']);
    return options.selectLocal ? items[0] : items.at(-1);
  });
  patch(iam, 'listAccessAPIKeys', async (org, credential, signal) => {
    events.push(['inventory', org, credential]);
    assert.equal(org, project.organizationId);
    assert.equal(credential, control);
    checkSignal(signal);
    return (
      options.inventory ?? [metadata(), metadata(applicationKey.accessKey)]
    );
  });
  patch(window, 'showErrorMessage', async (message) => {
    events.push(['error', message]);
  });
  patch(window, 'showWarningMessage', async (...args) => {
    events.push(['warning', ...args]);
  });
  const registry = new LlmAccessRegistry(context);
  t.after(() => registry.dispose());
  const seed = (n = 1, overrides = {}) => {
    const id = idAt(n);
    const record = {
      version: 1,
      id,
      ownerId: userId,
      projectId: project.id,
      organizationId: project.organizationId,
      modelId: model.id,
      ...login,
      metadata: metadata(),
      ...overrides,
    };
    secrets.set(slot(id), JSON.stringify(record));
    state.set(namespace(scope), [...(state.get(namespace(scope)) ?? []), id]);
    return record;
  };
  return {
    scope,
    context,
    registry,
    state,
    secrets,
    events,
    listeners,
    emit,
    seed,
    metadata,
    stale: () => {
      live = false;
    },
    abort: () => controller.abort(),
    count: (kind) => events.filter((e) => e[0] === kind).length,
  };
}
function assertPublic(row) {
  const wire = JSON.stringify(row);
  for (const value of [
    login.accessKey,
    login.secretKey,
    applicationKey.accessKey,
    applicationKey.secretKey,
    control,
    userId,
    appId,
  ])
    assert.ok(!wire.includes(value));
  const scan = (value) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.ok(
        !/^(secretKey|accessKey|bearerId|bearerID|credentials|token)$/i.test(
          key,
        ),
        key,
      );
      scan(child);
    }
  };
  scan(row);
}
const createPlan = (bearer = { type: 'application', id: appId }) => ({
  type: 'create',
  bearer,
  description: 'Fake app key',
  lifetimeMs: 3600000,
});

test('refresh ignores legacy favorites and missing secrets without IAM calls', async (t) => {
  const h = setup(t);
  h.state.set('scalewayAI.serverless.favorites', [model.id]);
  h.state.set(namespace(h.scope), [idAt(1)]);
  assert.deepEqual(await h.registry.refresh(h.scope, [model]), []);
  assert.equal(h.count('inspect'), 0);
  assert.equal(h.count('models'), 0);
  assert.equal(h.count('update'), 0);
});

test('refresh verifies stored keys with IAM and availability, sanitizes and clones rows', async (t) => {
  const h = setup(t);
  const record = h.seed();
  const rows = await h.registry.refresh(h.scope, [model]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].llmAccess.id, record.id);
  assert.equal(rows[0].llmAccess.bearerType, 'user');
  assert.equal(rows[0].serverlessCreatedAt, '2026-10-01T00:00:00Z');
  assertPublic(rows[0]);
  assert.deepEqual(
    h.events.map((e) => e[0]),
    ['inspect', 'models'],
  );
  rows[0].llmAccess.id = 'tampered';
  assert.equal(h.registry.rows(h.scope)[0].llmAccess.id, record.id);
  for (const foreign of [
    { userId: appId },
    { project: { ...project, id: appId } },
    { project: { ...project, organizationId: appId } },
  ])
    assert.deepEqual(h.registry.rows({ ...h.scope, ...foreign }), []);
});

for (const type of ['reuse', 'import', 'create-user', 'create-application']) {
  test(`configure ${type} publishes only after IAM and model verification`, async (t) => {
    const plan =
      type === 'reuse'
        ? { type }
        : type === 'import'
          ? { type, ...applicationKey }
          : createPlan(
              type === 'create-user'
                ? { type: 'user', id: userId }
                : { type: 'application', id: appId },
            );
    const h = setup(t, { plan });
    const entered = deferred(),
      release = deferred();
    provider.listServerlessAvailability = async (secret, signal) => {
      h.events.push(['models', secret]);
      assert.equal(signal, h.scope.signal);
      entered.resolve();
      await release.promise;
      return [{ id: model.id }];
    };
    const pending = h.registry.configure(model, h.scope);
    await entered.promise;
    assert.deepEqual(h.registry.rows(h.scope), []);
    assert.equal(h.state.size, 0);
    release.resolve();
    const row = await pending;
    assert.ok(row);
    assertPublic(row);
    assert.equal(h.count('inspect'), 1);
    assert.equal(h.count('models'), 1);
    assert.equal(h.count('create'), type.startsWith('create') ? 1 : 0);
    assert.equal(
      h.count('applications'),
      type === 'create-application' ? 1 : 0,
    );
    assert.ok(
      h.events.findIndex((e) => e[0] === 'inspect') <
        h.events.findIndex((e) => e[0] === 'models'),
    );
    assert.equal(h.secrets.has(`${namespace(h.scope)}.pending`), false);
    const handle = await h.registry.credential(h.scope, row);
    const expected = ['import', 'create-application'].includes(type)
      ? applicationKey
      : login;
    assert.equal(handle.current(), true);
    assert.equal(handle.secretKey(), expected.secretKey);
    assert.equal(
      h.events.filter((e) => e[0] === 'models').at(-1)[1],
      expected.secretKey,
    );
    if (expected === applicationKey)
      assert.notEqual(handle.secretKey(), h.scope.reuseCredential().secretKey);
    assert.deepEqual(h.scope.reuseCredential(), login);
  });
}

test('wizard application discovery uses only login control credential', async (t) => {
  const h = setup(t);
  wizard.chooseAccessPlan = async (input) => {
    assert.deepEqual(await input.applications(), [
      { id: appId, name: 'Fake app' },
    ]);
    return { type: 'import', ...applicationKey };
  };
  assert.ok(await h.registry.configure(model, h.scope));
  assert.equal(h.count('applications'), 1);
  assert.equal(h.count('create'), 0);
});

for (const failure of [
  'expired',
  'revoked',
  'missing-model',
  'changed-bearer',
]) {
  test(`refresh hides ${failure} keys and invalidates earlier credential handles`, async (t) => {
    const h = setup(t);
    h.seed();
    const [row] = await h.registry.refresh(h.scope, [model]);
    const handle = await h.registry.credential(h.scope, row);
    assert.equal(handle.current(), true);
    if (failure === 'missing-model')
      provider.listServerlessAvailability = async () => [];
    else
      iam.inspectAccessAPIKey = async () => {
        if (failure === 'revoked')
          throw new iam.IAMAccessError('access_denied');
        return {
          ...h.metadata(),
          ...(failure === 'expired'
            ? { expiresAt: Date.now() - 1 }
            : { bearer: { type: 'application', id: appId } }),
        };
      };
    assert.deepEqual(await h.registry.refresh(h.scope, [model]), []);
    assert.equal(handle.current(), false);
    assert.throws(() => handle.secretKey(), /expired/);
    await assert.rejects(h.registry.credential(h.scope, row));
  });
}

test('refresh invalidates handles before pending network work, even if proof succeeds again', async (t) => {
  const h = setup(t);
  h.seed();
  const [row] = await h.registry.refresh(h.scope, [model]);
  const handle = await h.registry.credential(h.scope, row);
  const entered = deferred(),
    release = deferred();
  iam.inspectAccessAPIKey = async () => {
    entered.resolve();
    await release.promise;
    return h.metadata();
  };
  const pending = h.registry.refresh(h.scope, [model]);
  await entered.promise;
  assert.equal(handle.current(), false);
  assert.throws(() => handle.secretKey(), /expired/);
  assert.deepEqual(h.registry.rows(h.scope), []);
  release.resolve();
  assert.equal((await pending).length, 1);
  assert.equal(handle.current(), false);
});

for (const mode of ['stale', 'abort']) {
  test(`${mode} during IAM prevents configure persistence and availability`, async (t) => {
    const h = setup(t);
    iam.inspectAccessAPIKey = async () => {
      h[mode]();
      return h.metadata();
    };
    assert.equal(await h.registry.configure(model, h.scope), undefined);
    assert.deepEqual(h.registry.rows(h.scope), []);
    assert.equal(h.state.size, 0);
    assert.equal(h.secrets.size, 0);
    assert.equal(h.count('models'), 0);
    assert.equal(h.count('error'), 0);
  });
}

test('initial stale scope, cancellation, non-serverless and double click make no extra dispatch', async (t) => {
  const h = setup(t);
  assert.equal(
    await h.registry.configure({ ...model, kind: 'dedicated' }, h.scope),
    undefined,
  );
  const entered = deferred(),
    release = deferred();
  wizard.chooseAccessPlan = async () => {
    entered.resolve();
    await release.promise;
    return undefined;
  };
  const pending = h.registry.configure(model, h.scope);
  await entered.promise;
  assert.equal(await h.registry.configure(model, h.scope), undefined);
  release.resolve();
  assert.equal(await pending, undefined);
  h.stale();
  assert.equal(await h.registry.configure(model, h.scope), undefined);
  assert.deepEqual(await h.registry.refresh(h.scope, [model]), []);
  assert.equal(h.count('inspect'), 0);
  assert.equal(h.state.size, 0);
});

test('unknown POST outcome retains pre-dispatch marker and never retries across registry restart', async (t) => {
  const h = setup(t, { plan: createPlan() });
  iam.createAccessAPIKey = async () => {
    h.events.push(['create']);
    assert.equal(
      JSON.parse(h.secrets.get(`${namespace(h.scope)}.pending`)).pending,
      true,
    );
    throw new iam.IAMAccessError('timeout');
  };
  assert.equal(await h.registry.configure(model, h.scope), undefined);
  const pending = h.secrets.get(`${namespace(h.scope)}.pending`);
  assert.ok(pending);
  assert.equal(JSON.parse(pending).credentials, undefined);
  assert.equal(h.state.size, 0);
  const restarted = new LlmAccessRegistry(h.context);
  assert.equal(await restarted.configure(model, h.scope), undefined);
  assert.equal(h.count('create'), 1);
  assert.equal(h.count('wizard'), 1);
  assert.equal(h.count('warning'), 1);
  assert.equal(h.secrets.get(`${namespace(h.scope)}.pending`), pending);
  window.showWarningMessage = async () =>
    'Tentative vérifiée et clés révoquées';
  assert.equal(await restarted.configure(model, h.scope), undefined);
  assert.equal(h.secrets.has(`${namespace(h.scope)}.pending`), false);
  assert.equal(h.count('create'), 1, 'acknowledgment itself must not dispatch');
});

for (const failure of [
  'metadata-rejected',
  'bearer-mismatch',
  'missing-model',
  'stale-after-create',
]) {
  test(`created secret remains recoverable after ${failure}, without active row or retry`, async (t) => {
    const h = setup(t, { plan: createPlan() });
    if (failure === 'metadata-rejected')
      iam.inspectAccessAPIKey = async () => {
        throw new iam.IAMAccessError('invalid_response');
      };
    if (failure === 'bearer-mismatch')
      iam.inspectAccessAPIKey = async () => h.metadata(login.accessKey);
    if (failure === 'missing-model')
      provider.listServerlessAvailability = async () => [];
    if (failure === 'stale-after-create')
      iam.createAccessAPIKey = async () => {
        h.events.push(['create']);
        h.stale();
        return { ...applicationKey };
      };
    assert.equal(await h.registry.configure(model, h.scope), undefined);
    const marker = JSON.parse(h.secrets.get(`${namespace(h.scope)}.pending`));
    assert.deepEqual(marker.credentials, applicationKey);
    assert.deepEqual(h.registry.rows(h.scope), []);
    assert.equal(h.state.size, 0);
    assert.equal(h.count('create'), 1);
    if (failure !== 'stale-after-create') {
      assert.equal(
        await new LlmAccessRegistry(h.context).configure(model, h.scope),
        undefined,
      );
      assert.equal(h.count('create'), 1);
    }
  });
}

test('create rejects foreign user or unknown application before dispatch or marker', async (t) => {
  for (const bearer of [
    { type: 'user', id: appId },
    { type: 'application', id: userId },
  ]) {
    await t.test(bearer.type, async (st) => {
      const h = setup(st, { plan: createPlan(bearer) });
      assert.equal(await h.registry.configure(model, h.scope), undefined);
      assert.equal(h.count('create'), 0);
      assert.equal(h.secrets.size, 0);
      assert.equal(h.state.size, 0);
    });
  }
});

test('refresh bounds and validates index/records, deduplicates IDs and rejects foreign secrets', async (t) => {
  const h = setup(t);
  const good = h.seed();
  const original = h.secrets.get(slot(good.id));
  for (const raw of [
    Array.from({ length: 33 }, (_, n) => idAt(n + 1)),
    [good.id, 'invalid'],
    'not-an-array',
  ]) {
    h.state.set(namespace(h.scope), raw);
    assert.deepEqual(await h.registry.refresh(h.scope, [model]), []);
  }
  assert.equal(h.count('inspect'), 0);
  h.state.set(namespace(h.scope), [good.id, good.id]);
  assert.equal((await h.registry.refresh(h.scope, [model])).length, 1);
  assert.equal(h.count('inspect'), 1);
  for (const raw of [
    '{',
    ' '.repeat(8193),
    ...[
      { version: 2 },
      { id: idAt(99) },
      { ownerId: appId },
      { projectId: appId },
      { organizationId: appId },
      { accessKey: 'bad' },
      { secretKey: control },
      { modelId: '' },
    ].map((change) => JSON.stringify({ ...good, ...change })),
  ]) {
    h.secrets.set(slot(good.id), raw);
    assert.deepEqual(await h.registry.refresh(h.scope, [model]), []);
  }
  assert.equal(h.count('inspect'), 1);
  h.secrets.set(slot(good.id), original);
});

test('32 distinct model bindings reject a 33rd without overwriting any stored secret/index', async (t) => {
  const h = setup(t);
  for (let n = 1; n <= 32; n++)
    h.seed(n, {
      modelId: `other-${n}`,
      secretKey: `77777777-7777-4777-8777-${String(n).padStart(12, '0')}`,
    });
  const stateBefore = structuredClone([...h.state]);
  const secretsBefore = [...h.secrets];
  assert.equal(await h.registry.configure(model, h.scope), undefined);
  assert.deepEqual([...h.state], stateBefore);
  assert.deepEqual([...h.secrets], secretsBefore);
  assert.equal(h.count('update'), 0);
  assert.equal(h.count('store'), 0);
  assert.equal(h.count('error'), 1);
});

test('adding another key preserves validated legacy slots after publication', async (t) => {
  const h = setup(t, { plan: { type: 'import', ...applicationKey } });
  const old = h.seed();
  const other = h.seed(2, { modelId: 'other-model' });
  await h.registry.refresh(h.scope, [model]);
  const oldRow = h.registry.rows(h.scope).find((row) => row.id === model.id);
  const handle = await h.registry.credential(h.scope, oldRow);
  const row = await h.registry.configure(model, h.scope);
  assert.ok(row);
  assert.notEqual(row.llmAccess.id, old.id);
  assert.deepEqual(h.state.get(namespace(h.scope)), [
    old.id,
    other.id,
    row.llmAccess.id,
  ]);
  assert.equal(h.secrets.has(slot(old.id)), true);
  assert.equal(handle.current(), false);
  assert.throws(() => handle.secretKey(), /expired/);
  assert.equal(
    h.registry.rows(h.scope).filter((r) => r.id === model.id).length,
    1,
  );
  assert.equal(
    JSON.parse(h.secrets.get(slot(row.llmAccess.id))).secretKey,
    applicationKey.secretKey,
  );
});

test('credential rejects forged row, missing secret, wrong model and stale scope', async (t) => {
  const h = setup(t);
  const row = await h.registry.configure(model, h.scope);
  for (const forged of [
    model,
    { ...row, llmAccess: { ...row.llmAccess, id: idAt(999) } },
  ]) {
    await assert.rejects(
      h.registry.credential(h.scope, forged),
      /invalid_request/,
    );
  }
  await assert.rejects(
    h.registry.credential(h.scope, { ...row, id: 'another-model' }),
    /access_denied/,
  );
  await h.registry.refresh(h.scope, [model]);
  const handle = await h.registry.credential(h.scope, row);
  h.stale();
  assert.equal(handle.current(), false);
  assert.throws(() => handle.secretKey(), /expired/);
  await assert.rejects(h.registry.credential(h.scope, row), /invalid_request/);
});

for (const type of ['reuse', 'import']) {
  for (const failure of ['iam-rejected', 'missing-model']) {
    test(`${type} ${failure} never persists a binding or returns an active row`, async (t) => {
      const h = setup(t, {
        plan: type === 'reuse' ? { type } : { type, ...applicationKey },
      });
      if (failure === 'iam-rejected')
        iam.inspectAccessAPIKey = async () => {
          throw new iam.IAMAccessError('access_denied');
        };
      else provider.listServerlessAvailability = async () => [];
      assert.equal(await h.registry.configure(model, h.scope), undefined);
      assert.deepEqual(h.registry.rows(h.scope), []);
      assert.equal(h.state.size, 0);
      assert.equal(h.secrets.size, 0);
      assert.equal(h.count('create'), 0);
    });
  }
}

test('credential requires the secret still to exist and removes proof on fresh IAM denial', async (t) => {
  const h = setup(t);
  const row = await h.registry.configure(model, h.scope);
  const raw = h.secrets.get(slot(row.llmAccess.id));
  h.secrets.delete(slot(row.llmAccess.id));
  await assert.rejects(h.registry.credential(h.scope, row), /invalid_request/);
  h.secrets.set(slot(row.llmAccess.id), raw);
  const handle = await h.registry.credential(h.scope, row);
  iam.inspectAccessAPIKey = async () => {
    throw new iam.IAMAccessError('access_denied');
  };
  await assert.rejects(h.registry.credential(h.scope, row), /access_denied/);
  assert.deepEqual(h.registry.rows(h.scope), []);
  assert.equal(handle.current(), false);
  assert.throws(() => handle.secretKey(), /expired/);
});

test('30 second expiry margin hides rows and invalidates credential without exposing its secret', async (t) => {
  const h = setup(t);
  const originalNow = Date.now;
  const now = originalNow();
  Date.now = () => now;
  t.after(() => {
    Date.now = originalNow;
  });
  const row = await h.registry.configure(model, h.scope);
  const handle = await h.registry.credential(h.scope, row);
  Date.now = () => now + 3600000 - 30000;
  assert.deepEqual(h.registry.rows(h.scope), []);
  assert.equal(handle.current(), false);
  assert.throws(() => handle.secretKey(), /expired/);
});

test('known returned secret resumes configuration without deleting it or generating a second key', async (t) => {
  const h = setup(t, { plan: createPlan() });
  const inspect = iam.inspectAccessAPIKey;
  iam.inspectAccessAPIKey = async () => {
    throw new iam.IAMAccessError('access_denied');
  };
  assert.equal(await h.registry.configure(model, h.scope), undefined);
  const pendingSlot = `${namespace(h.scope)}.pending`;
  assert.equal(
    JSON.parse(h.secrets.get(pendingSlot)).credentials.secretKey,
    applicationKey.secretKey,
  );
  iam.inspectAccessAPIKey = inspect;
  window.showWarningMessage = async () => 'Reprendre la configuration';
  const resumed = await h.registry.configure(model, h.scope);
  assert.ok(resumed);
  assert.equal(h.count('create'), 1);
  assert.equal(h.count('wizard'), 1);
  assert.equal(h.secrets.has(pendingSlot), false);
  assert.equal(
    (await h.registry.credential(h.scope, resumed)).secretKey(),
    applicationKey.secretKey,
  );
});
test('in-flight credential validation cannot resurrect a binding replaced during the read', async (t) => {
  const h = setup(t);
  const row = await h.registry.configure(model, h.scope);
  const entered = deferred(),
    release = deferred();
  const inspect = iam.inspectAccessAPIKey;
  iam.inspectAccessAPIKey = async (...args) => {
    entered.resolve();
    await release.promise;
    return inspect(...args);
  };
  const pending = h.registry.credential(h.scope, row);
  await entered.promise;
  iam.inspectAccessAPIKey = inspect;
  wizard.chooseAccessPlan = async () => ({ type: 'import', ...applicationKey });
  const replacement = await h.registry.configure(model, h.scope);
  assert.ok(replacement);
  release.resolve();
  await assert.rejects(pending, /access_denied/);
  assert.deepEqual(
    h.registry.rows(h.scope).map((r) => r.llmAccess.id),
    [replacement.llmAccess.id],
  );
});

test('Given one unchanged binding, When consumers renew sequentially and concurrently, Then every handle remains usable', async (t) => {
  const h = setup(t);
  const row = await h.registry.configure(model, h.scope);
  const first = await h.registry.credential(h.scope, row);
  const second = await h.registry.credential(h.scope, row);
  assert.equal(first.current(), true);
  assert.equal(second.current(), true);
  const gates = [deferred(), deferred()];
  const entered = deferred();
  let calls = 0;
  iam.inspectAccessAPIKey = async () => {
    const index = calls++;
    if (calls === 2) entered.resolve();
    await gates[index].promise;
    return h.metadata();
  };
  const a = h.registry.credential(h.scope, row);
  const b = h.registry.credential(h.scope, row);
  await entered.promise;
  gates[1].resolve();
  const fourth = await b;
  gates[0].resolve();
  const third = await a;
  for (const handle of [first, second, third, fourth]) {
    assert.equal(handle.current(), true);
    assert.equal(handle.secretKey(), login.secretKey);
  }
});

for (const failureFirst of [true, false]) {
  test(`Given overlapping validations, When one fails (${failureFirst ? 'first' : 'last'}), Then success never resurrects a failed binding`, async (t) => {
    const h = setup(t);
    const row = await h.registry.configure(model, h.scope);
    const handle = await h.registry.credential(h.scope, row);
    const gates = [deferred(), deferred()];
    const entered = deferred();
    let calls = 0;
    iam.inspectAccessAPIKey = async () => {
      const index = calls++;
      if (calls === 2) entered.resolve();
      await gates[index].promise;
      if (index === 0) throw new iam.IAMAccessError('access_denied');
      return h.metadata();
    };
    const failure = h.registry.credential(h.scope, row);
    const rejection = assert.rejects(failure, /access_denied/);
    const success = h.registry.credential(h.scope, row);
    const settled = success.then(
      (v) => v,
      (e) => e,
    );
    await entered.promise;
    if (failureFirst) {
      gates[0].resolve();
      await rejection;
      gates[1].resolve();
      assert.ok((await settled) instanceof iam.IAMAccessError);
    } else {
      gates[1].resolve();
      const renewed = await settled;
      assert.equal(renewed.current(), true);
      gates[0].resolve();
      await rejection;
      assert.equal(renewed.current(), false);
    }
    assert.deepEqual(h.registry.rows(h.scope), []);
    assert.equal(handle.current(), false);
  });
}

for (const mutation of ['delete', 'rotate']) {
  test(`Given two storage-sharing instances, When a slot ${mutation}s, Then both handles reject and pending validation cannot restore it`, async (t) => {
    const h = setup(t);
    const row = await h.registry.configure(model, h.scope);
    const peer = new LlmAccessRegistry(h.context);
    t.after(() => peer.dispose());
    const [peerRow] = await peer.refresh(h.scope, [model]);
    const handles = [
      await h.registry.credential(h.scope, row),
      await peer.credential(h.scope, peerRow),
    ];
    // Pending-marker and unrelated-secret events must not affect either binding.
    await h.context.secrets.store(`${namespace(h.scope)}.pending`, '{}');
    h.emit(slot(idAt(999)));
    assert.ok(handles.every((v) => v.current()));
    const entered = deferred(),
      release = deferred();
    iam.inspectAccessAPIKey = async () => {
      entered.resolve();
      await release.promise;
      return h.metadata();
    };
    const pending = peer.credential(h.scope, peerRow);
    const rejected = assert.rejects(pending, /access_denied/);
    await entered.promise;
    if (mutation === 'delete')
      await h.context.secrets.delete(slot(row.llmAccess.id));
    else {
      const stored = JSON.parse(h.secrets.get(slot(row.llmAccess.id)));
      await h.context.secrets.store(
        slot(row.llmAccess.id),
        JSON.stringify({ ...stored, ...applicationKey }),
      );
    }
    for (const handle of handles) {
      assert.equal(handle.current(), false);
      assert.throws(() => handle.secretKey(), /expired/);
    }
    release.resolve();
    await rejected;
    assert.deepEqual(peer.rows(h.scope), []);
    assert.deepEqual(h.registry.rows(h.scope), []);
  });
}

for (const operation of ['refresh', 'configure']) {
  for (const invalidation of ['clear', 'dispose']) {
    test(`Given ${operation} awaiting IAM, When ${invalidation} runs, Then no late proof is published`, async (t) => {
      const h = setup(t);
      h.seed();
      const entered = deferred(),
        release = deferred();
      iam.inspectAccessAPIKey = async () => {
        entered.resolve();
        await release.promise;
        return h.metadata();
      };
      const pending =
        operation === 'refresh'
          ? h.registry.refresh(h.scope, [model])
          : h.registry.configure(model, h.scope);
      await entered.promise;
      h.registry[invalidation]();
      release.resolve();
      assert.deepEqual(await pending, operation === 'refresh' ? [] : undefined);
      assert.deepEqual(h.registry.rows(h.scope), []);
      assert.equal(h.count('models'), 0);
    });
  }
}

test('Given disposed registry, When dispose repeats and operations are requested, Then listener is released and no authority survives', async (t) => {
  const h = setup(t);
  const row = await h.registry.configure(model, h.scope);
  const handle = await h.registry.credential(h.scope, row);
  assert.equal(h.listeners.size, 1);
  h.registry.dispose();
  h.registry.dispose();
  assert.equal(h.listeners.size, 0);
  assert.equal(handle.current(), false);
  assert.throws(() => handle.secretKey(), /expired/);
  const count = h.count('inspect');
  assert.deepEqual(await h.registry.refresh(h.scope, [model]), []);
  assert.equal(await h.registry.configure(model, h.scope), undefined);
  await assert.rejects(h.registry.credential(h.scope, row));
  assert.equal(h.count('inspect'), count);
});

test('Given 32 models using one credential, When refreshed twice, Then one IAM/catalogue pair per refresh proves only listed models', async (t) => {
  const h = setup(t);
  const catalogue = Array.from({ length: 32 }, (_, i) => ({
    ...model,
    id: `model-${i}`,
  }));
  catalogue.forEach((m, i) => {
    h.seed(i + 1, { modelId: m.id });
  });
  provider.listServerlessAvailability = async () => {
    h.events.push(['models']);
    return catalogue.slice(0, 31);
  };
  assert.equal((await h.registry.refresh(h.scope, catalogue)).length, 31);
  assert.equal(h.count('inspect'), 1);
  assert.equal(h.count('models'), 1);
  assert.equal((await h.registry.refresh(h.scope, catalogue)).length, 31);
  assert.equal(h.count('inspect'), 2, 'no persistent authority cache');
  assert.equal(h.count('models'), 2);
  const row = h.registry.rows(h.scope)[0];
  await h.registry.credential(h.scope, row);
  assert.equal(
    h.count('inspect'),
    3,
    'credential renewal performs fresh reads',
  );
  assert.equal(h.count('models'), 3);
});

test('Given shared-key failed proof and another key, When refreshed, Then failure deduplicates without promoting or poisoning the other credential', async (t) => {
  const h = setup(t);
  h.seed(1);
  h.seed(2, { modelId: 'other' });
  const valid = h.seed(3, {
    ...applicationKey,
    metadata: h.metadata(applicationKey.accessKey),
  });
  iam.inspectAccessAPIKey = async (_org, accessKey) => {
    h.events.push(['inspect']);
    if (accessKey === login.accessKey)
      throw new iam.IAMAccessError('access_denied');
    return h.metadata(accessKey);
  };
  const rows = await h.registry.refresh(h.scope, [model]);
  assert.deepEqual(
    rows.map((row) => row.llmAccess.id),
    [valid.id],
  );
  assert.equal(h.count('inspect'), 2);
  assert.equal(h.count('models'), 1);
});

test('Given two valid slots, When only one changes during renewal, Then the other consumer stays current', async (t) => {
  const h = setup(t);
  const first = h.seed(1),
    second = h.seed(2, { modelId: 'other' });
  provider.listServerlessAvailability = async () => [
    model,
    { ...model, id: 'other' },
  ];
  const rows = await h.registry.refresh(h.scope, [model]);
  const firstRow = rows.find((v) => v.llmAccess.id === first.id);
  const secondRow = rows.find((v) => v.llmAccess.id === second.id);
  const firstHandle = await h.registry.credential(h.scope, firstRow);
  const entered = deferred(),
    release = deferred();
  iam.inspectAccessAPIKey = async () => {
    entered.resolve();
    await release.promise;
    return h.metadata();
  };
  const pending = h.registry.credential(h.scope, secondRow);
  await entered.promise;
  await h.context.secrets.delete(slot(first.id));
  assert.equal(firstHandle.current(), false);
  release.resolve();
  assert.equal((await pending).current(), true);
});

test('Given shared metadata with one wrong stored bearer, When refreshed, Then each binding is checked and only the matching one appears', async (t) => {
  const h = setup(t);
  h.seed(1, {
    metadata: { ...h.metadata(), bearer: { type: 'application', id: appId } },
  });
  const good = h.seed(2);
  assert.deepEqual(
    (await h.registry.refresh(h.scope, [model])).map((v) => v.llmAccess.id),
    [good.id],
  );
  assert.equal(h.count('inspect'), 1);
  assert.equal(h.count('models'), 1);
});

test('Given a delayed own-store event, When delivered after configure, Then it fails closed without resurrecting a handle', async (t) => {
  const h = setup(t);
  const row = await h.registry.configure(model, h.scope);
  const handle = await h.registry.credential(h.scope, row);
  h.emit(slot(row.llmAccess.id));
  assert.equal(handle.current(), false);
  await assert.rejects(h.registry.credential(h.scope, row));
  assert.equal((await h.registry.refresh(h.scope, [model])).length, 1);
  assert.equal(handle.current(), false);
});

test('Given IAM valid before catalogue wait, When expiry crosses the safety margin during that wait, Then no row or handle is published', async (t) => {
  const h = setup(t);
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  t.after(() => {
    Date.now = originalNow;
  });
  const expiresAt = now + 60000;
  iam.inspectAccessAPIKey = async () => ({ ...h.metadata(), expiresAt });
  const entered = deferred(),
    release = deferred();
  provider.listServerlessAvailability = async () => {
    entered.resolve();
    await release.promise;
    return [model];
  };
  const pending = h.registry.configure(model, h.scope);
  await entered.promise;
  now += 30000;
  release.resolve();
  assert.equal(await pending, undefined);
  assert.deepEqual(h.registry.rows(h.scope), []);
  assert.equal(h.count('store'), 0);
});

test('Given same secret but different access keys, When refreshed, Then the proof cache never conflates key identities', async (t) => {
  const h = setup(t);
  h.seed(1);
  h.seed(2, {
    accessKey: applicationKey.accessKey,
    metadata: h.metadata(applicationKey.accessKey),
  });
  assert.equal((await h.registry.refresh(h.scope, [model])).length, 2);
  assert.equal(h.count('inspect'), 2);
  assert.equal(h.count('models'), 2);
});

test('Given matching credential in different project scopes, When a single registry changes scopes, Then it performs fresh reads and invalidates prior handles', async (t) => {
  const h = setup(t);
  const first = h.seed(1);
  const [row] = await h.registry.refresh(h.scope, [model]);
  const handle = await h.registry.credential(h.scope, row);
  const otherScope = { ...h.scope, project: { ...project, id: appId } };
  const otherRecord = { ...first, id: idAt(2), projectId: appId };
  h.secrets.set(slot(otherRecord.id), JSON.stringify(otherRecord));
  h.state.set(namespace(otherScope), [otherRecord.id]);
  const before = h.count('inspect');
  assert.equal((await h.registry.refresh(otherScope, [model])).length, 1);
  assert.equal(h.count('inspect'), before + 1);
  assert.equal(handle.current(), false);
  assert.deepEqual(h.registry.rows(h.scope), []);
});

test('Given shared credential with rejected catalogue, When refreshed twice, Then failures are deduplicated only within each refresh', async (t) => {
  const h = setup(t);
  h.seed(1);
  h.seed(2, { modelId: 'other' });
  provider.listServerlessAvailability = async () => {
    h.events.push(['models']);
    throw new iam.IAMAccessError('access_denied');
  };
  for (let pass = 1; pass <= 2; pass++) {
    assert.deepEqual(await h.registry.refresh(h.scope, [model]), []);
    assert.equal(h.count('inspect'), pass);
    assert.equal(h.count('models'), pass);
  }
});

test('Given separate window indexes, When same model is replaced, Then shared SecretStorage revision invalidates peer rows and handles', async (t) => {
  const h = setup(t);
  const row = await h.registry.configure(model, h.scope);
  const peerState = new Map(
    [...h.state].map(([k, v]) => [k, structuredClone(v)]),
  );
  const peerContext = {
    ...h.context,
    globalState: {
      get: (k) => peerState.get(k),
      update: async (k, v) => peerState.set(k, v),
    },
  };
  const peer = new LlmAccessRegistry(peerContext);
  t.after(() => peer.dispose());
  const [peerRow] = await peer.refresh(h.scope, [model]);
  const handle = await peer.credential(h.scope, peerRow);
  assert.equal(handle.current(), true);
  wizard.chooseAccessPlan = async () => ({ type: 'import', ...applicationKey });
  const replacement = await h.registry.configure(model, h.scope);
  assert.notEqual(replacement.llmAccess.id, row.llmAccess.id);
  assert.ok(
    peerState.get(namespace(h.scope)).includes(row.llmAccess.id),
    'peer Memento deliberately stale',
  );
  assert.deepEqual(peer.rows(h.scope), []);
  assert.equal(handle.current(), false);
  assert.throws(() => handle.secretKey(), /expired/);
  assert.equal(
    (await peer.refresh(h.scope, [model])).length,
    1,
    'old key remains usable after fresh IAM/catalogue proof',
  );
});

test('Given expiry during persistence, When configure settles, Then it cannot publish a successful expired row', async (t) => {
  const h = setup(t);
  const original = h.context.globalState.update;
  h.context.globalState.update = async (...args) => {
    await original(...args);
    const storedId = args[1].at(-1);
    const data = JSON.parse(h.secrets.get(slot(storedId)));
    data.metadata.expiresAt = Date.now() + 1000;
    h.secrets.set(slot(storedId), JSON.stringify(data));
  };
  assert.equal(await h.registry.configure(model, h.scope), undefined);
  assert.deepEqual(h.registry.rows(h.scope), []);
});

test('organization inventory includes expired keys, opaque stable IDs, scoped secret flags and no model discovery or writes', async (t) => {
  const h = setup(t);
  const legacy = h.seed();
  const before = [...h.secrets];
  const expiry = Date.now() - 1000;
  iam.listAccessAPIKeys = async (org, credential, signal) => {
    assert.equal(org, project.organizationId);
    assert.equal(credential, control);
    assert.equal(signal, h.scope.signal);
    return [
      { ...h.metadata(), expiresAt: expiry },
      {
        ...h.metadata(applicationKey.accessKey),
        expiresAt: expiry + 7200000,
        createdAt: '2026-10-01T00:00:00Z',
      },
    ];
  };
  const rows = await h.registry.inventory(h.scope);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, legacy.id);
  assert.equal(rows[0].secretAvailable, true);
  assert.equal(rows[0].expiresAt, expiry);
  assert.equal(rows[1].secretAvailable, false);
  assert.match(rows[1].id, /^[a-f0-9]{32}$/);
  assertPublic(rows);
  assert.deepEqual(
    Object.keys(rows[0]).sort(),
    [
      'id',
      'description',
      'maskedAccessKey',
      'bearerType',
      'expiresAt',
      'secretAvailable',
    ].sort(),
  );
  assert.deepEqual(await h.registry.inventory(h.scope), rows);
  const foreign = await h.registry.inventory({ ...h.scope, userId: appId });
  assert.equal(foreign[0].secretAvailable, false);
  assert.equal(foreign[1].id, rows[1].id);
  assert.equal(h.count('models'), 0);
  assert.equal(h.count('inspect'), 0);
  assert.equal(h.count('store'), 0);
  assert.equal(h.count('update'), 0);
  assert.deepEqual([...h.secrets], before);
});

test('key registration stores v2 without model, deduplicates exact credentials, and never calls models', async (t) => {
  const h = setup(t);
  wizard.chooseAccessPlan = async (input) => {
    assert.equal(input.modelId, undefined);
    return { type: 'reuse' };
  };
  assert.equal(await h.registry.configureKey(h.scope), true);
  const ids = h.state.get(namespace(h.scope));
  assert.equal(ids.length, 1);
  const raw = h.secrets.get(slot(ids[0]));
  assert.equal(JSON.parse(raw).version, 2);
  assert.equal('modelId' in JSON.parse(raw), false);
  assert.deepEqual(h.registry.rows(h.scope), []);
  assert.equal(await h.registry.configureKey(h.scope), true);
  assert.deepEqual(h.state.get(namespace(h.scope)), ids);
  assert.equal(h.secrets.get(slot(ids[0])), raw);
  assert.equal(h.count('models'), 0);
});

test('selected inventoried key import enforces its access key and fresh IAM before storage, without models', async (t) => {
  const h = setup(t);
  const resource = (await h.registry.inventory(h.scope))[1];
  wizard.chooseAccessPlan = async (input) => {
    assert.equal(input.modelId, undefined);
    assert.equal(input.selectedAccessKey, applicationKey.accessKey);
    return { type: 'import', ...login };
  };
  assert.equal(await h.registry.configureKey(h.scope, resource.id), false);
  assert.equal(h.count('store'), 0);
  wizard.chooseAccessPlan = async () => ({ type: 'import', ...applicationKey });
  assert.equal(await h.registry.configureKey(h.scope, resource.id), true);
  assert.equal(h.count('inspect'), 1);
  assert.equal(h.count('models'), 0);
  assert.equal((await h.registry.inventory(h.scope))[1].secretAvailable, true);
});

test('one registered legacy key serves two models without mutation or generation and both consumers stay valid', async (t) => {
  const h = setup(t, { selectLocal: true });
  const record = h.seed(1, { modelId: 'legacy-model' });
  const raw = h.secrets.get(slot(record.id));
  const second = { ...model, id: 'second-model' };
  provider.listServerlessAvailability = async () => [
    { id: model.id },
    { id: second.id },
  ];
  const firstRow = await h.registry.configure(model, h.scope);
  const first = await h.registry.credential(h.scope, firstRow);
  const secondRow = await h.registry.configure(second, h.scope);
  const secondHandle = await h.registry.credential(h.scope, secondRow);
  assert.equal(firstRow.llmAccess.id, record.id);
  assert.equal(secondRow.llmAccess.id, record.id);
  assert.equal(first.current(), true);
  assert.equal(secondHandle.current(), true);
  assert.equal(first.secretKey(), secondHandle.secretKey());
  assert.equal(h.count('wizard'), 0);
  assert.equal(h.count('create'), 0);
  assert.equal(h.count('store'), 0);
  assert.equal(h.count('update'), 0);
  assert.equal(h.secrets.get(slot(record.id)), raw);
  assertPublic([firstRow, secondRow]);
});

test('inventory scope cancellation and slot changes during reads cannot publish stale local availability', async (t) => {
  const h = setup(t);
  const record = h.seed();
  const original = h.context.secrets.get;
  h.context.secrets.get = async (key) => {
    const raw = await original(key);
    if (key === slot(record.id)) await h.context.secrets.delete(key);
    return raw;
  };
  assert.deepEqual(await h.registry.inventory(h.scope), []);
  h.stale();
  assert.deepEqual(await h.registry.inventory(h.scope), []);
});

test('v2 registered key serves two models with one immutable slot and IAM/catalogue revalidation', async (t) => {
  const h = setup(t, { selectLocal: true, keyOnly: true });
  assert.equal(await h.registry.configureKey(h.scope), true);
  const id = h.state.get(namespace(h.scope))[0];
  const raw = h.secrets.get(slot(id));
  const second = { ...model, id: 'second-model' };
  provider.listServerlessAvailability = async () => [
    { id: model.id },
    { id: second.id },
  ];
  const firstRow = await h.registry.configure(model, h.scope);
  const first = await h.registry.credential(h.scope, firstRow);
  const secondRow = await h.registry.configure(second, h.scope);
  assert.equal(firstRow.llmAccess.id, id);
  assert.equal(secondRow.llmAccess.id, id);
  assert.equal(
    (await h.registry.credential(h.scope, secondRow)).current(),
    true,
  );
  assert.equal(first.current(), true);
  assert.equal(h.count('inspect'), 5);
  assert.equal(h.count('store'), 2, 'only initial revision and secret');
  assert.equal(h.secrets.get(slot(id)), raw);
  assert.equal(h.state.get(namespace(h.scope)).length, 1);
});

test('key-first creation retains a recoverable model-free marker on IAM failure and resumes without another creation', async (t) => {
  const h = setup(t, { plan: createPlan() });
  wizard.chooseAccessPlan = async () => createPlan();
  const inspect = iam.inspectAccessAPIKey;
  iam.inspectAccessAPIKey = async () => {
    throw new iam.IAMAccessError('access_denied');
  };
  assert.equal(await h.registry.configureKey(h.scope), false);
  const pendingSlot = `${namespace(h.scope)}.pending`;
  const pending = JSON.parse(h.secrets.get(pendingSlot));
  assert.equal('modelId' in pending, false);
  assert.deepEqual(pending.credentials, applicationKey);
  iam.inspectAccessAPIKey = inspect;
  window.showWarningMessage = async () => 'Reprendre la configuration';
  assert.equal(await h.registry.configureKey(h.scope), true);
  assert.equal(h.count('create'), 1);
  assert.equal(h.count('models'), 0);
  assert.equal(h.secrets.has(pendingSlot), false);
});

test('key registration preserves the 32-slot bound but can reuse an exact credential at capacity', async (t) => {
  const h = setup(t, { keyOnly: true });
  for (let n = 1; n <= 32; n++)
    h.seed(n, {
      secretKey:
        n === 1
          ? login.secretKey
          : `77777777-7777-4777-8777-${String(n).padStart(12, '0')}`,
    });
  const before = [...h.secrets];
  assert.equal(await h.registry.configureKey(h.scope), true);
  assert.deepEqual([...h.secrets], before);
  wizard.chooseAccessPlan = async () => ({ type: 'import', ...applicationKey });
  assert.equal(await h.registry.configureKey(h.scope), false);
  assert.deepEqual([...h.secrets], before);
  assert.equal(h.state.get(namespace(h.scope)).length, 32);
  assert.equal(h.count('models'), 0);
});

test('local reveal is exact, HTTP-free, expiry-tolerant and invalidated by deletion/rotation/scope changes', async (t) => {
  const s = setup(t);
  const record = s.seed(1, { metadata: { ...s.metadata(), expiresAt: 1 } });
  iam.inspectAccessAPIKey = async () => ({ ...s.metadata(), expiresAt: 1 });
  await s.registry.inventory(s.scope);
  const before = s.events.length;
  const handle = await s.registry.revealLocal(s.scope, record.id);
  assert.deepEqual(handle.credentials(), login);
  assert.equal(s.events.length, before, 'no IAM/HTTP/UI writes');
  await assert.rejects(s.registry.revealLocal(s.scope, idAt(99)));
  await assert.rejects(
    s.registry.revealLocal(
      { ...s.scope, project: { ...project, id: userId } },
      record.id,
    ),
  );
  await assert.rejects(s.registry.keyCredential(s.scope, record.id));
  s.secrets.set(
    slot(record.id),
    JSON.stringify({ ...record, secretKey: applicationKey.secretKey }),
  );
  s.emit(slot(record.id));
  assert.equal(handle.current(), false);
  assert.throws(() => handle.credentials());
  await assert.rejects(s.registry.revealLocal(s.scope, record.id));
  await s.registry.inventory(s.scope);
  const next = await s.registry.revealLocal(s.scope, record.id);
  s.state.set(namespace(s.scope), []);
  assert.equal(next.current(), false);
  await assert.rejects(s.registry.revealLocal(s.scope, record.id));
});

test('reveal rejects in-flight storage deletion, replacement and registry generation changes', async (t) => {
  for (const mutation of ['delete', 'identity', 'clear', 'stale']) {
    const s = setup(t);
    const record = s.seed();
    await s.registry.inventory(s.scope);
    const original = s.context.secrets.get;
    let reads = 0;
    s.context.secrets.get = async (key) => {
      const value = await original(key);
      if (++reads === 1) {
        if (mutation === 'delete') {
          s.secrets.delete(key);
          s.emit(key);
        }
        if (mutation === 'identity')
          s.secrets.set(
            key,
            JSON.stringify({ ...record, accessKey: applicationKey.accessKey }),
          );
        if (mutation === 'clear') s.registry.clear();
        if (mutation === 'stale') s.stale();
      }
      return value;
    };
    await assert.rejects(s.registry.revealLocal(s.scope, record.id));
  }
});

test('explicit key can be reused across model selections and dedicated lookup never substitutes login key', async (t) => {
  const s = setup(t);
  s.seed(1);
  const application = s.seed(2, {
    ...applicationKey,
    metadata: s.metadata(applicationKey.accessKey),
  });
  await s.registry.inventory(s.scope);
  const dedicated = await s.registry.keyCredential(s.scope, application.id);
  assert.equal(dedicated.secretKey(), applicationKey.secretKey);
  assert.notEqual(dedicated.secretKey(), login.secretKey);
  const first = await s.registry.configure(model, s.scope, application.id);
  assert.equal(first.llmAccess.id, application.id);
  provider.listServerlessAvailability = async () => [
    { id: model.id },
    { id: 'second-model' },
  ];
  const second = await s.registry.configure(
    { ...model, id: 'second-model' },
    s.scope,
    application.id,
  );
  assert.equal(second.llmAccess.id, application.id);
  assert.equal(dedicated.current(), true);
  assert.equal(s.count('pick'), 0);
  assert.equal(s.count('create'), 0);
  assert.equal(await s.registry.configure(model, s.scope, 'forged'), undefined);
});

test('local reveal handle invalidates on revision event, scope loss, and refreshed/deleted IAM membership', async (t) => {
  const s = setup(t);
  const record = s.seed();
  await s.registry.inventory(s.scope);
  const handle = await s.registry.revealLocal(s.scope, record.id);
  s.emit(namespace(s.scope) + '.revision');
  assert.equal(handle.current(), false);
  await assert.rejects(s.registry.revealLocal(s.scope, record.id));
  await s.registry.inventory(s.scope);
  const refreshed = await s.registry.revealLocal(s.scope, record.id);
  iam.listAccessAPIKeys = async () => [];
  await s.registry.inventory(s.scope);
  assert.equal(refreshed.current(), false);
  await assert.rejects(s.registry.revealLocal(s.scope, record.id));
});
