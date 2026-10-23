const assert = require('node:assert/strict');
const { test } = require('node:test');
const Module = require('node:module');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  prepareEmbeddedProject,
  renderProjectTemplate,
} = require('../dist/projectGenerator');
const { stackChoices } = require('../dist/stackScaffold');
function fixture() {
  const state = { choices: [], confirmations: [], commands: [], tasks: [] };
  const api = {
    extensions: {},
    workspace: {
      isTrusted: true,
      workspaceFolders: [],
      updateWorkspaceFolders: (...args) => {
        state.updates ??= [];
        state.updates.push(args);
        return state.updateResult ?? true;
      },
    },
    Uri: { file: (p) => ({ fsPath: p }) },
    window: {
      showInformationMessage: async (...args) => {
        state.info = args;
        return state.choices.shift();
      },
      showWarningMessage: async (...args) => {
        state.warning = args;
        return state.confirmations.shift();
      },
    },
    commands: { executeCommand: async (...args) => state.commands.push(args) },
    ProcessExecution: class {
      constructor(executable, args, options) {
        Object.assign(this, { executable, args, options });
      }
    },
    Task: class {
      constructor(definition, scope, name, source, execution) {
        Object.assign(this, { definition, scope, name, source, execution });
      }
    },
    TaskScope: { Workspace: 1 },
    TaskRevealKind: { Always: 1, Silent: 2 },
    tasks: {
      onDidEndTask: (fn) => {
        state.taskEnded = fn;
        return { dispose() {} };
      },
      onDidEndTaskProcess: (fn) => {
        state.ended = fn;
        return {
          dispose: () => {
            state.disposed = true;
          },
        };
      },
      executeTask: async (task) => {
        state.tasks.push(task);
        if (state.rejectTask) throw new Error('missing uv');
        if (state.endWithoutProcess) {
          queueMicrotask(() => state.taskEnded({ execution: { task } }));
          return { task };
        }
        if (state.ended)
          queueMicrotask(() =>
            state.ended({ execution: { task }, exitCode: state.exitCode ?? 0 }),
          );
        return { task };
      },
    },
  };
  const filename = require.resolve('../dist/projectActions');
  const mod = new Module(filename);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod.require = (r) => {
    if (r === 'vscode') return api;
    if (r === './localAgentRunner') return {
      openLocalAgentEntry: async (project, current) => {
        if (!current()) return;
        state.openedEntries ??= [];
        state.openedEntries.push(project);
        state.order.push('open');
      },
    };
    return Module.prototype.require.call(mod, r);
  };
  mod._compile(require('node:fs').readFileSync(filename, 'utf8'), filename);
  return {
    state,
    api,
    offer: mod.exports.offerProjectActions,
    prepare: mod.exports.prepareCreatedAgentProject,
    initializeIde: mod.exports.initializePythonIde,
    configureIde: mod.exports.configureCreatedPythonIde,
    initializeCompiledIde: mod.exports.initializeCompiledIde,
    configureCompiledIde: mod.exports.configureCreatedCompiledIde,
  };
}
async function project(t, language) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scw-actions-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const template = renderProjectTemplate(
    prepareEmbeddedProject(
      stackChoices('agents').find((s) => s.language === language).template,
      language,
    ),
    { name: 'project' },
  );
  const manifest =
    language === 'rust'
      ? 'Cargo.toml'
      : language === 'python'
        ? 'pyproject.toml'
        : 'package.json';
  await fs.writeFile(path.join(root, manifest), template.files[manifest]);
  return { root, template };
}
for (const language of ['rust', 'python', 'typescript'])
  test(`${language} install requires separate consent and fixed non-shell process task`, async (t) => {
    const { root, template } = await project(t, language);
    const { state, offer } = fixture();
    await offer(root, template, () => true);
    assert.equal(state.tasks.length, 0);
    state.choices.push('Installer les dépendances');
    await offer(root, template, () => true);
    assert.equal(state.tasks.length, 0);
    state.choices.push('Installer les dépendances');
    state.confirmations.push('Installer');
    await offer(root, template, () => true);
    assert.equal(state.tasks.length, 1);
    assert.equal(
      state.tasks[0].execution.executable,
      { rust: 'cargo', python: 'uv', typescript: 'bun' }[language],
    );
    assert.deepEqual(
      state.tasks[0].execution.args,
      { rust: ['fetch'], python: ['sync'], typescript: ['install'] }[language],
    );
    assert.equal(state.tasks[0].execution.options.cwd, root);
  });
