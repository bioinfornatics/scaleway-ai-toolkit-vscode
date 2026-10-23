const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { transformSync } = require('esbuild');
const path = require('node:path');
function setup() {
  const panels = [],
    calls = [];
  let context = { connected: true, projectName: '<Project>' };
  const api = {
    workspace: { isTrusted: true },
    Uri: { joinPath: (_root, ...parts) => parts.join('/') },
    ViewColumn: { One: 1 },
    commands: { executeCommand: async (id) => calls.push(id) },
    window: {
      createWebviewPanel: (_id, title, _column, options) => {
        let receive, disposed;
        const panel = {
          title,
          options,
          reveals: 0,
          webview: {
            cspSource: 'vscode-webview:',
            asWebviewUri: (uri) => uri,
            html: '',
            onDidReceiveMessage: (fn) => {
              receive = fn;
              return {
                dispose: () => {
                  receive = undefined;
                },
              };
            },
          },
          onDidDispose: (fn) => {
            disposed = fn;
          },
          dispose: () => disposed?.(),
          reveal() {
            this.reveals++;
          },
          send: (input) => receive?.(input),
          token() {
            return this.webview.html.match(/data-token="([a-f0-9]{48})"/)?.[1];
          },
        };
        panels.push(panel);
        return panel;
      },
    },
  };
  const mod = { exports: {} };
  vm.runInNewContext(
    transformSync(
      fs.readFileSync(
        path.join(__dirname, '../src/deployedResources.ts'),
        'utf8',
      ),
      { loader: 'ts', format: 'cjs', target: 'node22' },
    ).code,
    {
      module: mod,
      exports: mod.exports,
      require: (name) => (name === 'vscode' ? api : require(name)),
    },
  );
  const host = new mod.exports.DeployedResources(
    { extensionUri: 'root' },
    () => context,
  );
  return {
    host,
    api,
    panels,
    calls,
    exports: mod.exports,
    setContext: (value) => {
      context = value;
    },
  };
}
test('deployed central page excludes local inventory, puts matching create action in header and escapes scope', async () => {
  const f = setup();
  f.host.open('agents');
  const p = f.panels[0];
  assert.ok(
    p.webview.html.includes(
      'data-action="create">+ Créer un service IA</button></header>',
    ),
  );
  assert.match(p.webview.html, /Ressources déployées sur Scaleway/);
  assert.match(p.webview.html, /Inventaire non disponible/);
  assert.match(p.webview.html, /Ce statut ne signifie pas qu’aucune ressource/);
  assert.match(p.webview.html, /&lt;Project&gt;/);
  assert.doesNotMatch(p.webview.html, /<Project>/);
  assert.match(p.webview.html, /connect-src 'none'/);
  const old = p.token();
  await p.send({ action: 'create', token: old });
  assert.deepEqual(f.calls, ['scalewayAI.openLocalAgents']);
  f.host.open('tools');
  assert.equal(f.panels.length, 1);
  assert.ok(p.webview.html.includes('+ Créer un outil'));
  await p.send({ action: 'create', token: old });
  assert.equal(f.calls.length, 1);
  await p.send({ action: 'create', token: p.token() });
  assert.deepEqual(f.calls, [
    'scalewayAI.openLocalAgents',
    'scalewayAI.openLocalTools',
  ]);
});
test('closed parser denies forged routes, extra fields and malformed tokens', () => {
  const f = setup(),
    token = 'a'.repeat(48);
  assert.equal(
    f.exports.parseDeployedInput({ action: 'create', token }).action,
    'create',
  );
  for (const input of [
    null,
    [],
    {},
    { action: 'run', token },
    { action: 'create', token: 'A'.repeat(48) },
    { action: 'create', token, kind: 'agents' },
    { action: 'create', token, path: '/tmp/project' },
  ])
    assert.equal(f.exports.parseDeployedInput(input), undefined);
});
test('context refresh rotates tokens, connection/trust states truthful and create stays local', async () => {
  const f = setup();
  f.host.open('agents');
  const p = f.panels[0],
    old = p.token();
  for (const [context, expected] of [
    [{ connected: false }, /Choisissez un projet/],
    [{ connected: false, projectName: 'Old' }, /Reconnectez-vous/],
    [{ connected: true, projectName: 'New' }, /lecture de l’inventaire/],
  ]) {
    f.setContext(context);
    f.host.refresh();
    assert.match(p.webview.html, expected);
  }
  f.api.workspace.isTrusted = false;
  f.host.refresh();
  assert.match(p.webview.html, /workspace approuvé/);
  await p.send({ action: 'create', token: old });
  assert.equal(f.calls.length, 0);
  await p.send({ action: 'create', token: p.token() });
  assert.deepEqual(f.calls, ['scalewayAI.openLocalAgents']);
  p.dispose();
  await p.send({ action: 'create', token: p.token() });
  assert.equal(f.calls.length, 1);
  f.host.open('tools');
  assert.equal(f.panels.length, 2);
  f.host.dispose();
  f.host.open('agents');
  assert.equal(f.panels.length, 2);
});
test('browser create action only dispatches intent/token, no paths or cloud calls', () => {
  const messages = [];
  let handler;
  vm.runInNewContext(
    fs.readFileSync(
      path.join(__dirname, '../media/deployedResources.js'),
      'utf8',
    ),
    {
      acquireVsCodeApi: () => ({ postMessage: (row) => messages.push(row) }),
      document: {
        body: { dataset: { token: 't' } },
        querySelector: () => ({
          addEventListener: (_event, fn) => {
            handler = fn;
          },
        }),
      },
    },
  );
  handler();
  assert.deepEqual(
    messages.map((row) => ({ ...row })),
    [{ action: 'create', token: 't' }],
  );
});
