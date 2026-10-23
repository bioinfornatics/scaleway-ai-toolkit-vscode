const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const https = require('node:https');
const { test } = require('node:test');
const { invokeText, InferenceError } = require('../dist/inference');
const projectId = '11111111-1111-1111-1111-111111111111';
const secretKey = '22222222-2222-2222-2222-222222222222';
const modelId = 'vendor/model';
const sensitive = `${secretKey} private prompt provider body`;
const done = 'data: [DONE]\n\n';
const frame = (value) => `data: ${JSON.stringify(value)}\n\n`;
const delta = (content, extra = {}) =>
  frame({
    model: modelId,
    choices: [{ index: 0, delta: { content }, ...extra }],
  });
const usage = (value) => frame({ choices: [], usage: value });
const counts = { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 };
function setup(t, options = {}) {
  const original = https.request;
  const controller = new AbortController();
  const req = new EventEmitter();
  const res = new EventEmitter();
  req.destroy = () => {
    req.destroyed = true;
  };
  res.destroy = () => {
    res.destroyed = true;
  };
  res.statusCode = options.status ?? 200;
  res.headers = {
    'content-type': options.contentType ?? 'text/event-stream; charset=utf-8',
    location: 'https://evil.invalid',
  };
  let respond;
  const requests = [];
  https.request = (config, callback) => {
    requests.push(config);
    respond = () => callback(res);
    req.end = (body) => {
      req.body = body;
    };
    if (options.throw) throw new Error(sensitive);
    return req;
  };
  t.after(() => {
    controller.abort();
    https.request = original;
  });
  const deltas = [],
    usages = [];
  const input = {
    modelId,
    projectId,
    secretKey,
    prompt: 'private prompt',
    maxTokens: 100,
    signal: controller.signal,
    ...options.input,
  };
  const start = (
    onDelta = (text) => deltas.push(text),
    onUsage = (value) => usages.push(value),
  ) => invokeText(input, onDelta, onUsage);
  return {
    req,
    res,
    input,
    start,
    respond: () => respond(),
    requests,
    deltas,
    usages,
    controller,
    send: (text) =>
      res.emit('data', Buffer.isBuffer(text) ? text : Buffer.from(text)),
  };
}
async function rejected(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof InferenceError);
    assert.equal(error.code, code);
    assert.equal(error.message, `Inference failed: ${code}`);
    assert.equal(error.cause, undefined);
    assert.ok(!String(error.stack).includes(secretKey));
    assert.ok(!String(error.stack).includes('private prompt'));
    assert.ok(!String(error.stack).includes('provider body'));
    return true;
  });
}
test('fixed single POST, UUID bearer only, exact bounded body; fragmented UTF8, LF/CRLF and multiline SSE', async (t) => {
  const s = setup(t);
  const promise = s.start();
  s.respond();
  const text =
    ': heartbeat\r\nid: 42\r\nevent: message\r\ndata: {"model":"vendor/model",\r\ndata: "choices":[{"index":1,"delta":{"content":"ignored"}},{"index":0,"delta":{"content":"hé🌍"}}]}\r\n\r\n' +
    delta('!', { finish_reason: 'stop' }) +
    done;
  for (const byte of Buffer.from(text)) s.send(Buffer.from([byte]));
  await promise;
  assert.deepEqual(s.deltas, ['hé🌍', '!']);
  assert.deepEqual(s.usages, []);
  assert.equal(s.requests.length, 1);
  const config = s.requests[0];
  assert.equal(config.protocol, 'https:');
  assert.equal(config.hostname, 'api.scaleway.ai');
  assert.equal(config.path, `/${projectId}/v1/chat/completions`);
  assert.equal(config.port, 443);
  assert.equal(config.method, 'POST');
  assert.deepEqual(config.headers, {
    Authorization: `Bearer ${secretKey}`,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    'Content-Length': Buffer.byteLength(s.req.body),
  });
  assert.deepEqual(JSON.parse(s.req.body), {
    model: modelId,
    messages: [{ role: 'user', content: 'private prompt' }],
    max_tokens: 100,
    stream: true,
  });
  assert.ok(s.req.destroyed && s.res.destroyed);
  s.send(delta('late') + done);
  assert.deepEqual(s.deltas, ['hé🌍', '!']);
});
test('usage snapshots replace, emit only once at DONE with cached count', async (t) => {
  const s = setup(t),
    promise = s.start();
  s.respond();
  s.send(
    usage({ prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }) +
      delta('ok', { finish_reason: 'length' }),
  );
  assert.deepEqual(s.usages, []);
  s.send(
    usage({ ...counts, prompt_tokens_details: { cached_tokens: 2 } }) + done,
  );
  await promise;
  assert.deepEqual(s.usages, [
    { inputTokens: 3, outputTokens: 2, totalTokens: 5, cachedInputTokens: 2 },
  ]);
});
for (const [label, invalid] of Object.entries({
  negative: { ...counts, prompt_tokens: -1 },
  fractional: { ...counts, completion_tokens: 2.5 },
  inconsistent: { ...counts, total_tokens: 6 },
  unsafe: {
    prompt_tokens: Number.MAX_SAFE_INTEGER + 1,
    completion_tokens: 0,
    total_tokens: Number.MAX_SAFE_INTEGER + 1,
  },
  string: { ...counts, total_tokens: '5' },
  cached: { ...counts, prompt_tokens_details: { cached_tokens: 4 } },
  details: { ...counts, prompt_tokens_details: 'bad' },
  missing: {},
  array: [],
})) {
  test(`malformed final usage unavailable: ${label}`, async (t) => {
    const s = setup(t),
      promise = s.start();
    s.respond();
    s.send(usage(counts) + usage(invalid) + done);
    await promise;
    assert.deepEqual(s.usages, []);
  });
}
test('valid zero usage is reported, null placeholders do not erase a snapshot', async (t) => {
  const s = setup(t),
    promise = s.start();
  s.respond();
  s.send(
    usage({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }) +
      usage(null) +
      done,
  );
  await promise;
  assert.deepEqual(s.usages, [
    { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  ]);
});
for (const status of [301, 302, 307, 308, 401, 403, 429, 500]) {
  test(`HTTP ${status} sanitized, no retry or redirect`, async (t) => {
    const s = setup(t, { status }),
      promise = s.start();
    s.respond();
    s.send(sensitive);
    await rejected(promise, 'http_error');
    assert.equal(s.requests.length, 1);
    assert.ok(s.req.destroyed && s.res.destroyed);
    assert.deepEqual(s.deltas, []);
    assert.deepEqual(s.usages, []);
  });
}
for (const [name, text, code] of [
  ['error object', frame({ error: { message: sensitive } }), 'provider_error'],
  ['error event', `event: error\ndata: ${sensitive}\n\n`, 'provider_error'],
  ['invalid JSON', `data: ${sensitive}\n\n`, 'invalid_stream'],
  ['non-object', frame([]), 'invalid_stream'],
  ['missing choices', frame({}), 'invalid_stream'],
  [
    'bad delta',
    frame({ choices: [{ index: 0, delta: { content: 42 } }] }),
    'invalid_stream',
  ],
  ['missing delta', frame({ choices: [{ index: 0 }] }), 'invalid_stream'],
  ['missing index', frame({ choices: [{ delta: {} }] }), 'invalid_stream'],
  [
    'duplicate index',
    frame({
      choices: [
        { index: 0, delta: {} },
        { index: 0, delta: {} },
      ],
    }),
    'invalid_stream',
  ],
  ['wrong model', frame({ model: 'other', choices: [] }), 'model_mismatch'],
  ['null model', frame({ model: null, choices: [] }), 'model_mismatch'],
  [
    'filtered finish',
    delta('', { finish_reason: 'content_filter' }),
    'provider_error',
  ],
  [
    'late content after finish',
    delta('', { finish_reason: 'stop' }) + delta('late'),
    'invalid_stream',
  ],
  [
    'invalid UTF8',
    Buffer.from([100, 97, 116, 97, 58, 32, 255, 10, 10]),
    'invalid_stream',
  ],
]) {
  test(`stream rejects ${name} preserving earlier output, no late usage`, async (t) => {
    const s = setup(t),
      promise = s.start();
    s.respond();
    s.send(delta('partial') + usage(counts));
    s.send(text);
    s.send(delta('late') + done);
    await rejected(promise, code);
    assert.deepEqual(s.deltas, ['partial']);
    assert.deepEqual(s.usages, []);
  });
}
for (const ending of ['end', 'close', 'aborted']) {
  test(`requires DONE even after finish: ${ending}`, async (t) => {
    const s = setup(t),
      promise = s.start();
    s.respond();
    s.send(delta('partial', { finish_reason: 'stop' }) + usage(counts));
    s.res.emit(ending);
    await rejected(promise, 'unexpected_eof');
    assert.deepEqual(s.usages, []);
  });
}
test('unterminated DONE is not a complete SSE frame', async (t) => {
  const s = setup(t),
    promise = s.start();
  s.respond();
  s.send('data: [DONE]\n');
  s.res.emit('end');
  await rejected(promise, 'unexpected_eof');
});
test('abort before request does not dispatch', async (t) => {
  const s = setup(t);
  s.controller.abort(sensitive);
  await rejected(s.start(), 'aborted');
  assert.equal(s.requests.length, 0);
});
test('Stop destroys transport, preserves delivered deltas, suppresses late callbacks/errors', async (t) => {
  const s = setup(t),
    promise = s.start();
  s.respond();
  s.send(delta('partial') + usage(counts));
  s.controller.abort(new Error(sensitive));
  s.send(delta('late') + done);
  s.req.emit('error', new Error(sensitive));
  s.res.emit('error', new Error(sensitive));
  await rejected(promise, 'aborted');
  assert.ok(s.req.destroyed && s.res.destroyed);
  assert.deepEqual(s.deltas, ['partial']);
  assert.deepEqual(s.usages, []);
});
test('abort during delta prevents remaining same-chunk updates', async (t) => {
  const s = setup(t),
    promise = s.start((text) => {
      s.deltas.push(text);
      s.controller.abort();
    });
  s.respond();
  s.send(delta('first') + delta('second') + done);
  await rejected(promise, 'aborted');
  assert.deepEqual(s.deltas, ['first']);
});
for (const source of ['request', 'response', 'throw']) {
  test(`sanitized network failure: ${source}`, async (t) => {
    const s = setup(t, { throw: source === 'throw' }),
      promise = s.start();
    if (source === 'response') s.respond();
    if (source !== 'throw')
      (source === 'request' ? s.req : s.res).emit(
        'error',
        new Error(sensitive),
      );
    await rejected(promise, 'network_error');
    assert.equal(s.requests.length, 1);
  });
}
test('non-SSE response rejected', async (t) => {
  const s = setup(t, { contentType: 'application/json' }),
    promise = s.start();
  s.respond();
  await rejected(promise, 'invalid_stream');
});
for (const [label, input, code] of [
  [
    'JWT',
    { secretKey: 'eyJhbGciOiJIUzI1NiJ9.fake.jwt' },
    'invalid_credentials',
  ],
  ['access key', { secretKey: 'SCW12345678901234567' }, 'invalid_credentials'],
  ['trailing newline', { secretKey: `${secretKey}\n` }, 'invalid_credentials'],
  ['model newline', { modelId: `${modelId}\n` }, 'invalid_input'],
  [
    'header injection',
    { secretKey: `${secretKey}\r\nBad: value` },
    'invalid_credentials',
  ],
  ['project injection', { projectId: '../evil' }, 'invalid_credentials'],
  [
    'model URL',
    { modelId: 'https://evil.invalid/?key=secret' },
    'invalid_input',
  ],
  ['prompt cap', { prompt: 'a'.repeat(4097) }, 'invalid_input'],
  ['zero tokens', { maxTokens: 0 }, 'invalid_input'],
  ['negative tokens', { maxTokens: -1 }, 'invalid_input'],
  ['fractional tokens', { maxTokens: 1.5 }, 'invalid_input'],
  ['token cap', { maxTokens: 2049 }, 'invalid_input'],
  ['NaN', { maxTokens: NaN }, 'invalid_input'],
]) {
  test(`invalid input before network: ${label}`, async (t) => {
    const s = setup(t, { input });
    await rejected(s.start(), code);
    assert.equal(s.requests.length, 0);
  });
}
test('accepts prompt and token upper bounds', async (t) => {
  const s = setup(t, { input: { prompt: 'a'.repeat(4096), maxTokens: 2048 } }),
    promise = s.start();
  s.respond();
  s.send(done);
  await promise;
});
test('frame cap applies across chunks and multiline data', async (t) => {
  const s = setup(t),
    promise = s.start();
  s.respond();
  for (let i = 0; i < 70; i++) s.send(`data: ${'a'.repeat(1000)}\n`);
  await rejected(promise, 'frame_too_large');
  assert.ok(s.req.destroyed && s.res.destroyed);
});
test('unterminated frame capped', async (t) => {
  const s = setup(t),
    promise = s.start();
  s.respond();
  s.send('x'.repeat(65537));
  await rejected(promise, 'frame_too_large');
});
test('aggregate response cap includes ignored comment frames', async (t) => {
  const s = setup(t),
    promise = s.start();
  s.respond();
  for (let i = 0; i < 2200; i++) s.send(`:${'a'.repeat(1000)}\n\n`);
  await rejected(promise, 'response_too_large');
});
for (const callback of ['delta', 'usage']) {
  test(`consumer exception sanitized: ${callback}`, async (t) => {
    const s = setup(t),
      bad = () => {
        throw new Error(sensitive);
      };
    const promise =
      callback === 'delta' ? s.start(bad) : s.start(undefined, bad);
    s.respond();
    s.send(delta('first') + usage(counts) + done);
    await rejected(promise, 'callback_error');
  });
}
test('idle deadline during connection and stream, reset on incoming bytes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const s = setup(t),
    promise = s.start();
  t.mock.timers.tick(14000);
  s.respond();
  t.mock.timers.tick(14000);
  s.send(delta('partial'));
  t.mock.timers.tick(14999);
  assert.ok(!s.req.destroyed);
  t.mock.timers.tick(1);
  await rejected(promise, 'idle_timeout');
  s.send(delta('late') + done);
  assert.deepEqual(s.deltas, ['partial']);
  assert.ok(s.req.destroyed && s.res.destroyed);
});
test('absolute 60-second deadline cannot be extended by heartbeat traffic', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const s = setup(t),
    promise = s.start();
  s.respond();
  for (let i = 0; i < 5; i++) {
    t.mock.timers.tick(10000);
    s.send(': heartbeat\n\n');
  }
  t.mock.timers.tick(10000);
  await rejected(promise, 'timeout');
  assert.ok(s.req.destroyed && s.res.destroyed);
});
test('connection idle timeout destroys request before headers', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const s = setup(t),
    promise = s.start();
  t.mock.timers.tick(15000);
  await rejected(promise, 'idle_timeout');
  s.respond();
  assert.ok(s.req.destroyed && s.res.destroyed);
  assert.deepEqual(s.usages, []);
});

