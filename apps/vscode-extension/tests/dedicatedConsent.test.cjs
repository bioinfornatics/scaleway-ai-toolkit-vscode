const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const did = '33333333-3333-3333-3333-333333333333';
function fixture(authentication = 'iam') {
  const project = {
    id: '22222222-2222-2222-2222-222222222222',
    organizationId: '11111111-1111-1111-1111-111111111111',
    name: 'Synthetic',
  };
  const deployment = {
    id: did,
    kind: 'dedicated',
    label: 'Dedicated',
    status: 'ready',
    deploymentInfo: {
      projectId: project.id,
      region: 'fr-par',
      fetchedAt: 'synthetic',
      modelId: '55555555-5555-5555-5555-555555555555',
      modelName: 'meta/llama:fp8',
      endpoints: [
        {
          id: '44444444-4444-4444-4444-444444444444',
          url: 'https://' + did + '.ifr.fr-par.scaleway.com/v1',
          network: 'public',
          authentication,
        },
      ],
    },
  };
  return { deployment, project };
}
function helper(window) {
  const id = require.resolve('../dist/dedicatedConsent');
  const loaded = new Module(id, module);
  loaded.filename = id;
  loaded.paths = module.paths;
  loaded.require = (name) =>
    name === 'vscode'
      ? { window }
      : require(
          name === './dedicatedInvocationPolicy'
            ? '../dist/dedicatedInvocationPolicy'
            : name,
        );
  loaded._compile(require('node:fs').readFileSync(id, 'utf8'), id);
  return loaded.exports.dedicatedConsent;
}
for (const auth of ['iam', 'disabled'])
  test(
    'native exact consent ' +
      auth +
      ' is 30min, host-owned, and no automatic Run',
    async () => {
      const f = fixture(auth);
      const calls = [];
      const consent = helper({
        showQuickPick: async (items, options) => {
          calls.push(options);
          return items[0];
        },
        showWarningMessage: async (_text, options, button) => {
          calls.push(options);
          return button;
        },
      });
      const approval = await consent(
        f.deployment,
        f.project,
        () => true,
        () => 1000,
      );
      assert.equal(approval.expiresAt - approval.approvedAt, 30 * 60 * 1000);
      assert.equal(
        approval.endpointUrl,
        f.deployment.deploymentInfo.endpoints[0].url,
      );
      assert.equal(approval.modelName, 'meta/llama:fp8');
      assert.equal(approval.authentication, auth);
      assert.equal(approval.allowUnauthenticated, auth === 'disabled');
      assert.equal(calls[1].modal, true);
      assert.match(calls[1].detail, /30 minutes/);
      assert.match(calls[1].detail, /PAS un mandat cloud agent/);
      assert.match(calls[1].detail, /durée du déploiement/);
      assert.match(calls[1].detail, /Aucune exécution automatique/);
      assert.ok(calls[1].detail.includes(approval.endpointUrl));
    },
  );
for (const phase of [
  'selection-cancel',
  'confirmation-cancel',
  'selection-stale',
  'confirmation-stale',
])
  test(phase + ' never returns approval', async () => {
    const f = fixture();
    let current = true,
      confirmations = 0;
    const consent = helper({
      showQuickPick: async (items) => {
        if (phase === 'selection-stale') current = false;
        return phase === 'selection-cancel' ? undefined : items[0];
      },
      showWarningMessage: async (_text, _options, button) => {
        confirmations++;
        if (phase === 'confirmation-stale') current = false;
        return phase === 'confirmation-cancel' ? undefined : button;
      },
    });
    assert.equal(
      await consent(f.deployment, f.project, () => current),
      undefined,
    );
    if (phase.startsWith('selection')) assert.equal(confirmations, 0);
  });
test('private/unsafe/unready endpoints never selectable and helper contains no transport or credential access', async () => {
  for (const change of [
    (f) => (f.deployment.status = 'creating'),
    (f) => (f.deployment.deploymentInfo.endpoints[0].network = 'private'),
    (f) =>
      (f.deployment.deploymentInfo.endpoints[0].url = 'https://evil.invalid'),
  ]) {
    const f = fixture();
    change(f);
    let picks = 0;
    const consent = helper({
      showQuickPick: async () => {
        picks++;
      },
      showWarningMessage: async () => undefined,
    });
    assert.equal(await consent(f.deployment, f.project), undefined);
    assert.equal(picks, 0);
  }
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../src/dedicatedConsent.ts'),
    'utf8',
  );
  assert.doesNotMatch(
    source,
    /fetch\s*\(|https\.request|authorize\s*\(|invokeText\s*\(|invokeDedicatedText\s*\(/,
  );
});
module.exports.fixture = fixture;
