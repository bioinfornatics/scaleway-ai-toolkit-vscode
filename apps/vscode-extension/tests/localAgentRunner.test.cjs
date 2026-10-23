const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
async function fixture(t) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'scw-local-run-'));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  await fsp.mkdir(path.join(directory, '.vscode'));
  const config = {
    version: 1,
    ready: true,
    runtime: 'python',
    entry: 'agent.py',
    args: ['--example', ';echo unsafe'],
  };
  await fsp.writeFile(
    path.join(directory, '.vscode/scaleway-agent-run.json'),
    JSON.stringify(config),
  );
  await fsp.writeFile(
    path.join(directory, 'agent.py'),
    'raise Exception("NEVER EXECUTED IN TEST")',
  );
  const state = {
    tasks: [],
    warnings: [],
    info: [],
    changes: 0,
    terminated: 0,
    lines: [],
    listeners: {},
    shows: [],
  };
  const api = {
    Uri: { file: (fsPath) => ({ fsPath }) },
    workspace: {
      isTrusted: true,
      openTextDocument: async (options) => {
        state.document = options;
        await state.onDocument?.();
        return options;
      },
    },
    window: {
      createOutputChannel: () => ({
        appendLine: (x) => state.lines.push(x),
        show: () => {
          state.logs = true;
        },
        dispose: () => {
          state.outputDisposed = true;
        },
      }),
      showWarningMessage: async (...args) => {
        state.warnings.push(args);
        if (args[0] === 'Exécuter cet agent local ?')
          return state.confirm ? state.confirm() : 'Exécuter';
      },
      showInformationMessage: async (message) => state.info.push(message),
      showTextDocument: async (doc) => state.shows.push(doc),
    },
    Task: class {
      constructor(definition, scope, name, source, execution) {
        Object.assign(this, { definition, scope, name, source, execution });
      }
    },
    ProcessExecution: class {
      constructor(executable, args, options) {
        Object.assign(this, { executable, args, options });
      }
    },
    TaskScope: { Workspace: 1 },
    TaskRevealKind: { Always: 1 },
    TaskPanelKind: { Dedicated: 2 },
    tasks: {
      onDidStartTaskProcess: (fn) => {
        state.listeners.start = fn;
        return { dispose() {} };
      },
      onDidEndTaskProcess: (fn) => {
        state.listeners.processEnd = fn;
        return { dispose() {} };
      },
      onDidEndTask: (fn) => {
        state.listeners.end = fn;
        return { dispose() {} };
      },
      executeTask: async (task) => {
        state.tasks.push(task);
        if (state.execute) return state.execute(task);
        const execution = {
          task,
          terminate: () => {
            state.terminated++;
          },
        };
        state.execution = execution;
        return execution;
      },
    },
  };
  const filename = require.resolve('../dist/localAgentRunner');
  const mod = new Module(filename);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod.require = (r) =>
    r === 'vscode' ? api : Module.prototype.require.call(mod, r);
  mod._compile(fs.readFileSync(filename, 'utf8'), filename);
  const runner = new mod.exports.LocalAgentRunner(() => {
    state.changes++;
  });
  t.after(() => runner.dispose());
  return {
    directory,
    config,
    state,
    api,
    runner,
    parse: mod.exports.parseLocalLaunch,
  };
}
test('Given explicit ready config, When confirmed, Then fixed non-shell argv and visible task run only once; Stop waits for actual task end', async (t) => {
  const { directory, state, runner } = await fixture(t);
  assert.match(await runner.readiness(directory), /Lancement configuré/);
  await runner.start(directory, 'sample', () => true);
  assert.equal(state.tasks.length, 1);
  const task = state.tasks[0];
  assert.equal(task.execution.executable, 'python3');
  assert.deepEqual(task.execution.args, [
    path.join(directory, 'agent.py'),
    '--example',
    ';echo unsafe',
  ]);
  assert.equal(task.execution.options.cwd, directory);
  assert.match(state.warnings[0][1].detail, /NON sandboxé/);
  assert.match(state.warnings[0][1].detail, /payants/);
  await runner.start(directory, 'sample', () => true);
  assert.equal(state.tasks.length, 1);
  const id = runner.list()[0].id;
  state.listeners.start({ execution: state.execution });
  assert.equal(runner.list()[0].state, 'En cours');
  runner.stop('f'.repeat(32));
  assert.equal(state.terminated, 0);
  runner.stop(id);
  assert.equal(state.terminated, 1);
  assert.equal(runner.list()[0].active, true);
  state.listeners.processEnd({ execution: state.execution, exitCode: 0 });
  state.listeners.end({ execution: state.execution });
  assert.equal(runner.list()[0].active, false);
  assert.equal(runner.list()[0].state, 'Terminé (code 0)');
  runner.logs(id);
  assert.equal(state.logs, true);
});
test('Given unready, malformed, incomplete or linked config/entry, When launching, Then no process task is dispatched', async (t) => {
  const { directory, state, runner, config, parse } = await fixture(t);
  for (const changes of [
    { ready: false },
    { entry: '../outside.py' },
    { entry: '/tmp/a.py' },
    { runtime: 'shell' },
    { command: 'echo bad' },
    { args: ['a'.repeat(1025)] },
  ])
    assert.throws(() => parse({ ...config, ...changes }));
  await fsp.writeFile(
    path.join(directory, 'agent.authoring.json'),
    JSON.stringify({ incomplete: true }),
  );
  assert.equal(
    await runner.readiness(directory),
    'Intégration requise — commande déjà définie',
  );
  await runner.start(directory, 'blocked', () => true);
  assert.equal(state.tasks.length, 0);
  await fsp.unlink(path.join(directory, 'agent.authoring.json'));
  await fsp.rename(
    path.join(directory, 'agent.py'),
    path.join(directory, 'saved.py'),
  );
  await fsp.symlink('saved.py', path.join(directory, 'agent.py'));
  await runner.start(directory, 'linked', () => true);
  assert.equal(state.tasks.length, 0);
});
test('Given pending confirmation, When cancelled or trust/context/config/entry changes, Then no late launch occurs', async (t) => {
  for (const boundary of ['cancel', 'trust', 'context', 'config', 'entry']) {
    const { directory, state, runner, api } = await fixture(t);
    let current = true;
    state.confirm = async () => {
      if (boundary === 'cancel') return undefined;
      if (boundary === 'trust') api.workspace.isTrusted = false;
      if (boundary === 'context') current = false;
      if (boundary === 'config')
        await fsp.writeFile(
          path.join(directory, '.vscode/scaleway-agent-run.json'),
          '{}',
        );
      if (boundary === 'entry')
        await fsp.writeFile(path.join(directory, 'agent.py'), 'changed');
      return 'Exécuter';
    };
    await runner.start(directory, boundary, () => current);
    assert.equal(state.tasks.length, 0, boundary);
  }
});
test('Given concurrent launch and async task dispatch, When invalidated or disposed, Then duplicate dispatch is forbidden and returned task is terminated', async (t) => {
  const { directory, state, runner } = await fixture(t);
  let release, started;
  const gate = new Promise((r) => (release = r));
  const reached = new Promise((r) => (started = r));
  state.execute = async (task) => {
    started();
    await gate;
    return {
      task,
      terminate: () => {
        state.terminated++;
      },
    };
  };
  let current = true;
  const pending = runner.start(directory, 'pending', () => current);
  await reached;
  await runner.start(directory, 'duplicate', () => true);
  assert.equal(state.tasks.length, 1);
  current = false;
  release();
  await pending;
  assert.equal(state.terminated, 1);
  runner.dispose();
  assert.equal(state.outputDisposed, true);
  await runner.start(directory, 'disposed', () => true);
  assert.equal(state.tasks.length, 1);
});
test('Given a task failure or unknown exit, When task events finish, Then status is not a fabricated success; unrelated tasks cannot change it', async (t) => {
  const { directory, state, runner } = await fixture(t);
  await runner.start(directory, 'failing', () => true);
  state.listeners.processEnd({
    execution: { task: { definition: { localRunId: 'unknown' } } },
    exitCode: 0,
  });
  assert.equal(runner.list()[0].state, 'Démarrage');
  state.listeners.processEnd({ execution: state.execution, exitCode: 2 });
  state.listeners.end({ execution: state.execution });
  assert.equal(runner.list()[0].state, 'Échec (code 2)');
});
test('Given Configurer, When draft opens, Then no config write or task occurs and stale UI cannot be shown', async (t) => {
  const { directory, state, runner } = await fixture(t);
  await fsp.unlink(path.join(directory, '.vscode/scaleway-agent-run.json'));
  await runner.configure(directory, () => true);
  assert.equal(state.tasks.length, 0);
  assert.equal(JSON.parse(state.document.content).ready, false);
  assert.match(state.info[0], /Brouillon non enregistré/);
  let current = true;
  state.onDocument = () => {
    current = false;
  };
  const count = state.shows.length;
  await runner.configure(directory, () => current);
  assert.equal(state.shows.length, count);
});

