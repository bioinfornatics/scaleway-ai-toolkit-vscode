const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const { spawnSync } = require('node:child_process');
const { transformSync } = require('esbuild');
const TOML = require('@iarna/toml');
function load(name) {
  const filename = path.join(__dirname, '../src', `${name}.ts`);
  const mod = new Module(filename);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod.require = (r) =>
    r.startsWith('./')
      ? load(r.slice(2))
      : Module.prototype.require.call(mod, r);
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
const { composeServiceProject: compose } = load('serviceProject');
const { stackChoices } = load('stackScaffold');
const { prepareEmbeddedProject, renderProjectTemplate, installCommand } =
  load('projectGenerator');
const { withEndpointLaunch } = load('endpointAgent');
const choices = stackChoices('agents');
const pick = (language, framework) =>
  choices.find((c) => c.language === language && c.framework === framework);
const opts = (
  frontend = 'nextjs',
  architecture = 'separate',
  projectType = 'webapp',
) => ({ projectType, exposure: 'api', frontend, architecture });
const generate = (
  language,
  frontend = 'nextjs',
  architecture = 'separate',
  ai,
) =>
  compose(
    pick(language, language === 'python' ? 'fastapi' : 'elysia'),
    ai,
    'my-service',
    undefined,
    undefined,
    undefined,
    opts(frontend, architecture),
  );

for (const language of ['python', 'typescript']) {
  for (const frontend of ['nextjs', 'vite']) {
    test(`${language} ${frontend} separate service has actual UI, endpoint and coherent manifests`, () => {
      const template = generate(language, frontend),
        files = template.files;
      const api =
        files[
          language === 'python'
            ? 'src/agent_app/service_api.py'
            : 'src/service-api.ts'
        ];
      assert.ok(api.includes('/api/chat'));
      assert.ok(api.includes('chat('));
      assert.match(api, /chat_unavailable/);
      const ui =
        files[
          frontend === 'nextjs'
            ? 'frontend/app/page.tsx'
            : 'frontend/src/Chat.tsx'
        ];
      assert.ok(ui.includes('fetch("/api/chat"'));
      assert.match(ui, /textarea/);
      assert.match(ui, /setReply/);
      assert.doesNotMatch(
        ui,
        /SCW_API_KEY|INFERENCE_BASE_URL|NEXT_PUBLIC_|VITE_/,
      );
      assert.match(
        files[
          frontend === 'nextjs'
            ? 'frontend/next.config.mjs'
            : 'frontend/vite.config.ts'
        ],
        /127.0.0.1:3001/,
      );
      assert.ok(installCommand(template));
      assert.ok(JSON.parse(files['frontend/package.json']).scripts.build);
      if (language === 'python') {
        const p = TOML.parse(files['pyproject.toml']);
        assert.equal(p.project.scripts.service, 'agent_app.service_cli:main');
        assert.ok(p.project.dependencies.some((d) => d.startsWith('fastapi')));
      } else
        assert.match(
          JSON.parse(files['package.json']).scripts.start,
          /bun .*--serve/,
        );
      const note = JSON.parse(files['service.authoring.json']);
      assert.ok(files[note.main_source]);
      assert.equal(note.install_verified, false);
      const launch = JSON.parse(files['.vscode/scaleway-agent-run.json']);
      assert.equal(launch.ready, false);
      assert.deepEqual(launch.args, ['--help']);
      assert.ok(files['.env.example']);
      assert.equal(files['.env'], undefined);
    });
  }
}

test('Next integrated has server-only route and honest frontend/build metadata', () => {
  const files = generate('typescript', 'nextjs', 'integrated').files;
  assert.ok(files['app/page.tsx']);
  assert.ok(files['app/layout.tsx']);
  assert.match(files['app/api/chat/route.ts'], /export async function POST/);
  assert.match(files['app/api/chat/route.ts'], /runtime = "nodejs"/);
  assert.equal(files['frontend/package.json'], undefined);
  const p = JSON.parse(files['package.json']);
  assert.equal(p.scripts.build, 'next build');
  assert.ok(p.dependencies.next);
  assert.ok(installCommand(generate('typescript', 'nextjs', 'integrated')));
});

test('unsupported API and integrated choices fail explicitly, no fake health integration', () => {
  for (const backend of choices.filter(
    (c) =>
      c.category === 'backend' &&
      !load('serviceCompatibility').apiCapability(c.language, c.framework),
  )) {
    assert.throws(
      () =>
        compose(
          backend,
          undefined,
          'service',
          undefined,
          undefined,
          undefined,
          opts(),
        ),
      /unsupported_api_backend/,
    );
  }
  assert.throws(
    () => generate('python', 'nextjs', 'integrated'),
    /unsupported_integrated_service/,
  );
  assert.throws(
    () => generate('typescript', 'vite', 'integrated'),
    /unsupported_integrated_service/,
  );
  assert.throws(
    () =>
      compose(
        undefined,
        undefined,
        'service',
        undefined,
        undefined,
        undefined,
        opts(),
      ),
    /unsupported_api_backend/,
  );
  assert.throws(
    () =>
      generate('python', 'vite', 'separate', pick('typescript', 'langchain')),
    /incompatible_language/,
  );
});

test('agent CLI ignores backend; basic/AI source survives and personal payload stays intact', () => {
  const ai = pick('typescript', 'langchain');
  const cli = { ...opts(), projectType: 'agent', exposure: 'cli' };
  const t = compose(
    pick('python', 'fastapi'),
    ai,
    'agent',
    undefined,
    undefined,
    undefined,
    cli,
  );
  assert.equal(t.files['src/agent_app/api.py'], undefined);
  assert.equal(t.files['src/agent.ts'], ai.template.files['src/agent.ts']);
  const basic = pick('python', 'none');
  assert.deepEqual(
    Object.keys(compose(basic, undefined, 'agent').files).filter(
      (p) => !p.startsWith('.vscode/'),
    ),
    Object.keys(basic.template.files).sort(),
  );
  const personal = {
    version: 1,
    id: 'personal',
    label: 'Personal',
    kind: 'agents',
    description: '',
    files: { 'main.py': 'print(1)' },
  };
  assert.equal(
    compose(undefined, undefined, 'agent', undefined, personal).files[
      'main.py'
    ],
    'print(1)',
  );
  assert.throws(
    () =>
      compose(
        pick('python', 'fastapi'),
        undefined,
        'web',
        undefined,
        personal,
        undefined,
        opts(),
      ),
    /personal_service/,
  );
});

test('endpoint-adapted bases keep framework sources; service overrides only launch contract', () => {
  const backend = pick('typescript', 'elysia');
  const adapted = withEndpointLaunch(
    renderProjectTemplate(
      prepareEmbeddedProject(backend.template, 'typescript'),
      { name: 'service' },
    ),
    'typescript',
  );
  const t = compose(
    { ...backend, template: adapted },
    undefined,
    'service',
    undefined,
    undefined,
    undefined,
    opts('vite'),
  );
  assert.equal(t.files['src/agent.ts'], backend.template.files['src/agent.ts']);
  assert.ok(t.files['scaleway_agent.cjs']);
  assert.equal(
    JSON.parse(t.files['.vscode/scaleway-agent-run.json']).ready,
    false,
  );
});

function evaluate(source, dependencies = {}, extra = {}) {
  const exports = {};
  const code = transformSync(
    source.replaceAll(
      'import.meta.url',
      JSON.stringify('file:///mock/src/service-transport.ts'),
    ),
    { loader: 'ts', format: 'cjs', target: 'node22' },
  ).code;
  const context = {
    module: { exports },
    exports,
    require: (r) =>
      Object.hasOwn(dependencies, r) ? dependencies[r] : require(r),
    Buffer,
    Response,
    Request,
    AbortSignal,
    URL,
    console,
    ...extra,
  };
  vm.runInNewContext(code, context);
  return context.module.exports;
}
function mockTransport(fetch) {
  return evaluate(
    generate('typescript', 'nextjs', 'integrated').files[
      'src/service-transport.ts'
    ],
    { 'node:fs': { existsSync: () => false } },
    {
      process: {
        cwd: () => '/mock',
        env: {
          SCW_INFERENCE_BASE_URL: 'https://example.invalid/v1',
          SCW_INFERENCE_MODEL_ID: 'model',
          SCW_API_KEY: 'mock-value',
        },
      },
      fetch,
    },
  );
}

test('actual generated TS endpoint client uses mocked fetch, bounded output and no invocation on import', async () => {
  let calls = 0;
  const transport = mockTransport(async (url, init) => {
    calls++;
    assert.equal(url, 'https://example.invalid/v1/chat/completions');
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal);
    assert.equal(init.headers.Authorization, 'Bearer mock-value');
    assert.equal(JSON.parse(init.body).messages[0].content, 'Hello');
    return Response.json({ choices: [{ message: { content: 'Mock reply' } }] });
  });
  assert.equal(calls, 0);
  assert.equal(await transport.chat('Hello'), 'Mock reply');
  assert.equal(calls, 1);
  await assert.rejects(transport.chat('x'.repeat(8001)), /invalid_request/);
  assert.equal(calls, 1);
  await assert.rejects(
    mockTransport(async () => new Response('x'.repeat(65537))).chat('hi'),
    /endpoint_failure/,
  );
  await assert.rejects(
    mockTransport(
      async () => new Response('secret remote body', { status: 403 }),
    ).chat('hi'),
    /endpoint_failure/,
  );
});

