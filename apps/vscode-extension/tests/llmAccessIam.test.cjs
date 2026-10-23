const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { readFileSync } = require('node:fs');
const https = require('node:https');
const Module = require('node:module');
const path = require('node:path');
const { test } = require('node:test');

// Bundle the exact standalone candidate with its installed official SDK in memory.
// No dist/build outputs or package installation; private test hooks are appended
// only to this in-memory candidate, never exported from production source.
const extension = path.resolve(__dirname, '..');
const filename = path.join(extension, 'src/llmAccessIam.ts');
const source = readFileSync(filename, 'utf8');
const esbuild = require(path.join(extension, 'node_modules/esbuild'));
const compiled = esbuild.buildSync({
  stdin: {
    contents: `${source.replace('    return raw;', '    __rawResponses.push(raw); return raw;')}\nconst __rawResponses = [];\nexport const __test = { boundedHTTP, sdkRaw, scrub, rawResponses: __rawResponses };`,
    sourcefile: filename,
    resolveDir: path.dirname(filename),
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  write: false,
}).outputFiles[0].text;
const candidate = new Module(filename, module);
candidate.filename = filename;
candidate.paths = Module._nodeModulePaths(extension);
candidate._compile(compiled, filename);
const iam = candidate.exports;
const org = '11111111-1111-1111-1111-111111111111';
const user = '22222222-2222-2222-2222-222222222222';
const app = '44444444-4444-4444-4444-444444444444';
const otherOrg = '55555555-5555-5555-5555-555555555555';
const secret = '33333333-3333-3333-3333-333333333333';
const access = 'SCW12345678901234567';
const jwt = 'header.payload.signature';
const signal = () => new AbortController().signal;
const apiKey = (overrides = {}) => ({
  access_key: access,
  user_id: user,
  description: 'VS Code access',
  expires_at: null,
  ...overrides,
});
const application = (n, overrides = {}) => ({
  id: `${String(n).padStart(8, '0')}-aaaa-bbbb-cccc-111111111111`,
  organization_id: org,
  name: `Application ${n}`,
  ...overrides,
});
function mockHTTP(t, responder, check = () => {}) {
  const original = https.request;
  const sent = [];
  const requests = [];
  const responses = [];
  https.request = (options, callback) => {
    sent.push(options);
    const req = new EventEmitter();
    requests.push(req);
    req.destroyed = false;
    req.destroy = () => {
      req.destroyed = true;
    };
    req.end = (body) => {
      check(options, body, sent.length);
      const reply = responder(options, body, sent.length);
      if (reply?.hang) return;
      process.nextTick(() => {
        if (reply?.requestError) {
          req.emit('error', new Error(secret));
          return;
        }
        const res = new EventEmitter();
        responses.push(res);
        res.statusCode = reply?.status ?? 200;
        res.headers = { 'content-type': 'application/json', ...reply?.headers };
        res.complete = reply?.complete ?? true;
        res.destroyed = false;
        res.destroy = () => {
          res.destroyed = true;
        };
        callback(res);
        if (res.destroyed) return;
        const wire = reply?.wire ?? JSON.stringify(reply?.json);
        if (wire !== undefined) res.emit('data', Buffer.from(wire));
        if (reply?.event) res.emit(reply.event, new Error(secret));
        else res.emit('end');
      });
    };
    return req;
  };
  t.after(() => {
    https.request = original;
  });
  return { sent, requests, responses };
}
function checkAuth(options, credential) {
  assert.equal(options.hostname, 'api.scaleway.com');
  assert.equal(options.protocol, 'https:');
  assert.equal(options.port, 443);
  assert.equal(options.agent, false);
  assert.equal(options.rejectUnauthorized, true);
  assert.deepEqual(options.headers, {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(credential === jwt
      ? { 'X-Session-Token': credential }
      : { 'X-Auth-Token': credential }),
  });
}
function checkQuery(options, route, expected) {
  const u = new URL(options.path, 'https://api.scaleway.com');
  assert.equal(u.pathname, `/iam/v1alpha1/${route}`);
  assert.deepEqual(Object.fromEntries(u.searchParams), expected);
  assert.equal(u.searchParams.size, Object.keys(expected).length);
}
async function rejectsSafe(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof iam.IAMAccessError);
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    assert.equal(error.cause, undefined);
    assert.ok(!JSON.stringify(error).includes(secret));
    assert.ok(!error.stack.includes(secret));
    return true;
  });
}

