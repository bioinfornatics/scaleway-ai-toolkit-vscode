const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { transformSync } = require('esbuild');
const source = fs.readFileSync(
  path.join(__dirname, '../src/localCreation.ts'),
  'utf8',
);
const compiled = transformSync(source, {
  loader: 'ts',
  format: 'cjs',
  target: 'node22',
}).code;
function actualModule(name, overrides = {}) {
  const Module = require('node:module');
  const filename = path.join(__dirname, '../src', `${name}.ts`);
  const mod = new Module(filename);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod.require = (request) =>
    overrides[request] ??
    (request.startsWith('./')
      ? actualModule(request.slice(2), overrides)
      : Module.prototype.require.call(mod, request));
  mod._compile(
    transformSync(fs.readFileSync(filename, 'utf8'), {
      loader: 'ts',
      format: 'cjs',
      target: 'node22',
    }).code,
    filename,
  );
  return mod.exports;
}
const stacks = actualModule('stackScaffold');
const view = actualModule('buildCreationView');
const token = 'a'.repeat(48);
const index = 'b'.repeat(32);
const userKey = '33333333-3333-3333-3333-333333333333';
const applicationKey = '55555555-5555-5555-5555-555555555555';
function configuredAccess(projectId, bearerType = 'user') {
  return {
    id: (bearerType === 'application' ? 'd' : 'c').repeat(32),
    projectId,
    bearerType,
    expiresAt: Date.now() + 3600000,
    verifiedAt: new Date().toISOString(),
  };
}
function template(kind = 'tools') {
  return {
    version: 1,
    id: 'sample',
    label: '<img src=x onerror=boom>',
    kind,
    description: '<script>boom</script>',
    files: { 'README.md': `<script>&"'boom</script>` },
  };
}
function fixture() {
  const state = {
    discover: [],
    writes: [],
    creates: [],
    inputs: [],
    picks: [],
    confirms: [],
    opens: [],
    shows: [],
    nativeReads: [],
    listeners: {},
    panels: [],
    entries: [],
    issues: [],
    closedHandles: 0,
  };
  const uri = (target, scheme = 'file') => ({
    scheme,
    fsPath: target,
    toString: () => `${scheme}:${target}`,
  });
  const workspace = {
    isTrusted: true,
    workspaceFolders: [{ name: 'Project', uri: uri('/mock/project') }],
    onDidChangeWorkspaceFolders: (fn) => {
      state.listeners.folders = fn;
      return { dispose() {} };
    },
    onDidGrantWorkspaceTrust: (fn) => {
      state.listeners.trust = fn;
      return { dispose() {} };
    },
    openTextDocument: async (input) => {
      state.opens.push(input);
      if (state.openDocument) return state.openDocument(input);
      return {
        isClosed: false,
        getText: () =>
          typeof input.content === 'string'
            ? input.content
            : JSON.stringify(state.entries[0].template),
      };
    },
  };
  const vscode = {
    workspace,
    Uri: {
      file: uri,
      joinPath: (root, ...parts) => uri(path.join(root.fsPath, ...parts)),
    },
    ViewColumn: { One: 1 },
    window: {
      createWebviewPanel: () => {
        const panel = {
          webview: {
            postMessage: async (message) => {
              state.modelMessages ??= [];
              state.modelMessages.push(message);
            },
            html: '',
            cspSource: 'vscode-webview:',
            asWebviewUri: (u) => u,
            onDidReceiveMessage: (fn) => {
              panel.receive = fn;
            },
          },
          onDidDispose: (fn) => {
            panel.onDispose = fn;
          },
          dispose() {
            this.onDispose();
          },
          reveal() {
            state.reveals = (state.reveals ?? 0) + 1;
          },
        };
        state.panels.push(panel);
        return panel;
      },
      showQuickPick: async (choices) => {
        const next = state.picks.shift();
        return typeof next === 'function' ? next(choices) : next;
      },
      showInputBox: async (options) => {
        state.inputOptions = options;
        const next = state.inputs.shift();
        return typeof next === 'function' ? next(options) : next;
      },
      showWarningMessage: async (...args) => {
        state.warningArgs = args;
        const next = state.confirms.shift();
        return typeof next === 'function' ? next(args) : next;
      },
      showOpenDialog: async (options) => {
        state.pickerOptions = options;
        return state.filePick;
      },
      showTextDocument: async (document, options) => {
        state.showOptions = options;
        state.shows.push(document);
      },
    },
  };
  const library = {
    TEMPLATE_LIMITS: { fileBytes: 262144 },
    parseTemplate: (value) => {
      if (
        ![1, 2].includes(value?.version) ||
        !['agents', 'tools'].includes(value.kind) ||
        !value.files ||
        value.extra
      )
        throw new Error('invalid_template');
      return JSON.parse(JSON.stringify(value));
    },
    discoverTemplates: async (...args) => {
      state.discover.push(args);
      return state.discovery
        ? state.discovery(...args)
        : { entries: state.entries, issues: state.issues };
    },
    writeTemplate: async (...args) => {
      state.writes.push(args);
      if (state.writeError) throw new Error('sensitive');
    },
  };
  const scaffold = {
    builtinTemplates: (kind) => [template(kind)],
    materializeTemplate: async (...args) => {
      if (args[4] && !args[4]()) throw new Error('stale');
      if (state.materialize) return state.materialize(...args);
      if (args[3]) {
        if (!args[3].current()) throw new Error('stale');
        state.envContent = args[3].content();
      }
      state.creates.push(args);
      return path.join(args[0], args[1]);
    },
  };
  const native = {
    open: async (target, flags) => {
      state.nativeReads.push([target, flags]);
      const file = target.endsWith('.json');
      if (file && state.readError) throw new Error('sensitive-path');
      const content = Buffer.from(
        state.nativeText ??
          JSON.stringify(state.entries[0]?.template ?? template()),
      );
      return {
        fd: 55,
        close: async () => {
          state.closedHandles++;
        },
        stat: async () => ({
          isFile: () => !state.nonRegular,
          nlink: state.nlink ?? 1,
          size: state.size ?? content.length,
          mtimeMs: 1,
          ctimeMs: 1,
        }),
        read: async (buffer, offset) => {
          if (offset) return { bytesRead: 0 };
          content.copy(buffer);
          return { bytesRead: content.length };
        },
      };
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    Object,
    Array,
    module,
    exports: module.exports,
    Buffer,
    TextDecoder,
    process: { platform: 'linux' },
    require: (name) => {
      if (name === 'vscode') return vscode;
      if (name === './projectEnvironment')
        return actualModule('projectEnvironment');
      if (name === './serviceCompatibility')
        return actualModule('serviceCompatibility');
      if (name === './serviceProject') return actualModule('serviceProject');
      if (name === './endpointAgent') return actualModule('endpointAgent');
      if (name === './localAgentRunner')
        return {
          openLocalAgentEntry: async (project, current) => {
            if (current()) {
              if (state.openEntry && !(await state.openEntry(project, current)))
                return false;
              state.openedEntries ??= [];
              state.openedEntries.push(project);
              state.creationOrder ??= [];
              state.creationOrder.push('open');
              return true;
            }
          },
        };
      if (name === './projectGenerator')
        return actualModule('projectGenerator');
      if (name === './projectActions')
        return {
          configureCreatedCompiledIde: async (project, language) => {
            state.configuredCompiled ??= [];
            state.configuredCompiled.push({ project, language });
            return true;
          },
          configureCreatedPythonIde: async (project) => {
            state.creationOrder ??= [];
            state.creationOrder.push('root-registration');
            assert.deepEqual(state.openedEntries, [project]);
            await state.configureIde?.(project);
            state.configuredPython ??= [];
            state.configuredPython.push(project);
            return true;
          },
          prepareCreatedAgentProject: async (project) => {
            state.preparedPython ??= [];
            state.preparedPython.push(project);
            state.creationOrder ??= [];
            state.creationOrder.push('prepare');
            await state.onPrepare?.();
            return state.preparationResult ?? true;
          },
          offerProjectActions: async (project, template) => {
            state.postCreate = { project, template };
          },
        };
      if (name === './agentProject') return actualModule('agentProject');
      if (name === './stackScaffold') return stacks;
      if (name === './buildCreationView') return view;
      if (name === './templateLibrary') return library;
      if (name === './agentScaffold') return scaffold;
      if (name === 'node:os')
        return { homedir: () => '/mock/extension-host-home' };
      if (name === 'node:fs/promises') return native;
      return require(name);
    },
  });
  const api = module.exports;
  state.modelContext = {
    key: 'scope-a',
    projectId: '22222222-2222-2222-2222-222222222222',
    status: 'fr-par · projet sélectionné',
    rows: [
      {
        id: 'deployment-a',
        label: 'Mistral déployé',
        kind: 'dedicated',
        status: 'ready',
        deploymentInfo: {
          projectId: '22222222-2222-2222-2222-222222222222',
          region: 'fr-par',
          modelId: 'model-a',
          fetchedAt: '2026-10-22',
          endpoints: [
            {
              id: 'endpoint',
              url: 'https://example.invalid/v1',
              network: 'public',
              authentication: 'iam',
            },
          ],
        },
      },
    ],
  };
  const host = new api.LocalCreation(
    { extensionUri: uri('/extension') },
    {
      current: () => state.modelContext,
      addKey: async () => {
        state.addKeys = (state.addKeys ?? 0) + 1;
      },
      credentialScope: (projectId, model, preferredKeyId) => {
        const key = state.modelContext.key;
        state.credentialScopes = (state.credentialScopes ?? 0) + 1;
        state.credentialArgs = [projectId, model];
        state.preferredKeyId = preferredKeyId;
        const credentials = {
          current: () => key === state.modelContext.key,
          secretKey: () => {
            state.secretReads = (state.secretReads ?? 0) + 1;
            return state.modelContext.apiKeys?.find(
              (key) => key.id === preferredKeyId,
            )?.bearerType === 'application' ||
              model.llmAccess?.bearerType === 'application'
              ? applicationKey
              : userKey;
          },
          dispose: () => {
            state.credentialDisposals = (state.credentialDisposals ?? 0) + 1;
          },
        };
        return state.asyncCredentials
          ? Promise.resolve(credentials)
          : credentials;
      },
      refresh: async () => {
        if (state.refreshModels) return state.refreshModels();
        state.modelRefreshes = (state.modelRefreshes ?? 0) + 1;
      },
    },
  );
  state.send = async (action, rowIndex, extra = {}) => {
    const panel = state.panels.at(-1);
    const liveToken = panel.webview.html.match(/data-token="([a-f0-9]+)"/)[1];
    await panel.receive({
      action,
      token: liveToken,
      ...(rowIndex ? { index: rowIndex } : {}),
      ...extra,
    });
  };
  state.row = () =>
    state.panels.at(-1).webview.html.match(/data-index="([a-f0-9]+)"/)[1];
  return { state, host, workspace, api, uri, vscode };
}
test('closed parser rejects extra fields, kinds, malformed tokens and indices', () => {
  const { api } = fixture();
  for (const action of ['refresh', 'new', 'import', 'saveDraft'])
    assert.equal(api.parseCreationInput({ action, token }).action, action);
  for (const action of ['preview', 'create', 'edit', 'language', 'stack'])
    assert.equal(api.parseCreationInput({ action, token, index }).index, index);
  for (const value of [
    null,
    [],
    {},
    { action: 'run', token },
    { action: 'refresh', token: 'A'.repeat(48) },
    { action: 'refresh', token, index },
    { action: 'preview', token },
    { action: 'edit', token, index: '../path' },
    { action: 'create', token, index, content: 'x' },
    { action: 'refresh', token, kind: 'models' },
    { action: 'import', token, path: '/secret' },
  ])
    assert.equal(api.parseCreationInput(value), undefined);
});
test('untrusted opening reads no templates; invalid kinds do not open; reusable panel', async () => {
  const { state, host, workspace } = fixture();
  await host.open('models');
  await host.open('agents', 'invalid');
  assert.equal(state.panels.length, 0);
  workspace.isTrusted = false;
  await host.open('tools');
  assert.equal(state.discover.length, 0);
  assert.equal(state.nativeReads.length, 0);
  assert.match(state.panels[0].webview.html, /Workspace Trust requis/);
  await state.send('new');
  assert.equal(state.opens.length, 0);
  workspace.isTrusted = true;
  await state.listeners.trust();
  await host.open('tools', 'templates');
  assert.equal(state.panels.length, 1);
  assert.ok(state.reveals);
  assert.deepEqual(JSON.parse(JSON.stringify(state.discover.at(-1))), [
    ['/mock/project'],
    '/mock/extension-host-home',
    'tools',
  ]);
  host.dispose();
  await host.open('tools');
  assert.equal(state.panels.length, 1);
});
test('render escapes preview/metadata, sources, CSP; sanitized issues; opaque IPC', async () => {
  const { state, host } = fixture();
  state.entries = [
    {
      template: template(),
      origin: 'global',
      root: '/mock/extension-host-home/.scaleway-ai/templates',
      filePath:
        '/mock/extension-host-home/.scaleway-ai/templates/tools/sample.json',
    },
  ];
  state.issues = ['secret diagnostic <script>'];
  await host.open('tools');
  const row = state.row();
  await state.send('preview', row);
  const html = state.panels[0].webview.html;
  assert.doesNotMatch(
    html,
    /<img|<script>boom|secret diagnostic|data-index="sample"|extension-host-home/,
  );
  assert.match(html, /&lt;script&gt;&amp;&quot;&#39;boom/);
  assert.match(html, /Utilisateur/);
  assert.match(html, /Prédéfini/);
  assert.match(html, /connect-src &#39;none&#39;/);
  assert.match(html, /Créer un outil/);
  await state.send('create', row, { token });
  assert.equal(state.creates.length, 0);
  await state.send('create', row, { path: '/outside' });
  assert.equal(state.creates.length, 0);
});
test('project creation needs selection, native parent/name and explicit file confirmation', async () => {
  const { state, host } = fixture();
  await host.open('tools');
  const row = state.row();
  await state.send('create', row);
  assert.equal(state.creates.length, 0);
  await state.send('preview', row);
  state.picks.push((choices) => choices[0]);
  state.inputs.push('new-tool');
  state.confirms.push('Créer dans le projet');
  await state.send('create', row);
  assert.equal(state.creates.length, 1);
  assert.equal(state.creates[0][0], '/mock/project');
  assert.equal(state.creates[0][1], 'new-tool');
  assert.match(state.warningArgs[1].detail, /README.md/);
  assert.ok(state.inputOptions.validateInput('../escape'));
  assert.equal(state.inputOptions.validateInput('valid-name'), undefined);
});
test('stale async workspace/trust/panel actions never materialize', async () => {
  for (const boundary of ['workspace', 'trust', 'dispose']) {
    const { state, host, workspace, uri } = fixture();
    await host.open('tools');
    const row = state.row();
    await state.send('preview', row);
    state.picks.push((choices) => choices[0]);
    state.inputs.push('safe');
    state.confirms.push(() => {
      if (boundary === 'workspace')
        workspace.workspaceFolders = [{ name: 'Other', uri: uri('/other') }];
      else if (boundary === 'trust') workspace.isTrusted = false;
      else host.dispose();
      return 'Créer dans le projet';
    });
    await state.send('create', row);
    assert.equal(state.creates.length, 0);
    assert.equal(state.openedEntries, undefined);
  }
});
test('virtual roots excluded, invalid native name refused, refresh invalidates token', async () => {
  const { state, host, workspace, uri } = fixture();
  workspace.workspaceFolders.push({
    name: 'Remote',
    uri: uri('/remote', 'vscode-remote'),
  });
  await host.open('tools');
  assert.deepEqual(JSON.parse(JSON.stringify(state.discover[0][0])), [
    '/mock/project',
  ]);
  const oldToken = state.panels[0].webview.html.match(
    /data-token="([a-f0-9]+)"/,
  )[1];
  await state.send('refresh');
  await state.panels[0].receive({ action: 'new', token: oldToken });
  assert.equal(state.opens.length, 0);
  const row = state.row();
  await state.send('preview', row);
  state.picks.push((choices) => choices[0]);
  state.inputs.push('../bad');
  await state.send('create', row);
  assert.equal(state.creates.length, 0);
});
test('native draft creation then save to explicit user destination, no implicit writes', async () => {
  const { state, host } = fixture();
  await host.open('tools', 'templates');
  await state.send('new');
  assert.equal(state.opens.length, 0);
  assert.match(state.panels[0].webview.html, /Vous créez un template/);
  await state.send('new');
  assert.equal(state.opens[0].language, 'json');
  assert.equal(state.writes.length, 0);
  state.picks.push('Utilisateur');
  state.confirms.push('Créer le template');
  await state.send('saveDraft');
  assert.equal(state.writes.length, 1);
  assert.equal(
    state.writes[0][0],
    '/mock/extension-host-home/.scaleway-ai/templates',
  );
  assert.equal(state.writes[0][1].id, 'my-template');
});
test('native import bounded regular NOFOLLOW read, kind gate and explicit project save', async () => {
  const { state, host, uri } = fixture();
  await host.open('tools');
  state.filePick = [uri('/selected/sample.json')];
  state.picks.push('Projet', (choices) => choices[0]);
  state.confirms.push('Créer le template');
  await state.send('import');
  assert.equal(state.writes.length, 1);
  assert.equal(state.writes[0][0], '/mock/project/.scaleway-ai/templates');
  const constants = require('node:fs').constants;
  assert.ok(state.nativeReads.at(-1)[1] & constants.O_NOFOLLOW);
  assert.ok(state.closedHandles >= 3);
  for (const mutation of [
    () => {
      state.nonRegular = true;
    },
    () => {
      state.nonRegular = false;
      state.nlink = 2;
    },
    () => {
      state.nlink = 1;
      state.size = 262145;
    },
    () => {
      state.size = undefined;
      state.nativeText = JSON.stringify(template('agents'));
    },
    () => {
      state.nativeText = 'not JSON';
    },
    () => {
      state.filePick = [uri('/remote', 'vscode-remote')];
    },
  ]) {
    mutation();
    await state.send('import');
    assert.equal(state.writes.length, 1);
  }
});
test('edit verifies inventory membership/hash and uses native editor only', async () => {
  const { state, host } = fixture();
  const entry = {
    template: template(),
    origin: 'project',
    root: '/mock/project/.scaleway-ai/templates',
    filePath: '/mock/project/.scaleway-ai/templates/tools/sample.json',
  };
  state.entries = [entry];
  await host.open('tools');
  const indices = [
    ...state.panels[0].webview.html.matchAll(
      /data-action="edit" data-index="([a-f0-9]+)"/g,
    ),
  ];
  await state.send('edit', indices[0][1]);
  assert.equal(state.shows.length, 1);
  assert.equal(state.writes.length, 0);
  assert.equal(state.opens[0].fsPath, entry.filePath);
  state.entries = [{ ...entry, template: { ...template(), label: 'Changed' } }];
  await state.send('edit', indices[0][1]);
  assert.equal(state.shows.length, 1);
  state.entries = [];
  await state.send('edit', indices[0][1]);
  assert.equal(state.shows.length, 1);
});
test('inflight discovery disposed or superseded never publishes content', async () => {
  const { state, host } = fixture();
  let finish;
  state.discovery = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const pending = host.open('tools');
  host.dispose();
  finish({ entries: [], issues: [] });
  await pending;
  assert.doesNotMatch(state.panels[0].webview.html, /<img|&lt;img/);
});
test('actual browser script sends only closed IPC and opaque index', () => {
  const script = fs.readFileSync(
    path.join(__dirname, '../media/localCreation.js'),
    'utf8',
  );
  let click, change, _input;
  const messages = [];
  vm.runInNewContext(script, {
    acquireVsCodeApi: () => ({ postMessage: (value) => messages.push(value) }),
    window: { addEventListener() {} },
    document: {
      body: { dataset: { token } },
      addEventListener: (type, fn) => {
        if (type === 'click') click = fn;
        else if (type === 'change') change = fn;
        else if (type === 'input') _input = fn;
        else if (type === 'keydown') {
        } else assert.fail('unexpected browser listener');
      },
    },
  });
  const fire = (dataset) =>
    click({
      target: {
        closest: (selector) =>
          selector.startsWith('select') ? null : { dataset },
      },
    });
  fire({ action: 'preview', index, path: '/outside', content: 'secret' });
  fire({ action: 'refresh', index, content: 'secret' });
  fire({ action: 'exec', index });
  fire({ action: 'create', index: '/path' });
  change({
    target: {
      closest: () => ({ dataset: { action: 'language' }, value: index }),
    },
  });
  change({
    target: {
      closest: () => ({ dataset: { action: 'stack' }, value: '/outside' }),
    },
  });
  assert.equal(messages.length, 3);
  assert.equal(
    JSON.stringify(messages[2]),
    JSON.stringify({ action: 'language', token, index }),
  );
  assert.equal(
    JSON.stringify(messages[0]),
    JSON.stringify({ action: 'preview', token, index }),
  );
  assert.equal(
    JSON.stringify(messages[1]),
    JSON.stringify({ action: 'refresh', token }),
  );
});

test('native cancellation and busy replay do not cause generation or saves', async () => {
  const { state, host } = fixture();
  await host.open('tools');
  const row = state.row();
  await state.send('preview', row);
  state.picks.push((choices) => choices[0]);
  state.inputs.push('safe');
  state.confirms.push(undefined);
  await state.send('create', row);
  assert.equal(state.creates.length, 0);
  await state.send('new');
  state.picks.push('Utilisateur');
  state.confirms.push(undefined);
  await state.send('saveDraft');
  assert.equal(state.writes.length, 0);
  let finish;
  state.picks.push(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = state.send('create', row);
  await state.send('create', row);
  finish(undefined);
  await pending;
  assert.equal(state.creates.length, 0);
});

test('agent built-in base uses inline name and deployed model with standalone endpoint launch', async () => {
  const { state, host } = fixture();
  await host.open('agents');
  const row = state.row();
  await state.send('preview', row);
  await state.send('name', undefined, { name: 'new-agent' });
  await state.send('dedicated');
  await state.send(
    'model',
    option(state.panels[0].webview.html, 'model', 'model-a'),
  );
  state.picks.push((choices) => choices[0]);
  state.confirms.push('Créer dans le projet');
  await state.send('create', row);
  assert.equal(state.creates.length, 1);
  const files = state.creates[0][2].files;
  assert.ok(
    files['README.md'].startsWith(template('agents').files['README.md']),
  );
  assert.ok(files['src/agent_app/agent.py']);
  assert.match(files['pyproject.toml'], /agent_app.agent:main/);
  assert.equal(
    JSON.parse(files['.vscode/scaleway-agent-run.json']).consoleScript,
    'agent',
  );
  assert.equal(
    JSON.parse(files['.vscode/scaleway-agent-run.json']).ready,
    true,
  );
  assert.equal(JSON.parse(files['agent.creation.json']).incomplete, false);
  assert.equal(
    JSON.parse(files['agent.creation.json']).selected_deployment.deployment_id,
    'deployment-a',
  );
  assert.equal(files['agent.json'], undefined);
});

test('edit refuses mismatched disk hash and changed native-editor document', async () => {
  const { state, host } = fixture();
  const entry = {
    template: template(),
    origin: 'project',
    root: '/mock/project/.scaleway-ai/templates',
    filePath: '/mock/project/.scaleway-ai/templates/tools/sample.json',
  };
  state.entries = [entry];
  await host.open('tools');
  const row = state.panels[0].webview.html.match(
    /data-action="edit" data-index="([a-f0-9]+)"/,
  )[1];
  state.nativeText = JSON.stringify({
    ...template(),
    label: 'changed-on-disk',
  });
  await state.send('edit', row);
  assert.equal(state.opens.length, 0);
  state.nativeText = undefined;
  state.openDocument = () => ({
    isClosed: false,
    getText: () =>
      JSON.stringify({ ...template(), label: 'dirty-native-document' }),
  });
  await state.send('edit', row);
  assert.equal(state.opens.length, 1);
  assert.equal(state.shows.length, 0);
  assert.equal(state.writes.length, 0);
});

test('import errors are sanitized and trust loss after reading cancels writing', async () => {
  const { state, host, workspace, uri } = fixture();
  await host.open('tools');
  state.filePick = [uri('/selected/sample.json')];
  state.readError = true;
  await state.send('import');
  assert.doesNotMatch(state.panels[0].webview.html, /sensitive-path/);
  assert.ok(!state.panels[0].webview.html.includes('/selected/'));
  state.readError = false;
  state.picks.push(() => {
    workspace.isTrusted = false;
    return 'Utilisateur';
  });
  await state.send('import');
  assert.equal(state.writes.length, 0);
});

test('empty personal sources are valid and refresh invalidates chosen indices', async () => {
  const { state, host } = fixture();
  await host.open('tools');
  assert.doesNotMatch(state.panels[0].webview.html, /Aucun template personnel/);
  const row = state.row();
  await state.send('preview', row);
  await state.send('refresh');
  await state.send('preview', row);
  await state.send('create', row);
  assert.equal(state.creates.length, 0);
  assert.equal(state.warningArgs, undefined);
});

test('browser refresh flood coalesces inventories rather than parallel reads', async () => {
  const { state, host } = fixture();
  let finish;
  state.discovery = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const opening = host.open('tools');
  for (let i = 0; i < 20; i++) await state.send('refresh');
  assert.equal(state.discover.length, 1);
  state.discovery = undefined;
  finish({ entries: [], issues: [] });
  await opening;
  assert.equal(state.discover.length, 2);
  host.dispose();
});

test('Given a generated tool, When creation succeeds, Then post-create actions receive it without registration or regeneration', async () => {
  const { state, host } = fixture();
  await host.open('tools');
  const row = state.row();
  await state.send('preview', row);
  state.picks.push((choices) => choices[0]);
  state.inputs.push('created-tool');
  state.confirms.push('Créer dans le projet');
  await state.send('create', row);
  assert.equal(state.creates.length, 1);
  assert.equal(state.postCreate.project, '/mock/project/created-tool');
  assert.equal(typeof state.creates[0][4], 'function');
  assert.match(state.panels[0].webview.html, /Base locale créée/);
  assert.doesNotMatch(
    state.panels[0].webview.html,
    /inventaire non enregistré|Action refusée/,
  );
});

for (const kind of ['agents', 'tools']) {
  test(`${kind}: personal table is empty with correct footnote and header creation route`, async () => {
    const { state, host } = fixture();
    state.issues = ['ignored invalid template'];
    await host.open(kind, 'templates');
    const html = state.panels[0].webview.html;
    assert.ok(html.includes('<tbody></tbody>'));
    assert.ok(html.includes(`.scaleway-ai/templates/${kind}/`));
    assert.ok(html.includes(`~/.scaleway-ai/templates/${kind}/`));
    assert.ok(html.indexOf('<footer>') > html.indexOf('</table>'));
    assert.doesNotMatch(
      html,
      /Templates prédéfinis|Aucun template personnel|ignorés|Linux uniquement/,
    );
    assert.ok(
      html.includes(
        kind === 'agents' ? '+ Créer un agent' : '+ Créer un outil',
      ),
    );
    await state.send('new');
    assert.equal(state.opens.length, 0);
    assert.equal(state.writes.length, 0);
    assert.match(
      state.panels[0].webview.html,
      /Vous créez un template, pas un projet local/,
    );
    const row = state.row();
    await state.send('preview', row);
    if (kind === 'agents')
      await state.send('name', undefined, { name: 'my-template' });
    else state.inputs.push('my-template', 'My template');
    state.picks.push('Utilisateur');
    state.confirms.push((args) => {
      assert.ok(
        args[1].detail.includes(
          `/.scaleway-ai/templates/${kind}/my-template.json`,
        ),
      );
      return 'Créer le template';
    });
    await state.send('create', row);
    assert.equal(state.creates.length, 0);
    assert.equal(state.writes.length, 1);
    assert.equal(state.writes[0][1].kind, kind);
    assert.equal(state.writes[0][1].id, 'my-template');
    assert.match(state.panels[0].webview.html, /Mes templates/);
  });
}
test('personal table escapes entries and cannot materialize from inventory preview', async () => {
  const { state, host } = fixture();
  state.entries = [
    {
      template: template(),
      origin: 'project',
      root: '/mock/project/.scaleway-ai/templates',
      filePath: '/mock/project/.scaleway-ai/templates/tools/sample.json',
    },
  ];
  await host.open('tools', 'templates');
  assert.match(state.panels[0].webview.html, /&lt;img/);
  assert.doesNotMatch(state.panels[0].webview.html, /<img|Prédéfini/);
  const row = state.row();
  await state.send('preview', row);
  await state.send('create', row);
  assert.equal(state.creates.length, 0);
  assert.equal(state.writes.length, 0);
});
test('template creation explicit project destination and stale mode/trust confirmation cancels', async () => {
  for (const boundary of ['none', 'trust', 'mode', 'cancel']) {
    const { state, host, workspace } = fixture();
    await host.open('tools', 'template-create');
    const row = state.row();
    await state.send('preview', row);
    state.inputs.push('new-template', 'New template');
    state.picks.push('Projet', (choices) => choices[0]);
    state.confirms.push(async () => {
      if (boundary === 'trust') workspace.isTrusted = false;
      if (boundary === 'mode') await host.open('tools', 'create');
      return boundary === 'cancel' ? undefined : 'Créer le template';
    });
    await state.send('create', row);
    assert.equal(state.creates.length, 0);
    assert.equal(state.writes.length, boundary === 'none' ? 1 : 0);
    if (boundary === 'none')
      assert.equal(state.writes[0][0], '/mock/project/.scaleway-ai/templates');
  }
});

function option(html, action, label) {
  const select = html.match(
    new RegExp(`<select data-action="${action}"[^>]*>(.*?)</select>`),
  )?.[1];
  assert.ok(select, action);
  const found = [
    ...select.matchAll(/<option value="([a-f0-9]{32})"[^>]*>(.*?)<\/option>/g),
  ].find((m) => m[2].startsWith(label));
  assert.ok(found, `${action}: ${label}`);
  return found[1];
}
for (const kind of ['tools']) {
  test(`${kind}: Build language filters frameworks, stack creation preserves selected pile`, async () => {
    const { state, host } = fixture();
    await host.open(kind);
    let html = state.panels[0].webview.html;
    assert.match(html, /Langage de programmation/);
    assert.match(html, /Ou partir d’un template/);
    assert.ok(html.includes('<button type="button" disabled>'));
    assert.doesNotMatch(
      html.match(/<select data-action="stack"[^>]*>(.*?)<\/select>/)[1],
      /Mastra|Elysia|Axum/,
    );
    const py = option(
      html,
      'stack',
      kind === 'agents' ? 'LangChain' : 'FastAPI',
    );
    await state.send('language', option(html, 'language', 'TypeScript'));
    html = state.panels[0].webview.html;
    const ts = option(html, 'stack', kind === 'agents' ? 'Mastra' : 'ElysiaJS');
    const oldToken = html.match(/data-token="([a-f0-9]+)"/)[1];
    await state.send('stack', py); // Valid opaque ID, wrong current language.
    assert.ok(
      state.panels[0].webview.html.includes('<button type="button" disabled>'),
    );
    await state.send('stack', ts, { language: 'python' });
    assert.ok(
      state.panels[0].webview.html.includes('<button type="button" disabled>'),
    );
    await state.send('stack', ts);
    await state.panels[0].receive({
      action: 'create',
      index: ts,
      token: oldToken,
    });
    assert.equal(state.creates.length, 0);
    state.picks.push((choices) => choices[0]);
    state.inputs.push('ts-project');
    state.confirms.push('Créer dans le projet');
    await state.send('create', ts);
    assert.equal(state.creates.length, 1);
    const files = state.creates[0][2].files;
    const marker = JSON.parse(
      files[kind === 'agents' ? 'agent.authoring.json' : 'tool.authoring.json'],
    );
    assert.equal(marker.language, 'typescript');
    assert.equal(marker.framework, kind === 'agents' ? 'mastra' : 'elysia');
    assert.equal(state.agentArgs, undefined); // Never overwrite TS with Python Strands.
    await state.send('clear');
    assert.ok(
      state.panels[0].webview.html.includes('<button type="button" disabled>'),
    );
    await state.send(
      'language',
      option(state.panels[0].webview.html, 'language', 'Rust'),
    );
    html = state.panels[0].webview.html;
    const frameworks = html.match(
      /<select data-action="stack"[^>]*>(.*?)<\/select>/,
    )[1];
    assert.match(frameworks, /Axum|Actix Web/);
    assert.doesNotMatch(frameworks, /LangChain|Strands|Mastra/);
    await state.send('stack', option(html, 'stack', 'Axum'));
    const rust = state.panels[0].webview.html.match(
      /data-action="create" data-index="([a-f0-9]+)"/,
    )[1];
    state.picks.push((choices) => choices[0]);
    state.inputs.push('rust-project');
    state.confirms.push('Créer dans le projet');
    await state.send('create', rust);
    assert.ok(state.creates[1][2].files['Cargo.toml']);
  });
}
test('agent Python backend and IA selectors compose files, scope change invalidates model', async () => {
  const { state, host } = fixture();
  await host.open('agents');
  const backend = option(state.panels[0].webview.html, 'backend', 'FastAPI');
  await state.send('backend', backend);
  const ai = option(state.panels[0].webview.html, 'ai', 'Strands');
  await state.send('ai', ai);
  await state.send('name', undefined, { name: 'py-agent' });
  await state.send('dedicated');
  await state.send(
    'model',
    option(state.panels[0].webview.html, 'model', 'model-a'),
  );
  state.picks.push((choices) => choices[0]);
  state.confirms.push('Créer dans le projet');
  await state.send('create', backend);
  assert.equal(state.creates.length, 1);
  const files = state.creates[0][2].files;
  assert.match(files['src/agent_app/api.py'], /FastAPI/);
  assert.match(
    files['src/agent_app/agent.py'],
    /from \.config import load_project_config/,
  );
  assert.match(files['requirements.txt'], /fastapi/);
  assert.match(files['requirements.txt'], /strands-agents/);
  assert.equal(
    JSON.parse(files['agent.authoring.json']).ai_framework,
    'strands',
  );
  state.modelContext = {
    ...state.modelContext,
    key: 'scope-b',
    projectId: '44444444-4444-4444-4444-444444444444',
  };
  host.modelsChanged();
  await state.send('create', backend);
  assert.equal(state.creates.length, 1);
});

test('template alternative bypasses stack conversion; selector change invalidates selected template', async () => {
  const { state, host } = fixture();
  await host.open('tools');
  const row = state.row();
  await state.send('preview', row);
  assert.match(state.panels[0].webview.html, /sans conversion de langage/);
  await state.send(
    'language',
    option(state.panels[0].webview.html, 'language', 'Rust'),
  );
  await state.send('create', row);
  assert.equal(state.creates.length, 0);
});
test('template mode with selected stack saves matching JSON envelope, never materializes', async () => {
  const { state, host } = fixture();
  await host.open('tools', 'template-create');
  await state.send(
    'language',
    option(state.panels[0].webview.html, 'language', 'Rust'),
  );
  const axum = option(state.panels[0].webview.html, 'stack', 'Axum');
  await state.send('stack', axum);
  state.inputs.push('axum-template', 'Axum template');
  state.picks.push('Utilisateur');
  state.confirms.push('Créer le template');
  await state.send('create', axum);
  assert.equal(state.creates.length, 0);
  assert.equal(state.writes.length, 1);
  assert.ok(state.writes[0][1].files['Cargo.toml']);
  assert.equal(
    JSON.parse(state.writes[0][1].files['tool.authoring.json']).framework,
    'axum',
  );
});
test('untrusted selectors and forged indices cannot select or write; stack choice changes blocked while confirming', async () => {
  const { state, host, workspace } = fixture();
  await host.open('tools');
  const fastapi = option(state.panels[0].webview.html, 'stack', 'FastAPI');
  await state.send('stack', fastapi);
  let release;
  state.picks.push(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = state.send('create', fastapi);
  await state.send(
    'language',
    option(state.panels[0].webview.html, 'language', 'Rust'),
  );
  assert.match(state.panels[0].webview.html, /FastAPI · Python/);
  release(undefined);
  await pending;
  workspace.isTrusted = false;
  await state.send('stack', fastapi);
  await state.send('create', fastapi);
  assert.equal(state.creates.length, 0);
  await host.open('tools');
  assert.match(
    state.panels[0].webview.html,
    /select data-action="language" disabled/,
  );
});

test('agent empty models, invalid fields, forged selections and explicit refresh', async () => {
  const { state, host, api } = fixture();
  state.modelContext = {
    key: 'scope',
    projectId: '22222222-2222-2222-2222-222222222222',
    status: 'Non chargés',
    rows: [],
  };
  await host.open('agents');
  assert.match(state.panels[0].webview.html, /Aucun modèle Serverless chargé/);
  assert.equal(
    api.parseCreationInput({ action: 'name', token, name: '../escape' }),
    undefined,
  );
  assert.equal(
    api.parseCreationInput({ action: 'name', token, name: 'x'.repeat(65) }),
    undefined,
  );
  assert.equal(
    api.parseCreationInput({
      action: 'name',
      token,
      name: 'valid',
      path: '/outside',
    }),
    undefined,
  );
  const backend = option(state.panels[0].webview.html, 'backend', 'FastAPI');
  await state.send('ai', backend);
  assert.equal(host.selected, undefined);
  await state.send('backend', index);
  assert.equal(host.selected, undefined);
  await state.send('backend', backend);
  await state.send('name', undefined, { name: 'my-agent' });
  await state.send('model', index);
  assert.equal(host.modelIndex, undefined);
  await state.send('create', backend);
  assert.equal(state.creates.length, 0);
  await state.send('refreshModels');
  assert.equal(state.modelRefreshes, 2);
});
test('agent project/logout change while confirming refuses materialization; busy name cannot alter destination', async () => {
  for (const mode of ['project', 'logout', 'name']) {
    const { state, host } = fixture();
    await host.open('agents');
    const backend = option(state.panels[0].webview.html, 'backend', 'FastAPI');
    await state.send('backend', backend);
    await state.send('name', undefined, { name: 'my-agent' });
    await state.send('dedicated');
    await state.send(
      'model',
      option(state.panels[0].webview.html, 'model', 'model-a'),
    );
    state.picks.push((choices) => choices[0]);
    state.confirms.push(async () => {
      if (mode === 'name')
        await state.send('name', undefined, { name: 'other-agent' });
      else {
        state.modelContext = {
          ...state.modelContext,
          key: 'changed',
          projectId: mode === 'logout' ? undefined : 'other',
          rows: [],
        };
        host.modelsChanged();
      }
      return 'Créer dans le projet';
    });
    await state.send('create', backend);
    assert.equal(state.creates.length, mode === 'name' ? 1 : 0);
    if (mode === 'name') assert.equal(state.creates[0][1], 'my-agent');
  }
});
test('agent template creation permits no deployed model and language changes clear both stack components', async () => {
  const { state, host } = fixture();
  state.modelContext = { key: '', status: 'Non chargés', rows: [] };
  await host.open('agents', 'template-create');
  const backend = option(state.panels[0].webview.html, 'backend', 'FastAPI');
  await state.send('backend', backend);
  await state.send('ai', option(state.panels[0].webview.html, 'ai', 'Strands'));
  await state.send('name', undefined, { name: 'my-template' });
  state.picks.push('Utilisateur');
  state.confirms.push('Créer le template');
  await state.send('create', backend);
  assert.equal(state.writes.length, 1);
  assert.equal(state.creates.length, 0);
  await host.open('agents');
  await state.send(
    'backend',
    option(state.panels[0].webview.html, 'backend', 'FastAPI'),
  );
  await state.send(
    'language',
    option(state.panels[0].webview.html, 'language', 'Rust'),
  );
  assert.equal(host.backend, undefined);
  assert.equal(host.ai, undefined);
  assert.equal(host.selected, undefined);
  assert.doesNotMatch(
    state.panels[0].webview.html.match(
      /select data-action="ai"[^>]*>(.*?)<\/select>/,
    )[1],
    /Strands|LangChain|Mastra/,
  );
});

test('agent clear-backend and clear-IA preserve the other selection, clear-model removes create readiness', async () => {
  const { state, host } = fixture();
  await host.open('agents');
  const backend = option(state.panels[0].webview.html, 'backend', 'FastAPI');
  await state.send('backend', backend);
  const ai = option(state.panels[0].webview.html, 'ai', 'Strands');
  await state.send('ai', ai);
  await state.send('clearBackend');
  assert.equal(host.backend, undefined);
  assert.equal(host.ai, ai);
  assert.equal(host.selected, ai);
  await state.send('backend', backend);
  await state.send('clearAi');
  assert.equal(host.ai, undefined);
  assert.equal(host.backend, backend);
  assert.equal(host.selected, backend);
  await state.send('dedicated');
  await state.send(
    'model',
    option(state.panels[0].webview.html, 'model', 'model-a'),
  );
  await state.send('clearModel');
  assert.equal(host.modelIndex, undefined);
});

test('opening agent creation automatically loads deployments without visiting Models', async () => {
  const { state, host } = fixture();
  state.modelContext = {
    key: 'scope',
    projectId: '22222222-2222-2222-2222-222222222222',
    status: 'Non chargés',
    rows: [],
  };
  let reads = 0;
  state.refreshModels = async () => {
    reads++;
    state.modelContext = {
      ...state.modelContext,
      status: 'fr-par · projet sélectionné',
      rows: [
        {
          id: 'deployment',
          label: 'Loaded model',
          kind: 'dedicated',
          status: 'ready',
          deploymentInfo: {
            projectId: '22222222-2222-2222-2222-222222222222',
            region: 'fr-par',
            modelId: 'model',
          },
        },
      ],
    };
  };
  await host.open('agents');
  assert.equal(reads, 1);
  assert.ok(state.modelMessages.every((m) => m.models.length === 0));
  await state.send('dedicated');
  assert.match(state.panels[0].webview.html, /model · Dédié/);
  assert.equal(state.creates.length, 0);
});
test('tools, template pages and untrusted creation do not auto-read cloud deployments', async () => {
  for (const [kind, mode] of [
    ['tools', 'create'],
    ['agents', 'templates'],
    ['agents', 'template-create'],
  ]) {
    const { state, host } = fixture();
    await host.open(kind, mode);
    assert.equal(state.modelRefreshes, undefined);
  }
  const { state, host, workspace } = fixture();
  workspace.isTrusted = false;
  await host.open('agents');
  assert.equal(state.modelRefreshes, undefined);
});
test('agent auto-load displays form immediately and coalesces manual refresh while pending', async () => {
  const { state, host } = fixture();
  let release;
  let reads = 0;
  state.refreshModels = () => {
    reads++;
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  const opening = host.open('agents');
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  assert.match(state.panels[0].webview.html, /Modèle Serverless/);
  const manual = state.send('refreshModels');
  assert.equal(reads, 1);
  release();
  await Promise.all([opening, manual]);
  assert.equal(reads, 1);
});
test('late auto-read cannot resurrect disposed panel or publish deployments in wrong project', async () => {
  const { state, host } = fixture();
  let release;
  state.refreshModels = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const opening = host.open('agents');
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  state.modelContext = {
    ...state.modelContext,
    key: 'other',
    projectId: 'other',
  };
  release();
  await opening;
  assert.doesNotMatch(state.panels[0].webview.html, /Mistral déployé/);
  const second = host.open('agents');
  while (!host.modelLoad) await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  host.dispose();
  release();
  await second;
  assert.equal(host.panel, undefined);
});

test('Serverless DeepSeek resource appears and can initialize agent despite no dedicated services', async () => {
  const { state, host } = fixture();
  state.modelContext = {
    key: 'scope',
    projectId: '22222222-2222-2222-2222-222222222222',
    status: 'Aucun déploiement',
    rows: [
      {
        id: 'deepseek-v4.1-flash',
        label: 'deepseek-v4.1-flash',
        kind: 'serverless',
        serverlessAvailability: 'Disponible',
        llmAccess: configuredAccess('22222222-2222-2222-2222-222222222222'),
      },
    ],
  };
  await host.open('agents');
  assert.match(
    state.panels[0].webview.html,
    /deepseek-v4.1-flash · Serverless/,
  );
  const backend = option(state.panels[0].webview.html, 'backend', 'FastAPI');
  await state.send('backend', backend);
  await state.send('name', undefined, { name: 'deepseek-agent' });
  await state.send(
    'model',
    option(state.panels[0].webview.html, 'model', 'deepseek-v4.1-flash'),
  );
  state.picks.push((choices) => choices[0]);
  state.confirms.push('Créer dans le projet');
  await state.send('create', backend);
  assert.equal(state.creates.length, 1);
  const note = JSON.parse(state.creates[0][2].files['agent.authoring.json']);
  assert.equal(note.selected_model.model_id, 'deepseek-v4.1-flash');
  assert.equal(
    note.selected_model.project_id,
    '22222222-2222-2222-2222-222222222222',
  );
  assert.equal(note.selected_deployment, undefined);
  state.modelContext = {
    ...state.modelContext,
    key: 'logout',
    projectId: undefined,
    rows: [],
  };
  host.modelsChanged();
  assert.doesNotMatch(state.panels[0].webview.html, /deepseek-v4.1-flash/);
  assert.equal(host.modelIndex, undefined);
});

test('agent secret is read only after creation consent and never enters public payload/browser', async () => {
  const { state, host } = fixture();
  await host.open('agents');
  host.chooseWorkspace = () =>
    assert.fail('No late workspace picker for agent');
  host.destination = { scheme: 'file', fsPath: '/selected/output' };
  const row = option(state.panels[0].webview.html, 'backend', 'FastAPI');
  await state.send('backend', row);
  await state.send('name', undefined, { name: 'private-agent' });
  await state.send('dedicated');
  await state.send(
    'model',
    option(state.panels[0].webview.html, 'model', 'model-a'),
  );
  assert.equal(state.secretReads, undefined);
  await state.send('create', row);
  assert.equal(state.secretReads, undefined);
  assert.equal(state.creates.length, 0);
  state.confirms.push('Créer dans le projet');
  await state.send('create', row);
  assert.equal(state.secretReads, 1);
  assert.equal(state.creates[0][0], '/selected/output');
  assert.equal(state.credentialDisposals, 1);
  assert.equal(state.credentialArgs[0], state.modelContext.projectId);
  assert.equal(state.credentialArgs[1], state.modelContext.rows[0]);
  const key = '33333333-3333-3333-3333-333333333333';
  assert.ok(state.envContent.includes(key));
  assert.ok(!JSON.stringify(state.creates[0][2]).includes(key));
  assert.ok(!state.panels[0].webview.html.includes(key));
  assert.ok(!JSON.stringify(state.warningArgs).includes(key));
});

test('refreshing same model scope preserves IDs and selection without rebuilding form', async () => {
  const { state, host } = fixture();
  await host.open('agents');
  const backend = option(state.panels[0].webview.html, 'backend', 'FastAPI');
  await state.send('backend', backend);
  await state.send('dedicated');
  const model = option(state.panels[0].webview.html, 'model', 'model-a');
  await state.send('model', model);
  await state.send('name', undefined, { name: 'keep-name' });
  const html = state.panels[0].webview.html;
  state.refreshModels = async () => {
    state.modelContext = {
      ...state.modelContext,
      rows: state.modelContext.rows.map((r) => ({
        ...r,
        label: 'https://endpoint.invalid',
        status: 'ready',
      })),
    };
    host.modelsChanged();
  };
  await state.send('refreshModels');
  assert.equal(state.panels[0].webview.html, html);
  assert.equal(host.modelIndex, model);
  assert.equal(host.backend, backend);
  assert.equal(host.agentName, 'keep-name');
  assert.equal(state.modelMessages.at(-1).selected, model);
  assert.ok(!state.modelMessages.at(-1).models[0].label.includes('https://'));
});

test('browser model selector click refreshes once without separate button; keyboard supported', () => {
  const messages = [];
  const listeners = {};
  const script = fs.readFileSync(
    path.join(__dirname, '../media/localCreation.js'),
    'utf8',
  );
  vm.runInNewContext(script, {
    acquireVsCodeApi: () => ({ postMessage: (m) => messages.push(m) }),
    window: { addEventListener() {} },
    document: {
      body: { dataset: { token } },
      addEventListener: (type, fn) => {
        listeners[type] = fn;
      },
    },
  });
  const target = {
    closest: (selector) => (selector.startsWith('select') ? {} : null),
  };
  listeners.click({ target });
  listeners.click({ target });
  listeners.keydown({ target, key: 'ArrowDown' });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].action, 'refreshModels');
  const { state, host } = fixture();
  return host
    .open('agents')
    .then(() =>
      assert.ok(
        !state.panels[0].webview.html.includes(
          'Actualiser les modèles déployés',
        ),
      ),
    );
});

function addServerless(state) {
  state.modelContext.rows.push({
    id: 'serverless-test',
    label: 'serverless-test',
    kind: 'serverless',
    serverlessAvailability: 'Disponible',
    llmAccess: configuredAccess(state.modelContext.projectId),
  });
}

test('service toggle filters mixed resources, resets only model and rotates stale identities', async () => {
  const { state, host, api } = fixture();
  addServerless(state);
  for (const action of ['serverless', 'dedicated']) {
    assert.equal(api.parseCreationInput({ action, token }).action, action);
    assert.equal(api.parseCreationInput({ action, token, index }), undefined);
  }
  await host.open('agents');
  let html = state.panels[0].webview.html;
  assert.match(html, /role="group" aria-label="Type de service"/);
  assert.match(html, /data-action="serverless" aria-pressed="true"/);
  assert.match(html, /data-action="dedicated" aria-pressed="false"/);
  assert.match(html, /Modèle Serverless/);
  assert.doesNotMatch(html, /model-a · Dédié|Modèle déployé/);
  const backend = option(html, 'backend', 'FastAPI');
  await state.send('backend', backend);
  const ai = option(state.panels[0].webview.html, 'ai', 'Strands');
  await state.send('ai', ai);
  await state.send('name', undefined, { name: 'keep-agent' });
  const serverless = option(
    state.panels[0].webview.html,
    'model',
    'serverless-test',
  );
  await state.send('model', serverless);
  html = state.panels[0].webview.html;
  const staleToken = html.match(/data-token="([a-f0-9]+)"/)[1];
  await state.send('dedicated');
  html = state.panels[0].webview.html;
  assert.notEqual(html.match(/data-token="([a-f0-9]+)"/)[1], staleToken);
  assert.equal(host.modelIndex, undefined);
  assert.equal(host.backend, backend);
  assert.equal(host.ai, ai);
  assert.equal(host.agentName, 'keep-agent');
  assert.equal(host.selected, backend);
  assert.match(html, /data-action="dedicated" aria-pressed="true"/);
  assert.match(html, /Déploiement dédié/);
  assert.match(html, /value="keep-agent"/);
  assert.doesNotMatch(html, /serverless-test/);
  assert.match(html, /data-ready="false"[^>]* disabled/);
  await state.panels[0].receive({ action: 'serverless', token: staleToken });
  assert.equal(host.serviceKind, 'dedicated');
  await state.send('model', serverless);
  assert.equal(host.modelIndex, undefined);
  const dedicated = option(html, 'model', 'model-a');
  await state.send('model', dedicated);
  const unchanged = state.panels[0].webview.html;
  await state.send('dedicated');
  assert.equal(state.panels[0].webview.html, unchanged);
  assert.equal(host.modelIndex, dedicated);
  await state.send('serverless');
  assert.equal(host.modelIndex, undefined);
  assert.notEqual(
    option(state.panels[0].webview.html, 'model', 'serverless-test'),
    serverless,
  );
  await state.send('model', dedicated);
  assert.equal(host.modelIndex, undefined);
  await host.open('agents');
  assert.equal(host.serviceKind, 'serverless');
});

test('service toggle is absent and actions inert on tools and template forms; disabled without trust', async () => {
  for (const [kind, mode] of [
    ['tools', 'create'],
    ['tools', 'template-create'],
    ['agents', 'templates'],
    ['agents', 'template-create'],
  ]) {
    const { state, host } = fixture();
    addServerless(state);
    await host.open(kind, mode);
    const html = state.panels[0].webview.html;
    assert.doesNotMatch(
      html,
      /data-action="serverless"|data-action="dedicated"/,
    );
    await state.send('dedicated');
    assert.equal(host.serviceKind, 'serverless');
    assert.equal(state.panels[0].webview.html, html);
    if (kind === 'agents' && mode === 'template-create') {
      assert.match(html, /serverless-test/);
      assert.match(html, /model-a · Dédié/);
    }
  }
  const { state, host, workspace } = fixture();
  workspace.isTrusted = false;
  await host.open('agents');
  assert.match(
    state.panels[0].webview.html,
    /data-action="dedicated" aria-pressed="false" disabled/,
  );
  await state.send('dedicated');
  assert.equal(host.serviceKind, 'serverless');
});

test('pending refresh after service change sends only current kind under rotated token', async () => {
  const { state, host } = fixture();
  addServerless(state);
  await host.open('agents');
  let release;
  state.refreshModels = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const refresh = state.send('refreshModels');
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  const oldToken = state.panels[0].webview.html.match(
    /data-token="([a-f0-9]+)"/,
  )[1];
  await state.send('dedicated');
  const dedicated = option(state.panels[0].webview.html, 'model', 'model-a');
  await state.send('model', dedicated);
  const html = state.panels[0].webview.html;
  state.modelContext = {
    ...state.modelContext,
    rows: state.modelContext.rows.map((r) => ({ ...r, label: 'updated' })),
  };
  host.modelsChanged();
  const message = state.modelMessages.at(-1);
  assert.notEqual(message.token, oldToken);
  assert.equal(message.token, html.match(/data-token="([a-f0-9]+)"/)[1]);
  assert.equal(message.selected, dedicated);
  assert.equal(message.models.length, 1);
  assert.match(message.models[0].label, /Dédié/);
  assert.equal(state.panels[0].webview.html, html);
  release();
  await refresh;
});

test('browser toggle uses closed click IPC and model updates retain kind-specific placeholders', () => {
  const messages = [];
  const listeners = {};
  let receive;
  const select = {
    dataset: {
      placeholder: 'Sélectionner un déploiement dédié',
      empty: 'Aucun déploiement dédié chargé',
    },
    replaceChildren(...options) {
      this.options = options;
    },
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../media/localCreation.js'), 'utf8'),
    {
      acquireVsCodeApi: () => ({ postMessage: (m) => messages.push(m) }),
      window: {
        addEventListener: (_, fn) => {
          receive = fn;
        },
      },
      document: {
        body: { dataset: { token } },
        addEventListener: (type, fn) => {
          listeners[type] = fn;
        },
        querySelector: (selector) =>
          selector.startsWith('select') ? select : null,
        createElement: () => ({}),
      },
    },
  );
  const button = { dataset: { action: 'dedicated' }, disabled: false };
  listeners.click({
    target: {
      closest: (selector) => (selector.startsWith('button') ? button : null),
    },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(messages[0])), {
    action: 'dedicated',
    token,
  });
  button.disabled = true;
  listeners.click({
    target: {
      closest: (selector) => (selector.startsWith('button') ? button : null),
    },
  });
  assert.equal(messages.length, 1);
  receive({
    data: {
      type: 'creation-models',
      token,
      revision: 1,
      models: [{ index, label: 'dedicated-model' }],
      selected: index,
    },
  });
  assert.equal(select.options[0].textContent, select.dataset.placeholder);
  assert.equal(select.value, index);
  receive({
    data: {
      type: 'creation-models',
      token: 'c'.repeat(48),
      revision: 2,
      models: [],
      selected: '',
    },
  });
  assert.equal(select.value, index);
  receive({
    data: {
      type: 'creation-models',
      token,
      revision: 2,
      models: [],
      selected: '',
    },
  });
  assert.equal(select.options[0].textContent, select.dataset.empty);
  assert.equal(select.value, '');
  receive({
    data: {
      type: 'creation-models',
      token,
      revision: 1,
      models: [{ index, label: 'stale' }],
      selected: index,
    },
  });
  assert.equal(select.value, '');
});

test('Serverless dropdown accepts public models but rejects stale configured proofs', async () => {
  const { state, host } = fixture();
  addServerless(state);
  const model = state.modelContext.rows.at(-1);
  state.modelContext.rows.push(
    { ...model, id: 'missing-access', llmAccess: undefined },
    {
      ...model,
      id: 'expired-access',
      llmAccess: { ...model.llmAccess, expiresAt: Date.now() - 1 },
    },
    {
      ...model,
      id: 'foreign-access',
      llmAccess: { ...model.llmAccess, projectId: 'other' },
    },
    {
      ...model,
      id: 'unverified-availability',
      serverlessAvailability: undefined,
    },
    {
      ...model,
      id: 'unavailable-access',
      serverlessAvailability: 'Absent de la liste',
    },
  );
  await host.open('agents');
  const html = state.panels[0].webview.html;
  assert.match(html, /serverless-test · Serverless/);
  assert.doesNotMatch(
    html,
    /expired-access|foreign-access|unverified-availability|unavailable-access/,
  );
  state.refreshModels = async () => {
    await Promise.resolve();
    state.modelContext = { ...state.modelContext, key: 'refreshed-scope' };
    host.modelsChanged();
  };
  await state.send('refreshModels');
  assert.deepEqual(
    Array.from(state.modelMessages.at(-1).models, (m) => m.label),
    ['serverless-test · Serverless', 'missing-access · Serverless'],
  );
});

test('agent awaits selected Application IAM credential scope and copies its distinct key only after consent', async () => {
  const { state, host } = fixture();
  addServerless(state);
  const model = state.modelContext.rows.at(-1);
  model.llmAccess = configuredAccess(
    state.modelContext.projectId,
    'application',
  );
  state.asyncCredentials = true;
  await host.open('agents');
  assert.match(state.panels[0].webview.html, /serverless-test · Serverless/);
  const backend = option(state.panels[0].webview.html, 'backend', 'FastAPI');
  await state.send('backend', backend);
  await state.send('name', undefined, { name: 'application-agent' });
  await state.send(
    'model',
    option(state.panels[0].webview.html, 'model', model.id),
  );
  state.picks.push((choices) => choices[0]);
  await state.send('create', backend);
  assert.equal(state.credentialScopes, undefined);
  assert.equal(state.secretReads, undefined);
  assert.equal(state.creates.length, 0);
  state.picks.push((choices) => choices[0]);
  state.confirms.push('Créer dans le projet');
  await state.send('create', backend);
  assert.equal(state.creates.length, 1);
  assert.equal(state.credentialArgs[0], state.modelContext.projectId);
  assert.equal(state.credentialArgs[1], model);
  assert.equal(state.credentialScopes, 1);
  assert.equal(state.secretReads, 1);
  assert.equal(state.credentialDisposals, 1);
  assert.match(state.envContent, /SCW_INFERENCE_MODEL_ID='serverless-test'/);
  assert.ok(state.envContent.includes(applicationKey));
  assert.ok(!state.envContent.includes(userKey));
  for (const payload of [
    state.creates[0][2],
    state.panels[0].webview.html,
    state.modelMessages,
    state.warningArgs,
  ])
    assert.ok(!JSON.stringify(payload ?? null).includes(applicationKey));
});

test('agent form preselects unique workspace and permits native destination before create without late picker', async () => {
  const { host, state } = fixture();
  await host.open('agents', 'create');
  assert.match(host.panel.webview.html, /Chemin du projet/);
  assert.equal(host.destination.fsPath, '/mock/project');
  await host.receive({
    action: 'name',
    token: host.token,
    name: 'destination-agent',
  });
  const originalBackend = host.backend,
    originalAi = host.ai;
  state.filePick = [{ scheme: 'file', fsPath: '/selected/output' }];
  await host.receive({ action: 'destination', token: host.token });
  assert.equal(host.destination.fsPath, '/selected/output');
  assert.equal(host.agentName, 'destination-agent');
  assert.equal(host.backend, originalBackend);
  assert.equal(host.ai, originalAi);
  assert.equal(state.pickerOptions.canSelectFiles, false);
  assert.equal(state.pickerOptions.canSelectFolders, true);
  assert.equal(state.pickerOptions.canSelectMany, false);
  assert.match(
    host.panel.webview.html,
    /value="\/selected\/output\/destination-agent"/,
  );
  state.filePick = undefined;
  await host.receive({ action: 'destination', token: host.token });
  assert.equal(host.destination.fsPath, '/selected/output');
  host.chooseWorkspace = () =>
    assert.fail('No late workspace selection for agent');
});
test('destination protocol refuses browser paths and excludes tools/templates', async () => {
  const { host, state, workspace, api } = fixture();
  assert.equal(
    api.parseCreationInput({ action: 'destination', token, path: '/injected' }),
    undefined,
  );
  assert.deepEqual(
    { ...api.parseCreationInput({ action: 'destination', token }) },
    {
      action: 'destination',
      token,
    },
  );
  await host.open('tools', 'create');
  assert.ok(!host.panel.webview.html.includes('data-action="destination"'));
  await host.receive({ action: 'destination', token: host.token });
  assert.equal(state.pickerOptions, undefined);
  await host.open('agents', 'template-create');
  assert.ok(!host.panel.webview.html.includes('data-action="destination"'));
  workspace.workspaceFolders.push({
    name: 'Other',
    uri: { scheme: 'file', fsPath: '/other', toString: () => '/other' },
  });
  await host.open('agents', 'create');
  assert.equal(host.destination.fsPath, '/mock/project');
  state.filePick = [{ scheme: 'vscode-remote', fsPath: '/remote' }];
  await host.receive({ action: 'destination', token: host.token });
  assert.equal(host.destination.fsPath, '/mock/project');
  assert.match(host.panel.webview.html, /value="" placeholder="mon-agent ou/);
});

for (const action of ['language', 'backend', 'ai', 'model', 'destination']) {
  test(`host-chosen ${action} focus is restored without browser persistence`, () => {
    const listeners = {},
      focuses = [],
      messages = [];
    const control = {
      disabled: false,
      focus: (options) => focuses.push(options),
    };
    vm.runInNewContext(
      fs.readFileSync(
        path.join(__dirname, '../media/localCreation.js'),
        'utf8',
      ),
      {
        acquireVsCodeApi: () => ({
          postMessage: (m) => messages.push(m),
          setState: () => assert.fail('no browser persistence'),
        }),
        window: {
          addEventListener: (type, fn) => {
            listeners[type] = fn;
          },
        },
        document: {
          body: { dataset: { token, focusAction: action } },
          querySelector: (selector) => {
            assert.equal(selector, '[data-action="' + action + '"]');
            return control;
          },
          addEventListener() {},
        },
      },
    );
    assert.equal(focuses.length, 1);
    assert.equal(focuses[0].preventScroll, true);
    assert.deepEqual(messages, []);
  });
}

test('unrecognized host focus never becomes an arbitrary DOM selector', () => {
  let queries = 0;
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../media/localCreation.js'), 'utf8'),
    {
      acquireVsCodeApi: () => ({
        postMessage: () => assert.fail('no IPC on focus'),
      }),
      window: { addEventListener() {} },
      document: {
        body: { dataset: { token, focusAction: '" onclick="x' } },
        querySelector: () => {
          queries++;
        },
        addEventListener() {},
      },
    },
  );
  assert.equal(queries, 0);
});

test('Given external destination, When an agent is confirmed, Then real exclusive files and selected private env are created and post-create handoff is reached without registration', async (t) => {
  const fsp = require('node:fs/promises');
  const external = await fsp.mkdtemp(
    path.join(require('node:os').tmpdir(), 'scw-external-creation-'),
  );
  t.after(() => fsp.rm(external, { recursive: true, force: true }));
  const { state, host, vscode } = fixture();
  state.openEntry = actualModule('localAgentRunner', {
    vscode,
  }).openLocalAgentEntry;
  state.openDocument = async (uri) => ({ uri, isClosed: false });
  const actualWriter = actualModule('agentScaffold').materializeTemplate;
  state.materialize = async (...args) => {
    state.creates.push(args);
    return actualWriter(...args);
  };
  await host.open('agents');
  const panel = state.panels[0];
  state.filePick = [
    { scheme: 'file', fsPath: external, toString: () => 'file:' + external },
  ];
  addServerless(state);
  await host.open('agents');
  await state.send('destination');
  const backend = option(panel.webview.html, 'backend', 'FastAPI');
  await state.send('backend', backend);
  await state.send('ai', option(panel.webview.html, 'ai', 'Strands'));
  await state.send('name', undefined, { name: 'external-agent' });
  await state.send(
    'model',
    option(panel.webview.html, 'model', 'serverless-test'),
  );
  state.confirms.push('Créer dans le projet');
  await state.send('create', backend);
  const project = path.join(external, 'external-agent');
  assert.equal(state.creates.length, 1);
  assert.equal(state.postCreate.project, project);
  assert.match(panel.webview.html, /Projet créé, environnement Python préparé/);
  assert.deepEqual(state.preparedPython, [project]);
  assert.deepEqual(state.configuredPython, [project]);
  assert.deepEqual(state.openedEntries, [project]);
  assert.equal(
    state.shows[0].uri.fsPath,
    path.join(project, 'src/agent_app/service_api.py'),
  );
  assert.deepEqual(state.showOptions, { preview: false });
  assert.deepEqual(state.creationOrder, [
    'prepare',
    'open',
    'root-registration',
  ]);
  assert.match(panel.webview.html, /Python avec uv préparé automatiquement/);
  assert.doesNotMatch(
    panel.webview.html,
    /inventaire non enregistré|Action refusée/,
  );
  assert.ok(
    (await fsp.stat(path.join(project, 'src/agent_app/api.py'))).isFile(),
  );
  assert.match(
    await fsp.readFile(path.join(project, '.env'), 'utf8'),
    /SCW_API_KEY=/,
  );
  assert.equal(
    (await fsp.stat(path.join(project, '.env'))).mode & 0o777,
    0o600,
  );
  const before = await fsp.readFile(path.join(project, '.env'), 'utf8');
  state.confirms.push('Créer dans le projet');
  await state.send('create', backend);
  assert.equal(await fsp.readFile(path.join(project, '.env'), 'utf8'), before);
  assert.equal(
    state.creates.length,
    2,
    'one explicit attempted retry, never automatic',
  );
});

test('Given agent stack and shared inputs, When switching tabs and returning, Then each selection is retained and no generation or credential access occurs', async () => {
  const { state, host } = fixture();
  await host.open('agents');
  const panel = state.panels[0];
  assert.match(
    panel.webview.html,
    /id="choice-stack"[^>]*aria-selected="true" tabindex="0"/,
  );
  assert.match(panel.webview.html, /id="panel-template"[^>]* hidden/);
  const backend = option(panel.webview.html, 'backend', 'FastAPI');
  await state.send('backend', backend);
  const ai = option(panel.webview.html, 'ai', 'Strands');
  await state.send('ai', ai);
  assert.doesNotMatch(panel.webview.html, /class="selection"/);
  assert.doesNotMatch(
    panel.webview.html,
    /<p(?:\s[^>]*)?>[^<]*(?:FastAPI · Strands · Python|Base backend · SDK agent à intégrer)/,
  );
  assert.equal(option(panel.webview.html, 'backend', 'FastAPI'), backend);
  assert.equal(option(panel.webview.html, 'ai', 'Strands'), ai);
  await state.send('name', undefined, { name: 'retained-agent' });
  await state.send('dedicated');
  const model = option(panel.webview.html, 'model', 'model-a');
  await state.send('model', model);
  const destination = host.destination.fsPath;
  const templateRow = host.rows.find((r) => !r.stack).index;
  const stale = host.token;
  await state.send('chooseTemplate');
  assert.equal(host.selected, undefined);
  assert.match(panel.webview.html, /id="panel-stack"[^>]* hidden/);
  assert.match(
    panel.webview.html,
    /id="choice-template"[^>]*aria-selected="true" tabindex="0"/,
  );
  assert.equal(
    (panel.webview.html.match(/data-action="name"/g) || []).length,
    1,
  );
  assert.equal(
    (panel.webview.html.match(/data-action="model"/g) || []).length,
    1,
  );
  await host.receive({ action: 'chooseStack', token: stale });
  assert.equal(host.creationTab, 'template');
  await state.send('backend', backend);
  assert.equal(host.selected, undefined);
  await state.send('create', backend);
  assert.equal(state.creates.length, 0);
  await state.send('preview', templateRow);
  assert.equal(host.selected, templateRow);
  await state.send('chooseStack');
  assert.equal(host.selected, backend);
  assert.equal(host.backend, backend);
  assert.equal(host.ai, ai);
  assert.equal(host.modelIndex, model);
  assert.equal(host.agentName, 'retained-agent');
  assert.equal(host.destination.fsPath, destination);
  assert.equal(host.serviceKind, 'dedicated');
  await state.send('chooseTemplate');
  assert.equal(host.selected, templateRow);
  assert.match(panel.webview.html, /data-focus-action="chooseTemplate"/);
  assert.equal(state.creates.length, 0);
  assert.equal(state.writes.length, 0);
  assert.equal(state.confirms.length, 0);
  assert.equal(state.credentialScopes ?? 0, 0);
  assert.equal(state.secretReads ?? 0, 0);
});

test('Given a retained stack, When creating from the active template, Then only the template payload is generated', async () => {
  const { state, host } = fixture();
  await host.open('agents');
  await state.send(
    'backend',
    option(state.panels[0].webview.html, 'backend', 'FastAPI'),
  );
  await state.send('chooseTemplate');
  const row = host.rows.find((r) => !r.stack);
  await state.send('preview', row.index);
  await state.send('name', undefined, { name: 'template-agent' });
  await state.send('dedicated');
  await state.send(
    'model',
    option(state.panels[0].webview.html, 'model', 'model-a'),
  );
  state.confirms.push('Créer dans le projet');
  await state.send('create', row.index);
  assert.equal(state.creates.length, 1);
  const files = state.creates[0][2].files;
  for (const name of Object.keys(row.template.files))
    assert.ok(Object.hasOwn(files, name), name);
  assert.equal(host.backend !== undefined, true);
  const note = JSON.parse(files['agent.creation.json']);
  assert.equal(note.template_id, row.template.id);
  assert.equal(Object.hasOwn(note, 'backend'), false);
  assert.equal(Object.hasOwn(note, 'ai_framework'), false);
  assert.equal(
    Object.keys(files).some((name) => name.includes('routes')),
    false,
  );
});

test('Given tabs, When keyboard navigation changes the active choice, Then the closed protocol carries only the choice and token', () => {
  const listeners = {},
    messages = [];
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../media/localCreation.js'), 'utf8'),
    {
      acquireVsCodeApi: () => ({ postMessage: (m) => messages.push(m) }),
      window: { addEventListener() {} },
      document: {
        body: { dataset: { token } },
        addEventListener: (type, fn) => {
          listeners[type] = fn;
        },
      },
    },
  );
  for (const [key, expected] of [
    ['ArrowRight', 'chooseTemplate'],
    ['ArrowLeft', 'chooseTemplate'],
    ['Home', 'chooseStack'],
    ['End', 'chooseTemplate'],
  ]) {
    let prevented = false;
    const tab = { disabled: false, dataset: { action: 'chooseStack' } };
    listeners.keydown({
      key,
      target: {
        closest: (selector) => (selector.includes('role=') ? tab : null),
      },
      preventDefault: () => {
        prevented = true;
      },
    });
    assert.equal(prevented, true);
    assert.equal(messages.at(-1).action, expected);
    assert.deepEqual(Object.keys(messages.at(-1)).sort(), ['action', 'token']);
  }
});

test('Given other creation modes, When tab actions arrive, Then they are inert and no tablist is rendered', async () => {
  for (const [kind, mode] of [
    ['tools', 'create'],
    ['agents', 'template-create'],
    ['agents', 'templates'],
  ]) {
    const { state, host } = fixture();
    await host.open(kind, mode);
    const html = state.panels[0].webview.html;
    assert.doesNotMatch(html, /role="tablist"/);
    await state.send('chooseTemplate');
    assert.equal(state.panels[0].webview.html, html);
    assert.equal(state.creates.length, 0);
  }
});

test('Given agent name retained, When parent or tab changes, Then host rendered projected path reflects the same parent/name and chooser stays available', async () => {
  const { state, host } = fixture();
  await host.open('agents');
  await state.send('name', undefined, { name: 'path-agent' });
  state.filePick = [
    { scheme: 'file', fsPath: '/chosen/output', query: '', fragment: '' },
  ];
  await state.send('destination');
  assert.match(
    state.panels[0].webview.html,
    /value="\/chosen\/output\/path-agent"/,
  );
  assert.match(state.panels[0].webview.html, /data-action="destination"/);
  await state.send('chooseTemplate');
  assert.match(state.panels[0].webview.html, /\/chosen\/output\/path-agent/);
  assert.equal(state.creates.length, 0);
});

test('Final path protocol is bounded and only applies to agent project creation', async () => {
  const { api, host } = fixture();
  for (const pathValue of ['demo', '/tmp/demo', 'nested/demo', ''])
    assert.equal(
      api.parseCreationInput({ action: 'projectPath', token, path: pathValue })
        .path,
      pathValue,
    );
  for (const pathValue of [
    'x'.repeat(4097),
    'bad' + String.fromCharCode(0),
    42,
  ])
    assert.equal(
      api.parseCreationInput({ action: 'projectPath', token, path: pathValue }),
      undefined,
    );
  assert.equal(
    api.parseCreationInput({
      action: 'projectPath',
      token,
      path: 'demo',
      extra: true,
    }),
    undefined,
  );
  await host.open('tools');
  await host.receive({
    action: 'projectPath',
    token: host.token,
    path: 'injected',
  });
  assert.equal(host.projectPath, undefined);
});
test('One editable path resets on name changes and remains stable across tabs', async () => {
  const { host, state } = fixture();
  await host.open('agents');
  await state.send('name', undefined, { name: 'demo' });
  await state.send('projectPath', undefined, { path: 'chosen-project' });
  await state.send('name', undefined, { name: 'another-agent' });
  await state.send('chooseTemplate');
  assert.equal(host.projectPath, '/mock/project/another-agent');
  const html = host.panel.webview.html;
  assert.equal((html.match(/id="project-path"/g) || []).length, 1);
  assert.match(html, /data-action="projectPath"/);
  assert.match(html, /another-agent/);
  assert.doesNotMatch(
    html,
    /data-destination-parent|project-path-preview|Chemin de création prévu/,
  );
});
test('Typed final relative path creates directly in workspace without adding agent name', async () => {
  const { host, state } = fixture();
  addServerless(state);
  await host.open('agents');
  const backend = option(host.panel.webview.html, 'backend', 'FastAPI');
  await state.send('backend', backend);
  await state.send('name', undefined, { name: 'different-agent-name' });
  await state.send(
    'model',
    option(host.panel.webview.html, 'model', 'serverless-test'),
  );
  await state.send('projectPath', undefined, { path: 'test-agent' });
  state.confirms.push('Créer dans le projet');
  await state.send('create', backend);
  assert.equal(state.creates.length, 1);
  assert.equal(state.creates[0][0], '/mock/project');
  assert.equal(state.creates[0][1], 'test-agent');
  assert.equal(state.postCreate.project, '/mock/project/test-agent');
});
test('Typed absolute final path and traversal/ambiguous workspace guards', async () => {
  for (const scenario of ['absolute', 'traversal', 'empty', 'ambiguous']) {
    const { host, state, workspace } = fixture();
    addServerless(state);
    if (scenario === 'ambiguous')
      workspace.workspaceFolders.push({
        name: 'Other',
        uri: { scheme: 'file', fsPath: '/other', toString: () => '/other' },
      });
    await host.open('agents');
    const backend = option(host.panel.webview.html, 'backend', 'FastAPI');
    await state.send('backend', backend);
    await state.send('name', undefined, { name: 'demo' });
    await state.send(
      'model',
      option(host.panel.webview.html, 'model', 'serverless-test'),
    );
    await state.send('projectPath', undefined, {
      path:
        scenario === 'absolute'
          ? '/chosen/final-project'
          : scenario === 'traversal'
            ? '../escape'
            : scenario === 'empty'
              ? ''
              : 'relative-project',
    });
    state.confirms.push('Créer dans le projet');
    await state.send('create', backend);
    if (['absolute', 'ambiguous'].includes(scenario)) {
      assert.equal(
        state.creates[0][0],
        scenario === 'absolute' ? '/chosen' : '/mock/project',
      );
      assert.equal(
        state.creates[0][1],
        scenario === 'absolute' ? 'final-project' : 'relative-project',
      );
    } else {
      assert.equal(state.creates.length, 0);
      assert.equal(state.credentialScopes, undefined);
      assert.match(host.panel.webview.html, /chemin final absolu/);
    }
  }
});
test('Browser synchronizes path on every name change including after manual edits', () => {
  const listeners = {},
    messages = [];
  const name = { value: 'demo', dataset: {}, setCustomValidity() {} };
  const destination = {
    value: '',
    dataset: { base: '/workspace', edited: 'false' },
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../media/localCreation.js'), 'utf8'),
    {
      acquireVsCodeApi: () => ({ postMessage: (m) => messages.push(m) }),
      window: { addEventListener() {} },
      document: {
        body: { dataset: { token } },
        querySelector: (selector) =>
          selector === 'input[data-action="projectPath"]' ? destination : null,
        addEventListener: (type, fn) => (listeners[type] = fn),
      },
    },
  );
  const input = (field) =>
    listeners.input({
      target: {
        closest: (selector) =>
          selector === 'input[data-action="projectPath"]'
            ? field === destination
              ? destination
              : null
            : field === name
              ? name
              : null,
      },
    });
  input(name);
  assert.equal(destination.value, '/workspace/demo');
  name.value = 'renamed';
  input(name);
  assert.equal(destination.value, '/workspace/renamed');
  destination.value = 'my-project';
  input(destination);
  assert.equal(messages.at(-1).path, 'my-project');
  name.value = 'other-name';
  input(name);
  assert.equal(destination.value, '/workspace/other-name');
});

test('Native chooser starts at typed relative parent and preserves explicit final folder name', async () => {
  const { host, state } = fixture();
  await host.open('agents');
  await state.send('name', undefined, { name: 'agent-name' });
  await state.send('projectPath', undefined, { path: 'nested/custom-folder' });
  state.filePick = [
    { scheme: 'file', fsPath: '/picked', query: '', fragment: '' },
  ];
  await state.send('destination');
  assert.equal(state.pickerOptions.defaultUri.fsPath, '/mock/project/nested');
  assert.equal(host.projectPath, '/picked/custom-folder');
  await state.send('name', undefined, { name: 'renamed-agent' });
  assert.equal(host.projectPath, '/picked/renamed-agent');
});
test('Real writer creates typed final project and refuses existing, missing parent or symlink without overwriting', async (t) => {
  const fsp = require('node:fs/promises');
  const root = await fsp.mkdtemp(
    path.join(require('node:os').tmpdir(), 'scw-final-path-real-'),
  );
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const actualWriter = actualModule('agentScaffold').materializeTemplate;
  for (const scenario of ['fresh', 'exists', 'missing-parent', 'link']) {
    const { host, state } = fixture();
    addServerless(state);
    await host.open('agents');
    state.materialize = async (...args) => {
      state.creates.push(args);
      return actualWriter(...args);
    };
    const backend = option(host.panel.webview.html, 'backend', 'FastAPI');
    await state.send('backend', backend);
    await state.send('name', undefined, { name: 'agent-name' });
    await state.send(
      'model',
      option(host.panel.webview.html, 'model', 'serverless-test'),
    );
    let target = path.join(root, scenario);
    if (scenario === 'exists') {
      await fsp.mkdir(target);
      await fsp.writeFile(path.join(target, 'keep.txt'), 'preserve');
    }
    if (scenario === 'missing-parent')
      target = path.join(root, 'absent', 'child');
    if (scenario === 'link') {
      await fsp.symlink(root, path.join(root, 'alias'));
      target = path.join(root, 'alias', 'blocked');
    }
    await state.send('projectPath', undefined, { path: target });
    state.confirms.push('Créer dans le projet');
    await state.send('create', backend);
    if (scenario === 'fresh') {
      assert.equal(state.postCreate.project, target);
      assert.ok((await fsp.stat(path.join(target, '.env'))).isFile());
      assert.equal(state.creates[0][1], 'fresh');
    } else {
      assert.equal(state.postCreate, undefined);
      if (scenario === 'exists')
        assert.equal(
          await fsp.readFile(path.join(target, 'keep.txt'), 'utf8'),
          'preserve',
        );
    }
  }
});

test('Typed test-agent works with nested workspace roots using primary root and real exclusive writer', async (t) => {
  const fsp = require('node:fs/promises');
  const root = await fsp.mkdtemp(
    path.join(require('node:os').tmpdir(), 'scw-relative-multiroot-'),
  );
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const nested = path.join(root, 'existing-agent');
  await fsp.mkdir(nested);
  const { host, state, workspace } = fixture();
  workspace.workspaceFolders = [root, nested].map((fsPath) => ({
    name: path.basename(fsPath),
    uri: { scheme: 'file', fsPath, toString: () => 'file:' + fsPath },
  }));
  addServerless(state);
  await host.open('agents');
  const writer = actualModule('agentScaffold').materializeTemplate;
  state.materialize = async (...args) => {
    state.creates.push(args);
    return writer(...args);
  };
  const backend = option(host.panel.webview.html, 'backend', 'FastAPI');
  await state.send('backend', backend);
  await state.send('name', undefined, { name: 'test-agent' });
  await state.send(
    'model',
    option(host.panel.webview.html, 'model', 'serverless-test'),
  );
  await state.send('projectPath', undefined, { path: 'test-agent' });
  state.confirms.push('Créer dans le projet');
  await state.send('create', backend);
  assert.equal(state.postCreate.project, path.join(root, 'test-agent'));
  assert.ok((await fsp.stat(path.join(root, 'test-agent', '.env'))).isFile());
  assert.equal(state.creates[0][0], root);
  assert.equal(state.creates[0][1], 'test-agent');
  await assert.rejects(fsp.stat(path.join(nested, 'test-agent')), {
    code: 'ENOENT',
  });
  await assert.rejects(fsp.stat(path.join(root, 'test-agent', 'test-agent')), {
    code: 'ENOENT',
  });
});
test('Relative path uses explicitly picked base even with several workspace roots', async () => {
  const { host, state, workspace } = fixture();
  workspace.workspaceFolders.push({
    name: 'Other',
    uri: { scheme: 'file', fsPath: '/other', toString: () => '/other' },
  });
  addServerless(state);
  await host.open('agents');
  state.filePick = [
    { scheme: 'file', fsPath: '/explicit-parent', query: '', fragment: '' },
  ];
  await state.send('destination');
  const backend = option(host.panel.webview.html, 'backend', 'FastAPI');
  await state.send('backend', backend);
  await state.send('name', undefined, { name: 'agent-name' });
  await state.send(
    'model',
    option(host.panel.webview.html, 'model', 'serverless-test'),
  );
  await state.send('projectPath', undefined, { path: 'test-agent' });
  state.confirms.push('Créer dans le projet');
  await state.send('create', backend);
  assert.equal(state.postCreate.project, '/explicit-parent/test-agent');
});

function safeKey(id = 'd'.repeat(32), overrides = {}) {
  return {
    id,
    description: 'Chosen application',
    maskedAccessKey: 'SCW••••5678',
    bearerType: 'application',
    expiresAt: Date.now() + 3600000,
    secretAvailable: true,
    ...overrides,
  };
}
test('separate key selector is closed, independent, scope-bound and copies exact choice after consent', async () => {
  const { state, host, api } = fixture();
  for (const action of ['key', 'clearKey', 'addKey']) {
    const message = { action, token, ...(action === 'key' ? { index } : {}) };
    assert.ok(api.parseCreationInput(message));
    assert.equal(
      api.parseCreationInput({ ...message, secretKey: applicationKey }),
      undefined,
    );
  }
  state.modelContext.apiKeys = [
    safeKey(),
    safeKey('e'.repeat(32), { secretAvailable: false }),
    safeKey('f'.repeat(32), { expiresAt: 1 }),
  ];
  await host.open('agents');
  const panel = state.panels[0];
  assert.match(panel.webview.html, /data-action="key"/);
  assert.doesNotMatch(
    panel.webview.html,
    /clé sélectionnée|clé API à choisir|33333333-3333|55555555-5555/,
  );
  const backend = option(panel.webview.html, 'backend', 'FastAPI');
  await state.send('backend', backend);
  await state.send('name', undefined, { name: 'selected-key-agent' });
  await state.send('dedicated');
  await state.send('model', option(panel.webview.html, 'model', 'model-a'));
  state.confirms.push('Créer dans le projet');
  await state.send('create', backend);
  assert.equal(state.creates.length, 0);
  assert.equal(state.credentialScopes, undefined);
  const keyIndex = option(panel.webview.html, 'key', 'Chosen application');
  await state.send('key', '0'.repeat(32));
  assert.equal(host.keyIndex, undefined);
  await state.send('key', keyIndex);
  await state.send('serverless');
  assert.equal(
    host.keyIndex,
    keyIndex,
    'key selection survives service toggle',
  );
  await state.send('dedicated');
  await state.send('model', option(panel.webview.html, 'model', 'model-a'));
  await state.send('create', backend);
  assert.equal(state.preferredKeyId, 'd'.repeat(32));
  assert.equal(state.creates.length, 1);
  assert.match(state.envContent, new RegExp(applicationKey));
  assert.ok(!state.envContent.includes(userKey));
  state.modelContext.apiKeys = [];
  host.modelsChanged();
  assert.equal(host.keyIndex, undefined);
  assert.match(
    panel.webview.html,
    /Aucune clé locale valide|Ajouter \/ importer/,
  );
  await state.send('addKey');
  assert.equal(state.addKeys, 1);
});

test('key dropdown async refresh preserves selection and rejects old project rows and consent-time deletion', async () => {
  const { state, host } = fixture();
  state.modelContext.apiKeys = [safeKey()];
  await host.open('agents');
  const panel = state.panels[0];
  const keyIndex = option(panel.webview.html, 'key', 'Chosen application');
  await state.send('key', keyIndex);
  state.refreshModels = async () => {
    state.modelContext.apiKeys = [safeKey()];
    host.modelsChanged();
  };
  await state.send('refreshModels');
  assert.equal(host.keyIndex, keyIndex);
  assert.equal(state.modelMessages.at(-1).selectedKey, keyIndex);
  assert.equal(state.modelMessages.at(-1).keys.length, 1);
  state.modelContext.key = 'foreign-project';
  host.modelsChanged();
  assert.equal(host.keyIndex, undefined);
  await state.send('key', keyIndex);
  assert.equal(host.keyIndex, undefined);
  await state.send(
    'key',
    option(panel.webview.html, 'key', 'Chosen application'),
  );
  const backend = option(panel.webview.html, 'backend', 'FastAPI');
  await state.send('backend', backend);
  await state.send('name', undefined, { name: 'stale-key' });
  await state.send('dedicated');
  await state.send('model', option(panel.webview.html, 'model', 'model-a'));
  state.confirms.push(() => {
    state.modelContext.apiKeys = [];
    return 'Créer dans le projet';
  });
  await state.send('create', backend);
  assert.equal(state.creates.length, 0);
  assert.equal(state.credentialScopes, undefined);
});

test('renderer key messages are opaque and updates closed; stale/extra/secret/null rows rejected', () => {
  const messages = [],
    listeners = {};
  let receive;
  const makeSelect = () => ({
    dataset: {},
    value: '',
    replaceChildren(...options) {
      this.options = options;
    },
  });
  const modelSelect = makeSelect(),
    keySelect = makeSelect();
  const create = { dataset: { destinationReady: 'true' } };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../media/localCreation.js'), 'utf8'),
    {
      acquireVsCodeApi: () => ({ postMessage: (m) => messages.push(m) }),
      window: {
        addEventListener: (_, fn) => {
          receive = fn;
        },
      },
      document: {
        body: { dataset: { token } },
        addEventListener: (name, fn) => {
          listeners[name] = fn;
        },
        querySelector: (selector) =>
          selector.includes('data-action="key"')
            ? keySelect
            : selector.includes('data-action="model"')
              ? modelSelect
              : selector.includes('data-agent-create')
                ? create
                : selector.includes('data-action="name"')
                  ? { value: 'agent' }
                  : null,
        createElement: () => ({}),
      },
    },
  );
  const update = {
    type: 'creation-models',
    token,
    revision: 1,
    models: [{ index, label: 'Model' }],
    selected: index,
    keys: [{ index: 'c'.repeat(32), label: 'SCW••••1234' }],
    selectedKey: 'c'.repeat(32),
  };
  for (const bad of [
    { ...update, secretKey: applicationKey },
    { ...update, keys: [null] },
    { ...update, keys: [{ ...update.keys[0], secretKey: applicationKey }] },
    { ...update, token: 'f'.repeat(48) },
  ]) {
    receive({ data: bad });
    assert.equal(keySelect.value, '');
  }
  receive({ data: update });
  assert.equal(keySelect.value, update.selectedKey);
  assert.equal(create.disabled, false);
  receive({ data: { ...update, keys: [], selectedKey: '', revision: 2 } });
  assert.equal(create.disabled, true);
  receive({ data: update });
  assert.equal(keySelect.value, '');
  keySelect.dataset.action = 'key';
  keySelect.value = update.selectedKey;
  listeners.change({ target: { closest: () => keySelect } });
  assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1))), {
    action: 'key',
    token,
    index: update.selectedKey,
  });
  keySelect.value = '';
  listeners.change({ target: { closest: () => keySelect } });
  assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1))), {
    action: 'clearKey',
    token,
  });
  const button = { dataset: { action: 'addKey' } };
  listeners.click({
    target: {
      closest: (selector) => (selector.startsWith('button') ? button : null),
    },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1))), {
    action: 'addKey',
    token,
  });
});