test('actual Next POST route validation/success/safe errors with mocked endpoint transport', async () => {
  let calls = 0;
  const transport = mockTransport(async () => {
    calls++;
    return Response.json({ choices: [{ message: { content: 'reply' } }] });
  });
  const source = generate('typescript', 'nextjs', 'integrated').files[
    'app/api/chat/route.ts'
  ];
  const route = evaluate(source, {
    '../../../src/service-transport': transport,
  });
  const request = (value) =>
    new Request('http://local/api/chat', {
      method: 'POST',
      body: JSON.stringify(value),
    });
  let response = await route.POST(request({ message: 'hello' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { reply: 'reply' });
  response = await route.POST(request({ message: '' }));
  assert.equal(response.status, 400);
  assert.equal(calls, 1);
  response = await route.POST(request({ message: 'x'.repeat(33000) }));
  assert.equal(response.status, 413);
  assert.equal(calls, 1);
  const broken = evaluate(source, {
    '../../../src/service-transport': {
      ...transport,
      chat: async () => {
        throw new Error('sensitive upstream error');
      },
    },
  });
  response = await broken.POST(request({ message: 'hello' }));
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'chat_unavailable' });
});

test('generated CLIs: real help/default/check/unknown flags do not import frameworks or serve', async () => {
  const source = generate('typescript').files['src/service-cli.ts'];
  let imports = 0;
  const cli = evaluate(
    source,
    {
      './service-api.js': new Proxy(
        {},
        {
          get() {
            imports++;
            throw new Error('server import');
          },
        },
      ),
      './service-transport.js': { loadServiceConfig() {} },
    },
    { process: { argv: ['node'], env: {} }, console: { log() {}, error() {} } },
  );
  await cli.main(['--help']);
  await cli.main([]);
  await assert.rejects(
    cli.main(['--host', '0.0.0.0', '--serve']),
    /invalid_bind/,
  );
  await assert.rejects(cli.main(['--unknown']));
  assert.equal(imports, 0);
  const py = generate('python').files['src/agent_app/service_cli.py'];
  for (const flags of [[], ['--help']]) {
    const result = spawnSync('python3', ['-c', py, ...flags], {
      encoding: 'utf8',
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /usage:/);
  }
  const unknown = spawnSync('python3', ['-c', py, '--unknown'], {
    encoding: 'utf8',
  });
  assert.notEqual(unknown.status, 0);
  for (const flags of [[], ['--help'], ['--check']]) {
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        `process.argv.splice(1, 0, "service-cli.cjs");\n${generate('typescript', 'nextjs', 'integrated').files['service-cli.cjs']}`,
        '--',
        ...flags,
      ],
      { encoding: 'utf8' },
    );
    // Restore file-style argv while executing the real generated CLI in-memory.
    assert.equal(result.status, 0, result.stderr);
  }
});

