const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const https = require('node:https');
const { test } = require('node:test');
const sdk = require('../dist/scalewaySdk');
const provider = require('../dist/provider');
const user = '11111111-1111-1111-1111-111111111111';
const project = '22222222-2222-2222-2222-222222222222';
const secret = '33333333-3333-3333-3333-333333333333';
const access = 'SCW12345678901234567';
const jwt = 'header.payload.signature';
const signal = () => new AbortController().signal;
function fakeHTTP(t, reply, check) {
  const original = https.request;
  let sends = 0;
  https.request = (options, callback) => {
    sends++;
    const req = new EventEmitter();
    req.destroy = () => {};
    req.end = (body) => {
      check?.(options, body);
      process.nextTick(() => {
        const res = new EventEmitter();
        res.statusCode = reply.status ?? 200;
        res.headers = {
          'content-type': reply.contentType ?? 'application/json',
        };
        res.destroy = () => {};
        callback(res);
        if (res.statusCode >= 200 && res.statusCode <= 204) {
          if (reply.body !== undefined)
            res.emit('data', Buffer.from(reply.body));
          res.emit('end');
        }
      });
    };
    return req;
  };
  t.after(() => {
    https.request = original;
  });
  return () => sends;
}
test('actual CommonJS SDK bridge preserves raw JSON on all dedicated reads, no auto pagination', async () => {
  for (const route of [
    'models',
    'deployments',
    'node-types',
    `deployments/${project}`,
  ]) {
    const path =
      '/inference/v1/regions/fr-par/' +
      route +
      (route.includes('/')
        ? ''
        : route === 'node-types'
          ? '?include_disabled_types=true&page=5&page_size=100'
          : '?organization_id=' +
            user +
            '&project_id=' +
            project +
            '&page=5&page_size=100');
    let sends = 0;
    const raw = {
      models: [{ id: project, status: 'future-status', project_id: user }],
      total_count: 9000,
      custom_field: { retained: true },
    };
    assert.equal(
      await sdk.readDedicatedJSON(path, signal(), async (actual) => {
        sends++;
        const got = new URL(actual, 'https://api.scaleway.com');
        const wanted = new URL(path, got.origin);
        assert.equal(got.pathname, wanted.pathname);
        got.searchParams.sort();
        wanted.searchParams.sort();
        assert.equal(got.href, wanted.href);
        return raw;
      }),
      raw,
    );
    assert.equal(sends, 1);
  }
});
test('dedicated bridge rejects broader routes, write targets and unbounded pages before callback', async () => {
  for (const path of [
    'https://evil.invalid/inference/v1/regions/fr-par/models',
    '/inference/v1/regions/fr-par/models',
    `/inference/v1/regions/fr-par/deployments/${project}/endpoints`,
    '/inference/v1/regions/fr-par/node-types?include_disabled_types=true&page=6&page_size=100',
    `/inference/v1/regions/fr-par/models/${project}/eula`,
  ]) {
    await assert.rejects(
      sdk.readDedicatedJSON(path, signal(), async () =>
        assert.fail('must not send'),
      ),
      { code: 'invalid_request' },
    );
  }
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    sdk.readDedicatedJSON('/bad', controller.signal, async () => assert.fail()),
    { code: 'cancelled' },
  );
});
test('provider uses actual SDK GET, UUID auth, and raw strict parser', async (t) => {
  const raw = { models: [], total_count: 0 };
  const sends = fakeHTTP(t, { body: JSON.stringify(raw) }, (options) => {
    assert.equal(options.method, 'GET');
    assert.equal(options.hostname, 'api.scaleway.com');
    assert.equal(options.headers['X-Auth-Token'], secret);
    assert.equal(options.headers['X-Session-Token'], undefined);
    assert.ok(options.path.includes('page=1'));
  });
  assert.deepEqual(
    await provider.getJSON(
      'control',
      '/inference/v1/regions/fr-par/models?organization_id=' +
        user +
        '&project_id=' +
        project +
        '&page=1&page_size=100',
      secret,
      signal(),
    ),
    raw,
  );
  assert.equal(sends(), 1);
  assert.throws(() => provider.sessionHeaders('api_key'), {
    code: 'invalid_request',
  });
});
test('custom EULA remains raw and public catalog never sends either credential', async (t) => {
  let publicRead = false;
  fakeHTTP(t, { body: '{}' }, (options) => {
    if (publicRead) {
      assert.equal(options.headers['X-Auth-Token'], undefined);
      assert.equal(options.headers['X-Session-Token'], undefined);
    } else assert.ok(options.path.endsWith('/eula'));
  });
  await provider.getJSON(
    'control',
    `/inference/v1/regions/fr-par/models/${project}/eula`,
    secret,
    signal(),
  );
  publicRead = true;
  await provider.getJSON(
    'control',
    '/product-catalog/v2alpha1/public-catalog/products?product_types=generative_apis&region=fr-par&page=1&page_size=100',
    secret,
    signal(),
  );
});
test('IAM generated create uses user JWT and a 30-day key, returns validated secrets only', async (t) => {
  const now = Date.now();
  const expiresAt = now + sdk.API_KEY_LIFETIME_MS - 1000;
  const sends = fakeHTTP(
    t,
    {
      status: 201,
      body: JSON.stringify({
        access_key: access,
        secret_key: secret,
        user_id: user,
        expires_at: new Date(expiresAt).toISOString(),
        description: 'omit',
      }),
    },
    (options, body) => {
      assert.equal(options.method, 'POST');
      assert.equal(options.path, '/iam/v1alpha1/api-keys');
      assert.equal(options.headers['X-Session-Token'], jwt);
      const data = JSON.parse(body);
      assert.equal(data.user_id, user);
      assert.equal(data.description, sdk.API_KEY_DESCRIPTION);
      assert.deepEqual(Object.keys(data).sort(), [
        'description',
        'expires_at',
        'user_id',
      ]);
      assert.ok(Date.parse(data.expires_at) >= now + sdk.API_KEY_LIFETIME_MS);
      assert.ok(
        Date.parse(data.expires_at) <= Date.now() + sdk.API_KEY_LIFETIME_MS,
      );
    },
  );
  assert.deepEqual(await sdk.createUserAPIKey(user, jwt, signal()), {
    accessKey: access,
    secretKey: secret,
    expiresAt,
  });
  assert.equal(sends(), 1);
});
test('IAM revoke is exactly DELETE for the given key with JWT', async (t) => {
  const sends = fakeHTTP(t, { status: 204 }, (options, body) => {
    assert.equal(options.path, `/iam/v1alpha1/api-keys/${access}`);
    assert.equal(options.method, 'DELETE');
    assert.equal(options.headers['X-Session-Token'], jwt);
    assert.equal(body, undefined);
  });
  await sdk.revokeUserAPIKey(access, jwt, signal());
  assert.equal(sends(), 1);
});
test('IAM response errors and incomplete secrets fail sanitized, never echo credentials', async (t) => {
  fakeHTTP(t, { status: 201, body: JSON.stringify({ secret_key: secret }) });
  await assert.rejects(sdk.createUserAPIKey(user, jwt, signal()), (error) => {
    assert.equal(error.message, 'invalid_response');
    assert.ok(!JSON.stringify(error).includes(secret));
    return true;
  });
});
test('IAM transport rejects inference writes, cross-origin, API-key auth and invalid body', async () => {
  for (const [url, method, token, body] of [
    [
      'https://api.scaleway.com/inference/v1/regions/fr-par/deployments',
      'POST',
      jwt,
      '{}',
    ],
    ['https://evil.invalid/iam/v1alpha1/api-keys', 'POST', jwt, '{}'],
    ['https://api.scaleway.com/iam/v1alpha1/api-keys', 'POST', secret, '{}'],
    ['https://api.scaleway.com/iam/v1alpha1/api-keys', 'POST', jwt, '{}'],
    [
      `https://api.scaleway.com/iam/v1alpha1/api-keys/${access}?extra=1`,
      'DELETE',
      jwt,
      undefined,
    ],
  ])
    await assert.rejects(
      sdk.boundedIAMHTTP(url, {
        method,
        body,
        headers: { 'X-Session-Token': token },
      }),
      { code: 'invalid_request' },
    );
  await assert.rejects(sdk.createUserAPIKey('bad', jwt, signal()), {
    code: 'invalid_request',
  });
  await assert.rejects(sdk.revokeUserAPIKey('../bad', jwt, signal()), {
    code: 'invalid_request',
  });
});
test('transport redirects and failures have no retries and retain sanitized errors', async (t) => {
  const sends = fakeHTTP(t, { status: 302, body: secret });
  await assert.rejects(sdk.createUserAPIKey(user, jwt, signal()), {
    code: 'redirect_rejected',
  });
  assert.equal(sends(), 1);
});