const inventoryKey = (n, overrides = {}) =>
  apiKey({ access_key: `SCW${String(n).padStart(17, '0')}`, ...overrides });

test('inventory uses installed SDK org-only GET with JWT and key; expired/null and safe fields', async (t) => {
  for (const credential of [jwt, secret]) {
    const createdAt = '2020-01-01T00:00:00Z';
    const expiredAt = '2000-01-01T00:00:00Z';
    const futureAt = '2099-01-01T00:00:00.123Z';
    iam.__test.rawResponses.length = 0;
    const fixture = mockHTTP(
      t,
      () => ({
        json: {
          api_keys: [
            inventoryKey(1, {
              expires_at: expiredAt,
              created_at: createdAt,
              secret_key: secret,
              creation_ip: 'private-ip',
              nested: { secret_key: secret },
            }),
            inventoryKey(2, { user_id: null, application_id: app }),
            inventoryKey(3, { expires_at: futureAt, description: '' }),
          ],
          total_count: 3,
        },
      }),
      (options, body) => {
        checkAuth(options, credential);
        assert.equal(options.method, 'GET');
        assert.equal(body, undefined);
        checkQuery(options, 'api-keys', {
          organization_id: org,
          page: '1',
          page_size: '100',
        });
      },
    );
    const result = await iam.listAccessAPIKeys(org, credential, signal());
    assert.deepEqual(result, [
      {
        accessKey: inventoryKey(1).access_key,
        bearer: { type: 'user', id: user },
        expiresAt: Date.parse(expiredAt),
        organizationId: org,
        description: 'VS Code access',
        createdAt,
      },
      {
        accessKey: inventoryKey(2).access_key,
        bearer: { type: 'application', id: app },
        expiresAt: Number.MAX_SAFE_INTEGER,
        organizationId: org,
        description: 'VS Code access',
      },
      {
        accessKey: inventoryKey(3).access_key,
        bearer: { type: 'user', id: user },
        expiresAt: Date.parse(futureAt),
        organizationId: org,
        description: '',
      },
    ]);
    assert.ok(!JSON.stringify(result).includes(secret));
    assert.ok(!JSON.stringify(result).includes('private-ip'));
    assert.equal(iam.__test.rawResponses[0].api_keys[0].secret_key, undefined);
    assert.equal(
      iam.__test.rawResponses[0].api_keys[0].nested.secret_key,
      undefined,
    );
    assert.equal(fixture.sent.length, 1);
  }
});

// Synthetic SDK-contract fixtures, not a captured account response.
test('inventory accepts SDK nullable creation and micro/nanosecond timestamps', async (t) => {
  for (const fraction of ['1', '123', '123456', '123456789']) {
    const at = '2026-10-23T17:34:00.' + fraction + 'Z';
    const fixture = mockHTTP(t, () => ({
      json: {
        api_keys: [
          inventoryKey(1, {
            created_at: null,
            managed: true,
            expires_at: null,
          }),
          inventoryKey(2, {
            created_at: at,
            expires_at: at,
            user_id: '',
            application_id: app,
            managed: true,
          }),
        ],
        total_count: 2,
      },
    }));
    const rows = await iam.listAccessAPIKeys(org, jwt, signal());
    assert.equal(rows.length, 2);
    assert.equal(rows[0].createdAt, undefined);
    assert.equal(rows[0].expiresAt, Number.MAX_SAFE_INTEGER);
    assert.equal(rows[1].createdAt, at);
    assert.equal(rows[1].expiresAt, Date.parse(at));
    assert.deepEqual(rows[1].bearer, { type: 'application', id: app });
    assert.equal(rows[0].managed, undefined);
    assert.equal(fixture.sent.length, 1);
    await iam.__test.sdkRaw(
      {
        method: 'GET',
        path:
          '/iam/v1alpha1/api-keys?organization_id=' +
          org +
          '&page=1&page_size=100',
      },
      jwt,
      false,
      signal(),
      async (api) => {
        const normalized = await api.listAPIKeys({
          organizationId: org,
          page: 1,
          pageSize: 100,
        });
        assert.equal(normalized.apiKeys[0].createdAt, null);
        assert.equal(normalized.apiKeys[1].createdAt.getTime(), Date.parse(at));
        assert.equal(normalized.apiKeys[1].expiresAt.getTime(), Date.parse(at));
      },
    );
  }
});

