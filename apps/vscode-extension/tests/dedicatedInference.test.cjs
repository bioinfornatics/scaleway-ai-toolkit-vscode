const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const https = require('node:https');
const { test } = require('node:test');
const { invokeDedicatedText, InferenceError } = require('../dist/inference');
const org = '11111111-1111-1111-1111-111111111111';
const pid = '22222222-2222-2222-2222-222222222222';
const did = '33333333-3333-3333-3333-333333333333';
const eid = '44444444-4444-4444-4444-444444444444';
const mid = '55555555-5555-5555-5555-555555555555';
const secret = '66666666-6666-6666-6666-666666666666';
const model = 'vendor/model:fp8';
const sensitive = `${secret} private prompt upstream body`;
const done = 'data: [DONE]\n\n';
const frame = (v) => `data: ${JSON.stringify(v)}\n\n`;
const delta = (content, extra = {}) =>
  frame({ model, choices: [{ index: 0, delta: { content }, ...extra }] });
const usage = frame({
  choices: [],
  usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
});
function setup(t, options = {}) {
  const controller = new AbortController();
  const url = `https://${did}.ifr.fr-par.scaleway.com${options.path ?? '/v1/'}`;
  const input = {
    project: { id: pid, organizationId: org, name: 'Synthetic' },
    deployment: {
      id: did,
      kind: 'dedicated',
      status: 'ready',
      deploymentInfo: {
        projectId: pid,
        region: 'fr-par',
        modelId: mid,
        modelName: model,
        endpoints: [{ id: eid, url, network: 'public', authentication: 'iam' }],
      },
    },
    approval: {
      organizationId: org,
      projectId: pid,
      region: 'fr-par',
      deploymentId: did,
      endpointId: eid,
      endpointUrl: url,
      modelName: model,
      authentication: 'iam',
      allowUnauthenticated: false,
      approvedAt: Date.now() - 1000,
      expiresAt: Date.now() + 600000,
    },
    prompt: 'private prompt',
    maxTokens: 100,
    signal: controller.signal,
  };
  let credentials = 0;
  input.authorize = () => {
    credentials++;
    return secret;
  };
  const req = new EventEmitter(),
    res = new EventEmitter(),
    requests = [],
    deltas = [],
    usages = [];
  req.destroy = () => {
    req.destroyed = true;
  };
  res.destroy = () => {
    res.destroyed = true;
  };
  req.end = (body) => {
    req.body = body;
  };
  res.statusCode = options.status ?? 200;
  res.headers = {
    'content-type': options.contentType ?? 'text/event-stream; charset=utf-8',
    location: 'https://evil.invalid',
  };
  const original = https.request;
  let respond;
  https.request = (config, callback) => {
    requests.push(config);
    respond = () => callback(res);
    if (options.throw) throw new Error(sensitive);
    return req;
  };
  t.after(() => {
    controller.abort();
    https.request = original;
  });
  return {
    input,
    controller,
    req,
    res,
    requests,
    deltas,
    usages,
    credentials: () => credentials,
    respond: () => respond(),
    send: (text) =>
      res.emit('data', Buffer.isBuffer(text) ? text : Buffer.from(text)),
    start: (
      onDelta = (text) => deltas.push(text),
      onUsage = (v) => usages.push(v),
    ) => invokeDedicatedText(input, onDelta, onUsage),
  };
}
async function rejected(p, code) {
  await assert.rejects(p, (e) => {
    assert.ok(e instanceof InferenceError);
    assert.equal(e.code, code);
    assert.equal(e.message, `Inference failed: ${code}`);
    assert.equal(e.cause, undefined);
    for (const v of [secret, 'private prompt', 'upstream body'])
      assert.ok(!String(e.stack).includes(v));
    return true;
  });
}
for (const path of ['', '/', '/v1', '/v1/'])
  test(`exact one POST and wire model, base ${path}`, async (t) => {
    const s = setup(t, { path }),
      p = s.start();
    s.respond();
    for (const byte of Buffer.from(
      ': heartbeat\r\n\r\n' +
        delta('hé🌍', { finish_reason: 'stop' }) +
        usage +
        done,
    ))
      s.send(Buffer.from([byte]));
    await p;
    assert.equal(s.credentials(), 1);
    assert.equal(s.requests.length, 1);
    assert.deepEqual(s.requests[0], {
      protocol: 'https:',
      hostname: `${did}.ifr.fr-par.scaleway.com`,
      port: 443,
      path: '/v1/chat/completions',
      method: 'POST',
      rejectUnauthorized: true,
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'Content-Length': Buffer.byteLength(s.req.body),
      },
    });
    assert.deepEqual(JSON.parse(s.req.body), {
      model,
      messages: [{ role: 'user', content: 'private prompt' }],
      max_tokens: 100,
      stream: true,
    });
    assert.notEqual(model, mid);
    assert.deepEqual(s.deltas, ['hé🌍']);
    assert.deepEqual(s.usages, [
      { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
    ]);
    assert.ok(s.req.destroyed && s.res.destroyed);
  });
