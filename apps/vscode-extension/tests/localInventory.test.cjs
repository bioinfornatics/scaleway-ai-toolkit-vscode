const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { transformSync } = require('esbuild');
const compiled = transformSync(
  fs.readFileSync(path.join(__dirname, '../src/localInventory.ts'), 'utf8'),
  { loader: 'ts', format: 'cjs', target: 'node22' },
).code;
async function fixture(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'local-inventory-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const uri = (fsPath) => ({
    fsPath,
    scheme: 'file',
    toString: () => `file:${fsPath}`,
  });
  const state = {
    panels: [],
    commands: [],
    opens: [],
    shows: [],
    warnings: [],
    stats: 0,
  };
  const listeners = {};
  const api = {
    workspace: {
      createFileSystemWatcher() {
        return {
          onDidCreate(fn) {
            listeners.created = fn;
            return { dispose() {} };
          },
          onDidChange(fn) {
            listeners.changed = fn;
            return { dispose() {} };
          },
          onDidDelete(fn) {
            listeners.deleted = fn;
            return { dispose() {} };
          },
          dispose() {
            state.watcherDisposed = true;
          },
        };
      },
      fs: {
        async delete(uri, options) {
          state.deletes ??= [];
          state.deletes.push({ uri, options });
          await state.onDelete?.();
        },
      },
      updateWorkspaceFolders(index, count) {
        state.removes ??= [];
        state.removes.push({ index, count });
        return true;
      },
      isTrusted: true,
      workspaceFolders: [{ name: 'Workspace', uri: uri(root) }],
      onDidChangeWorkspaceFolders(fn) {
        listeners.folders = fn;
        return { dispose() {} };
      },
      onDidGrantWorkspaceTrust(fn) {
        listeners.trust = fn;
        return { dispose() {} };
      },
      async openTextDocument(input) {
        state.opens.push(input);
        await state.onOpen?.();
        return { uri: input, isClosed: false };
      },
    },
    Uri: {
      file: uri,
      joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)),
    },
    ViewColumn: { One: 1 },
    commands: {
      async executeCommand(command) {
        state.commands.push(command);
        await state.onCreate?.();
      },
    },
    window: {
      async showTextDocument(doc) {
        state.shows.push(doc);
        await state.onShow?.();
      },
      async showQuickPick() {
        return state.removeChoice;
      },
      async showInformationMessage(message) {
        state.info = message;
      },
      async showWarningMessage(message) {
        state.warnings.push(message);
        await state.onWarning?.();
        return state.confirmRemoval;
      },
      createWebviewPanel(_id, title, _column, options) {
        let receive, disposed;
        const panel = {
          title,
          options,
          reveal() {},
          dispose() {
            disposed?.();
          },
          onDidChangeViewState(fn) {
            state.viewChanged = fn;
          },
          onDidDispose(fn) {
            disposed = fn;
          },
          webview: {
            html: '',
            cspSource: 'vscode-webview:',
            asWebviewUri: (input) => input.toString(),
            onDidReceiveMessage(fn) {
              receive = fn;
              return {
                dispose() {
                  receive = undefined;
                },
              };
            },
          },
          send: (input) => receive?.(input),
          token() {
            return this.webview.html.match(/data-token="([a-f0-9]{48})"/)?.[1];
          },
          ids() {
            return [
              ...this.webview.html.matchAll(
                /data-action="open" data-id="([a-f0-9]{32})"/g,
              ),
            ].map((match) => match[1]);
          },
        };
        state.panels.push(panel);
        return panel;
      },
    },
  };
  const mod = { exports: {} };
  vm.runInNewContext(compiled, {
    module: mod,
    exports: mod.exports,
    setTimeout,
    clearTimeout,
    require(name) {
      if (name === 'vscode') return api;
      if (name === './localAgentRunner')
        return {
          LocalAgentRunner: class {
            constructor(changed) {
              state.runChanged = changed;
            }
            isBusy() {
              return state.runBusy ?? false;
            }
            list() {
              return state.runList ?? [];
            }
            async projectInfo() {
              return state.projectInfo ?? [];
            }
            async readiness() {
              return (
                state.readiness ??
                (state.ready
                  ? 'Lancement configuré — effets non vérifiés'
                  : 'Configuration requise')
              );
            }
            async start(directory, name, current) {
              if (current()) state.runStart = { directory, name };
            }
            async openEntry(directory, current) {
              if (!current()) return;
              state.entryOpen = directory;
              const entry = path.join(directory, 'agent.py');
              const before = await fsp.stat(entry).catch(() => undefined);
              if (!before) return;
              const markers = [
                'agent.json',
                'agent.authoring.json',
                'agent.creation.json',
              ];
              const snapshots = await Promise.all(
                markers.map((name) =>
                  fsp
                    .readFile(path.join(directory, name))
                    .catch(() => undefined),
                ),
              );
              const doc = await api.workspace.openTextDocument(uri(entry));
              if (!current()) return;
              const after = await fsp.stat(entry);
              for (let i = 0; i < markers.length; i++) {
                const data = await fsp
                  .readFile(path.join(directory, markers[i]))
                  .catch(() => undefined);
                if (String(data) !== String(snapshots[i])) {
                  state.warnings.push('changed');
                  return;
                }
              }
              if (before.mtimeMs !== after.mtimeMs || !current()) return;
              await api.window.showTextDocument(doc);
            }
            async configure(directory, current) {
              if (current()) state.runConfig = directory;
            }
            stop(id) {
              state.runStop = id;
            }
            logs(id) {
              state.runLogs = id;
            }
            dispose() {}
          },
        };
      if (name === 'node:fs/promises')
        return {
          opendir: fsp.opendir,
          async lstat(target) {
            state.stats++;
            await state.onStat?.(target);
            return fsp.lstat(target);
          },
        };
      return require(name);
    },
  });
  const host = new mod.exports.LocalInventory({
    extensionUri: uri(root),
    workspaceState: {
      get() {
        throw Error('persistence forbidden');
      },
      update() {
        throw Error('persistence forbidden');
      },
    },
  });
  t.after(() => host.dispose());
  async function marker(relative) {
    const target = path.join(root, relative);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, 'not executed');
    return target;
  }
  return {
    root,
    uri,
    state,
    api,
    listeners,
    host,
    marker,
    exports: mod.exports,
  };
}
test('actual roots/root project, manual projects, marker priority, exclusions, depth, ambiguous tools', async (t) => {
  const f = await fixture(t);
  await f.marker('agent.py');
  await f.marker('manual/agent.authoring.json');
  await f.marker('manual/agent.json');
  await f.marker('a/b/c/agent.py');
  await f.marker('a/b/c/d/agent.py');
  for (const directory of [
    '.git',
    'node_modules',
    '.venv',
    'dist',
    '.scaleway-ai',
  ])
    await f.marker(`${directory}/agent.py`);
  await f.marker('tool/server.py');
  await f.host.open('agents');
  const p = f.state.panels[0];
  assert.equal(p.ids().length, 3);
  assert.ok(p.webview.html.includes(f.root));
  assert.match(p.webview.html, /role="status">Inventaire incomplet/);
  assert.doesNotMatch(p.webview.html, /a\/b\/c\/d|node_modules/);
  assert.match(
    p.webview.html,
    /data-action="create">\+ Créer un agent<\/button><\/header>/,
  );
  assert.match(p.webview.html, /connect-src &#39;none&#39;/);
  assert.doesNotMatch(
    p.webview.html,
    /même utilisateur|Détection locale après votre clic/,
  );
  await f.host.open('tools');
  assert.equal(p.ids().length, 1);
  assert.match(p.webview.html, /Fichier candidat — projet non identifié/);
  await p.send({ action: 'create', token: p.token() });
  assert.deepEqual(f.state.commands, ['scalewayAI.createTool']);
});
test('closed IPC, opaque membership, stale tokens, direct creation and native open only', async (t) => {
  const f = await fixture(t);
  await f.marker('agent.json');
  const target = await f.marker('agent.py');
  await f.host.open('agents');
  const p = f.state.panels[0],
    token = p.token(),
    id = p.ids()[0];
  for (const input of [
    null,
    [],
    {},
    { action: 'run', token },
    { action: 'open', token, id, path: target },
    { action: 'create', token, kind: 'tools' },
    { action: 'open', token, id: '../../x' },
    { action: 'open', token, id: '0'.repeat(32) },
  ])
    await p.send(input);
  assert.equal(f.state.opens.length, 0);
  await p.send({ action: 'open', token, id });
  assert.equal(f.state.opens[0].fsPath, target);
  assert.equal(f.state.shows.length, 1);
  await p.send({ action: 'create', token });
  assert.deepEqual(f.state.commands, ['scalewayAI.createAgent']);
  await p.send({ action: 'open', token, id });
  assert.equal(f.state.opens.length, 1);
  p.dispose();
  await f.host.open('tools');
  assert.equal(f.state.panels.length, 2);
  f.host.dispose();
  await f.host.open('agents');
  assert.equal(f.state.panels.length, 2);
});
test('trust and root changes gate scanning, actions, and post-command continuation', async (t) => {
  const f = await fixture(t);
  await f.marker('agent.py');
  f.api.workspace.isTrusted = false;
  await f.host.open('agents');
  const p = f.state.panels[0];
  assert.equal(f.state.stats, 0);
  assert.match(p.webview.html, /non approuvé/);
  await p.send({ action: 'create', token: p.token() });
  assert.equal(f.state.commands.length, 0);
  f.api.workspace.isTrusted = true;
  await p.send({ action: 'refresh', token: p.token() });
  const old = p.token();
  f.api.workspace.workspaceFolders = [];
  await p.send({ action: 'open', token: old, id: p.ids()[0] });
  assert.equal(f.state.opens.length, 0);
  await p.send({ action: 'refresh', token: p.token() });
  assert.match(p.webview.html, /Aucun dossier/);
  f.api.workspace.workspaceFolders = [
    { name: 'Workspace', uri: f.uri(f.root) },
  ];
  await f.host.open('agents');
  f.state.onCreate = () => {
    f.api.workspace.isTrusted = false;
  };
  await p.send({ action: 'create', token: p.token() });
  assert.equal(p.ids().length, 0);
});
test('in-flight scans cannot publish after root change or newer epoch', async (t) => {
  const f = await fixture(t);
  await f.marker('agent.py');
  let resolve, reached;
  const gate = new Promise((r) => {
      resolve = r;
    }),
    started = new Promise((r) => {
      reached = r;
    });
  let once = true;
  f.state.onStat = async () => {
    if (once) {
      once = false;
      reached();
      await gate;
    }
  };
  const pending = f.host.open('agents');
  await started;
  f.api.workspace.workspaceFolders = [];
  f.listeners.folders();
  resolve();
  await pending;
  assert.equal(f.state.panels[0].ids().length, 0);
  f.api.workspace.workspaceFolders = [
    { name: 'Workspace', uri: f.uri(f.root) },
  ];
  once = true;
  let release, signal;
  const gate2 = new Promise((r) => {
      release = r;
    }),
    started2 = new Promise((r) => {
      signal = r;
    });
  f.state.onStat = async () => {
    if (once) {
      once = false;
      signal();
      await gate2;
    }
  };
  const old = f.host.open('agents');
  await started2;
  await f.host.open('tools');
  release();
  await old;
  assert.match(f.state.panels[0].webview.html, /Outils locaux/);
  assert.equal(f.state.panels[0].ids().length, 0);
});
test('symlinks, replaced marker/parents, and trust revoked during native open rejected', async (t) => {
  const f = await fixture(t);
  const target = await f.marker('project/agent.py');
  await f.marker('other/agent.py');
  await fsp.symlink(
    path.join(f.root, 'project'),
    path.join(f.root, 'link'),
    'dir',
  );
  await fsp.symlink(target, path.join(f.root, 'agent.json'));
  await f.host.open('agents');
  const p = f.state.panels[0];
  assert.equal(p.ids().length, 2);
  const id = p.ids()[1]; // Locate actual project row without exposing pathname in IPC.
  const projectId = p.webview.html.match(
    /<td class="project"><strong>project<\/strong>[\s\S]*?data-id="([a-f0-9]{32})"/,
  )[1];
  await fsp.unlink(target);
  await fsp.writeFile(target, 'replacement with different identity');
  await p.send({ action: 'open', token: p.token(), id: projectId });
  assert.equal(f.state.opens.length, 0);
  assert.equal(f.state.warnings.length, 1);
  await f.host.open('agents');
  const newId = p.webview.html.match(
    /<td class="project"><strong>project<\/strong>[\s\S]*?data-id="([a-f0-9]{32})"/,
  )[1];
  await fsp.rename(path.join(f.root, 'project'), path.join(f.root, 'saved'));
  await fsp.symlink(
    path.join(f.root, 'saved'),
    path.join(f.root, 'project'),
    'dir',
  );
  await p.send({ action: 'open', token: p.token(), id: newId });
  assert.equal(f.state.opens.length, 0);
  await f.host.open('agents');
  f.state.onOpen = () => {
    f.api.workspace.isTrusted = false;
  };
  await p.send({ action: 'open', token: p.token(), id: p.ids()[0] });
  assert.equal(f.state.shows.length, 0);
  assert.ok(id);
});
test('multiple roots escaped unambiguous labels; non-file and missing roots differ from zero', async (t) => {
  const f = await fixture(t);
  await f.marker('agent.py');
  f.api.workspace.workspaceFolders.push({
    name: '<Workspace>',
    uri: f.uri(f.root),
  });
  await f.host.open('agents');
  const p = f.state.panels[0];
  assert.equal(p.ids().length, 1);
  assert.ok(p.webview.html.includes(f.root));
  f.api.workspace.workspaceFolders = [
    { name: '<Workspace>', uri: f.uri(f.root) },
  ];
  await f.host.open('agents');
  assert.ok(p.webview.html.includes(f.root));
  assert.doesNotMatch(p.webview.html, /<Workspace>/);
  f.api.workspace.workspaceFolders = [
    { name: 'missing', uri: f.uri(path.join(f.root, 'missing')) },
  ];
  await f.host.open('agents');
  assert.match(
    p.webview.html,
    /role="status">Inventaire incomplet[\s\S]*?1 erreur\(s\) de détection/,
  );
  f.api.workspace.workspaceFolders = [
    { name: 'virtual', uri: { ...f.uri(f.root), scheme: 'virtual' } },
  ];
  await f.host.open('agents');
  assert.match(
    p.webview.html,
    /role="status">Inventaire incomplet[\s\S]*?1 erreur\(s\) de détection/,
  );
  f.api.workspace.workspaceFolders = [{ name: 'root', uri: f.uri(f.root) }];
  await f.host.open('tools');
  assert.ok(p.webview.html.includes('<tbody></tbody>'));
  assert.match(
    p.webview.html,
    /role="status">Inventaire complet — aucun projet reconnu/,
  );
});
test('global directory limit is incomplete rather than verified empty', async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 270; i++) await fsp.mkdir(path.join(f.root, `d${i}`));
  await f.host.open('agents');
  assert.ok(f.state.panels[0].webview.html.includes('<tbody></tbody>'));
  assert.match(
    f.state.panels[0].webview.html,
    /role="status">Inventaire incomplet/,
  );
  assert.match(f.state.panels[0].webview.html, /absence non vérifiée/);
  assert.ok(f.state.stats < 3000);
});
test('browser emits only closed intents and opaque IDs, without persistence or paths', () => {
  const messages = [],
    handlers = [];
  const buttons = [
    { action: 'create' },
    { action: 'refresh' },
    { action: 'open', id: 'a'.repeat(32) },
    { action: 'open', id: '/tmp/x' },
  ].map((dataset) => ({
    dataset,
    addEventListener(_event, fn) {
      handlers.push(fn);
    },
  }));
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../media/localInventory.js'), 'utf8'),
    {
      acquireVsCodeApi: () => ({
        postMessage: (input) => messages.push({ ...input }),
      }),
      document: {
        body: { dataset: { token: 't' } },
        querySelectorAll: () => buttons,
      },
    },
  );
  for (const handler of handlers) handler();
  assert.deepEqual(messages, [
    { action: 'create', token: 't' },
    { action: 'refresh', token: 't' },
    { action: 'open', token: 't', id: 'a'.repeat(32) },
  ]);
});

