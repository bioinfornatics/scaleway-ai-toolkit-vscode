const assert = require('node:assert/strict');
const { test } = require('node:test');
const { CatalogHealth } = require('../dist/catalogHealth');
test('health requires current revision and ready, delayed acknowledgement resolves', async () => {
  const health = new CatalogHealth();
  const revision = health.next();
  const report = { revision, publicCards: 12, dedicatedCards: 0 };
  assert.equal(health.accept(report), false);
  health.ready = true;
  const pending = health.wait(100);
  assert.equal(health.accept({ ...report, revision: revision - 1 }), false);
  assert.equal(health.accept(report), true);
  assert.deepEqual(await pending, report);
  health.next();
  assert.equal(await health.wait(5), undefined);
});
test('dispose/reset clears previous readiness and cancels waiting diagnostics', async () => {
  const health = new CatalogHealth();
  health.ready = true;
  health.next();
  const pending = health.wait(100);
  health.reset();
  assert.equal(await pending, undefined);
  assert.equal(health.ready, false);
  assert.equal(health.report, undefined);
});