test('dedicated model and independent key selection survive loading snapshots of the same project', async () => {
  const { state, host } = fixture();
  state.modelContext.apiKeys = [safeKey()];
  await host.open('agents');
  const panel = state.panels[0];
  await state.send('dedicated');
  const selected = option(panel.webview.html, 'model', 'model-a');
  const chosen = option(panel.webview.html, 'key', 'Chosen application');
  await state.send('model', selected);
  await state.send('key', chosen);
  state.refreshModels = async () => {
    state.modelContext.status = 'Chargement…';
    host.modelsChanged();
    assert.equal(host.modelIndex, selected);
    assert.equal(host.keyIndex, chosen);
    state.modelContext.status = 'fr-par · projet sélectionné';
    host.modelsChanged();
  };
  await state.send('refreshModels');
  assert.equal(host.modelIndex, selected);
  assert.equal(host.keyIndex, chosen);
});

test('two public models use same explicitly chosen application key even when model has a different key hint', async () => {
  const { state, host } = fixture();
  addServerless(state);
  const model = state.modelContext.rows.at(-1);
  model.llmAccess = configuredAccess(state.modelContext.projectId, 'user');
  state.modelContext.rows.push({
    ...model,
    id: 'second-model',
    label: 'Second',
  });
  state.modelContext.apiKeys = [safeKey()];
  await host.open('agents');
  const panel = state.panels[0];
  const backend = option(panel.webview.html, 'backend', 'FastAPI');
  await state.send('backend', backend);
  const chosen = option(panel.webview.html, 'key', 'Chosen application');
  await state.send('key', chosen);
  for (const modelId of ['serverless-test', 'second-model']) {
    await state.send('name', undefined, { name: modelId });
    await state.send('model', option(panel.webview.html, 'model', modelId));
    state.confirms.push('Créer dans le projet');
    await state.send('create', backend);
    assert.equal(state.preferredKeyId, safeKey().id);
    assert.equal(host.keyIndex, chosen);
    assert.match(state.envContent, new RegExp(applicationKey));
    assert.ok(!state.envContent.includes(userKey));
    assert.ok(state.envContent.includes(modelId));
  }
  assert.equal(state.creates.length, 2);
  for (const payload of [
    panel.webview.html,
    state.modelMessages,
    state.warningArgs,
    ...state.creates.map((args) => args[2]),
  ])
    assert.ok(!JSON.stringify(payload ?? null).includes(applicationKey));
});

