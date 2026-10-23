const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const Module = require('node:module');
const { loadSource, domFromHtml } = require('./fixtures/htmlDom.cjs');

// Compile this isolated view in memory: tests never need a service or a build artifact.
const ts = require('typescript');
const source = fs.readFileSync(
  path.join(__dirname, '../src/servicePlaygroundView.ts'),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const view = new Module(
  path.join(__dirname, '../src/servicePlaygroundView.ts'),
  module,
);
view.filename = path.join(__dirname, '../src/servicePlaygroundView.ts');
view.paths = module.paths;
view.require = (id) =>
  id === 'vscode'
    ? { Uri: { joinPath: (root, ...parts) => [root, ...parts].join('/') } }
    : id === './dedicatedInvocationPolicy'
      ? loadSource('dedicatedInvocationPolicy')
      : require(id);
view._compile(compiled, view.filename);
const { servicePlaygroundHtml } = view.exports;
const project = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Test project',
  organizationId: '22222222-2222-2222-2222-222222222222',
};
const model = { id: 'vendor/model', label: 'Real model', kind: 'serverless' };
const webview = {
  cspSource: 'webview-resource:',
  asWebviewUri: (uri) => ({ toString: () => 'webview-resource:' + uri }),
};
const html = (row = model, scope = project, supported = true) =>
  servicePlaygroundHtml(webview, '/extension', row, scope, supported);

test('real view binds escaped model and project and exact serverless destination', () => {
  const output = html();
  assert.match(output, /Real model/);
  assert.match(output, /vendor\/model/);
  assert.match(output, /Test project/);
  assert.ok(
    output.includes(
      'https://api.scaleway.ai/' + project.id + '/v1/chat/completions',
    ),
  );
  const attack = `<script>"x" & 'y'</script>`;
  const escaped =
    '&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;';
  const unsafe = html(
    { ...model, id: attack, label: attack },
    { ...project, id: attack, name: attack },
  );
  assert.ok(!unsafe.includes(attack));
  assert.equal(unsafe.split(escaped).length - 1, 5);
  assert.equal((unsafe.match(/<script /g) || []).length, 1);
});