test('entry budget bounds very wide directories and reports incomplete', async (t) => {
  const f = await fixture(t);
  // Temporary files only; no workspace or content-read dependency.
  for (let start = 0; start < 8200; start += 100) {
    await Promise.all(
      Array.from({ length: 100 }, (_, n) =>
        fsp.writeFile(path.join(f.root, `plain${start + n}`), ''),
      ),
    );
  }
  await f.host.open('agents');
  assert.ok(f.state.panels[0].webview.html.includes('<tbody></tbody>'));
  assert.match(
    f.state.panels[0].webview.html,
    /role="status">Inventaire incomplet/,
  );
  assert.match(f.state.panels[0].webview.html, /absence non vérifiée/);
  assert.ok(f.state.stats < 8250);
});
test('preferred regular marker opened; same identity checked again after editor read', async (t) => {
  const f = await fixture(t);
  const entry = await f.marker('agent.py');
  const json = await f.marker('agent.json');
  await f.host.open('agents');
  const p = f.state.panels[0];
  await p.send({ action: 'open', token: p.token(), id: p.ids()[0] });
  assert.equal(f.state.opens[0].fsPath, entry);
  f.state.onOpen = async () => {
    await fsp.unlink(json);
    await fsp.writeFile(json, 'changed');
  };
  await p.send({ action: 'open', token: p.token(), id: p.ids()[0] });
  assert.equal(f.state.shows.length, 1);
  assert.equal(f.state.warnings.length, 1);
});

