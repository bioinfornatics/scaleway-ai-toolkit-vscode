const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { transformSync } = require('esbuild');
function load(name) {
  const filename = path.join(__dirname, '../src', `${name}.ts`);
  const mod = new Module(filename);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod.require = (r) =>
    r.startsWith('./')
      ? load(r.slice(2))
      : Module.prototype.require.call(mod, r);
  mod._compile(
    transformSync(fs.readFileSync(filename, 'utf8'), {
      loader: 'ts',
      format: 'cjs',
      target: 'node22',
    }).code,
    filename,
  );
  return mod.exports;
}
const { composeAgentProject, deployedAgentModels } = load('agentProject');
const { stackChoices } = load('stackScaffold');
const choices = stackChoices('agents');
function configuredAccess(projectId, bearerType = 'user') {
  return {
    id: (bearerType === 'application' ? 'd' : 'c').repeat(32),
    projectId,
    bearerType,
    expiresAt: Date.now() + 3600000,
    verifiedAt: new Date().toISOString(),
  };
}
for (const backend of choices.filter((c) => c.category === 'backend')) {
  for (const ai of choices.filter(
    (c) => c.category === 'agent' && c.language === backend.language,
  )) {
    test(`${backend.framework} + ${ai.framework} combines exact assets and dependencies`, () => {
      const result = composeAgentProject(backend, ai, 'my-agent');
      const files = result.files;
      const original =
        backend.language === 'python' ? 'src/agent_app/api.py' : 'src/agent.ts';
      const sdk =
        backend.language === 'python'
          ? 'src/agent_app/agent.py'
          : 'src/agent-sdk.ts';
      assert.equal(files[original], backend.template.files[original]);
      assert.equal(
        files[sdk],
        ai.template.files[backend.language === 'python' ? sdk : original],
      );
      for (const [p, content] of Object.entries(ai.template.files)) {
        if (
          [
            'README.md',
            'requirements.txt',
            'package.json',
            'agent.authoring.json',
            original,
          ].includes(p)
        )
          continue;
        assert.equal(files[p], content);
      }
      if (files['requirements.txt']) {
        for (const line of ai.template.files['requirements.txt'].split('\n'))
          assert.ok(files['requirements.txt'].includes(line));
      } else {
        const combined = JSON.parse(files['package.json']);
        for (const base of [backend, ai])
          for (const [k, v] of Object.entries(
            JSON.parse(base.template.files['package.json']).dependencies,
          ))
            assert.equal(combined.dependencies[k], v);
      }
      const note = JSON.parse(files['agent.authoring.json']);
      assert.equal(note.backend, backend.framework);
      assert.equal(note.ai_framework, ai.framework);
      assert.equal(note.incomplete, true);
      assert.equal(files['agent.json'], undefined);
    });
  }
}
test('Rust backend supported, incompatible SDK/category and file collisions refused', () => {
  const rust = choices.find((c) => c.framework === 'axum');
  const ai = choices.find((c) => c.framework === 'strands');
  assert.ok(
    composeAgentProject(rust, undefined, 'rust-agent').files['Cargo.toml'],
  );
  assert.throws(() => composeAgentProject(rust, ai, 'bad'));
  assert.throws(() => composeAgentProject(ai, undefined, 'bad'));
  const backend = choices.find((c) => c.framework === 'fastapi');
  const conflict = {
    ...ai,
    template: {
      ...ai.template,
      files: { ...ai.template.files, 'src/agent_app/config.py': 'conflict' },
    },
  };
  assert.throws(() => composeAgentProject(backend, conflict, 'bad'));
});
test('resource membership includes Serverless independently of dedicated discovery state', () => {
  const good = {
    id: 'deployment',
    label: 'Model',
    kind: 'dedicated',
    status: 'ready',
    deploymentInfo: { projectId: 'p', region: 'fr-par', modelId: 'm' },
  };
  const context = {
    key: 'scope',
    projectId: 'p',
    status: 'fr-par · projet sélectionné',
    rows: [
      good,
      {
        id: 'deepseek-v4.1-flash',
        label: 'deepseek-v4.1-flash',
        kind: 'serverless',
        serverlessAvailability: 'Disponible',
        llmAccess: configuredAccess('p'),
      },
      { ...good, kind: 'dedicated-catalog' },
      {
        ...good,
        deploymentInfo: { ...good.deploymentInfo, projectId: 'other' },
      },
      { ...good, status: 'deleting' },
    ],
  };
  assert.deepEqual(deployedAgentModels(context), [good, context.rows[1]]);
  for (const status of ['Non chargés', 'Chargement…', 'Erreur · non vérifié'])
    assert.deepEqual(deployedAgentModels({ ...context, status }), [
      context.rows[1],
    ]);
  assert.deepEqual(
    deployedAgentModels({ ...context, projectId: undefined }),
    [],
  );
  const base = choices.find((c) => c.framework === 'fastapi');
  const files = composeAgentProject(base, undefined, 'agent', good).files;
  const note = JSON.parse(files['agent.authoring.json']);
  assert.equal(note.selected_deployment.model_id, 'm');
  assert.equal(note.selected_deployment.deployment_id, 'deployment');
  assert.equal(note.model, undefined);
  assert.equal(note.revision, undefined);
});

