const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const https = require('node:https');
const sdk = require('../dist/scalewaySdk');
const access = 'SCW12345678901234567',
  secret = '33333333-3333-3333-3333-333333333333';
const user = '11111111-1111-1111-1111-111111111111';
function mock(t, body, status = 200) {
  const old = https.request;
  let sends = 0;
  https.request = (options, callback) => {
    sends++;
    assert.equal(options.method, 'GET');
    assert.equal(options.path, '/iam/v1alpha1/api-keys/' + access);
    assert.equal(options.headers['X-Auth-Token'], secret);
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
  t.after(() => {
    https.request = old;
  });
  return () => sends;
}
test('existing-key SDK exact metadata read authenticates supplied secret without browser JWT', async (t) => {
  const sends = mock(t, {
    access_key: access,
    user_id: user,
    expires_at: null,
  });
  assert.deepEqual(
    await sdk.inspectExistingUserAPIKey(
      access,
      secret,
      new AbortController().signal,
    ),
    { userId: user, accessKey: access, expiresAt: Number.MAX_SAFE_INTEGER },
  );
  assert.equal(sends(), 1);
});
test('key SDK rejects application/foreign/malformed/expired metadata', async (t) => {
  for (const [body, code] of [
    [
      { access_key: access, application_id: user },
      'application_key_not_supported',
    ],
    [{ access_key: 'SCW00000000000000000', user_id: user }, 'invalid_response'],
    [
      { access_key: access, user_id: user, expires_at: 'bad' },
      'invalid_response',
    ],
    [
      { access_key: access, user_id: user, expires_at: '2000-01-01T00:00:00Z' },
      'api_key_expired',
    ],
  ]) {
    const old = https.request;
    mock(t, body);
    await assert.rejects(
      sdk.inspectExistingUserAPIKey(
        access,
        secret,
        new AbortController().signal,
      ),
      { code },
    );
    https.request = old;
  }
});
test('401 differs from IAM denial and rate limiting; no retry or creation', async (t) => {
  for (const [status, code] of [
    [401, 'invalid_api_key'],
    [403, 'access_denied'],
    [429, 'rate_limited'],
  ]) {
    const old = https.request,
      sends = mock(t, {}, status);
    await assert.rejects(
      sdk.inspectExistingUserAPIKey(
        access,
        secret,
        new AbortController().signal,
      ),
      { code },
    );
    assert.equal(sends(), 1);
    https.request = old;
  }
});
test('invalid input and cancellation cause no HTTP', async (t) => {
  const sends = mock(t, {}),
    controller = new AbortController();
  controller.abort();
  await assert.rejects(
    sdk.inspectExistingUserAPIKey(access, secret, controller.signal),
    { code: 'cancelled' },
  );
  await assert.rejects(
    sdk.inspectExistingUserAPIKey('bad', secret, new AbortController().signal),
    { code: 'invalid_api_key_format' },
  );
  assert.equal(sends(), 0);
});
