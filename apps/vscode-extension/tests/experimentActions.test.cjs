const assert = require('node:assert/strict');
const { test } = require('node:test');
const Module = require('node:module');
const experiment = {
  version: 1,
  mode: 'offline-synthetic',
  model: 'demo-code',
  prompt: 'Explain',
  output: 'Synthetic',
  status: 'completed',
  billed: false,
};
function setup({ cancel = false, large = false, invalid = false } = {}) {
  const opened = [],
    commands = [];
  const vscode = {
    window: {
      showOpenDialog: async () =>
        cancel
          ? undefined
          : [{ scheme: 'file', path: '/synthetic/experiment.json' }],
      showQuickPick: async (items) => (cancel ? undefined : items[0]),
      showTextDocument: async (document) => opened.push(document),
    },
    workspace: {
      openTextDocument: async (options) => options,
      fs: {
        stat: async () => ({ size: large ? 131073 : 1000 }),
        readFile: async () =>
          Buffer.from(
            JSON.stringify(
              invalid ? { ...experiment, token: 'secret' } : experiment,
            ),
          ),
        writeFile: async () =>
          assert.fail('native Save As only, no silent overwrite'),
      },
    },
    commands: { executeCommand: async (id) => commands.push(id) },
  };
  const original = Module._load;
  Module._load = function (name, ...args) {
    return name === 'vscode' ? vscode : original.call(this, name, ...args);
  };
  delete require.cache[require.resolve('../dist/experimentActions')];
  let actions;
  try {
    actions = require('../dist/experimentActions');
  } finally {
    Module._load = original;
  }
  return { actions, opened, commands };
}
test('save presents exact local contents and delegates overwrite to native Save As', async () => {
  const s = setup();
  assert.equal(await s.actions.saveExperiment(experiment), true);
  assert.deepEqual(JSON.parse(s.opened[0].content), experiment);
  assert.deepEqual(s.commands, ['workbench.action.files.saveAs']);
});
test('load is bounded data import; cancel/invalid/oversize do not execute data', async () => {
  assert.deepEqual(await setup().actions.loadExperiment(), experiment);
  assert.equal(
    await setup({ cancel: true }).actions.loadExperiment(),
    undefined,
  );
  await assert.rejects(
    setup({ large: true }).actions.loadExperiment(),
    /experiment_too_large/,
  );
  await assert.rejects(
    setup({ invalid: true }).actions.loadExperiment(),
    /invalid_offline_experiment/,
  );
});
test('export is explicit untitled code editor and cancel has no side effect', async () => {
  const s = setup();
  await s.actions.exportExperiment(experiment);
  assert.equal(s.opened[0].language, 'python');
  assert.match(s.opened[0].content, /No API/);
  const cancelled = setup({ cancel: true });
  await cancelled.actions.exportExperiment(experiment);
  assert.equal(cancelled.opened.length, 0);
});