for (const kind of ['agents', 'tools']) {
  test(`${kind}: complete empty inventory is visibly distinguished from incomplete`, async (t) => {
    const f = await fixture(t);
    await f.host.open(kind);
    const p = f.state.panels[0];
    assert.ok(p.webview.html.includes('<tbody></tbody>'));
    assert.ok(p.webview.html.includes('<th scope="col">Projet</th>'));
    assert.match(p.webview.html, /data-action="create"/);
    assert.match(p.webview.html, /data-action="refresh"/);
    assert.match(
      p.webview.html,
      /role="status">Inventaire complet — aucun projet reconnu/,
    );
    assert.doesNotMatch(
      p.webview.html,
      /Inventaire incomplet|absence non vérifiée|colspan/,
    );
    assert.equal(f.state.opens.length, 0);
    assert.equal(f.state.commands.length, 0);
  });
}

test('tool authoring marker recognizes TypeScript/Rust project without Python files', async (t) => {
  const f = await fixture(t);
  const target = await f.marker('rust-tool/tool.authoring.json');
  await f.host.open('tools');
  const p = f.state.panels[0];
  assert.equal(p.ids().length, 1);
  assert.match(p.webview.html, /rust-tool/);
  await p.send({ action: 'open', token: p.token(), id: p.ids()[0] });
  assert.equal(f.state.opens[0].fsPath, target);
  await f.host.open('agents');
  assert.equal(p.ids().length, 0);
});