test('inventory completes at most five sequential pages of 100 including empty and partial last page', async (t) => {
  for (const total of [0, 101, 500]) {
    let previous;
    const fixture = mockHTTP(
      t,
      (_o, _b, page) => ({
        json: {
          api_keys: Array.from(
            { length: Math.min(100, total - (page - 1) * 100) },
            (_, i) => inventoryKey((page - 1) * 100 + i + 1),
          ),
          total_count: total,
        },
      }),
      (options, body, page) => {
        if (previous) assert.ok(previous.destroyed);
        previous = fixture.requests[page - 1];
        assert.equal(body, undefined);
        checkQuery(options, 'api-keys', {
          organization_id: org,
          page: String(page),
          page_size: '100',
        });
      },
    );
    assert.equal(
      (await iam.listAccessAPIKeys(org, jwt, signal())).length,
      total,
    );
    assert.equal(fixture.sent.length, Math.max(1, Math.ceil(total / 100)));
  }
});

test('inventory rejects duplicates, stale totals, incomplete and excessive pagination without partial results', async (t) => {
  for (const mode of [
    'changing',
    'missing',
    'duplicate',
    'excessive',
    'same-page',
  ]) {
    iam.__test.rawResponses.length = 0;
    const fixture = mockHTTP(t, (_o, _b, page) => ({
      json: {
        api_keys:
          mode === 'excessive'
            ? []
            : mode === 'same-page'
              ? [inventoryKey(1), inventoryKey(1)]
              : page === 1
                ? Array.from({ length: 100 }, (_, i) => inventoryKey(i + 1))
                : mode === 'missing'
                  ? []
                  : [inventoryKey(mode === 'duplicate' ? 1 : 101)],
        total_count:
          mode === 'excessive'
            ? 501
            : mode === 'same-page'
              ? 2
              : mode === 'changing' && page === 2
                ? 100
                : 101,
        secret_key: secret,
      },
    }));
    await rejectsSafe(
      iam.listAccessAPIKeys(org, jwt, signal()),
      mode === 'excessive' ? 'pagination_limit' : 'invalid_response',
    );
    assert.equal(
      fixture.sent.length,
      ['excessive', 'same-page'].includes(mode) ? 1 : 2,
    );
    assert.ok(iam.__test.rawResponses.every((r) => r.secret_key === undefined));
  }
});

test('inventory validates raw shapes, strict bearer, description, timestamps and scope; scrubs failed rows', async (t) => {
  const cases = [
    {},
    { api_keys: [], total_count: '0' },
    { api_keys: [], total_count: -1 },
    { api_keys: [], total_count: 1.1 },
    { api_keys: [], total_count: 1 },
    { api_keys: [inventoryKey(1)], total_count: 0 },
    { api_keys: [null], total_count: 1 },
    {
      api_keys: Array.from({ length: 101 }, (_, i) => inventoryKey(i)),
      total_count: 101,
    },
    ...[
      { access_key: undefined },
      { access_key: 'bad' },
      { user_id: undefined },
      { application_id: app },
      { application_id: 'bad' },
      { user_id: 'bad' },
      { description: undefined },
      { description: 1 },
      { description: 'bad\n' },
      { description: 'x'.repeat(201) },
      { organization_id: otherOrg },
      { expires_at: undefined },
      { expires_at: 123 },
      { expires_at: 'tomorrow' },
      { expires_at: '2099-02-30T00:00:00Z' },
      { expires_at: '2099-01-01T00:00:00+00:00' },
      { created_at: '2020-01-01T00:00:00.1234567890Z' },
      { expires_at: '2099-01-01T00:00:00.1234567890Z' },
      { user_id: null, application_id: null, managed: true },
      { created_at: 123 },
      { created_at: '2020-01-01T00:00:00.1234567890Z' },
      { expires_at: '2099-01-01T00:00:00.1234567890Z' },
      { user_id: null, application_id: null, managed: true },
      { created_at: 'bad' },
      { created_at: '2020-02-30T00:00:00Z' },
    ].map((change) => ({
      api_keys: [inventoryKey(1, change)],
      total_count: 1,
    })),
  ];
  for (const json of cases) {
    iam.__test.rawResponses.length = 0;
    mockHTTP(t, () => ({
      json: { ...json, secret_key: secret, nested: { secret_key: secret } },
    }));
    await rejectsSafe(
      iam.listAccessAPIKeys(org, jwt, signal()),
      'invalid_response',
    );
    assert.equal(iam.__test.rawResponses[0].secret_key, undefined);
    assert.equal(iam.__test.rawResponses[0].nested.secret_key, undefined);
  }
});