test('disabled sends no auth and never accesses authorize', async (t) => {
  const s = setup(t);
  s.input.approval.authentication =
    s.input.deployment.deploymentInfo.endpoints[0].authentication = 'disabled';
  s.input.approval.allowUnauthenticated = true;
  Object.defineProperty(s.input, 'authorize', {
    get() {
      assert.fail('credential accessed');
    },
  });
  const p = s.start();
  s.respond();
  s.send(done);
  await p;
  assert.equal(s.credentials(), 0);
  assert.equal(s.requests.length, 1);
  assert.ok(!Object.keys(s.requests[0].headers).some((k) => /auth/i.test(k)));
  assert.deepEqual(s.deltas, []);
  assert.deepEqual(s.usages, []);
});
const denied = {
  expired: (i) => {
    i.approval.expiresAt = Date.now() - 1;
  },
  future: (i) => {
    i.approval.approvedAt = Date.now() + 10000;
  },
  status: (i) => {
    i.deployment.status = 'creating';
  },
  scope: (i) => {
    i.project.id = org;
  },
  organization: (i) => {
    i.approval.organizationId = pid;
  },
  approval: (i) => {
    i.approval = undefined;
  },
  removed: (i) => {
    i.deployment.deploymentInfo.endpoints = [];
  },
  duplicate: (i) => {
    i.deployment.deploymentInfo.endpoints.push(
      i.deployment.deploymentInfo.endpoints[0],
    );
  },
  private: (i) => {
    i.deployment.deploymentInfo.endpoints[0].network = 'private';
  },
  unknown: (i) => {
    delete i.deployment.deploymentInfo.endpoints[0].network;
  },
  unsafe: (i) => {
    i.approval.endpointUrl = i.deployment.deploymentInfo.endpoints[0].url =
      'https://evil.invalid';
  },
  model: (i) => {
    i.deployment.deploymentInfo.modelName = 'other';
  },
  disabled: (i) => {
    i.approval.authentication =
      i.deployment.deploymentInfo.endpoints[0].authentication = 'disabled';
  },
};
for (const [label, mutate] of Object.entries(denied))
  test(`policy rejection precedes credentials/input/abort: ${label}`, async (t) => {
    const s = setup(t);
    mutate(s.input);
    s.input.prompt = 'x'.repeat(4097);
    s.controller.abort();
    Object.defineProperty(s.input, 'authorize', {
      get() {
        assert.fail('credential accessed');
      },
    });
    await rejected(s.start(), 'endpoint_policy');
    assert.equal(s.requests.length, 0);
    assert.equal(s.credentials(), 0);
    assert.deepEqual(s.deltas, []);
    assert.deepEqual(s.usages, []);
  });