for (const includeProject of [false, true]) {
  test(
    'scanner I/O error is visible with ' +
      (includeProject ? 'partial rows' : 'no rows'),
    async (t) => {
      const f = await fixture(t);
      if (includeProject) await f.marker('agent.py');
      await fsp.mkdir(path.join(f.root, 'unreadable'));
      f.state.onStat = (target) => {
        if (target === path.join(f.root, 'unreadable', 'agent.py'))
          throw new Error('synthetic EACCES');
      };
      await fsp.writeFile(
        path.join(f.root, 'unreadable', 'agent.py'),
        'not executed',
      );
      await f.host.open('agents');
      const p = f.state.panels[0];
      assert.equal(p.ids().length, includeProject ? 1 : 0);
      assert.match(p.webview.html, /role="status">Inventaire incomplet/);
      assert.match(
        p.webview.html,
        /résultats partiels ; 1 erreur\(s\) de détection/,
      );
      assert.doesNotMatch(p.webview.html, /Inventaire complet/);
      if (!includeProject) assert.match(p.webview.html, /absence non vérifiée/);
    },
  );
}
test('successful non-empty scan visibly reports complete', async (t) => {
  const f = await fixture(t);
  await f.marker('agent.py');
  await f.host.open('agents');
  const p = f.state.panels[0];
  assert.equal(p.ids().length, 1);
  assert.match(p.webview.html, /role="status">Inventaire complet — 1 projet/);
  assert.doesNotMatch(p.webview.html, /Inventaire incomplet/);
  assert.match(p.webview.html, /Fichier candidat — projet non identifié/);
});

