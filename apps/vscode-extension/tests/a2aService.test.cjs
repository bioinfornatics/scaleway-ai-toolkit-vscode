const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { composeServiceProject } = require('../dist/serviceProject');
const { stackChoices } = require('../dist/stackScaffold');
const choices = stackChoices('agents');
const pick = (f) =>
  choices.find((c) => c.language === 'python' && c.framework === f);
test('FastAPI Strands agent API chooses A2A; webapp/CLI retain their contracts', (t) => {
  const opts = {
    projectType: 'agent',
    exposure: 'api',
    frontend: 'nextjs',
    architecture: 'separate',
  };
  const template = composeServiceProject(
    pick('fastapi'),
    pick('strands'),
    'local-a2a',
    undefined,
    undefined,
    undefined,
    opts,
  );
  const files = template.files;
  assert.equal(
    JSON.parse(files['service.authoring.json']).transport,
    'a2a-strands',
  );
  assert.match(files['pyproject.toml'], /a2a-sdk\[http-server\]==1\.2\.3/);
  assert.equal(files['src/agent_app/service_transport.py'], undefined);
  assert.equal(
    JSON.parse(files['service.authoring.json']).main_source,
    'src/agent_app/agent.py',
  );
  assert.match(files['src/agent_app/config.py'], /Path\.cwd\(\) \/ "\.env"/);
  assert.match(
    files['src/agent_app/a2a_executor.py'],
    /from \.agent import build_agent/,
  );
  assert.doesNotMatch(files['src/agent_app/service_api.py'], /api\/chat/);
  assert.match(files['src/agent_app/service_cli.py'], /proxy_headers=False/);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a2a-service-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [p, s] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
    fs.writeFileSync(path.join(root, p), s);
  }
  const env = {
    ...process.env,
    PYTHONPATH: path.join(root, 'src'),
    SCW_INFERENCE_BASE_URL: 'https://example.invalid/v1',
    SCW_INFERENCE_MODEL_ID: 'model',
    SCW_API_KEY: 'offline-key',
  };
  for (const args of [['--help'], ['--check'], []]) {
    const result = spawnSync(
      'python3',
      ['-m', 'agent_app.service_cli', ...args],
      { cwd: root, env, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
  }
  // Source layout reads only the generated project-root .env, not src/.env.
  fs.writeFileSync(
    path.join(root, '.env'),
    'SCW_INFERENCE_BASE_URL=https://example.invalid/v1\nSCW_INFERENCE_MODEL_ID=model\nSCW_API_KEY=fixture-only\n',
  );
  const dotenvEnv = { ...env };
  for (const key of [
    'SCW_INFERENCE_BASE_URL',
    'SCW_INFERENCE_MODEL_ID',
    'SCW_API_KEY',
  ])
    delete dotenvEnv[key];
  const dotenvCheck = spawnSync(
    'python3',
    ['-m', 'agent_app.service_cli', '--check'],
    { cwd: root, env: dotenvEnv, encoding: 'utf8' },
  );
  assert.equal(dotenvCheck.status, 0, dotenvCheck.stderr);
  const result = spawnSync(
    'python3',
    [path.join(__dirname, 'fixtures/a2a-offline.py'), root],
    { cwd: root, env, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  for (const scenario of [
    'executor success/error',
    'authored builder + real HTTPX',
    'ASGI route/method',
    'actual pinned V2 handler',
  ])
    assert.ok(result.stdout.includes(scenario), result.stdout);
  const web = composeServiceProject(
    pick('fastapi'),
    pick('strands'),
    'local-web',
    undefined,
    undefined,
    undefined,
    { ...opts, projectType: 'webapp' },
  );
  assert.match(web.files['src/agent_app/service_api.py'], /api\/chat/);
  assert.equal(web.files['src/agent_app/a2a_executor.py'], undefined);
  const cli = composeServiceProject(
    undefined,
    pick('strands'),
    'local-cli',
    undefined,
    undefined,
    undefined,
    { ...opts, exposure: 'cli' },
  );
  assert.equal(cli.files['src/agent_app/service_api.py'], undefined);
});