test('nonce-only local assets and no browser network, forms, or inline handlers', () => {
  const output = html();
  const nonce = output.match(/script-src 'nonce-([a-f0-9]{48})'/)[1];
  assert.ok(output.includes("style-src 'nonce-" + nonce + "'"));
  assert.ok(
    output.includes(
      '<link nonce="' +
        nonce +
        '" rel="stylesheet" href="webview-resource:/extension/media/playground.css">',
    ),
  );
  assert.ok(
    output.includes(
      '<script nonce="' +
        nonce +
        '" src="webview-resource:/extension/media/servicePlayground.js"></script>',
    ),
  );
  for (const directive of [
    'default-src',
    'connect-src',
    'img-src',
    'font-src',
    'base-uri',
    'form-action',
  ]) {
    assert.ok(output.includes(directive + " 'none'"));
  }
  assert.doesNotMatch(
    output,
    /unsafe-inline|unsafe-eval|<style|<form|on(?:click|load|error)=/,
  );
  assert.notEqual(html().match(/script-src 'nonce-([^']+)'/)[1], nonce);
  const hostileUri = servicePlaygroundHtml(
    { asWebviewUri: () => ({ toString: () => 'local:" onload="evil<&' }) },
    '/root',
    model,
    project,
    true,
  );
  assert.ok(hostileUri.includes('local:&quot; onload=&quot;evil&lt;&amp;'));
  assert.doesNotMatch(hostileUri, /onload="/);
});

test('blocked dedicated and unsupported serverless show no destination or demo substitute', () => {
  for (const kind of ['dedicated', 'dedicated-catalog', 'serverless']) {
    const output = html({ ...model, kind }, project, kind !== 'serverless');
    assert.match(output, /data-blocked="true"/);
    assert.match(output, /Blocked:/);
    assert.match(output, /No demo response will be substituted/);
    assert.doesNotMatch(output, /https:\/\/api.scaleway.ai/);
  }
});

test('initial limits, accessible status, billing and separate offline tool are explicit', () => {
  const output = html();
  assert.match(output, /<textarea id="prompt" maxlength="4096"/);
  assert.match(
    output,
    /id="maxTokens" type="number" min="1" max="2048" step="1" value="256"/,
  );
  assert.match(output, /id="run" disabled/);
  assert.match(output, /id="stop" class="secondary" disabled/);
  assert.match(output, /role="status" aria-live="polite"/);
  assert.match(output, /aria-busy="false"/);
  assert.match(output, /Tokens : indisponible/);
  assert.match(output, /Coût : indisponible/);
  assert.match(output, /Only Run sends one billable request/);
  assert.match(
    output,
    /not guaranteed to stop server-side processing or billing/,
  );
  assert.match(output, /<hr>\s*<section aria-label="Offline demo separation"/);
  for (const id of ['saveExchange', 'loadSnapshot', 'exportExample'])
    assert.match(
      output,
      new RegExp('<button id="' + id + '" class="secondary" disabled>'),
    );
  assert.match(
    output,
    /Save and export include prompts and outputs explicitly/,
  );
  assert.match(output, /Review sensitive data before saving or sharing/);
  assert.match(output, /no scope switch, restored consent, or automatic run/);
  assert.match(output, /never executes it/);
});

const rendererSource = fs.readFileSync(
  path.join(__dirname, '../media/servicePlayground.js'),
  'utf8',
);
function renderer(permanentlyBlocked = false) {
  class Element {
    constructor() {
      this.events = {};
      this.attributes = {};
      this.dataset = {};
      this.value = '';
      this.textContent = '';
      this.disabled = false;
    }
    addEventListener(type, handler) {
      this.events[type] = handler;
    }
    setAttribute(name, value) {
      this.attributes[name] = value;
    }
    focus() {
      this.focused = true;
    }
    set innerHTML(_value) {
      throw new Error('HTML sink');
    }
    set outerHTML(_value) {
      throw new Error('HTML sink');
    }
    insertAdjacentHTML() {
      throw new Error('HTML sink');
    }
  }
  const { get } = domFromHtml(html(), Element);
  get('service-playground').dataset.blocked = String(permanentlyBlocked);
  get('maxTokens').value = '256';
  get('usage').textContent = 'Tokens : indisponible';
  get('cost').textContent = 'Coût : indisponible';
  const sent = [];
  let receive;
  let tick;
  let now = 0;
  const forbidden = () => {
    throw new Error('Network or persistence forbidden');
  };
  vm.runInNewContext(rendererSource, {
    Date: { now: () => now },
    setInterval: (callback) => {
      tick = callback;
    },
    acquireVsCodeApi: () => ({
      postMessage: (message) => sent.push(JSON.parse(JSON.stringify(message))),
      setState: forbidden,
      getState: forbidden,
    }),
    document: { getElementById: get },
    window: {
      addEventListener: (type, handler) => {
        assert.equal(type, 'message');
        receive = handler;
      },
    },
    fetch: forbidden,
    XMLHttpRequest: forbidden,
    WebSocket: forbidden,
    localStorage: { setItem: forbidden },
  });
  return {
    get,
    sent,
    tick: (milliseconds) => {
      now += milliseconds;
      tick();
    },
    click: (id) => get(id).events.click(),
    receive: (data) => receive({ data }),
    state: (data = {}) =>
      receive({
        data: {
          type: 'state',
          runId: 0,
          running: false,
          blocked: false,
          output: '',
          status: 'Ready',
          ...data,
        },
      }),
  };
}

test('ready is exact and only valid host state enables Run', () => {
  const ui = renderer();
  assert.deepEqual(ui.sent, [{ type: 'ready' }]);
  assert.equal(ui.get('run').disabled, true);
  assert.equal(ui.get('stop').disabled, true);
  ui.get('prompt').value = 'Hello';
  ui.click('run');
  ui.click('stop');
  for (const bad of [
    null,
    {},
    { type: 'ready' },
    { type: 'state', runId: '0' },
  ])
    ui.receive(bad);
  for (const runId of [-1, NaN, 1.5, Infinity]) ui.state({ runId });
  assert.equal(ui.get('run').disabled, true);
  assert.equal(ui.sent.length, 1);
  ui.state();
  assert.equal(ui.get('run').disabled, false);
  assert.equal(ui.get('stop').disabled, true);
});

test('Run posts exact bounded intent once, locks pending duplicate click, and preserves prompt', () => {
  const ui = renderer();
  ui.state();
  ui.get('prompt').value = '  Hello <script>  ';
  ui.click('run');
  assert.deepEqual(ui.sent.at(-1), {
    type: 'run',
    prompt: '  Hello <script>  ',
    maxTokens: 256,
  });
  assert.equal(ui.get('run').disabled, true);
  assert.equal(ui.get('stop').disabled, false);
  assert.equal(ui.get('response').attributes['aria-busy'], 'true');
  ui.click('run');
  ui.state();
  ui.click('run');
  assert.equal(ui.sent.length, 2);
  ui.get('prompt').value = 'User edit during run';
  ui.state({
    runId: 1,
    running: true,
    output: '<img src=x onerror=evil()>',
    prompt: 'must not replace user input',
  });
  assert.equal(ui.get('response').textContent, '<img src=x onerror=evil()>');
  assert.equal(ui.get('prompt').value, 'User edit during run');
  ui.state({ runId: 1, output: 'Done' });
  assert.equal(ui.get('run').disabled, false);
  assert.equal(ui.get('stop').disabled, true);
  assert.equal(ui.get('response').attributes['aria-busy'], 'false');
});

test('invalid prompts and token limits never post; valid boundaries do', () => {
  const ui = renderer();
  ui.state();
  for (const prompt of ['', '   ', 'x'.repeat(4097)]) {
    ui.get('prompt').value = prompt;
    ui.click('run');
  }
  ui.get('prompt').value = 'valid';
  for (const tokens of ['', '0', '-1', '2049', '2.5', 'NaN', 'Infinity']) {
    ui.get('maxTokens').value = tokens;
    ui.click('run');
  }
  assert.equal(ui.sent.length, 1);
  for (const tokens of [1, 2048]) {
    const boundary = renderer();
    boundary.state();
    boundary.get('prompt').value = 'x'.repeat(4096);
    boundary.get('maxTokens').value = String(tokens);
    boundary.click('run');
    assert.deepEqual(boundary.sent.at(-1), {
      type: 'run',
      prompt: 'x'.repeat(4096),
      maxTokens: tokens,
    });
  }
});

test('Ctrl+Enter requests one run and cannot bypass running or blocked controls', () => {
  const ui = renderer();
  ui.state();
  ui.get('prompt').value = 'keyboard';
  let prevented = 0;
  const event = {
    ctrlKey: true,
    key: 'Enter',
    preventDefault: () => prevented++,
  };
  ui.get('prompt').events.keydown(event);
  ui.get('prompt').events.keydown(event);
  assert.equal(prevented, 1);
  assert.deepEqual(ui.sent.at(-1), {
    type: 'run',
    prompt: 'keyboard',
    maxTokens: 256,
  });
  for (const permanent of [false, true]) {
    const blocked = renderer(permanent);
    blocked.state({ blocked: !permanent });
    blocked.get('prompt').value = 'blocked';
    blocked.click('run');
    blocked.get('prompt').events.keydown(event);
    assert.equal(blocked.sent.length, 1);
    assert.equal(blocked.get('run').disabled, true);
  }
});

test('older run IDs cannot overwrite text, controls, usage, or cost', () => {
  const ui = renderer();
  ui.state({
    runId: 4,
    output: '<unsafe>',
    usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    cost: '<0.01 EUR>',
  });
  assert.equal(
    ui.get('usage').textContent,
    'Tokens : 1 input · 2 output · 3 total tokens',
  );
  assert.equal(ui.get('cost').textContent, 'Coût : <0.01 EUR>');
  ui.state({ runId: 3, running: true, blocked: true, output: 'old' });
  assert.equal(ui.get('response').textContent, '<unsafe>');
  assert.equal(ui.get('run').disabled, false);
  assert.equal(ui.get('cost').textContent, 'Coût : <0.01 EUR>');
  ui.state({ runId: 5 });
  assert.equal(ui.get('usage').textContent, 'Tokens : indisponible');
  assert.equal(ui.get('cost').textContent, 'Coût : indisponible');
  ui.state({
    runId: 5,
    usage: { inputTokens: -1, outputTokens: 2, totalTokens: 1 },
    cost: 0,
  });
  assert.equal(ui.get('usage').textContent, 'Tokens : indisponible');
  assert.equal(ui.get('cost').textContent, 'Coût : indisponible');
});

test('Stop posts cancel once, freezes updates, waits for settlement, and supports a fresh run', () => {
  const ui = renderer();
  ui.state();
  ui.get('prompt').value = 'Original';
  ui.click('run');
  ui.state({ runId: 1, running: true, output: 'Partial' });
  ui.get('prompt').value = 'Next prompt';
  ui.click('stop');
  ui.click('stop');
  assert.deepEqual(ui.sent, [
    { type: 'ready' },
    { type: 'run', prompt: 'Original', maxTokens: 256 },
    { type: 'cancel' },
  ]);
  assert.equal(ui.get('response').attributes['aria-busy'], 'false');
  assert.match(ui.get('status').textContent, /billing may continue/);
  ui.state({
    runId: 1,
    running: true,
    output: 'Late chunk',
    status: 'Streaming',
  });
  assert.equal(ui.get('response').textContent, 'Partial');
  assert.equal(ui.get('run').disabled, true);
  ui.state({
    runId: 1,
    output: 'Cancelled',
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    cost: '1 EUR',
  });
  assert.equal(ui.get('response').textContent, 'Partial');
  assert.equal(ui.get('usage').textContent, 'Tokens : indisponible');
  assert.equal(ui.get('cost').textContent, 'Coût : indisponible');
  assert.equal(ui.get('prompt').value, 'Next prompt');
  assert.equal(ui.get('run').disabled, false);
  ui.click('run');
  ui.state({ runId: 2, output: 'New response' });
  assert.equal(ui.get('response').textContent, 'New response');
});

test('renderer has no HTML sinks, browser transport, secret fields, or persistence', () => {
  assert.doesNotMatch(
    rendererSource,
    /innerHTML|outerHTML|insertAdjacentHTML|document[.]write|fetch\s*\(|XMLHttpRequest|WebSocket|eval\s*\(|localStorage|setState|getState/,
  );
  assert.doesNotMatch(
    rendererSource,
    /postMessage\([^;]*(?:model:|url:|key:|token:)/,
  );
});

test('real renderer and host controller roundtrip: selected configurable model, streaming, stop, next-run isolation and usage', async () => {
  const { ServicePlayground } = loadSource('servicePlayground');
  const ui = renderer();
  const abort = new AbortController();
  const calls = [];
  const row = {
    id: 'never-live-tested-roundtrip-model',
    label: 'Roundtrip',
    kind: 'serverless',
    serverlessCapabilities: {
      tasks: ['chat'],
      supportedApis: ['/v1/chat/completions'],
      textChat: 'supported',
      source: 'public-catalog',
    },
  };
  const scope = {
    project,
    signal: abort.signal,
    current: () => !abort.signal.aborted,
    authorize: () => '33333333-3333-3333-3333-333333333333',
    dispose: () => abort.abort(),
  };
  const controller = new ServicePlayground(
    row,
    scope,
    (state) => ui.receive(state),
    (input, delta, usage) =>
      new Promise((resolve, reject) =>
        calls.push({ input, delta, usage, resolve, reject }),
      ),
  );
  await controller.receive(ui.sent[0]);
  assert.equal(calls.length, 0);
  assert.equal(ui.get('run').disabled, false);
  ui.get('prompt').value = 'first';
  ui.click('run');
  const first = controller.receive(ui.sent.at(-1));
  assert.equal(calls[0].input.modelId, row.id);
  assert.equal(ui.get('run').disabled, true);
  calls[0].delta('partial');
  assert.equal(ui.get('response').textContent, 'partial');
  ui.click('stop');
  await controller.receive(ui.sent.at(-1));
  assert.ok(calls[0].input.signal.aborted);
  assert.equal(ui.get('response').textContent, 'partial');
  assert.equal(ui.get('run').disabled, false);
  ui.get('prompt').value = 'second';
  ui.click('run');
  const second = controller.receive(ui.sent.at(-1));
  calls[0].delta('late');
  calls[0].resolve();
  await first;
  assert.equal(ui.get('response').textContent, '');
  assert.equal(ui.get('run').disabled, true);
  calls[1].delta('final');
  calls[1].usage({ inputTokens: 2, outputTokens: 1, totalTokens: 3 });
  calls[1].resolve();
  await second;
  assert.equal(ui.get('response').textContent, 'final');
  assert.match(ui.get('usage').textContent, /2 input/);
  assert.equal(ui.get('cost').textContent, 'Coût : indisponible');
  assert.equal(ui.get('run').disabled, false);
  abort.abort();
  assert.equal(ui.get('run').disabled, true);
  controller.dispose();
});

for (const phase of ['idle', 'pending', 'streaming', 'stopped']) {
  test('host loss permanently freezes ' + phase + ' webview', () => {
    const ui = renderer();
    ui.state();
    ui.get('prompt').value = 'Do not replay';
    if (phase !== 'idle') ui.click('run');
    if (phase === 'streaming' || phase === 'stopped')
      ui.state({ runId: 1, running: true, output: 'Partial' });
    if (phase === 'stopped') ui.click('stop');
    const partial = ui.get('response').textContent;
    ui.tick(1000);
    assert.deepEqual(ui.sent.at(-1), { type: 'ready' });
    ui.tick(5001);
    assert.equal(ui.get('run').disabled, true);
    assert.equal(ui.get('stop').disabled, true);
    assert.equal(ui.get('response').attributes['aria-busy'], 'false');
    assert.match(
      ui.get('status').textContent,
      /Session ou extension interrompue/,
    );
    assert.equal(ui.get('response').textContent, partial);
    const sends = ui.sent.length;
    ui.state({ runId: 100, running: false, output: 'Late after restart' });
    ui.click('run');
    ui.click('stop');
    ui.tick(1000);
    assert.equal(ui.sent.length, sends);
    assert.equal(ui.get('response').textContent, partial);
    assert.equal(ui.get('run').disabled, true);
  });
}
test('valid original-host acknowledgements maintain liveness without inference', () => {
  const ui = renderer();
  ui.state();
  for (let i = 0; i < 20; i++) {
    ui.tick(1000);
    ui.state();
  }
  assert.equal(ui.get('run').disabled, false);
  assert.equal(ui.sent.filter((m) => m.type === 'run').length, 0);
});

test('pending same-run acknowledgement maintains liveness without unlocking or overwriting', () => {
  const ui = renderer();
  ui.state();
  ui.get('prompt').value = 'Pending';
  ui.click('run');
  for (let i = 0; i < 10; i++) {
    ui.tick(1000);
    ui.state();
  }
  assert.equal(ui.get('run').disabled, true);
  assert.doesNotMatch(ui.get('status').textContent, /interrompue/);
  ui.state({ runId: 1, running: true, output: 'First' });
  assert.equal(ui.get('response').textContent, 'First');
});
test('invalid heartbeats cannot prolong an orphaned webview', () => {
  const ui = renderer();
  ui.state();
  ui.tick(3000);
  ui.receive({ type: 'state', runId: 'invalid' });
  ui.tick(3000);
  assert.match(ui.get('status').textContent, /interrompue/);
});
test('scope invalidation overrides local Stop status and blocks both controls', () => {
  const ui = renderer();
  ui.state();
  ui.get('prompt').value = 'Stop';
  ui.click('run');
  ui.state({ runId: 1, running: true, output: 'Partial' });
  ui.click('stop');
  ui.state({
    runId: 1,
    blocked: true,
    status: 'Session invalidée',
    output: 'Partial',
  });
  assert.equal(ui.get('status').textContent, 'Session invalidée');
  assert.equal(ui.get('run').disabled, true);
  assert.equal(ui.get('stop').disabled, true);
});

test('approved dedicated view shows exact endpoint, real authentication, provider model and duration billing', () => {
  const did = '33333333-3333-3333-3333-333333333333';
  for (const authentication of ['iam', 'disabled']) {
    const endpoint = {
      id: '44444444-4444-4444-4444-444444444444',
      url: 'https://' + did + '.ifr.fr-par.scaleway.com/v1',
      network: 'public',
      authentication,
    };
    const row = {
      id: did,
      label: 'Dedicated',
      kind: 'dedicated',
      status: 'ready',
      deploymentInfo: {
        projectId: project.id,
        region: 'fr-par',
        modelId: '55555555-5555-5555-5555-555555555555',
        modelName: 'meta/llama:fp8',
        endpoints: [endpoint],
      },
    };
    const approval = {
      organizationId: project.organizationId,
      projectId: project.id,
      region: 'fr-par',
      deploymentId: did,
      endpointId: endpoint.id,
      endpointUrl: endpoint.url,
      modelName: row.deploymentInfo.modelName,
      authentication,
      allowUnauthenticated: authentication === 'disabled',
      approvedAt: Date.now() - 1000,
      expiresAt: Date.now() + 1800000,
    };
    const output = servicePlaygroundHtml(
      webview,
      '/extension',
      row,
      project,
      false,
      approval,
    );
    assert.match(output, /data-blocked="false"/);
    assert.ok(output.includes(endpoint.url + '/chat/completions'));
    assert.match(output, /Deployment ID/);
    assert.ok(output.includes('meta/llama:fp8'));
    assert.match(output, /duration, not tokens/);
    assert.match(output, /No serverless token cost estimate/);
    assert.match(
      output,
      authentication === 'iam'
        ? /IAM · API key sent on Run only/
        : /DISABLED · public unauthenticated endpoint · no token sent/,
    );
    assert.match(output, /30 minutes/);
    assert.match(output, /not a cloud-agent mandate/);
    assert.ok(!output.includes('https://api.scaleway.ai'));
    const blocked = servicePlaygroundHtml(
      webview,
      '/extension',
      row,
      project,
      true,
      { ...approval, endpointUrl: 'https://evil.invalid' },
    );
    assert.match(blocked, /data-blocked="true"/);
    assert.ok(!blocked.includes('https://evil.invalid'));
  }
});

test('snapshot actions post bounded intents only and never replay prompts or restore authority', () => {
  const ui = renderer();
  ui.state();
  ui.get('prompt').value = 'keep local prompt';
  ui.click('saveExchange');
  ui.click('exportExample');
  assert.equal(ui.sent.length, 1);
  ui.click('loadSnapshot');
  assert.deepEqual(ui.sent.at(-1), { type: 'loadSnapshot' });
  ui.state({
    actionBusy: false,
    snapshotAvailable: true,
    output: 'host response',
  });
  for (const type of ['saveExchange', 'exportExample']) {
    ui.click(type);
    assert.deepEqual(ui.sent.at(-1), { type });
    ui.state({
      snapshotAvailable: true,
      actionBusy: false,
      output: 'host response',
    });
  }
  assert.equal(ui.get('prompt').value, 'keep local prompt');
  assert.equal(ui.sent.filter((message) => message.type === 'run').length, 0);
  assert.ok(
    ui.sent.every(
      (message) =>
        !('prompt' in message) &&
        !('scope' in message) &&
        !('consent' in message),
    ),
  );
});
