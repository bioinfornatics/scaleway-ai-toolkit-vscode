const assert = require('node:assert/strict');
const { test } = require('node:test');
const { models, validatePrompt, runDemo } = require('../dist/demo');
test('completed demo streams synthetic content without echoing input', async () => {
  const chunks = [];
  const result = await runDemo(
    models[0],
    'private-demo-input',
    () => false,
    (chunk) => chunks.push(chunk),
    0,
  );
  assert.equal(result.status, 'completed');
  assert.equal(result.billed, false);
  assert.equal(result.mode, 'offline-synthetic');
  assert.ok(chunks.length > 10);
  assert.equal(result.output, chunks.join(''));
  assert.ok(!result.output.includes('private-demo-input'));
});
test('cancelled demo has no late chunks', async () => {
  let stop = false;
  let chunks = 0;
  const result = await runDemo(
    models[1],
    'hello',
    () => stop,
    () => {
      chunks++;
      stop = true;
    },
    0,
  );
  assert.equal(result.status, 'cancelled');
  assert.equal(chunks, 1);
});
test('prompt and model validation', async () => {
  assert.throws(() => validatePrompt(' '));
  assert.throws(() => validatePrompt('a'.repeat(4097)));
  assert.equal(validatePrompt(' hi '), 'hi');
  await assert.rejects(
    runDemo(
      { id: 'foreign' },
      'hello',
      () => false,
      () => {},
      0,
    ),
  );
});
