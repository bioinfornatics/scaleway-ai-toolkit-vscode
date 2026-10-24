const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const TOML = require('@iarna/toml');
const { stackChoices } = require('../dist/stackScaffold');
const { composeServiceProject } = require('../dist/serviceProject');
const { composeAgentProject } = require('../dist/agentProject');
const { withEndpointLaunch } = require('../dist/endpointAgent');
const { buildCreationView } = require('../dist/buildCreationView');
const { compatibleServiceSdk } = require('../dist/serviceCompatibility');
const choices = stackChoices('agents');
const runtime = choices.find((c) => c.framework === 'agentos');
const options = {
  projectType: 'agent',
  exposure: 'api',
  frontend: 'nextjs',
  architecture: 'separate',
};
const generate = (overrides) =>
  composeServiceProject(
    runtime,
    undefined,
    'agentos-service',
    undefined,
    undefined,
    undefined,
    { ...options, ...overrides },
  );

test('AgentOS dedicated generation has pinned Agno and real orchestration, not endpoint fallback or executable-ready server', () => {
  const files = generate().files;
  assert.equal(runtime.language, 'python');
  assert.equal(runtime.category, 'backend');
  assert.equal(JSON.parse(files['agent.authoring.json']).ai_framework, 'agno');
  assert.equal(
    JSON.parse(
      composeAgentProject(runtime, undefined, 'agentos-agent').files[
        'agent.authoring.json'
      ],
    ).ai_framework,
    'agno',
  );
  const ordinary = choices.find((c) => c.framework === 'fastapi');
  assert.equal(
    JSON.parse(
      composeAgentProject(ordinary, undefined, 'ordinary').files[
        'agent.authoring.json'
      ],
    ).ai_framework,
    'none',
  );
  assert.match(files['requirements.txt'], /agno.*==3.1.10/);
  assert.ok(
    TOML.parse(files['pyproject.toml']).project.dependencies.includes(
      'agno[os]==3.1.10',
    ),
  );
  assert.equal(
    TOML.parse(files['pyproject.toml']).project.scripts.service,
    'agent_app.service_cli:main',
  );
  assert.equal(files['src/agent_app/service_transport.py'], undefined);
  assert.match(files['src/agent_app/service_api.py'], /arun[(]message/);
  assert.match(files['src/agent_app/service_api.py'], /AgentOS[(]agents=/);
  assert.match(
    files['src/agent_app/service_api.py'],
    /LocalSurface[(]agent_os.get_app[(][)][)]/,
  );
  assert.equal(
    JSON.parse(files['service.authoring.json']).transport,
    'agno-agentos',
  );
  assert.equal(
    JSON.parse(files['.vscode/scaleway-agent-run.json']).ready,
    false,
  );
  assert.equal(
    withEndpointLaunch(runtime.template, 'python').files['scaleway_agent.py'],
    undefined,
  );
  assert.equal(
    JSON.parse(
      withEndpointLaunch(runtime.template, 'python').files[
        '.vscode/scaleway-agent-run.json'
      ],
    ).ready,
    false,
  );
  assert.match(files['README.md'], /Agent.arun/);
  assert.doesNotMatch(
    files['README.md'],
    /this route uses an independent endpoint transport/,
  );
});
for (const frontend of ['nextjs', 'vite'])
  test(
    'AgentOS separate ' +
      frontend +
      ' uses only local adapter proxy and has no public secrets',
    () => {
      const files = generate({ projectType: 'webapp', frontend }).files;
      const frontendFiles = Object.entries(files).filter(([name]) =>
        name.startsWith('frontend/'),
      );
      assert.ok(frontendFiles.length > 3);
      assert.doesNotMatch(
        frontendFiles.map(([, content]) => content).join(' '),
        /SCW_API_KEY|SCW_INFERENCE|NEXT_PUBLIC_|VITE_/,
      );
      assert.match(
        files[
          frontend === 'nextjs'
            ? 'frontend/next.config.mjs'
            : 'frontend/vite.config.ts'
        ],
        /127.0.0.1:3001/,
      );
      assert.equal(files['app/api/chat/route.ts'], undefined);
    },
  );
test('AgentOS rejects Strands/LangChain/basic SDK selections explicitly and rejects integrated Next/CLI misuse', () => {
  for (const sdk of choices.filter(
    (c) => c.language === 'python' && c.category === 'agent',
  )) {
    assert.equal(compatibleServiceSdk('agentos', sdk.framework), false);
    assert.throws(
      () =>
        composeServiceProject(
          runtime,
          sdk,
          'bad',
          undefined,
          undefined,
          undefined,
          options,
        ),
      /incompatible_agentos_sdk/,
    );
    assert.throws(
      () => composeAgentProject(runtime, sdk, 'bad'),
      /incompatible_agentos_sdk/,
    );
  }
  assert.equal(compatibleServiceSdk('agentos', undefined), true);
  assert.throws(
    () => generate({ projectType: 'webapp', architecture: 'integrated' }),
    /unsupported_integrated_service/,
  );
  assert.throws(() => generate({ exposure: 'cli' }), /agentos_requires_api/);
});
test('AgentOS renderer locks Agno while retaining modes and common fields; CLI remains normal SDK selection', () => {
  const rows = choices.map((stack, i) => ({
    index: i.toString(16).padStart(32, '0'),
    stack,
    template: stack.template,
  }));
  const selected = rows.find((r) => r.stack.framework === 'agentos').index;
  const state = {
    ...options,
    backend: selected,
    selected,
    rows,
    language: 'python',
    languages: new Map([['1', 'python']]),
    agentForm: true,
    agentName: 'service',
    kind: 'agents',
    templateMode: false,
    title: 'Create',
    trusted: true,
    status: '',
    draft: false,
    token: 'a'.repeat(48),
    css: '',
    js: '',
    csp: '',
    creationTab: 'stack',
    models: [],
    keys: [],
  };
  const html = buildCreationView(state);
  assert.match(html, /data-runtime-lock=agno/);
  assert.doesNotMatch(html, /select data-action="ai"/);
  for (const action of [
    'backend',
    'model',
    'key',
    'name',
    'projectPath',
    'webapp',
    'agentService',
  ])
    assert.match(html, new RegExp('data-action="' + action + '"'));
  assert.match(
    buildCreationView({ ...state, exposure: 'cli' }),
    /select data-action="ai"/,
  );
});
test('Generated CLI import/help/check/unknown are offline; --serve binds loopback only and errors never reveal values', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scw-agentos-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = generate().files;
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  const env = {
    ...process.env,
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONPATH: path.join(root, 'src'),
  };
  for (const name of Object.keys(env))
    if (/^(SCW_|AGNO_|OS_|JWT_)/.test(name)) delete env[name];
  const guard = [
    'import builtins,runpy,sys,socket',
    'def forbidden(*a,**k): raise AssertionError("network forbidden")',
    'socket.socket.connect=forbidden; socket.socket.bind=forbidden',
    'original=builtins.__import__',
    'def guarded(name,*a,**k):',
    ' if name.split(".")[0] in {"agno","httpx","openai","fastapi","uvicorn"}: raise AssertionError("SDK import forbidden")',
    ' return original(name,*a,**k)',
    'builtins.__import__=guarded',
    'sys.argv=["service"]+sys.argv[1:]',
    'runpy.run_module("agent_app.service_cli",run_name="__main__")',
  ].join('\n');
  const run = (args) =>
    spawnSync('python3', ['-B', '-c', guard, ...args], {
      cwd: root,
      env,
      encoding: 'utf8',
      timeout: 10000,
    });
  fs.writeFileSync(path.join(root, '.env'), 'POISON');
  for (const args of [[], ['--help'], ['-h']]) {
    const r = run(args);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /usage:/);
  }
  for (const args of [
    ['--unknown'],
    ['--help', '--unknown'],
    ['--port', '0', '--check'],
    ['--port', '65536', '--check'],
    ['--host', '0.0.0.0', '--serve'],
  ])
    assert.notEqual(run(args).status, 0);
  fs.writeFileSync(
    path.join(root, '.env'),
    'SCW_INFERENCE_BASE_URL=https://example.invalid/v1\nSCW_INFERENCE_MODEL_ID=offline-model\nSCW_API_KEY=synthetic-private-key\n',
  );
  for (const args of [['--check'], ['--check', '--serve']]) {
    const r = run(args);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout + r.stderr, /synthetic-private-key/);
  }
  fs.writeFileSync(
    path.join(root, '.env'),
    'SCW_INFERENCE_BASE_URL=http://example.invalid/v1\nSCW_INFERENCE_MODEL_ID=offline-model\nSCW_API_KEY=synthetic-private-key\n',
  );
  assert.notEqual(run(['--check']).status, 0);
  const serve = spawnSync(
    'python3',
    [
      '-B',
      '-c',
      [
        'import sys,types,runpy',
        'api=types.ModuleType("agent_app.service_api");api.create_app=lambda: "closed-surface"',
        'server=types.ModuleType("uvicorn")',
        'def run(app,**kwargs):',
        ' assert app=="closed-surface" and kwargs==dict(host="127.0.0.1",port=3001,proxy_headers=False,access_log=False)',
        'server.run=run;sys.modules.update({"agent_app.service_api":api,"uvicorn":server})',
        'sys.argv=["service","--serve"];runpy.run_module("agent_app.service_cli",run_name="__main__")',
      ].join('\n'),
    ],
    {
      cwd: root,
      env: {
        ...env,
        SCW_INFERENCE_BASE_URL: 'https://example.invalid/v1',
        SCW_INFERENCE_MODEL_ID: 'model',
        SCW_API_KEY: 'synthetic',
      },
      encoding: 'utf8',
    },
  );
  assert.equal(serve.status, 0, serve.stderr);
});
test('Exact generated runtime executes Agno/AgentOS mocks through restricted ASGI and bounded upstream client', () => {
  const result = spawnSync(
    'python3',
    ['-B', path.join(__dirname, 'agentos-runtime-fixture.py')],
    {
      input: JSON.stringify(generate().files),
      encoding: 'utf8',
      timeout: 15000,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS mocked Agno.arun/);
});