test('inventory auth failures and cancellation are safe for both credential types; invalid inputs send nothing', async (t) => {
  for (const credential of [jwt, secret]) {
    for (const status of [401, 403]) {
      const fixture = mockHTTP(
        t,
        () => ({ status, wire: secret }),
        (options) => checkAuth(options, credential),
      );
      await rejectsSafe(
        iam.listAccessAPIKeys(org, credential, signal()),
        'access_denied',
      );
      assert.equal(fixture.sent.length, 1);
    }
    const c = new AbortController();
    const fixture = mockHTTP(t, () => ({ hang: true }));
    const promise = iam.listAccessAPIKeys(org, credential, c.signal);
    await new Promise((resolve) => setImmediate(resolve));
    c.abort();
    await rejectsSafe(promise, 'cancelled');
    assert.ok(fixture.requests[0].destroyed);
  }
  const fixture = mockHTTP(t, () => assert.fail('must not send'));
  for (const credential of ['', 'bad', `${jwt}\r\nX-Evil: x`])
    await rejectsSafe(
      iam.listAccessAPIKeys(org, credential, signal()),
      'invalid_api_key',
    );
  await rejectsSafe(
    iam.listAccessAPIKeys('bad', jwt, signal()),
    'invalid_request',
  );
  await rejectsSafe(iam.listAccessAPIKeys(org, jwt, null), 'invalid_request');
  const c = new AbortController();
  c.abort();
  await rejectsSafe(iam.listAccessAPIKeys(org, jwt, c.signal), 'cancelled');
  assert.equal(fixture.sent.length, 0);
});

test('installed SDK lists only organization-scoped applications with both credential types', async (t) => {
  for (const credential of [jwt, secret]) {
    const fixture = mockHTTP(
      t,
      () => ({ json: { applications: [application(1)], total_count: 1 } }),
      (options) => {
        checkAuth(options, credential);
        assert.equal(options.method, 'GET');
        checkQuery(options, 'applications', {
          organization_id: org,
          page: '1',
          page_size: '100',
        });
      },
    );
    assert.deepEqual(
      await iam.listAccessApplications(org, credential, signal()),
      [{ id: application(1).id, name: 'Application 1' }],
    );
    assert.equal(fixture.sent.length, 1);
  }
});

test('five pages of 100 are explicit, complete, and not SDK auto pagination', async (t) => {
  const fixture = mockHTTP(
    t,
    (_options, _body, page) => ({
      json: {
        applications: Array.from({ length: 100 }, (_, i) =>
          application((page - 1) * 100 + i + 1),
        ),
        total_count: 500,
      },
    }),
    (options, body, page) => {
      assert.equal(body, undefined);
      checkQuery(options, 'applications', {
        organization_id: org,
        page: String(page),
        page_size: '100',
      });
    },
  );
  assert.equal(
    (await iam.listAccessApplications(org, jwt, signal())).length,
    500,
  );
  assert.equal(fixture.sent.length, 5);
});

test('application raw defaults, foreign scopes and malformed text fail closed', async (t) => {
  const cases = [
    {},
    { applications: [], total_count: '0' },
    { applications: [], total_count: -1 },
    { applications: [], total_count: 1.1 },
    { applications: [], total_count: 1 },
    { applications: [application(1)], total_count: 0 },
    ...[
      { organization_id: otherOrg },
      { organization_id: undefined },
      { id: 'not-uuid' },
      { name: '' },
      { name: 'bad\nname' },
      { name: 'x'.repeat(65) },
      { name: undefined },
    ].map((change) => ({
      applications: [application(1, change)],
      total_count: 1,
    })),
    { applications: [application(1), application(1)], total_count: 2 },
    {
      applications: Array.from({ length: 101 }, (_, i) => application(i)),
      total_count: 101,
    },
  ];
  for (const json of cases) {
    mockHTTP(t, () => ({ json }));
    await rejectsSafe(
      iam.listAccessApplications(org, jwt, signal()),
      'invalid_response',
    );
  }
});

