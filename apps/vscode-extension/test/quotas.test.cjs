const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  quotaInteger,
  parseQuota,
  listQuotaEvidence,
} = require('../dist/quotas');
const org = '11111111-1111-1111-1111-111111111111';
const token = 'eyJhbGciOiJSUzI1NiJ9.eyJleHAiOjQwMDAwMDAwMDB9.c3ludGhldGlj';
const raw = () => ({
  name: 'synthetic-test-node-limit',
  pretty_name: 'Test node maximum',
  unit: 'node',
  locality_type: 'region',
  limits: [{ region: 'fr-par', limit: 0 }],
});
test('quota exact uint64 and unsafe numeric rejection', () => {
  assert.equal(quotaInteger(0), '0');
  assert.equal(quotaInteger('18446744073709551615'), '18446744073709551615');
  for (const value of [
    9007199254740992,
    '18446744073709551616',
    -1,
    1.5,
    '01',
    '1e3',
    null,
    true,
    ' 1',
  ])
    assert.throws(() => quotaInteger(value), /invalid_quota_integer/);
});
test('zero, unlimited and legacy limits never imply remaining capacity', () => {
  const zero = parseQuota({
    ...raw(),
    usage: 0,
    remaining: 1,
    token: 'discard',
  });
  assert.deepEqual(zero.limits, [
    {
      locality: { kind: 'region', name: 'fr-par' },
      bound: { kind: 'limited', value: '0' },
    },
  ]);
  assert.equal(zero.usage, 'unknown');
  assert.equal(zero.remaining, 'unknown');
  assert.ok(!('token' in zero));
  const unlimited = parseQuota({
    ...raw(),
    locality_type: 'global',
    limits: [{ global: true, unlimited: true }],
  });
  assert.equal(unlimited.limits[0].bound.kind, 'unlimited');
  const legacy = parseQuota({
    name: 'legacy',
    pretty_name: 'Old',
    limit: '18446744073709551615',
  });
  assert.equal(legacy.legacy.value, '18446744073709551615');
  assert.equal(legacy.unit, undefined);
  assert.equal(
    parseQuota({
      ...raw(),
      locality_type: 'zone',
      limits: [{ zone: 'fr-par-1', limit: 12 }],
    }).limits[0].locality.name,
    'fr-par-1',
  );
});
test('ambiguous bounds and localities fail closed', () => {
  for (const bad of [
    { ...raw(), limits: [{ region: 'fr-par', limit: 1, unlimited: true }] },
    { ...raw(), limits: [{ global: false, limit: 1 }] },
    { ...raw(), limits: [{ region: 'fr-par', zone: 'fr-par-1', limit: 1 }] },
    { ...raw(), limits: [{ region: 'fr-par', unlimited: false }] },
    { ...raw(), limits: [{ region: 'fr-par-1', limit: 1 }] },
    {
      ...raw(),
      limits: [
        { region: 'fr-par', limit: 1 },
        { region: 'fr-par', limit: 2 },
      ],
    },
    { ...raw(), limits: [] },
    { ...raw(), limit: 1, unlimited: true },
    { ...raw(), locality_type: 'unknown' },
  ])
    assert.throws(() => parseQuota(bad));
});
test('quota fixed organization path and five-page bounds', async () => {
  let sends = 0;
  const snapshot = await listQuotaEvidence(
    org,
    token,
    new AbortController().signal,
    async (origin, path, key) => {
      sends++;
      assert.equal(origin, 'control');
      assert.equal(key, token);
      assert.equal(
        path,
        [
          '/iam/v1alpha1/quota?organization_id=',
          org,
          '&order_by=name_asc&page=1&page_size=100',
        ].join(''),
      );
      return { quota: [raw()], total_count: 1 };
    },
    new Date('2026-10-21T05:35:00Z'),
  );
  assert.equal(sends, 1);
  assert.equal(snapshot.createRights, 'unverified');
  assert.equal(snapshot.dedicatedNodeMapping, 'unverified');
  await assert.rejects(
    listQuotaEvidence(org, token, new AbortController().signal, async () => ({
      quota: [raw()],
      total_count: 2,
    })),
    /incomplete_page/,
  );
  await assert.rejects(
    listQuotaEvidence(org, token, new AbortController().signal, async () => ({
      quota: [raw(), raw()],
      total_count: 2,
    })),
    /duplicate_quota_name/,
  );
  sends = 0;
  await assert.rejects(
    listQuotaEvidence(org, token, new AbortController().signal, async () => {
      const n = sends++;
      return {
        quota: Array.from({ length: 100 }, (_, i) => ({
          ...raw(),
          name: ['n', n * 100 + i].join(''),
        })),
        total_count: 501,
      };
    }),
    /page_limit/,
  );
  assert.equal(sends, 5);
});
test('quota HTTPS header and allowlist reject broadened route', async () => {
  const https = require('node:https');
  const { EventEmitter } = require('node:events');
  const { getJSON } = require('../dist/provider');
  const original = https.request;
  let sends = 0;
  try {
    https.request = (options, receive) => {
      sends++;
      assert.equal(options.hostname, 'api.scaleway.com');
      assert.equal(options.headers['X-Session-Token'], token);
      assert.equal(options.headers.Authorization, undefined);
      const req = new EventEmitter();
      req.destroy = () => {};
      req.end = () =>
        queueMicrotask(() => {
          const res = new EventEmitter();
          res.statusCode = 200;
          res.headers = { 'content-type': 'application/json' };
          res.destroy = () => {};
          receive(res);
          res.emit(
            'data',
            Buffer.from(JSON.stringify({ quota: [], total_count: 0 })),
          );
          res.emit('end');
        });
      return req;
    };
    const path = [
      '/iam/v1alpha1/quota?organization_id=',
      org,
      '&order_by=name_asc&page=1&page_size=100',
    ].join('');
    await getJSON('control', path, token, new AbortController().signal);
    for (const bad of [
      [path, '&quotum_names=guessed'].join(''),
      path.replace('name_asc', 'name_desc'),
      path.replace('page=1', 'page=6'),
    ])
      await assert.rejects(
        getJSON('control', bad, token, new AbortController().signal),
        /invalid_request/,
      );
    assert.equal(sends, 1);
  } finally {
    https.request = original;
  }
});