test('real local materializer writes 0600 .env with exact selected key, never model hint or login fallback', async (t) => {
  const fsp = require('node:fs/promises');
  const parent = await fsp.mkdtemp(
    path.join(require('node:os').tmpdir(), 'scw-key-selector-'),
  );
  t.after(() => fsp.rm(parent, { recursive: true, force: true }));
  const { state, host, workspace, uri } = fixture();
  t.after(() => host.dispose());
  workspace.workspaceFolders = [
    { name: 'Temporary mock workspace', uri: uri(parent) },
  ];
  addServerless(state);
  state.modelContext.apiKeys = [safeKey()];
  state.materialize = require('../dist/agentScaffold').materializeTemplate;
  await host.open('agents');
  const panel = state.panels[0];
  await state.send('backend', option(panel.webview.html, 'backend', 'FastAPI'));
  await state.send('name', undefined, { name: 'exact-key' });
  await state.send(
    'key',
    option(panel.webview.html, 'key', 'Chosen application'),
  );
  await state.send(
    'model',
    option(panel.webview.html, 'model', 'serverless-test'),
  );
  state.confirms.push('Créer dans le projet');
  await state.send('create', option(panel.webview.html, 'backend', 'FastAPI'));
  const target = path.join(parent, 'exact-key', '.env');
  const env = await fsp.readFile(target, 'utf8');
  assert.equal(
    env,
    "SCW_INFERENCE_BASE_URL='https://api.scaleway.ai/" +
      state.modelContext.projectId +
      "/v1'\nSCW_INFERENCE_MODEL_ID='serverless-test'\nSCW_API_KEY='" +
      applicationKey +
      "'\n",
  );
  assert.equal((await fsp.stat(target)).mode & 0o777, 0o600);
  assert.ok(!env.includes(userKey));
  assert.equal(state.preferredKeyId, safeKey().id);
  assert.ok(
    (
      await fsp.readFile(path.join(parent, 'exact-key', '.gitignore'), 'utf8')
    ).includes('/.env'),
  );
});

