const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  dedicatedInvocationPolicy,
} = require('../dist/dedicatedInvocationPolicy');
const org = '11111111-1111-1111-1111-111111111111';
const pid = '22222222-2222-2222-2222-222222222222';
const did = '33333333-3333-3333-3333-333333333333';
const eid = '44444444-4444-4444-4444-444444444444';
const mid = '55555555-5555-5555-5555-555555555555';
function fixture() {
  const project = { id: pid, organizationId: org, name: 'Synthetic' };
  const url = `https://${did}.ifr.fr-par.scaleway.com`;
  const deployment = {
    id: did,
    label: 'Synthetic deployment',
    kind: 'dedicated',
    status: 'ready',
    deploymentInfo: {
      projectId: pid,
      region: 'fr-par',
      fetchedAt: '2026-10-21T00:00:00Z',
      modelId: mid,
      modelName: 'meta/llama-3.1-8b-instruct:fp8',
      endpoints: [{ id: eid, url, network: 'public', authentication: 'iam' }],
    },
  };
  const approval = {
    organizationId: org,
    projectId: pid,
    region: 'fr-par',
    deploymentId: did,
    endpointId: eid,
    endpointUrl: url,
    modelName: deployment.deploymentInfo.modelName,
    authentication: 'iam',
    allowUnauthenticated: false,
    approvedAt: 1000,
    expiresAt: 2000,
  };
  return { project, deployment, approval };
}
const decide = (f, now = 1500) =>
  dedicatedInvocationPolicy(f.deployment, f.project, f.approval, now);
test('pure policy binds exact endpoint/model/project without mutation or credentials', () => {
  const f = fixture(),
    before = JSON.stringify(f);
  const result = decide(f);
  assert.equal(result.allowed, true);
  assert.equal(result.url, `${f.approval.endpointUrl}/v1/chat/completions`);
  assert.equal(result.modelName, f.deployment.deploymentInfo.modelName);
  assert.notEqual(result.modelName, mid);
  assert.equal(result.reachable, 'unverified');
  assert.equal(result.billing, 'deployment-duration-not-token-estimate');
  assert.equal(JSON.stringify(f), before);
  assert.ok(!JSON.stringify(result).includes('secret'));
});
for (const path of ['/', '/v1', '/v1/'])
  test(`returned base path ${path}`, () => {
    const f = fixture();
    f.approval.endpointUrl += path;
    f.deployment.deploymentInfo.endpoints[0].url = f.approval.endpointUrl;
    assert.equal(
      decide(f).url,
      `${fixture().approval.endpointUrl}/v1/chat/completions`,
    );
  });
for (const [field, value] of [
  ['organizationId', pid],
  ['projectId', org],
  ['deploymentId', mid],
  ['endpointId', mid],
  ['region', 'nl-ams'],
  ['modelName', 'other'],
  ['endpointUrl', 'https://evil.invalid'],
  ['authentication', 'disabled'],
])
  test(`approval mismatch ${field}`, () => {
    const f = fixture();
    f.approval[field] = value;
    assert.equal(decide(f).allowed, false);
  });
for (const status of [
  'creating',
  'deploying',
  'scaling',
  'error',
  'locked',
  'deleted',
  undefined,
])
  test(`non-ready deployment ${status}`, () => {
    const f = fixture();
    f.deployment.status = status;
    assert.deepEqual(decide(f), { allowed: false, reason: 'not_ready' });
  });
