const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { withEndpointLaunch } = require('../dist/endpointAgent');
function base() {
  return {
    version: 1,
    id: 'endpoint-test',
    label: 'Test',
    kind: 'agents',
    description: 'Test',
    files: {
      'README.md': 'Base',
      'agent.authoring.json': JSON.stringify({ incomplete: true }),
      'package.json': JSON.stringify({ type: 'module' }),
    },
  };
}
const env =
  "SCW_INFERENCE_BASE_URL='https://example.invalid/v1'\nSCW_INFERENCE_MODEL_ID='test-model'\nSCW_API_KEY='offline-key'\n";

test('Given host-owned Python/Node project, Then standalone endpoint and launch are configured without modifying backend payloads', () => {
  for (const language of ['python', 'typescript']) {
    const original = base();
    const result = withEndpointLaunch(original, language);
    const config = JSON.parse(result.files['.vscode/scaleway-agent-run.json']);
    assert.equal(config.ready, true);
    assert.ok(result.files[config.entry]);
    assert.equal(
      JSON.parse(result.files['agent.authoring.json']).incomplete,
      false,
    );
    if (language === 'python')
      assert.equal(
        result.files['package.json'],
        original.files['package.json'],
      );
    else
      assert.equal(
        JSON.parse(result.files['package.json']).type,
        JSON.parse(original.files['package.json']).type,
      );
    assert.equal(original.files['scaleway_agent.py'], undefined);
    assert.throws(() => withEndpointLaunch(result, language), /conflict/);
  }
  const rust = base();
  assert.equal(withEndpointLaunch(rust, 'rust'), rust);
});

test('Given Node endpoint client, Then check has no inference and explicit launch sends selected model/prompt/auth with redirects refused', async () => {
  const result = withEndpointLaunch(base(), 'typescript');
  async function invoke(args, source = env, fail = false) {
    const state = { requests: [], logs: [], errors: [] };
    const proc = { argv: ['node', 'entry', ...args], env: {} };
    const context = {
      process: proc,
      __dirname: '/project',
      URL,
      AbortSignal,
      require: (name) =>
        name === 'node:fs' ? { readFileSync: () => source } : require(name),
      console: {
        log: (value) => state.logs.push(value),
        error: (value) => state.errors.push(value),
      },
      fetch: async (url, options) => {
        state.requests.push({ url, options });
        return {
          ok: !fail,
          json: async () => ({
            choices: [{ message: { content: 'mock-response' } }],
          }),
        };
      },
    };
    vm.runInNewContext(result.files['scaleway_agent.cjs'], context);
    await new Promise((resolve) => setImmediate(resolve));
    return { state, proc };
  }
  const check = await invoke(['--check']);
  assert.equal(check.state.requests.length, 0);
  assert.equal(check.state.errors.length, 0);
  const run = await invoke(['hello']);
  const request = run.state.requests[0];
  assert.equal(request.url, 'https://example.invalid/v1/chat/completions');
  assert.equal(request.options.headers.Authorization, 'Bearer offline-key');
  assert.equal(request.options.redirect, 'error');
  assert.equal(JSON.parse(request.options.body).model, 'test-model');
  assert.equal(JSON.parse(request.options.body).messages[0].content, 'hello');
  assert.deepEqual(run.state.logs, ['mock-response']);
  const invalid = await invoke([], env.replace('https:', 'http:'));
  assert.equal(invalid.state.requests.length, 0);
  const fail = await invoke([], env, true);
  assert.equal(fail.proc.exitCode, 1);
  assert.doesNotMatch(fail.state.errors.join(''), /offline-key/);
});

