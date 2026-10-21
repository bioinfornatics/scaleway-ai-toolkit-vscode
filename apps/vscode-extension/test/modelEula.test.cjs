const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHash } = require('node:crypto');
const { getModelEula } = require('../dist/modelEula');
const project = {
  id: '11111111-1111-1111-1111-111111111111',
  organizationId: '22222222-2222-2222-2222-222222222222',
  name: 'Test',
};
const model = {
  id: '33333333-3333-3333-3333-333333333333',
  label: 'Model',
  kind: 'dedicated-catalog',
  dedicatedInfo: { hasEula: true },
};
const token = 'eyJhbGciOiJSUzI1NiJ9.eyJleHAiOjQwMDAwMDAwMDB9.c3ludGhldGlj';
test('EULA one exact documented read preserves text/digest/provenance and never accepts', async () => {
  let sends = 0;
  const content = '<script>untrusted</script>\nLicence é\n';
  const result = await getModelEula(
    project,
    model,
    token,
    new AbortController().signal,
    async (origin, path, jwt) => {
      sends++;
      assert.equal(origin, 'control');
      assert.equal(
        path,
        ['/inference/v1/regions/fr-par/models/', model.id, '/eula'].join(''),
      );
      assert.equal(jwt, token);
      return { content, token: 'discard' };
    },
    new Date('2026-10-21T05:43:00Z'),
  );
  assert.equal(sends, 1);
  assert.equal(result.content, content);
  assert.equal(
    result.sha256,
    createHash('sha256').update(content).digest('hex'),
  );
  assert.equal(result.accepted, false);
  assert.equal(result.modelId, model.id);
  assert.ok(!JSON.stringify(result).includes(token));
});
test('EULA shape limits and unknown/no-license/foreign kind fail closed', async () => {
  for (const content of [
    '',
    ' ',
    null,
    12,
    'a'.repeat(262145),
    'é'.repeat(131073),
    'text\u0000bad',
  ])
    await assert.rejects(
      getModelEula(
        project,
        model,
        token,
        new AbortController().signal,
        async () => ({ content }),
      ),
      /invalid_eula_response/,
    );
  for (const bad of [
    { ...model, kind: 'serverless' },
    { ...model, dedicatedInfo: { hasEula: false } },
    { ...model, dedicatedInfo: {} },
  ])
    await assert.rejects(
      getModelEula(
        project,
        bad,
        token,
        new AbortController().signal,
        async () => assert.fail('no read'),
      ),
      /invalid_scope/,
    );
});
test('EULA transport allowlist fixes region/model/path and session-only header', async () => {
  const https = require('node:https');
  const { EventEmitter } = require('node:events');
  const { getJSON } = require('../dist/provider');
  const original = https.request;
  let sends = 0;
  try {
    https.request = (options, receive) => {
      sends++;
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
          res.emit('data', Buffer.from(JSON.stringify({ content: 'Terms' })));
          res.emit('end');
        });
      return req;
    };
    const path = [
      '/inference/v1/regions/fr-par/models/',
      model.id,
      '/eula',
    ].join('');
    await getJSON('control', path, token, new AbortController().signal);
    for (const bad of [
      [path, '?url=evil'].join(''),
      path.replace('fr-par', 'nl-ams'),
      path.replace('/eula', '/license'),
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
