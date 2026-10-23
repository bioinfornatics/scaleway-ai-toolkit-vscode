const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const TOML = require('@iarna/toml');
const {
  parseTemplate,
  discoverTemplates,
  writeTemplate,
} = require('../dist/templateLibrary');
const {
  renderProjectTemplate,
  prepareEmbeddedProject,
  installCommand,
} = require('../dist/projectGenerator');
const { stackChoices } = require('../dist/stackScaffold');
const {
  builtinTemplates,
  materializeTemplate,
} = require('../dist/agentScaffold');
function definition() {
  return {
    version: 2,
    id: 'sample',
    label: 'Sample',
    kind: 'agents',
    description: 'Base',
    project: {
      language: 'python',
      package_manager: 'uv',
      engine: 'mustache',
      render: {
        'README.md': 'text',
        'config.json': 'json',
        'pyproject.toml': 'toml',
      },
    },
    files: {
      'README.md': 'Project {{project_name}} / {{module_name}}',
      'config.json': JSON.stringify({
        model: '{{model_id}}',
        name: '{{project_name}}',
      }),
      'pyproject.toml':
        '[project]\nname = "{{package_name}}"\nversion = "0.1.0"\n',
      'raw.txt': '{{intentionally_unchanged}}',
    },
  };
}
test('real Mustache renders restricted scalars and JSON/TOML serialize model characters', () => {
  const input = definition();
  const model = 'model" " {{project_name}}';
  const output = renderProjectTemplate(input, {
    name: 'My_Agent',
    modelId: model,
  });
  assert.equal(output.files['README.md'], 'Project My_Agent / app_my_agent');
  assert.equal(JSON.parse(output.files['config.json']).model, model);
  assert.equal(
    TOML.parse(output.files['pyproject.toml']).project.name,
    'my-agent',
  );
  assert.equal(output.files['raw.txt'], '{{intentionally_unchanged}}');
  assert.notEqual(input.files['README.md'], output.files['README.md']);
  assert.deepEqual(installCommand(output), {
    executable: 'uv',
    args: ['sync'],
  });
});
test('legacy exact copy and no inferred install; strict v2 metadata rejects hooks/mismatch/paths', () => {
  const { project, ...legacy } = definition();
  legacy.version = 1;
  assert.deepEqual(
    { ...renderProjectTemplate(legacy, { name: 'my-agent' }).files },
    legacy.files,
  );
  assert.equal(installCommand(legacy), undefined);
  for (const project of [
    { ...definition().project, package_manager: 'cargo' },
    { ...definition().project, engine: 'cookiecutter' },
    { ...definition().project, hooks: ['run'] },
    { ...definition().project, render: { missing: 'text' } },
    { ...definition().project, render: { 'pyproject.toml': 'text' } },
  ])
    assert.throws(() => parseTemplate({ ...definition(), project }));
  assert.throws(() => parseTemplate({ ...definition(), extra: 'hook' }));
});
test('unknown expressions, sections, partials, unescaped tags, delimiter changes and model in source refused', () => {
  for (const text of [
    '{{unknown}}',
    '{{#project_name}}x{{/project_name}}',
    '{{>partial}}',
    '{{{project_name}}}',
    '{{& project_name}}',
    '{{=<< >>=}}<<project_name>>',
    '{{model_id}}',
  ]) {
    const d = definition();
    d.files['README.md'] = text;
    assert.throws(() =>
      renderProjectTemplate(d, { name: 'my-agent', modelId: 'model' }),
    );
  }
  assert.throws(() =>
    renderProjectTemplate(definition(), { name: '../outside' }),
  );
  const d = definition();
  d.files['config.json'] = '{"{{project_name}}":1}';
  assert.throws(() => renderProjectTemplate(d, { name: 'my-agent' }));
});
for (const kind of ['agents', 'tools']) {
  for (const choice of stackChoices(kind)) {
    test(`${kind} ${choice.language} ${choice.framework} package manifest and exclusive filesystem creation`, async (t) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scw-generator-'));
      t.after(() => fs.rm(root, { recursive: true, force: true }));
      const result = renderProjectTemplate(
        prepareEmbeddedProject(choice.template, choice.language),
        { name: 'my-project' },
      );
      const command = installCommand(result);
      assert.equal(
        command.executable,
        { python: 'uv', typescript: 'bun', rust: 'cargo' }[choice.language],
      );
      if (choice.language === 'python') {
        const py = TOML.parse(result.files['pyproject.toml']);
        assert.equal(py.project.name, 'my-project');
        assert.equal(py.tool.uv.package, kind === 'agents');
      }
      if (choice.language === 'rust')
        assert.equal(
          TOML.parse(result.files['Cargo.toml']).package.name,
          'my-project',
        );
      if (choice.language === 'typescript')
        assert.equal(
          JSON.parse(result.files['package.json']).name,
          'my-project',
        );
      const project = await materializeTemplate(root, 'my-project', result);
      for (const [p, content] of Object.entries(result.files))
        assert.equal(await fs.readFile(path.join(project, p), 'utf8'), content);
      await assert.rejects(materializeTemplate(root, 'my-project', result));
    });
  }
  for (const builtin of builtinTemplates(kind))
    test(`${kind} builtin ${builtin.id} supports uv preparation`, () => {
      assert.equal(
        installCommand(
          renderProjectTemplate(prepareEmbeddedProject(builtin, 'python'), {
            name: 'my-project',
          }),
        ).executable,
        'uv',
      );
    });
}
test('project and global v2 libraries merge with project priority and materialize with same renderer', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scw-v2-library-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = path.join(root, 'project'),
    home = path.join(root, 'home');
  await fs.mkdir(project);
  await fs.mkdir(home);
  await writeTemplate(path.join(home, '.scaleway-ai/templates'), definition());
  await writeTemplate(path.join(project, '.scaleway-ai/templates'), {
    ...definition(),
    label: 'Project base',
  });
  const inventory = await discoverTemplates([project], home, 'agents');
  assert.equal(inventory.entries.length, 1);
  assert.equal(inventory.entries[0].origin, 'project');
  assert.equal(inventory.entries[0].template.version, 2);
  const rendered = renderProjectTemplate(inventory.entries[0].template, {
    name: 'chosen',
    modelId: 'deepseek-v4.1-flash',
  });
  const destination = await materializeTemplate(project, 'chosen', rendered);
  assert.equal(
    JSON.parse(await fs.readFile(path.join(destination, 'config.json'), 'utf8'))
      .model,
    'deepseek-v4.1-flash',
  );
});
