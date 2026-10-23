const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const https = require('node:https');
const provider = require('../dist/provider');
const secret = '33333333-3333-3333-3333-333333333333';
const body = {
  object: 'list',
  data: [{ id: 'deepseek-v4.1-flash', object: 'model' }],
};
test('availability parser validates exact model identities without catalogue fallback', async () => {
  let calls = 0;
  const ids = await provider.listServerlessAvailability(
    secret,
    new AbortController().signal,
    async (origin, path, key) => {
      calls++;
      assert.equal(origin, 'models');
      assert.equal(path, '/v1/models');
      assert.equal(key, secret);
      return body;
    },
  );
  assert.deepEqual(ids, [{ id: 'deepseek-v4.1-flash' }]);
  assert.equal(calls, 1);
  for (const value of [
    {},
    { ...body, has_more: true },
    { ...body, next: 'cursor' },
    { ...body, data: [{ id: 'x' }] },
    { ...body, data: [...body.data, ...body.data] },
  ]) {
    await assert.rejects(
      provider.listServerlessAvailability(
        secret,
        new AbortController().signal,
        async () => value,
      ),
    );
  }
  assert.deepEqual(
    await provider.listServerlessAvailability(
      secret,
      new AbortController().signal,
      async () => ({ object: 'list', data: [] }),
    ),
    [],
  );
});
test('availability transport sends one Bearer-authenticated GET and rejects HTTP errors', async (t) => {
  const old = https.request;
  t.after(() => {
    https.request = old;
  });
  let status = 200,
    sends = 0;
  https.request = (options, callback) => {
    sends++;
    assert.equal(options.hostname, 'api.scaleway.ai');
    assert.equal(options.path, '/v1/models');
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.Authorization, 'Bearer ' + secret);
    assert.equal(options.headers['X-Auth-Token'], undefined);
    assert.equal(options.headers['X-Session-Token'], undefined);
    const req = new EventEmitter();
    req.destroy = () => {};
    req.end = () =>
      process.nextTick(() => {
        const res = new EventEmitter();
        res.destroy = () => {};
        res.statusCode = status;
        res.headers = { 'content-type': 'application/json' };
        callback(res);
        if (status === 200) {
          res.emit('data', Buffer.from(JSON.stringify(body)));
          res.emit('end');
        }
      });
    return req;
  };
  assert.deepEqual(
    await provider.listServerlessAvailability(
      secret,
      new AbortController().signal,
    ),
    [{ id: 'deepseek-v4.1-flash' }],
  );
  for (const code of [401, 403, 429, 500, 302]) {
    status = code;
    await assert.rejects(
      provider.listServerlessAvailability(secret, new AbortController().signal),
    );
  }
  assert.equal(sends, 6);
  await assert.rejects(
    provider.getJSON(
      'models',
      '/v1/models',
      'header.payload.signature',
      new AbortController().signal,
    ),
  );
  await assert.rejects(
    provider.getJSON(
      'models',
      '/v1/other',
      secret,
      new AbortController().signal,
    ),
  );
  assert.equal(sends, 6);
});

test('model created uses Unix seconds; zero missing invalid and out-of-range are omitted', async () => {
  for (const [created, expected] of [
    [1792584000, '2026-10-21T12:00:00.000Z'],
    [0, undefined],
    [-1, undefined],
    ['1792584000', undefined],
    [null, undefined],
    [undefined, undefined],
    [Number.MAX_SAFE_INTEGER, undefined],
  ]) {
    const rows = await provider.listServerlessAvailability(
      secret,
      new AbortController().signal,
      async () => ({
        object: 'list',
        data: [{ id: 'model', object: 'model', created }],
      }),
    );
    assert.equal(rows[0].createdAt, expected);
  }
});
