const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  parseExperiment,
  decodeExperiment,
  encodeExperiment,
  exportOfflineExample,
} = require('../dist/experiments');
const experiment = {
  version: 1,
  mode: 'offline-synthetic',
  model: 'demo-code',
  prompt: 'Explain "quotes" and \\ paths 🚀\nnext line',
  output: '<script>alert("x")</script>\nUnicode 模型',
  status: 'cancelled',
  billed: false,
};
test('strict offline experiment roundtrip preserves edits/status and rejects provider/credential fields', () => {
  assert.deepEqual(decodeExperiment(encodeExperiment(experiment)), experiment);
  for (const value of [
    null,
    [],
    { ...experiment, token: 'secret' },
    { ...experiment, mode: 'serverless' },
    { ...experiment, billed: true },
    { ...experiment, model: 'real' },
    { ...experiment, version: 2 },
    { ...experiment, prompt: '  whitespace  ' },
    { ...experiment, output: 'a'.repeat(65537) },
  ])
    assert.equal(parseExperiment(value), undefined);
  assert.equal(decodeExperiment(new Uint8Array(131073)), undefined);
  assert.equal(decodeExperiment(Uint8Array.from([255])), undefined);
  assert.equal(decodeExperiment(Buffer.from('{ broken')), undefined);
});
test('independent Python and TypeScript generated scripts replay exact data without network or code injection', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scw-export-'));
  try {
    const python = path.join(directory, 'experiment.py');
    const typescript = path.join(directory, 'experiment.ts');
    fs.writeFileSync(python, exportOfflineExample(experiment, 'python'));
    fs.writeFileSync(
      typescript,
      exportOfflineExample(experiment, 'typescript'),
    );
    const environment = { PATH: process.env.PATH, HOME: directory };
    assert.deepEqual(
      JSON.parse(
        execFileSync('python3', [python], {
          encoding: 'utf8',
          env: environment,
        }),
      ),
      experiment,
    );
    assert.deepEqual(
      JSON.parse(
        execFileSync(
          process.execPath,
          ['--experimental-strip-types', typescript],
          { encoding: 'utf8', env: environment },
        ),
      ),
      experiment,
    );
    assert.ok(!fs.readFileSync(typescript, 'utf8').includes('fetch('));
    assert.ok(!fs.readFileSync(python, 'utf8').includes('requests'));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