test('Given generated Python client, Then real interpreter checks config and mocked transport verifies request without any network', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'endpoint-agent-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const result = withEndpointLaunch(base(), 'python');
  const entry = path.join(dir, 'scaleway_agent.py');
  fs.writeFileSync(entry, result.files['scaleway_agent.py']);
  fs.writeFileSync(path.join(dir, '.env'), env);
  const cleanEnv = { ...process.env };
  for (const key of Object.keys(cleanEnv))
    if (key.startsWith('SCW_')) delete cleanEnv[key];
  const check = spawnSync('python3', [entry, '--check'], {
    encoding: 'utf8',
    env: cleanEnv,
  });
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout, /aucun appel réseau/);
  const harness = [
    'import runpy,sys,urllib.request,io,json',
    'class Response(io.BytesIO):',
    ' def __enter__(self): return self',
    ' def __exit__(self,*args): self.close()',
    'class Opener:',
    ' def open(self,request,timeout):',
    '  assert request.full_url == "https://example.invalid/v1/chat/completions"',
    '  assert request.get_header("Authorization") == "Bearer offline-key"',
    '  assert json.loads(request.data)["model"] == "test-model"',
    '  assert json.loads(request.data)["messages"][0]["content"] == "hello"',
    '  return Response(json.dumps({"choices":[{"message":{"content":"mock-response"}}]}).encode())',
    'urllib.request.build_opener=lambda *args: Opener()',
    'sys.argv=[sys.argv[1],"hello"]',
    'runpy.run_path(sys.argv[0],run_name="__main__")',
  ].join(String.fromCharCode(10));
  const run = spawnSync('python3', ['-c', harness, entry], {
    encoding: 'utf8',
    env: cleanEnv,
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), 'mock-response');
  fs.writeFileSync(path.join(dir, '.env'), env.replace('https:', 'http:'));
  const invalid = spawnSync('python3', [entry, '--check'], {
    encoding: 'utf8',
    env: cleanEnv,
  });
  assert.equal(invalid.status, 1);
  assert.doesNotMatch(invalid.stderr, /offline-key/);
});

test('Host Python agent gets folder-local interpreter, pytest, debug entry and recommendations', () => {
  const original = base();
  original.files['pyproject.toml'] = '[project]';
  original.files['src/agent_app/agent.py'] = '# real SDK entry';
  const result = withEndpointLaunch(original, 'python');
  const settings = JSON.parse(result.files['.vscode/settings.json']);
  assert.equal(
    settings['python.defaultInterpreterPath'],
    '${workspaceFolder}/.venv',
  );
  assert.equal(settings['python.testing.pytestEnabled'], true);
  assert.equal(settings['python.testing.unittestEnabled'], false);
  assert.deepEqual(settings['python.testing.pytestArgs'], ['tests']);
  assert.equal(settings['python.testing.cwd'], '${workspaceFolder}');
  const debug = JSON.parse(result.files['.vscode/launch.json'])
    .configurations[0];
  assert.equal(debug.type, 'debugpy');
  assert.equal(debug.program, '${workspaceFolder}/src/agent_app/agent.py');
  assert.equal(debug.python, '${workspaceFolder}/.venv/bin/python');
  assert.equal(
    debug.windows.python,
    '${workspaceFolder}/.venv/Scripts/python.exe',
  );
  assert.equal(original.files['.vscode/settings.json'], undefined);
  assert.ok(
    JSON.parse(
      result.files['.vscode/extensions.json'],
    ).recommendations.includes('ms-python.python'),
  );
  assert.equal(
    JSON.parse(
      withEndpointLaunch(base(), 'typescript').files['.vscode/settings.json'],
    )['python.defaultInterpreterPath'],
    undefined,
  );
});

