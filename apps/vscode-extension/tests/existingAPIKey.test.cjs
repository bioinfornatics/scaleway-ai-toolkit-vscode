const assert = require('node:assert/strict');
const { test } = require('node:test');
const Module = require('node:module');
const sdk = require('../dist/scalewaySdk');
const provider = require('../dist/provider');
const auth = require('../dist/browserLogin');
const access = 'SCW12345678901234567',
  secret = '33333333-3333-3333-3333-333333333333';
const user = '11111111-1111-1111-1111-111111111111',
  project = '22222222-2222-2222-2222-222222222222';
const configuration = 'scalewayAI.authConfiguration.v1',
  slot = 'scalewayAI.importedKey.v1';
function setup(t) {
  const secrets = new Map(),
    state = new Map(),
    errors = [],
    inputs = [],
    scopes = [];
  let reads = 0,
    writes = 0,
    inspectionError;
  const context = {
    secrets: {
      onDidChange: () => ({ dispose() {} }),
      get: async (key) => secrets.get(key),
      store: async (key, value) => secrets.set(key, value),
      delete: async (key) => secrets.delete(key),
    },
    globalState: {
      get: (key) => state.get(key),
      update: async (key, value) =>
        value === undefined ? state.delete(key) : state.set(key, value),
    },
  };
  const vscode = {
    workspace: { isTrusted: true },
    env: {},
    window: {
      showInputBox: async (options) => {
        inputs.push(options);
        return options.title.startsWith('Access') ? access : secret;
      },
      showQuickPick: async (items) => items[0],
      showErrorMessage: async (value) => errors.push(value),
      showWarningMessage: async (value) => errors.push(value),
      showInformationMessage: async () => undefined,
    },
  };
  const original = Module._load;
  Module._load = function (name, ...args) {
    return name === 'vscode' ? vscode : original.call(this, name, ...args);
  };
  delete require.cache[require.resolve('../dist/connection')];
  let Connection;
  try {
    Connection = require('../dist/connection').Connection;
  } finally {
    Module._load = original;
  }
  const originals = {
    inspect: sdk.inspectExistingUserAPIKey,
    create: sdk.createUserAPIKey,
    revoke: sdk.revokeUserAPIKey,
    organizations: provider.listOrganizations,
    projects: provider.listProjects,
    browser: auth.browserLogin,
    availability: provider.listServerlessAvailability,
    dedicated: provider.listDedicated,
  };
  sdk.inspectExistingUserAPIKey = async (a, s, signal) => {
    reads++;
    assert.equal(a, access);
    assert.equal(s, secret);
    assert.equal(signal.aborted, false);
    if (inspectionError) throw new sdk.SDKError(inspectionError);
    return { userId: user, accessKey: access, expiresAt: Date.now() + 3600000 };
  };
  sdk.createUserAPIKey =
    sdk.revokeUserAPIKey =
    auth.browserLogin =
      async () => {
        writes++;
        assert.fail('browser/create/revoke forbidden');
      };
  provider.listOrganizations = async (u, s) => {
    assert.equal(u, user);
    assert.equal(s, secret);
    return [{ id: user, name: 'Organization', locked: false }];
  };
  provider.listProjects = async () => [
    { id: project, name: 'Project', organizationId: user },
  ];
  function create() {
    const c = new Connection(context, () => {});
    scopes.push(c);
    return c;
  }
  t.after(() => {
    for (const c of scopes) c.dispose();
    sdk.inspectExistingUserAPIKey = originals.inspect;
    sdk.createUserAPIKey = originals.create;
    sdk.revokeUserAPIKey = originals.revoke;
    provider.listOrganizations = originals.organizations;
    provider.listProjects = originals.projects;
    auth.browserLogin = originals.browser;
    provider.listServerlessAvailability = originals.availability;
    provider.listDedicated = originals.dedicated;
  });
  return {
    create,
    secrets,
    state,
    errors,
    inputs,
    context,
    vscode,
    reads: () => reads,
    writes: () => writes,
    fail: (code) => {
      inspectionError = code;
    },
  };
}
test('existing user key import uses masked native inputs; restart restores scoped configuration without browser JWT', async (t) => {
  const f = setup(t),
    first = f.create();
  await first.useExistingAPIKey();
  assert.equal(first.connected, true);
  assert.equal(first.project.id, project);
  assert.ok(f.inputs.every((options) => options.password));
  assert.equal(f.secrets.has('scalewayAI.userSession.v1'), false);
  assert.equal(f.state.get(configuration).mode, 'api-key');
  assert.ok(!JSON.stringify([...f.state]).includes(secret));
  first.dispose();
  const before = f.reads(),
    restored = f.create();
  await restored.ready;
  assert.equal(restored.connected, true);
  assert.equal(restored.project.id, project);
  assert.equal(f.reads(), before);
  assert.equal(await restored.ensureProject(), true);
  assert.equal(f.reads(), before + 1);
  await restored.revokeAPIKey();
  assert.equal(f.writes(), 0);
  await restored.disconnect();
  assert.ok(f.secrets.has(slot));
  assert.equal(f.state.get(configuration).mode, 'disconnected');
  const next = f.create();
  await next.ready;
  assert.equal(next.connected, false);
  await next.useExistingAPIKey();
  assert.equal(next.connected, true);
  assert.equal(f.inputs.length, 2);
});
test('network and IAM failures preserve config, never create replacement or open browser', async (t) => {
  const f = setup(t),
    first = f.create();
  await first.useExistingAPIKey();
  first.dispose();
  for (const code of [
    'timeout',
    'access_denied',
    'rate_limited',
    'invalid_api_key',
    'api_key_expired',
  ]) {
    const c = f.create();
    await c.ready;
    f.fail(code);
    assert.equal(await c.ensureProject(), false);
    assert.equal(f.state.get(configuration).mode, 'api-key');
    assert.equal(c.project.id, project);
    assert.ok(f.secrets.has(slot));
    assert.equal(f.writes(), 0);
    c.dispose();
  }
  assert.ok(f.errors.every((message) => !message.includes(secret)));
});
test('cancelled input, missing/corrupt secret and untrusted workspace never create keys', async (t) => {
  const f = setup(t);
  f.vscode.window.showInputBox = async () => undefined;
  const c = f.create();
  await c.useExistingAPIKey();
  assert.equal(c.connected, false);
  assert.equal(f.reads(), 0);
  f.state.set(configuration, { mode: 'api-key', userId: user });
  for (const raw of [
    undefined,
    '{',
    JSON.stringify({
      userId: user,
      accessKey: access,
      secretKey: secret,
      expiresAt: 1,
    }),
  ]) {
    if (raw) f.secrets.set(slot, raw);
    else f.secrets.delete(slot);
    const next = f.create();
    await next.ready;
    assert.equal(next.connected, false);
  }
  f.vscode.workspace.isTrusted = false;
  await c.useExistingAPIKey();
  assert.equal(f.reads(), 0);
  assert.equal(f.writes(), 0);
});
test('logout during import secret write does not reconnect or revive auth configuration', async (t) => {
  const f = setup(t),
    c = f.create();
  let unblock;
  const original = f.context.secrets.store;
  f.context.secrets.store = async (key, value) => {
    await new Promise((resolve) => {
      unblock = resolve;
    });
    await original(key, value);
  };
  const importing = c.useExistingAPIKey();
  while (!unblock) await new Promise((resolve) => setImmediate(resolve));
  const logout = c.disconnect();
  unblock();
  await importing;
  await logout;
  assert.equal(c.connected, false);
  assert.equal(f.state.get(configuration).mode, 'disconnected');
  const next = f.create();
  await next.ready;
  assert.equal(next.connected, false);
});

