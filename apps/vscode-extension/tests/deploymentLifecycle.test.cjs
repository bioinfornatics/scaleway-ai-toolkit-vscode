const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  followDeployment,
  abortableDelay,
} = require('../dist/deploymentLifecycle');
const { ReadError } = require('../dist/provider');
const project = {
  id: '11111111-1111-1111-1111-111111111111',
  organizationId: '22222222-2222-2222-2222-222222222222',
  name: 'Test',
};
const id = '33333333-3333-3333-3333-333333333333';
const resource = (status) => ({
  id,
  label: 'Candidate',
  kind: 'dedicated',
  status,
  deploymentInfo: {
    projectId: project.id,
    region: 'fr-par',
    fetchedAt: new Date().toISOString(),
    endpoints: [],
  },
});
test('follow recognizes actual lifecycle, bounded five reads, no seventh read or endpoint probe', async () => {
  const signal = new AbortController().signal;
  const states = ['creating', 'deploying', 'ready'];
  const seen = [];
  let reads = 0;
  const result = await followDeployment(
    project,
    id,
    signal,
    async () => {
      reads++;
      return resource(states.shift());
    },
    (row) => seen.push(row.status),
    async () => {},
  );
  assert.equal(result.state, 'ready');
  assert.equal(reads, 3);
  assert.deepEqual(seen, ['creating', 'deploying', 'ready']);
  const pending = await followDeployment(
    project,
    id,
    signal,
    async () => resource('future_state'),
    () => {},
    async () => {},
  );
  assert.equal(pending.state, 'pending');
  assert.equal(pending.reads, 5);
  for (const [status, state] of [
    ['error', 'failed'],
    ['locked', 'failed'],
    ['deleted', 'deleted'],
  ]) {
    const terminal = await followDeployment(
      project,
      id,
      signal,
      async () => resource(status),
      () => {},
      async () => {},
    );
    assert.equal(terminal.state, state);
    assert.equal(terminal.reads, 1);
  }
});
test('follow cancellation/foreign scope/transport failure stops without optimistic success', async () => {
  const abort = new AbortController();
  const result = await followDeployment(
    project,
    id,
    abort.signal,
    async () => resource('creating'),
    () => {},
    async () => {
      abort.abort();
    },
  );
  assert.equal(result.state, 'cancelled');
  assert.equal(result.reads, 1);
  await assert.rejects(
    followDeployment(
      project,
      id,
      new AbortController().signal,
      async () => ({ ...resource('ready'), id: project.id }),
      () => assert.fail('foreign update'),
      async () => {},
    ),
    { code: 'foreign_or_invalid_scope' },
  );
  await assert.rejects(
    followDeployment(
      project,
      id,
      new AbortController().signal,
      async () => {
        throw new ReadError('access_denied');
      },
      () => {},
      async () => {},
    ),
    { code: 'access_denied' },
  );
  const waitAbort = new AbortController();
  const delay = abortableDelay(10000, waitAbort.signal);
  waitAbort.abort();
  await assert.rejects(delay, { code: 'cancelled' });
});
