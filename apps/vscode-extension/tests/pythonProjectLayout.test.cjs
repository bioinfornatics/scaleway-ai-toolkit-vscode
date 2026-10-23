const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const TOML = require('@iarna/toml');
const { loadEmbeddedTemplates } = require('../dist/embeddedTemplates');
const { composeAgentProject } = require('../dist/agentProject');
const { stackChoices } = require('../dist/stackScaffold');
const {
  prepareEmbeddedProject,
  renderProjectTemplate,
} = require('../dist/projectGenerator');
const { materializeTemplate } = require('../dist/agentScaffold');

const entries = ['stack', 'builtin'].flatMap((usage) =>
  loadEmbeddedTemplates('agents', usage).filter((e) => e.language === 'python'),
);
// Require scenario identities, not merely an aggregate passing count.
const requiredUnitScenarios = [
  'tests/unit/test_config.py::test_explicit_configuration_and_redacted_repr',
  'tests/unit/test_config.py::test_environment_only_read_when_called',
  ...[
    'http://example.invalid',
    'https://user:pass@example.invalid',
    'https://example.invalid?x=value',
    'https://example.invalid#fragment',
    'https://example.invalid:bad',
  ].map(
    (endpoint) =>
      'tests/unit/test_config.py::test_invalid_endpoint_without_value_exposure[' +
      endpoint +
      ']',
  ),
  'tests/unit/test_config.py::test_explicit_empty_config_has_no_environment_fallback',
];
const collectedIds = (stdout) =>
  stdout
    .split(/\r?\n/)
    .filter((line) => line.includes('::'))
    .sort();
const shared = [
  'src/agent_app/__init__.py',
  'src/agent_app/config.py',
  'tests/unit/test_config.py',
  'tests/integration/README.md',
  'evals/README.md',
  'evals/test_agent_eval.py',
];

test('eight real embedded Python trees share identical config and tests and retain metadata', () => {
  assert.equal(entries.length, 8);
  for (const entry of entries) {
    for (const file of shared) {
      let expected = entries[0].template.files[file];
      if (entry.framework === 'agentos' && file === 'src/agent_app/config.py') {
        // Dedicated installed console contract: cwd root, never site-packages ancestry.
        expected = expected
          .replace(
            'Load the project .env explicitly when launching/building the agent.',
            'Explicit launch reads only .env in cwd (the documented project root).',
          )
          .replace('Path(__file__).resolve().parents[2]', 'Path.cwd()');
      }
      assert.equal(entry.template.files[file], expected);
    }
    assert.equal(entry.template.files['agent.py'], undefined);
    assert.ok(
      entry.template.files[
        entry.category === 'agent' || entry.framework === 'agentos'
          ? 'src/agent_app/agent.py'
          : 'src/agent_app/api.py'
      ],
    );
    assert.ok(
      Object.keys(entry.template.files).every((p) => !p.includes('{{')),
    );
  }
  const django = entries.find((e) => e.framework === 'django').template.files;
  assert.match(django['src/agent_app/api.py'], /agent_app.settings/);
  assert.match(
    django['src/agent_app/settings.py'],
    /ROOT_URLCONF = "agent_app.urls"/,
  );
  assert.match(django['src/agent_app/settings.py'], /SECRET_KEY = os.environ/);
});

const choices = stackChoices('agents').filter((c) => c.language === 'python');
const candidates = entries.map((entry) => ({
  label: entry.template.id,
  template: entry.template,
}));
for (const backend of choices.filter(
  (c) => c.category !== 'agent' && c.framework !== 'agentos',
))
  for (const sdk of choices.filter((c) => c.category === 'agent'))
    candidates.push({
      label: backend.framework + '+' + sdk.framework,
      template: composeAgentProject(backend, sdk, 'layout-agent'),
    });