test('catalogue and foreign deployment cannot invoke', () => {
  for (const change of [
    (f) => {
      f.deployment.kind = 'dedicated-catalog';
    },
    (f) => {
      f.deployment.deploymentInfo.projectId = org;
    },
    (f) => {
      f.deployment.deploymentInfo.region = 'nl-ams';
    },
    (f) => {
      f.project.organizationId = 'bad';
    },
    (f) => {
      delete f.deployment.deploymentInfo;
    },
  ]) {
    const f = fixture();
    change(f);
    assert.equal(decide(f).allowed, false);
  }
});
test('missing or invalid wire model never replaced by catalogue UUID', () => {
  for (const value of [
    undefined,
    '',
    'unsafe model',
    'x\nAuthorization:secret',
  ]) {
    const f = fixture();
    f.deployment.deploymentInfo.modelName = value;
    assert.equal(decide(f).reason, 'invalid_model');
  }
  const f = fixture();
  delete f.deployment.deploymentInfo.modelId;
  assert.equal(decide(f).reason, 'invalid_model');
});
test('expiry is exclusive and approval from future is blocked', () => {
  for (const now of [999, 2000, 3000])
    assert.equal(decide(fixture(), now).reason, 'expired_approval');
  assert.equal(decide(fixture(), 1000).allowed, true);
  for (const value of [NaN, Infinity, 1.1])
    assert.equal(decide(fixture(), value).reason, 'invalid_approval');
  const f = fixture();
  f.approval.expiresAt = f.approval.approvedAt;
  assert.equal(decide(f).reason, 'invalid_approval');
  f.approval = undefined;
  assert.equal(decide(f).reason, 'invalid_approval');
});
test('missing duplicate or removed selected endpoint does not fallback', () => {
  for (const endpoints of [
    undefined,
    [],
    [
      fixture().deployment.deploymentInfo.endpoints[0],
      fixture().deployment.deploymentInfo.endpoints[0],
    ],
  ]) {
    const f = fixture();
    f.deployment.deploymentInfo.endpoints = endpoints;
    assert.equal(decide(f).reason, 'endpoint_unavailable');
  }
});
test('private and ambiguous network require separate unimplemented TLS/network policy', () => {
  for (const network of ['private', undefined, 'unknown']) {
    const f = fixture();
    f.deployment.deploymentInfo.endpoints[0].network = network;
    assert.equal(decide(f).reason, 'private_or_unknown_network');
  }
  const f = fixture();
  f.deployment.deploymentInfo.endpoints[0].privateNetworkId = eid;
  assert.equal(decide(f).reason, 'private_or_unknown_network');
});
test('auth disabled needs explicit consent and yields no credential instruction', () => {
  const f = fixture();
  f.deployment.deploymentInfo.endpoints[0].authentication = 'disabled';
  f.approval.authentication = 'disabled';
  assert.equal(decide(f).reason, 'unauthenticated_not_approved');
  f.approval.allowUnauthenticated = true;
  assert.equal(decide(f).authentication, 'disabled');
  assert.equal(decide(f).allowed, true);
});
for (const url of [
  `http://${did}.ifr.fr-par.scaleway.com`,
  'https://evil.invalid',
  'https://127.0.0.1',
  'https://169.254.169.254',
  'https://[::1]',
  `https://${mid}.ifr.fr-par.scaleway.com`,
  `https://${did}.ifr.fr-par.scaleway.com.evil.invalid`,
  `https://${did}.ifr.fr-par.scaleway.com:8443`,
  `https://user:password@${did}.ifr.fr-par.scaleway.com`,
  `https://${did}.ifr.fr-par.scaleway.com?key=secret`,
  `https://${did}.ifr.fr-par.scaleway.com#`,
  `https://${did}.ifr.fr-par.scaleway.com?`,
  `https://${did}.ifr.fr-par.scaleway.com/other`,
  `https://${did}.ifr.fr-par.scaleway.com/a/../v1`,
  `https://${did}.ifr.fr-par.scaleway.com/%76%31`,
  ` https://${did}.ifr.fr-par.scaleway.com`,
  'not a URL',
])
  test(`unsafe approved URL rejected: ${url}`, () => {
    const f = fixture();
    f.approval.endpointUrl = url;
    f.deployment.deploymentInfo.endpoints[0].url = url;
    assert.equal(decide(f).reason, 'unsafe_endpoint');
  });