test('Given generated unready launch, When inspected, Then integration is required and existing configuration opens without a redundant draft', async (t) => {
  const { directory, state, runner, config } = await fixture(t);
  await fsp.writeFile(
    path.join(directory, '.vscode/scaleway-agent-run.json'),
    JSON.stringify({ ...config, ready: false }),
  );
  assert.equal(
    await runner.readiness(directory),
    'Intégration requise — commande déjà définie',
  );
  await runner.configure(directory, () => true);
  assert.equal(
    state.document.fsPath,
    path.join(directory, '.vscode/scaleway-agent-run.json'),
  );
  assert.equal(state.info.length, 0);
  await runner.start(directory, 'not-ready', () => true);
  assert.equal(state.tasks.length, 0);
});

test('projectInfo shows only bounded known authoring metadata and refuses unsafe files', async (t) => {
  const { directory, runner } = await fixture(t);
  const marker = path.join(directory, 'agent.authoring.json');
  await fsp.writeFile(
    marker,
    JSON.stringify({
      language: 'python',
      backend: 'fastapi',
      ai_framework: 'strands',
      selected_model: { kind: 'serverless', model_id: 'deepseek-v4.1-flash' },
      note: 'private-note',
      api_key: 'secret-value',
      endpoint: 'https://private.invalid',
    }),
  );
  assert.deepEqual(await runner.projectInfo(directory), [
    ['Langage', 'python'],
    ['Backend', 'fastapi'],
    ['Framework IA', 'strands'],
    ['Modèle', 'deepseek-v4.1-flash'],
    ['Service', 'Serverless'],
  ]);
  await fsp.writeFile(
    marker,
    JSON.stringify({
      language: '<script>',
      selected_model: { model_id: 'sk-privatecredential' },
    }),
  );
  assert.deepEqual(await runner.projectInfo(directory), []);
  await fsp.writeFile(marker, 'x'.repeat(65537));
  assert.deepEqual(await runner.projectInfo(directory), []);
  await fsp.unlink(marker);
  await fsp.symlink(path.join(directory, 'agent.py'), marker);
  assert.deepEqual(await runner.projectInfo(directory), []);
});