test('Given generated src-layout agent and overlapping roots, When scanned, Then one project appears and a distinct nested marked project stays visible', async (t) => {
  const f = await fixture(t);
  await f.marker('sample/agent.authoring.json');
  await f.marker('sample/src/agent_app/agent.py');
  await f.marker('sample/nested/agent.creation.json');
  f.api.workspace.workspaceFolders.push({
    name: 'sample',
    uri: f.uri(path.join(f.root, 'sample')),
  });
  await f.host.open('agents');
  const p = f.state.panels[0];
  assert.equal(p.ids().length, 2);
  assert.doesNotMatch(p.webview.html, /<strong>agent_app<\/strong>/);
  assert.match(p.webview.html, /<strong>nested<\/strong>/);
});
test('Given listed project deleted on disk, When watcher signals deletion, Then stale rows disappear immediately and a fresh scan confirms absence', async (t) => {
  const f = await fixture(t);
  const target = await f.marker('sample/agent.authoring.json');
  await f.host.open('agents');
  const p = f.state.panels[0];
  const token = p.token(),
    id = p.ids()[0];
  await fsp.rm(path.dirname(target), { recursive: true, force: true });
  f.listeners.deleted(f.uri(path.dirname(target)));
  assert.equal(p.ids().length, 0);
  await p.send({ action: 'open', token, id });
  assert.equal(f.state.opens.length, 0);
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(p.ids().length, 0);
  assert.match(p.webview.html, /Inventaire complet — aucun projet/);
});
test('Given new project or missed watcher event, When creation event or visibility refresh occurs, Then filesystem truth is rescanned', async (t) => {
  const f = await fixture(t);
  await f.host.open('tools');
  const p = f.state.panels[0];
  const target = await f.marker('tool/tool.authoring.json');
  f.listeners.created(f.uri(target));
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(p.ids().length, 1);
  await fsp.rm(path.dirname(target), { recursive: true, force: true });
  await f.state.viewChanged({ webviewPanel: { visible: true } });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(p.ids().length, 0);
});
test('Given pending filesystem refresh, When disposed, Then no scan or view can resurrect and watcher releases', async (t) => {
  const f = await fixture(t);
  await f.host.open('agents');
  f.listeners.created(f.uri(path.join(f.root, 'new')));
  f.host.dispose();
  const stats = f.state.stats;
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(f.state.stats, stats);
  assert.equal(f.state.watcherDisposed, true);
});