for (const candidate of candidates)
  test(
    candidate.label +
      ': source-layout (not wheel): TOML, compile/import, named scenarios and guarded eval',
    async (t) => {
      const root = await fs.mkdtemp(
        path.join(os.tmpdir(), 'scw-python-layout-'),
      );
      t.after(() => fs.rm(root, { recursive: true, force: true }));
      const result = renderProjectTemplate(
        prepareEmbeddedProject(candidate.template, 'python'),
        { name: 'My_Agent' },
      );
      const py = TOML.parse(result.files['pyproject.toml']);
      assert.equal(py.project.name, 'my-agent');
      assert.equal(py['build-system']['build-backend'], 'hatchling.build');
      assert.deepEqual(py['build-system'].requires, ['hatchling>=1.27,<2']);
      assert.deepEqual(py.tool.hatch.build.targets.wheel.packages, [
        'src/agent_app',
      ]);
      assert.equal(py.tool.uv.package, true);
      assert.deepEqual(py['dependency-groups'], {
        dev: ['pytest>=8,<10'],
        eval: ['deepeval>=3,<4'],
      });
      assert.deepEqual(py.tool.pytest.ini_options.testpaths, ['tests']);
      assert.match(py.tool.pytest.ini_options.markers[0], /^integration:/);
      assert.ok(
        !py.project.dependencies.some((d) => /pytest|deepeval/.test(d)),
      );
      const project = await materializeTemplate(root, 'My_Agent', result);
      const env = {
        ...process.env,
        PYTHONPATH: path.join(project, 'src'),
        PYTHONDONTWRITEBYTECODE: '1',
        PYTEST_DISABLE_PLUGIN_AUTOLOAD: '1',
      };
      for (const key of [
        'SCW_API_KEY',
        'SCW_INFERENCE_BASE_URL',
        'SCW_INFERENCE_MODEL_ID',
        'AGENT_RUN_EVALS',
      ])
        delete env[key];
      const run = (args, extra = {}) =>
        spawnSync('python3', args, {
          cwd: project,
          env: { ...env, ...extra },
          encoding: 'utf8',
          timeout: 15000,
        });
      const compiled = run([
        '-c',
        [
          'import pathlib, tomllib, os, importlib',
          'p = tomllib.loads(pathlib.Path("pyproject.toml").read_text())',
          'assert p["tool"]["hatch"]["build"]["targets"]["wheel"]["packages"] == ["src/agent_app"]',
          'for file in pathlib.Path(".").rglob("*.py"): compile(file.read_text(), str(file), "exec")',
          'import agent_app, agent_app.config',
          'assert "SCW_API_KEY" not in os.environ',
          'if pathlib.Path("src/agent_app/agent.py").exists():',
          '    sdk = importlib.import_module("agent_app.agent")',
          '    os.environ.update(SCW_API_KEY="synthetic", SCW_INFERENCE_BASE_URL="https://example.invalid/v1", SCW_INFERENCE_MODEL_ID="model")',
          '    if (pathlib.Path("src/agent_app/service_api.py")).exists():',
          '        service = importlib.import_module("agent_app.service_api"); assert callable(service.create_app)',
          '    else: assert callable(sdk.build_agent)',
          '    sdk.load_project_config()',
        ].join('\n'),
      ]);
      assert.equal(
        compiled.status,
        0,
        compiled.stderr || String(compiled.error),
      );
      const collected = run([
        '-m',
        'pytest',
        '--collect-only',
        '-q',
        '-p',
        'no:cacheprovider',
      ]);
      assert.equal(collected.status, 0, collected.stdout + collected.stderr);
      assert.deepEqual(
        collectedIds(collected.stdout),
        [...requiredUnitScenarios].sort(),
      );
      assert.doesNotMatch(collected.stdout, /evals\/|test_agent_evaluation/);
      const unit = run(['-m', 'pytest', '-v', '-p', 'no:cacheprovider']);
      assert.equal(unit.status, 0, unit.stdout + unit.stderr);
      assert.match(unit.stdout, /8 passed/);
      assert.deepEqual(
        unit.stdout
          .split(/\r?\n/)
          .filter((line) => line.includes('::') && / PASSED(?: |$)/.test(line))
          .map((line) => line.slice(0, line.indexOf(' PASSED')))
          .sort(),
        [...requiredUnitScenarios].sort(),
      );
      assert.doesNotMatch(unit.stdout, /skipped/); // evals are not default discovery.
      const evalCollected = run([
        '-m',
        'pytest',
        'evals',
        '-m',
        'integration',
        '--collect-only',
        '-q',
        '-p',
        'no:cacheprovider',
      ]);
      assert.equal(
        evalCollected.status,
        0,
        evalCollected.stdout + evalCollected.stderr,
      );
      assert.deepEqual(collectedIds(evalCollected.stdout), [
        'evals/test_agent_eval.py::test_agent_evaluation_requires_integration',
      ]);
      const skipped = run([
        '-m',
        'pytest',
        'evals',
        '-m',
        'integration',
        '-q',
        '-p',
        'no:cacheprovider',
      ]);
      assert.equal(skipped.status, 0, skipped.stdout + skipped.stderr);
      assert.match(skipped.stdout, /1 skipped/);
      const opted = run(
        [
          '-m',
          'pytest',
          'evals',
          '-m',
          'integration',
          '-q',
          '-p',
          'no:cacheprovider',
        ],
        { AGENT_RUN_EVALS: '1' },
      );
      assert.equal(opted.status, 1, opted.stdout + opted.stderr);
      assert.match(opted.stdout, /NOT integrated/);
    },
  );

test('Python tools keep previous non-package preparation and personal templates stay byte-for-byte', () => {
  for (const entry of loadEmbeddedTemplates('tools', 'stack').filter(
    (e) => e.language === 'python',
  )) {
    const tool = prepareEmbeddedProject(entry.template, 'python');
    const py = TOML.parse(tool.files['pyproject.toml']);
    assert.equal(py.tool.uv.package, false);
    assert.equal(py['build-system'], undefined);
    assert.equal(py['dependency-groups'], undefined);
  }
  const personal = {
    version: 1,
    id: 'personal',
    label: 'Personal',
    kind: 'agents',
    description: '',
    files: {
      'custom.py': '# {{unchanged}}',
      'pyproject.toml': '[tool.uv]\npackage = false\n',
    },
  };
  const composed = composeAgentProject(
    undefined,
    undefined,
    'custom',
    undefined,
    personal,
  );
  for (const [file, bytes] of Object.entries(personal.files))
    assert.equal(composed.files[file], bytes);
  const rendered = renderProjectTemplate(personal, { name: 'custom' });
  assert.deepEqual({ ...rendered.files }, personal.files);
});
