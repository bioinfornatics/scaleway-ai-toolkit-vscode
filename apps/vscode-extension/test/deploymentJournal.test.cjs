const assert = require('node:assert/strict');
const { test } = require('node:test');
const { DeploymentJournal } = require('../dist/deploymentJournal');
const user = '11111111-1111-4111-8111-111111111111';
const project = {
  id: '22222222-2222-4222-8222-222222222222',
  organizationId: '33333333-3333-4333-8333-333333333333',
  name: 'Test',
};
const record = {
  version: 1,
  id: '44444444-4444-4444-8444-444444444444',
  projectId: project.id,
  organizationId: project.organizationId,
  modelId: '55555555-5555-4555-8555-555555555555',
  name: 'Model',
  region: 'fr-par',
  status: 'submitting',
};
function setup() {
  const data = new Map();
  const storage = {
    get: (key) => data.get(key),
    update: async (key, value) => {
      data.set(key, structuredClone(value));
    },
  };
  return {
    data,
    storage,
    journal: new DeploymentJournal(storage, user, project),
  };
}
test('journal persists metadata, scopes users and recovers uncertain send without retry', async () => {
  const s = setup();
  await s.journal.save(record);
  const restored = new DeploymentJournal(s.storage, user, project);
  assert.equal((await restored.recover())[0].status, 'unknown');
  await assert.rejects(
    restored.save({ ...record, status: 'prepared' }),
    /reconcile_before_retry/,
  );
  assert.equal(
    (
      await new DeploymentJournal(
        s.storage,
        '66666666-6666-4666-8666-666666666666',
        project,
      ).recover()
    ).length,
    0,
  );
  assert.equal([...s.data.values()][0][0].status, 'submitting');
  await restored.save({ ...record, status: 'unknown' });
  await assert.rejects(
    restored.save({ ...record, status: 'prepared' }),
    /invalid_operation_transition/,
  );
});
test('journal rejects extra secret fields, foreign scope, corruption and duplicate ids', async () => {
  const s = setup();
  for (const bad of [
    { ...record, token: 'secret' },
    { ...record, projectId: user },
    { ...record, status: 'accepted' },
    { ...record, status: 'unknown', deploymentId: user },
  ])
    await assert.rejects(s.journal.save(bad), /invalid_operation_journal/);
  await s.journal.save(record);
  const key = [...s.data.keys()][0];
  s.data.set(key, [record, record]);
  await assert.rejects(s.journal.recover(), /invalid_operation_journal/);
});
test('journal serializes snapshots and preserves accepted identity on failed writes', async () => {
  const s = setup();
  const mutable = { ...record };
  const a = s.journal.save(mutable);
  mutable.name = 'Tampered';
  const b = s.journal.save({
    ...record,
    status: 'accepted',
    deploymentId: user,
  });
  await Promise.all([a, b]);
  assert.equal((await s.journal.recover())[0].name, 'Model');
  await assert.rejects(
    s.journal.save({ ...record, status: 'accepted', deploymentId: project.id }),
    /invalid_operation_transition/,
  );
  s.storage.update = async () => {
    throw Error('storage failure');
  };
  await assert.rejects(
    s.journal.save({ ...record, status: 'accepted', deploymentId: user }),
    /storage failure/,
  );
  assert.equal((await s.journal.recover())[0].deploymentId, user);
});

test('journal refuses resubmitting a recovered write and duplicate allocation identity', async () => {
  const s = setup();
  await s.journal.save(record);
  const restarted = new DeploymentJournal(s.storage, user, project);
  await assert.rejects(restarted.save(record), /reconcile_before_retry/);
  await assert.rejects(
    restarted.save({ ...record, id: user }),
    /reconcile_before_retry/,
  );
});
