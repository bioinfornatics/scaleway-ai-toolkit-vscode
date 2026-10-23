const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadEmbeddedTemplates } = require('../dist/embeddedTemplates');
const { composeAgentProject } = require('../dist/agentProject');
const { stackChoices } = require('../dist/stackScaffold');
const {
  prepareEmbeddedProject,
  renderProjectTemplate,
} = require('../dist/projectGenerator');

// This proof NEVER substitutes PYTHONPATH for a real wheel installation.
test('opt-in offline wheel build/install: six bases and six backend+SDK compositions', {
  skip:
    process.env.SCW_PYTHON_WHEEL_PROOF !== '1'
      ? 'NOT RUN: set SCW_PYTHON_WHEEL_PROOF=1; requires cached uv Hatchling and pytest, no downloads'
      : false,
}, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scw-python-wheel-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const env = {
    ...process.env,
    PYTHONDONTWRITEBYTECODE: '1',
    PYTEST_DISABLE_PLUGIN_AUTOLOAD: '1',
    UV_OFFLINE: '1',
    UV_PYTHON_DOWNLOADS: 'never',
    UV_NO_CONFIG: '1',
  };
  for (const key of Object.keys(env)) {
    if (
      /^(SCW_|AGENT_|PYTHONPATH$|PYTHONHOME$|VIRTUAL_ENV$|UV_INDEX|UV_EXTRA_INDEX|UV_FIND_LINKS|UV_PYTHON$|UV_PROJECT_ENVIRONMENT$)/.test(
        key,
      )
    )
      delete env[key];
  }
  const run = (exe, args, cwd = root, extra = {}) =>
    spawnSync(exe, args, {
      cwd,
      env: { ...env, ...extra },
      encoding: 'utf8',
      timeout: 60000,
    });
  const detail = (r) =>
    [r.error?.message, r.stdout, r.stderr].filter(Boolean).join('\n');
  const requireSuccess = (r) => assert.equal(r.status, 0, detail(r));
  const uvVersion = run('uv', ['--version']);
  if (uvVersion.status !== 0) {
    t.skip('BLOCKED: offline wheel tooling unavailable: ' + detail(uvVersion));
    return;
  }
  const interpreter = run('python3', [
    '-I',
    '-c',
    'import sys; print(sys.executable)',
  ]);
  if (interpreter.status !== 0) {
    t.skip(
      'BLOCKED: local python3 unavailable; downloads forbidden: ' +
        detail(interpreter),
    );
    return;
  }
  const tools = path.join(root, 'tools');
  const created = run('uv', [
    'venv',
    '--offline',
    '--no-project',
    '--no-python-downloads',
    '--python',
    interpreter.stdout.trim(),
    tools,
  ]);
  if (created.status !== 0) {
    t.skip(
      'BLOCKED: temporary offline tooling virtualenv unavailable: ' +
        detail(created),
    );
    return;
  }
  const toolPython = path.join(tools, 'bin', 'python');
  const cached = run('uv', [
    'pip',
    'install',
    '--offline',
    '--no-python-downloads',
    '--link-mode',
    'copy',
    '--python',
    toolPython,
    'hatchling>=1.27,<2',
    'pytest>=8,<10',
  ]);
  if (cached.status !== 0) {
    t.skip(
      'BLOCKED: cached Hatchling/pytest or transitive build/test tooling unavailable (no network fallback): ' +
        detail(cached),
    );
    return;
  }
  const versions = run(toolPython, [
    '-I',
    '-c',
    'import sys, importlib.metadata as m; print(sys.version); print("hatchling="+m.version("hatchling")); print("pytest="+m.version("pytest"))',
  ]);
  requireSuccess(versions);
  t.diagnostic(uvVersion.stdout.trim() + '\n' + versions.stdout.trim());
  const entries = ['stack', 'builtin'].flatMap((usage) =>
    loadEmbeddedTemplates('agents', usage).filter(
      (e) => e.language === 'python',
    ),
  );
  const choices = stackChoices('agents').filter((c) => c.language === 'python');
  const candidates = entries.map((entry) => ({
    label: entry.template.id,
    template: entry.template,
  }));
  for (const backend of choices.filter((c) => c.category !== 'agent'))
    for (const sdk of choices.filter((c) => c.category === 'agent'))
      candidates.push({
        label: backend.framework + '+' + sdk.framework,
        template: composeAgentProject(backend, sdk, 'wheel-agent'),
      });
  assert.equal(entries.length, 6);
  assert.equal(candidates.length, 12);
  for (const [index, candidate] of candidates.entries())
    await t.test(candidate.label, async (sub) => {
      const project = path.join(root, 'project-' + index);
      const output = path.join(root, 'wheels-' + index);
      const verify = path.join(root, 'outside-source-' + index);
      await fs.mkdir(project);
      await fs.mkdir(verify);
      const rendered = renderProjectTemplate(
        prepareEmbeddedProject(candidate.template, 'python'),
        { name: 'Wheel_Agent' },
      );
      for (const [relative, bytes] of Object.entries(rendered.files)) {
        const destination = path.join(project, relative);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.writeFile(destination, bytes);
      }
      // Cached tooling is confined to /tmp; project and runtime dependencies are never installed.
      requireSuccess(
        run('uv', [
          'build',
          '--offline',
          '--no-python-downloads',
          '--wheel',
          '--no-build-isolation',
          '--python',
          toolPython,
          '--out-dir',
          output,
          project,
        ]),
      );
      const wheels = (await fs.readdir(output)).filter((name) =>
        name.endsWith('.whl'),
      );
      assert.equal(wheels.length, 1);
      const wheel = path.join(output, wheels[0]);
      const inspected = run(toolPython, [
        '-I',
        '-c',
        [
          'import zipfile, sys, hashlib, email',
          'from pathlib import Path',
          'p=Path(sys.argv[1]); z=zipfile.ZipFile(p); names=z.namelist()',
          'assert "agent_app/__init__.py" in names and "agent_app/config.py" in names',
          'assert not any(n.startswith(("src/", "tests/", "evals/")) for n in names)',
          'metadata=email.message_from_bytes(z.read(next(n for n in names if n.endswith(".dist-info/METADATA"))))',
          'assert metadata["Name"] == "wheel-agent" and metadata["Version"] == "0.1.0"',
          'print(p.name + " sha256=" + hashlib.sha256(p.read_bytes()).hexdigest())',
        ].join('\n'),
        wheel,
      ]);
      requireSuccess(inspected);
      const venv = path.join(root, 'installed-' + index);
      requireSuccess(
        run('uv', [
          'venv',
          '--offline',
          '--no-project',
          '--no-python-downloads',
          '--python',
          interpreter.stdout.trim(),
          venv,
        ]),
      );
      const python = path.join(venv, 'bin', 'python');
      requireSuccess(
        run('uv', [
          'pip',
          'install',
          '--offline',
          '--no-index',
          '--no-deps',
          '--link-mode',
          'copy',
          '--python',
          python,
          wheel,
        ]),
      );
      requireSuccess(
        run('uv', [
          'pip',
          'install',
          '--offline',
          '--link-mode',
          'copy',
          '--python',
          python,
          'pytest>=8,<10',
        ]),
      );
      // Isolated Python + unrelated cwd; assert site-packages origin, no editable/source path.
      const imported = run(
        python,
        [
          '-I',
          '-c',
          [
            'import sys, pathlib, importlib.metadata as m, importlib.abc, os',
            'class RejectRuntime(importlib.abc.MetaPathFinder):',
            '    def find_spec(self, fullname, path=None, target=None):',
            '        if fullname.split(".")[0] in {"strands", "langchain", "langchain_openai", "openai", "boto3", "fastapi", "django", "deepeval"}: raise AssertionError("runtime import forbidden: " + fullname)',
            'sys.meta_path.insert(0, RejectRuntime())',
            'import agent_app, agent_app.config',
            'location=pathlib.Path(agent_app.__file__).resolve()',
            'assert location.is_relative_to(pathlib.Path(sys.prefix).resolve()) and "site-packages" in location.parts',
            'assert m.version("wheel-agent") == "0.1.0"',
            'assert "PYTHONPATH" not in os.environ and "SCW_API_KEY" not in os.environ',
            'if (location.parent / "agent.py").exists():',
            '    from agent_app.agent import build_agent',
            '    os.environ.update(SCW_API_KEY="synthetic-not-a-credential", SCW_INFERENCE_BASE_URL="https://example.invalid/v1", SCW_INFERENCE_MODEL_ID="model")',
            '    assert callable(build_agent)',
            'print("installed import origin="+str(location))',
          ].join('\n'),
        ],
        verify,
      );
      requireSuccess(imported);
      await fs.cp(path.join(project, 'tests'), path.join(verify, 'tests'), {
        recursive: true,
      });
      await fs.cp(path.join(project, 'evals'), path.join(verify, 'evals'), {
        recursive: true,
      });
      await fs.copyFile(
        path.join(project, 'pyproject.toml'),
        path.join(verify, 'pyproject.toml'),
      );
      const required = [
        'tests/unit/test_config.py::test_explicit_configuration_and_redacted_repr',
        'tests/unit/test_config.py::test_environment_only_read_when_called',
        ...[
          'http://example.invalid',
          'https://user:pass@example.invalid',
          'https://example.invalid?x=value',
          'https://example.invalid#fragment',
          'https://example.invalid:bad',
        ].map(
          (url) =>
            'tests/unit/test_config.py::test_invalid_endpoint_without_value_exposure[' +
            url +
            ']',
        ),
        'tests/unit/test_config.py::test_explicit_empty_config_has_no_environment_fallback',
      ].sort();
      const collected = run(
        python,
        [
          '-I',
          '-m',
          'pytest',
          '--collect-only',
          '-q',
          '-p',
          'no:cacheprovider',
        ],
        verify,
      );
      requireSuccess(collected);
      assert.deepEqual(
        collected.stdout
          .split(/\r?\n/)
          .filter((line) => line.includes('::'))
          .sort(),
        required,
      );
      assert.doesNotMatch(collected.stdout, /evals|test_agent_evaluation/);
      const units = run(
        python,
        ['-I', '-m', 'pytest', '-v', '-p', 'no:cacheprovider'],
        verify,
      );
      requireSuccess(units);
      assert.deepEqual(
        units.stdout
          .split(/\r?\n/)
          .filter((line) => line.includes('::') && / PASSED(?: |$)/.test(line))
          .map((line) => line.slice(0, line.indexOf(' PASSED')))
          .sort(),
        required,
      );
      const evalArgs = [
        '-I',
        '-m',
        'pytest',
        'evals',
        '-m',
        'integration',
        '-q',
        '-rs',
        '-p',
        'no:cacheprovider',
      ];
      const skipped = run(python, evalArgs, verify);
      requireSuccess(skipped);
      assert.match(skipped.stdout, /1 skipped/);
      assert.match(skipped.stdout, /Evaluation is opt-in/);
      const opted = run(python, evalArgs, verify, { AGENT_RUN_EVALS: '1' });
      assert.equal(opted.status, 1, detail(opted));
      assert.match(opted.stdout, /NOT integrated/);
      sub.diagnostic(
        inspected.stdout.trim() +
          '\n' +
          imported.stdout.trim() +
          '\n8 named installed configuration cases passed; eval skip and deliberate opt-in failure verified. Runtime dependencies NOT installed; backend/SDK/DeepEval/rights/live NOT RUN.',
      );
    });
});