test('open project is independent of installation; legacy does not guess installer', async (t) => {
  const { root, template } = await project(t, 'python');
  const { state, offer } = fixture();
  state.choices.push('Ouvrir le projet');
  await offer(root, template, () => true);
  assert.equal(state.commands[0][0], 'vscode.openFolder');
  assert.equal(state.commands[0][1].fsPath, root);
  assert.deepEqual(state.commands[0][2], { forceNewWindow: true });
  assert.equal(state.tasks.length, 0);
  const { project: _project, ...legacy } = template;
  legacy.version = 1;
  await offer(root, legacy, () => true);
  assert.ok(!state.info.includes('Installer les dépendances'));
});
test('untrusted, stale confirmation and linked project refuse install', async (t) => {
  const { root, template } = await project(t, 'python');
  const { state, api, offer } = fixture();
  api.workspace.isTrusted = false;
  await offer(root, template, () => true);
  assert.equal(state.info, undefined);
  api.workspace.isTrusted = true;
  state.choices.push('Installer les dépendances');
  state.confirmations.push('Installer');
  let calls = 0;
  await offer(root, template, () => ++calls < 3);
  assert.equal(state.tasks.length, 0);
  const link = `${root}-link`;
  await fs.symlink(root, link);
  t.after(() => fs.rm(link, { force: true }));
  state.choices.push('Installer les dépendances');
  state.confirmations.push('Installer');
  await assert.rejects(offer(link, template, () => true));
  assert.equal(state.tasks.length, 0);
});

test('Given a generated nested project, When explicitly added, Then VS Code receives one named root without install or new window', async (t) => {
  const { root, template } = await project(t, 'python');
  const { state, api, offer } = fixture();
  api.workspace.workspaceFolders = [
    { uri: { scheme: 'file', fsPath: path.dirname(root) } },
  ];
  await offer(root, template, () => true);
  assert.equal(state.updates, undefined);
  assert.ok(state.info.includes('Ajouter au workspace actuel'));
  state.choices.push('Ajouter au workspace actuel');
  await offer(root, template, () => true);
  assert.equal(state.updates.length, 1);
  assert.equal(state.updates[0][0], 1);
  assert.equal(state.updates[0][1], 0);
  assert.equal(state.updates[0][2].uri.fsPath, root);
  assert.equal(state.updates[0][2].name, path.basename(root));
  assert.equal(state.tasks.length, 0);
  assert.equal(state.commands.length, 0);
});
test('Given existing workspace root or refused update, When adding, Then no duplicate or false success is reported', async (t) => {
  const { root, template } = await project(t, 'python');
  const { state, api, offer } = fixture();
  api.workspace.workspaceFolders = [{ uri: { scheme: 'file', fsPath: root } }];
  state.choices.push('Ajouter au workspace actuel');
  await offer(root, template, () => true);
  assert.equal(state.updates, undefined);
  assert.match(state.info[0], /déjà/);
  api.workspace.workspaceFolders = [];
  state.updateResult = false;
  state.choices.push('Ajouter au workspace actuel');
  await offer(root, template, () => true);
  assert.equal(state.updates[0][0], 0);
  assert.match(state.warning[0], /pas accepté/);
  assert.equal(state.tasks.length, 0);
});
test('Given stale lifecycle, trust loss, linked or non-directory target, When adding, Then workspace mutation is forbidden', async (t) => {
  const { root, template } = await project(t, 'python');
  for (const boundary of ['stale', 'trust', 'link', 'file']) {
    const { state, api, offer } = fixture();
    state.choices.push('Ajouter au workspace actuel');
    let target = root,
      calls = 0;
    if (boundary === 'link') {
      target = path.join(root, 'link');
      await fs.symlink(root, target);
    }
    if (boundary === 'file') target = path.join(root, 'pyproject.toml');
    const current = () => {
      calls++;
      if (boundary === 'trust' && calls === 3) api.workspace.isTrusted = false;
      return boundary !== 'stale' || calls < 3;
    };
    if (['link', 'file'].includes(boundary))
      await assert.rejects(offer(target, template, current));
    else await offer(target, template, current);
    assert.equal(state.updates, undefined);
    assert.equal(state.tasks.length, 0);
    assert.equal(state.commands.length, 0);
  }
});

