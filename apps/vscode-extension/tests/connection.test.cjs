const assert = require('node:assert/strict');
const { test } = require('node:test');
const Module = require('node:module');
const provider = require('../dist/provider');
const auth = require('../dist/browserLogin');
const sdk = require('../dist/scalewaySdk');
const secretKey = '33333333-3333-3333-3333-333333333333';
const accessKey = 'SCW12345678901234567';
const keySlot = (userId = org) => `scalewayAI.sdkKey.v1.${userId}`;
const fakePair = () => ({
  accessKey,
  secretKey,
  expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
});
const priceProvider = require('../dist/dedicatedPrices');
const org = '11111111-1111-1111-1111-111111111111',
  id = '22222222-2222-2222-2222-222222222222';
const token = 'eyJhbGciOiJSUzI1NiJ9.eyJleHAiOjQwMDAwMDAwMDB9.c3ludGhldGlj';
function setup({ workspace = false } = {}) {
  const secrets = new Map([['scalewayAI.apiKey.v1', 'legacy_do_not_read']]),
    state = new Map([
      ['scalewayAI.connection', { name: 'legacy', organizationId: org }],
    ]);
  let requests = 0,
    opened = 0,
    logins = 0,
    creations = 0,
    revocations = 0,
    changed = 0;
  const errors = [],
    warnings = [],
    secretReads = [];
  const inputs = [];
  const vscode = {
    workspace: { isTrusted: true },
    env: {
      openExternal: async () => {
        opened++;
        return true;
      },
    },
    Uri: { parse: (v) => v },
    ProgressLocation: { Notification: 15 },
    window: {
      showInputBox: async () => {
        assert.fail('UUID text input forbidden');
      },
      showInformationMessage: async (_m, _opts, action) => action,
      showErrorMessage: async (message) => {
        errors.push(message);
      },
      showWarningMessage: async (message) => {
        warnings.push(message);
      },
      showQuickPick: async (items) => items[0],
      withProgress: async (_opts, fn) =>
        fn({}, { onCancellationRequested: () => ({ dispose() {} }) }),
    },
  };
  const context = {
    globalState: {
      get: (k) => state.get(k),
      update: async (k, v) =>
        v === undefined ? state.delete(k) : state.set(k, v),
    },
    secrets: {
      onDidChange: () => ({ dispose() {} }),
      get: async (k) => {
        assert.ok(
          k === 'scalewayAI.userSession.v1' ||
            k.startsWith('scalewayAI.sdkKey.v1.') ||
            k.startsWith('scalewayAI.llmAccess.secret.v1.') ||
            /^scalewayAI\.llmAccess\.v1\.[a-f0-9]{64}\.pending$/.test(k),
        );
        secretReads.push(k);
        return secrets.get(k);
      },
      store: async (k, v) => secrets.set(k, v),
      delete: async (k) => secrets.delete(k),
    },
  };
  const original = Module._load;
  Module._load = function (name, ...rest) {
    return name === 'vscode' ? vscode : original.call(this, name, ...rest);
  };
  delete require.cache[require.resolve('../dist/connection')];
  let Connection, deployService, accessIam, accessWizard;
  try {
    deployService = require('../dist/deployService');
    Connection = require('../dist/connection').Connection;
    accessIam = require('../dist/llmAccessIam');
    accessWizard = require('../dist/llmAccessWizard');
    require('../dist/servicePlayground');
  } finally {
    Module._load = original;
  }
  const accessCalls = [],
    availabilityCalls = [],
    planCalls = [];
  const accessAdapters = [
    [accessIam, 'inspectAccessAPIKey'],
    [accessIam, 'listAccessApplications'],
    [accessIam, 'createAccessAPIKey'],
    [accessWizard, 'chooseAccessPlan'],
    [provider, 'listServerlessAvailability'],
  ].map(([target, key]) => [target, key, target[key]]);
  accessIam.inspectAccessAPIKey = async (
    organizationId,
    key,
    secret,
    signal,
  ) => {
    accessCalls.push({ organizationId, accessKey: key, secretKey: secret });
    assert.equal(signal.aborted, false);
    assert.equal(key, accessKey);
    assert.equal(secret, secretKey);
    return {
      accessKey: key,
      bearer: { type: 'user', id: org },
      organizationId,
      description: 'Local connection fixture',
      expiresAt: Date.now() + 30 * 86400000,
    };
  };
  accessIam.listAccessApplications = async () => [];
  accessIam.createAccessAPIKey = async () => {
    assert.fail('access key creation requires an explicit test adapter');
  };
  accessWizard.chooseAccessPlan = async (scope) => {
    planCalls.push(scope);
    assert.equal(scope.current(), true);
    return { type: 'reuse' };
  };
  provider.listServerlessAvailability = async (secret, signal) => {
    availabilityCalls.push(secret);
    assert.equal(secret, secretKey);
    assert.equal(signal.aborted, false);
    return [{ id: 'public-model' }, { id: 'fixture-chat-never-live-tested' }];
  };
  const old = provider.listProjects,
    oldAuth = auth.browserLogin,
    oldDedicated = provider.listDedicated,
    oldOrganizations = provider.listOrganizations,
    oldPrices = priceProvider.listDedicatedPrices,
    oldCreateKey = sdk.createUserAPIKey,
    oldRevokeKey = sdk.revokeUserAPIKey;
  sdk.createUserAPIKey = async (userId, jwt, signal) => {
    creations++;
    assert.equal(userId, org);
    assert.equal(jwt, token);
    assert.equal(signal.aborted, false);
    assert.deepEqual(JSON.parse(secrets.get(keySlot(userId))), {
      userId,
      pending: true,
    });
    return fakePair();
  };
  sdk.revokeUserAPIKey = async (key, jwt, signal) => {
    revocations++;
    assert.equal(key, accessKey);
    assert.equal(jwt, token);
    assert.equal(signal.aborted, false);
  };
  priceProvider.listDedicatedPrices = async () => [];
  provider.listOrganizations = async (u, k) => {
    assert.equal(u, org);
    assert.equal(k, secretKey);
    return [{ id: org, name: 'Organization', locked: false }];
  };
  provider.listProjects = async (o, k) => {
    requests++;
    assert.equal(o, org);
    assert.equal(k, secretKey);
    return [{ id, name: 'Project', organizationId: org }];
  };
  provider.listDedicated = async (_p, k) => {
    requests++;
    assert.equal(k, secretKey);
    return [];
  };
  auth.browserLogin = async (open) => {
    logins++;
    await open(
      'https://account.scaleway.com/authenticate?redirectToUrl=synthetic',
    );
    return { token, expiresAt: Date.now() + 3600000, userId: org };
  };
  const workspaceValues = new Map();
  if (workspace)
    context.workspaceState = {
      get: (key) => workspaceValues.get(key),
      update: async (key, value) => workspaceValues.set(key, value),
    };
  return {
    connection: new Connection(context, () => {
      changed++;
    }),
    newConnection: () =>
      new Connection(context, () => {
        changed++;
      }),
    changed: () => changed,
    workspaceValues,
    deployService,
    context,
    accessIam,
    accessWizard,
    accessCalls,
    availabilityCalls,
    planCalls,
    secrets,
    state,
    inputs,
    errors,
    warnings,
    secretReads,
    creations: () => creations,
    revocations: () => revocations,
    vscode,
    requests: () => requests,
    opened: () => opened,
    logins: () => logins,
    restore: () => {
      for (const [target, key, value] of accessAdapters) target[key] = value;
      provider.listProjects = old;
      auth.browserLogin = oldAuth;
      provider.listDedicated = oldDedicated;
      provider.listOrganizations = oldOrganizations;
      priceProvider.listDedicatedPrices = oldPrices;
      sdk.createUserAPIKey = oldCreateKey;
      sdk.revokeUserAPIKey = oldRevokeKey;
    },
  };
}
test('user browser login receives JWT, reads projects, stores JWT and user-bound SDK pair only in SecretStorage; removes legacy key', async () => {
  const s = setup();
  try {
    assert.equal(s.requests(), 0);
    assert.equal(s.connection.metadata, undefined);
    await s.connection.login();
    assert.equal(s.opened(), 1);
    assert.equal(s.requests(), 1);
    assert.equal(s.connection.project.id, id);
    assert.equal(s.inputs.length, 0);
    assert.equal(s.secrets.size, 2);
    assert.equal(
      JSON.parse(s.secrets.get('scalewayAI.userSession.v1')).token,
      token,
    );
    assert.ok(!JSON.stringify([...s.state]).includes(token));
    assert.ok(!JSON.stringify(s.connection.metadata).includes(token));
    await s.connection.loadModels();
    assert.equal(s.requests(), 2);
    assert.equal(s.connection.serverless.length, 0);
    await s.connection.switchProject();
    assert.equal(s.logins(), 1);
    await s.connection.disconnect();
    assert.equal(s.connection.project, undefined);
    assert.equal(s.connection.metadata, undefined);
  } finally {
    s.connection.dispose();
    s.restore();
  }
});
test('declined browser consent never opens or reads', async () => {
  const s = setup();
  s.vscode.window.showInformationMessage = async () => undefined;
  try {
    await s.connection.login();
    assert.equal(s.opened(), 0);
    assert.equal(s.requests(), 0);
  } finally {
    s.connection.dispose();
    s.restore();
  }
});
test('disconnect during browser consent invalidates operation', async () => {
  const s = setup();
  s.vscode.window.showInformationMessage = async () => {
    await s.connection.disconnect();
    return 'Se connecter';
  };
  try {
    await s.connection.login();
    assert.equal(s.opened(), 0);
    assert.equal(s.requests(), 0);
  } finally {
    s.connection.dispose();
    s.restore();
  }
});
test('remote host blocked before browser; expired session drops scope without reads', async () => {
  const s = setup();
  try {
    s.vscode.env.remoteName = 'ssh-remote';
    await s.connection.login();
    assert.equal(s.opened(), 0);
    s.vscode.env.remoteName = undefined;
    await s.connection.login();
    const before = s.requests();
    s.connection.session.expiresAt = Date.now() - 1;
    await s.connection.loadModels();
    assert.equal(s.requests(), before);
    assert.equal(s.connection.project.id, id);
    assert.match(s.connection.metadata.name, /accès non vérifié/);
  } finally {
    s.connection.dispose();
    s.restore();
  }
});
test('late browser result after disconnect cannot restore session', async () => {
  const s = setup();
  const old = auth.browserLogin;
  auth.browserLogin = async () => {
    await s.connection.disconnect();
    return { token, expiresAt: Date.now() + 3600000, userId: org };
  };
  try {
    await s.connection.login();
    assert.equal(s.requests(), 0);
    assert.equal(s.connection.metadata, undefined);
  } finally {
    auth.browserLogin = old;
    s.connection.dispose();
    s.restore();
  }
});

