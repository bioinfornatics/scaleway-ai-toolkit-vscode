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
    `\${workspaceFolder}/.venv`,
  );
  assert.equal(settings['python.testing.pytestEnabled'], true);
  assert.equal(settings['python.testing.unittestEnabled'], false);
  assert.deepEqual(settings['python.testing.pytestArgs'], ['tests']);
  assert.equal(settings['python.testing.cwd'], `\${workspaceFolder}`);
  const debug = JSON.parse(result.files['.vscode/launch.json'])
    .configurations[0];
  assert.equal(debug.type, 'debugpy');
  assert.equal(debug.module, 'agent_app.agent');
  assert.equal(debug.program, undefined);
  assert.equal(debug.python, `\${workspaceFolder}/.venv/bin/python`);
  assert.equal(
    debug.windows.python,
    `\${workspaceFolder}/.venv/Scripts/python.exe`,
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
    `\${workspaceFolder}/` +
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

test('Rust generated layout test runs with cached clap using cargo offline', (t) => {
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

// Inventory actual generated entrypoints, not only manifest payload filenames.
const { loadEmbeddedTemplates } = require('../dist/embeddedTemplates');
const {
  prepareEmbeddedProject,
  renderProjectTemplate,
} = require('../dist/projectGenerator');
const { composeAgentProject } = require('../dist/agentProject');
const { stackChoices } = require('../dist/stackScaffold');
const { transformSync } = require('esbuild');
const TOML = require('@iarna/toml');
const cliEntries = ['agents', 'tools'].flatMap((kind) =>
  ['stack', 'builtin'].flatMap((usage) => loadEmbeddedTemplates(kind, usage)),
);
function generated(entry) {
  const result = renderProjectTemplate(
    prepareEmbeddedProject(entry.template, entry.language),
    { name: 'cli-offline-proof' },
  );
  return entry.template.kind === 'agents'
    ? withEndpointLaunch(result, entry.language)
    : result;
}
function temporaryProject(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scw-cli-proof-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (name.endsWith('.ts')) {
      fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
      fs.writeFileSync(
        path.join(root, 'dist', path.basename(name).replace(/\.ts$/, '.js')),
        transformSync(content, {
          loader: 'ts',
          format: 'esm',
          tsconfigRaw: { compilerOptions: { experimentalDecorators: true } },
        }).code,
      );
    }
    fs.writeFileSync(file, content);
  }
  fs.writeFileSync(
    path.join(root, 'offline-guard.cjs'),
    'globalThis.fetch = () => { throw new Error("Network forbidden by offline test"); };\n' +
      'for (const name of ["node:http", "node:https", "node:net", "node:tls"]) { const m = require(name); for (const key of ["request", "get", "connect", "createConnection", "createServer"]) if (key in m) m[key] = () => { throw new Error("Network/server forbidden by offline test"); }; }\n',
  );
  return root;
}
const pythonGuard = [
  'import sys,runpy,socket,builtins',
  'def forbidden(*a,**k): raise AssertionError("Network/server forbidden by offline test")',
  'socket.create_connection=forbidden',
  'socket.socket.connect=forbidden',
  'socket.socket.bind=forbidden',
  '_import=builtins.__import__',
  'def guarded(name,*a,**k):',
  ' if name.split(".")[0] in {"strands","langchain","langchain_openai","fastapi","litestar","django","uvicorn","mcp","agno","openai","httpx"}: raise AssertionError("Expensive SDK import forbidden during help/check")',
  ' return _import(name,*a,**k)',
  'builtins.__import__=guarded',
  'sys.argv=sys.argv[1:]',
  'runpy.run_path(sys.argv[0],run_name="__main__")',
].join('\n');
function offlineEnvironment() {
  const clean = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };
  for (const name of Object.keys(clean))
    if (/^(SCW_|PYTHONPATH$|PYTHONHOME$|VIRTUAL_ENV$)/.test(name))
      delete clean[name];
  return clean;
}
function cliSources(files) {
  return Object.entries(files).filter(
    ([name, content]) =>
      (name.endsWith('.py') && content.includes('ArgumentParser(')) ||
      (/\.(ts|cjs)$/.test(name) && content.includes('parseArgs(')) ||
      (name === 'src/main.rs' && content.includes('Args::parse()')),
  );
}
test('ALL 28 built-in inventories have parser-backed real entrypoints; import-only sources remain libraries', () => {
  assert.equal(cliEntries.length, 28);
  for (const entry of cliEntries) {
    const result = generated(entry);
    const sources = cliSources(result.files);
    assert.ok(sources.length, entry.template.id);
    for (const [name, content] of sources) {
      if (entry.language === 'python') {
        assert.match(content, /import argparse/);
        assert.match(
          content,
          /def main\(argv: list\[str\] \| None = None\) -> int:/,
        );
        assert.match(content, /if __name__ == "__main__":/);
        assert.doesNotMatch(content, /sys\.argv\[1:/);
      } else if (entry.language === 'typescript') {
        assert.match(content, /node:util/);
        assert.match(content, /strict: true/);
        assert.match(content, /values\.help/);
        if (name.endsWith('.ts')) assert.match(content, /argv: string\[\]/);
      } else {
        assert.match(content, /use clap::\{CommandFactory, Parser\}/);
        assert.match(content, /derive\(Parser\)/);
        const cargo = TOML.parse(result.files['Cargo.toml']);
        assert.deepEqual(cargo.dependencies.clap, {
          version: '4.5',
          features: ['derive'],
        });
        const binding = content.indexOf('.bind(');
        if (binding >= 0) assert.ok(content.indexOf('Args::parse()') < binding);
      }
    }
    if (entry.language === 'python' && entry.template.kind === 'agents')
      assert.equal(
        TOML.parse(result.files['pyproject.toml']).project.scripts.agent,
        'agent_app.agent:main',
      );
    for (const [name, content] of Object.entries(result.files))
      if (/config\.(py|ts)$|api\.py$|src\/lib\.rs$/.test(name))
        assert.doesNotMatch(content, /ArgumentParser|parseArgs|clap::Parser/);
  }
});
for (const entry of cliEntries.filter((e) => e.language !== 'rust'))
  test(`${entry.template.id}: generated CLI help/unknown/check are offline before SDK/config; explicit shell imports are lazy`, (t) => {
    const result = generated(entry);
    const root = temporaryProject(t, result.files);
    const environment = offlineEnvironment();
    // A poison .env catches reading config before help/unknown validation.
    fs.writeFileSync(path.join(root, '.env'), 'INVALID LINE WITHOUT EQUALS');
    for (const [name, source] of cliSources(result.files)) {
      const python = name.endsWith('.py');
      const executable = python ? 'python3' : process.execPath;
      const relative = name.endsWith('.ts')
        ? `dist/${path.basename(name, '.ts')}.js`
        : name;
      const file = path.join(root, relative);
      const prefix = python
        ? ['-B']
        : ['--require', path.join(root, 'offline-guard.cjs')];
      const run = (args, harness) =>
        spawnSync(
          executable,
          harness
            ? [...prefix, '-c', harness, file, ...args]
            : python
              ? [...prefix, '-c', pythonGuard, file, ...args]
              : [...prefix, file, ...args],
          { cwd: root, env: environment, encoding: 'utf8', timeout: 10000 },
        );
      const help = run(['--help']);
      assert.equal(help.status, 0, `${name}: ${help.stderr}`);
      assert.match(help.stdout, /[Uu]sage:/);
      const unknown = run(['--unknown-cli-option']);
      assert.notEqual(unknown.status, 0, name);
      assert.doesNotMatch(
        unknown.stderr,
        /Invalid .env|invalid env|missing external configuration/,
      );
      for (const args of [
        ['--check', '--unknown-cli-option'],
        ['--help', '--unknown-cli-option'],
      ])
        assert.notEqual(run(args).status, 0, name);

      // All Python source syntax checked without pyc output or SDK imports.
      if (python) {
        const ast = spawnSync(
          'python3',
          ['-B', '-c', 'import ast,sys; ast.parse(sys.stdin.read())'],
          { input: source, encoding: 'utf8' },
        );
        assert.equal(ast.status, 0, ast.stderr);
      }
      fs.writeFileSync(path.join(root, '.env'), env);
      const check = run(['--check']);
      assert.equal(check.status, 0, `${name}: ${check.stderr}`);
      assert.match(check.stdout, /aucun appel|No network/);
      if (source.includes('--serve') || source.includes('serve:')) {
        const checkServe = run(['--check', '--serve']);
        assert.equal(checkServe.status, 0, checkServe.stderr);
        if (!source.includes('mcp.run')) {
          assert.notEqual(run(['--port', '0', '--check']).status, 0);
          assert.notEqual(run(['--port', '3.1', '--check']).status, 0);
        }
      }
      // For model checks require retained config failure, not unconditional success.
      if (
        source.includes('args.prompt') ||
        source.includes('positionals.join')
      ) {
        fs.writeFileSync(
          path.join(root, '.env'),
          env.replace('https:', 'http:'),
        );
        assert.notEqual(run(['--check']).status, 0);
      }
      fs.writeFileSync(path.join(root, '.env'), 'INVALID LINE WITHOUT EQUALS');
    }
  });

test('backend plus AI framework compositions preserve unique CLI helpers, parse actual launch entry and retain v2 console script', (t) => {
  for (const backend of stackChoices('agents').filter(
    (s) =>
      s.category !== 'agent' &&
      s.language !== 'rust' &&
      s.framework !== 'agentos',
  ))
    for (const ai of stackChoices('agents').filter(
      (s) => s.category === 'agent' && s.language === backend.language,
    )) {
      const composed = composeAgentProject(backend, ai, 'cli-composed');
      const result = withEndpointLaunch(
        renderProjectTemplate(
          prepareEmbeddedProject(composed, backend.language),
          { name: 'cli-composed' },
        ),
        backend.language,
      );
      const launch = JSON.parse(
        result.files['.vscode/scaleway-agent-run.json'],
      );
      const actual =
        backend.language === 'python'
          ? launch.entry
          : launch.entry.replace(/^dist\//, 'src/').replace(/\.js$/, '.ts');
      assert.match(result.files[actual], /ArgumentParser|parseArgs/);
      assert.ok(cliSources(result.files).length >= 2);
      const root = temporaryProject(t, result.files);
      fs.writeFileSync(path.join(root, '.env'), 'poison');
      const file = actual.endsWith('.py') ? actual : launch.entry;
      const run = spawnSync(
        actual.endsWith('.py') ? 'python3' : process.execPath,
        [
          ...(actual.endsWith('.py') ? ['-B'] : []),
          path.join(root, file),
          '--help',
        ],
        {
          cwd: root,
          env: offlineEnvironment(),
          encoding: 'utf8',
          timeout: 10000,
        },
      );
      assert.equal(run.status, 0, run.stderr);
      if (actual.endsWith('.py')) {
        assert.equal(launch.version, 2);
        assert.equal(launch.consoleScript, 'agent');
      }
    }
});

test('personal template byte payload stays unchanged including user CLI and collision guard', () => {
  const personal = {
    ...base(),
    files: {
      'README.md': 'user instructions\n',
      'agent.py': 'import sys\nprint(sys.argv)\n',
      'custom.bin': '\u0001user bytes',
      'tool_cli.py': 'personal CLI\n',
    },
  };
  const result = composeAgentProject(
    undefined,
    undefined,
    'personal-proof',
    undefined,
    personal,
  );
  for (const [name, content] of Object.entries(personal.files))
    assert.equal(result.files[name], content);
  const legacy = renderProjectTemplate(personal, { name: 'personal-proof' });
  assert.deepEqual({ ...legacy.files }, personal.files);
  assert.throws(
    () =>
      composeAgentProject(undefined, undefined, 'personal-proof', undefined, {
        ...personal,
        files: { ...personal.files, 'agent.creation.json': '{}' },
      }),
    /authoring_conflict/,
  );
});

let rustTarget;
require('node:test').after(() => {
  if (rustTarget) fs.rmSync(rustTarget, { recursive: true, force: true });
});
for (const entry of cliEntries.filter((e) => e.language === 'rust'))
  test(`${entry.template.id}: exact generated clap binary compiles/tests and runs help/check/unknown strictly offline when cache available`, (t) => {
    const result = generated(entry);
    const root = temporaryProject(t, result.files);
    rustTarget ??= fs.mkdtempSync(
      path.join(os.tmpdir(), 'scw-cli-cargo-target-'),
    );
    const run = (args) =>
      spawnSync('cargo', args, {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...offlineEnvironment(),
          CARGO_NET_OFFLINE: 'true',
          CARGO_TARGET_DIR: rustTarget,
        },
        timeout: 120000,
      });
    const compile = run(['test', '--offline', '--all-targets']);
    if (
      compile.status !== 0 &&
      (compile.error?.code === 'ENOENT' ||
        /no matching package|failed to download|attempting to make an HTTP request|no cached|not found in offline/.test(
          compile.stderr,
        ))
    ) {
      t.skip(
        `UNVERIFIED: local Cargo cache incomplete, no download allowed: ${compile.stderr.slice(0, 600)}`,
      );
      return;
    }
    assert.equal(compile.status, 0, compile.stdout + compile.stderr);
    for (const args of [
      ['--help'],
      ['--check'],
      ['--unknown-cli-option'],
      ['--help', '--unknown-cli-option'],
      ['--check', '--unknown-cli-option'],
      ...(entry.framework === 'none'
        ? []
        : [
            ['--check', '--serve'],
            ['--check', '--port', '0'],
          ]),
    ]) {
      const invocation = run(['run', '--offline', '--', ...args]);
      const expectedFailure =
        args.includes('--unknown-cli-option') || args.includes('0');
      assert.equal(
        invocation.status === 0,
        !expectedFailure,
        invocation.stderr,
      );
      if (args.includes('--help') && !expectedFailure)
        assert.match(invocation.stdout, /Usage:/);
      if (args.includes('--check') && !expectedFailure)
        assert.match(invocation.stdout, /No network or server/);
    }
  });

test('standalone legacy endpoint help and unknown flags precede even unreadable .env and retain literal prompts', async () => {
  const result = withEndpointLaunch(base(), 'typescript');
  for (const args of [
    ['--help'],
    ['--unknown-cli-option'],
    ['--help', '--unknown-cli-option'],
  ]) {
    let reads = 0;
    let requests = 0;
    const proc = { argv: ['node', 'entry', ...args], env: {} };
    vm.runInNewContext(result.files['scaleway_agent.cjs'], {
      process: proc,
      __dirname: '/offline',
      require: (name) =>
        name === 'node:fs'
          ? {
              readFileSync() {
                reads++;
                throw new Error('Forbidden env read');
              },
            }
          : require(name),
      console: { log() {}, error() {} },
      fetch() {
        requests++;
        throw new Error('Forbidden network');
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(reads, 0);
    assert.equal(requests, 0);
    assert.equal(
      proc.exitCode ?? 0,
      args.includes('--unknown-cli-option') ? 1 : 0,
    );
  }
  const state = [];
  vm.runInNewContext(result.files['scaleway_agent.cjs'], {
    process: { argv: ['node', 'entry', '--', '--literal-prompt'], env: {} },
    __dirname: '/offline',
    URL,
    AbortSignal,
    require: (name) =>
      name === 'node:fs' ? { readFileSync: () => env } : require(name),
    console: { log() {}, error() {} },
    fetch: async (_url, options) => {
      state.push(JSON.parse(options.body).messages[0].content);
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'mock' } }] }),
      };
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(state, ['--literal-prompt']);
});