test('excessive, changing, incomplete and duplicate pagination never returns partial data', async (t) => {
  mockHTTP(t, () => ({ json: { applications: [], total_count: 501 } }));
  await rejectsSafe(
    iam.listAccessApplications(org, jwt, signal()),
    'pagination_limit',
  );
  for (const mode of ['changing', 'missing', 'duplicate']) {
    const fixture = mockHTTP(t, (_o, _b, page) => ({
      json: {
        total_count: mode === 'changing' && page === 2 ? 100 : 101,
        applications:
          page === 1
            ? Array.from({ length: 100 }, (_, i) => application(i + 1))
            : mode === 'missing'
              ? []
              : [application(mode === 'duplicate' ? 1 : 101)],
      },
    }));
    await rejectsSafe(
      iam.listAccessApplications(org, jwt, signal()),
      'invalid_response',
    );
    assert.equal(fixture.sent.length, 2);
  }
});

test('create uses official bearer one-of, exact description/expiry, no project/org/model/grants', async (t) => {
  for (const type of ['user', 'application']) {
    for (const lifetime of [
      3600000,
      7 * 86400000,
      30 * 86400000,
      365 * 86400000,
    ]) {
      let requested;
      const before = Date.now();
      const credential = type === 'user' ? jwt : secret;
      const bearer = { type, id: type === 'user' ? user : app };
      const fixture = mockHTTP(
        t,
        (_options, body) => {
          requested = JSON.parse(body);
          return {
            status: 201,
            json: apiKey({
              user_id: undefined,
              ...requested,
              secret_key: secret,
            }),
          };
        },
        (options, body) => {
          checkAuth(options, credential);
          assert.equal(options.method, 'POST');
          assert.equal(options.path, '/iam/v1alpha1/api-keys');
          const r = JSON.parse(body);
          assert.deepEqual(
            Object.keys(r).sort(),
            ['description', 'expires_at', `${type}_id`].sort(),
          );
          assert.equal(r[`${type}_id`], bearer.id);
          assert.equal(r.description, 'VS Code access');
          assert.ok(Date.parse(r.expires_at) >= before + lifetime);
          assert.ok(Date.parse(r.expires_at) <= Date.now() + lifetime);
        },
      );
      assert.deepEqual(
        await iam.createAccessAPIKey(
          org,
          bearer,
          credential,
          'VS Code access',
          lifetime,
          signal(),
        ),
        {
          accessKey: access,
          secretKey: secret,
          expiresAt: Date.parse(requested.expires_at),
        },
      );
      assert.equal(fixture.sent.length, 1);
    }
  }
});

test('bad inputs and unapproved lifetime formats send nothing', async (t) => {
  const fixture = mockHTTP(t, () => assert.fail('must not send'));
  for (const args of [
    ['bad', { type: 'user', id: user }, jwt, 'd', 3600000],
    [org, { type: 'user', id: 'bad' }, jwt, 'd', 3600000],
    [org, { type: 'robot', id: user }, jwt, 'd', 3600000],
    [org, { type: 'user', id: user, applicationId: app }, jwt, 'd', 3600000],
    [org, { type: 'user', id: user }, jwt, 'x'.repeat(201), 3600000],
    [org, { type: 'user', id: user }, jwt, 'bad\rdescription', 3600000],
    ...[0, -1, 1, 3600001, Infinity, NaN, '3600000'].map((ms) => [
      org,
      { type: 'user', id: user },
      jwt,
      'd',
      ms,
    ]),
  ])
    await rejectsSafe(
      iam.createAccessAPIKey(...args, signal()),
      'invalid_request',
    );
  for (const credential of [
    '',
    'bad',
    `${jwt}\r\nX-Evil: x`,
    `${'a'.repeat(16385)}.b.c`,
  ]) {
    await rejectsSafe(
      iam.listAccessApplications(org, credential, signal()),
      'invalid_api_key',
    );
  }
  await rejectsSafe(
    iam.inspectAccessAPIKey(org, '../key', secret, signal()),
    'invalid_api_key',
  );
  await rejectsSafe(
    iam.inspectAccessAPIKey(org, access, jwt, signal()),
    'invalid_api_key',
  );
  const c = new AbortController();
  c.abort();
  await rejectsSafe(
    iam.listAccessApplications(org, jwt, c.signal),
    'cancelled',
  );
  assert.equal(fixture.sent.length, 0);
});