test('Python Strands entry opens after preparation, before IDE/root handoff, including incomplete preparation', async () => {
  for (const mode of [
    'prepared',
    'incomplete',
    'throwing-preparation',
    'missing-ide',
    'failed-ide',
    'refused-root',
  ]) {
    const { state, host } = fixture();
    addServerless(state);
    await host.open('agents');
    const panel = state.panels[0];
    await state.send(
      'backend',
      option(panel.webview.html, 'backend', 'FastAPI'),
    );
    await state.send('ai', option(panel.webview.html, 'ai', 'Strands'));
    await state.send('name', undefined, { name: 'editable-agent' });
    await state.send(
      'model',
      option(panel.webview.html, 'model', 'serverless-test'),
    );
    state.preparationResult = mode !== 'incomplete';
    if (mode === 'throwing-preparation')
      state.onPrepare = async () => {
        throw new Error('preparation unavailable');
      };
    state.configureIde = async () => {
      assert.deepEqual(state.openedEntries, ['/mock/project/editable-agent']);
      if (mode === 'failed-ide') throw new Error('IDE activation failed');
      return mode === 'prepared';
    };
    state.confirms.push('Créer dans le projet');
    await state.send(
      'create',
      option(panel.webview.html, 'backend', 'FastAPI'),
    );
    assert.equal(state.creates.length, 1, mode);
    assert.deepEqual(
      state.openedEntries,
      ['/mock/project/editable-agent'],
      mode,
    );
    assert.deepEqual(
      state.creationOrder,
      ['incomplete', 'throwing-preparation'].includes(mode)
        ? ['prepare', 'open']
        : ['prepare', 'open', 'root-registration'],
      mode,
    );
  }
});
test('Created entry never opens after cancellation, failed write, or stale/trust/disposal during preparation', async () => {
  for (const mode of [
    'cancel',
    'failed-write',
    'stale',
    'untrusted',
    'disposed',
  ]) {
    const { state, host, workspace, uri } = fixture();
    addServerless(state);
    await host.open('agents');
    const panel = state.panels[0];
    await state.send(
      'backend',
      option(panel.webview.html, 'backend', 'FastAPI'),
    );
    await state.send('name', undefined, { name: 'guarded-agent' });
    await state.send(
      'model',
      option(panel.webview.html, 'model', 'serverless-test'),
    );
    if (mode === 'failed-write')
      state.materialize = async () => {
        throw new Error('write failed');
      };
    state.onPrepare = async () => {
      if (mode === 'stale')
        workspace.workspaceFolders = [{ name: 'Other', uri: uri('/other') }];
      if (mode === 'untrusted') workspace.isTrusted = false;
      if (mode === 'disposed') host.dispose();
    };
    if (mode !== 'cancel') state.confirms.push('Créer dans le projet');
    await state.send(
      'create',
      option(panel.webview.html, 'backend', 'FastAPI'),
    );
    assert.equal(
      state.creates.length,
      ['cancel', 'failed-write'].includes(mode) ? 0 : 1,
      mode,
    );
    assert.equal(state.openedEntries, undefined, mode);
    assert.equal(state.configuredPython, undefined, mode);
  }
});

