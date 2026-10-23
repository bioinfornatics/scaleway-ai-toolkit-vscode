const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const { transformSync } = require('esbuild');
const ts = require('typescript');
function load(name) {
  const file = path.join(__dirname, '../src', `${name}.ts`);
  const mod = new Module(file);
  mod.filename = file;
  mod.paths = Module._nodeModulePaths(path.dirname(file));
  mod.require = (request) =>
    request.startsWith('./')
      ? load(request.slice(2))
      : Module.prototype.require.call(mod, request);
  mod._compile(
    transformSync(fs.readFileSync(file, 'utf8'), {
      loader: 'ts',
      format: 'cjs',
      target: 'node22',
    }).code,
    file,
  );
  return mod.exports;
}
const { stackChoices } = load('stackScaffold');
const { parseTemplate } = load('templateLibrary');
const { materializeTemplate } = load('agentScaffold');
const matrix = {
  agents: {
    python: [
      'strands',
      'langchain',
      'fastapi',
      'litestar',
      'agentos',
      'django',
      'none',
    ],
    typescript: ['langchain', 'strands', 'mastra', 'nestjs', 'elysia', 'none'],
    rust: ['axum', 'actix', 'none'],
  },
  tools: {
    python: ['fastapi', 'django', 'none'],
    typescript: ['nestjs', 'elysia', 'none'],
    rust: ['axum', 'actix', 'none'],
  },
};
for (const kind of ['agents', 'tools']) {
  test(`${kind}: exact compatible framework matrix, unique IDs and fresh valid envelopes`, () => {
    const choices = stackChoices(kind);
    assert.equal(
      new Set(choices.map((s) => s.template.id)).size,
      choices.length,
    );
    for (const language of ['python', 'typescript', 'rust'])
      assert.deepEqual(
        choices.filter((s) => s.language === language).map((s) => s.framework),
        matrix[kind][language],
      );
    for (const choice of choices) {
      assert.equal(parseTemplate(choice.template).kind, kind);
      assert.doesNotMatch(
        JSON.stringify(choice.template),
        /anthropic|bedrock|api\.openai\.com|contract_version/,
      );
      const marker =
        choice.template.files[
          kind === 'agents' ? 'agent.authoring.json' : 'tool.authoring.json'
        ];
      assert.ok(marker);
      assert.doesNotThrow(() => JSON.parse(marker));
      const fresh = stackChoices(kind).find(
        (s) => s.template.id === choice.template.id,
      );
      choice.template.files['README.md'] = 'modified';
      assert.notEqual(fresh.template.files['README.md'], 'modified');
    }
  });
  test(`${kind}: each scaffold has language source and dependency/config syntax`, () => {
    for (const s of stackChoices(kind)) {
      const files = s.template.files;
      for (const [name, content] of Object.entries(files)) {
        if (name.endsWith('.json'))
          assert.doesNotThrow(() => JSON.parse(content), name);
        if (name.endsWith('.ts')) {
          const result = ts.transpileModule(content, {
            fileName: name,
            reportDiagnostics: true,
            compilerOptions: {
              target: ts.ScriptTarget.ES2022,
              experimentalDecorators: true,
            },
          });
          assert.equal(
            result.diagnostics.filter(
              (d) => d.category === ts.DiagnosticCategory.Error,
            ).length,
            0,
          );
        }
        if (name.endsWith('.py')) {
          const result = spawnSync(
            'python3',
            ['-c', 'import ast,sys; ast.parse(sys.stdin.read())'],
            { input: content, encoding: 'utf8' },
          );
          assert.equal(result.status, 0, `${name}: ${result.stderr}`);
        }
      }
      if (s.language === 'typescript')
        assert.ok(files['package.json'] && files['tsconfig.json']);
      if (s.language === 'rust')
        assert.ok(files['Cargo.toml'] && files['src/lib.rs']);
      if (s.framework === 'django')
        assert.match(
          files[
            kind === 'agents' ? 'src/agent_app/settings.py' : 'settings.py'
          ],
          /SECRET_KEY = os.environ/,
        );
      if (s.framework === 'elysia') assert.match(files['README.md'], /Bun/);
      if (s.category === 'agent')
        assert.match(
          Object.entries(files)
            .filter(([n]) => /\.(py|ts)$/.test(n))
            .map(([, c]) => c)
            .join('\n'),
          /build_agent|buildAgent/,
        );
      if (s.framework === 'agentos')
        assert.match(s.description, /Agno \+ AgentOS/);
      else if (s.category === 'backend')
        assert.match(s.description, /intégrer/);
    }
  });
  test(`${kind}: all stacks materialize exclusive actual temporary files`, {
    skip: process.platform !== 'linux',
  }, async (t) => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'stack-scaffold-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    for (const choice of stackChoices(kind)) {
      const directory = await materializeTemplate(
        root,
        choice.template.id,
        choice.template,
      );
      for (const [name, content] of Object.entries(choice.template.files))
        assert.equal(
          await fsp.readFile(path.join(directory, name), 'utf8'),
          content,
        );
      await assert.rejects(
        materializeTemplate(root, choice.template.id, choice.template),
      );
    }
  });
}
test('invalid kind rejected and Rust never advertises absent requested agent SDKs', () => {
  assert.throws(() => stackChoices('models'));
  assert.ok(
    stackChoices('agents')
      .filter((s) => s.language === 'rust')
      .every((s) => s.category !== 'agent'),
  );
});