test('inspection authenticates exact key and proves organization via plural access_keys filter', async (t) => {
  for (const type of ['user', 'application']) {
    const bearer = { type, id: type === 'user' ? user : app };
    const json = apiKey({
      user_id: undefined,
      [`${type}_id`]: bearer.id,
      secret_key: 'never-return-this',
    });
    const fixture = mockHTTP(
      t,
      (_o, _b, count) => ({
        json: count === 1 ? json : { api_keys: [json], total_count: 1 },
      }),
      (options, body, count) => {
        checkAuth(options, secret);
        assert.equal(options.method, 'GET');
        assert.equal(body, undefined);
        if (count === 1)
          assert.equal(options.path, `/iam/v1alpha1/api-keys/${access}`);
        else
          checkQuery(options, 'api-keys', {
            organization_id: org,
            page: '1',
            page_size: '100',
            access_keys: access,
          });
      },
    );
    const result = await iam.inspectAccessAPIKey(org, access, secret, signal());
    assert.deepEqual(result, {
      accessKey: access,
      bearer,
      description: 'VS Code access',
      expiresAt: Number.MAX_SAFE_INTEGER,
      organizationId: org,
    });
    assert.ok(!JSON.stringify(result).includes('never-return-this'));
    assert.equal(fixture.sent.length, 2);
  }
});

test('inspection requires strict raw bearer, key, explicit expiry and description', async (t) => {
  for (const overrides of [
    { access_key: 'SCW00000000000000000' },
    { access_key: undefined },
    { user_id: undefined },
    { application_id: app },
    { application_id: 'bad' },
    { user_id: 'bad' },
    { expires_at: undefined },
    { expires_at: 'tomorrow' },
    { expires_at: 123 },
    { expires_at: '2099-02-30T00:00:00Z' },
    { description: undefined },
    { description: 1 },
    { description: 'secret\n' },
    { organization_id: otherOrg },
  ]) {
    const fixture = mockHTTP(t, () => ({ json: apiKey(overrides) }));
    await rejectsSafe(
      iam.inspectAccessAPIKey(org, access, secret, signal()),
      'invalid_response',
    );
    assert.equal(fixture.sent.length, 1);
  }
  mockHTTP(t, () => ({ json: apiKey({ expires_at: '2000-01-01T00:00:00Z' }) }));
  await rejectsSafe(
    iam.inspectAccessAPIKey(org, access, secret, signal()),
    'expired',
  );
});

test('membership absence, foreign/extra key, mismatched metadata and SDK defaults fail closed', async (t) => {
  for (const [listed, code] of [
    [{ api_keys: [], total_count: 0 }, 'access_denied'],
    [{}, 'invalid_response'],
    [{ api_keys: [apiKey()], total_count: '1' }, 'invalid_response'],
    [{ api_keys: [apiKey()], total_count: 2 }, 'invalid_response'],
    [{ api_keys: [apiKey(), apiKey()], total_count: 2 }, 'invalid_response'],
    ...[
      { access_key: 'SCW00000000000000000' },
      { organization_id: otherOrg },
      { user_id: app },
      { description: 'different' },
      { expires_at: '2099-01-01T00:00:00Z' },
    ].map((change) => [
      { api_keys: [apiKey(change)], total_count: 1 },
      'invalid_response',
    ]),
  ]) {
    const fixture = mockHTTP(t, (_o, _b, count) => ({
      json: count === 1 ? apiKey() : listed,
    }));
    await rejectsSafe(
      iam.inspectAccessAPIKey(org, access, secret, signal()),
      code,
    );
    assert.equal(fixture.sent.length, 2);
  }
});

test('future finite expiration accepted; null alone represents unlimited', async (t) => {
  const expiresAt = Date.now() + 86400000;
  const json = apiKey({ expires_at: new Date(expiresAt).toISOString() });
  mockHTTP(t, (_o, _b, count) => ({
    json: count === 1 ? json : { api_keys: [json], total_count: 1 },
  }));
  assert.equal(
    (await iam.inspectAccessAPIKey(org, access, secret, signal())).expiresAt,
    expiresAt,
  );
});

