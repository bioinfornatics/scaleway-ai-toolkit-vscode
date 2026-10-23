// Installed-only synthetic scope; native UI and production dedicated transport retained.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const vscode = require('vscode');
exports.run = async () => {
  const resultPath = process.env.SCALEWAY_DEDICATED_QA_RESULT;
  const missing = process.env.SCALEWAY_DEDICATED_QA_SCOPE === 'missing';
  const ext = vscode.extensions.getExtension(
    'scaleway-ai-community-preview.scaleway-ai-toolkit-preview',
  );
  assert.ok(ext);
  assert.equal(ext.isActive, false);
  const root = ext.extensionPath,
    connection = require(path.join(root, 'dist/connection.js'));
  const org = '11111111-1111-1111-1111-111111111111',
    pid = '22222222-2222-2222-2222-222222222222',
    did = '33333333-3333-3333-3333-333333333333',
    mid = '55555555-5555-5555-5555-555555555555';
  const secret = '66666666-6666-6666-6666-666666666666';
  const modelName = 'vendor/model:fp8';
  const model = {
    id: did,
    label: 'QA dedicated MOCK',
    kind: 'dedicated',
    status: 'ready',
    deploymentInfo: {
      projectId: pid,
      region: 'fr-par',
      modelId: mid,
      modelName,
      endpoints: [
        {
          id: '44444444-4444-4444-4444-444444444444',
          url: `https://${did}.ifr.fr-par.scaleway.com/v1/`,
          network: 'public',
          authentication: 'iam',
        },
        {
          id: '77777777-7777-7777-7777-777777777777',
          url: `https://${did}.ifr.fr-par.scaleway.com/v1`,
          network: 'public',
          authentication: 'disabled',
        },
      ],
    },
  };
  let instance,
    credentials = 0,
    panels = 0,
    lateFrames = 0;
  const calls = [],
    aborts = [],
    checks = [],
    stages = [];
  const stage = (name) => {
    stages.push(name);
    fs.writeFileSync(
      `${resultPath}.stages`,
      JSON.stringify({
        stages,
        calls: calls.length,
        credentials,
        panels,
        aborts,
        lateFrames,
        connected: instance?.connected,
        trusted: vscode.workspace.isTrusted,
        pid: process.pid,
      }),
    );
  };
  const check = (name, ok) => {
    checks.push({ name, passed: !!ok });
    assert.ok(ok, name);
  };
  connection.Connection.prototype.restoreSession = async function () {
    instance = this;
    this.apiKey = {
      userId: org,
      accessKey: 'SCW12345678901234567',
      secretKey: secret,
      expiresAt: Date.now() + 3600000,
    };
    this.installSession({
      userId: org,
      token: 'SYNTHETIC-NOT-REAL',
      expiresAt: Date.now() + 3600000,
    });
    this.project = {
      id: pid,
      organizationId: org,
      name: 'QA synthetic project',
    };
    this.dedicated = [model];
  };
  // Synthetic GET result only: no account lookup and no modification of invocation.
  connection.Connection.prototype.deploymentDetails = async () => model;
  const originalToken = connection.Connection.prototype.token;
  connection.Connection.prototype.token = function () {
    credentials++;
    return originalToken.call(this);
  };
  const https = require('node:https'),
    http = require('node:http');
  const deny = () => {
    throw Error('QA_NETWORK_DENIED');
  };
  https.get = deny;
  http.get = deny;
  http.request = deny;
  https.request = (options, callback) => {
    assert.equal(options.hostname, `${did}.ifr.fr-par.scaleway.com`);
    assert.equal(options.path, '/v1/chat/completions');
    assert.equal(options.protocol, 'https:');
    assert.equal(options.port, 443);
    assert.equal(options.rejectUnauthorized, true);
    assert.equal(options.method, 'POST');
    const req = new EventEmitter(),
      res = new EventEmitter();
    req.destroy = () => {
      req.destroyed = true;
      aborts.push(calls.length);
    };
    res.destroy = () => {
      res.destroyed = true;
    };
    req.end = (body) => {
      const b = JSON.parse(body);
      assert.equal(b.model, modelName);
      assert.equal(b.stream, true);
      assert.equal(b.max_tokens, 256);
      const prompt = b.messages.at(-1).content;
      const authorization = options.headers.Authorization;
      if (prompt === 'disabled') assert.equal(authorization, undefined);
      else assert.equal(authorization, `Bearer ${secret}`);
      calls.push({
        model: b.model,
        prompt,
        maxTokens: b.max_tokens,
        url: `https://${options.hostname}${options.path}`,
        method: options.method,
        tls: options.rejectUnauthorized,
        authentication: authorization ? 'iam' : 'disabled',
        hasAuthorization: !!authorization,
      });
      stage(`POST ${prompt}`);
      const frame = (v) => `data: ${JSON.stringify(v)}\n\n`;
      const delta = (text) =>
        frame({
          model: modelName,
          choices: [{ index: 0, delta: { content: text } }],
        });
      const emit = (data) => res.emit('data', Buffer.from(data));
      setTimeout(() => {
        res.statusCode = 200;
        res.headers = { 'content-type': 'text/event-stream' };
        callback(res);
        if (prompt === 'error') {
          emit(delta('Partial before error'));
          setTimeout(
            () => res.emit('error', Error('SYNTHETIC upstream private detail')),
            250,
          );
          return;
        }
        if (prompt === 'mismatch') {
          emit(delta('MUST_NOT_APPEAR').replace(modelName, 'other/model'));
          return;
        }
        emit(
          delta(
            prompt === 'normal' || prompt === 'disabled'
              ? 'Bonjour '
              : 'Partial retained',
          ),
        );
        if (['stop', 'scope', 'logout', 'trust'].includes(prompt)) {
          setTimeout(
            () => {
              lateFrames++;
              emit(delta('LATE_MUST_NOT_APPEAR'));
              emit('data: [DONE]\n\n');
              stage(`late frame ${prompt}`);
            },
            prompt === 'trust' ? 12000 : 1200,
          );
          return;
        }
        setTimeout(() => {
          emit(delta('mock HTTPS SSE.'));
          emit(
            frame({
              choices: [],
              usage: {
                prompt_tokens: 3,
                completion_tokens: 2,
                total_tokens: 5,
              },
            }),
          );
          emit('data: [DONE]\n\n');
        }, 700);
      }, 80);
    };
    return req;
  };
  const view = require(path.join(root, 'dist/servicePlaygroundView.js'));
  const originalHtml = view.servicePlaygroundHtml;
  let doneResolve, _doneReject;
  const done = new Promise((r, j) => {
    doneResolve = r;
    _doneReject = j;
  });
  view.servicePlaygroundHtml = (webview, ...args) => {
    panels++;
    stage('panel opened');
    webview.onDidReceiveMessage((m) => {
      if (m.type === 'qa-control') {
        if (m.action === 'scope')
          instance.project = {
            ...instance.project,
            id: '88888888-8888-8888-8888-888888888888',
          };
        if (m.action === 'open-disabled') {
          instance.project = {
            id: pid,
            organizationId: org,
            name: 'QA synthetic project',
          };
          void vscode.commands.executeCommand('scalewayAI.openService', did);
        }
        stage(`control ${m.action}`);
      }
      if (m.type === 'qa-result') doneResolve(m);
    });
    const html = originalHtml(webview, ...args),
      nonce = html.match(/nonce-([a-f0-9]+)/)[1];
    const instrumented = missing
      ? html.replace(
          '<script nonce=',
          '<script nonce="' +
            nonce +
            '">const qaAcquire=window.acquireVsCodeApi;window.acquireVsCodeApi=()=>{const api=qaAcquire();window.qaRunPosts=[];return {getState:()=>api.getState(),setState:s=>api.setState(s),postMessage:m=>{if(m.type==="run")window.qaRunPosts.push(m);return api.postMessage(m);}};};</script><script nonce=',
        )
      : html;
    return instrumented.replace(
      '</body>',
      `<script nonce="${nonce}">${fs.readFileSync(path.join(__dirname, 'dedicatedPlayground-browser-fixture.js'), 'utf8')}</script></body>`,
    );
  };
  await ext.activate();
  check('activation sends zero', calls.length === 0);
  check('activation credential access zero', credentials === 0);
  stage('ready-native');
  const controlTimer = setInterval(() => {
    if (!fs.existsSync(`${resultPath}.control`)) return;
    const command = fs.readFileSync(`${resultPath}.control`, 'utf8');
    fs.unlinkSync(`${resultPath}.control`);
    if (command === 'scope-change')
      instance.project = {
        ...instance.project,
        id: '88888888-8888-8888-8888-888888888888',
      };
    else if (command === 'reset')
      instance.project = {
        id: pid,
        organizationId: org,
        name: 'QA synthetic project',
      };
    else if (command === 'logout')
      void vscode.commands
        .executeCommand('scalewayAI.disconnect')
        .then(() => stage('logout completed'));
    else if (command === 'reconnect')
      void instance.restoreSession().then(() => stage('synthetic reconnect'));
    else if (command === 'trust-ui')
      void vscode.commands.executeCommand('workbench.trust.manage');
    else if (command === 'finish')
      doneResolve(
        JSON.parse(fs.readFileSync(`${resultPath}.native-result`, 'utf8')),
      );
    else if (command === 'open')
      void vscode.commands.executeCommand('scalewayAI.openService', did);
    stage(`native-control ${command}`);
  }, 100);
  try {
    const result = await Promise.race([
      done,
      new Promise((_, j) =>
        setTimeout(() => j(Error('Dedicated installed deadline')), 140000),
      ),
    ]);
    if (missing) {
      check(
        'three explicit IAM runs only',
        calls.length === 3 && credentials === 3,
      );
      check('Stop and logout late mock frames emitted', lateFrames === 2);
      check('three approved panels', panels === 3);
    } else {
      check('five IAM requests and one disabled request', calls.length === 6);
      check(
        'IAM authorize exactly five times; disabled never accesses credential',
        credentials === 5,
      );
      check('late mock frames emitted', lateFrames === 2);
      check(
        'two approved panels only; canceled and changed-scope consent did not open',
        panels === 2,
      );
    }
    fs.writeFileSync(
      resultPath,
      JSON.stringify(
        {
          checks: [...checks, ...result.checks],
          calls,
          aborts,
          lateFrames,
          credentials,
          panels,
          stages,
          hostVersion: vscode.version,
          packageVersion: ext.packageJSON.version,
          packagedPath: root,
          physicalCloudRequests: 0,
          method:
            'Installed packaged actual Extension Host/controller/view/invokeDedicatedText; synthetic restoreSession/deploymentDetails; EventEmitter HTTPS SSE; actual native VS Code picker/modal through Chromium CDP',
          native: result.native,
          limitations: result.limitations || [],
        },
        null,
        2,
      ),
    );
  } finally {
    clearInterval(controlTimer);
    view.servicePlaygroundHtml = originalHtml;
  }
};
