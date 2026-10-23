const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
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

const { SERVICE_CAPABILITIES, apiCapability, supportsIntegrated, supportsCli } =
  load('serviceCompatibility');
const { composeServiceProject } = load('serviceProject');
const { stackChoices } = load('stackScaffold');
const { buildCreationView } = load('buildCreationView');
const choices = stackChoices('agents');
const options = {
  projectType: 'agent',
  exposure: 'api',
  frontend: 'nextjs',
  architecture: 'separate',
};
const pick = (language, framework) =>
  choices.find((c) => c.language === language && c.framework === framework);
test('single matrix matches renderer advertised frameworks and generator support', () => {
  for (const language of ['python', 'typescript', 'rust']) {
    const rows = choices.map((stack, i) => ({
      index: i.toString(16).padStart(32, '0'),
      stack,
      template: stack.template,
    }));
    const html = buildCreationView({
      title: 'Test',
      kind: 'agents',
      agentForm: true,
      templateMode: false,
      projectType: 'agent',
      exposure: 'api',
      language,
      languages: new Map(),
      rows,
      trusted: true,
      status: '',
      draft: false,
      token: 'a'.repeat(48),
      css: '',
      js: '',
      csp: '',
    });
    const api = html.match(
      /<select data-action="backend"[^>]*>(.*?)<\/select>/s,
    )[1];
    for (const row of rows.filter(
      (r) => r.stack.category === 'backend' && r.stack.language === language,
    )) {
      const supported = !!apiCapability(language, row.stack.framework);
      assert.equal(api.includes('value="' + row.index + '"'), supported);
      if (supported)
        assert.ok(
          composeServiceProject(
            row.stack,
            undefined,
            'matrix-service',
            undefined,
            undefined,
            undefined,
            options,
          ).files['service.authoring.json'],
        );
      else
        assert.throws(
          () =>
            composeServiceProject(
              row.stack,
              undefined,
              'matrix-service',
              undefined,
              undefined,
              undefined,
              options,
            ),
          /unsupported_api_backend/,
        );
    }
  }
  assert.equal(SERVICE_CAPABILITIES.length, 3);
  assert.equal(Object.isFrozen(SERVICE_CAPABILITIES), true);
  assert.equal(apiCapability('typescript', 'litestar'), undefined);
  assert.equal(apiCapability('python', 'elysia'), undefined);
  assert.equal(supportsIntegrated('nextjs', 'typescript'), true);
  assert.equal(supportsIntegrated('vite', 'typescript'), false);
  assert.equal(supportsIntegrated('nextjs', 'python'), false);
  for (const language of ['python', 'typescript', 'rust'])
    assert.equal(supportsCli(language), true);
  assert.equal(supportsCli('shell'), false);
});
for (const frontend of ['nextjs', 'vite'])
  test(
    'Litestar separate ' +
      frontend +
      ' has real route, isolated frontend and canonical Python CLI',
    () => {
      const result = composeServiceProject(
        pick('python', 'litestar'),
        undefined,
        'litestar-service',
        undefined,
        undefined,
        undefined,
        { ...options, projectType: 'webapp', frontend },
      );
      const files = result.files;
      assert.match(
        files['src/agent_app/service_api.py'],
        /from litestar import/,
      );
      assert.match(
        files['src/agent_app/service_api.py'],
        /asyncio.to_thread\(chat, message\)/,
      );
      assert.match(
        files['src/agent_app/service_api.py'],
        /request_max_body_size=32768/,
      );
      assert.match(files['src/agent_app/service_cli.py'], /argparse/);
      assert.equal(
        TOML.parse(files['pyproject.toml']).project.scripts.service,
        'agent_app.service_cli:main',
      );
      assert.doesNotMatch(
        files[
          frontend === 'nextjs'
            ? 'frontend/app/page.tsx'
            : 'frontend/src/Chat.tsx'
        ],
        /SCW_API_KEY|NEXT_PUBLIC_|VITE_/,
      );
      const checked = spawnSync(
        'python3',
        ['-c', 'import ast,sys; ast.parse(sys.stdin.read())'],
        { input: files['src/agent_app/service_api.py'], encoding: 'utf8' },
      );
      assert.equal(checked.status, 0, checked.stderr);
    },
  );

test('Litestar route executes with mocks for validation, reply and safe upstream failures', () => {
  const files = composeServiceProject(
    pick('python', 'litestar'),
    undefined,
    'service',
    undefined,
    undefined,
    undefined,
    options,
  ).files;
  const script = [
    'import json, sys, types, asyncio',
    'sources=json.load(sys.stdin); calls=[]',
    'class Response:',
    ' def __init__(self,content,status_code=200): self.content=content; self.status_code=status_code',
    'class App:',
    ' def __init__(self,**kwargs): assert kwargs["request_max_body_size"]==32768',
    'def post(path,**kwargs):',
    ' assert path=="/api/chat" and kwargs["status_code"]==200',
    ' return lambda fn: fn',
    'class Request:',
    ' def __init__(self,raw): self.raw=raw',
    ' async def stream(self): yield self.raw',
    'def chat(message):',
    ' calls.append(message)',
    ' if message=="fail": raise Exception("PRIVATE_UPSTREAM_DETAIL")',
    ' return "reply"',
    'framework=types.ModuleType("litestar"); framework.Litestar=App; framework.Request=Request; framework.post=post',
    'exceptions=types.ModuleType("litestar.exceptions.http_exceptions"); exceptions.RequestEntityTooLarge=type("RequestEntityTooLarge",(Exception,),{})',
    'response=types.ModuleType("litestar.response"); response.Response=Response',
    'package=types.ModuleType("agent_app"); package.__path__=[]',
    'transport=types.ModuleType("agent_app.service_transport"); transport.chat=chat',
    'sys.modules.update({"litestar":framework,"litestar.response":response,"litestar.exceptions.http_exceptions":exceptions,"agent_app":package,"agent_app.service_transport":transport})',
    'scope={"__name__":"agent_app.service_api","__package__":"agent_app"};exec(sources["api"],scope)',
    'assert calls==[]',
    'async def verify():',
    ' for raw,status in [(b"{}",400),(b"not-json",400),(json.dumps({"message":" "}).encode(),400),(b"x"*32769,413),(json.dumps({"message":"hello"}).encode(),200),(json.dumps({"message":"fail"}).encode(),502)]:',
    '  result=await scope["api_chat"](Request(raw));assert result.status_code==status,(result.content,status)',
    '  assert "PRIVATE" not in json.dumps(result.content)',
    ' assert calls==["hello","fail"]',
    'asyncio.run(verify())',
  ].join('\n');
  const result = spawnSync('python3', ['-c', script], {
    input: JSON.stringify({ api: files['src/agent_app/service_api.py'] }),
    encoding: 'utf8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.equal(result.status, 0, result.stderr);
});