test('creation response must match bearer, description, expiration and valid secret exactly', async (t) => {
  for (const overrides of [
    { secret_key: undefined },
    { secret_key: jwt },
    { access_key: 'bad' },
    { user_id: app },
    { application_id: app },
    { expires_at: null },
    { expires_at: '2099-01-01T00:00:00Z' },
    { description: 'wrong' },
    { organization_id: otherOrg },
  ]) {
    const fixture = mockHTTP(t, (_o, body) => ({
      json: apiKey({ ...JSON.parse(body), secret_key: secret, ...overrides }),
    }));
    await rejectsSafe(
      iam.createAccessAPIKey(
        org,
        { type: 'user', id: user },
        jwt,
        'VS Code access',
        3600000,
        signal(),
      ),
      'invalid_response',
    );
    assert.equal(fixture.sent.length, 1);
  }
});

test('HTTP errors never expose body, redirect or retry; inspection 401 is invalid_api_key', async (t) => {
  for (const [status, code] of [
    [301, 'redirect_rejected'],
    [307, 'redirect_rejected'],
    [401, 'access_denied'],
    [403, 'access_denied'],
    [429, 'rate_limited'],
    [500, 'http_error'],
  ]) {
    const fixture = mockHTTP(t, () => ({
      status,
      wire: secret,
      headers: { location: 'https://evil.invalid' },
    }));
    await rejectsSafe(iam.listAccessApplications(org, jwt, signal()), code);
    assert.equal(fixture.sent.length, 1);
    assert.ok(fixture.requests.every((r) => r.destroyed));
  }
  mockHTTP(t, () => ({ status: 401, wire: secret }));
  await rejectsSafe(
    iam.inspectAccessAPIKey(org, access, secret, signal()),
    'invalid_api_key',
  );
});

test('POST transport failures are not retried and do not add pending/outcome semantics', async (t) => {
  const fixture = mockHTTP(t, () => ({ requestError: true }));
  await rejectsSafe(
    iam.createAccessAPIKey(
      org,
      { type: 'application', id: app },
      jwt,
      'd',
      3600000,
      signal(),
    ),
    'transport_error',
  );
  assert.equal(fixture.sent.length, 1);
});

test('bounded JSON response rejects media types, encodings, size, UTF8, truncation and malformed data', async (t) => {
  for (const [reply, code] of [
    [
      { wire: secret, headers: { 'content-type': 'text/html' } },
      'invalid_response',
    ],
    [
      { wire: '{}', headers: { 'content-type': 'application/json-evil' } },
      'invalid_response',
    ],
    [
      { wire: '{}', headers: { 'content-encoding': 'gzip' } },
      'invalid_response',
    ],
    [{ wire: '{}', headers: { 'content-length': 'NaN' } }, 'invalid_response'],
    [{ wire: '{}', headers: { 'content-length': '3' } }, 'truncated_response'],
    [{ wire: '{}', complete: false }, 'truncated_response'],
    [{ wire: '{}', event: 'aborted' }, 'truncated_response'],
    [{ wire: '{}', event: 'close' }, 'truncated_response'],
    [{ wire: '{}', event: 'error' }, 'transport_error'],
    [{ wire: `{"secret_key":"${secret}"` }, 'invalid_response'],
    [{ wire: Buffer.from([0xff]) }, 'invalid_response'],
    [{ wire: ' '.repeat(2 * 1024 * 1024 + 1) }, 'response_limit'],
    [
      {
        wire: '{}',
        headers: { 'content-length': String(2 * 1024 * 1024 + 1) },
      },
      'response_limit',
    ],
  ]) {
    const fixture = mockHTTP(t, () => reply);
    await rejectsSafe(iam.listAccessApplications(org, jwt, signal()), code);
    assert.equal(fixture.sent.length, 1);
    assert.ok(fixture.requests.every((r) => r.destroyed));
    assert.ok(fixture.responses.every((r) => r.destroyed));
  }
});