test('Organization selection silently loads projects with no modal or progress notification', async () => {
  const s = setup();
  try {
    await s.connection.login();
    const before = s.requests();
    s.vscode.window.showInformationMessage = async () => {
      assert.fail('no project-list confirmation');
    };
    s.vscode.window.withProgress = async () => {
      assert.fail('no project loading notification');
    };
    await s.connection.switchProject();
    assert.equal(s.requests(), before + 1);
    assert.equal(s.connection.project.id, id);
  } finally {
    s.connection.dispose();
    s.restore();
  }
});
test('cancelled organization selection or disconnect during picker prevents project reads', async () => {
  const s = setup();
  try {
    await s.connection.login();
    const before = s.requests();
    s.vscode.window.showQuickPick = async () => undefined;
    await s.connection.switchProject();
    assert.equal(s.requests(), before);
    s.vscode.window.showQuickPick = async () => {
      await s.connection.disconnect();
      return { organization: { id: org, name: 'Organization', locked: false } };
    };
    await s.connection.switchProject();
    assert.equal(s.requests(), before);
    assert.equal(s.connection.project, undefined);
  } finally {
    s.connection.dispose();
    s.restore();
  }
});

test('shared account gate logs in and selects project once; cancellation prevents continuation', async () => {
  const s = setup();
  try {
    assert.equal(await s.connection.ensureProject(), true);
    assert.equal(s.logins(), 1);
    assert.equal(s.requests(), 1);
    assert.equal(await s.connection.ensureProject(), true);
    assert.equal(s.logins(), 1);
    assert.equal(s.requests(), 1);
    await s.connection.disconnect();
    s.vscode.window.showInformationMessage = async () => undefined;
    assert.equal(await s.connection.ensureProject(), false);
    assert.equal(s.logins(), 1);
  } finally {
    s.connection.dispose();
    s.restore();
  }
});
test('expired session reconnects through action gate; direct project switch also reconnects', async () => {
  const s = setup();
  try {
    await s.connection.ensureProject();
    s.connection.session.expiresAt = Date.now() - 1;
    assert.equal(await s.connection.ensureProject(), true);
    assert.equal(s.logins(), 2);
    s.connection.session.expiresAt = Date.now() - 1;
    await s.connection.switchProject();
    assert.equal(s.logins(), 3);
    assert.equal(s.creations(), 1);
    assert.ok(s.secrets.has(keySlot()));
    assert.ok(s.connection.connected);
  } finally {
    s.connection.dispose();
    s.restore();
  }
});

test('Models action silently loads dedicated resources without confirmation or progress popup', async () => {
  const s = setup();
  try {
    await s.connection.ensureProject();
    const before = s.requests();
    s.vscode.window.showInformationMessage = async () => {
      assert.fail('no dedicated-list confirmation');
    };
    s.vscode.window.withProgress = async () => {
      assert.fail('no dedicated loading popup');
    };
    await s.connection.loadModels();
    assert.equal(s.requests(), before + 1);
    assert.equal(s.connection.dedicatedState, 'Aucun déploiement');
  } finally {
    s.connection.dispose();
    s.restore();
  }
});
test('disconnect during silent dedicated load aborts request and prevents stale results', async () => {
  const s = setup();
  const old = provider.listDedicated;
  try {
    await s.connection.ensureProject();
    provider.listDedicated = async (_p, _t, signal) => {
      await s.connection.disconnect();
      assert.ok(signal.aborted);
      return [{ id, label: 'stale', kind: 'dedicated' }];
    };
    await s.connection.loadModels();
    assert.equal(s.connection.dedicated.length, 0);
    assert.equal(s.connection.project, undefined);
    assert.equal(s.connection.dedicatedState, 'Non chargés');
  } finally {
    provider.listDedicated = old;
    s.connection.dispose();
    s.restore();
  }
});

test('restart restores valid JWT, SDK pair and user-bound scope without HTTP or browser', async () => {
  const s = setup();
  let restored;
  try {
    await s.connection.login();
    const before = s.requests();
    s.connection.dispose();
    restored = s.newConnection();
    await restored.ready;
    assert.ok(restored.connected);
    assert.equal(restored.project.id, id);
    assert.equal(restored.metadata.organizationId, org);
    assert.equal(s.requests(), before);
    assert.equal(s.logins(), 1);
    assert.equal(await restored.ensureProject(), true);
    assert.equal(s.requests(), before);
    await restored.disconnect();
    assert.equal(s.secrets.size, 0);
    assert.deepEqual(s.state.get('scalewayAI.authConfiguration.v1'), {
      mode: 'disconnected',
    });
    assert.equal(s.state.size, 1);
  } finally {
    restored?.dispose();
    s.connection.dispose();
    s.restore();
  }
});
test('expired/malformed persisted JWT deleted without HTTP, no preference crossover', async () => {
  const s = setup();
  let restored;
  try {
    await s.connection.ready;
    s.secrets.set(
      'scalewayAI.userSession.v1',
      JSON.stringify({ token, userId: org, expiresAt: Date.now() - 1 }),
    );
    restored = s.newConnection();
    await restored.ready;
    await restored.storage;
    assert.ok(!restored.connected);
    assert.equal(s.secrets.has('scalewayAI.userSession.v1'), false);
    assert.equal(s.requests(), 0);
    restored.dispose();
    s.secrets.set('scalewayAI.userSession.v1', 'invalid json');
    restored = s.newConnection();
    await restored.ready;
    await restored.storage;
    assert.equal(s.secrets.has('scalewayAI.userSession.v1'), false);
    restored.dispose();
    s.state.set(`scalewayAI.preferences.v1.${id}`, {
      organizationId: org,
      project: { id, name: 'Another user', organizationId: org },
    });
    await s.connection.login();
    assert.equal(s.connection.project.name, 'Project');
    assert.equal(s.inputs.length, 0);
  } finally {
    restored?.dispose();
    s.connection.dispose();
    s.restore();
  }
});
test('secure storage failure prevents session persistence and no plaintext fallback', async () => {
  const s = setup();
  try {
    await s.connection.ready;
    s.context.secrets.store = async () => {
      throw Error('backend unavailable');
    };
    await s.connection.login();
    assert.ok(!s.connection.connected);
    assert.equal(s.requests(), 0);
    assert.ok(!JSON.stringify([...s.state]).includes(token));
    assert.equal(s.secrets.has('scalewayAI.userSession.v1'), false);
    assert.equal(s.creations(), 0, 'pending marker must persist before POST');
    assert.equal(s.revocations(), 0);
  } finally {
    s.connection.dispose();
    s.restore();
  }
});
test('logout during delayed secret write removes late credential and prevents resurrection', async () => {
  const s = setup();
  try {
    await s.connection.ready;
    let entered;
    const started = new Promise((r) => (entered = r));
    let release;
    const blocked = new Promise((r) => (release = r));
    s.context.secrets.store = async (k, v) => {
      if (k === 'scalewayAI.userSession.v1') {
        entered();
        await blocked;
      }
      s.secrets.set(k, v);
    };
    const login = s.connection.login();
    await started;
    const logout = s.connection.disconnect();
    release();
    await Promise.all([login, logout]);
    assert.ok(!s.connection.connected);
    assert.equal(s.secrets.has('scalewayAI.userSession.v1'), false);
    assert.equal(s.requests(), 0);
  } finally {
    s.connection.dispose();
    s.restore();
  }
});

test('named organization selector filters locked entries and persists organization name', async () => {
  const s = setup();
  const old = provider.listOrganizations;
  try {
    provider.listOrganizations = async () => [
      { id, name: 'Locked', locked: true },
      { id: org, name: 'Visible organization', locked: false },
    ];
    const picks = [];
    s.vscode.window.showQuickPick = async (items, opts) => {
      picks.push({ items, opts });
      return items[0];
    };
    await s.connection.login();
    assert.equal(picks[0].opts.title, 'Choisir une organisation Scaleway');
    assert.equal(picks[0].items.length, 1);
    assert.equal(picks[0].items[0].label, 'Visible organization');
    assert.equal(
      s.connection.metadata.organizationName,
      'Visible organization',
    );
    assert.equal(
      s.state.get(`scalewayAI.preferences.v1.${org}`).organizationName,
      'Visible organization',
    );
  } finally {
    provider.listOrganizations = old;
    s.connection.dispose();
    s.restore();
  }
});

test('catalog loading separates public offerings/models from existing deployments and keeps failures independent', async () => {
  const s = setup();
  const old = provider.listServerless,
    oldCatalog = provider.listDedicatedCatalog;
  try {
    await s.connection.ensureProject();
    const before = s.requests();
    provider.listServerless = async (k) => {
      assert.equal(k, '');
      return [
        { id: 'model', label: 'Model', kind: 'serverless', status: 'preview' },
      ];
    };
    provider.listDedicatedCatalog = async (p, k) => {
      assert.equal(p.id, id);
      assert.equal(k, secretKey);
      return [{ id, label: 'Dedicated model', kind: 'dedicated-catalog' }];
    };
    await s.connection.loadCatalogs();
    assert.equal(s.requests(), before);
    assert.equal(s.connection.serverless.length, 1);
    assert.equal(s.connection.dedicatedCatalog.length, 1);
    assert.equal(s.connection.dedicated.length, 0);
    provider.listDedicatedCatalog = async () => {
      throw new provider.ReadError('access_denied');
    };
    await s.connection.loadCatalogs();
    assert.equal(s.connection.serverless.length, 1);
    assert.equal(s.connection.dedicatedCatalog.length, 0);
    assert.ok(s.connection.dedicatedCatalogState.includes('access_denied'));
  } finally {
    provider.listServerless = old;
    provider.listDedicatedCatalog = oldCatalog;
    s.connection.dispose();
    s.restore();
  }
});

test('public catalog is independent from busy account and pending SecretStorage, duplicate reads coalesce', async () => {
  const s = setup();
  const old = provider.listServerless;
  try {
    s.connection.ready = new Promise(() => {});
    s.connection.busy = true;
    let count = 0;
    provider.listServerless = async () => {
      count++;
      await new Promise((r) => setTimeout(r, 5));
      return [{ id: 'public', label: 'Public', kind: 'serverless' }];
    };
    await Promise.all([
      s.connection.loadPublicCatalog(),
      s.connection.loadPublicCatalog(),
    ]);
    assert.equal(count, 1);
    assert.equal(s.connection.serverless.length, 1);
    assert.equal(s.logins(), 0);
  } finally {
    provider.listServerless = old;
    s.connection.dispose();
    s.restore();
  }
});