test('Given configured row, When launch/configure intent arrives, Then only current member agents dispatch and Stop survives trust or deleted inventory', async (t) => {
  const f = await fixture(t);
  await f.marker('agent.authoring.json');
  f.state.ready = true;
  await f.host.open('agents');
  const p = f.state.panels[0];
  const id = p.ids()[0];
  assert.match(p.webview.html, />Exécuter<\/button>/);
  await p.send({ action: 'run', token: p.token(), id });
  assert.equal(f.state.runStart.directory, f.root);
  await p.send({ action: 'configure', token: p.token(), id });
  assert.equal(f.state.runConfig, f.root);
  f.state.runList = [
    { id: 'a'.repeat(32), name: 'running', state: 'En cours', active: true },
  ];
  f.state.runChanged();
  const token = p.token();
  f.api.workspace.isTrusted = false;
  f.listeners.folders();
  assert.match(p.webview.html, /■ Arrêter/);
  await p.send({ action: 'stop', token, id: 'a'.repeat(32) });
  assert.equal(f.state.runStop, undefined);
  await p.send({ action: 'stop', token: p.token(), id: 'a'.repeat(32) });
  assert.equal(f.state.runStop, 'a'.repeat(32));
  await p.send({ action: 'logs', token: p.token(), id: 'a'.repeat(32) });
  assert.equal(f.state.runLogs, 'a'.repeat(32));
});

test('Given nested agent root, When trash is confirmed, Then trash-only request precedes exact root removal and no cloud execution occurs', async (t) => {
  const f = await fixture(t);
  await f.marker('sample/agent.authoring.json');
  await f.marker('sample/src/agent_app/agent.py');
  f.api.workspace.workspaceFolders.push({
    name: 'sample',
    uri: f.uri(path.join(f.root, 'sample')),
  });
  await f.host.open('agents');
  const p = f.state.panels[0];
  f.state.removeChoice = 'Mettre le projet à la corbeille…';
  f.state.confirmRemoval = 'Mettre à la corbeille';
  await p.send({ action: 'remove', token: p.token(), id: p.ids()[0] });
  assert.equal(f.state.deletes.length, 1);
  assert.deepEqual(
    { ...f.state.deletes[0].options },
    {
      recursive: true,
      useTrash: true,
    },
  );
  assert.equal(f.state.deletes[0].uri.fsPath, path.join(f.root, 'sample'));
  assert.equal(f.state.removes[0].index, 1);
  assert.equal(f.state.commands.length, 0);
});
test('Given cancellation, monorepo root, nested project, active task or changed files, When removal requested, Then no deletion is dispatched', async (t) => {
  for (const boundary of ['cancel', 'root', 'nested', 'active', 'changed']) {
    const f = await fixture(t);
    await f.marker(
      boundary === 'root'
        ? 'agent.authoring.json'
        : 'sample/agent.authoring.json',
    );
    if (boundary === 'nested')
      await f.marker('sample/child/agent.creation.json');
    if (boundary === 'active') f.state.runBusy = true;
    await f.host.open('agents');
    const p = f.state.panels[0];
    f.state.removeChoice = 'Mettre le projet à la corbeille…';
    f.state.confirmRemoval =
      boundary === 'cancel' ? undefined : 'Mettre à la corbeille';
    if (boundary === 'changed')
      f.state.onWarning = () =>
        fsp.writeFile(path.join(f.root, 'sample', 'new.txt'), 'changed');
    await p.send({ action: 'remove', token: p.token(), id: p.ids()[0] });
    assert.equal(f.state.deletes, undefined, boundary);
    assert.equal(f.state.removes, undefined, boundary);
  }
});
test('Given explicit workspace root, When removing without trash, Then files stay and an embedded-only row explains why it remains discoverable', async (t) => {
  const f = await fixture(t);
  await f.marker('sample/agent.authoring.json');
  await f.host.open('agents');
  const p = f.state.panels[0];
  f.state.removeChoice = 'Retirer du workspace — conserver les fichiers';
  await p.send({ action: 'remove', token: p.token(), id: p.ids()[0] });
  assert.match(f.state.info, /imbriqué/);
  assert.equal(f.state.removes, undefined);
  f.api.workspace.workspaceFolders.push({
    name: 'sample',
    uri: f.uri(path.join(f.root, 'sample')),
  });
  await f.host.open('agents');
  f.state.confirmRemoval = 'Retirer du workspace';
  await p.send({ action: 'remove', token: p.token(), id: p.ids()[0] });
  assert.equal(f.state.removes[0].index, 1);
  assert.equal(f.state.deletes, undefined);
  assert.equal(
    (await fsp.stat(path.join(f.root, 'sample'))).isDirectory(),
    true,
  );
});