test('in-flight abort and absolute 10-second timeout destroy request', async (t) => {
  const c = new AbortController();
  const fixture = mockHTTP(t, () => ({ hang: true }));
  const promise = iam.listAccessApplications(org, jwt, c.signal);
  await new Promise((resolve) => setImmediate(resolve));
  c.abort();
  await rejectsSafe(promise, 'cancelled');
  assert.ok(fixture.requests[0].destroyed);
  const original = global.setTimeout;
  const durations = [];
  global.setTimeout = (fn, ms, ...args) => {
    durations.push(ms);
    return original(fn, ms === 10000 ? 1 : ms, ...args);
  };
  try {
    await rejectsSafe(
      iam.listAccessApplications(org, jwt, signal()),
      'timeout',
    );
    assert.ok(durations.includes(10000));
    assert.ok(fixture.requests[1].destroyed);
  } finally {
    global.setTimeout = original;
  }
});

test('independent private transport rejects unsafe URL/routes/query/body before HTTPS', async (t) => {
  const fixture = mockHTTP(t, () => assert.fail('must not send'));
  for (const url of [
    'http://api.scaleway.com/iam/v1alpha1/applications',
    'https://evil.invalid/iam/v1alpha1/applications',
    'https://u:p@api.scaleway.com/iam/v1alpha1/applications',
    'https://api.scaleway.com/iam/v1alpha1/applications#x',
    'https://api.scaleway.com/iam/v1alpha1/policies',
    'https://api.scaleway.com/iam/v1alpha1/applications',
    ...['page=6', 'page=1&page=2', 'page=1&editable=true', 'page=0'].map(
      (query) =>
        'https://api.scaleway.com/iam/v1alpha1/applications?organization_id=' +
        org +
        '&page_size=100&' +
        query,
    ),
  ]) {
    const request = url.includes('u:p@')
      ? { url, method: 'GET' }
      : new Request(url);
    await rejectsSafe(
      iam.__test.boundedHTTP(
        request,
        { method: 'GET', path: url },
        jwt,
        false,
        signal(),
      ),
      'invalid_request',
    );
  }
  for (const body of [
    '{}',
    JSON.stringify({
      user_id: user,
      application_id: app,
      description: 'd',
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    }),
    JSON.stringify({
      user_id: user,
      default_project_id: org,
      description: 'd',
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    }),
    JSON.stringify({
      user_id: user,
      description: 'd',
      expires_at: new Date(Date.now() + 5000).toISOString(),
    }),
    'x'.repeat(4097),
  ]) {
    const url = 'https://api.scaleway.com/iam/v1alpha1/api-keys';
    await rejectsSafe(
      iam.__test.boundedHTTP(
        new Request(url, { method: 'POST', body }),
        { method: 'POST', path: url, body },
        jwt,
        false,
        signal(),
      ),
      'invalid_request',
    );
  }
  assert.equal(fixture.sent.length, 0);
});

test('raw secrets never enter SDK response and are scrubbed on cancelled response', async (t) => {
  const c = new AbortController();
  mockHTTP(t, () => ({
    json: apiKey({ secret_key: secret, nested: { secret_key: secret } }),
  }));
  const captured = await iam.__test.sdkRaw(
    { method: 'GET', path: `/iam/v1alpha1/api-keys/${access}` },
    secret,
    true,
    c.signal,
    async (api) => {
      const normalized = await api.getAPIKey(
        { accessKey: access },
        { signal: c.signal },
      );
      assert.equal(normalized.secretKey, undefined);
    },
  );
  assert.equal(captured.secret_key, secret);
  // The internal raw result is intentionally preserved for create; public methods scrub it.
  iam.__test.scrub(captured);
  assert.equal(captured.secret_key, undefined);
  assert.equal(captured.nested.secret_key, undefined);
  const deep = { secret_key: secret };
  let current = deep;
  for (let i = 0; i < 12000; i++) {
    current.next = { secret_key: secret };
    current = current.next;
  }
  iam.__test.scrub(deep);
  assert.equal(deep.secret_key, undefined);
  assert.equal(current.secret_key, undefined);
  const d = new AbortController();
  await rejectsSafe(
    iam.__test.sdkRaw(
      { method: 'GET', path: `/iam/v1alpha1/api-keys/${access}` },
      secret,
      true,
      d.signal,
      async (api) => {
        await api.getAPIKey({ accessKey: access }, { signal: d.signal });
        d.abort();
      },
    ),
    'cancelled',
  );
});