test('adaptive controls absent and mode/common choices remembered', async () => {
  const { state, host } = fixture();
  await host.open('agents');
  addServerless(state);
  host.modelsChanged();
  const panel = state.panels[0],
    backend = option(panel.webview.html, 'backend', 'FastAPI');
  await state.send('backend', backend);
  const ai = option(panel.webview.html, 'ai', 'Strands');
  await state.send('ai', ai);
  await state.send('name', undefined, { name: 'remember-service' });
  await state.send('projectPath', undefined, { path: '/custom/remember' });
  await state.send(
    'model',
    option(panel.webview.html, 'model', 'serverless-test'),
  );
  const model = host.modelIndex;
  assert.doesNotMatch(panel.webview.html, /aria-label="Frontend"/);
  await state.send('cliExposure');
  assert.doesNotMatch(panel.webview.html, /select data-action="backend"/);
  await state.send('backend', backend);
  assert.equal(host.backend, undefined);
  await state.send('webapp');
  assert.match(panel.webview.html, /aria-label="Frontend"/);
  await state.send('integratedBackend');
  assert.equal(host.language, 'typescript');
  assert.doesNotMatch(panel.webview.html, /select data-action="language"/);
  await state.send('viteFrontend');
  assert.doesNotMatch(panel.webview.html, /data-action="integratedBackend"/);
  await state.send('nextFrontend');
  assert.equal(host.serviceOptions.architecture, 'integrated');
  await state.send('agentService');
  await state.send('apiExposure');
  assert.equal(host.backend, backend);
  assert.equal(host.ai, ai);
  assert.equal(host.modelIndex, model);
  assert.equal(host.agentName, 'remember-service');
  assert.equal(host.projectPath, '/custom/remember');
  assert.equal(state.creates.length, 0);
});
test('CLI ignores hidden API values and keeps parser agent source', async () => {
  const { state, host } = fixture();
  await host.open('agents');
  addServerless(state);
  host.modelsChanged();
  const panel = state.panels[0];
  await state.send('backend', option(panel.webview.html, 'backend', 'FastAPI'));
  await state.send('cliExposure');
  await state.send('ai', option(panel.webview.html, 'ai', 'Strands'));
  await state.send('name', undefined, { name: 'cli-service' });
  await state.send(
    'model',
    option(panel.webview.html, 'model', 'serverless-test'),
  );
  state.confirms.push('Créer dans le projet');
  await state.send('create', host.selected);
  assert.equal(state.creates.length, 1);
  const files = state.creates[0][2].files;
  assert.ok(files['src/agent_app/agent.py']);
  assert.ok(!files['src/agent_app/service_api.py']);
  assert.ok(!files['frontend/package.json']);
  assert.equal(JSON.parse(files['agent.authoring.json']).backend, 'none');
});
test('Next integrated and Vite separate generation use real server routes without public credentials', async () => {
  for (const front of ['next', 'vite']) {
    const { state, host } = fixture();
    await host.open('agents');
    addServerless(state);
    host.modelsChanged();
    const panel = state.panels[0];
    await state.send('webapp');
    if (front === 'next') await state.send('integratedBackend');
    else {
      await state.send('viteFrontend');
      await state.send(
        'backend',
        option(panel.webview.html, 'backend', 'FastAPI'),
      );
    }
    await state.send('name', undefined, { name: 'web-service' });
    await state.send(
      'model',
      option(panel.webview.html, 'model', 'serverless-test'),
    );
    state.confirms.push('Créer dans le projet');
    await state.send('create', host.selected);
    assert.equal(state.creates.length, 1);
    const files = state.creates[0][2].files,
      ui = files[front === 'next' ? 'app/page.tsx' : 'frontend/src/Chat.tsx'];
    assert.ok(ui.includes('fetch("/api/chat"'));
    assert.doesNotMatch(ui, /SCW_API_KEY|NEXT_PUBLIC_|VITE_/);
    assert.ok(
      files[
        front === 'next'
          ? 'app/api/chat/route.ts'
          : 'src/agent_app/service_api.py'
      ],
    );
  }
});
test('exclusive service radios support arrow navigation and closed protocol', () => {
  const listeners = {},
    messages = [],
    radio = {
      disabled: false,
      dataset: { action: 'agentService' },
      getAttribute: () => 'radio',
    },
    other = { dataset: { action: 'webapp' } };
  radio.closest = () => ({ querySelectorAll: () => [other, radio] });
  const target = {
    closest: (s) => (s === 'button[role="radio"]' ? radio : null),
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../media/localCreation.js'), 'utf8'),
    {
      acquireVsCodeApi: () => ({ postMessage: (m) => messages.push(m) }),
      window: { addEventListener() {} },
      document: {
        body: { dataset: { token } },
        addEventListener: (t, fn) => (listeners[t] = fn),
      },
    },
  );
  let prevented = false;
  listeners.keydown({
    target,
    key: 'ArrowLeft',
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [
    { action: 'webapp', token },
  ]);
  const { api } = fixture();
  for (const action of [
    'webapp',
    'agentService',
    'cliExposure',
    'apiExposure',
    'nextFrontend',
    'viteFrontend',
    'integratedBackend',
    'separateBackend',
  ]) {
    assert.ok(api.parseCreationInput({ action, token }));
    assert.equal(api.parseCreationInput({ action, token, index }), undefined);
  }
});

test('reopening resets Next architecture memory with other temporary selections', async () => {
  const { state, host } = fixture();
  await host.open('agents');
  await state.send('webapp');
  await state.send('integratedBackend');
  await host.open('agents');
  await state.send('webapp');
  await state.send('nextFrontend');
  assert.equal(host.serviceOptions.architecture, 'separate');
  assert.match(state.panels[0].webview.html, /select data-action="backend"/);
});

test('Litestar selection is advertised and generated by adaptive agent and web paths', async () => {
  for (const web of [false, true]) {
    const { state, host } = fixture();
    await host.open('agents');
    addServerless(state);
    host.modelsChanged();
    const panel = state.panels[0];
    if (web) {
      await state.send('webapp');
      await state.send('viteFrontend');
    }
    const backend = option(panel.webview.html, 'backend', 'Litestar');
    await state.send('backend', backend);
    await state.send('name', undefined, { name: 'litestar-service' });
    await state.send(
      'model',
      option(panel.webview.html, 'model', 'serverless-test'),
    );
    state.confirms.push('Créer dans le projet');
    await state.send('create', host.selected);
    assert.equal(state.creates.length, 1);
    const files = state.creates[0][2].files;
    assert.match(files['src/agent_app/service_api.py'], /from litestar import/);
    assert.match(files['requirements.txt'], /litestar>=2.12,<3/);
    assert.equal(!!files['frontend/package.json'], web);
    assert.ok(files['src/agent_app/service_cli.py']);
  }
});

test('AgentOS host selection locks Agno, rejects forged incompatible SDK IPC, and preserves common choices across modes', async () => {
  const { state, host } = fixture();
  addServerless(state);
  await host.open('agents');
  const panel = state.panels[0];
  const runtime = option(panel.webview.html, 'backend', 'AgentOS');
  const strands = option(panel.webview.html, 'ai', 'Strands');
  await state.send('name', undefined, { name: 'agno-service' });
  await state.send('projectPath', undefined, { path: '/custom/agno-service' });
  await state.send(
    'model',
    option(panel.webview.html, 'model', 'serverless-test'),
  );
  const model = host.modelIndex;
  await state.send('ai', strands);
  await state.send('backend', runtime);
  assert.notEqual(host.backend, runtime);
  assert.equal(host.ai, strands);
  assert.match(panel.webview.html, /retirez le SDK/);
  const none = option(panel.webview.html, 'ai', 'Sans framework IA');
  await state.send('ai', none);
  await state.send('backend', runtime);
  assert.equal(host.backend, runtime);
  assert.equal(host.ai, undefined);
  assert.match(panel.webview.html, /data-runtime-lock=agno/);
  assert.doesNotMatch(panel.webview.html, /select data-action="ai"/);
  await state.send('ai', strands);
  assert.equal(host.ai, undefined);
  assert.equal(host.backend, runtime);
  await state.send('cliExposure');
  assert.match(panel.webview.html, /select data-action="ai"/);
  await state.send('apiExposure');
  assert.equal(host.backend, runtime);
  assert.equal(host.modelIndex, model);
  assert.equal(host.agentName, 'agno-service');
  assert.equal(host.projectPath, '/custom/agno-service');
  state.confirms.push('Créer dans le projet');
  await state.send('create', host.selected);
  assert.equal(state.creates.length, 1);
  const files = state.creates[0][2].files;
  assert.equal(
    JSON.parse(files['service.authoring.json']).transport,
    'agno-agentos',
  );
  assert.equal(
    JSON.parse(files['.vscode/scaleway-agent-run.json']).ready,
    false,
  );
  assert.match(files['src/agent_app/service_api.py'], /arun[(]message/);
  assert.equal(files['src/agent_app/service_transport.py'], undefined);
});
