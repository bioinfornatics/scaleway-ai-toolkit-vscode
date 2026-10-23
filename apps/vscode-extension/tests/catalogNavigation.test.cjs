const assert = require('node:assert/strict');
const { test } = require('node:test');
const Module = require('node:module');

function setup() {
  const commands = new Map(),
    views = new Map(),
    notices = [],
    picks = [],
    panelRecords = [],
    scopes = [],
    subscriptions = [],
    refreshCalls = [],
    creationCalls = [],
    resourceCalls = [];
  let panels = 0,
    writes = 0,
    connection,
    modelSource;
  class Connection {
    constructor(_context, refresh) {
      connection = this;
      this.refresh = refresh;
      this.connected = true;
      this.project = { id: 'project', name: 'Project' };
      this.serverless = [{ id: 'model', label: 'Model', kind: 'serverless' }];
      this.serverlessResources = [];
      this.dedicated = [];
      this.dedicatedCatalog = [];
      this.dedicatedState = 'Non chargés';
    }
    async modelInferenceScope() {
      return this.inferenceScope();
    }
    inferenceScope() {
      const project = this.project,
        abort = new AbortController();
      const scope = {
        project,
        signal: abort.signal,
        current: () =>
          !abort.signal.aborted &&
          this.connected &&
          this.project === project &&
          api.workspace.isTrusted,
        dispose: () => abort.abort(),
        abort: () => abort.abort(),
      };
      scopes.push(scope);
      return scope;
    }
    async ensureProject() {
      return this.connected && !!this.project && api.workspace.isTrusted;
    }
    async loadModels() {
      refreshCalls.push('dedicated');
      this.refresh();
    }
    async refreshServerlessAvailability() {
      refreshCalls.push('serverless');
      this.serverlessResources = this.serverlessResources.map((row) => ({
        ...row,
        serverlessAvailability: 'Disponible',
      }));
      this.refresh();
    }
    async useServerless(id) {
      const row = this.serverless.find((item) => item.id === id);
      if (!row) return;
      writes++;
      this.serverlessResources = [row];
      this.refresh();
      return row;
    }
  }
  const status = { show() {} };
  const api = {
    EventEmitter: class {
      event = () => {};
      fire() {}
    },
    TreeItem: class {
      constructor(label) {
        this.label = label;
      }
    },
    TreeItemCollapsibleState: { Expanded: 1, None: 0 },
    ThemeIcon: class {},
    StatusBarAlignment: { Left: 1 },
    workspace: {
      isTrusted: true,
      onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
      onDidGrantWorkspaceTrust: () => ({ dispose() {} }),
    },
    extensions: { onDidChange: () => ({ dispose() {} }) },
    ViewColumn: { One: 1 },
    Uri: { joinPath: (_root, ...parts) => parts.join('/') },
    commands: {
      registerCommand: (id, callback) => {
        commands.set(id, callback);
        return {};
      },
      executeCommand: async (id, ...args) => commands.get(id)?.(...args),
    },
    window: {
      createTreeView: (id, options) => {
        views.set(id, options.treeDataProvider);
        return {};
      },
      createStatusBarItem: () => status,
      showInformationMessage: async (text) => notices.push(text),
      showQuickPick: async (items) => {
        picks.push(items);
        return undefined;
      },
      createWebviewPanel: (id, title, _column, options) => {
        assert.equal(id, 'scalewayAI.resources');
        panels++;
        let receive, disposed;
        const panel = {
          title,
          options,
          reveals: 0,
          webview: {
            html: '',
            cspSource: 'vscode-webview:',
            asWebviewUri: (uri) => uri,
            onDidReceiveMessage: (handler) => {
              receive = handler;
              return {
                dispose() {
                  receive = undefined;
                },
              };
            },
          },
          onDidDispose: (handler) => {
            disposed = handler;
          },
          dispose: () => disposed?.(),
          reveal() {
            this.reveals++;
          },
          send: (input) => receive?.(input),
          token() {
            return this.webview.html.match(/data-token="([a-f0-9]{48})"/)?.[1];
          },
        };
        panelRecords.push(panel);
        return panel;
      },
    },
  };
  const load = Module._load,
    modulePath = require.resolve('../dist/extension');
  delete require.cache[modulePath];
  Module._load = function (name, ...args) {
    if (name === 'vscode') return api;
    if (name === './connection') return { Connection };
    if (name === './deployedResources')
      return {
        DeployedResources: class {
          open(kind) {
            resourceCalls.push(kind);
          }
          refresh() {}
          dispose() {}
        },
      };
    if (name === './localInventory')
      return {
        LocalInventory: class {
          async open(kind) {
            creationCalls.push({ kind, mode: 'inventory' });
          }
          dispose() {}
        },
      };
    if (name === './localCreation')
      return {
        LocalCreation: class {
          constructor(_context, source) {
            modelSource = source;
          }
          modelsChanged() {}
          async open(kind, mode = 'create') {
            creationCalls.push({ kind, mode });
          }
          dispose() {}
        },
      };

    if (name === './servicePlayground' || name === './servicePlaygroundView')
      return new Proxy(
        {},
        {
          get() {
            throw new Error('playground execution forbidden');
          },
        },
      );
    return load.call(this, name, ...args);
  };
  try {
    require(modulePath).activate({
      subscriptions,
      extensionUri: 'root',
      workspaceState: { get: () => undefined },
    });
  } finally {
    Module._load = load;
    delete require.cache[modulePath];
  }
  return {
    commands,
    views,
    notices,
    picks,
    status,
    api,
    connection,
    modelSource,
    panels: () => panels,
    writes: () => writes,
    panelRecords,
    refreshCalls,
    creationCalls,
    resourceCalls,
    scopes,
    subscriptions,
  };
}

