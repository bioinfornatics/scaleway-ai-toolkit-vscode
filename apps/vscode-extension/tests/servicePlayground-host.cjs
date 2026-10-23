const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
exports.run = async () => {
  const extension = vscode.extensions.getExtension(
    'scaleway-ai-community-preview.scaleway-ai-toolkit-preview',
  );
  assert.ok(extension);
  assert.equal(
    extension.isActive,
    false,
    'fixture must install before activation',
  );
  const root = extension.extensionPath;
  const connection = require(path.join(root, 'dist/connection.js'));
  const inference = require(path.join(root, 'dist/inference.js'));
  const https = require('node:https');
  const http = require('node:http');
  // Tripwire: no provider account HTTP may escape the synthetic fixture.
  const deny = () => {
    throw new Error('QA_NETWORK_DENIED');
  };
  https.request = deny;
  https.get = deny;
  http.request = deny;
  http.get = deny;
  const model = {
    id: 'qa-configurable-text-model',
    label: 'QA modèle configurable · MOCK',
    kind: 'serverless',
    status: 'preview',
    serverlessCapabilities: {
      tasks: ['chat'],
      supportedApis: ['/v1/chat/completions'],
      textChat: 'supported',
      source: 'public-catalog',
    },
  };
  let instance;
  const calls = [];
  const aborts = [];
  let timer;
  const subscriptions = [];
  const stages = [];
  const stage = (name) => {
    stages.push(name);
    fs.writeFileSync(
      process.env.SCALEWAY_PLAYGROUND_QA_RESULT + '.stages',
      JSON.stringify(stages),
    );
  };
  let doneResolve;
  let doneReject;
  const done = new Promise((resolve, reject) => {
    doneResolve = resolve;
    doneReject = reject;
  });
  connection.Connection.prototype.restoreSession = async function () {
    instance = this;
    this.apiKey = {
      userId: '11111111-1111-1111-1111-111111111111',
      accessKey: 'SCW12345678901234567',
      secretKey: '33333333-3333-3333-3333-333333333333',
      expiresAt: Date.now() + 3600000,
    };
    this.installSession({
      userId: '11111111-1111-1111-1111-111111111111',
      token: 'synthetic',
      expiresAt: Date.now() + 3600000,
    });
    this.project = {
      id: '22222222-2222-2222-2222-222222222222',
      organizationId: '11111111-1111-1111-1111-111111111111',
      name: 'QA projet synthétique',
    };
    this.serverless = [model];
  };
  inference.invokeText = async (input, delta, usage) => {
    stage('mock invoked ' + input.prompt);
    assert.equal(input.modelId, model.id);
    assert.equal(input.projectId, instance.project.id);
    calls.push({
      modelId: input.modelId,
      prompt: input.prompt,
      maxTokens: input.maxTokens,
    });
    if (input.prompt === 'error') {
      delta('Réponse partielle avant erreur');
      throw new inference.InferenceError('http_error', 429);
    }
    if (input.prompt === 'stop') {
      delta('Réponse partielle conservée');
      await new Promise((resolve) =>
        input.signal.addEventListener('abort', resolve, { once: true }),
      );
      aborts.push(true);
      delta('LATE_MUST_NOT_APPEAR');
      return;
    }
    delta('Bonjour ');
    await new Promise((r) => setTimeout(r, 3000));
    delta('depuis le transport mocké.');
    usage({ inputTokens: 5, outputTokens: 8, totalTokens: 13 });
  };
  const view = require(path.join(root, 'dist/servicePlaygroundView.js'));
  const originalHtml = view.servicePlaygroundHtml;
  view.servicePlaygroundHtml = (webview, ...args) => {
    stage('HTML intercepted');
    subscriptions.push(
      webview.onDidReceiveMessage((message) => {
        stage('IPC ' + message.type + ' ' + (message.name ?? ''));
        if (message.type === 'qa-result') {
          try {
            assert.equal(
              calls.length,
              process.env.SCALEWAY_PLAYGROUND_QA_SCOPE === 'trust' ? 4 : 3,
            );
            assert.equal(
              aborts.length,
              process.env.SCALEWAY_PLAYGROUND_QA_SCOPE === 'trust' ? 2 : 1,
            );
            assert.ok(
              message.checks.every((c) => c.passed),
              JSON.stringify(message.checks),
            );
            doneResolve(message);
          } catch (error) {
            doneReject(error);
          }
        }
        if (message.type === 'qa-invalidate') {
          if (process.env.SCALEWAY_PLAYGROUND_QA_SCOPE === 'project') {
            instance.project = {
              ...instance.project,
              id: '44444444-4444-4444-4444-444444444444',
            };
          } else if (process.env.SCALEWAY_PLAYGROUND_QA_SCOPE === 'logout') {
            void instance.disconnect();
          } else if (process.env.SCALEWAY_PLAYGROUND_QA_SCOPE === 'trust') {
            assert.equal(vscode.workspace.isTrusted, true);
            void vscode.commands.executeCommand('workbench.trust.manage');
            stage('awaiting native trust revocation');
          } else {
            instance.invalidateInference();
          }
        }
      }),
    );
    const html = originalHtml(webview, ...args).replace(
      '<body>',
      '<body data-qa-scope="' +
        (process.env.SCALEWAY_PLAYGROUND_QA_SCOPE || '') +
        '">',
    );
    const nonce = html.match(/nonce-([a-f0-9]+)/)[1];
    const driver = process.env.SCALEWAY_PLAYGROUND_QA_NATIVE
      ? 'window.qaPost = message => vscode.postMessage(message); window.qaKeys = []; document.addEventListener("keydown", e => window.qaKeys.push({ key: e.key, trusted: e.isTrusted, target: e.target.id, shift: e.shiftKey, ctrl: e.ctrlKey }), true);'
      : fs.readFileSync(
          path.join(__dirname, 'servicePlayground-browser-fixture.js'),
          'utf8',
        );
    return html.replace(
      '</body>',
      '<script nonce=' +
        nonce +
        '>window.qaSends = []; const qaOriginalPost = vscode.postMessage.bind(vscode); vscode.postMessage = message => { window.qaSends.push(message.type); qaOriginalPost(message); };' +
        driver +
        '</script></body>',
    );
  };
  try {
    stage('activation');
    await extension.activate();
    assert.ok(instance);
    assert.equal(calls.length, 0);
    if (
      process.env.SCALEWAY_PLAYGROUND_QA_SCOPE === 'trust' &&
      !vscode.workspace.isTrusted
    ) {
      stage('awaiting native workspace trust');
      await vscode.commands.executeCommand('workbench.trust.manage');
      for (let i = 0; i < 600 && !vscode.workspace.isTrusted; i++)
        await new Promise((r) => setTimeout(r, 100));
      assert.equal(vscode.workspace.isTrusted, true);
    }
    await vscode.commands.executeCommand('scalewayAI.useServerless', model.id);
    stage('command returned');
    timer = setTimeout(
      () => doneReject(new Error('QA renderer deadline exceeded')),
      60000,
    );
    const result = await done;
    clearTimeout(timer);
    result.hostVersion = vscode.version;
    result.packageVersion = extension.packageJSON.version;
    result.packagedPath = root;
    result.method =
      'installed packaged Extension Host + actual webview assets; synthetic session/mock transport and nonce test driver';
    result.physicalCloudRequests = 0;
    result.calls = calls;
    result.aborts = aborts.length;
    result.scopeCase =
      process.env.SCALEWAY_PLAYGROUND_QA_SCOPE || 'explicit invalidation';
    result.stages = stages;
    result.workspaceTrustedAtEnd = vscode.workspace.isTrusted;
    if (process.env.SCALEWAY_PLAYGROUND_QA_SCOPE === 'trust')
      assert.equal(vscode.workspace.isTrusted, false);
    fs.writeFileSync(
      process.env.SCALEWAY_PLAYGROUND_QA_RESULT,
      JSON.stringify(result, null, 2),
    );
    if (process.env.SCALEWAY_PLAYGROUND_QA_KEEP_OPEN)
      await new Promise((r) => setTimeout(r, 30000));
  } finally {
    view.servicePlaygroundHtml = originalHtml;
    clearTimeout(timer);
    for (const subscription of subscriptions) subscription.dispose();
  }
};
