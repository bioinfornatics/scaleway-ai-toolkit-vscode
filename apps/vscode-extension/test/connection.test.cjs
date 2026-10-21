const assert = require('node:assert/strict');
const { test } = require('node:test');
const Module = require('node:module');
const provider = require('../dist/provider');
const auth = require('../dist/browserLogin');
const org = '11111111-1111-1111-1111-111111111111',
  id = '22222222-2222-2222-2222-222222222222';
const token = 'eyJhbGciOiJSUzI1NiJ9.eyJleHAiOjQwMDAwMDAwMDB9.c3ludGhldGlj';
function setup() {
  const secrets = new Map([['scalewayAI.apiKey.v1', 'legacy_do_not_read']]),
    state = new Map([
      ['scalewayAI.connection', { name: 'legacy', organizationId: org }],
    ]);
  let requests = 0,
    opened = 0,
    logins = 0;
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
      showErrorMessage: async () => {},
      showWarningMessage: async () => {},
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
      get: async (k) => {
        assert.equal(k, 'scalewayAI.userSession.v1');
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
  let Connection;
  try {
    Connection = require('../dist/connection').Connection;
  } finally {
    Module._load = original;
  }
  const old = provider.listProjects,
    oldAuth = auth.browserLogin,
    oldDedicated = provider.listDedicated,
    oldOrganizations = provider.listOrganizations;
  provider.listOrganizations = async (u, k) => {
    assert.equal(u, org);
    assert.equal(k, token);
    return [{ id: org, name: 'Organization', locked: false }];
  };
  provider.listProjects = async (o, k) => {
    requests++;
    assert.equal(o, org);
    assert.equal(k, token);
    return [{ id, name: 'Project', organizationId: org }];
  };
  provider.listDedicated = async (_p, k) => {
    requests++;
    assert.equal(k, token);
    return [];
  };
  auth.browserLogin = async (open) => {
    logins++;
    await open(
      'https://account.scaleway.com/authenticate?redirectToUrl=synthetic',
    );
    return { token, expiresAt: Date.now() + 3600000, userId: org };
  };
  return {
    connection: new Connection(context, () => {}),
    newConnection: () => new Connection(context, () => {}),
    context,
    secrets,
    state,
    inputs,
    vscode,
    requests: () => requests,
    opened: () => opened,
    logins: () => logins,
    restore: () => {
      provider.listProjects = old;
      auth.browserLogin = oldAuth;
      provider.listDedicated = oldDedicated;
      provider.listOrganizations = oldOrganizations;
    },
  };
}
test('user browser login receives JWT, reads projects, stores JWT only in SecretStorage; removes legacy key', async () => {
  const s = setup();
  try {
    assert.equal(s.requests(), 0);
    assert.equal(s.connection.metadata, undefined);
    await s.connection.login();
    assert.equal(s.opened(), 1);
    assert.equal(s.requests(), 1);
    assert.equal(s.connection.project.id, id);
    assert.equal(s.inputs.length, 0);
    assert.equal(s.secrets.size, 1);
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
    assert.equal(s.connection.project, undefined);
    assert.equal(s.connection.metadata, undefined);
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

test('restart restores valid JWT and user-bound scope without HTTP or browser', async () => {
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
    assert.equal(s.state.size, 0);
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
      entered();
      await blocked;
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
      assert.equal(k, token);
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
      assert.equal(jwt, token);
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
      assert.equal(jwt, token);
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
      assert.equal(jwt, token);
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
      assert.equal(jwt, token);
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
      assert.equal(jwt, token);
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
test('controller reserves lifecycle before returning, blocks duplicate factories and stale sends', async () => {
  const s = setup();
  let posts = 0;
  try {
    await s.connection.login();
    const model = {
      id: operationModel,
      label: 'Model',
      kind: 'dedicated-catalog',
    };
    s.connection.dedicatedCatalog = [model];
    const results = await Promise.allSettled([
      s.connection.deploymentLifecycle(model, 'Allocated', async () => {
        posts++;
      }),
      s.connection.deploymentLifecycle(model, 'Allocated', async () => {
        posts++;
      }),
    ]);
    assert.equal(
      results.filter((result) => result.status === 'fulfilled').length,
      1,
    );
    assert.equal((await s.connection.deploymentOperations()).length, 1);
    const engine = results.find(
      (result) => result.status === 'fulfilled',
    ).value;
    await s.connection.disconnect();
    await assert.rejects(
      engine.submit(
        { project_id: id, model_id: operationModel, name: 'Allocated' },
        new AbortController().signal,
      ),
      /deployment_review_required/,
    );
    assert.equal(posts, 0);
    assert.ok(!JSON.stringify([...s.state]).includes(token));
  } finally {
    s.connection.dispose();
    s.restore();
  }
});

test('controller persists late accepted response in original journal after logout without restoring session', async () => {
  const s = setup();
  try {
    await s.connection.login();
    const model = {
      id: operationModel,
      label: 'Model',
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
      {
        name: 'H100',
        region: 'fr-par',
        stockStatus: 'available',
        disabled: false,
      },
    ];
    s.connection.dedicatedCatalog = [model];
    const {
      prepareDeploymentDraft,
      deploymentOptions,
    } = require('../dist/deployment');
    const { reviewedDeploymentBody } = require('../dist/deploymentLifecycle');
    const project = s.connection.project;
    const draft = prepareDeploymentDraft(project, model, nodes, {
      name: 'Allocated',
      option: deploymentOptions(model, nodes)[0],
      network: { type: 'public', authentication: 'iam' },
      maxHourlyEUR: '1',
    });
    const body = reviewedDeploymentBody(draft, project, model, nodes, {
      reviewedAt: Date.now(),
      hourlyPriceEUR: '1',
      priceSource: 'synthetic',
      quota: 'verified-for-one-node',
      quotaSource: 'synthetic',
      rights: 'verified-create',
      writeContract: 'verified',
      license: { kind: 'no-eula-reviewed' },
      exposureConfirmed: true,
      billableCreationConfirmed: true,
    });
    const engine = await s.connection.deploymentLifecycle(
      model,
      'Allocated',
      async () => {
        await s.connection.disconnect();
        return {
          id: resourceId,
          name: 'Allocated',
          project_id: id,
          region: 'fr-par',
          model_id: operationModel,
          node_type_name: 'H100',
          status: 'creating',
          endpoints: [],
        };
      },
    );
    const row = await engine.submit(body, new AbortController().signal);
    assert.equal(row.id, resourceId);
    assert.equal(s.connection.connected, false);
    assert.equal(s.connection.project, undefined);
    assert.equal(s.connection.dedicated.length, 0);
    assert.equal(s.state.get(journalKey())[0].status, 'accepted');
    assert.equal(s.state.get(journalKey())[0].deploymentId, resourceId);
  } finally {
    s.connection.dispose();
    s.restore();
  }
});