test('catalog add never opens a panel; resource click uses existing row and explicit picker without another write', async () => {
  const f = setup();
  await f.commands.get('scalewayAI.useServerless')('model');
  assert.equal(f.connection.serverlessResources[0].id, 'model');
  assert.equal(f.panels(), 0);
  assert.equal(f.picks.length, 0);
  assert.match(f.notices[0], /Accès LLM configuré/);
  const provider = f.views.get('scalewayAI.models');
  const roots = provider.getChildren();
  const models = roots.find((node) => node.id === 'real-models');
  assert.equal(models.children, undefined);
  assert.equal(models.command, 'scalewayAI.openModels');
  const row = { command: 'scalewayAI.openServerlessResource', args: ['model'] };
  await f.commands.get(row.command)(...row.args);
  assert.equal(f.picks.length, 1);
  assert.equal(f.picks[0][0].id, 'playground');
  assert.equal(f.writes(), 1);
  assert.equal(f.panels(), 0);
  await f.commands.get(row.command)('missing');
  f.api.workspace.isTrusted = false;
  await f.commands.get(row.command)('model');
  f.api.workspace.isTrusted = true;
  f.connection.connected = false;
  await f.commands.get(row.command)('model');
  assert.equal(f.picks.length, 1);
});

test('developer tools group only implemented catalog and build actions', () => {
  const f = setup();
  const roots = f.views.get('scalewayAI.tools').getChildren();
  assert.deepEqual(
    roots.map((node) => node.label),
    ['Découvrir', 'Construire'],
  );
  assert.equal(roots[0].children[0].command, 'scalewayAI.openCatalog');
  assert.ok(
    roots[1].children.some((node) => node.command === 'scalewayAI.playground'),
  );
  assert.equal(f.panels(), 0);
});

