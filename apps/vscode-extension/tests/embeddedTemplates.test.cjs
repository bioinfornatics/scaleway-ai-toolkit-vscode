const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const { test } = require('node:test');
const { transformSync } = require('esbuild');
function load(name) {
  const file = path.join(__dirname, '../src', `${name}.ts`);
  const m = new Module(file);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  m.require = (name) =>
    name.startsWith('./')
      ? load(name.slice(2))
      : Module.prototype.require.call(m, name);
  m._compile(
    transformSync(fs.readFileSync(file, 'utf8'), {
      loader: 'ts',
      format: 'cjs',
      target: 'node22',
    }).code,
    file,
  );
  return m.exports;
}
const { loadEmbeddedTemplates, EMBEDDED_TEMPLATE_ROOT } =
  load('embeddedTemplates');
const { materializeTemplate } = load('agentScaffold');
const golden = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, 'fixtures/embedded-templates-baseline.json'),
    'utf8',
  ),
);
async function fixture(t) {
  const parent = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'embedded-templates-'),
  );
  const root = path.join(parent, 'assets');
  await fsp.cp(EMBEDDED_TEMPLATE_ROOT, root, {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
  t.after(() => fsp.rm(parent, { recursive: true, force: true }));
  const catalog = JSON.parse(
    await fsp.readFile(path.join(root, 'catalog.json'), 'utf8'),
  );
  return {
    parent,
    root,
    catalog,
    manifest: path.join(root, catalog.templates[0]),
  };
}
for (const kind of ['agents', 'tools'])
  for (const usage of ['stack', 'builtin']) {
    test(`${kind}/${usage}: CLI migration preserves golden metadata and untouched library payload bytes`, () => {
      // Python agents intentionally migrate; historical golden covers unchanged bases.
      const preserved = (g) =>
        !(
          kind === 'agents' &&
          (g.language === 'python' || g.category === 'agent')
        );
      const before = golden.filter(
        (g) => g.template.kind === kind && g.usage === usage && preserved(g),
      );
      const after = loadEmbeddedTemplates(kind, usage).filter(preserved);
      const normalized = JSON.parse(JSON.stringify(after));
      for (const entry of normalized) {
        const old = before.find((g) => g.template.id === entry.template.id);
        for (const name of Object.keys(entry.template.files)) {
          if (!Object.hasOwn(old.template.files, name)) {
            assert.match(
              name,
              /^(src\/(main\.rs|backend-cli\.ts|cli\.ts)|src\/agent_app\/backend_cli\.py|tool_cli\.py|cli\.py)$/,
            );
            delete entry.template.files[name];
          } else if (name === 'README.md') {
            assert.ok(
              entry.template.files[name].startsWith(old.template.files[name]),
            );
            assert.match(
              entry.template.files[name].slice(old.template.files[name].length),
              /^\n\n## CLI shell\n/,
            );
            entry.template.files[name] = old.template.files[name];
          } else if (name === 'Cargo.toml') {
            entry.template.files[name] = entry.template.files[name].replace(
              'clap = { version = "4.5", features = ["derive"] }\n',
              '',
            );
          }
        }
      }
      assert.deepEqual(
        normalized,
        before.map((g) => ({
          language: g.language,
          framework: g.framework,
          category: g.category,
          usage: g.usage,
          template: g.template,
        })),
      );
    });
  }
test('migrated Python agents retain all golden envelope and catalog metadata', () => {
  for (const usage of ['stack', 'builtin']) {
    const entries = loadEmbeddedTemplates('agents', usage).filter(
      (e) => e.language === 'python',
    );
    for (const entry of entries) {
      const before = golden.find((g) => g.template.id === entry.template.id);
      assert.ok(before);
      const { files: oldFiles, ...oldEnvelope } = before.template;
      const { files: newFiles, ...newEnvelope } = entry.template;
      const { description: oldDescription, ...oldStable } = oldEnvelope;
      const { description: newDescription, ...newStable } = newEnvelope;
      assert.deepEqual(newStable, oldStable);
      for (const key of ['language', 'framework', 'category', 'usage'])
        assert.equal(entry[key], before[key]);
    }
  }
});
test('all loaded assets copy exclusively; Strands customization changes only JSON configuration', async (t) => {
  const f = await fixture(t);
  const output = path.join(f.parent, 'output');
  await fsp.mkdir(output);
  for (const usage of ['stack', 'builtin'])
    for (const kind of ['agents', 'tools']) {
      for (const entry of loadEmbeddedTemplates(kind, usage, f.root)) {
        const dir = await materializeTemplate(
          output,
          entry.template.id,
          entry.template,
        );
        for (const [name, content] of Object.entries(entry.template.files))
          assert.equal(
            await fsp.readFile(path.join(dir, name), 'utf8'),
            content,
          );
        await assert.rejects(
          materializeTemplate(output, entry.template.id, entry.template),
        );
      }
    }
  const base = loadEmbeddedTemplates('agents', 'stack', f.root).find(
    (e) => e.framework === 'strands' && e.language === 'python',
  ).template;
  const { composeAgentProject } = load('agentProject');
  const { stackChoices } = load('stackScaffold');
  const ai = stackChoices('agents').find(
    (s) => s.framework === 'strands' && s.language === 'python',
  );
  const customized = composeAgentProject(undefined, ai, 'new-agent');
  for (const [name, content] of Object.entries(base.files))
    if (name !== 'agent.authoring.json')
      assert.equal(customized.files[name], content);
  assert.equal(
    JSON.parse(customized.files['agent.authoring.json']).name,
    'new-agent',
  );
});
test('missing root, relative root, catalog traversal/duplicates/limits/schema fail closed', async (t) => {
  const f = await fixture(t);
  const save = async (value) =>
    fsp.writeFile(path.join(f.root, 'catalog.json'), JSON.stringify(value));
  assert.throws(
    () =>
      loadEmbeddedTemplates('agents', 'stack', path.join(f.root, 'missing')),
    /invalid_embedded_templates/,
  );
  assert.throws(
    () => loadEmbeddedTemplates('agents', 'stack', 'relative'),
    /invalid_embedded_templates/,
  );
  for (const value of [
    {},
    { format_version: 2, templates: f.catalog.templates },
    { ...f.catalog, extra: true },
    { ...f.catalog, templates: ['../secret/template.json'] },
    {
      ...f.catalog,
      templates: [f.catalog.templates[0], f.catalog.templates[0]],
    },
    { ...f.catalog, templates: Array(65).fill(f.catalog.templates[0]) },
  ]) {
    await save(value);
    assert.throws(
      () => loadEmbeddedTemplates('agents', 'stack', f.root),
      /invalid_embedded_templates/,
    );
  }
});
test('manifest path/category/kind/duplicate/case/payload/schema mismatch rejected before reads', async (t) => {
  const f = await fixture(t);
  const original = JSON.parse(await fsp.readFile(f.manifest, 'utf8'));
  for (const delta of [
    { language: 'rust' },
    { framework: 'mastra' },
    { kind: 'tools' },
    { usage: 'builtin' },
    { category: 'unknown' },
    { extra: 'field' },
    { files: ['../outside'] },
    { files: ['/absolute'] },
    { files: ['agent.py', 'agent.py'] },
    { files: ['agent.py', 'AGENT.PY'] },
    { files: ['a', 'a/b'] },
    { files: Array(65).fill('README.md') },
    { files: ['missing.py'] },
  ]) {
    await fsp.writeFile(f.manifest, JSON.stringify({ ...original, ...delta }));
    assert.throws(
      () => loadEmbeddedTemplates('agents', 'stack', f.root),
      /invalid_embedded_templates/,
    );
  }
});
test('symlink/hardlink/FIFO/directories/oversized/invalid UTF8 payloads and symlink roots refused', async (t) => {
  const f = await fixture(t);
  const target = path.join(
    f.root,
    'agents/python/strands/files/src/agent_app/agent.py',
  );
  const content = await fsp.readFile(target);
  const outside = path.join(f.parent, 'outside.py');
  await fsp.writeFile(outside, content);
  await fsp.unlink(target);
  await fsp.symlink(outside, target);
  assert.throws(
    () => loadEmbeddedTemplates('agents', 'stack', f.root),
    /invalid_embedded_templates/,
  );
  await fsp.unlink(target);
  await fsp.link(outside, target);
  assert.throws(
    () => loadEmbeddedTemplates('agents', 'stack', f.root),
    /invalid_embedded_templates/,
  );
  await fsp.unlink(target);
  await fsp.mkdir(target);
  assert.throws(
    () => loadEmbeddedTemplates('agents', 'stack', f.root),
    /invalid_embedded_templates/,
  );
  await fsp.rmdir(target);
  require('node:child_process').execFileSync('mkfifo', [target]);
  assert.throws(
    () => loadEmbeddedTemplates('agents', 'stack', f.root),
    /invalid_embedded_templates/,
  );
  await fsp.unlink(target);
  await fsp.writeFile(target, Buffer.alloc(256 * 1024 + 1, 65));
  assert.throws(
    () => loadEmbeddedTemplates('agents', 'stack', f.root),
    /invalid_embedded_templates/,
  );
  await fsp.writeFile(target, Buffer.from([255, 254]));
  assert.throws(
    () => loadEmbeddedTemplates('agents', 'stack', f.root),
    /invalid_embedded_templates/,
  );
  await fsp.writeFile(target, content);
  const link = path.join(f.parent, 'linked');
  await fsp.symlink(f.root, link);
  assert.throws(
    () => loadEmbeddedTemplates('agents', 'stack', link),
    /invalid_embedded_templates/,
  );
  const catalogFile = path.join(f.root, 'catalog.json');
  await fsp.unlink(catalogFile);
  await fsp.symlink(outside, catalogFile);
  assert.throws(
    () => loadEmbeddedTemplates('agents', 'stack', f.root),
    /invalid_embedded_templates/,
  );
});
test('source default resolves beside module not working directory; copy has no cached inline fallback', async (t) => {
  const f = await fixture(t);
  const cwd = process.cwd();
  try {
    process.chdir(f.parent);
    assert.equal(loadEmbeddedTemplates('tools', 'builtin').length, 2);
  } finally {
    process.chdir(cwd);
  }
  assert.equal(loadEmbeddedTemplates('tools', 'builtin', f.root).length, 2);
  await fsp.unlink(
    path.join(f.root, 'tools/python/mcp/builtin/files/server.py'),
  );
  assert.throws(
    () => loadEmbeddedTemplates('tools', 'builtin', f.root),
    /invalid_embedded_templates/,
  );
});

test('build verifier derives tree only from safe reads, rejects catalog FIFO/missing/extra files without hang', async (t) => {
  const f = await fixture(t);
  const projection = path.join(f.parent, 'extension');
  await fsp.mkdir(path.join(projection, 'assets'), { recursive: true });
  await fsp.cp(f.root, path.join(projection, 'assets/templates'), {
    recursive: true,
  });
  await fsp.mkdir(path.join(projection, 'dist'));
  // Compile installed module projection; no source lookup or executing template code.
  for (const name of ['embeddedTemplates', 'templateLibrary']) {
    const source = await fsp.readFile(
      path.join(__dirname, '../src', `${name}.ts`),
      'utf8',
    );
    const compiled = transformSync(source, {
      loader: 'ts',
      format: 'cjs',
      target: 'node22',
    }).code;
    await fsp.writeFile(path.join(projection, 'dist', `${name}.js`), compiled);
  }
  await fsp.copyFile(
    path.join(__dirname, '../verifyAssets.mjs'),
    path.join(projection, 'verifyAssets.mjs'),
  );
  const run = () =>
    require('node:child_process').spawnSync(
      process.execPath,
      [path.join(projection, 'verifyAssets.mjs')],
      { cwd: f.parent, encoding: 'utf8', timeout: 3000 },
    );
  assert.equal(run().status, 0);
  const cat = path.join(projection, 'assets/templates/catalog.json');
  const saved = await fsp.readFile(cat);
  await fsp.unlink(cat);
  require('node:child_process').execFileSync('mkfifo', [cat]);
  const failed = run();
  assert.equal(failed.error, undefined);
  assert.notEqual(failed.status, 0);
  await fsp.unlink(cat);
  await fsp.writeFile(cat, saved);
  await fsp.writeFile(
    path.join(projection, 'assets/templates/undeclared.txt'),
    'unexpected',
  );
  assert.notEqual(run().status, 0);
});
