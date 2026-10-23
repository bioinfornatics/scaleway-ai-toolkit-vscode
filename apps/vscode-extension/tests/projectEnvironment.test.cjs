const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  projectTarget,
  protectProjectEnvironment,
  privateEnvContent,
} = require('../dist/projectEnvironment');
const { materializeTemplate } = require('../dist/agentScaffold');
const projectId = '22222222-2222-2222-2222-222222222222';
const fakeKey = '33333333-3333-3333-3333-333333333333';
function template() {
  return {
    version: 1,
    id: 'base',
    label: 'Base',
    kind: 'agents',
    description: 'Base',
    files: { 'agent.py': '# authoring', '.gitignore': '!.env' },
  };
}
test('Serverless target uses existing project API route; no secret in public template', () => {
  const target = projectTarget(
    { kind: 'serverless', id: 'deepseek-v4.1-flash', label: 'DeepSeek' },
    projectId,
  );
  assert.equal(target.endpoint, `https://api.scaleway.ai/${projectId}/v1`);
  const publicTemplate = protectProjectEnvironment(template());
  assert.match(publicTemplate.files['.gitignore'], /\n\/.env\n$/);
  assert.equal(publicTemplate.files['.env'], undefined);
  const text = privateEnvContent(target, fakeKey);
  assert.ok(
    text.includes(
      `SCW_API_KEY=${String.fromCharCode(39)}${fakeKey}${String.fromCharCode(39)}`,
    ),
  );
  assert.ok(text.includes('deepseek-v4.1-flash'));
  for (const key of ['JWT.token.value', 'bad\nINJECT=x'])
    assert.throws(() => privateEnvContent(target, key));
  assert.throws(() =>
    privateEnvContent({ ...target, modelId: 'bad\nINJECT=x' }, fakeKey),
  );
});
test('Dedicated endpoint requires same project and single public IAM endpoint', () => {
  const model = {
    kind: 'dedicated',
    id: 'd',
    label: 'D',
    deploymentInfo: {
      projectId,
      modelId: 'm',
      endpoints: [
        {
          url: 'https://example.invalid/v1',
          network: 'public',
          authentication: 'iam',
        },
      ],
    },
  };
  assert.equal(
    projectTarget(model, projectId).endpoint,
    'https://example.invalid/v1',
  );
  assert.throws(() =>
    projectTarget(model, '44444444-4444-4444-4444-444444444444'),
  );
  assert.throws(() =>
    projectTarget(
      { ...model, deploymentInfo: { ...model.deploymentInfo, endpoints: [] } },
      projectId,
    ),
  );
  assert.throws(() =>
    projectTarget(
      {
        ...model,
        deploymentInfo: {
          ...model.deploymentInfo,
          endpoints: [
            ...model.deploymentInfo.endpoints,
            ...model.deploymentInfo.endpoints,
          ],
        },
      },
      projectId,
    ),
  );
});
test('private env descriptor write is exclusive0600; public template stays secret-free', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scw-private-env-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const publicTemplate = protectProjectEnvironment(template());
  let reads = 0;
  const target = projectTarget(
    { kind: 'serverless', id: 'model', label: 'Model' },
    projectId,
  );
  const output = await materializeTemplate(root, 'agent', publicTemplate, {
    current: () => true,
    content: () => {
      reads++;
      return privateEnvContent(target, fakeKey);
    },
  });
  assert.equal(reads, 1);
  assert.equal((await fs.stat(path.join(output, '.env'))).mode & 0o777, 0o600);
  assert.ok(
    (await fs.readFile(path.join(output, '.env'), 'utf8')).includes(fakeKey),
  );
  assert.ok(!JSON.stringify(publicTemplate).includes(fakeKey));
  await assert.rejects(
    materializeTemplate(root, 'agent', publicTemplate, {
      current: () => true,
      content: () => {
        reads++;
        return fakeKey;
      },
    }),
  );
  assert.equal(reads, 1);
  await assert.rejects(
    materializeTemplate(root, 'stale', publicTemplate, {
      current: () => false,
      content: () => {
        reads++;
        return fakeKey;
      },
    }),
  );
  assert.equal(reads, 1);
});
test('template env collision cannot be overwritten or reused', async (t) => {
  const input = template();
  input.files['.env'] = 'PLACEHOLDER';
  assert.throws(() => protectProjectEnvironment(input));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scw-env-conflict-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await assert.rejects(
    materializeTemplate(root, 'agent', input, {
      current: () => true,
      content: () => fakeKey,
    }),
  );
  assert.deepEqual(await fs.readdir(root), []);
});
