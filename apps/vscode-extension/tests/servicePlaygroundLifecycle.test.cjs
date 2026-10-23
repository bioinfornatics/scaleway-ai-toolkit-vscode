const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadSource, forbidden } = require('./fixtures/htmlDom.cjs');
const project = {
  id: '11111111-1111-1111-1111-111111111111',
  organizationId: '22222222-2222-2222-2222-222222222222',
  name: 'Local test',
};
const model = { id: 'vendor/model', label: 'Local test', kind: 'serverless' };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function setup({ scopeFailure = false, actions } = {}) {
  const source = loadSource('servicePlayground', {
    './realExperimentActions': actions ?? {
      saveRealExchange: forbidden,
      reviewRealSnapshot: forbidden,
      exportRealExchange: forbidden,
    },
  });
  const abort = new AbortController();
  let removed = 0,
    disposed = 0;
  const remove = abort.signal.removeEventListener.bind(abort.signal);
  abort.signal.removeEventListener = (...args) => {
    removed++;
    remove(...args);
  };
  const publishes = [],
    calls = [];
  const scope = {
    project,
    signal: abort.signal,
    current: () => !abort.signal.aborted,
    authorize: () => '33333333-3333-3333-3333-333333333333',
    dispose: () => {
      disposed++;
      abort.abort();
      if (scopeFailure) throw new Error('scope failed');
    },
  };
  const invoke = (input, delta, usage) => {
    const pending = deferred();
    calls.push({ input, delta, usage, ...pending });
    return pending.promise;
  };
  const publish = (state) => publishes.push(state);
  const controller = new source.ServicePlayground(
    model,
    scope,
    publish,
    invoke,
    undefined,
    { environment: 'local-mock' },
  );
  return {
    controller,
    abort,
    calls,
    publishes,
    scope,
    invoke,
    publish,
    removed: () => removed,
    disposed: () => disposed,
  };
}
function purged(s) {
  const c = s.controller;
  assert.equal(c.active, undefined);
  assert.equal(c.snapshot, undefined);
  assert.equal(c.lastRun, undefined);
  assert.equal(c.dedicated, undefined);
  assert.equal(c.state.output, '');
  assert.equal(c.state.status, '');
  assert.equal(c.state.running, false);
  assert.equal(c.state.blocked, true);
  assert.equal(c.state.snapshotAvailable, false);
  assert.equal(c.state.actionBusy, false);
  for (const key of ['usage', 'cost', 'actionStatus'])
    assert.equal(c.state[key], undefined);
  assert.notEqual(c.scope, s.scope);
  for (const key of ['authorize', 'current', 'dispose'])
    assert.notEqual(c.scope[key], s.scope[key]);
  assert.notEqual(c.publish, s.publish);
  assert.notEqual(c.invoke, s.invoke);
  assert.equal(c.scope.current(), false);
  assert.throws(() => c.scope.authorize(), /disposed/);
  assert.equal(c.model.id, '');
  assert.equal(c.scope.project.id, '');
}
for (const phase of ['idle', 'streaming', 'completed', 'scope-failure']) {
  test('dispose purges and releases once: ' + phase, async () => {
    const s = setup({ scopeFailure: phase === 'scope-failure' });
    let run;
    if (phase !== 'idle') {
      run = s.controller.receive({
        type: 'run',
        prompt: 'sensitive local prompt',
        maxTokens: 16,
      });
      assert.equal(s.calls.length, 1);
      s.calls[0].delta('sensitive local output');
      s.calls[0].usage({ inputTokens: 1, outputTokens: 1, totalTokens: 2 });
      assert.ok(s.controller.snapshot);
      if (phase === 'completed') {
        s.calls[0].resolve();
        await run;
      }
    }
    const count = s.publishes.length;
    if (phase === 'scope-failure')
      assert.throws(() => s.controller.dispose(), /scope failed/);
    else s.controller.dispose();
    s.controller.dispose();
    assert.equal(s.disposed(), 1);
    assert.equal(s.removed(), 1);
    if (s.calls.length) {
      if (phase !== 'completed')
        assert.equal(s.calls[0].input.signal.aborted, true);
      s.calls[0].delta('late');
      s.calls[0].usage({ inputTokens: 9, outputTokens: 9, totalTokens: 18 });
      s.calls[0].reject(new Error('late failure'));
      await run;
    }
    s.abort.abort();
    s.controller.invalidate(); // cached listener reference is inert, too
    for (const type of [
      'ready',
      'cancel',
      'loadSnapshot',
      'saveExchange',
      'exportExample',
    ])
      await s.controller.receive({ type });
    await s.controller.receive({
      type: 'run',
      prompt: 'no replay',
      maxTokens: 16,
    });
    assert.equal(s.publishes.length, count);
    purged(s);
  });
}
for (const type of ['loadSnapshot', 'saveExchange', 'exportExample']) {
  for (const failure of [false, true]) {
    test(
      'pending ' + type + ' cannot repopulate disposed state (' + failure + ')',
      async () => {
        const pending = deferred();
        let actionCalls = 0;
        const action = () => {
          actionCalls++;
          return pending.promise;
        };
        const s = setup({
          actions: {
            saveRealExchange: action,
            reviewRealSnapshot: action,
            exportRealExchange: action,
          },
        });
        if (type !== 'loadSnapshot') {
          const run = s.controller.receive({
            type: 'run',
            prompt: 'local sensitive prompt',
            maxTokens: 16,
          });
          s.calls[0].delta('local sensitive output');
          s.calls[0].resolve();
          await run;
        }
        const actionRun = s.controller.receive({ type });
        assert.equal(actionCalls, 1);
        assert.equal(s.controller.state.actionBusy, true);
        s.controller.dispose();
        const count = s.publishes.length;
        if (failure) pending.reject(new Error('native action failed'));
        else pending.resolve();
        await actionRun;
        assert.equal(s.publishes.length, count);
        purged(s);
      },
    );
  }
}

test('repeated local open/close cycles release each scope and sensitive buffer once', async () => {
  const retained = [];
  for (let cycle = 0; cycle < 20; cycle++) {
    const s = setup();
    const run = s.controller.receive({
      type: 'run',
      prompt: 'local prompt ' + cycle,
      maxTokens: 16,
    });
    s.calls[0].delta('local output ' + cycle);
    s.calls[0].resolve();
    await run;
    s.controller.dispose();
    s.controller.dispose();
    assert.equal(s.removed(), 1);
    assert.equal(s.disposed(), 1);
    retained.push(s);
  }
  // Even a mistakenly retained host controller has no original scope/publish or buffers.
  for (const s of retained) purged(s);
});