test('Open uses declared unready entry, not authoring; absent config falls back to known source; unsafe or changed entry refused', async (t) => {
  for (const scenario of [
    'configured',
    'fallback',
    'missing',
    'escape',
    'link',
    'changed',
    'stale',
  ]) {
    const f = await fixture(t);
    const entry = path.join(f.directory, 'src/agent_app/agent.py');
    await fsp.mkdir(path.dirname(entry), { recursive: true });
    await fsp.writeFile(entry, 'print("test")');
    await fsp.writeFile(
      path.join(f.directory, 'agent.authoring.json'),
      JSON.stringify({ incomplete: true }),
    );
    const configPath = path.join(
      f.directory,
      '.vscode/scaleway-agent-run.json',
    );
    await fsp.writeFile(
      configPath,
      JSON.stringify({
        ...f.config,
        ready: false,
        entry: 'src/agent_app/agent.py',
      }),
    );
    if (scenario === 'fallback') await fsp.unlink(configPath);
    if (scenario === 'missing') await fsp.unlink(entry);
    if (scenario === 'escape')
      await fsp.writeFile(
        configPath,
        JSON.stringify({ ...f.config, entry: '../outside.py' }),
      );
    if (scenario === 'link') {
      await fsp.unlink(entry);
      await fsp.symlink(path.join(f.directory, 'agent.py'), entry);
    }
    let current = true;
    f.api.workspace.openTextDocument = async (uri) => {
      f.state.document = uri;
      if (scenario === 'changed') await fsp.writeFile(entry, 'changed content');
      if (scenario === 'stale') current = false;
      return { uri, isClosed: false };
    };
    await f.runner.openEntry(f.directory, () => current);
    if (['configured', 'fallback'].includes(scenario)) {
      assert.equal(f.state.shows.length, 1, scenario);
      assert.equal(f.state.shows[0].uri.fsPath, entry, scenario);
    } else assert.equal(f.state.shows.length, 0, scenario);
    assert.equal(f.state.tasks.length, 0);
  }
});