test('deployment preparation re-reads selected-project model and hardware; wizard sees no JWT', async () => {
  const s = setup();
  const wizard = require('../dist/deploymentWizard');
  const previous = {
    models: provider.listDedicatedCatalog,
    nodes: provider.listNodeTypes,
    wizard: wizard.deploymentWizard,
  };
  const modelId = '33333333-3333-3333-3333-333333333333';
  const steps = [];
  try {
    await s.connection.ensureProject();
    provider.listDedicatedCatalog = async (project, jwt) => {
      assert.equal(project.id, id);
      assert.equal(jwt, secretKey);
      steps.push('models');
      return [
        {
          id: modelId,
          label: 'Model',
          kind: 'dedicated-catalog',
          dedicatedInfo: {
            status: 'ready',
            hasEula: false,
            supportedNodes: [],
          },
        },
      ];
    };
    provider.listNodeTypes = async (jwt) => {
      assert.equal(jwt, secretKey);
      steps.push('nodes');
      return [];
    };
    wizard.deploymentWizard = async (project, model, nodes, current) => {
      assert.equal(project.id, id);
      assert.equal(model.id, modelId);
      assert.deepEqual(nodes, []);
      assert.equal(current(), true);
      assert.ok(!JSON.stringify({ project, model, nodes }).includes(token));
      steps.push('wizard');
      return true;
    };
    assert.equal(await s.connection.prepareDeployment(modelId), true);
    assert.deepEqual(steps, ['models', 'nodes', 'wizard']);
    assert.equal(s.connection.busy, false);
    steps.length = 0;
    assert.equal(await s.connection.prepareDeployment('invalid'), false);
    assert.deepEqual(steps, []);
  } finally {
    provider.listDedicatedCatalog = previous.models;
    provider.listNodeTypes = previous.nodes;
    wizard.deploymentWizard = previous.wizard;
    s.connection.dispose();
    s.restore();
  }
});
test('logout during preparation stops hardware read and cannot finish stale wizard', async () => {
  const s = setup();
  const wizard = require('../dist/deploymentWizard');
  const previous = {
    models: provider.listDedicatedCatalog,
    nodes: provider.listNodeTypes,
    wizard: wizard.deploymentWizard,
  };
  const modelId = '33333333-3333-3333-3333-333333333333';
  try {
    await s.connection.ensureProject();
    provider.listDedicatedCatalog = async () => {
      await s.connection.disconnect();
      return [{ id: modelId, label: 'Model', kind: 'dedicated-catalog' }];
    };
    provider.listNodeTypes = async () => assert.fail('stale hardware read');
    wizard.deploymentWizard = async () => assert.fail('stale wizard');
    assert.equal(await s.connection.prepareDeployment(modelId), false);
    assert.equal(s.connection.connected, false);
    assert.equal(s.connection.busy, false);
  } finally {
    provider.listDedicatedCatalog = previous.models;
    provider.listNodeTypes = previous.nodes;
    wizard.deploymentWizard = previous.wizard;
    s.connection.dispose();
    s.restore();
  }
});

test('deployment detail only uses known selected-project identities and rejects stale logout', async () => {
  const s = setup();
  const previous = provider.getDeployment;
  try {
    await s.connection.ensureProject();
    s.connection.dedicated = [{ id, label: 'Known', kind: 'dedicated' }];
    let calls = 0;
    provider.getDeployment = async (project, deploymentId, jwt) => {
      calls++;
      assert.equal(project.id, id);
      assert.equal(deploymentId, id);
      assert.equal(jwt, secretKey);
      return { id, label: 'Known', kind: 'dedicated', status: 'ready' };
    };
    assert.equal(await s.connection.deploymentDetails(org), undefined);
    assert.equal(calls, 0);
    assert.equal((await s.connection.deploymentDetails(id)).status, 'ready');
    assert.equal(s.connection.busy, false);
    provider.getDeployment = async () => {
      await s.connection.disconnect();
      return { id, label: 'Stale', kind: 'dedicated' };
    };
    assert.equal(await s.connection.deploymentDetails(id), undefined);
    assert.equal(s.connection.dedicated.length, 0);
  } finally {
    provider.getDeployment = previous;
    s.connection.dispose();
    s.restore();
  }
});

test('project creation requires final confirmation and saves only validated default', async () => {
  const s = setup();
  const creation = require('../dist/projectCreation');
  const original = creation.createProject;
  const projectId = '33333333-3333-3333-3333-333333333333';
  try {
    await s.connection.ensureProject();
    s.vscode.window.showInputBox = async () => 'New project';
    let writes = 0;
    creation.createProject = async (intent, jwt) => {
      writes++;
      assert.equal(intent.confirmed, true);
      assert.equal(intent.organizationId, org);
      assert.equal(jwt, token);
      return { id: projectId, name: 'New project', organizationId: org };
    };
    s.vscode.window.showInformationMessage = async () => undefined;
    assert.equal(await s.connection.createProject(), false);
    assert.equal(writes, 0);
    assert.equal(s.connection.project.id, id);
    s.vscode.window.showInformationMessage = async (
      _message,
      _options,
      action,
    ) => action;
    assert.equal(await s.connection.createProject(), true);
    assert.equal(writes, 1);
    assert.equal(s.connection.project.id, projectId);
    assert.equal(
      s.state.get(`scalewayAI.preferences.v1.${org}`).project.id,
      projectId,
    );
    assert.ok(!JSON.stringify([...s.state]).includes(token));
  } finally {
    creation.createProject = original;
    s.connection.dispose();
    s.restore();
  }
});
test('unknown creation outcome and stale success preserve old default and never retry', async () => {
  const s = setup();
  const creation = require('../dist/projectCreation');
  const original = creation.createProject;
  try {
    await s.connection.ensureProject();
    const previous = s.state.get(`scalewayAI.preferences.v1.${org}`);
    s.vscode.window.showInputBox = async () => 'New project';
    let writes = 0;
    creation.createProject = async () => {
      writes++;
      throw new provider.ReadError('creation_outcome_unknown');
    };
    assert.equal(await s.connection.createProject(), false);
    assert.equal(writes, 1);
    assert.equal(s.connection.project.id, id);
    assert.deepEqual(s.state.get(`scalewayAI.preferences.v1.${org}`), previous);
    creation.createProject = async () => {
      await s.connection.disconnect();
      return { id: org, name: 'New project', organizationId: org };
    };
    assert.equal(await s.connection.createProject(), false);
    assert.equal(s.connection.project, undefined);
    assert.equal(s.state.get(`scalewayAI.preferences.v1.${org}`), undefined);
  } finally {
    creation.createProject = original;
    s.connection.dispose();
    s.restore();
  }
});

test('trust revoked during created-project preference write restores previous default', async () => {
  const s = setup();
  const creation = require('../dist/projectCreation');
  const previousCreate = creation.createProject;
  try {
    await s.connection.ensureProject();
    const previousPreferences = s.state.get(`scalewayAI.preferences.v1.${org}`);
    s.vscode.window.showInputBox = async () => 'New project';
    creation.createProject = async () => ({
      id: org,
      name: 'New project',
      organizationId: org,
    });
    const update = s.context.globalState.update;
    let invalidated = false;
    s.context.globalState.update = async (key, value) => {
      await update(key, value);
      if (
        !invalidated &&
        key === `scalewayAI.preferences.v1.${org}` &&
        value?.project?.name === 'New project'
      ) {
        invalidated = true;
        s.vscode.workspace.isTrusted = false;
      }
    };
    assert.equal(await s.connection.createProject(), false);
    assert.equal(s.connection.project.id, id);
    assert.deepEqual(
      s.state.get(`scalewayAI.preferences.v1.${org}`),
      previousPreferences,
    );
  } finally {
    creation.createProject = previousCreate;
    s.connection.dispose();
    s.restore();
  }
});

test('explicit follow updates selected resources and ready never claims endpoint reachability', async () => {
  const s = setup();
  const previous = provider.getDeployment;
  try {
    await s.connection.ensureProject();
    s.connection.dedicated = [
      { id, label: 'Known', kind: 'dedicated', status: 'creating' },
    ];
    let reads = 0;
    provider.getDeployment = async (project, deploymentId, jwt) => {
      reads++;
      assert.equal(project.id, id);
      assert.equal(deploymentId, id);
      assert.equal(jwt, secretKey);
      return {
        id,
        label: 'Known',
        kind: 'dedicated',
        status: 'ready',
        deploymentInfo: {
          projectId: id,
          region: 'fr-par',
          fetchedAt: new Date().toISOString(),
          endpoints: [],
        },
      };
    };
    await s.connection.followDeployment(org);
    assert.equal(reads, 0);
    await s.connection.followDeployment(id);
    assert.equal(reads, 1);
    assert.equal(s.connection.dedicated[0].status, 'ready');
    assert.match(s.connection.dedicatedState, /non sondé/);
    assert.equal(s.connection.followingDeployment, false);
    assert.equal(s.connection.busy, false);
  } finally {
    provider.getDeployment = previous;
    s.connection.dispose();
    s.restore();
  }
});
test('stop follow aborts pending read without deleting cloud resources or accepting late update', async () => {
  const s = setup();
  const previous = provider.getDeployment;
  try {
    await s.connection.ensureProject();
    s.connection.dedicated = [
      { id, label: 'Known', kind: 'dedicated', status: 'creating' },
    ];
    let entered;
    const started = new Promise((resolve) => {
      entered = resolve;
    });
    provider.getDeployment = async (_project, _id, _jwt, signal) => {
      entered();
      return new Promise((_resolve, reject) =>
        signal.addEventListener(
          'abort',
          () => reject(new provider.ReadError('cancelled')),
          { once: true },
        ),
      );
    };
    const pending = s.connection.followDeployment(id);
    await started;
    assert.equal(s.connection.followingDeployment, true);
    s.connection.cancelFollowDeployment();
    await pending;
    assert.equal(s.connection.dedicated[0].status, 'creating');
    assert.match(s.connection.dedicatedState, /aucune ressource/);
    assert.equal(s.connection.followingDeployment, false);
    assert.equal(s.connection.busy, false);
  } finally {
    provider.getDeployment = previous;
    s.connection.dispose();
    s.restore();
  }
});

const operationModel = '33333333-3333-3333-3333-333333333333';
const operationId = '44444444-4444-4444-4444-444444444444';
const resourceId = '55555555-5555-5555-5555-555555555555';
function savedOperation(status = 'submitting') {
  return {
    version: 1,
    id: operationId,
    projectId: id,
    organizationId: org,
    modelId: operationModel,
    name: 'Allocated',
    region: 'fr-par',
    status,
    ...(status === 'accepted' ? { deploymentId: resourceId } : {}),
  };
}
function journalKey() {
  return ['scalewayAI.deploymentOperations.v1', org, org, id].join('.');
}
test('controller explicit journal recovery is local, scoped and returns unknown after restart', async () => {
  const s = setup();
  let next;
  try {
    assert.equal(await s.connection.deploymentOperations(), undefined);
    await s.connection.login();
    s.state.set(journalKey(), [savedOperation()]);
    const before = s.requests();
    next = s.newConnection();
    await next.ready;
    const rows = await next.deploymentOperations();
    assert.equal(rows[0].status, 'unknown');
    assert.equal(s.requests(), before);
    rows[0].name = 'changed';
    assert.equal((await next.deploymentOperations())[0].name, 'Allocated');
    s.vscode.workspace.isTrusted = false;
    assert.equal(await next.deploymentOperations(), undefined);
    s.vscode.workspace.isTrusted = true;
    await next.disconnect();
    assert.equal(await next.deploymentOperations(), undefined);
    assert.ok(
      s.state.has(journalKey()),
      'logout must preserve uncertain operation history',
    );
  } finally {
    next?.dispose();
    s.connection.dispose();
    s.restore();
  }
});
test('controller reconciles only accepted scoped ID in one GET, never matches unknown by name', async () => {
  const s = setup();
  const old = provider.getDeployment;
  let reads = 0;
  try {
    await s.connection.login();
    s.state.set(journalKey(), [savedOperation()]);
    provider.getDeployment = async (project, resource, jwt) => {
      reads++;
      assert.equal(project.id, id);
      assert.equal(resource, resourceId);
      assert.equal(jwt, secretKey);
      return {
        id: resourceId,
        label: 'Allocated',
        kind: 'dedicated',
        status: 'ready',
        deploymentInfo: {
          modelId: operationModel,
          projectId: id,
          region: 'fr-par',
        },
      };
    };
    assert.equal(
      await s.connection.reconcileDeploymentOperation(operationId),
      undefined,
    );
    assert.equal(reads, 0);
    s.state.set(journalKey(), [savedOperation('accepted')]);
    assert.equal(
      (await s.connection.reconcileDeploymentOperation(operationId)).id,
      resourceId,
    );
    assert.equal(reads, 1);
    assert.equal(s.connection.dedicated.length, 1);
    provider.getDeployment = async () => {
      reads++;
      await s.connection.disconnect();
      return {
        id: resourceId,
        label: 'Allocated',
        kind: 'dedicated',
        deploymentInfo: { modelId: operationModel },
      };
    };
    assert.equal(
      await s.connection.reconcileDeploymentOperation(operationId),
      undefined,
    );
    assert.equal(s.connection.dedicated.length, 0);
  } finally {
    provider.getDeployment = old;
    s.connection.dispose();
    s.restore();
  }
});