test('footer reports selected project and follows switch, logout and no-project states without opening a panel', () => {
  const f = setup();
  assert.equal(f.status.command, 'scalewayAI.setProject');
  assert.match(f.status.text, /Scaleway AI · Projet : Project/);
  assert.doesNotMatch(f.status.text, /Offline|connecté|vérifié/);
  assert.match(f.status.tooltip, /pas une vérification du cloud/);
  f.connection.project = { id: 'other', name: 'Other project' };
  f.connection.refresh();
  assert.match(f.status.text, /Projet : Other project/);
  f.connection.connected = false;
  f.connection.refresh();
  assert.match(f.status.text, /Other project · à reconnecter/);
  f.connection.project = undefined;
  f.connection.refresh();
  assert.match(f.status.text, /Choisir un projet/);
  f.connection.connected = true;
  f.connection.project = undefined;
  f.connection.refresh();
  assert.match(f.status.text, /Choisir un projet/);
  assert.equal(f.panels(), 0);
});

test('automatic Models refresh coalesces concurrent opens and stays silent', async () => {
  const f = setup();
  let release;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  f.connection.refreshServerlessAvailability = async (silent) => {
    assert.equal(silent, true);
    f.refreshCalls.push('serverless');
    await wait;
  };
  const first = f.commands.get('scalewayAI.openModels')();
  await Promise.resolve();
  const second = f.commands.get('scalewayAI.openModels')();
  await Promise.resolve();
  release();
  await Promise.all([first, second]);
  assert.deepEqual(f.refreshCalls, ['serverless', 'dedicated']);
  assert.deepEqual(f.notices, []);
  f.panelRecords[0].dispose();
});

test('disconnected or untrusted Models opens and Agents do not initiate refresh', async () => {
  const f = setup();
  f.connection.connected = false;
  await f.commands.get('scalewayAI.openModels')();
  f.connection.connected = true;
  f.api.workspace.isTrusted = false;
  await f.commands.get('scalewayAI.openModels')();
  await f.commands.get('scalewayAI.openAgents')();
  assert.deepEqual(f.refreshCalls, []);
  assert.deepEqual(f.notices, []);
  assert.deepEqual(f.picks, []);
  f.panelRecords[0].dispose();
});

test('model overview reuses one panel and agent inventory routes without execution', async () => {
  const f = setup();
  const roots = f.views.get('scalewayAI.models').getChildren();
  assert.deepEqual(
    roots.map((row) => row.id),
    [
      'project',
      'real-models',
      'agents',
      'resource-tools',
      'local',
      'templates',
      'recent',
    ],
  );
  assert.equal(roots[1].children, undefined);
  assert.equal(roots[2].children, undefined);
  await f.commands.get('scalewayAI.openModels')();
  const panel = f.panelRecords[0],
    old = panel.token();
  assert.match(panel.webview.html, /Aucun modèle affiché/);
  await f.commands.get('scalewayAI.openAgents')();
  assert.deepEqual(f.resourceCalls, ['agents']);
  await panel.send({ type: 'refresh', token: old });
  await f.commands.get('scalewayAI.openModels')();
  assert.notEqual(panel.token(), old);
  assert.equal(f.panels(), 1);
  panel.dispose();
  await f.commands.get('scalewayAI.openModels')();
  assert.equal(f.panels(), 2);
  f.panelRecords[1].dispose();
});

