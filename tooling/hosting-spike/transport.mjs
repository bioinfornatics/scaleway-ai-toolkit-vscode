/** Spike-only Node transport for the future extension host, not a provider adapter.
 * GET-only, one physical request, no redirects/retries/proxies, no response content
 * in errors/results. Tokens stay in process memory. Does not grant run authority.
 */
import http from 'node:http';
import https from 'node:https';
import { performance } from 'node:perf_hooks';

export class ProbeFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}

export class SyntheticSSE {
  constructor() {
    this.buffer = ''; this.last = 0; this.events = 0; this.heartbeats = 0;
    this.terminal = false; this.frame = [];
  }
  feed(text) {
    this.buffer += text;
    if (Buffer.byteLength(this.buffer) > 32768) throw new ProbeFailure('frame_limit');
    let i;
    while ((i = this.buffer.indexOf('\n')) >= 0) {
      let line = this.buffer.slice(0, i).replace(/\r$/, '');
      this.buffer = this.buffer.slice(i + 1);
      if (line === '') { this.finishFrame(); this.frame = []; }
      else {
        this.frame.push(line);
        if (Buffer.byteLength(this.frame.join('\n')) > 32768) throw new ProbeFailure('frame_limit');
      }
    }
  }
  finishFrame() {
    if (!this.frame.length) return;
    if (this.frame.every(line => line.startsWith(':'))) { this.heartbeats++; return; }
    if (this.terminal) throw new ProbeFailure('event_after_terminal');
    const ids = this.frame.filter(l => l.startsWith('id:')).map(l => l.slice(3).trim());
    const kinds = this.frame.filter(l => l.startsWith('event:')).map(l => l.slice(6).trim());
    const data = this.frame.filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
    if (ids.length !== 1 || !/^[1-9][0-9]{0,8}$/.test(ids[0]) || Number(ids[0]) !== this.last + 1
        || kinds.length !== 1 || kinds[0] !== 'probe') throw new ProbeFailure('invalid_sequence');
    let value;
    try { value = JSON.parse(data); } catch { throw new ProbeFailure('invalid_json'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProbeFailure('invalid_event');
    if (this.last === 0) {
      if (value.kind !== 'started' || Object.keys(value).length !== 1) throw new ProbeFailure('invalid_event');
    } else {
      if (value.kind !== 'deadline' || value.remote_outcome !== 'not_sent'
          || Object.keys(value).length !== 2) throw new ProbeFailure('invalid_event');
      this.terminal = true;
    }
    this.last++; this.events++;
  }
  end() {
    if (this.buffer || this.frame.length || !this.terminal) throw new ProbeFailure('truncated_stream');
  }
}

export function assessGet({origin, path, bearer, ingressToken, timeoutMs = 2000,
                            maxBytes = 65536, signal, expectedStatus = 200, stream = false}) {
  let url;
  try { url = new URL(origin); } catch { return Promise.reject(new ProbeFailure('invalid_destination')); }
  const local = url.protocol === 'http:' && url.hostname === '127.0.0.1';
  if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash
      || url.pathname !== '/' || !/^\/probe\/(health|events|sessions\/session-a(?:\?after=[0-9]{1,6})?)$/.test(path)
      || typeof bearer !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(bearer)
      || (ingressToken !== undefined && !/^[A-Za-z0-9_-]{16,256}$/.test(ingressToken))
      || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000
      || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 1048576) {
    return Promise.reject(new ProbeFailure('invalid_configuration'));
  }
  return new Promise((resolve, reject) => {
    let done = false; let bytes = 0; let firstEventMs = null; let response;
    const started = performance.now();
    const parser = new SyntheticSSE();
    const decoder = new TextDecoder('utf-8', {fatal: true});
    let req; let timer;
    const finish = (error, result) => {
      if (done) return;
      done = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel);
      response?.destroy(); req?.destroy();
      error ? reject(error) : resolve(result);
    };
    const cancel = () => finish(new ProbeFailure('cancelled'));
    if (signal?.aborted) return cancel();
    signal?.addEventListener('abort', cancel, {once: true});
    const headers = {Authorization: 'Bearer ' + bearer, Accept: stream ? 'text/event-stream' : 'application/json'};
    if (ingressToken !== undefined) headers['X-Auth-Token'] = ingressToken;
    req = (local ? http : https).request(url, {method: 'GET', path, headers, agent: false}, res => {
      response = res;
      if (res.statusCode >= 300 && res.statusCode < 400) return finish(new ProbeFailure('redirect_rejected'));
      if (res.statusCode !== expectedStatus) return finish(new ProbeFailure('unexpected_status'));
      if (stream && (!res.headers['content-type']?.startsWith('text/event-stream')
          || (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity'))) {
        return finish(new ProbeFailure('invalid_stream_headers'));
      }
      res.on('data', chunk => {
        if (done) return;
        bytes += chunk.length;
        if (bytes > maxBytes) return finish(new ProbeFailure('response_limit'));
        if (stream) {
          try {
            parser.feed(decoder.decode(chunk, {stream: true}));
            if (parser.events && firstEventMs === null) firstEventMs = performance.now() - started;
          } catch (error) {
            finish(error instanceof ProbeFailure ? error : new ProbeFailure('invalid_utf8'));
          }
        }
      });
      res.on('aborted', () => finish(new ProbeFailure('truncated_stream')));
      res.on('error', () => finish(new ProbeFailure('transport_error')));
      res.on('end', () => {
        if (done) return;
        if (stream) {
          try { parser.feed(decoder.decode()); parser.end(); }
          catch (error) { return finish(error instanceof ProbeFailure ? error : new ProbeFailure('invalid_utf8')); }
        }
        finish(null, {status: res.statusCode, bytes, physicalRequests: 1,
                      elapsedMs: Math.round(performance.now() - started),
                      firstEventMs: firstEventMs === null ? null : Math.round(firstEventMs),
                      events: stream ? parser.events : 0, heartbeats: stream ? parser.heartbeats : 0});
      });
    });
    req.on('error', () => finish(new ProbeFailure('transport_error')));
    timer = setTimeout(() => finish(new ProbeFailure('deadline')), timeoutMs);
    req.end();
  });
}