test('generated browser key restores without JWT or browser, validates on explicit action', async (t) => {
  const f = setup(t);
  f.state.set(configuration, { mode: 'browser', userId: user });
  f.state.set('scalewayAI.preferences.v1.' + user, {
    organizationId: user,
    project: { id: project, name: 'Saved', organizationId: user },
  });
  f.secrets.set(
    'scalewayAI.sdkKey.v1.' + user,
    JSON.stringify({
      userId: user,
      accessKey: access,
      secretKey: secret,
      expiresAt: Date.now() + 3600000,
    }),
  );
  f.secrets.set('scalewayAI.userSession.v1', '{');
  const c = f.create();
  await c.ready;
  assert.equal(c.connected, true);
  assert.equal(c.project.name, 'Saved');
  assert.equal(f.reads(), 0);
  assert.equal(await c.ensureProject(), true);
  assert.equal(f.reads(), 1);
  assert.equal(f.writes(), 0);
});
test('missing corrupt expired key restores selections only in both credential modes', async (t) => {
  const f = setup(t);
  f.state.set('scalewayAI.preferences.v1.' + user, {
    organizationId: user,
    organizationName: 'Saved org',
    project: { id: project, name: 'Saved project', organizationId: user },
  });
  for (const mode of ['api-key', 'browser']) {
    f.state.set(configuration, { mode, userId: user });
    const keySlot = mode === 'api-key' ? slot : 'scalewayAI.sdkKey.v1.' + user;
    for (const raw of [
      undefined,
      '{',
      JSON.stringify({
        userId: user,
        accessKey: access,
        secretKey: secret,
        expiresAt: 1,
      }),
    ]) {
      if (raw) f.secrets.set(keySlot, raw);
      else f.secrets.delete(keySlot);
      const c = f.create();
      await c.ready;
      assert.equal(c.connected, false);
      assert.equal(c.project.name, 'Saved project');
      assert.match(c.metadata.name, /non vérifié/);
      assert.equal(f.reads(), 0);
      assert.equal(f.writes(), 0);
      assert.deepEqual(c.serverlessResources, []);
      assert.deepEqual(c.dedicated, []);
      c.dispose();
    }
  }
});