test('IAM bounded transport rejects non-objects and scope widening', async () => {
  for (const body of [
    'null',
    '[]',
    '{"user_id":"bad"}',
    JSON.stringify({
      user_id: user,
      description: sdk.API_KEY_DESCRIPTION,
      expires_at: new Date(Date.now() + sdk.API_KEY_LIFETIME_MS).toISOString(),
      application_id: project,
    }),
  ]) {
    await assert.rejects(
      sdk.boundedIAMHTTP('https://api.scaleway.com/iam/v1alpha1/api-keys', {
        method: 'POST',
        headers: { 'X-Session-Token': jwt },
        body,
      }),
      { code: 'invalid_request' },
    );
  }
});
test('bounded IAM rejects malformed JSON, non-JSON and oversized responses', async (t) => {
  for (const reply of [
    { body: '{broken' },
    { body: '{}', contentType: 'text/html' },
    { body: 'x'.repeat(2 * 1024 * 1024 + 1) },
  ]) {
    await t.test('bounded failure', async (sub) => {
      const sends = fakeHTTP(sub, reply);
      await assert.rejects(sdk.createUserAPIKey(user, jwt, signal()), {
        code:
          reply.body.length > 2 * 1024 * 1024
            ? 'response_limit'
            : 'invalid_response',
      });
      assert.equal(sends(), 1);
    });
  }
});
test('raw bridge transport errors are not masked by generated defaults', async () => {
  await assert.rejects(
    sdk.readDedicatedJSON(
      '/inference/v1/regions/fr-par/node-types?include_disabled_types=true&page=1&page_size=100',
      signal(),
      async () => {
        throw new sdk.SDKError('response_limit');
      },
    ),
    { code: 'response_limit' },
  );
});
