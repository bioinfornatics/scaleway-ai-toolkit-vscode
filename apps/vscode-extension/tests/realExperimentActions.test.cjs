const assert = require('node:assert/strict');
const { test } = require('node:test');
const Module = require('node:module');
const format = require('../dist/realExperiments');
const reader = require('../dist/boundedExperimentRead');
const actualRead = reader.readBoundedExperimentFile;
const id = '11111111-1111-1111-1111-111111111111';
const snapshot = () =>
  format.parseRealExperiment({
    version: 1,
    mode: 'real-provider',
    status: 'partial',
    timestamp: '2026-10-21T12:00:00.000Z',
    service: {
      kind: 'serverless',
      organizationId: id,
      projectId: id,
      modelId: 'model',
      modelName: 'model',
      destination: `https://api.scaleway.ai/${id}/v1/chat/completions`,
      authentication: 'iam',
    },
    prompt: 'Explicit prompt',
    maxTokens: 256,
    output: 'Partial output',
    execution: { environment: 'local-mock', billed: 'none' },
    cost: { actual: 'unknown', billing: 'token' },
  });
function setup(options = {}) {
  const calls = [],
    providers = new Map();
  let close,
    disposed = 0;
  const uri = {
    scheme: 'file',
    fsPath: '/fixture.json',
    toString: () => 'file:/fixture.json',
  };
  reader.readBoundedExperimentFile = async (path) => {
    calls.push(['read', path]);
    if (options.readFail) throw new Error('invalid_snapshot_file');
    return options.bytes ?? format.encodeRealExperiment(snapshot());
  };
  const api = {
    FileType: { File: 1 },
    Uri: {
      parse: (value) => ({
        scheme: value.split(':')[0],
        toString: () => value,
      }),
    },
    window: {
      showWarningMessage: async (...args) => {
        calls.push(['warn', ...args]);
        return options.rejectWarning ? undefined : 'Open document';
      },
      showOpenDialog: async (args) => {
        calls.push(['dialog', args]);
        return options.cancel
          ? undefined
          : [{ ...uri, scheme: options.scheme ?? 'file' }];
      },
      showQuickPick: async (items) => {
        calls.push(['pick', items]);
        return options.cancel
          ? undefined
          : items[options.language === 'typescript' ? 1 : 0];
      },
      showTextDocument: async (document, args) => {
        calls.push(['show', document, args]);
        if (options.showFail) throw new Error('sensitive path and prompt');
      },
    },
    workspace: {
      fs: new Proxy(
        {},
        {
          get() {
            throw new Error('VS Code filesystem forbidden');
          },
        },
      ),
      openTextDocument: async (input) => {
        calls.push(['open', input]);
        if (options.openFail) throw new Error('sensitive');
        return { uri: input.toString ? input : uri, isDirty: true };
      },
      registerTextDocumentContentProvider: (scheme, provider) => {
        calls.push(['provider', scheme]);
        providers.set(scheme, provider);
        return { dispose: () => disposed++ };
      },
      onDidCloseTextDocument: (listener) => {
        close = listener;
        return { dispose: () => disposed++ };
      },
    },
    commands: {
      executeCommand: async (command) => {
        calls.push(['command', command]);
        if (options.saveFail) throw new Error('native save failed');
      },
    },
  };
  const load = Module._load;
  Module._load = function (name, ...args) {
    return name === 'vscode' ? api : load.call(this, name, ...args);
  };
  const path = require.resolve('../dist/realExperimentActions');
  delete require.cache[path];
  let actions;
  try {
    actions = require(path);
  } finally {
    Module._load = load;
  }
  return {
    actions,
    calls,
    providers,
    close: (document) => close(document),
    disposed: () => disposed,
  };
}
test('save warns then opens exact dirty JSON and native SaveAs; no success claim', async () => {
  const f = setup();
  assert.equal(await f.actions.saveRealExchange(snapshot()), undefined);
  assert.deepEqual(
    f.calls.map((c) => c[0]),
    ['warn', 'open', 'show', 'command'],
  );
  assert.deepEqual(JSON.parse(f.calls[1][1].content), snapshot());
  assert.equal(f.calls[1][1].language, 'json');
  assert.equal(f.calls[2][2].preview, false);
  assert.equal(f.calls[3][1], 'workbench.action.files.saveAs');
});
test('warning cancellation does not open or save; invalid input opens nothing', async () => {
  const f = setup({ rejectWarning: true });
  await f.actions.saveRealExchange(snapshot());
  assert.deepEqual(
    f.calls.map((c) => c[0]),
    ['warn'],
  );
  await assert.rejects(
    f.actions.saveRealExchange({ ...snapshot(), consent: true }),
  );
  assert.equal(f.calls.length, 1);
});
test('native SaveAs rejection propagates, never reports saved', async () => {
  const f = setup({ saveFail: true });
  await assert.rejects(f.actions.saveRealExchange(snapshot()));
});
test('load is bounded immutable read-only native review with no returned authority', async () => {
  const bytes = format.encodeRealExperiment(snapshot());
  const f = setup({ bytes });
  assert.equal(await f.actions.reviewRealSnapshot(), undefined);
  const [scheme, provider] = [...f.providers][0];
  const content = provider.provideTextDocumentContent();
  bytes.fill(0);
  assert.deepEqual(JSON.parse(content), snapshot());
  const opened = f.calls.find((c) => c[0] === 'open')[1];
  assert.equal(opened.scheme, scheme);
  assert.equal(
    f.calls.some((c) => c[0] === 'command'),
    false,
  );
  f.close({ uri: opened });
  assert.equal(f.disposed(), 2);
});
test('load rejects non-file scheme before reading and propagates generic reader failures', async () => {
  for (const options of [{ scheme: 'https' }, { readFail: true }]) {
    const f = setup(options);
    await assert.rejects(f.actions.reviewRealSnapshot());
    assert.equal(
      f.calls.some((c) => c[0] === 'open'),
      false,
    );
  }
});
test('load rechecks read cap for TOCTOU and rejects malformed/authority-bearing JSON', async () => {
  for (const bytes of [
    new Uint8Array(format.REAL_EXPERIMENT_BYTES + 1),
    Buffer.from('{'),
    Buffer.from(JSON.stringify({ ...snapshot(), consent: true })),
    Buffer.from([255]),
  ]) {
    const f = setup({ bytes });
    await assert.rejects(f.actions.reviewRealSnapshot());
    assert.equal(
      f.calls.some((c) => c[0] === 'open'),
      false,
    );
  }
});
test('cancelled picker or review warning has no document side effect', async () => {
  for (const options of [{ cancel: true }, { rejectWarning: true }]) {
    const f = setup(options);
    await f.actions.reviewRealSnapshot();
    await f.actions.exportRealExchange(snapshot());
    assert.equal(
      f.calls.some((c) => c[0] === 'open' || c[0] === 'command'),
      false,
    );
  }
});
test('review failures dispose provider and sanitize action error', async () => {
  const f = setup({ openFail: true });
  await assert.rejects(f.actions.reviewRealSnapshot(), {
    message: 'snapshot_review_unavailable',
  });
  assert.equal(f.disposed(), 2);
});
test('both export languages open source only; no commands or filesystem writes', async () => {
  for (const language of ['python', 'typescript']) {
    const f = setup({ language });
    await f.actions.exportRealExchange(snapshot());
    const input = f.calls.find((c) => c[0] === 'open')[1];
    assert.equal(input.language, language);
    assert.match(input.content, /MOCK DEFAULT/);
    assert.match(input.content, /actual cost UNKNOWN/);
    assert.equal(
      f.calls.some((c) => ['command', 'stat', 'read'].includes(c[0])),
      false,
    );
  }
});
test('review uses actual bounded local reader and leaves file unchanged', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scw-review-'));
  try {
    const file = path.join(dir, 'snapshot.json');
    const bytes = format.encodeRealExperiment(snapshot());
    fs.writeFileSync(file, bytes);
    const f = setup();
    reader.readBoundedExperimentFile = () => actualRead(file);
    await f.actions.reviewRealSnapshot();
    assert.deepEqual(fs.readFileSync(file), Buffer.from(bytes));
    assert.deepEqual(
      JSON.parse([...f.providers.values()][0].provideTextDocumentContent()),
      snapshot(),
    );
  } finally {
    reader.readBoundedExperimentFile = actualRead;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