test('refresh with imported login key hides legacy rows without IAM-bound execution access', async (t) => {
  const f = setup(t),
    c = f.create();
  await c.useExistingAPIKey();
  c.serverlessResources = [
    { id: 'unbound', label: 'Legacy', kind: 'serverless' },
  ];
  let modelReads = 0;
  provider.listServerlessAvailability = async () => {
    modelReads++;
    assert.fail('unbound key must not be used for resource proof');
  };
  await c.refreshServerlessAvailability();
  assert.deepEqual(c.serverlessResources, []);
  assert.equal(modelReads, 0);
  assert.equal(c.connected, true);
  assert.equal(f.writes(), 0);
});

test('automatic dedicated discovery keeps API errors inline without notifications', async (t) => {
  const f = setup(t),
    c = f.create();
  await c.useExistingAPIKey();
  provider.listDedicated = async () => {
    throw new provider.ReadError('access_denied');
  };
  await c.loadModels(true);
  assert.equal(c.dedicatedState, 'Erreur · non vérifié');
  assert.deepEqual(f.errors, []);
  assert.equal(f.writes(), 0);
});

test('restored login with failed validation cannot expose legacy execution access', async (t) => {
  const f = setup(t),
    c = f.create();
  await c.useExistingAPIKey();
  c.dispose();
  const restored = f.create();
  await restored.ready;
  restored.serverlessResources = [
    { id: 'present', label: 'Present', kind: 'serverless' },
  ];
  f.fail('timeout');
  await restored.refreshServerlessAvailability(true);
  assert.deepEqual(f.errors, []);
  assert.equal(restored.serverlessResources[0].llmAccess, undefined);
  assert.equal(f.writes(), 0);
});