for (const kind of ['agents', 'tools'])
  test(`Given created ${kind} inside workspace, When viewing local resources, Then the correct fresh inventory opens without installation`, async (t) => {
    const { root, template } = await project(t, 'python');
    const { state, api, offer } = fixture();
    api.workspace.workspaceFolders = [
      { uri: { scheme: 'file', fsPath: path.dirname(root) } },
    ];
    state.choices.push('Voir dans les ressources locales');
    await offer(root, { ...template, kind }, () => true);
    assert.deepEqual(state.commands, [
      [
        kind === 'agents'
          ? 'scalewayAI.openLocalAgents'
          : 'scalewayAI.openLocalTools',
      ],
    ]);
    assert.equal(state.tasks.length, 0);
    assert.equal(state.updates, undefined);
  });
test('Given external destination, When viewing local resources, Then no inaccessible project is silently registered', async (t) => {
  const { root, template } = await project(t, 'python');
  const { state, offer } = fixture();
  state.choices.push('Voir dans les ressources locales');
  await offer(root, template, () => true);
  assert.match(state.info[0], /Ajoutez d’abord/);
  assert.equal(state.commands.length, 0);
  assert.equal(state.updates, undefined);
});
test('Given a generated tool, When adding to workspace, Then the shared post-create action applies identically', async (t) => {
  const { root, template } = await project(t, 'python');
  const { state, offer } = fixture();
  state.choices.push('Ajouter au workspace actuel');
  await offer(root, { ...template, kind: 'tools' }, () => true);
  assert.equal(state.updates[0][2].uri.fsPath, root);
  assert.equal(state.tasks.length, 0);
  assert.equal(state.commands.length, 0);
});

test('Given an agent or tool created for a monorepo, When post-create actions are offered, Then explicit workspace addition is first and cancellation has no effects', async (t) => {
  const { root, template } = await project(t, 'python');
  for (const kind of ['agents', 'tools']) {
    const { state, offer } = fixture();
    await offer(root, { ...template, kind }, () => true);
    assert.deepEqual(state.info.slice(1), [
      'Ajouter au workspace actuel',
      'Ouvrir le projet',
      'Voir dans les ressources locales',
      'Installer les dépendances',
    ]);
    assert.equal(state.updates, undefined);
    assert.equal(state.commands.length, 0);
    assert.equal(state.tasks.length, 0);
  }
});

test('Automatic Python preparation starts fixed uv sync without second prompt and waits for success', async (t) => {
  const { root, template } = await project(t, 'python');
  const { state, prepare, offer } = fixture();
  assert.equal(await prepare(root, template, () => true), true);
  assert.equal(state.info, undefined);
  assert.equal(state.warning, undefined);
  assert.equal(state.tasks.length, 1);
  assert.equal(state.tasks[0].execution.executable, 'uv');
  assert.deepEqual(state.tasks[0].execution.args, ['sync']);
  assert.equal(state.tasks[0].execution.options.cwd, root);
  assert.equal(state.tasks[0].presentationOptions.reveal, 2);
  assert.equal(state.disposed, true);
  await offer(root, template, () => true, true);
  assert.ok(!state.info.includes('Installer les dépendances'));
});
test('Automatic preparation reports failure without deleting project or dispatching an agent', async (t) => {
  const { root, template } = await project(t, 'python');
  for (const mode of ['exit', 'missing', 'no-process']) {
    const { state, prepare } = fixture();
    if (mode === 'exit') state.exitCode = 1;
    else if (mode === 'missing') state.rejectTask = true;
    else state.endWithoutProcess = true;
    assert.equal(await prepare(root, template, () => true), false);
    assert.match(state.warning[0], /uv sync/);
    assert.equal(state.tasks.length, 1);
    assert.equal(state.disposed, true);
    assert.ok((await fs.stat(path.join(root, 'pyproject.toml'))).isFile());
  }
});
test('Automatic preparation refuses stale/untrusted/linked projects and skips other languages/tools', async (t) => {
  const { root, template } = await project(t, 'python');
  for (const mode of ['stale', 'untrusted', 'link']) {
    const { state, api, prepare } = fixture();
    let target = root;
    if (mode === 'untrusted') api.workspace.isTrusted = false;
    if (mode === 'link') {
      target = root + '-link-auto';
      await fs.symlink(root, target);
      t.after(() => fs.rm(target, { force: true }));
    }
    assert.equal(
      await prepare(target, template, () => mode !== 'stale'),
      false,
    );
    assert.equal(state.tasks.length, 0);
  }
  const { state, prepare } = fixture();
  assert.equal(
    await prepare(root, { ...template, kind: 'tools' }, () => true),
    true,
  );

  assert.equal(state.tasks.length, 0);
});