test('Given trash refusal or workspace change during trash, Then no permanent retry or unrelated root removal happens', async (t) => {
  for (const boundary of ['refused', 'changed']) {
    const f = await fixture(t);
    await f.marker('sample/agent.authoring.json');
    f.api.workspace.workspaceFolders.push({
      name: 'sample',
      uri: f.uri(path.join(f.root, 'sample')),
    });
    await f.host.open('agents');
    const p = f.state.panels[0];
    f.state.removeChoice = 'Mettre le projet à la corbeille…';
    f.state.confirmRemoval = 'Mettre à la corbeille';
    f.state.onDelete = () => {
      if (boundary === 'refused') throw Error('trash unavailable');
      f.api.workspace.workspaceFolders = [];
      f.listeners.folders();
    };
    await p.send({ action: 'remove', token: p.token(), id: p.ids()[0] });
    assert.equal(f.state.deletes.length, 1);
    assert.equal(f.state.deletes[0].options.useTrash, true);
    assert.equal(f.state.removes, undefined);
  }
});
test('Given unsaved editor, repository boundary or linked child, Then destructive action is refused', async (t) => {
  for (const boundary of ['dirty', 'git', 'link']) {
    const f = await fixture(t);
    await f.marker('sample/agent.authoring.json');
    if (boundary === 'dirty')
      f.api.workspace.textDocuments = [
        { isDirty: true, uri: f.uri(path.join(f.root, 'sample', 'code.py')) },
      ];
    if (boundary === 'git') await f.marker('sample/.git/config');
    if (boundary === 'link')
      await fsp.symlink(f.root, path.join(f.root, 'sample', 'linked'));
    await f.host.open('agents');
    const p = f.state.panels[0];
    f.state.removeChoice = 'Mettre le projet à la corbeille…';
    f.state.confirmRemoval = 'Mettre à la corbeille';
    await p.send({ action: 'remove', token: p.token(), id: p.ids()[0] });
    assert.equal(f.state.deletes, undefined, boundary);
  }
});

test('Given integration-required agent, Then actions contain only vertical buttons and configuration remains available', async (t) => {
  const f = await fixture(t);
  await f.marker('sample/agent.authoring.json');
  f.state.readiness = 'Intégration requise — commande déjà définie';
  await f.host.open('agents');
  const p = f.state.panels[0];
  assert.doesNotMatch(
    p.webview.html,
    /Intégration requise — commande déjà définie/,
  );
  assert.match(p.webview.html, /Lancement non activé/);
  const cell = p.webview.html.match(/<td class="row-actions">(.*?)<\x2ftd>/)[1];
  assert.equal([...cell.matchAll(/<button /g)].length, 3);
  assert.equal(cell.replace(/<button\b[^>]*>.*?<\x2fbutton>/g, ''), '');
  assert.match(cell, /data-action="configure"[^>]*>Configuration/);
  assert.doesNotMatch(cell, /data-action="run"/);
  await p.send({ action: 'configure', token: p.token(), id: p.ids()[0] });
  assert.equal(f.state.runConfig, path.join(f.root, 'sample'));
  assert.equal(f.state.runStart, undefined);
  const css = fs.readFileSync(
    path.join(__dirname, '../media/localInventory.css'),
    'utf8',
  );
  assert.match(
    css,
    /td\.row-actions button\s*\{[^}]*display:\s*block;[^}]*width:\s*100%;/,
  );
  f.state.ready = true;
  f.state.readiness = undefined;
  await f.host.open('agents');
  assert.match(p.webview.html, /data-action="run"/);
  assert.doesNotMatch(
    p.webview.html,
    /Lancement configuré — effets non vérifiés/,
  );
});

test('three-column inventory preserves root identity and collapsed detection details', async (t) => {
  const f = await fixture(t);
  await f.marker('agent.authoring.json');
  await f.host.open('agents');
  const html = f.state.panels[0].webview.html;
  assert.match(
    html,
    /<table aria-label="Agents locaux"><thead><tr><th scope="col">Projet<\/th><th scope="col">État<\/th><th scope="col">Actions<\/th>/,
  );
  assert.equal([...html.matchAll(/<td\b/g)].length, 3);
  assert.ok(html.includes(f.root));
  assert.doesNotMatch(html, /Workspace \[1\]/);
  assert.doesNotMatch(html, /Détails de détection/);
  assert.doesNotMatch(html, /Marqueurs détectés/);
  assert.doesNotMatch(html, /<caption>|<details open/);
  assert.match(
    html,
    /<section class="inventory-band"><p role="status">Inventaire complet — 1 projet/,
  );
});

