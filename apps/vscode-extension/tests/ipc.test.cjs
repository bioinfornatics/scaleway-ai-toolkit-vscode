const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const { parseInput } = require('../dist/ipc');
test('closed playground IPC rejects unknown payloads', () => {
  for (const value of [
    null,
    [],
    { type: 'run', model: 'foreign', prompt: 'hi' },
    { type: 'run', model: 'demo-general', prompt: 'hi', secret: 'x' },
    { type: 'cancel', extra: true },
    { type: 'run', model: 'demo-general', prompt: 'a'.repeat(4097) },
  ])
    assert.equal(parseInput(value), undefined);
  assert.deepEqual(
    parseInput({ type: 'run', model: 'demo-general', prompt: ' hi ' }),
    { type: 'run', model: 'demo-general', prompt: 'hi' },
  );
  assert.deepEqual(parseInput({ type: 'cancel' }), { type: 'cancel' });
});
test('webview rendering has no HTML sink or transport', () => {
  const source = fs.readFileSync('media/playground.js', 'utf8');
  assert.ok(!source.includes('innerHTML'));
  assert.ok(!source.includes('fetch('));
  assert.ok(source.includes('response.textContent'));
});
test('manifest separates resource/action/help views and hides idle stop', () => {
  const pkg = require('../package.json');
  assert.deepEqual(
    pkg.contributes.views.scalewayAI.map((v) => v.name),
    ['Mes ressources', 'Outils de développement', 'Aide et retours'],
  );
  const stop = pkg.contributes.menus['view/title'].find(
    (m) => m.command === 'scalewayAI.cancel',
  );
  assert.ok(stop.when.includes('scalewayAI.running'));
});

test('sidebar has no login row; account commands share gate while public actions remain accessible', () => {
  const s = fs.readFileSync('src/extension.ts', 'utf8');
  assert.ok(!s.includes("id: 'connection'"));
  assert.ok(!s.includes("command: 'scalewayAI.login'"));
  assert.match(
    s,
    /new Set\(\[\s*'scalewayAI.loadModels',\s*'scalewayAI.refreshModels',?\s*\]\)/,
  );
  assert.match(s, /!\(await connection\.ensureProject\(\)\)/);
  assert.match(
    s,
    /register\(\s*'scalewayAI.switchProject',\s*\(\) => connection\.switchProject\(\),?\s*\)/,
  );
  assert.match(s, /command:\s*'scalewayAI.refreshModels',\s*children:/);
});