test('preparation prices fail independently and late logout prevents stale wizard', async () => {
  const s = setup();
  const wizard = require('../dist/deploymentWizard');
  const oldModels = provider.listDedicatedCatalog,
    oldNodes = provider.listNodeTypes,
    oldWizard = wizard.deploymentWizard;
  let opened = 0;
  try {
    await s.connection.login();
    provider.listDedicatedCatalog = async () => [
      { id: operationModel, label: 'Model', kind: 'dedicated-catalog' },
    ];
    provider.listNodeTypes = async () => [];
    priceProvider.listDedicatedPrices = async () => {
      throw new provider.ReadError('invalid_price_response');
    };
    wizard.deploymentWizard = async (
      _project,
      _model,
      _nodes,
      current,
      prices,
    ) => {
      assert.equal(current(), true);
      assert.deepEqual(prices, []);
      opened++;
      return true;
    };
    assert.equal(await s.connection.prepareDeployment(operationModel), true);
    priceProvider.listDedicatedPrices = async () => {
      await s.connection.disconnect();
      return [];
    };
    assert.equal(await s.connection.prepareDeployment(operationModel), false);
    assert.equal(opened, 1);
  } finally {
    provider.listDedicatedCatalog = oldModels;
    provider.listNodeTypes = oldNodes;
    wizard.deploymentWizard = oldWizard;
    s.connection.dispose();
    s.restore();
  }
});

test('quota controller reads only on action and returns organization snapshot without JWT', async () => {
  const s = setup();
  const quota = require('../dist/quotas');
  const old = quota.listQuotaEvidence;
  let reads = 0;
  try {
    await s.connection.ready;
    assert.equal(reads, 0);
    await s.connection.login();
    quota.listQuotaEvidence = async (organization, jwt, signal) => {
      reads++;
      assert.equal(organization, org);
      assert.equal(jwt, secretKey);
      assert.equal(signal.aborted, false);
      return {
        version: 1,
        mode: 'organization-quota-evidence',
        organizationId: org,
        fetchedAt: '2026-10-21T05:35:00Z',
        quota: [],
        createRights: 'unverified',
        dedicatedNodeMapping: 'unverified',
      };
    };
    const snapshot = await s.connection.inspectQuotas();
    assert.equal(reads, 1);
    assert.equal(snapshot.organizationId, org);
    assert.ok(!JSON.stringify(snapshot).includes(token));
    assert.equal(s.connection.busy, false);
    s.vscode.workspace.isTrusted = false;
    assert.equal(await s.connection.inspectQuotas(), undefined);
    assert.equal(reads, 1);
  } finally {
    quota.listQuotaEvidence = old;
    s.connection.dispose();
    s.restore();
  }
});
test('late quota response after logout is discarded, no preference or resource resurrection', async () => {
  const s = setup();
  const quota = require('../dist/quotas');
  const old = quota.listQuotaEvidence;
  try {
    await s.connection.login();
    quota.listQuotaEvidence = async (_organization, _jwt, signal) => {
      await s.connection.disconnect();
      assert.equal(signal.aborted, true);
      return { organizationId: org, quota: [] };
    };
    assert.equal(await s.connection.inspectQuotas(), undefined);
    assert.equal(s.connection.connected, false);
    assert.equal(s.connection.project, undefined);
    assert.equal(s.connection.busy, false);
    assert.equal(
      s.state.get(['scalewayAI.preferences.v1', org].join('.')),
      undefined,
    );
  } finally {
    quota.listQuotaEvidence = old;
    s.connection.dispose();
    s.restore();
  }
});
test('quota access denial invalidates JWT; malformed data does not claim quota verified', async () => {
  const s = setup();
  const quota = require('../dist/quotas');
  const old = quota.listQuotaEvidence;
  try {
    await s.connection.login();
    quota.listQuotaEvidence = async () => {
      throw new provider.ReadError('invalid_quota_bound');
    };
    assert.equal(await s.connection.inspectQuotas(), undefined);
    assert.equal(s.connection.connected, true);
    quota.listQuotaEvidence = async () => {
      throw new provider.ReadError('access_denied');
    };
    assert.equal(await s.connection.inspectQuotas(), undefined);
    assert.equal(s.connection.connected, false);
  } finally {
    quota.listQuotaEvidence = old;
    s.connection.dispose();
    s.restore();
  }
});

test('EULA controller accepts only current known model and rejects stale logout/trust response', async () => {
  const s = setup();
  const eula = require('../dist/modelEula');
  const original = eula.getModelEula;
  let reads = 0;
  try {
    await s.connection.login();
    s.connection.dedicatedCatalog = [
      {
        id: operationModel,
        label: 'Model',
        kind: 'dedicated-catalog',
        dedicatedInfo: { hasEula: true },
      },
    ];
    eula.getModelEula = async (project, model, jwt) => {
      reads++;
      assert.equal(project.id, id);
      assert.equal(model.id, operationModel);
      assert.equal(jwt, secretKey);
      return { modelId: operationModel, content: 'Terms', accepted: false };
    };
    assert.equal(await s.connection.inspectModelEula(operationId), undefined);
    assert.equal(reads, 0);
    assert.equal(
      (await s.connection.inspectModelEula(operationModel)).accepted,
      false,
    );
    assert.equal(reads, 1);
    eula.getModelEula = async () => {
      await s.connection.disconnect();
      return { content: 'Late' };
    };
    assert.equal(
      await s.connection.inspectModelEula(operationModel),
      undefined,
    );
    assert.equal(s.connection.project, undefined);
  } finally {
    eula.getModelEula = original;
    s.connection.dispose();
    s.restore();
  }
});

test('model catalog never requests GPU price offers; hardware prices remain preparation-only', async () => {
  const s = setup();
  const old = provider.listServerless;
  let priceReads = 0;
  try {
    s.connection.ready = new Promise(() => {});
    s.connection.busy = true;
    provider.listServerless = async () => [
      { id: 'model', label: 'Model', kind: 'serverless' },
    ];
    priceProvider.listDedicatedPrices = async () => {
      priceReads++;
      return [];
    };
    await s.connection.loadPublicCatalog();
    assert.equal(priceReads, 0);
    assert.equal(s.connection.serverless.length, 1);
    assert.equal(s.logins(), 0);
  } finally {
    provider.listServerless = old;
    s.connection.dispose();
    s.restore();
  }
});

// API-key lifecycle is fully mocked: browser authentication remains JWT-only,
// while every authenticated provider read receives the user-bound SDK secret.
test('first login creates exactly one key; renewed login and restart reuse it without consent or POST', async () => {
  const s = setup();
  let restored;
  try {
    await s.connection.login();
    const stored = s.secrets.get(keySlot());
    assert.deepEqual(JSON.parse(stored), { ...s.connection.apiKey });
    assert.equal(JSON.parse(stored).userId, org);
    assert.equal(s.creations(), 1);
    s.vscode.window.showInformationMessage = async (
      _message,
      _options,
      action,
    ) => {
      assert.notEqual(
        action,
        'Créer la clé API',
        'reuse must not request key creation',
      );
      return action;
    };
    await s.connection.login();
    assert.equal(s.logins(), 2);
    assert.equal(s.creations(), 1);
    assert.equal(s.secrets.get(keySlot()), stored);
    s.connection.dispose();
    restored = s.newConnection();
    await restored.ready;
    assert.equal(restored.connected, true);
    assert.equal(await restored.ensureProject(), true);
    assert.equal(s.creations(), 1);
    assert.equal(s.logins(), 2);
    assert.equal(s.revocations(), 0);
  } finally {
    restored?.dispose();
    s.connection.dispose();
    s.restore();
  }
});

test('declining dedicated-key consent after browser login does not POST, persist session or read projects', async () => {
  const s = setup();
  try {
    s.vscode.window.showInformationMessage = async (
      _message,
      _options,
      action,
    ) => (action === 'Créer la clé API' ? undefined : action);
    await s.connection.login();
    assert.equal(s.logins(), 1);
    assert.equal(s.creations(), 0);
    assert.equal(s.requests(), 0);
    assert.equal(s.connection.connected, false);
    assert.equal(s.secrets.has(keySlot()), false);
    assert.equal(s.secrets.has('scalewayAI.userSession.v1'), false);
  } finally {
    s.connection.dispose();
    s.restore();
  }
});

test('unknown key POST leaves durable pending marker and prevents retries across logout and restart', async () => {
  const s = setup();
  let next;
  const create = sdk.createUserAPIKey;
  try {
    sdk.createUserAPIKey = async (...args) => {
      await create(...args);
      throw new sdk.SDKError('timeout');
    };
    await s.connection.login();
    assert.equal(s.creations(), 1);
    assert.deepEqual(JSON.parse(s.secrets.get(keySlot())), {
      userId: org,
      pending: true,
    });
    assert.equal(s.connection.connected, false);
    assert.equal(s.requests(), 0);
    await s.connection.disconnect();
    s.connection.dispose();
    next = s.newConnection();
    await next.ready;
    await next.login();
    assert.equal(s.creations(), 1);
    assert.equal(s.logins(), 2);
    assert.equal(s.requests(), 0);
    assert.equal(s.revocations(), 0);
    assert.ok(
      s.errors.some((message) =>
        message.includes('api_key_creation_outcome_unknown'),
      ),
    );
    assert.equal(JSON.parse(s.secrets.get(keySlot())).pending, true);
  } finally {
    next?.dispose();
    s.connection.dispose();
    s.restore();
  }
});

test('rejected key POST clears pending marker so explicit later consent may retry', async () => {
  const s = setup();
  const create = sdk.createUserAPIKey;
  try {
    sdk.createUserAPIKey = async (...args) => {
      await create(...args);
      throw new sdk.SDKError('access_denied');
    };
    await s.connection.login();
    assert.equal(s.creations(), 1);
    assert.equal(s.secrets.has(keySlot()), false);
    sdk.createUserAPIKey = create;
    await s.connection.login();
    assert.equal(s.creations(), 2);
    assert.equal(s.connection.connected, true);
  } finally {
    s.connection.dispose();
    s.restore();
  }
});