for (const language of ['typescript', 'rust']) {
  test(
    language +
      ' automatic preparation sequences fixed commands without a second prompt',
    async (t) => {
      const { root, template } = await project(t, language);
      const { state, prepare, offer } = fixture();
      assert.equal(await prepare(root, template, () => true), true);
      assert.equal(state.info, undefined);
      assert.equal(state.warning, undefined);
      assert.deepEqual(
        state.tasks.map((task) => [
          task.execution.executable,
          ...task.execution.args,
        ]),
        language === 'typescript'
          ? [
              ['bun', 'install'],
              ['bun', 'run', 'build'],
            ]
          : [['cargo', 'build', '--all-targets']],
      );
      for (const task of state.tasks) {
        assert.equal(task.execution.options.cwd, root);
        assert.equal(task.presentationOptions.reveal, 2);
      }
      await offer(root, template, () => true, true);
      assert.ok(!state.info.includes('Installer les dépendances'));
    },
  );
  test(
    language + ' preparation failure retains files and stops the sequence',
    async (t) => {
      const { root, template } = await project(t, language);
      for (const mode of ['exit', 'missing', 'no-process']) {
        const { state, prepare } = fixture();
        if (mode === 'exit') state.exitCode = 1;
        else if (mode === 'missing') state.rejectTask = true;
        else state.endWithoutProcess = true;
        assert.equal(await prepare(root, template, () => true), false);
        assert.equal(state.tasks.length, 1);
        assert.match(
          state.warning[0],
          language === 'typescript' ? /bun install/ : /cargo build/,
        );
        assert.ok((await fs.stat(root)).isDirectory());
      }
    },
  );
}
test('TypeScript build waits for install success, uses task identity and aborts on trust loss', async (t) => {
  const { root, template } = await project(t, 'typescript');
  const { state, api, prepare } = fixture();
  api.tasks.executeTask = async (task) => {
    state.tasks.push(task);
    queueMicrotask(() => {
      api.workspace.isTrusted = false;
      state.ended({
        execution: { task: { definition: { ...task.definition } } },
        exitCode: 0,
      });
    });
    return { task };
  };
  assert.equal(await prepare(root, template, () => true), false);
  assert.equal(state.tasks.length, 1);
});

