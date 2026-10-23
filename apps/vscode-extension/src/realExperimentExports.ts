import { Buffer } from 'node:buffer';
import { parseRealExperiment, type RealExperiment } from './realExperiments';

/** Standard-library standalone examples; exporting never invokes a provider. */
export function exportRealExample(
  e: RealExperiment,
  language: 'python' | 'typescript',
): string {
  const parsed = parseRealExperiment(e);
  if (!parsed || !['python', 'typescript'].includes(language))
    throw new Error('invalid_real_export');
  const data = Buffer.from(JSON.stringify(parsed)).toString('base64');
  const warning =
    'MOCK DEFAULT: no cloud or credential access. --live opts in to ONE possibly billed POST to the exact saved destination. No redirects/retries/fallback/provisioning. Review organization/project/model/deployment/endpoint and current approval before live use. Saved status/output/estimates are historical, NOT this run. Public-catalog estimates are not actual charges; actual cost UNKNOWN. Dedicated billing is deployment-duration, including idle time; stopping this script does not stop/delete deployment. IAM uses external SCW_SECRET_KEY only with --live. Disabled authentication sends NO secret; public unauthenticated endpoint risk. Live templates locally tested only, NOT cloud-validated.';
  const header =
    language === 'python'
      ? '# python3 experiment.py [--live]\n# '
      : '// node --experimental-strip-types experiment.ts [--live] (Node22.6+)\n// ';
  return (
    header +
    warning +
    '\n' +
    (language === 'python' ? python : typescript)
      .replace('@@DATA@@', data)
      .replace('@@WARNING@@', JSON.stringify(warning))
  );
}
const python = String.raw`import base64, json, sys, os, re, ssl, time, http.client
from urllib.parse import urlsplit
experiment = json.loads(base64.b64decode('@@DATA@@').decode('utf-8', errors='strict'))
WARNING = @@WARNING@@
LIMIT, FRAME = 2 * 1024 * 1024, 64 * 1024

def main(args=None):
    args = sys.argv[1:] if args is None else args
    if args not in ([], ['--live']): raise SystemExit('usage: experiment.py [--live]')
    live = args == ['--live']
    print(WARNING, file=sys.stderr)
    s = experiment['service']
    model = s['modelName'] if s['kind'] == 'dedicated' else s['modelId']
    report = {'kind': 'real-experiment-run', 'sourceStatus': experiment['status'], 'environment': 'live' if live else 'local-mock', 'billed': 'possible' if live else 'none', 'actualCost': 'unknown', 'status': 'failed', 'output': ''}
    conn = response = None
    try:
        if s['kind'] == 'serverless':
            expected = 'https://api.scaleway.ai/' + s['projectId'] + '/v1/chat/completions'
            if s['authentication'] != 'iam': raise ValueError()
        else:
            origin = 'https://' + s['deploymentId'].lower() + '.ifr.fr-par.scaleway.com'
            if s['region'] != 'fr-par' or s['endpointUrl'] not in [origin, origin+'/', origin+'/v1', origin+'/v1/']: raise ValueError()
            expected = origin + '/v1/chat/completions'
        if s['destination'] != expected: raise ValueError()
        body = json.dumps({'model': model, 'messages': [{'role': 'user', 'content': experiment['prompt']}], 'max_tokens': experiment['maxTokens'], 'stream': True}).encode('utf-8')
        if live:
            headers = {'Content-Type': 'application/json', 'Accept': 'text/event-stream', 'Content-Length': str(len(body))}
            if s['authentication'] == 'iam':
                secret = os.environ.get('SCW_SECRET_KEY', '')
                if not re.fullmatch(r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}', secret): raise ValueError()
                headers['Authorization'] = 'Bearer ' + secret
            elif s['authentication'] != 'disabled': raise ValueError()
            url = urlsplit(expected)
            deadline = time.monotonic() + 60
            conn = http.client.HTTPSConnection(url.hostname, 443, timeout=15, context=ssl.create_default_context())
            conn.connect()
            sock = conn.sock
            conn.request('POST', url.path, body=body, headers=headers)
            sock.settimeout(min(15, max(0.001, deadline-time.monotonic())))
            response = conn.getresponse()
            if response.status != 200 or response.getheader('Content-Type', '').split(';')[0].strip().lower() != 'text/event-stream': raise ValueError()
            def chunks():
                while True:
                    remaining = deadline-time.monotonic()
                    if remaining <= 0: raise ValueError()
                    sock.settimeout(min(15, remaining))
                    chunk = response.read1(4096)
                    if not chunk: return
                    yield chunk
            source = chunks()
        else:
            fixture = {'model': model, 'choices': [{'index': 0, 'delta': {'content': 'Local mock invocation; no cloud request.'}, 'finish_reason': 'stop'}]}
            source = [('data: '+json.dumps(fixture)+'\n\ndata: [DONE]\n\n').encode('utf-8')]
        pending = b''
        total = frame_bytes = output_bytes = 0
        data, event, done, finished = [], '', False, False
        for chunk in source:
            total += len(chunk)
            if total > LIMIT: raise ValueError()
            pending += chunk
            while b'\n' in pending:
                line, pending = pending.split(b'\n', 1)
                frame_bytes += len(line)+1
                if frame_bytes > FRAME: raise ValueError()
                text = line.decode('utf-8', errors='strict').removesuffix('\r')
                if text:
                    if text.startswith(':'): continue
                    field, sep, value = text.partition(':')
                    if value.startswith(' '): value = value[1:]
                    if field == 'data': data.append(value)
                    if field == 'event': event = value
                    continue
                payload = '\n'.join(data)
                data, frame_bytes = [], 0
                if event == 'error': raise ValueError()
                event = ''
                if not payload: continue
                if payload == '[DONE]':
                    done = True
                    break
                v = json.loads(payload)
                if not isinstance(v, dict) or v.get('error') is not None or v.get('model', model) != model or not isinstance(v.get('choices'), list): raise ValueError()
                seen = False
                for choice in v['choices']:
                    if not isinstance(choice, dict) or type(choice.get('index')) is not int or choice['index'] < 0: raise ValueError()
                    if choice['index'] != 0: continue
                    if seen or not isinstance(choice.get('delta'), dict): raise ValueError()
                    seen = True
                    content = choice['delta'].get('content')
                    if content is not None and not isinstance(content, str): raise ValueError()
                    if content:
                        if finished: raise ValueError()
                        output_bytes += len(content.encode('utf-8', errors='strict'))
                        if output_bytes > LIMIT: raise ValueError()
                        report['output'] += content
                    finish = choice.get('finish_reason')
                    if finish is not None:
                        if finish not in ('stop', 'length'): raise ValueError()
                        finished = True
            if done: break
            if len(pending)+frame_bytes > FRAME: raise ValueError()
        if not done: raise ValueError()
        report['status'] = 'completed'
    except KeyboardInterrupt:
        report['status'] = 'cancelled'
    except Exception:
        report['status'] = 'partial' if report['output'] else 'failed'
    finally:
        if response is not None: response.close()
        if conn is not None: conn.close()
    print(json.dumps(report, ensure_ascii=False))
    return report

if __name__ == '__main__':
    main()
`;
const typescript = String.raw`import * as https from 'node:https';
import { pathToFileURL } from 'node:url';
export const experiment = JSON.parse(Buffer.from('@@DATA@@', 'base64').toString('utf8'));
const WARNING = @@WARNING@@;
const LIMIT = 2 * 1024 * 1024, FRAME = 64 * 1024;
export async function main(args = process.argv.slice(2)) {
  if (args.length && (args.length !== 1 || args[0] !== '--live')) throw new Error('usage: experiment.ts [--live]');
  const live = args[0] === '--live', s = experiment.service;
  console.error(WARNING);
  const report = { kind: 'real-experiment-run', sourceStatus: experiment.status, environment: live ? 'live' : 'local-mock', billed: live ? 'possible' : 'none', actualCost: 'unknown', status: 'failed', output: '' };
  const model = s.kind === 'dedicated' ? s.modelName : s.modelId;
  let req, res, timer, interrupt;
  try {
    let expected;
    if (s.kind === 'serverless') {
      expected = 'https://api.scaleway.ai/' + s.projectId + '/v1/chat/completions';
      if (s.authentication !== 'iam') throw new Error();
    } else {
      const origin = 'https://' + s.deploymentId.toLowerCase() + '.ifr.fr-par.scaleway.com';
      if (s.region !== 'fr-par' || !['', '/', '/v1', '/v1/'].some(p => s.endpointUrl === origin+p)) throw new Error();
      expected = origin+'/v1/chat/completions';
    }
    if (s.destination !== expected) throw new Error();
    const body = JSON.stringify({ model, messages: [{ role: 'user', content: experiment.prompt }], max_tokens: experiment.maxTokens, stream: true });
    let source;
    if (live) {
      const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream', 'Content-Length': Buffer.byteLength(body) };
      if (s.authentication === 'iam') {
        const secret = process.env.SCW_SECRET_KEY || '';
        if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(secret)) throw new Error();
        headers.Authorization = 'Bearer '+secret;
      } else if (s.authentication !== 'disabled') throw new Error();
      source = await new Promise((resolve, reject) => {
        const url = new URL(expected);
        req = https.request({ hostname: url.hostname, port: 443, path: url.pathname, method: 'POST', headers, rejectUnauthorized: true, agent: false }, incoming => {
          res = incoming;
          res.on('error', reject);
          if (res.statusCode !== 200 || !/^text\/event-stream(?:\s*;|\s*$)/i.test(res.headers['content-type'] || '')) { res.destroy(); reject(new Error()); }
          else resolve(res);
        });
        const fail = () => { req.destroy(new Error()); res?.destroy(new Error()); reject(new Error()); };
        timer = setTimeout(fail, 60000);
        req.setTimeout(15000, fail);
        interrupt = () => { report.status = 'cancelled'; fail(); };
        process.once('SIGINT', interrupt);
        req.on('error', reject);
        req.end(body);
      });
    } else {
      const fixture = { model, choices: [{ index: 0, delta: { content: 'Local mock invocation; no cloud request.' }, finish_reason: 'stop' }] };
      source = [Buffer.from('data: '+JSON.stringify(fixture)+'\n\ndata: [DONE]\n\n')];
    }
    let pending = Buffer.alloc(0), total = 0, frameBytes = 0, outputBytes = 0, data = [], event = '', done = false, finished = false;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for await (const chunk of source) {
      total += chunk.length;
      if (total > LIMIT) throw new Error();
      pending = Buffer.concat([pending, chunk]);
      let newline;
      while ((newline = pending.indexOf(10)) >= 0) {
        const line = pending.subarray(0, newline); pending = pending.subarray(newline+1);
        frameBytes += line.length+1;
        if (frameBytes > FRAME) throw new Error();
        const text = decoder.decode(line).replace(/\r$/, '');
        if (text) {
          if (text.startsWith(':')) continue;
          const colon = text.indexOf(':'), field = colon < 0 ? text : text.slice(0, colon);
          let value = colon < 0 ? '' : text.slice(colon+1);
          if (value.startsWith(' ')) value = value.slice(1);
          if (field === 'data') data.push(value);
          if (field === 'event') event = value;
          continue;
        }
        const payload = data.join('\n'); data = []; frameBytes = 0;
        if (event === 'error') throw new Error();
        event = '';
        if (!payload) continue;
        if (payload === '[DONE]') { done = true; break; }
        const v = JSON.parse(payload);
        if (!v || typeof v !== 'object' || v.error != null || (v.model !== undefined && v.model !== model) || !Array.isArray(v.choices)) throw new Error();
        let seen = false;
        for (const choice of v.choices) {
          if (!choice || !Number.isSafeInteger(choice.index) || choice.index < 0) throw new Error();
          if (choice.index !== 0) continue;
          if (seen || !choice.delta || typeof choice.delta !== 'object' || Array.isArray(choice.delta)) throw new Error();
          seen = true;
          const content = choice.delta.content;
          if (content != null && typeof content !== 'string') throw new Error();
          if (content) {
            if (finished || decoder.decode(Buffer.from(content)) !== content) throw new Error();
            outputBytes += Buffer.byteLength(content);
            if (outputBytes > LIMIT) throw new Error();
            report.output += content;
          }
          if (choice.finish_reason != null) {
            if (!['stop', 'length'].includes(choice.finish_reason)) throw new Error();
            finished = true;
          }
        }
      }
      if (done) break;
      if (pending.length+frameBytes > FRAME) throw new Error();
    }
    if (!done) throw new Error();
    report.status = 'completed';
  } catch {
    if (report.status !== 'cancelled') report.status = report.output ? 'partial' : 'failed';
  } finally {
    clearTimeout(timer);
    if (interrupt) process.removeListener('SIGINT', interrupt);
    res?.destroy(); req?.destroy();
  }
  console.log(JSON.stringify(report));
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
`;