test('TypeScript folder config uses local compiler, source maps, entry debugging and offline import test', async (t) => {
  const {
    prepareEmbeddedProject,
    renderProjectTemplate,
  } = require('../dist/projectGenerator');
  const { stackChoices } = require('../dist/stackScaffold');
  const { transformSync } = require('esbuild');
  const original = renderProjectTemplate(
    prepareEmbeddedProject(
      stackChoices('agents').find((s) => s.language === 'typescript').template,
      'typescript',
    ),
    { name: 'test-agent' },
  );
  const result = withEndpointLaunch(original, 'typescript');
  const settings = JSON.parse(result.files['.vscode/settings.json']);
  assert.equal(settings['typescript.tsdk'], 'node_modules/typescript/lib');
  const compiler = JSON.parse(result.files['tsconfig.json']).compilerOptions;
  assert.equal(compiler.sourceMap, true);
  assert.equal(compiler.inlineSources, true);
  assert.equal(compiler.rootDir, 'src');
  const debug = JSON.parse(result.files['.vscode/launch.json'])
    .configurations[0];
  assert.equal(
    debug.program,
    '${workspaceFolder}/' +
      JSON.parse(result.files['.vscode/scaleway-agent-run.json']).entry,
  );
  assert.equal(debug.preLaunchTask, 'Construire le projet');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scw-ts-offline-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'dist'));
  fs.mkdirSync(path.join(root, 'tests'));
  fs.writeFileSync(
    path.join(root, 'package.json'),
    result.files['package.json'],
  );
  fs.writeFileSync(
    path.join(root, 'dist/agent.js'),
    transformSync(result.files['src/agent.ts'], { loader: 'ts', format: 'esm' })
      .code,
  );
  fs.writeFileSync(
    path.join(root, 'tests/scaleway-project.test.cjs'),
    result.files['tests/scaleway-project.test.cjs'],
  );
  const run = spawnSync(
    process.execPath,
    ['--test', 'tests/scaleway-project.test.cjs'],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.equal(original.files['.vscode/settings.json'], undefined);
});
test('Rust workspace config preserves runtime flags, supplies cargo tests and CodeLLDB without invented agent binary', () => {
  const {
    prepareEmbeddedProject,
    renderProjectTemplate,
  } = require('../dist/projectGenerator');
  const { stackChoices } = require('../dist/stackScaffold');
  for (const stack of stackChoices('agents').filter(
    (s) => s.language === 'rust',
  )) {
    const original = renderProjectTemplate(
      prepareEmbeddedProject(stack.template, 'rust'),
      { name: 'test-agent' },
    );
    const result = withEndpointLaunch(original, 'rust');
    assert.equal(
      result.files['agent.authoring.json'],
      original.files['agent.authoring.json'],
    );
    assert.equal(
      result.files['.vscode/scaleway-agent-run.json'],
      original.files['.vscode/scaleway-agent-run.json'],
    );
    assert.deepEqual(
      JSON.parse(result.files['.vscode/settings.json'])[
        'rust-analyzer.linkedProjects'
      ],
      ['./Cargo.toml'],
    );
    const debug = JSON.parse(result.files['.vscode/launch.json'])
      .configurations[0];
    assert.equal(debug.type, 'lldb');
    assert.deepEqual(debug.cargo.args, [
      'test',
      '--no-run',
      '--test',
      'project_layout',
    ]);
    assert.ok(result.files['tests/project_layout.rs'].includes('#[test]'));
    assert.equal(original.files['.vscode/launch.json'], undefined);
  }
});

test('Rust generated test runs in a dependency-free crate with cargo offline', (t) => {
  const {
    prepareEmbeddedProject,
    renderProjectTemplate,
  } = require('../dist/projectGenerator');
  const { stackChoices } = require('../dist/stackScaffold');
  const stack =
    stackChoices('agents').find(
      (s) => s.language === 'rust' && s.backend === 'none',
    ) ??
    stackChoices('agents').find(
      (s) =>
        s.language === 'rust' &&
        !s.template.files['Cargo.toml'].includes('axum') &&
        !s.template.files['Cargo.toml'].includes('actix'),
    );
  assert.ok(stack);
  const template = withEndpointLaunch(
    renderProjectTemplate(prepareEmbeddedProject(stack.template, 'rust'), {
      name: 'rust-offline-test',
    }),
    'rust',
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scw-rust-offline-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['Cargo.toml', 'src/lib.rs', 'tests/project_layout.rs']) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, template.files[name]);
  }
  const run = spawnSync('cargo', ['test', '--offline'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});