test('pair storage failure revokes newly created key and clears pending marker without plaintext fallback', async () => {
  const s = setup();
  const store = s.context.secrets.store;
  try {
    s.context.secrets.store = async (slot, value) => {
      if (slot === keySlot() && JSON.parse(value).secretKey)
        throw Error('storage unavailable');
      return store(slot, value);
    };
    await s.connection.login();
    assert.equal(s.creations(), 1);
    assert.equal(s.revocations(), 1);
    assert.equal(s.secrets.has(keySlot()), false);
    assert.equal(s.secrets.has('scalewayAI.userSession.v1'), false);
    assert.equal(s.connection.connected, false);
    assert.equal(s.requests(), 0);
    assert.ok(
      s.errors.some((message) =>
        message.includes('secret_storage_unavailable'),
      ),
    );
    assert.ok(!JSON.stringify([...s.state]).includes(secretKey));
  } finally {
    s.connection.dispose();
    s.restore();
  }
});

for (const invalidation of ['logout', 'trust', 'dispose']) {
  test(
    'late key creation after ' +
      invalidation +
      ' revokes the key with a fresh signal and cannot restore session',
    async () => {
      const s = setup();
      const create = sdk.createUserAPIKey;
      try {
        sdk.createUserAPIKey = async (...args) => {
          const pair = await create(...args);
          if (invalidation === 'logout') await s.connection.disconnect();
          else if (invalidation === 'dispose') s.connection.dispose();
          else s.vscode.workspace.isTrusted = false;
          return pair;
        };
        await s.connection.login();
        assert.equal(s.creations(), 1);
        assert.equal(s.revocations(), 1);
        assert.equal(s.secrets.has(keySlot()), false);
        assert.equal(s.secrets.has('scalewayAI.userSession.v1'), false);
        assert.equal(s.connection.connected, false);
        assert.equal(s.requests(), 0);
      } finally {
        s.connection.dispose();
        s.restore();
      }
    },
  );
}

test('unconfirmed cleanup preserves pending marker and warns rather than silently creating another key', async () => {
  const s = setup();
  const create = sdk.createUserAPIKey;
  try {
    sdk.createUserAPIKey = async (...args) => {
      const pair = await create(...args);
      s.vscode.workspace.isTrusted = false;
      return pair;
    };
    sdk.revokeUserAPIKey = async () => {
      throw new sdk.SDKError('timeout');
    };
    await s.connection.login();
    assert.equal(JSON.parse(s.secrets.get(keySlot())).pending, true);
    assert.equal(s.warnings.length, 1);
    s.vscode.workspace.isTrusted = true;
    await s.connection.login();
    assert.equal(s.creations(), 1);
    assert.equal(s.requests(), 0);
  } finally {
    s.connection.dispose();
    s.restore();
  }
});

test('explicit revoke requires consent then revokes remotely, deletes pair and disconnects', async () => {
  const s = setup();
  try {
    await s.connection.login();
    s.vscode.window.showInformationMessage = async () => undefined;
    await s.connection.revokeAPIKey();
    assert.equal(s.revocations(), 0);
    assert.equal(s.connection.connected, true);
    s.vscode.window.showInformationMessage = async (
      _message,
      _options,
      action,
    ) => action;
    await s.connection.revokeAPIKey();
    assert.equal(s.revocations(), 1);
    assert.equal(s.secrets.size, 0);
    assert.equal(s.connection.connected, false);
    assert.equal(s.connection.project, undefined);
    assert.equal(s.state.has(`scalewayAI.preferences.v1.${org}`), false);
    await s.connection.revokeAPIKey();
    assert.equal(s.revocations(), 1);
  } finally {
    s.connection.dispose();
    s.restore();
  }
});

test('key is user-bound in SecretStorage and never leaks into preferences or metadata', async () => {
  const s = setup();
  let next;
  try {
    await s.connection.login();
    for (const value of [
      JSON.stringify([...s.state]),
      JSON.stringify(s.connection.metadata),
      JSON.stringify(s.connection.project),
    ]) {
      assert.ok(!value.includes(token));
      assert.ok(!value.includes(secretKey));
      assert.ok(!value.includes(accessKey));
    }
    assert.ok(s.secretReads.includes(keySlot()));
    assert.ok(!s.secretReads.includes('scalewayAI.apiKey.v1'));
    s.connection.dispose();
    s.secrets.set(keySlot(), JSON.stringify({ ...fakePair(), userId: id }));
    s.secrets.set(keySlot(id), JSON.stringify({ ...fakePair(), userId: org }));
    next = s.newConnection();
    await next.ready;
    assert.equal(
      next.connected,
      false,
      'cross-user key must never authorize reads',
    );
    assert.equal(s.requests(), 1);
    s.vscode.window.showInformationMessage = async (
      _message,
      _options,
      action,
    ) => (action === 'Créer la clé API' ? undefined : action);
    assert.equal(await next.ensureProject(), false);
    assert.equal(s.creations(), 1);
    assert.equal(s.requests(), 1);
    assert.ok(
      !s.secretReads.includes(keySlot(id)),
      'never search another user slot',
    );
  } finally {
    next?.dispose();
    s.connection.dispose();
    s.restore();
  }
});

test('legacy persisted JWT without SDK pair requires explicit bootstrap before any provider read', async () => {
  const s = setup();
  let next;
  try {
    await s.connection.ready;
    s.secrets.set(
      'scalewayAI.userSession.v1',
      JSON.stringify({ token, userId: org, expiresAt: Date.now() + 3600000 }),
    );
    s.state.set(`scalewayAI.preferences.v1.${org}`, {
      organizationId: org,
      project: { id, name: 'Project', organizationId: org },
    });
    next = s.newConnection();
    await next.ready;
    assert.equal(next.connected, false);
    assert.equal(s.requests(), 0);
    assert.equal(s.creations(), 0);
    assert.equal(await next.ensureProject(), true);
    assert.equal(s.creations(), 1);
    assert.equal(s.logins(), 1);
    assert.equal(next.connected, true);
    assert.equal(next.project.id, id);
    assert.equal(
      s.requests(),
      0,
      'saved valid project needs no HTTP selection read',
    );
  } finally {
    next?.dispose();
    s.connection.dispose();
    s.restore();
  }
});

test('JWT expiry deletes only session; restart reuses saved pair without browser', async () => {
  const s = setup();
  let next;
  try {
    await s.connection.login();
    const stored = s.secrets.get(keySlot());
    s.connection.session.expiresAt = Date.now() - 1;
    const before = s.requests();
    await s.connection.loadModels();
    await s.connection.storage;
    assert.equal(s.connection.connected, true);
    assert.equal(s.connection.keyValidated, false);
    assert.equal(s.secrets.has('scalewayAI.userSession.v1'), false);
    assert.equal(s.secrets.get(keySlot()), stored);
    s.connection.dispose();
    next = s.newConnection();
    await next.ready;
    assert.equal(next.connected, true);
    const oldInspect = sdk.inspectExistingUserAPIKey;
    sdk.inspectExistingUserAPIKey = async () => JSON.parse(stored);
    try {
      assert.equal(await next.ensureProject(), true);
    } finally {
      sdk.inspectExistingUserAPIKey = oldInspect;
    }
    assert.equal(s.creations(), 1);
    assert.equal(s.logins(), 1);
    assert.equal(s.requests(), before);
    assert.equal(s.secrets.get(keySlot()), stored);
  } finally {
    next?.dispose();
    s.connection.dispose();
    s.restore();
  }
});

test('expired saved pair cannot authorize SDK reads and requires newly consented bootstrap', async () => {
  const s = setup();
  let next;
  try {
    await s.connection.login();
    s.connection.dispose();
    s.secrets.set(
      keySlot(),
      JSON.stringify({ ...fakePair(), userId: org, expiresAt: Date.now() - 1 }),
    );
    next = s.newConnection();
    await next.ready;
    assert.equal(next.connected, false);
    assert.equal(s.requests(), 1);
    assert.equal(await next.ensureProject(), true);
    assert.equal(s.creations(), 2);
    assert.equal(JSON.parse(s.secrets.get(keySlot())).secretKey, secretKey);
    assert.ok(JSON.parse(s.secrets.get(keySlot())).expiresAt > Date.now());
    assert.equal(s.requests(), 1);
  } finally {
    next?.dispose();
    s.connection.dispose();
    s.restore();
  }
});

for (const invalidation of ['logout', 'trust']) {
  test(
    'late completed pair write after ' +
      invalidation +
      ' is revoked and removed',
    async () => {
      const s = setup();
      const store = s.context.secrets.store;
      let entered, release;
      const started = new Promise((resolve) => {
        entered = resolve;
      });
      const blocked = new Promise((resolve) => {
        release = resolve;
      });
      try {
        s.context.secrets.store = async (slot, value) => {
          if (slot === keySlot() && JSON.parse(value).secretKey) {
            entered();
            await blocked;
          }
          return store(slot, value);
        };
        const login = s.connection.login();
        await started;
        const logout =
          invalidation === 'logout'
            ? s.connection.disconnect()
            : Promise.resolve();
        if (invalidation === 'trust') s.vscode.workspace.isTrusted = false;
        release();
        await Promise.all([login, logout]);
        assert.equal(s.creations(), 1);
        assert.equal(s.revocations(), 1);
        assert.equal(s.secrets.has(keySlot()), false);
        assert.equal(s.secrets.has('scalewayAI.userSession.v1'), false);
        assert.equal(s.connection.connected, false);
        assert.equal(s.requests(), 0);
      } finally {
        release();
        s.connection.dispose();
        s.restore();
      }
    },
  );
}

test('failed explicit revocation retains locally stored pair and reports failure without retry', async () => {
  const s = setup();
  const revoke = sdk.revokeUserAPIKey;
  try {
    await s.connection.login();
    const stored = s.secrets.get(keySlot());
    sdk.revokeUserAPIKey = async (...args) => {
      await revoke(...args);
      throw new sdk.SDKError('timeout');
    };
    await s.connection.revokeAPIKey();
    assert.equal(s.revocations(), 1);
    assert.equal(s.secrets.get(keySlot()), stored);
    assert.equal(s.connection.connected, true);
    assert.equal(s.connection.busy, false);
    assert.ok(s.errors.some((message) => message.includes('timeout')));
  } finally {
    s.connection.dispose();
    s.restore();
  }
});

test('session storage failure leaves saved SDK pair reusable, no session or provider reads', async () => {
  const s = setup();
  const store = s.context.secrets.store;
  try {
    s.context.secrets.store = async (slot, value) => {
      if (slot === 'scalewayAI.userSession.v1')
        throw Error('JWT storage unavailable');
      return store(slot, value);
    };
    await s.connection.login();
    assert.equal(s.creations(), 1);
    assert.equal(s.revocations(), 0);
    assert.equal(s.connection.connected, false);
    assert.equal(s.secrets.has('scalewayAI.userSession.v1'), false);
    assert.equal(JSON.parse(s.secrets.get(keySlot())).secretKey, secretKey);
    assert.equal(s.requests(), 0);
    assert.ok(
      s.errors.some((message) =>
        message.includes('secret_storage_unavailable'),
      ),
    );
    s.context.secrets.store = store;
    await s.connection.login();
    assert.equal(
      s.creations(),
      1,
      'recover saved pair rather than creating another remote key',
    );
    assert.equal(s.connection.connected, true);
  } finally {
    s.connection.dispose();
    s.restore();
  }
});

