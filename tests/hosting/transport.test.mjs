import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import { assessGet, SyntheticSSE } from '../../tooling/hosting-spike/transport.mjs';

async function fixture(fn) {
  const child = spawn('python3', [new URL('./node_fixture.py', import.meta.url).pathname], {
    stdio: ['pipe', 'ignore', 'ignore', 'pipe'],
    env: {PATH: process.env.PATH, PYTHONUNBUFFERED: '1'},
  });
  const exit = once(child, 'exit');
  let timer;
  try {
    const config = await new Promise((resolve, reject) => {
      let text = '';
      timer = setTimeout(() => reject(new Error('bootstrap_timeout')), 3000);
      child.on('error', () => reject(new Error('bootstrap_failed')));
      child.stdio[3].on('data', chunk => {
        text += chunk.toString();
        if (text.length > 4096) return reject(new Error('bootstrap_limit'));
        if (text.includes('\n')) { clearTimeout(timer); resolve(JSON.parse(text)); }
      });
      child.stdio[3].on('end', () => { if (!text) reject(new Error('bootstrap_failed')); });
    });
    return await fn(config);
  } finally {
    clearTimeout(timer); child.stdin.end();
    const kill = setTimeout(() => child.kill('SIGKILL'), 2000);
    await exit; clearTimeout(kill);
  }
}

async function responder(handler, fn) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    return await fn({origin: 'http://127.0.0.1:' + server.address().port, bearer: 'a'.repeat(64)});
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}

const start = 'id: 1\r\nevent: probe\r\ndata: {"kind":"started"}\r\n\r\n';
const terminal = 'id: 2\nevent: probe\ndata: {"kind":"deadline","remote_outcome":"not_sent"}\n\n';

test('Node -> Python authenticated SSE delivered before terminal', async () => {
  await fixture(async config => {
    const result = await assessGet({...config, path: '/probe/events', stream: true});
    assert.equal(result.events, 2); assert.ok(result.heartbeats > 0);
    assert.ok(result.firstEventMs < result.elapsedMs - 150);
    assert.equal(result.physicalRequests, 1);
    assert.ok(!JSON.stringify(result).includes(config.bearer));
  });
});
test('Node -> Python unauthorized response never becomes success', async () => {
  await fixture(config => assert.rejects(assessGet({...config, bearer: 'b'.repeat(64), path: '/probe/health'}), {code: 'unexpected_status'}));
});
test('deadline interrupts rather than waits for full stream', async () => {
  await fixture(config => assert.rejects(assessGet({...config, path: '/probe/events', stream: true, timeoutMs: 70}), {code: 'deadline'}));
});
test('AbortSignal interrupts an open stream', async () => {
  await fixture(async config => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60);
    try {
      await assert.rejects(assessGet({...config, path: '/probe/events', stream: true, signal: controller.signal}), {code: 'cancelled'});
    } finally { clearTimeout(timer); }
  });
});
test('pre-aborted operation performs no request', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(assessGet({origin: 'http://127.0.0.1:1', path: '/probe/health', bearer: 'a'.repeat(64), signal: controller.signal}), {code: 'cancelled'});
});
test('replay read has one request and no launch', async () => {
  await fixture(async config => {
    const r = await assessGet({...config, path: '/probe/sessions/session-a?after=1'});
    assert.equal(r.status, 200); assert.equal(r.physicalRequests, 1);
  });
});
test('redirect never followed and secrets never returned', async () => {
  let sends = 0;
  await responder((req, res) => { sends++; res.writeHead(302, {Location: 'http://127.0.0.1:1/steal'}); res.end('sensitive'); }, async config => {
    await assert.rejects(assessGet({...config, path: '/probe/health'}), {code: 'redirect_rejected'});
    assert.equal(sends, 1);
  });
});
test('response bytes are bounded', async () => {
  await responder((req, res) => res.end('a'.repeat(1024)), config =>
    assert.rejects(assessGet({...config, path: '/probe/health', maxBytes: 128}), {code: 'response_limit'}));
});
test('stream truncation not successful', async () => {
  await responder((req, res) => { res.setHeader('Content-Type', 'text/event-stream'); res.end(start); }, config =>
    assert.rejects(assessGet({...config, path: '/probe/events', stream: true}), {code: 'truncated_stream'}));
});
test('fragmented CRLF frames and comment heartbeat', () => {
  const parser = new SyntheticSSE();
  for (const char of start + ': heartbeat\n\n' + terminal) parser.feed(char);
  parser.end(); assert.equal(parser.events, 2); assert.equal(parser.heartbeats, 1);
});
test('gaps, wrong version/event and post-terminal data rejected', () => {
  for (const frame of [start.replace('id: 1', 'id: 2'), start.replace('event: probe', 'event: unknown')]) {
    assert.throws(() => new SyntheticSSE().feed(frame));
  }
  const parser = new SyntheticSSE(); parser.feed(start + terminal);
  assert.throws(() => parser.feed(terminal), {code: 'event_after_terminal'});
});
test('oversized frame rejected', () => {
  assert.throws(() => new SyntheticSSE().feed('a'.repeat(32769)), {code: 'frame_limit'});
});
test('unsafe destinations/routes rejected before dispatch', async () => {
  for (const origin of ['http://example.com', 'https://user:pass@example.com', 'https://example.com?token=secret']) {
    await assert.rejects(assessGet({origin, path: '/probe/health', bearer: 'a'.repeat(64)}), {code: 'invalid_configuration'});
  }
  await assert.rejects(assessGet({origin: 'http://127.0.0.1:1', path: '/runs', bearer: 'a'.repeat(64)}), {code: 'invalid_configuration'});
});