test('readiness maps to focused explained statuses and safe action hierarchy', async (t) => {
  for (const [readiness, tone, label, action] of [
    [
      'Lancement configuré — effets non vérifiés',
      'configured',
      'Configuré',
      'run',
    ],
    [
      'Intégration requise — commande déjà définie',
      'incomplete',
      'À compléter',
      'configure',
    ],
    ['Configuration requise', 'incomplete', 'À compléter', 'configure'],
    [
      'Point d’entrée absent — compilation ou installation à vérifier',
      'blocked',
      'Bloqué',
      'configure',
    ],
    [
      'Configuration invalide ou inaccessible',
      'blocked',
      'Bloqué',
      'configure',
    ],
    ['Indisponible', 'blocked', 'Bloqué', 'configure'],
    ['État inconnu', 'unverified', 'Non vérifié', 'configure'],
  ]) {
    const f = await fixture(t);
    await f.marker('sample/agent.authoring.json');
    f.state.readiness = readiness;
    await f.host.open('agents');
    const html = f.state.panels[0].webview.html;
    assert.ok(
      html.includes(
        'class="inventory-status status-' +
          tone +
          '" role="img" tabindex="0" aria-label="' +
          label +
          '"',
      ),
    );
    assert.ok(
      html.includes(
        '<span class="status-dot" aria-hidden="true"></span>' +
          label +
          '</span>',
      ),
    );
    const tooltip = html.match(
      /role="tooltip" id="(status-[a-f0-9]{32})">(.*?)<\/span>/,
    );
    assert.ok(html.includes(`aria-describedby="${tooltip[1]}"`));
    assert.ok(html.includes(`title="${tooltip[2]}"`));
    assert.doesNotMatch(tooltip[2], /\n/);
    assert.doesNotMatch(html, /▶|🟢|🟠|🔴|En cours|Prêt à lancer/);
    if (tone === 'configured')
      assert.match(
        tooltip[2],
        /Configuration et point d’entrée présents ; endpoint et dépendances non vérifiés/,
      );
    const cell = html.match(/<td class="row-actions">(.*?)<\/td>/)[1];
    assert.deepEqual(
      [...cell.matchAll(/data-action="([^"]+)"/g)].map((match) => match[1]),
      ['open', action, 'remove'],
    );
    assert.doesNotMatch(cell, /class="secondary"/);
    assert.match(cell, /data-action="remove"/);
    assert.match(cell, /aria-label="Ouvrir le code de sample"/);
    assert.match(cell, /aria-label="Retirer sample"/);
    assert.ok(
      cell.includes(
        action === 'run' ? '>Exécuter</button>' : '>Configuration</button>',
      ),
    );
  }
  const css = fs.readFileSync(
    path.join(__dirname, '../media/localInventory.css'),
    'utf8',
  );
  assert.match(css, /\.status-wrap:focus-within \.status-explanation/);
  assert.match(css, /\.inventory-status:focus-visible/);
  assert.match(css, /\.status-dot\s*\{[^}]*background: var\(--status-color\)/);
  for (const tone of ['configured', 'incomplete', 'blocked', 'unverified'])
    assert.match(
      css,
      new RegExp(
        `\\.status-${tone}\\s*\\{[^}]*--status-color: var\\(--vscode-`,
      ),
    );
});

test('tools without runner remain gray unverified with detection provenance and no launch', async (t) => {
  const f = await fixture(t);
  await f.marker('sample/server.py');
  f.state.ready = true;
  await f.host.open('tools');
  const html = f.state.panels[0].webview.html;
  assert.match(html, /status-unverified.*aria-label="Non vérifié"/);
  assert.match(html, /Détection de fichiers uniquement/);
  assert.match(html, /Fichier candidat — projet non identifié/);
  assert.doesNotMatch(
    html,
    /status-configured|data-action="run"|data-action="configure"|data-action="remove"/,
  );
});

test('project information replaces detection prose and all action buttons share one style', async (t) => {
  const f = await fixture(t);
  await f.marker('sample/agent.authoring.json');
  f.state.projectInfo = [
    ['Langage', 'python'],
    ['Modèle', 'deepseek-v4.1-flash'],
    ['Backend', '<unsafe>'],
  ];
  await f.host.open('agents');
  const html = f.state.panels[0].webview.html;
  assert.match(html, /Informations du projet/);
  assert.match(html, /<dt>Langage/);
  assert.match(html, /deepseek-v4.1-flash/);
  assert.match(html, /&lt;unsafe&gt;/);
  assert.doesNotMatch(
    html,
    /Détails de détection|Marqueurs détectés|Projet marqué|class="secondary"/,
  );
  const css = fs.readFileSync(
    path.join(__dirname, '../media/localInventory.css'),
    'utf8',
  );
  assert.doesNotMatch(css, /button\.secondary/);
});