for (const [label, value] of Object.entries({
  prompt: { prompt: null },
  long: { prompt: 'x'.repeat(4097) },
  zero: { maxTokens: 0 },
  fraction: { maxTokens: 1.5 },
  cap: { maxTokens: 2049 },
  nan: { maxTokens: NaN },
  signal: { signal: null },
}))
  test(`input before credentials: ${label}`, async (t) => {
    const s = setup(t);
    Object.assign(s.input, value);
    await rejected(s.start(), 'invalid_input');
    assert.equal(s.credentials(), 0);
    assert.equal(s.requests.length, 0);
  });
for (const c of ['delta', 'usage'])
  test(`invalid callback before credentials ${c}`, async (t) => {
    const s = setup(t);
    await rejected(
      c === 'delta' ? s.start(null) : s.start(undefined, null),
      'invalid_input',
    );
    assert.equal(s.credentials(), 0);
    assert.equal(s.requests.length, 0);
  });
for (const value of [
  'jwt.fake.token',
  'SCW123456789',
  `${secret}\n`,
  `${secret}\r\nBad: header`,
  null,
  123,
])
  test(`invalid IAM secret ${JSON.stringify(value)}`, async (t) => {
    const s = setup(t);
    s.input.authorize = () => value;
    await rejected(s.start(), 'invalid_credentials');
    assert.equal(s.requests.length, 0);
  });
test('authorize failure sanitized', async (t) => {
  const s = setup(t);
  s.input.authorize = () => {
    throw new Error(sensitive);
  };
  await rejected(s.start(), 'invalid_credentials');
  assert.equal(s.requests.length, 0);
});
test('already aborted before credential access', async (t) => {
  const s = setup(t);
  s.controller.abort();
  await rejected(s.start(), 'aborted');
  assert.equal(s.credentials(), 0);
  assert.equal(s.requests.length, 0);
});
test('abort during authorize never sends', async (t) => {
  const s = setup(t);
  s.input.authorize = () => {
    s.controller.abort();
    return secret;
  };
  await rejected(s.start(), 'aborted');
  assert.equal(s.requests.length, 0);
});
test('cancel partial stream suppresses late callbacks and destroys transport', async (t) => {
  const s = setup(t),
    p = s.start();
  s.respond();
  s.send(delta('partial') + usage);
  s.controller.abort(new Error(sensitive));
  s.send(delta('late') + done);
  s.req.emit('error', new Error(sensitive));
  s.res.emit('error', new Error(sensitive));
  await rejected(p, 'aborted');
  assert.ok(s.req.destroyed && s.res.destroyed);
  assert.deepEqual(s.deltas, ['partial']);
  assert.deepEqual(s.usages, []);
});
test('abort during delta suppresses same chunk remainder', async (t) => {
  const s = setup(t),
    p = s.start((text) => {
      s.deltas.push(text);
      s.controller.abort();
    });
  s.respond();
  s.send(delta('first') + delta('late') + usage + done);
  await rejected(p, 'aborted');
  assert.deepEqual(s.deltas, ['first']);
  assert.deepEqual(s.usages, []);
});
for (const [label, text, code] of [
  ['model UUID', frame({ model: mid, choices: [] }), 'model_mismatch'],
  ['wrong model', frame({ model: 'other', choices: [] }), 'model_mismatch'],
  ['JSON', 'data: invalid\n\n', 'invalid_stream'],
  ['provider', frame({ error: { message: sensitive } }), 'provider_error'],
  ['event', `event: error\ndata: ${sensitive}\n\n`, 'provider_error'],
  [
    'UTF8',
    Buffer.from([100, 97, 116, 97, 58, 32, 255, 10, 10]),
    'invalid_stream',
  ],
  [
    'filtered',
    delta('', { finish_reason: 'content_filter' }),
    'provider_error',
  ],
])
  test(`partial failure ${label}`, async (t) => {
    const s = setup(t),
      p = s.start();
    s.respond();
    s.send(delta('partial') + usage);
    s.send(text);
    s.send(done);
    await rejected(p, code);
    assert.deepEqual(s.deltas, ['partial']);
    assert.deepEqual(s.usages, []);
    assert.equal(s.requests.length, 1);
  });
