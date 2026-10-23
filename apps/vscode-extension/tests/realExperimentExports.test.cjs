const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { exportRealExample } = require('../dist/realExperimentExports');
const id = '11111111-1111-1111-1111-111111111111';
function fixture(kind = 'serverless', authentication = 'iam') {
  const origin = `https://${id}.ifr.fr-par.scaleway.com`;
  return {
    version: 1,
    mode: 'real-provider',
    status: 'cancelled',
    timestamp: '2026-10-21T12:00:00.000Z',
    service: {
      kind,
      organizationId: id,
      projectId: id,
      modelId: id,
      modelName: 'provider/model',
      authentication,
      destination:
        kind === 'serverless'
          ? `https://api.scaleway.ai/${id}/v1/chat/completions`
          : `${origin}/v1/chat/completions`,
      ...(kind === 'dedicated'
        ? {
            region: 'fr-par',
            deploymentId: id,
            endpointId: id,
            endpointUrl: `${origin}/v1/`,
          }
        : {}),
    },
    prompt:
      '"; throw new Error("INJECTED"); //\n\' ); __import__("os").system("false") # \\ 🚀 \u2028 \u2029',
    maxTokens: 9,
    output: 'SAVED output, NOT execution',
    execution: { environment: 'live', billed: 'unknown' },
    cost: {
      actual: 'unknown',
      billing: kind === 'dedicated' ? 'deployment-duration' : 'token',
    },
  };
}
function workspace(callback) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scw-real-exports-'));
  try {
    callback(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
function invoke(dir, language, source, mode = 'mock') {
  const file = path.join(
    dir,
    language === 'python' ? 'experiment.py' : 'experiment.mts',
  );
  fs.writeFileSync(file, source);
  const env = {
    PATH: process.env.PATH,
    HOME: dir,
    PYTHONDONTWRITEBYTECODE: '1',
  };
  let result;
  if (language === 'python') {
    const wrapper = path.join(dir, 'guard.py');
    fs.writeFileSync(
      wrapper,
      'import runpy, socket, os, sys\ndef deny(*args, **kwargs): raise AssertionError("network forbidden")\nsocket.create_connection = deny\nsocket.getaddrinfo = deny\nclass NoCredentials(dict):\n def get(self, *args): raise AssertionError("credential access forbidden")\nos.environ = NoCredentials()\nn = runpy.run_path(sys.argv[1], run_name="imported_example")\n' +
        (mode === 'import'
          ? ''
          : mode === 'snapshot'
            ? 'import json; print(json.dumps(n["experiment"], ensure_ascii=False))\n'
            : 'n["main"]([])\n'),
    );
    result = execFileSync('python3', [wrapper, file], {
      env,
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } else {
    const wrapper = path.join(dir, 'guard.mjs');
    fs.writeFileSync(
      wrapper,
      'import https from "node:https"; https.request = () => { throw new Error("network forbidden"); }; process.env = new Proxy({}, {get(target, key){if(key === "SCW_SECRET_KEY") throw new Error("credential access forbidden"); return undefined;}}); const n = await import(' +
        JSON.stringify(pathToFileURL(file).href) +
        '); ' +
        (mode === 'import'
          ? ''
          : mode === 'snapshot'
            ? 'console.log(JSON.stringify(n.experiment));'
            : 'await n.main([]);'),
    );
    result = execFileSync(
      process.execPath,
      ['--experimental-strip-types', wrapper],
      {
        env,
        encoding: 'utf8',
        timeout: 10000,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  }
  return mode === 'import' ? result : JSON.parse(result);
}
test('independent Python/TS mock invocation, no sockets or credential access, source outcome stays historical', () =>
  workspace((dir) => {
    for (const language of ['python', 'typescript'])
      for (const e of [
        fixture(),
        fixture('dedicated'),
        fixture('dedicated', 'disabled'),
      ]) {
        const source = exportRealExample(e, language);
        assert.equal(
          invoke(dir, language, source, 'import'),
          '',
          'import must never execute',
        );
        assert.deepEqual(
          invoke(dir, language, source, 'snapshot'),
          e,
          'safe quoting preserves exact snapshot including injection strings',
        );
        const report = invoke(dir, language, source);
        assert.deepEqual(report, {
          kind: 'real-experiment-run',
          sourceStatus: 'cancelled',
          environment: 'local-mock',
          billed: 'none',
          actualCost: 'unknown',
          status: 'completed',
          output: 'Local mock invocation; no cloud request.',
        });
        assert.equal(e.status, 'cancelled');
        assert.equal(e.output, 'SAVED output, NOT execution');
        assert.ok(!source.includes(e.prompt));
        for (const warning of [
          '--live',
          'SCW_SECRET_KEY',
          'NO secret',
          'deployment-duration',
          'UNKNOWN',
          'No redirects/retries',
          'NOT cloud-validated',
        ])
          assert.ok(source.includes(warning), warning);
      }
  }));
test('generated CLI executes default mock independently', () =>
  workspace((dir) => {
    for (const language of ['python', 'typescript']) {
      const file = path.join(
        dir,
        language === 'python' ? 'direct.py' : 'direct.ts',
      );
      fs.writeFileSync(file, exportRealExample(fixture(), language));
      const command = language === 'python' ? 'python3' : process.execPath;
      const args =
        language === 'python' ? [file] : ['--experimental-strip-types', file];
      const report = JSON.parse(
        execFileSync(command, args, {
          encoding: 'utf8',
          env: { PATH: process.env.PATH, HOME: dir },
          timeout: 10000,
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
      );
      assert.equal(report.environment, 'local-mock');
      assert.equal(report.status, 'completed');
    }
  }));
test('local parser rejects model mismatch, missing DONE, provider error and non-string output without live dispatch', () =>
  workspace((dir) => {
    for (const language of ['python', 'typescript']) {
      const source = exportRealExample(fixture(), language);
      const replacements =
        language === 'python'
          ? [
              ["'model': model, 'choices'", "'model': 'wrong', 'choices'"],
              ['data: [DONE]', 'data: '],
              [
                "'choices': [{'index'",
                "'error': 'ignored upstream body', 'choices': [{'index'",
              ],
              [
                "'content': 'Local mock invocation; no cloud request.'",
                "'content': 3",
              ],
            ]
          : [
              [
                'const fixture = { model, choices:',
                "const fixture = { model: 'wrong', choices:",
              ],
              ['data: [DONE]', 'data: '],
              [
                'const fixture = { model, choices:',
                "const fixture = { error: 'ignored upstream body', model, choices:",
              ],
              [
                "content: 'Local mock invocation; no cloud request.'",
                'content: 3',
              ],
            ];
      for (const [before, after] of replacements) {
        assert.ok(source.includes(before), before);
        const report = invoke(dir, language, source.replace(before, after));
        assert.ok(['failed', 'partial'].includes(report.status));
        assert.equal(report.billed, 'none');
        assert.ok(!JSON.stringify(report).includes('ignored upstream body'));
      }
    }
  }));
test('invalid schema or language cannot generate code', () => {
  assert.throws(
    () => exportRealExample({ ...fixture(), secretKey: 'forbidden' }, 'python'),
    /invalid_real_export/,
  );
  assert.throws(
    () => exportRealExample(fixture(), 'shell'),
    /invalid_real_export/,
  );
});

test('standalone parsers enforce fatal UTF8 and frame bounds with incremental Unicode', () =>
  workspace((dir) => {
    for (const language of ['python', 'typescript']) {
      const source = exportRealExample(fixture(), language);
      const marker =
        language === 'python'
          ? "        pending = b''"
          : '    let pending = Buffer.alloc(0)';
      assert.ok(source.includes(marker));
      const bad =
        language === 'python'
          ? [
              '        source = [bytes([255, 10, 10])]\n',
              "        source = [b'x' * (FRAME+1)]\n",
              "        source = [b':' + b'x'*15000 + bytes([10,10])] * 150\n",
            ]
          : [
              '    source = [Buffer.from([255, 10, 10])];\n',
              '    source = [Buffer.alloc(FRAME+1, 120)];\n',
              '    source = Array(150).fill(Buffer.concat([Buffer.alloc(15000, 58), Buffer.from([10,10])]));\n',
            ];
      for (const injection of bad) {
        const report = invoke(
          dir,
          language,
          source.replace(marker, injection + marker),
        );
        assert.equal(report.status, 'failed');
        assert.equal(report.output, '');
      }
      const unicode = source.replace(
        'Local mock invocation; no cloud request.',
        'Unicode 模型 🚀',
      );
      const fragment =
        language === 'python'
          ? '        source = [bytes([byte]) for byte in source[0]]\n'
          : '    source = [...source[0]].map(byte => Buffer.from([byte]));\n';
      const report = invoke(
        dir,
        language,
        unicode.replace(marker, fragment + marker),
      );
      assert.equal(report.status, 'completed');
      assert.equal(report.output, 'Unicode 模型 🚀');
    }
  }));