test('Python project requires local venv and dispatches its interpreter without installation', async (t) => {
  const f = await fixture(t);
  await fsp.writeFile(
    path.join(f.directory, 'pyproject.toml'),
    '[project]\nname="test"\n',
  );
  assert.match(await f.runner.readiness(f.directory), /uv sync/);
  await f.runner.start(f.directory, 'test', () => true);
  assert.equal(f.state.tasks.length, 0);
  await fsp.mkdir(path.join(f.directory, '.venv/bin'), { recursive: true });
  const executable = path.join(f.directory, '.venv/bin/python');
  await fsp.writeFile(executable, 'mock interpreter never executed', {
    mode: 0o700,
  });
  assert.match(await f.runner.readiness(f.directory), /Lancement configuré/);
  await f.runner.start(f.directory, 'test', () => true);
  assert.equal(f.state.tasks[0].execution.executable, executable);
});

test('Python symlink-backed venv preserves virtualenv context when dispatched', async (t) => {
  const { execFileSync } = require('node:child_process');
  const f = await fixture(t);
  await fsp.writeFile(path.join(f.directory, 'pyproject.toml'), '[project]');
  const env = path.join(f.directory, '.venv');
  execFileSync('python3', ['-m', 'venv', '--without-pip', '--symlinks', env]);
  const executable = path.join(env, 'bin/python');
  assert.equal((await fsp.lstat(executable)).isSymbolicLink(), true);
  await f.runner.start(f.directory, 'test', () => true);
  assert.equal(f.state.tasks.length, 1);
  const dispatched = f.state.tasks[0].execution.executable;
  assert.equal(dispatched, executable);
  const probe = 'import sys; print(sys.prefix != sys.base_prefix)';
  assert.equal(
    execFileSync(dispatched, ['-c', probe], { encoding: 'utf8' }).trim(),
    'True',
  );
  assert.equal(
    execFileSync(await fsp.realpath(executable), ['-c', probe], {
      encoding: 'utf8',
    }).trim(),
    'False',
  );
});

test('Version 2 Python console entry runs installed command with args only and guards manifest mutation', async (t) => {
  const f = await fixture(t);
  await fsp.mkdir(path.join(f.directory, 'src/agent_app'), { recursive: true });
  await fsp.writeFile(path.join(f.directory, 'src/agent_app/agent.py'), '# offline');
  await fsp.mkdir(path.join(f.directory, '.venv/bin'), { recursive: true });
  await fsp.writeFile(path.join(f.directory, '.venv/bin/python'), '# fake python', { mode: 0o700 });
  await fsp.writeFile(path.join(f.directory, '.venv/bin/agent'), '# fake installed entry', { mode: 0o700 });
  const manifest = '[project.scripts]\nagent = "agent_app.agent:main"\n';
  await fsp.writeFile(path.join(f.directory, 'pyproject.toml'), manifest);
  const config = { ...f.config, version: 2, consoleScript: 'agent', entry: 'src/agent_app/agent.py', args: ['Bonjour'] };
  await fsp.writeFile(path.join(f.directory, '.vscode/scaleway-agent-run.json'), JSON.stringify(config));
  await f.runner.start(f.directory, 'console', () => true);
  assert.equal(f.state.tasks[0].execution.executable, path.join(f.directory, '.venv/bin/agent'));
  assert.deepEqual(f.state.tasks[0].execution.args, ['Bonjour']);
  f.state.listeners.processEnd({ execution: f.state.execution, exitCode: 0 });
  f.state.confirm = async () => { await fsp.writeFile(path.join(f.directory, 'pyproject.toml'), manifest + '# changed'); return 'Exécuter'; };
  await f.runner.start(f.directory, 'changed', () => true);
  assert.equal(f.state.tasks.length, 1);
  assert.throws(() => f.parse({ ...config, runtime: 'node' }));
  assert.throws(() => f.parse({ ...config, consoleScript: '../other' }));
});
test('Missing installed Python console command refuses launch instead of installing or falling back', async (t) => {
  const f = await fixture(t);
  await fsp.mkdir(path.join(f.directory, 'src/agent_app'), { recursive: true });
  await fsp.writeFile(path.join(f.directory, 'src/agent_app/agent.py'), '# offline');
  await fsp.mkdir(path.join(f.directory, '.venv/bin'), { recursive: true });
  await fsp.writeFile(path.join(f.directory, '.venv/bin/python'), '# fake', { mode: 0o700 });
  await fsp.writeFile(path.join(f.directory, 'pyproject.toml'), '[project.scripts]\nagent="agent_app.agent:main"');
  await fsp.writeFile(path.join(f.directory, '.vscode/scaleway-agent-run.json'), JSON.stringify({ ...f.config, version: 2, consoleScript: 'agent', entry: 'src/agent_app/agent.py' }));
  await f.runner.start(f.directory, 'missing', () => true);
  assert.equal(f.state.tasks.length, 0);
});