for (const ending of ['end', 'close', 'aborted'])
  test(`EOF is not DONE ${ending}`, async (t) => {
    const s = setup(t),
      p = s.start();
    s.respond();
    s.send(delta('partial', { finish_reason: 'stop' }) + usage);
    s.res.emit(ending);
    await rejected(p, 'unexpected_eof');
    assert.deepEqual(s.deltas, ['partial']);
    assert.deepEqual(s.usages, []);
  });
test('unterminated DONE is EOF', async (t) => {
  const s = setup(t),
    p = s.start();
  s.respond();
  s.send('data: [DONE]\n');
  s.res.emit('end');
  await rejected(p, 'unexpected_eof');
});
for (const status of [301, 302, 303, 307, 308, 401, 403, 429, 500])
  test(`no redirect/retry HTTP ${status}`, async (t) => {
    const s = setup(t, { status }),
      p = s.start();
    s.respond();
    s.send(sensitive);
    await rejected(p, 'http_error');
    assert.equal(s.requests.length, 1);
    assert.equal(s.credentials(), 1);
    assert.ok(s.req.destroyed && s.res.destroyed);
    assert.deepEqual(s.deltas, []);
    assert.deepEqual(s.usages, []);
  });
for (const source of ['TLS', 'response', 'throw'])
  test(`sanitized network failure ${source}`, async (t) => {
    const s = setup(t, { throw: source === 'throw' }),
      p = s.start();
    if (source === 'response') s.respond();
    if (source !== 'throw')
      (source === 'TLS' ? s.req : s.res).emit(
        'error',
        Object.assign(new Error(sensitive), { code: 'CERT_HAS_EXPIRED' }),
      );
    await rejected(p, 'network_error');
    assert.equal(s.requests.length, 1);
    assert.equal(s.requests[0].rejectUnauthorized, true);
  });
test('non SSE response', async (t) => {
  const s = setup(t, { contentType: 'application/json' }),
    p = s.start();
  s.respond();
  await rejected(p, 'invalid_stream');
});
test('frame bound', async (t) => {
  const s = setup(t),
    p = s.start();
  s.respond();
  s.send('x'.repeat(65537));
  await rejected(p, 'frame_too_large');
});
test('aggregate bound', async (t) => {
  const s = setup(t),
    p = s.start();
  s.respond();
  for (let n = 0; n < 2200; n++) s.send(`:${'x'.repeat(1000)}\n\n`);
  await rejected(p, 'response_too_large');
});
test('idle deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const s = setup(t),
    p = s.start();
  t.mock.timers.tick(15000);
  await rejected(p, 'idle_timeout');
  assert.ok(s.req.destroyed);
});
test('absolute deadline despite heartbeats', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const s = setup(t),
    p = s.start();
  s.respond();
  for (let n = 0; n < 5; n++) {
    t.mock.timers.tick(10000);
    s.send(': heartbeat\n\n');
  }
  t.mock.timers.tick(10000);
  await rejected(p, 'timeout');
  assert.ok(s.req.destroyed && s.res.destroyed);
});
for (const c of ['delta', 'usage'])
  test(`callback exception ${c}`, async (t) => {
    const s = setup(t),
      bad = () => {
        throw new Error(sensitive);
      },
      p = c === 'delta' ? s.start(bad) : s.start(undefined, bad);
    s.respond();
    s.send(delta('first') + usage + done);
    await rejected(p, 'callback_error');
  });
test('upper input bounds accepted', async (t) => {
  const s = setup(t);
  s.input.prompt = 'x'.repeat(4096);
  s.input.maxTokens = 2048;
  const p = s.start();
  s.respond();
  s.send(done);
  await p;
  assert.equal(JSON.parse(s.req.body).max_tokens, 2048);
});
test('arbitrary destination helper is private', () => {
  assert.equal(require('../dist/inference').invokeSse, undefined);
});