async function ideFixture(t) {
  const f = fixture();
  const { root } = await project(t, 'python');
  await fs.mkdir(path.join(root, '.venv/bin'), { recursive: true });
  await fs.writeFile(path.join(root, '.venv/bin/python'), 'never executed', {
    mode: 0o700,
  });
  f.state.order = [];
  const store = new Map();
  const context = {
    subscriptions: [],
    workspaceState: {
      get: (key) => store.get(key),
      update: async (key, value) =>
        value === undefined ? store.delete(key) : store.set(key, value),
    },
  };
  t.after(() => context.subscriptions.forEach((s) => s.dispose()));
  f.api.workspace.onDidChangeWorkspaceFolders = (fn) => {
    f.state.rootsChanged = fn;
    return { dispose() {} };
  };
  f.api.workspace.onDidGrantWorkspaceTrust = (fn) => {
    f.state.trustChanged = fn;
    return { dispose() {} };
  };
  Object.assign(f.api.extensions, {
    onDidChange: (fn) => {
      f.state.extensionsChanged = fn;
      return { dispose() {} };
    },
    getExtension: (id) => {
      if (id === 'ms-python.vscode-python-envs') return f.state.projectsExtension;
      assert.equal(id, 'ms-python.python');
      return f.state.missingExtension
        ? undefined
        : {
            activate: async () => {
              await f.state.onActivate?.();
              return {
                environments: {
                  getActiveEnvironmentPath: f.state.missingGetter ? undefined : (resource) => {
                    assert.equal(resource.fsPath, path.join(root, 'pyproject.toml'));
                    f.state.reads = (f.state.reads ?? 0) + 1;
                    const confirmed = !f.state.mismatch && f.state.reads > (f.state.delayedReads ?? 0);
                    f.state.order.push(confirmed ? 'confirmed' : 'waiting');
                    return { path: confirmed ? f.state.activePath : '/usr/bin/python3' };
                  },
                  updateActiveEnvironmentPath: async (executable, resource) => {
                    f.state.selections ??= [];
                    f.state.selections.push({ executable, resource });
                    f.state.order.push('select');
                    f.state.activePath = executable;
                    await f.state.onSelect?.();
                  },
                },
              };
            },
          };
    },
  });
  return { ...f, root, store, context };
}
async function waitIde(predicate, attempts = 100) {
  for (let i = 0; i < attempts; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('IDE callback did not complete');
}
test('Prepared Python project automatically adds exact root and selects lexical venv via public Python API', async (t) => {
  const f = await ideFixture(t);
  f.api.workspace.workspaceFolders = [
    { uri: { scheme: 'file', fsPath: path.dirname(f.root) } },
  ];
  assert.equal(await f.configureIde(f.root, f.context, () => true), true);
  assert.equal(f.state.updates[0][2].uri.fsPath, f.root);
  assert.equal(f.state.warning, undefined);
  assert.equal(f.state.tasks.length, 0);
  assert.equal(
    f.state.selections,
    undefined,
    'do not change parent interpreter before exact root added',
  );
  f.api.workspace.workspaceFolders.push({
    uri: { scheme: 'file', fsPath: f.root },
  });
  f.state.rootsChanged();
  await waitIde(() => f.state.selections?.length === 1 && f.store.size === 0);
  assert.equal(
    f.state.selections[0].executable,
    path.join(f.root, '.venv/bin/python'),
  );
  assert.equal(f.state.selections[0].resource.fsPath, path.join(f.root, 'pyproject.toml'));
});
test('Queued selection resumes after extension host reload, without migrating arbitrary existing roots', async (t) => {
  const f = await ideFixture(t);
  f.store.set('scalewayAI.pendingPythonIdeProject', f.root);
  f.api.workspace.workspaceFolders = [
    { uri: { scheme: 'file', fsPath: f.root } },
  ];
  f.initializeIde(f.context);
  await waitIde(() => f.store.size === 0);
  assert.equal(f.state.selections.length, 1);
  assert.deepEqual(f.state.order, ['select', 'confirmed', 'open']);
  assert.deepEqual(f.state.openedEntries, [f.root]);
  f.state.rootsChanged();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(f.state.selections.length, 1);
});
test('IDE setup refuses untrusted/stale roots and failed add; missing Python extension is recoverable', async (t) => {
  for (const mode of ['untrusted', 'stale', 'refused', 'missing']) {
    const f = await ideFixture(t);
    if (mode === 'untrusted') f.api.workspace.isTrusted = false;
    if (mode === 'refused') f.state.updateResult = false;
    if (mode === 'missing') {
      f.state.missingExtension = true;
      f.api.workspace.workspaceFolders = [
        { uri: { scheme: 'file', fsPath: f.root } },
      ];
    }
    const result = await f.configureIde(
      f.root,
      f.context,
      () => mode !== 'stale',
    );
    if (mode !== 'missing') {
      assert.equal(result, false);
      assert.equal(f.state.selections, undefined);
    } else {
      await waitIde(() => !!f.state.warning);
      assert.equal(f.state.selections, undefined);
      assert.equal(f.store.size, 1);
      f.state.missingExtension = false;
      f.state.extensionsChanged();
      await waitIde(() => f.store.size === 0);
      assert.equal(f.state.selections.length, 1);
    }
  }
});
test('Root removed during Python extension activation never mutates parent interpreter', async (t) => {
  const f = await ideFixture(t);
  f.api.workspace.workspaceFolders = [
    { uri: { scheme: 'file', fsPath: f.root } },
  ];
  f.state.onActivate = async () => {
    f.api.workspace.workspaceFolders = [];
  };
  await f.configureIde(f.root, f.context, () => true);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(f.state.selections, undefined);
});

test('Python entry waits for active environment confirmation, not just API update completion', async (t) => {
  const f = await ideFixture(t);
  f.state.delayedReads = 2;
  f.api.workspace.workspaceFolders = [{ uri: { scheme: 'file', fsPath: f.root } }];
  await f.configureIde(f.root, f.context, () => true);
  await waitIde(() => f.state.reads === 1);
  assert.equal(f.state.openedEntries, undefined);
  assert.equal(f.store.size, 1);
  await waitIde(() => f.store.size === 0);
  assert.deepEqual(f.state.order, ['select', 'waiting', 'waiting', 'confirmed', 'open']);
  assert.deepEqual(f.state.openedEntries, [f.root]);
});
test('Missing Python verification API leaves entry closed and operation queued', async (t) => {
  const f = await ideFixture(t);
  f.state.missingGetter = true;
  f.api.workspace.workspaceFolders = [{ uri: { scheme: 'file', fsPath: f.root } }];
  await f.configureIde(f.root, f.context, () => true);
  await waitIde(() => !!f.state.warning);
  assert.equal(f.state.selections, undefined);
  assert.equal(f.state.openedEntries, undefined);
  assert.equal(f.store.size, 1);
});
test('Unconfirmed Python environment has bounded retry, keeps queue and opens nothing', async (t) => {
  const f = await ideFixture(t);
  f.state.mismatch = true;
  f.api.workspace.workspaceFolders = [{ uri: { scheme: 'file', fsPath: f.root } }];
  await f.configureIde(f.root, f.context, () => true);
  await waitIde(() => !!f.state.warning, 1200);
  assert.equal(f.state.reads, 40);
  assert.equal(f.state.openedEntries, undefined);
  assert.equal(f.store.size, 1);
  f.state.mismatch = false;
  f.state.extensionsChanged();
  await waitIde(() => f.store.size === 0);
  assert.deepEqual(f.state.openedEntries, [f.root]);
});
for (const mode of ['removed', 'untrusted', 'superseded']) {
  test('Python entry is not opened when selection becomes ' + mode, async (t) => {
    const f = await ideFixture(t);
    f.api.workspace.workspaceFolders = [{ uri: { scheme: 'file', fsPath: f.root } }];
    f.state.onSelect = async () => {
      if (mode === 'removed') f.api.workspace.workspaceFolders = [];
      if (mode === 'untrusted') f.api.workspace.isTrusted = false;
      if (mode === 'superseded') f.store.set('scalewayAI.pendingPythonIdeProject', path.join(f.root, 'another'));
    };
    await f.configureIde(f.root, f.context, () => true);
    await waitIde(() => f.state.selections?.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(f.state.openedEntries, undefined);
    assert.equal(f.store.size, 1);
  });
}

async function projectApiFixture(t) {
  const f = await ideFixture(t);
  const projectUri = { scheme: 'file', fsPath: f.root };
  const parentUri = { scheme: 'file', fsPath: path.dirname(f.root) };
  f.api.workspace.workspaceFolders = [{ uri: parentUri }, { uri: projectUri }];
  f.state.owner = { name: 'parent', uri: parentUri };
  const local = { envId: { id: 'child-venv', managerId: 'venv-manager' }, sysPrefix: path.join(f.root, '.venv'), execInfo: { run: { executable: path.join(f.root, '.venv/bin/python') } } };
  const system = { envId: { id: 'system', managerId: 'system-manager' }, sysPrefix: '/usr', execInfo: { run: { executable: '/usr/bin/python' } } };
  const projectApi = {
    getPythonProject: (uri) => {
      assert.ok([f.root, path.join(f.root, 'pyproject.toml')].includes(uri.fsPath));
      return f.state.owner;
    },
    addPythonProject: (project) => {
      assert.equal(project.uri.fsPath, f.root);
      f.state.added = project;
      if (!f.state.refuseChild) f.state.owner = project;
      f.state.order.push('register-child');
    },
    resolveEnvironment: async (uri) => {
      assert.equal(uri.fsPath, local.execInfo.run.executable);
      f.state.order.push('resolve');
      await f.state.onResolve?.();
      return f.state.badResolved ? system : local;
    },
    setEnvironment: async (uri, env) => {
      assert.equal(uri.fsPath, f.root, 'never select parent or global');
      assert.equal(env, local, 'use manager-returned environment object');
      f.state.projectSelection = { uri, env };
      f.state.order.push('select-child');
      await f.state.onProjectSelect?.();
    },
    getEnvironment: async (uri) => {
      assert.ok([f.root, path.join(f.root, 'pyproject.toml')].includes(uri.fsPath));
      f.state.projectReads = (f.state.projectReads ?? 0) + 1;
      const stale = f.state.projectReads <= (f.state.staleReads ?? 0) || (f.state.fileMismatch && uri.fsPath !== f.root);
      return stale ? system : local;
    },
  };
  f.state.projectsExtension = { activate: async () => projectApi };
  return { ...f, projectApi, local };
}
test('Python Environments registers exact nested child and selects/verifies file and folder without legacy parent mutation', async (t) => {
  const f = await projectApiFixture(t);
  f.state.staleReads = 2;
  await f.configureIde(f.root, f.context, () => true);
  await waitIde(() => f.state.projectReads === 2);
  assert.equal(f.state.openedEntries, undefined);
  await waitIde(() => f.store.size === 0);
  assert.equal(f.state.added.uri.fsPath, f.root);
  assert.equal(f.state.projectSelection.uri.fsPath, f.root);
  assert.equal(f.state.selections, undefined, 'do not call legacy settings setter with Python Environments present');
  assert.deepEqual(f.state.order, ['register-child', 'resolve', 'select-child', 'open']);
  assert.deepEqual(f.state.openedEntries, [f.root]);
});
test('Existing exact Python child is reused during queued reload resumption', async (t) => {
  const f = await projectApiFixture(t);
  f.state.owner = { name: 'child', uri: { fsPath: f.root } };
  f.store.set('scalewayAI.pendingPythonIdeProject', f.root);
  f.initializeIde(f.context);
  await waitIde(() => f.store.size === 0);
  assert.equal(f.state.added, undefined);
  assert.deepEqual(f.state.openedEntries, [f.root]);
});
test('System environment returned by resolver is refused before any selection', async (t) => {
  const f = await projectApiFixture(t);
  f.state.badResolved = true;
  await f.configureIde(f.root, f.context, () => true);
  await waitIde(() => !!f.state.warning);
  assert.equal(f.state.projectSelection, undefined);
  assert.equal(f.state.openedEntries, undefined);
  assert.equal(f.store.size, 1);
});
test('Child ownership refusal never falls back to selecting parent', async (t) => {
  const f = await projectApiFixture(t);
  f.state.refuseChild = true;
  await f.configureIde(f.root, f.context, () => true);
  await waitIde(() => !!f.state.added);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(f.state.projectSelection, undefined);
  assert.equal(f.state.selections, undefined);
  assert.equal(f.state.openedEntries, undefined);
  assert.equal(f.store.size, 1);
});
test('Python Environments API failure never silently falls back to legacy API', async (t) => {
  const f = await projectApiFixture(t);
  f.projectApi.setEnvironment = undefined;
  await f.configureIde(f.root, f.context, () => true);
  await waitIde(() => !!f.state.warning);
  assert.equal(f.state.selections, undefined);
  assert.equal(f.state.openedEntries, undefined);
  assert.equal(f.store.size, 1);
});
test('File-level environment must match child selection even when folder getter matches', async (t) => {
  const f = await projectApiFixture(t);
  f.state.fileMismatch = true;
  await f.configureIde(f.root, f.context, () => true);
  await waitIde(() => !!f.state.warning, 1200);
  assert.equal(f.state.projectReads, 80);
  assert.equal(f.state.openedEntries, undefined);
  assert.equal(f.store.size, 1);
});
for (const mode of ['removed', 'untrusted', 'superseded']) {
  test('Project environment resolver aborts safely when ' + mode, async (t) => {
    const f = await projectApiFixture(t);
    f.state.onResolve = async () => {
      if (mode === 'removed') f.api.workspace.workspaceFolders = [];
      if (mode === 'untrusted') f.api.workspace.isTrusted = false;
      if (mode === 'superseded') f.store.set('scalewayAI.pendingPythonIdeProject', path.join(f.root, 'another'));
    };
    await f.configureIde(f.root, f.context, () => true);
    await waitIde(() => f.state.order.includes('resolve'));
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(f.state.projectSelection, undefined);
    assert.equal(f.state.openedEntries, undefined);
  });
}

async function compiledFixture(t, language) {
  const f = await ideFixture(t);
  if (language === 'typescript') {
    await fs.writeFile(path.join(f.root, 'tsconfig.json'), '{}');
    await fs.mkdir(path.join(f.root, 'node_modules/typescript/lib'), { recursive: true });
    for (const name of ['tsserver.js', 'tsc.js']) await fs.writeFile(path.join(f.root, 'node_modules/typescript/lib', name), 'never executed');
  } else await fs.writeFile(path.join(f.root, 'Cargo.toml'), '[package]');
  f.api.workspace.getConfiguration = (section, uri) => {
    assert.equal(uri.fsPath, path.join(f.root, language === 'typescript' ? 'tsconfig.json' : 'Cargo.toml'));
    return { get: (key) => f.state.badConfig ? undefined : key === 'tsdk' ? 'node_modules/typescript/lib' : ['./Cargo.toml'] };
  };
  f.api.extensions.getExtension = (id) => {
    assert.equal(id, language === 'typescript' ? 'vscode.typescript-language-features' : 'rust-lang.rust-analyzer');
    return f.state.missingLanguageExtension ? undefined : { activate: async () => { f.state.order.push('activate'); await f.state.onLanguageActivate?.(); } };
  };
  return f;
}
for (const language of ['typescript', 'rust']) {
  test(language + ' queues exact workspace root before activating language IDE and opening entry', async (t) => {
    const f = await compiledFixture(t, language);
    f.api.workspace.workspaceFolders = [{ uri: { scheme: 'file', fsPath: path.dirname(f.root) } }];
    assert.equal(await f.configureCompiledIde(f.root, language, f.context, () => true), true);
    assert.equal(f.state.updates[0][2].uri.fsPath, f.root);
    assert.equal(f.state.openedEntries, undefined);
    f.api.workspace.workspaceFolders.push({ uri: { scheme: 'file', fsPath: f.root } });
    f.state.rootsChanged();
    await waitIde(() => f.store.size === 0);
    assert.deepEqual(f.state.order, ['activate', 'open']);
    assert.deepEqual(f.state.openedEntries, [f.root]);
    assert.equal(f.state.tasks.length, 0);
  });
  test(language + ' resumes queued project after simulated activation without scanning existing projects', async (t) => {
    const f = await compiledFixture(t, language);
    f.api.workspace.workspaceFolders = [{ uri: { scheme: 'file', fsPath: f.root } }];
    f.store.set('scalewayAI.pendingCompiledIdeProject', { project: f.root, language });
    f.initializeCompiledIde(f.context);
    await waitIde(() => f.store.size === 0);
    f.state.rootsChanged();
    await new Promise(r => setTimeout(r, 15));
    assert.deepEqual(f.state.openedEntries, [f.root]);
  });
  test(language + ' missing extension opens source with explicit warning and no installation', async (t) => {
    const f = await compiledFixture(t, language);
    f.state.missingLanguageExtension = true;
    f.api.workspace.workspaceFolders = [{ uri: { scheme: 'file', fsPath: f.root } }];
    await f.configureCompiledIde(f.root, language, f.context, () => true);
    await waitIde(() => !!f.state.warning);
    assert.deepEqual(f.state.openedEntries, [f.root]);
    assert.equal(f.state.commands.length, 0);
  });
  test(language + ' invalid local configuration leaves entry closed and queue retained', async (t) => {
    const f = await compiledFixture(t, language);
    f.state.badConfig = true;
    f.api.workspace.workspaceFolders = [{ uri: { scheme: 'file', fsPath: f.root } }];
    await f.configureCompiledIde(f.root, language, f.context, () => true);
    await waitIde(() => !!f.state.warning);
    assert.equal(f.state.openedEntries, undefined);
    assert.equal(f.store.size, 1);
  });
  for (const mode of ['removed', 'untrusted', 'superseded']) {
    test(language + ' activation guards ' + mode, async (t) => {
      const f = await compiledFixture(t, language);
      f.api.workspace.workspaceFolders = [{ uri: { scheme: 'file', fsPath: f.root } }];
      f.state.onLanguageActivate = async () => {
        if (mode === 'removed') f.api.workspace.workspaceFolders = [];
        if (mode === 'untrusted') f.api.workspace.isTrusted = false;
        if (mode === 'superseded') f.store.set('scalewayAI.pendingCompiledIdeProject', { project: path.join(f.root, 'other'), language });
      };
      await f.configureCompiledIde(f.root, language, f.context, () => true);
      await waitIde(() => f.state.order.includes('activate'));
      await new Promise(r => setTimeout(r, 15));
      assert.equal(f.state.openedEntries, undefined);
      assert.equal(f.store.size, 1);
    });
  }
}

test('Compiled IDE rejects untrusted/stale/refused root addition without opening or parent changes', async (t) => {
  for (const mode of ['untrusted', 'stale', 'refused']) {
    const f = await compiledFixture(t, 'rust');
    if (mode === 'untrusted') f.api.workspace.isTrusted = false;
    if (mode === 'refused') f.state.updateResult = false;
    assert.equal(await f.configureCompiledIde(f.root, 'rust', f.context, () => mode !== 'stale'), false);
    assert.equal(f.state.openedEntries, undefined);
    assert.equal(f.store.size, 0);
  }
});
test('Missing TypeScript local compiler is not treated as prepared IDE', async (t) => {
  const f = await compiledFixture(t, 'typescript');
  await fs.rm(path.join(f.root, 'node_modules/typescript/lib/tsserver.js'));
  f.api.workspace.workspaceFolders = [{ uri: { scheme: 'file', fsPath: f.root } }];
  await f.configureCompiledIde(f.root, 'typescript', f.context, () => true);
  await waitIde(() => !!f.state.warning);
  assert.equal(f.state.openedEntries, undefined);
  assert.equal(f.store.size, 1);
});