for (const selected of [
  'fixture/model:variant',
  'never-tested-text-2',
  'another-provider-chat',
])
  test(
    'shared HTTPS invocation uses exact selected identity ' + selected,
    async (t) => {
      const s = setup(t, { input: { modelId: selected } });
      const p = s.start();
      s.respond();
      assert.equal(JSON.parse(s.req.body).model, selected);
      s.send(
        frame({
          model: selected,
          choices: [{ index: 0, delta: { content: 'same contract' } }],
        }) + done,
      );
      await p;
      assert.deepEqual(s.deltas, ['same contract']);
      assert.equal(s.requests.length, 1);
      assert.equal(s.requests[0].hostname, 'api.scaleway.ai');
      assert.equal(
        s.requests[0].path,
        '/' + projectId + '/v1/chat/completions',
      );
    },
  );

test('actual transport ignores frames after complete DONE instead of changing output or usage', async (t) => {
  const s = setup(t),
    promise = s.start();
  s.respond();
  s.send(delta('accepted') + usage(counts) + done);
  await promise;
  s.send(
    delta('late') +
      usage({ prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 }),
  );
  assert.deepEqual(s.deltas, ['accepted']);
  assert.deepEqual(s.usages, [
    { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
  ]);
  assert.equal(s.requests.length, 1);
});