test('shared credential bootstrap is serialized across connection instances', async () => {
  const s = setup();
  let next;
  let entered, release;
  const started = new Promise((r) => {
    entered = r;
  });
  const blocked = new Promise((r) => {
    release = r;
  });
  const create = sdk.createUserAPIKey;
  try {
    next = s.newConnection();
    sdk.createUserAPIKey = async (...args) => {
      entered();
      await blocked;
      return create(...args);
    };
    const first = s.connection.login();
    await started;
    await next.login();
    assert.equal(next.connected, false);
    assert.ok(s.errors.some((m) => m.includes('api_key_bootstrap_busy')));
    release();
    await first;
    assert.equal(s.creations(), 1);
    await next.login();
    assert.equal(next.connected, true);
    assert.equal(s.creations(), 1);
  } finally {
    release();
    next?.dispose();
    s.connection.dispose();
    s.restore();
  }
});

test('logout after bootstrap during legacy migration revokes accepted key', async () => {
  const s = setup();
  let entered, release;
  const started = new Promise((r) => {
    entered = r;
  });
  const blocked = new Promise((r) => {
    release = r;
  });
  const remove = s.context.secrets.delete;
  try {
    s.context.secrets.delete = async (slot) => {
      if (slot === 'scalewayAI.apiKey.v1') {
        entered();
        await blocked;
      }
      return remove(slot);
    };
    const login = s.connection.login();
    await started;
    const logout = s.connection.disconnect();
    release();
    await Promise.all([login, logout]);
    assert.equal(s.creations(), 1);
    assert.equal(s.revocations(), 1);
    assert.equal(s.secrets.has(keySlot()), false);
    assert.equal(s.connection.connected, false);
  } finally {
    release();
    s.connection.dispose();
    s.restore();
  }
});

test('filesystem bootstrap lock is exclusive and released without storing credentials', async () => {
  const fs = require('node:fs/promises');
  const os = require('node:os');
  const path = require('node:path');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scw-key-lock-'));
  const s = setup();
  s.context.globalStorageUri = { fsPath: root };
  try {
    await fs.mkdir(path.join(root, `api-key-bootstrap-${org}.lock`));
    await s.connection.login();
    assert.equal(s.creations(), 0);
    assert.ok(s.errors.some((m) => m.includes('api_key_bootstrap_locked')));
    await fs.rmdir(path.join(root, `api-key-bootstrap-${org}.lock`));
    await s.connection.login();
    assert.equal(s.creations(), 1);
    assert.deepEqual(await fs.readdir(root), []);
  } finally {
    s.connection.dispose();
    s.restore();
    await fs.rm(root, { recursive: true, force: true });
  }
});

// End-to-end controller flows: no real discovery, review, creation or polling.
const flowModelId = '44444444-4444-4444-4444-444444444444';
const flowDeploymentId = '55555555-5555-5555-5555-555555555555';
const flowOtherProject = '66666666-6666-6666-6666-666666666666';
const flowJournalKey = `scalewayAI.deploymentOperations.v1.${org}.${org}.${id}`;
function mockDeploymentFlow(s, { hasEula = false } = {}) {
  const eulaProvider = require('../dist/modelEula');
  const saved = [
    [provider, 'listServerless'],
    [provider, 'listDedicatedCatalog'],
    [provider, 'listNodeTypes'],
    [provider, 'getDeployment'],
    [priceProvider, 'listDedicatedPrices'],
    [eulaProvider, 'getModelEula'],
    [s.deployService, 'reviewService'],
    [s.deployService, 'createService'],
  ].map(([target, key]) => [target, key, target[key]]);
  const steps = [];
  let posts = 0,
    gets = 0;
  const model = {
    id: flowModelId,
    label: 'Flow model',
    kind: 'dedicated-catalog',
    dedicatedInfo: { hasEula, status: 'ready', supportedNodes: [] },
  };
  const nodes = [{ name: 'H100', region: 'fr-par' }];
  const prices = [{ nodeType: 'H100', currency: 'EUR' }];
  const eula = { modelId: flowModelId, text: 'Synthetic license' };
  const accepted = {
    id: flowDeploymentId,
    label: 'flow-service',
    kind: 'dedicated',
    status: 'creating',
    deploymentInfo: {
      modelId: flowModelId,
      projectId: id,
      region: 'fr-par',
      endpoints: [],
      fetchedAt: new Date().toISOString(),
    },
  };
  const receipt = {
    body: { name: accepted.label, model_id: flowModelId, project_id: id },
  };
  provider.listServerless = async () => [];
  provider.listDedicatedCatalog = async (project, key, signal) => {
    assert.equal(project.id, id);
    assert.equal(key, secretKey);
    assert.equal(signal.aborted, false);
    steps.push('catalog');
    return [model];
  };
  provider.listNodeTypes = async (key, signal) => {
    assert.equal(key, secretKey);
    assert.equal(signal.aborted, false);
    steps.push('nodes');
    return nodes;
  };
  priceProvider.listDedicatedPrices = async () => {
    steps.push('prices');
    return prices;
  };
  eulaProvider.getModelEula = async (project, selected, key, signal) => {
    assert.equal(project.id, id);
    assert.equal(selected, model);
    assert.equal(key, secretKey);
    assert.equal(signal.aborted, false);
    steps.push('eula');
    return eula;
  };
  s.deployService.reviewService = async (
    project,
    selected,
    hardware,
    tariffs,
    license,
    current,
  ) => {
    assert.equal(project.id, id);
    assert.equal(selected, model);
    assert.equal(hardware, nodes);
    assert.equal(tariffs, prices);
    assert.equal(license, hasEula ? eula : undefined);
    assert.equal(current(), true);
    steps.push('review');
    return receipt;
  };
  s.deployService.createService = async (approved, key, signal) => {
    posts++;
    assert.equal(approved, receipt);
    assert.equal(key, secretKey);
    assert.equal(signal.aborted, false);
    const operations = s.state.get(flowJournalKey);
    assert.equal(operations.length, 1);
    assert.equal(
      operations[0].status,
      'submitting',
      'durable write-ahead precedes POST',
    );
    assert.equal(operations[0].modelId, flowModelId);
    assert.equal(operations[0].name, accepted.label);
    steps.push('post');
    return accepted;
  };
  provider.getDeployment = async (project, resourceId, key, signal) => {
    gets++;
    assert.equal(project.id, id);
    assert.equal(resourceId, flowDeploymentId);
    assert.equal(key, secretKey);
    assert.equal(signal.aborted, false);
    assert.equal(
      s.connection.dedicated[0].status,
      'creating',
      'accepted resource visible before follow',
    );
    assert.equal(s.state.get(flowJournalKey)[0].status, 'accepted');
    steps.push('get');
    return { ...accepted, status: 'ready' };
  };
  return {
    steps,
    accepted,
    posts: () => posts,
    gets: () => gets,
    restore: () => {
      for (const [target, key, value] of saved) target[key] = value;
    },
  };
}

test('serverless Use from logged-out public catalogue must retain the selected offer across login', async () => {
  const s = setup({ workspace: true });
  const list = provider.listServerless;
  try {
    provider.listServerless = async () => [
      { id: 'public-model', label: 'Public model', kind: 'serverless' },
    ];
    await s.connection.loadPublicCatalog();
    assert.equal(s.logins(), 0);
    assert.deepEqual(s.connection.serverlessResources, []);
    const selected = await s.connection.useServerless('public-model');
    assert.equal(
      selected?.id,
      'public-model',
      'login must not discard the selected public offer',
    );
  } finally {
    provider.listServerless = list;
    s.connection.dispose();
    s.restore();
  }
});

test('legacy serverless favourites never restore as IAM-bound resources', async () => {
  const s = setup({ workspace: true });
  const list = provider.listServerless;
  let restarted;
  const favourite = {
    id: 'public-model',
    label: 'Public model',
    kind: 'serverless',
  };
  const key = `scalewayAI.serverlessResources.v1.${org}.${org}.${id}`;
  try {
    provider.listServerless = async () => [favourite];
    await s.connection.login();
    s.workspaceValues.set(key, [favourite]);
    s.state.set(key, [favourite]);
    s.connection.dispose();
    restarted = s.newConnection();
    await restarted.ready;
    assert.deepEqual(restarted.serverlessResources, []);
    await restarted.loadPublicCatalog();
    await restarted.refreshServerlessAvailability();
    assert.equal(restarted.serverless.length, 1);
    assert.deepEqual(restarted.serverlessResources, []);
    assert.equal(s.accessCalls.length, 0);
    assert.equal(s.availabilityCalls.length, 0);
    assert.deepEqual(s.workspaceValues.get(key), [favourite]);
    assert.equal(
      [...s.secrets.keys()].some((key) =>
        key.startsWith('scalewayAI.llmAccess.secret.'),
      ),
      false,
    );
  } finally {
    provider.listServerless = list;
    restarted?.dispose();
    s.connection.dispose();
    s.restore();
  }
});

test('configured registry refresh requires fresh IAM and model proof; project, organization and user changes cannot leak access', async () => {
  const s = setup({ workspace: true });
  const list = provider.listServerless;
  let restarted, otherUser;
  try {
    provider.listServerless = async () => [
      { id: 'public-model', label: 'Public model', kind: 'serverless' },
    ];
    await s.connection.login();
    await s.connection.loadPublicCatalog();
    const first = await s.connection.useServerless('public-model');
    assert.equal(first.id, 'public-model');
    assert.equal(first.llmAccess.bearerType, 'user');
    assert.equal(s.planCalls[0].userId, org);
    assert.equal(s.creations(), 1, 'only the user-bound login key was created');
    assert.equal(JSON.parse(s.secrets.get(keySlot())).userId, org);
    await s.connection.useServerless('public-model');
    assert.equal(s.connection.serverlessResources.length, 1);
    const registryKey = [...s.state.keys()].find((key) =>
      /^scalewayAI\.llmAccess\.v1\.[a-f0-9]{64}$/.test(key),
    );
    assert.ok(registryKey);
    assert.equal(s.state.get(registryKey).length, 1);
    assert.equal(s.workspaceValues.size, 0);
    s.connection.dispose();
    restarted = s.newConnection();
    await restarted.ready;
    assert.deepEqual(
      restarted.serverlessResources,
      [],
      'persisted binding is not fresh proof',
    );
    await restarted.loadPublicCatalog();
    const checks = s.accessCalls.length;
    await restarted.refreshServerlessAvailability();
    assert.equal(s.accessCalls.length, checks + 1);
    assert.equal(s.availabilityCalls.length, s.accessCalls.length);
    assert.equal(
      restarted.serverlessResources[0].llmAccess.id,
      s.state.get(registryKey)[0],
    );
    provider.listProjects = async () => [
      { id: flowOtherProject, organizationId: org, name: 'Other project' },
    ];
    await restarted.switchProject();
    await restarted.refreshServerlessAvailability();
    assert.equal(restarted.project.id, flowOtherProject);
    assert.deepEqual(restarted.serverlessResources, []);
    const otherOrg = '88888888-8888-8888-8888-888888888888';
    provider.listOrganizations = async () => [
      { id: otherOrg, name: 'Other organization', locked: false },
    ];
    provider.listProjects = async () => [
      { id, organizationId: otherOrg, name: 'Project' },
    ];
    await restarted.switchProject();
    await restarted.refreshServerlessAvailability();
    assert.equal(restarted.project.organizationId, otherOrg);
    assert.deepEqual(restarted.serverlessResources, []);
    provider.listOrganizations = async () => [
      { id: org, name: 'Organization', locked: false },
    ];
    provider.listProjects = async () => [
      { id, organizationId: org, name: 'Project' },
    ];
    await restarted.switchProject();
    await restarted.loadPublicCatalog();
    await restarted.refreshServerlessAvailability();
    assert.equal(restarted.serverlessResources.length, 1);
    restarted.dispose();
    const user = '77777777-7777-7777-7777-777777777777';
    s.secrets.set(
      'scalewayAI.userSession.v1',
      JSON.stringify({ token, userId: user, expiresAt: Date.now() + 3600000 }),
    );
    s.secrets.set(
      keySlot(user),
      JSON.stringify({ ...fakePair(), userId: user }),
    );
    const pref = [...s.state.keys()].find(
      (slot) => slot.includes(org) && slot.includes('preference'),
    );
    assert.ok(pref);
    s.state.set(pref.replace(org, user), {
      organizationId: org,
      project: { id, organizationId: org, name: 'Project' },
    });
    otherUser = s.newConnection();
    await otherUser.ready;
    await otherUser.refreshServerlessAvailability();
    assert.equal(otherUser.project.id, id);
    assert.deepEqual(otherUser.serverlessResources, []);
    assert.equal(
      s.state.get(registryKey).length,
      1,
      'foreign scopes cannot overwrite the original binding',
    );
  } finally {
    provider.listServerless = list;
    otherUser?.dispose();
    restarted?.dispose();
    s.connection.dispose();
    s.restore();
  }
});

