const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('node:http');
const { browserLogin, parseSession } = require('../dist/browserLogin');
const userId = '11111111-1111-1111-1111-111111111111';
const token =
  'eyJhbGciOiJSUzI1NiJ9.' +
  Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString('base64url') +
  '.c3ludGhldGlj';
const encoded = () =>
  Buffer.from(
    JSON.stringify({
      token,
      jwt: {
        audienceId: userId,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      },
      renewToken: 'discard_me',
    }),
  ).toString('base64');
function request(url, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers: { Host: u.host, ...headers },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}
test('official envelope projected minimally, malformed/expired tokens rejected', () => {
  const session = parseSession(encoded());
  assert.equal(session.token, token);
  assert.equal(session.userId, userId);
  assert.deepEqual(Object.keys(session), ['token', 'expiresAt', 'userId']);
  for (const value of [
    '',
    '%%%',
    'e30=',
    Buffer.from(
      JSON.stringify({ token: 'key', jwt: { audienceId: userId } }),
    ).toString('base64'),
  ])
    assert.throws(() => parseSession(value), { code: 'invalid_callback' });
  assert.throws(() => parseSession(encoded(), Date.now() + 7200000), {
    code: 'session_expired',
  });
});
test('real loopback callback correlated, strict request guards, one-use result and cleanup', async () => {
  let callback;
  let openingResolve;
  const opened = new Promise((resolve) => (openingResolve = resolve));
  const login = browserLogin(
    async (url) => {
      const u = new URL(url);
      assert.equal(u.origin, 'https://account.scaleway.com');
      assert.equal(u.pathname, '/authenticate');
      assert.equal(u.searchParams.size, 1);
      callback = u.searchParams.get('redirectToUrl');
      assert.match(new URL(callback).pathname, /^\/[a-f0-9]{48}\/callback$/);
      openingResolve();
      return true;
    },
    new AbortController().signal,
    2000,
  );
  await opened;
  const good = `${callback}?token=${encodeURIComponent(encoded())}`;
  assert.equal((await request(good, { Host: 'evil.example' })).status, 400);
  assert.equal(
    (await request(good, { Origin: 'https://evil.example' })).status,
    400,
  );
  assert.equal((await request(good, {}, 'POST')).status, 400);
  assert.equal(
    (await request(`${callback.replace(/\/[a-f0-9]{48}/, '/wrong')}?token=x`))
      .status,
    404,
  );
  assert.equal((await request(`${callback}?token=invalid`)).status, 400);
  assert.equal((await request(`${good}&token=duplicate`)).status, 400);
  const response = await request(good);
  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.ok(response.body.includes('history.replaceState'));
  assert.ok(!response.body.includes(token));
  assert.equal((await login).token, token);
  await assert.rejects(request(good));
});
test('browser failure, deadline and cancellation clean listener without secrets', async () => {
  await assert.rejects(
    browserLogin(async () => false, new AbortController().signal),
    { code: 'browser_unavailable' },
  );
  await assert.rejects(
    browserLogin(async () => true, new AbortController().signal, 20),
    { code: 'login_timeout' },
  );
  const c = new AbortController();
  let callback;
  await assert.rejects(
    browserLogin(async (url) => {
      callback = new URL(url).searchParams.get('redirectToUrl');
      c.abort();
      return true;
    }, c.signal),
    { code: 'cancelled' },
  );
  await assert.rejects(request(`${callback}?token=x`));
  c.abort();
  await assert.rejects(
    browserLogin(async () => {
      throw Error('must not open');
    }, c.signal),
    { code: 'cancelled' },
  );
});