test('overview rejects forged/stale/deleted/foreign actions and binds current membership', async () => {
  const f = setup(),
    opened = [],
    reads = [];
  f.connection.serverlessResources = [
    { id: 'model', label: 'Model', kind: 'serverless' },
  ];
  f.connection.dedicated = [
    {
      id: 'dep',
      label: 'Deployment',
      kind: 'dedicated',
      deploymentInfo: { projectId: 'project' },
    },
    {
      id: 'foreign',
      label: 'Foreign',
      kind: 'dedicated',
      deploymentInfo: { projectId: 'other' },
    },
    { id: 'deleted', label: 'Deleted', kind: 'dedicated', status: 'deleted' },
  ];
  f.commands.set('scalewayAI.openServerlessResource', (id) => opened.push(id));
  f.commands.set('scalewayAI.openService', (id) => opened.push(id));
  f.commands.set('scalewayAI.refreshModels', () => reads.push('refresh'));
  await f.commands.get('scalewayAI.openModels')();
  const panel = f.panelRecords[0],
    token = panel.token();
  assert.doesNotMatch(panel.webview.html, /Foreign|Deleted/);
  for (const input of [
    { type: 'open', kind: 'serverless', id: 'model', token: 'a'.repeat(48) },
    { type: 'open', kind: 'serverless', id: 'missing', token },
    { type: 'open', kind: 'dedicated', id: 'foreign', token },
    { type: 'open', kind: 'dedicated', id: 'deleted', token },
    { type: 'open', kind: 'serverless', id: 'model', token, extra: true },
  ])
    await panel.send(input);
  assert.deepEqual(opened, []);
  await panel.send({ type: 'open', kind: 'serverless', id: 'model', token });
  await panel.send({ type: 'open', kind: 'dedicated', id: 'dep', token });
  assert.deepEqual(opened, ['model', 'dep']);
  f.connection.refresh();
  await panel.send({ type: 'refresh', token });
  assert.deepEqual(reads, []);
  await panel.send({ type: 'refresh', token: panel.token() });
  assert.deepEqual(reads, ['refresh']);
  f.api.workspace.isTrusted = false;
  const current = panel.token();
  await panel.send({
    type: 'open',
    kind: 'serverless',
    id: 'model',
    token: current,
  });
  f.scopes.at(-1).abort();
  assert.doesNotMatch(panel.webview.html, /data-id="model"/);
  assert.deepEqual(opened, ['model', 'dep']);
  panel.dispose();
});

test('logout/project switch clear scoped HTML; disposed documents cannot dispatch', async () => {
  const f = setup(),
    opened = [];
  f.connection.serverlessResources = [
    { id: 'model', label: 'Old Model', kind: 'serverless' },
  ];
  f.commands.set('scalewayAI.openServerlessResource', (id) => opened.push(id));
  await f.commands.get('scalewayAI.openModels')();
  const panel = f.panelRecords[0],
    token = panel.token();
  f.connection.connected = false;
  f.connection.refresh();
  assert.doesNotMatch(panel.webview.html, /Old Model/);
  await panel.send({ type: 'open', kind: 'serverless', id: 'model', token });
  f.connection.connected = true;
  f.connection.project = { id: 'other', name: 'Other' };
  f.connection.serverlessResources = [];
  f.connection.refresh();
  assert.match(panel.webview.html, /Projet : Other/);
  assert.doesNotMatch(panel.webview.html, /Old Model/);
  await panel.send({ type: 'open', kind: 'serverless', id: 'model', token });
  panel.dispose();
  await panel.send({ type: 'open', kind: 'serverless', id: 'model', token });
  assert.deepEqual(opened, []);
});

test('both resource refresh commands and overview button update Serverless before dedicated discovery', async () => {
  const f = setup();
  f.connection.serverlessResources = [
    {
      id: 'deepseek-v4.1-flash',
      label: 'DeepSeek',
      kind: 'serverless',
      llmAccess: {
        id: 'a'.repeat(32),
        projectId: 'p',
        bearerType: 'user',
        expiresAt: Date.now() + 3600000,
        verifiedAt: new Date().toISOString(),
      },
    },
  ];
  await f.commands.get('scalewayAI.openModels')();
  const panel = f.panelRecords[0];
  assert.ok(
    panel.webview.html.includes('<td>Accès configuré · IAM vérifié</td>'),
  );
  assert.deepEqual(f.refreshCalls, ['serverless', 'dedicated']);
  assert.deepEqual(f.notices, []);
  f.refreshCalls.length = 0;
  await panel.send({ type: 'refresh', token: panel.token() });
  assert.ok(
    panel.webview.html.includes('<td>Accès configuré · IAM vérifié</td>'),
  );
  assert.deepEqual(f.refreshCalls, ['serverless', 'dedicated']);
  await f.commands.get('scalewayAI.loadModels')();
  assert.deepEqual(f.refreshCalls, [
    'serverless',
    'dedicated',
    'serverless',
    'dedicated',
  ]);
  panel.dispose();
});