test('selected application access uses its bound secret while authentication and control credentials stay user-owned', async () => {
  const s = setup();
  const list = provider.listServerless;
  const appId = '99999999-9999-9999-9999-999999999999';
  const appAccessKey = 'SCW98765432109876543';
  const appSecretKey = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  let copied, inference;
  try {
    provider.listServerless = async () => [
      { id: 'public-model', label: 'Public model', kind: 'serverless' },
    ];
    await s.connection.login();
    await s.connection.loadPublicCatalog();
    s.accessIam.listAccessApplications = async (
      organizationId,
      credential,
      signal,
    ) => {
      assert.equal(organizationId, org);
      assert.equal(
        credential,
        token,
        'IAM control remains the authenticated user JWT',
      );
      assert.equal(signal.aborted, false);
      return [{ id: appId, name: 'Local test application' }];
    };
    s.accessWizard.chooseAccessPlan = async (scope) => {
      assert.equal(scope.userId, org);
      assert.deepEqual(await scope.applications(), [
        { id: appId, name: 'Local test application' },
      ]);
      return {
        type: 'create',
        bearer: { type: 'application', id: appId },
        description: 'Local application fixture',
        lifetimeMs: 3600000,
      };
    };
    let creates = 0;
    s.accessIam.createAccessAPIKey = async (
      organizationId,
      bearer,
      credential,
      description,
      lifetimeMs,
      signal,
    ) => {
      creates++;
      assert.equal(organizationId, org);
      assert.deepEqual(bearer, { type: 'application', id: appId });
      assert.equal(credential, token);
      assert.equal(description, 'Local application fixture');
      assert.equal(lifetimeMs, 3600000);
      assert.equal(signal.aborted, false);
      assert.equal(
        [...s.secrets.keys()].filter((key) => key.endsWith('.pending')).length,
        1,
      );
      return { accessKey: appAccessKey, secretKey: appSecretKey };
    };
    s.accessIam.inspectAccessAPIKey = async (
      organizationId,
      key,
      secret,
      signal,
    ) => {
      assert.equal(organizationId, org);
      assert.equal(key, appAccessKey);
      assert.equal(secret, appSecretKey);
      assert.equal(signal.aborted, false);
      return {
        accessKey: key,
        bearer: { type: 'application', id: appId },
        organizationId,
        description: 'Local application fixture',
        expiresAt: Date.now() + 3600000,
      };
    };
    provider.listServerlessAvailability = async (secret, signal) => {
      assert.equal(secret, appSecretKey);
      assert.equal(signal.aborted, false);
      return [{ id: 'public-model' }];
    };
    const row = await s.connection.useServerless('public-model');
    assert.equal(row.llmAccess.bearerType, 'application');
    assert.equal(creates, 1);
    assert.equal(s.creations(), 1, 'login API key remains user-owned');
    assert.equal(JSON.parse(s.secrets.get(keySlot())).secretKey, secretKey);
    assert.equal(JSON.parse(s.secrets.get(keySlot())).userId, org);
    assert.equal(
      [...s.secrets.keys()].some((key) => key.endsWith('.pending')),
      false,
    );
    assert.equal(JSON.stringify(row).includes(appSecretKey), false);
    assert.equal(JSON.stringify(row).includes(appAccessKey), false);
    assert.equal(JSON.stringify(row).includes(appId), false);
    const control = s.connection.inferenceScope();
    assert.equal(
      control.authorize(),
      secretKey,
      'control operations keep the login key',
    );
    control.dispose();
    copied = await s.connection.modelCredentialScope(id, row);
    assert.equal(copied.secretKey(), appSecretKey);
    assert.equal(copied.current(), true);
    inference = await s.connection.modelInferenceScope(row);
    assert.equal(inference.authorize(), appSecretKey);
    assert.equal(inference.current(), true);
    await s.connection.disconnect();
    assert.equal(copied.current(), false);
    assert.equal(inference.current(), false);
    assert.throws(() => copied.secretKey());
    assert.throws(() => inference.authorize());
  } finally {
    copied?.dispose();
    inference?.dispose();
    provider.listServerless = list;
    s.connection.dispose();
    s.restore();
  }
});

test('deployModel persists write-ahead before POST, records accepted resources and automatically follows ready', async () => {
  const s = setup();
  const flow = mockDeploymentFlow(s, { hasEula: true });
  const writes = [],
    update = s.context.globalState.update;
  s.context.globalState.update = async (key, value) => {
    if (key === flowJournalKey) writes.push(value.map((row) => row.status));
    return update(key, value);
  };
  try {
    const result = await s.connection.deployModel(flowModelId);
    assert.equal(result?.status, 'ready');
    assert.equal(flow.posts(), 1);
    assert.equal(flow.gets(), 1);
    assert.deepEqual(flow.steps, [
      'catalog',
      'nodes',
      'prices',
      'eula',
      'review',
      'post',
      'get',
    ]);
    assert.deepEqual(writes, [['prepared'], ['submitting'], ['accepted']]);
    assert.equal(
      (await s.connection.deploymentOperations())[0].deploymentId,
      flowDeploymentId,
    );
    assert.equal(s.connection.dedicated.length, 1);
    assert.equal(s.connection.busy, false);
    assert.equal(s.connection.followingDeployment, false);
    assert.match(s.connection.dedicatedState, /non sondé/);
    assert.ok(!JSON.stringify([...s.state]).includes(secretKey));
  } finally {
    flow.restore();
    s.connection.dispose();
    s.restore();
  }
});

test('deployModel reuses only the exact existing model without review, hardware discovery or POST', async () => {
  const s = setup();
  const flow = mockDeploymentFlow(s);
  try {
    provider.listDedicated = async () => [
      {
        ...flow.accepted,
        id: org,
        deploymentInfo: { modelId: flowOtherProject },
      },
      flow.accepted,
    ];
    assert.equal(await s.connection.deployModel(flowModelId), flow.accepted);
    assert.deepEqual(flow.steps, []);
    assert.equal(flow.posts(), 0);
    assert.equal(flow.gets(), 0);
    assert.equal(s.state.has(flowJournalKey), false);
  } finally {
    flow.restore();
    s.connection.dispose();
    s.restore();
  }
});

test('deployModel declined review never creates journal entry or sends POST', async () => {
  const s = setup();
  const flow = mockDeploymentFlow(s);
  s.deployService.reviewService = async () => undefined;
  try {
    assert.equal(await s.connection.deployModel(flowModelId), undefined);
    assert.equal(flow.posts(), 0);
    assert.equal(flow.gets(), 0);
    assert.equal(s.state.has(flowJournalKey), false);
    assert.equal(s.connection.busy, false);
  } finally {
    flow.restore();
    s.connection.dispose();
    s.restore();
  }
});

test('deployModel unknown creation outcome blocks repetition including after restart', async () => {
  const s = setup();
  const flow = mockDeploymentFlow(s);
  const create = s.deployService.createService;
  let restarted;
  s.deployService.createService = async (...args) => {
    await create(...args);
    throw new provider.ReadError('timeout');
  };
  try {
    assert.equal(await s.connection.deployModel(flowModelId), undefined);
    assert.equal(s.state.get(flowJournalKey)[0].status, 'unknown');
    await s.connection.deployModel(flowModelId);
    assert.equal(flow.posts(), 1);
    s.connection.dispose();
    restarted = s.newConnection();
    await restarted.ready;
    await restarted.deployModel(flowModelId);
    assert.equal(flow.posts(), 1);
    assert.equal(flow.gets(), 0);
    assert.equal(s.state.get(flowJournalKey).length, 1);
    assert.ok(
      s.warnings.some((message) => message.includes('aucun retry automatique')),
    );
  } finally {
    restarted?.dispose();
    flow.restore();
    s.connection.dispose();
    s.restore();
  }
});

for (const invalidate of ['logout', 'trust']) {
  test(
    'deployModel late acceptance after ' +
      invalidate +
      ' stays in original journal without resurrecting resources',
    async () => {
      const s = setup();
      const flow = mockDeploymentFlow(s);
      const create = s.deployService.createService;
      let entered, release;
      const started = new Promise((resolve) => {
        entered = resolve;
      });
      const blocked = new Promise((resolve) => {
        release = resolve;
      });
      s.deployService.createService = async (...args) => {
        const accepted = await create(...args);
        entered();
        await blocked;
        return accepted;
      };
      try {
        const deployment = s.connection.deployModel(flowModelId);
        await started;
        assert.equal(s.state.get(flowJournalKey)[0].status, 'submitting');
        if (invalidate === 'logout') await s.connection.disconnect();
        else s.vscode.workspace.isTrusted = false;
        release();
        assert.equal(await deployment, undefined);
        assert.equal(flow.posts(), 1);
        assert.equal(flow.gets(), 0);
        assert.deepEqual(s.connection.dedicated, []);
        assert.equal(s.connection.busy, false);
        const operations = s.state.get(flowJournalKey);
        assert.equal(operations.length, 1);
        assert.equal(operations[0].status, 'accepted');
        assert.equal(operations[0].deploymentId, flowDeploymentId);
        if (invalidate === 'logout') {
          assert.equal(s.connection.connected, false);
          assert.equal(s.connection.project, undefined);
          assert.equal(s.secrets.has('scalewayAI.userSession.v1'), false);
        }
      } finally {
        release();
        flow.restore();
        s.connection.dispose();
        s.restore();
      }
    },
  );
}

test('allocation rechecks stale inventory inside shared project lock and never posts a duplicate', async () => {
  const s = setup();
  const flow = mockDeploymentFlow(s);
  let lists = 0;
  try {
    provider.listDedicated = async () => (++lists === 1 ? [] : [flow.accepted]);
    const result = await s.connection.deployModel(flowModelId);
    assert.equal(result.id, flowDeploymentId);
    assert.equal(lists, 2);
    assert.equal(flow.posts(), 0);
  } finally {
    flow.restore();
    s.connection.dispose();
    s.restore();
  }
});