test('Python generated transport/API are syntax-valid and mock HTTP client returns a real reply', () => {
  const files = generate('python').files;
  const script =
    'import json, os, sys\nfrom unittest.mock import patch\n' +
    'sources=json.load(sys.stdin)\nfor name, source in sources.items(): compile(source, name, "exec")\n' +
    'scope={"__file__":"/mock/src/agent_app/service_transport.py"}\nexec(sources["transport"],scope)\n' +
    'os.environ.update(SCW_INFERENCE_BASE_URL="https://example.invalid/v1",SCW_INFERENCE_MODEL_ID="model",SCW_API_KEY="mock-value")\n' +
    'class Reply:\n def __enter__(self): return self\n def __exit__(self,*args): pass\n def read(self,n): assert n==65537; return json.dumps(dict(choices=[dict(message=dict(content="reply"))])).encode()\n' +
    'class Client:\n def open(self,request,timeout):\n  assert timeout==30 and request.full_url=="https://example.invalid/v1/chat/completions"\n  assert json.loads(request.data)["messages"][0]["content"]=="hi"\n  return Reply()\n' +
    'with patch("urllib.request.build_opener",return_value=Client()): assert scope["chat"]("hi")=="reply"\n';
  const result = spawnSync('python3', ['-c', script], {
    input: JSON.stringify({
      transport: files['src/agent_app/service_transport.py'],
      api: files['src/agent_app/service_api.py'],
      cli: files['src/agent_app/service_cli.py'],
    }),
    encoding: 'utf8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.equal(result.status, 0, result.stderr);
});

test('supported backend + every same-language SDK preserves SDK sources and real transport', () => {
  for (const backend of choices.filter(
    (c) =>
      c.category === 'backend' &&
      !!load('serviceCompatibility').apiCapability(c.language, c.framework),
  )) {
    for (const ai of choices.filter(
      (c) => c.category === 'agent' && c.language === backend.language,
    )) {
      const template = compose(
        backend,
        ai,
        'service',
        undefined,
        undefined,
        undefined,
        opts('vite'),
      );
      const source =
        backend.language === 'python'
          ? 'src/agent_app/agent.py'
          : 'src/agent-sdk.ts';
      assert.equal(
        template.files[source],
        ai.template.files[
          backend.language === 'python' ? source : 'src/agent.ts'
        ],
      );
      assert.equal(
        JSON.parse(template.files['service.authoring.json']).transport,
        'server-side-endpoint-client',
      );
    }
  }
});

test('actual Elysia handler with mocked framework returns chat and safe errors without listening', async () => {
  let handler,
    listened = false,
    calls = 0;
  class MockElysia {
    constructor(options) {
      assert.equal(options.serve.maxRequestBodySize, 32768);
    }
    onError() {
      return this;
    }
    post(path, fn) {
      assert.equal(path, '/api/chat');
      handler = fn;
      return this;
    }
    listen() {
      listened = true;
    }
  }
  const transport = mockTransport(async () => {
    calls++;
    return Response.json({ choices: [{ message: { content: 'reply' } }] });
  });
  const source = generate('typescript').files['src/service-api.ts'];
  evaluate(source, {
    elysia: { Elysia: MockElysia },
    './service-transport.js': transport,
  });
  assert.equal(listened, false);
  assert.equal(calls, 0);
  let set = {};
  let result = await handler({ body: { message: 'hello' }, set });
  assert.equal(result.reply, 'reply');
  assert.equal(calls, 1);
  set = {};
  result = await handler({ body: { message: '' }, set });
  assert.equal(set.status, 400);
  assert.equal(result.error, 'invalid_request');
  assert.equal(calls, 1);
  evaluate(source, {
    elysia: { Elysia: MockElysia },
    './service-transport.js': {
      ...transport,
      chat: async () => {
        throw new Error('private upstream body');
      },
    },
  });
  set = {};
  result = await handler({ body: { message: 'hello' }, set });
  assert.equal(set.status, 502);
  assert.equal(result.error, 'chat_unavailable');
});

test('FastAPI generated handler executes against local module mocks, never starts a server', () => {
  const files = generate('python').files;
  const script = [
    'import asyncio, json, sys, types',
    'from unittest.mock import patch',
    'source=json.load(sys.stdin)',
    'class App:',
    ' def post(self, path):',
    '  assert path=="/api/chat"',
    '  return lambda fn: fn',
    'class Reply:',
    ' def __init__(self, body, status_code=200): self.body=body; self.status_code=status_code',
    'async def run(fn, arg): return fn(arg)',
    'def chat(message): assert message=="hi"; return "reply"',
    'deps={}',
    'for name in ["fastapi","fastapi.responses","starlette.concurrency","agent_app","agent_app.service_transport"]: deps[name]=types.ModuleType(name)',
    'deps["fastapi"].FastAPI=App; deps["fastapi"].Request=object',
    'deps["fastapi.responses"].JSONResponse=Reply',
    'deps["starlette.concurrency"].run_in_threadpool=run',
    'deps["agent_app.service_transport"].chat=chat',
    'scope={"__name__":"agent_app.service_api","__package__":"agent_app"}',
    'with patch.dict(sys.modules,deps): exec(source,scope)',
    'class Request:',
    ' def __init__(self,value): self.value=value',
    ' async def stream(self): yield json.dumps(self.value).encode()',
    'async def check():',
    ' handler=scope["api_chat"]',
    ' assert await handler(Request(dict(message="hi")))==dict(reply="reply")',
    ' assert (await handler(Request(dict(message="")))).status_code==400',
    ' assert (await handler(Request(dict(message="x"*33000)))).status_code==413',
    ' def fail(message): raise ValueError("private upstream body")',
    ' scope["chat"]=fail',
    ' response=await handler(Request(dict(message="hi")))',
    ' assert response.status_code==502 and response.body==dict(error="chat_unavailable")',
    'asyncio.run(check())',
  ].join(String.fromCharCode(10));
  const result = spawnSync('python3', ['-c', script], {
    input: JSON.stringify(files['src/agent_app/service_api.py']),
    encoding: 'utf8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.equal(result.status, 0, result.stderr);
});

test('integrated Next route resolves its transport inside the generated project', () => {
  const files = generate('typescript', 'nextjs', 'integrated').files;
  const source = files['app/api/chat/route.ts'];
  const specifier = source.match(/from "([^"]*service-transport)"/)[1];
  const resolved =
    path.posix.normalize(path.posix.join('app/api/chat', specifier)) + '.ts';
  assert.equal(resolved, 'src/service-transport.ts');
  assert.ok(files[resolved]);
});
