const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const https = require('node:https');
const { createProject, postProject } = require('../dist/projectCreation');
const intent = {
  organizationId: '11111111-1111-1111-1111-111111111111',
  name: 'Explicit project',
  confirmed: true,
};
const id = '22222222-2222-2222-2222-222222222222';
const token = 'eyJhbGciOiJSUzI1NiJ9.eyJleHAiOjQwMDAwMDAwMDB9.c3ludGhldGlj';
const signal = () => new AbortController().signal;
test('project creation requires valid explicit intent, projects exact response and calls once', async () => {
  let count = 0;
  const project = await createProject(
    { ...intent, extra: 'omit' },
    token,
    signal(),
    async (request, key) => {
      count++;
      assert.deepEqual(request, intent);
      assert.equal(key, token);
      return {
        id,
        name: intent.name,
        organization_id: intent.organizationId,
        email: 'omit',
      };
    },
  );
  assert.equal(count, 1);
  assert.deepEqual(project, {
    id,
    name: intent.name,
    organizationId: intent.organizationId,
  });
  for (const change of [
    { confirmed: false },
    { name: '' },
    { organizationId: 'bad' },
  ])
    await assert.rejects(
      createProject({ ...intent, ...change }, token, signal(), async () =>
        assert.fail('invalid send'),
      ),
      { code: 'invalid_creation_intent' },
    );
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    createProject(intent, token, abort.signal, async () =>
      assert.fail('cancelled send'),
    ),
    { code: 'cancelled' },
  );
});
test('malformed/mismatched successful creation is unknown outcome, no retry', async () => {
  for (const value of [
    null,
    [],
    { id, name: 'Wrong', organization_id: intent.organizationId },
    { id, name: intent.name, organization_id: id },
  ]) {
    let count = 0;
    await assert.rejects(
      createProject(intent, token, signal(), async () => {
        count++;
        return value;
      }),
      { code: 'creation_outcome_unknown' },
    );
    assert.equal(count, 1);
  }
});
function mockTransport(status, body, { transportError = false, abort } = {}) {
  const original = https.request;
  let count = 0,
    sent;
  https.request = (options, callback) => {
    count++;
    assert.equal(options.hostname, 'api.scaleway.com');
    assert.equal(options.method, 'POST');
    assert.equal(options.path, '/account/v3/projects');
    assert.equal(options.headers['X-Session-Token'], token);
    const request = new EventEmitter();
    request.destroy = () => {};
    request.end = (bytes) => {
      sent = JSON.parse(bytes.toString());
      queueMicrotask(() => {
        if (abort) {
          abort.abort();
          return;
        }
        if (transportError) {
          request.emit('error', new Error('private transport detail'));
          return;
        }
        const response = new EventEmitter();
        response.destroy = () => {};
        response.statusCode = status;
        response.headers = { 'content-type': 'application/json' };
        callback(response);
        response.emit('data', Buffer.from(body));
        response.emit('end');
      });
    };
    return request;
  };
  return {
    restore: () => {
      https.request = original;
    },
    count: () => count,
    sent: () => sent,
  };
}
test('fixed POST accepts success only and sends scoped body without confirmation metadata', async () => {
  const s = mockTransport(
    201,
    JSON.stringify({
      id,
      name: intent.name,
      organization_id: intent.organizationId,
    }),
  );
  try {
    assert.equal((await postProject(intent, token, signal())).id, id);
    assert.deepEqual(s.sent(), {
      organization_id: intent.organizationId,
      name: intent.name,
      description: '',
    });
    assert.equal(s.count(), 1);
  } finally {
    s.restore();
  }
});
test('denial, server errors, redirects, malformed success and after-send abort are never retried', async () => {
  for (const [status, body, expected] of [
    [403, '{}', 'access_denied'],
    [429, '{}', 'rate_limited'],
    [400, '{}', 'creation_rejected'],
    [500, '{}', 'creation_outcome_unknown'],
    [302, '{}', 'creation_outcome_unknown'],
    [201, '{bad', 'creation_outcome_unknown'],
  ]) {
    const s = mockTransport(status, body);
    try {
      await assert.rejects(postProject(intent, token, signal()), {
        code: expected,
      });
      assert.equal(s.count(), 1);
    } finally {
      s.restore();
    }
  }
  for (const options of [
    { transportError: true },
    { abort: new AbortController() },
  ]) {
    const s = mockTransport(201, '{}', options);
    try {
      await assert.rejects(
        postProject(intent, token, options.abort?.signal ?? signal()),
        { code: 'creation_outcome_unknown' },
      );
      assert.equal(s.count(), 1);
    } finally {
      s.restore();
    }
  }
});