test('shared allocation marker blocks a different host journal from retrying an unknown POST', async () => {
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const os = require('node:os');
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'scw-allocation-marker-'),
  );
  const s = setup();
  const flow = mockDeploymentFlow(s);
  s.context.globalStorageUri = { fsPath: root };
  try {
    await fs.writeFile(
      path.join(root, `allocation-${id}-${flowModelId}.json`),
      JSON.stringify({
        version: 1,
        id: flowDeploymentId,
        projectId: id,
        organizationId: org,
        modelId: flowModelId,
        name: 'previous',
        region: 'fr-par',
        status: 'unknown',
      }),
    );
    await s.connection.deployModel(flowModelId);
    assert.equal(flow.posts(), 0);
    assert.ok(
      s.warnings.some((message) =>
        message.includes('Résultat de création inconnu'),
      ),
    );
    assert.equal(s.state.has(flowJournalKey), false);
  } finally {
    flow.restore();
    s.connection.dispose();
    s.restore();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('inference scope authorizes only host key and aborts on project/logout/trust/dispose', async () => {
  for (const reason of ['project', 'logout', 'trust', 'dispose']) {
    const s = setup();
    try {
      await s.connection.ensureProject();
      const reads = s.requests();
      const scope = s.connection.inferenceScope();
      assert.equal(s.requests(), reads);
      assert.equal(scope.authorize(), secretKey);
      assert.ok(scope.current());
      if (reason === 'project') await s.connection.switchProject();
      if (reason === 'logout') await s.connection.disconnect();
      if (reason === 'dispose') s.connection.dispose();
      if (reason === 'trust') {
        s.vscode.workspace.isTrusted = false;
        assert.equal(scope.current(), false);
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      assert.equal(scope.current(), false);
      assert.ok(scope.signal.aborted);
      assert.throws(() => scope.authorize(), /invalid_scope/);
      scope.dispose();
    } finally {
      s.connection.dispose();
      s.restore();
    }
  }
});

test('Use preserves prices and capabilities with opaque secret-reference persistence; restart requires verified registry refresh', async () => {
  const s = setup({ workspace: true });
  const list = provider.listServerless;
  let restarted;
  const offered = {
    id: 'fixture-chat-never-live-tested',
    label: 'Configurable text model',
    kind: 'serverless',
    status: 'preview',
    serverlessPrices: [
      {
        sku: 'in',
        amountEUR: '0.15',
        unit: 'token',
        size: 1000000,
        tokenType: 'input_token',
        consumptionMode: 'realtime',
      },
      {
        sku: 'out',
        amountEUR: '0.35',
        unit: 'token',
        size: 1000000,
        tokenType: 'output_token',
        consumptionMode: 'realtime',
      },
    ],
    serverlessCapabilities: {
      tasks: ['chat'],
      supportedApis: ['/v1/chat/completions'],
      textChat: 'supported',
      source: 'public-catalog',
    },
  };
  try {
    provider.listServerless = async () => [offered];
    await s.connection.loadPublicCatalog();
    await s.connection.ensureProject();
    await s.connection.loadPublicCatalog();
    const row = await s.connection.useServerless(offered.id);
    assert.deepEqual(row.serverlessPrices, offered.serverlessPrices);
    assert.deepEqual(
      row.serverlessCapabilities,
      offered.serverlessCapabilities,
    );
    assert.deepEqual(s.connection.serverlessResources[0], row);
    await s.connection.useServerless(offered.id);
    const registryKey = [...s.state.keys()].find((key) =>
      /^scalewayAI\.llmAccess\.v1\.[a-f0-9]{64}$/.test(key),
    );
    const saved = s.state.get(registryKey);
    assert.equal(saved.length, 1);
    assert.match(saved[0], /^[a-f0-9]{32}$/);
    const record = JSON.parse(
      s.secrets.get(`scalewayAI.llmAccess.secret.v1.${saved[0]}`),
    );
    assert.equal(record.id, saved[0]);
    assert.equal(record.version, 2);
    assert.equal(record.modelId, undefined);
    assert.equal(record.ownerId, org);
    assert.equal(record.organizationId, org);
    assert.equal(record.projectId, id);
    assert.equal(record.secretKey, secretKey);
    assert.ok(record.metadata.expiresAt > Date.now());
    assert.equal(s.workspaceValues.size, 0);
    assert.equal(JSON.stringify([...s.state]).includes(secretKey), false);
    assert.equal(JSON.stringify([...s.state]).includes(accessKey), false);
    const { ServicePlayground } = require('../dist/servicePlayground');
    const calls = [];
    const scope = await s.connection.modelInferenceScope(
      s.connection.serverlessResources[0],
    );
    const controller = new ServicePlayground(
      row,
      scope,
      () => {},
      async (input, delta, usage) => {
        calls.push(input);
        delta('answer');
        usage({ inputTokens: 6, outputTokens: 22, totalTokens: 28 });
      },
    );
    await controller.receive({ type: 'ready' });
    assert.equal(calls.length, 0);
    await controller.receive({ type: 'run', prompt: 'hello', maxTokens: 128 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].modelId, offered.id);
    assert.equal(calls[0].secretKey, secretKey);
    assert.equal(controller.state.output, 'answer');
    assert.match(controller.state.cost, /0.000008600/);
    controller.dispose();
    s.connection.dispose();
    restarted = s.newConnection();
    await restarted.ready;
    assert.deepEqual(restarted.serverlessResources, []);
    await restarted.loadPublicCatalog();
    assert.deepEqual(restarted.serverlessResources, []);
    await restarted.refreshServerlessAvailability();
    assert.deepEqual(
      restarted.serverlessResources[0].serverlessPrices,
      offered.serverlessPrices,
    );
    assert.deepEqual(
      restarted.serverlessResources[0].serverlessCapabilities,
      offered.serverlessCapabilities,
    );
    provider.listServerless = async () => [
      {
        ...offered,
        serverlessCapabilities: {
          ...offered.serverlessCapabilities,
          textChat: 'unsupported',
          tasks: ['embeddings'],
        },
      },
    ];
    await restarted.loadPublicCatalog();
    assert.equal(
      restarted.serverlessResources[0].serverlessCapabilities.textChat,
      'unsupported',
    );
  } finally {
    restarted?.dispose();
    s.connection.dispose();
    provider.listServerless = list;
    s.restore();
  }
});
test('API key inventory reads IAM only, hides secrets and preserves expired organization keys', async () => {
  const s = setup();
  const iam = require('../dist/llmAccessIam');
  const old = iam.listAccessAPIKeys;
  const sends = [];
  try {
    await s.connection.ensureProject();
    iam.listAccessAPIKeys = async (organization, credential, signal) => {
      sends.push({ organization, credential });
      assert.equal(signal.aborted, false);
      return [
        {
          accessKey,
          organizationId: org,
          bearer: { type: 'user', id: org },
          description: 'Inventory fixture',
          expiresAt: Date.now() - 1000,
        },
      ];
    };
    await s.connection.refreshAPIKeys(true);
    assert.equal(sends.length, 1);
    assert.equal(sends[0].organization, org);
    assert.equal(s.connection.apiKeys.length, 1);
    assert.equal(s.connection.apiKeys[0].secretAvailable, false);
    assert.match(s.connection.apiKeys[0].id, /^[a-f0-9]{32}$/);
    assert.doesNotMatch(
      JSON.stringify(s.connection.apiKeys),
      new RegExp(secretKey + '|' + accessKey + '|' + org),
    );
    assert.equal(s.availabilityCalls.length, 0);
    assert.equal(s.planCalls.length, 0);
    assert.equal(
      await s.connection.useAPIKey(s.connection.apiKeys[0].id),
      undefined,
    );
    s.connection.invalidateAPIKeys();
    assert.deepEqual(s.connection.apiKeys, []);
  } finally {
    iam.listAccessAPIKeys = old;
    s.connection.dispose();
    s.restore();
  }
});
test('late inventory cannot publish after logout, storage invalidation or a newer refresh', async () => {
  const s = setup();
  const iam = require('../dist/llmAccessIam');
  const old = iam.listAccessAPIKeys;
  try {
    await s.connection.ensureProject();
    let release;
    iam.listAccessAPIKeys = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const pending = s.connection.refreshAPIKeys(true);
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    s.connection.invalidateAPIKeys();
    release([
      {
        accessKey,
        organizationId: org,
        bearer: { type: 'user', id: org },
        description: 'Stale',
        expiresAt: Date.now() + 3600000,
      },
    ]);
    await pending;
    assert.deepEqual(s.connection.apiKeys, []);
    assert.match(s.connection.apiKeysState, /À actualiser/);
    const second = s.connection.refreshAPIKeys(true);
    release = undefined;
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    await s.connection.disconnect();
    release([
      {
        accessKey,
        organizationId: org,
        bearer: { type: 'user', id: org },
        description: 'Late',
        expiresAt: Date.now() + 3600000,
      },
    ]);
    await second;
    assert.deepEqual(s.connection.apiKeys, []);
  } finally {
    iam.listAccessAPIKeys = old;
    s.connection.dispose();
    s.restore();
  }
});
test('one registered API key supports two catalog models without per-model registration', async () => {
  const s = setup();
  const iam = require('../dist/llmAccessIam');
  const old = iam.listAccessAPIKeys;
  const list = provider.listServerless;
  try {
    await s.connection.ensureProject();
    iam.listAccessAPIKeys = async () => [
      {
        accessKey,
        organizationId: org,
        bearer: { type: 'user', id: org },
        description: 'Shared key',
        expiresAt: Date.now() + 3600000,
      },
    ];
    provider.listServerless = async () => [
      { id: 'public-model', label: 'First', kind: 'serverless' },
      {
        id: 'fixture-chat-never-live-tested',
        label: 'Second',
        kind: 'serverless',
      },
    ];
    await s.connection.loadPublicCatalog();
    assert.equal(await s.connection.configureAPIKey(), true);
    const key = s.connection.apiKeys[0];
    assert.equal(key.secretAvailable, true);
    assert.equal(s.availabilityCalls.length, 0);
    const first = await s.connection.useAPIKey(key.id);
    assert.equal(first.id, 'public-model');
    const firstHandle = await s.connection.modelInferenceScope(first);
    s.vscode.window.showQuickPick = async (items) => items.at(-1);
    const second = await s.connection.useAPIKey(key.id);
    assert.equal(second.id, 'fixture-chat-never-live-tested');
    assert.equal(second.llmAccess.id, first.llmAccess.id);
    assert.equal(firstHandle.current(), true);
    assert.equal(firstHandle.authorize(), secretKey);
    firstHandle.dispose();
    const registered = [...s.secrets].filter(([key]) =>
      key.startsWith('scalewayAI.llmAccess.secret.v1.'),
    );
    assert.equal(registered.length, 1);
    assert.equal(JSON.parse(registered[0][1]).modelId, undefined);
    assert.equal(s.planCalls.length, 1);
  } finally {
    iam.listAccessAPIKeys = old;
    provider.listServerless = list;
    s.connection.dispose();
    s.restore();
  }
});