test('local and personal template entries route to creation host, never model/cloud actions', async () => {
  const f = setup();
  const roots = f.views.get('scalewayAI.models').getChildren();
  for (const id of ['local', 'templates']) {
    const group = roots.find((row) => row.id === id);
    assert.deepEqual(
      group.children.map((row) => row.label),
      ['Agents', 'Tools'],
    );
    for (const row of group.children) await f.commands.get(row.command)();
  }
  await f.commands.get('scalewayAI.createAgent')();
  await f.commands.get('scalewayAI.createTool')();
  assert.deepEqual(f.creationCalls, [
    { kind: 'agents', mode: 'inventory' },
    { kind: 'tools', mode: 'inventory' },
    { kind: 'agents', mode: 'templates' },
    { kind: 'tools', mode: 'templates' },
    { kind: 'agents', mode: 'create' },
    { kind: 'tools', mode: 'create' },
  ]);
  const build = f.views
    .get('scalewayAI.tools')
    .getChildren()
    .find((row) => row.id === 'build');
  assert.ok(
    build.children.some((row) => row.command === 'scalewayAI.createAgent'),
  );
  assert.ok(
    build.children.some((row) => row.command === 'scalewayAI.createTool'),
  );
  assert.equal(f.panels(), 0);
  assert.equal(f.writes(), 0);
  assert.deepEqual(f.refreshCalls, []);
  assert.deepEqual(f.notices, []);
});

test('model overview renderer dispatches current actions and ignores removed preview actions', () => {
  const fs = require('node:fs'),
    vm = require('node:vm'),
    messages = [],
    handlers = [];
  const buttons = [
    { dataset: { action: 'template', kind: 'agents', id: '0' } },
    { dataset: { action: 'back' } },
    { dataset: { action: 'templates' } },
    { dataset: { action: 'catalog' } },
    { dataset: { action: 'refresh' } },
    { dataset: { action: 'open', kind: 'serverless', id: 'model' } },
  ];
  for (const button of buttons)
    button.addEventListener = (_event, handler) => handlers.push(handler);
  vm.runInNewContext(fs.readFileSync('media/resourceOverview.js', 'utf8'), {
    acquireVsCodeApi: () => ({ postMessage: (value) => messages.push(value) }),
    document: {
      querySelector: () => ({
        dataset: { token: 'a'.repeat(48) },
        querySelectorAll: () => buttons,
      }),
    },
  });
  for (const handler of handlers) handler();
  assert.deepEqual(
    messages.map((row) => ({ ...row })),
    [
      { type: 'catalog', token: 'a'.repeat(48) },
      { type: 'refresh', token: 'a'.repeat(48) },
      { type: 'open', kind: 'serverless', id: 'model', token: 'a'.repeat(48) },
    ],
  );
});

test('agent model source merges only project Serverless resources and dedicated deployments, refreshes both', async () => {
  const f = setup();
  const serverless = {
    id: 'deepseek-v4.1-flash',
    label: 'DeepSeek',
    kind: 'serverless',
  };
  const dedicated = { id: 'service', label: 'Dedicated', kind: 'dedicated' };
  f.connection.serverlessResources = [serverless];
  f.connection.dedicated = [dedicated];
  assert.deepEqual(f.modelSource.current().rows, [serverless, dedicated]);
  assert.ok(!f.modelSource.current().rows.some((r) => r.id === 'model'));
  await f.modelSource.refresh();
  assert.deepEqual(f.refreshCalls, ['serverless', 'dedicated']);
  f.connection.connected = false;
  assert.deepEqual(f.modelSource.current().rows, []);
  assert.equal(f.modelSource.current().projectId, undefined);
});