test('Serverless authoring saves model identity without inventing deployment or endpoint authority', () => {
  const model = {
    id: 'deepseek-v4.1-flash',
    label: 'DeepSeek',
    kind: 'serverless',
    serverlessAvailability: 'Disponible',
    llmAccess: configuredAccess('p', 'application'),
  };
  const base = choices.find((c) => c.framework === 'fastapi');
  const files = composeAgentProject(
    base,
    undefined,
    'my-agent',
    model,
    undefined,
    'p',
  ).files;
  const note = JSON.parse(files['agent.authoring.json']);
  assert.deepEqual(note.selected_model, {
    kind: 'serverless',
    model_id: 'deepseek-v4.1-flash',
    project_id: 'p',
    availability: 'Disponible',
  });
  assert.equal(note.selected_deployment, undefined);
  assert.equal(files['agent.json'], undefined);
  const context = {
    key: 'scope',
    projectId: 'p',
    status: 'Erreur · non vérifié',
    rows: [model],
  };
  assert.deepEqual(deployedAgentModels(context), [model]);
  assert.deepEqual(
    deployedAgentModels({
      ...context,
      rows: [{ ...model, serverlessAvailability: 'Absent de la liste' }],
    }),
    [],
  );
});

test('model label uses model identity, not deployment name or endpoint', () => {
  const { agentModelLabel } = load('agentProject');
  assert.equal(
    agentModelLabel({
      kind: 'serverless',
      id: 'deepseek-v4.1-flash',
      label: 'https://endpoint.invalid',
      serverlessAvailability: 'Disponible',
      llmAccess: configuredAccess('p'),
    }),
    'deepseek-v4.1-flash · Serverless · Utilisateur IAM · accès configuré',
  );
  assert.equal(
    agentModelLabel({
      kind: 'dedicated',
      id: 'deployment',
      label: 'https://endpoint.invalid',
      deploymentInfo: { modelId: 'model-id', modelName: 'DeepSeek' },
    }),
    'DeepSeek · Dédié',
  );
  assert.equal(
    agentModelLabel({
      kind: 'dedicated',
      id: 'deployment',
      label: 'service-name',
      deploymentInfo: { modelId: 'model-id' },
    }),
    'model-id · Dédié',
  );
});

test('Serverless membership requires configured unexpired access in the selected project and Disponible', () => {
  const model = {
    id: 'configured-model',
    label: 'Model',
    kind: 'serverless',
    serverlessAvailability: 'Disponible',
    llmAccess: configuredAccess('p'),
  };
  const application = {
    ...model,
    id: 'application-model',
    llmAccess: configuredAccess('p', 'application'),
  };
  const context = {
    key: 'scope',
    projectId: 'p',
    status: 'Erreur · non vérifié',
    rows: [model, application],
  };
  assert.deepEqual(deployedAgentModels(context), [model, application]);
  for (const invalid of [
    { ...model, llmAccess: undefined },
    { ...model, llmAccess: { ...model.llmAccess, expiresAt: Date.now() - 1 } },
    {
      ...model,
      llmAccess: { ...model.llmAccess, expiresAt: Date.now() + 10000 },
    },
    { ...model, llmAccess: { ...model.llmAccess, projectId: 'other' } },
    { ...model, serverlessAvailability: undefined },
    { ...model, serverlessAvailability: 'Absent de la liste' },
  ])
    assert.deepEqual(deployedAgentModels({ ...context, rows: [invalid] }), []);
  assert.deepEqual(deployedAgentModels({ ...context, key: '' }), []);
  assert.deepEqual(
    deployedAgentModels({ ...context, projectId: undefined }),
    [],
  );
  const { agentModelLabel } = load('agentProject');
  assert.equal(
    agentModelLabel(application),
    'application-model · Serverless · Application IAM · accès configuré',
  );
});

test('host-owned composition emits an unready launch file while personal launch declaration stays unchanged', () => {
  const generator = require('../dist/projectGenerator');
  const base = {
    version: 1,
    id: 'launch-test',
    label: 'Launch',
    kind: 'agents',
    description: 'Test',
    files: { 'agent.py': 'print(1)' },
  };
  const prepared = generator.withEmbeddedAgentLaunch(base);
  const launch = JSON.parse(prepared.files['.vscode/scaleway-agent-run.json']);
  assert.deepEqual(launch, {
    version: 1,
    ready: false,
    runtime: 'python',
    entry: 'agent.py',
    args: [],
  });
  const declared = JSON.stringify({
    ...launch,
    ready: true,
    args: ['--custom'],
  });
  assert.equal(
    generator.withEmbeddedAgentLaunch({
      ...base,
      files: { ...base.files, '.vscode/scaleway-agent-run.json': declared },
    }).files['.vscode/scaleway-agent-run.json'],
    declared,
  );
  assert.equal(
    generator
      .withEmbeddedAgentLaunch({
        ...base,
        files: { 'src/agent.ts': 'export {}' },
      })
      .files['.vscode/scaleway-agent-run.json'].includes('dist/agent.js'),
    true,
  );
});
