const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const source = readFileSync(
  require.resolve('../src/llmAccessWizard.ts'),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const userId = '11111111-1111-1111-1111-111111111111';
const appId = '22222222-2222-2222-2222-222222222222';
const accessKey = 'SCWABCDEFGHIJKLMNOPQ';
const secretKey = '33333333-3333-3333-3333-333333333333';
const durations = [3600000, 7 * 86400000, 30 * 86400000, 365 * 86400000];

function setup(options = {}) {
  let step = 0;
  let live = !options.initialStale;
  const calls = [];
  const finish = (kind, data, value) => {
    step++;
    calls.push({ kind, ...data });
    if (step === options.staleAt) live = false;
    if (step === options.rejectAt) throw new Error('provider failure');
    return step === options.abortAt ? undefined : value;
  };
  let inputIndex = 0;
  const window = {
    showQuickPick: async (items, config) => {
      let index = 0;
      if (items[0].type === 'reuse') index = options.mode ?? 2;
      else if (items[0].type === 'user') index = options.application ? 1 : 0;
      else if ('lifetimeMs' in items[0]) index = options.lifetime ?? 0;
      return finish(
        'pick',
        { items, config },
        options.forgePick ? { ...items[index] } : items[index],
      );
    },
    showInputBox: async (config) => {
      const index = inputIndex++;
      const value =
        options.inputs?.[index] ??
        ((options.mode ?? 2) === 1
          ? index === 0
            ? accessKey
            : secretKey
          : config.value);
      return finish('input', { config }, value);
    },
    showWarningMessage: async (message, config, action) =>
      finish('consent', { message, config, action }, options.consent ?? action),
  };
  // Only native UI is available. Any command, SDK, transport, storage or unexpected
  // VS Code capability access fails, including runtime imports of the IAM module.
  const vscode = new Proxy(
    {
      window: new Proxy(window, {
        get(target, key) {
          assert.ok(key in target, `Unexpected UI capability: ${String(key)}`);
          return target[key];
        },
      }),
    },
    {
      get(target, key) {
        assert.ok(
          key in target,
          `Unexpected VS Code capability: ${String(key)}`,
        );
        return target[key];
      },
    },
  );
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require(name) {
      assert.equal(name, 'vscode');
      return vscode;
    },
  });
  const context = {
    modelId: options.modelId ?? 'test-model',
    userId: options.userId ?? userId,
    projectName: 'Test project',
    current: () => live,
    applications: async () =>
      finish(
        'applications',
        {},
        options.apps ?? [{ id: appId, name: 'Existing app' }],
      ),
  };
  return {
    run: () => exports.chooseAccessPlan(context),
    calls,
    step: () => step,
  };
}
const plain = (value) =>
  value === undefined ? undefined : JSON.parse(JSON.stringify(value));

test('reuse returns only a plan; import accepts user/application credentials without metadata assumptions', async () => {
  const reuse = setup({ mode: 0 });
  assert.deepEqual(plain(await reuse.run()), { type: 'reuse' });
  assert.equal(reuse.calls.length, 1);
  assert.deepEqual(
    Array.from(reuse.calls[0].items, (item) => item.label),
    [
      'Réutiliser la clé de connexion',
      'Importer une clé existante',
      'Générer une clé API',
    ],
  );
  const imported = setup({ mode: 1 });
  assert.deepEqual(plain(await imported.run()), {
    type: 'import',
    accessKey,
    secretKey,
  });
  for (const call of imported.calls.filter((call) => call.kind === 'input')) {
    assert.equal(call.config.password, true);
    assert.equal(call.config.value, undefined);
    assert.ok(!JSON.stringify(call.config).includes(secretKey));
    assert.ok(!JSON.stringify(call.config).includes(accessKey));
  }
  assert.equal(
    imported.calls.some((call) => call.kind === 'applications'),
    false,
  );
});

test('each fixed expiration and both IAM bearer paths require explicit modal consent', async () => {
  for (const application of [false, true]) {
    for (let lifetime = 0; lifetime < durations.length; lifetime++) {
      const s = setup({ application, lifetime });
      assert.deepEqual(plain(await s.run()), {
        type: 'create',
        bearer: {
          type: application ? 'application' : 'user',
          id: application ? appId : userId,
        },
        description: 'Accès LLM test-model',
        lifetimeMs: durations[lifetime],
      });
      assert.equal(
        s.calls.filter((call) => call.kind === 'applications').length,
        application ? 1 : 0,
      );
      const expiry = s.calls.find(
        (call) => call.kind === 'pick' && 'lifetimeMs' in call.items[0],
      );
      assert.deepEqual(
        Array.from(expiry.items, (item) => item.lifetimeMs),
        durations,
      );
      const consent = s.calls.at(-1);
      assert.equal(consent.kind, 'consent');
      assert.equal(consent.config.modal, true);
      assert.equal(consent.action, 'Générer la clé API');
      assert.match(
        consent.config.detail,
        application ? /Application IAM : Existing app/ : /Moi-même IAM/,
      );
      assert.ok(consent.config.detail.includes(expiry.items[lifetime].label));
      for (const pattern of [
        /politiques IAM de l’organisation/,
        /pas limitées à ce modèle/,
        /SecretStorage/,
        /Aucune inférence/,
        /Aucune application ni politique IAM/,
        /déconnexion locale ne révoque pas/,
      ]) {
        assert.match(consent.config.detail, pattern);
      }
    }
  }
});

test('abort, stale state and rejected awaits stop every UI/callback path immediately', async () => {
  for (const path of [
    { mode: 0, count: 1 },
    { mode: 1, count: 3 },
    { mode: 2, count: 5 },
    { mode: 2, application: true, count: 7 },
  ]) {
    const initial = setup({ ...path, initialStale: true });
    assert.equal(await initial.run(), undefined);
    assert.equal(initial.step(), 0);
    for (const kind of ['abortAt', 'staleAt', 'rejectAt']) {
      for (let at = 1; at <= path.count; at++) {
        const s = setup({ ...path, [kind]: at });
        assert.equal(await s.run(), undefined, `${kind} step ${at}`);
        assert.equal(
          s.step(),
          at,
          'No prompt/callback after cancellation or staleness',
        );
      }
    }
  }
});

test('password input validation and post-input validation never accept malformed credentials', async () => {
  for (const invalid of [
    '',
    'SCWshort',
    accessKey.toLowerCase(),
    `${accessKey}X`,
    `${accessKey}\n`,
    ` ${accessKey}`,
  ]) {
    const s = setup({ mode: 1, inputs: [invalid] });
    assert.equal(await s.run(), undefined);
    assert.equal(s.step(), 2);
    const validate = s.calls[1].config.validateInput;
    assert.equal(validate(accessKey), undefined);
    assert.equal(typeof validate(invalid), 'string');
  }
  for (const invalid of ['', 'not-a-uuid', `${secretKey}\n`, ` ${secretKey}`]) {
    const s = setup({ mode: 1, inputs: [accessKey, invalid] });
    assert.equal(await s.run(), undefined);
    assert.equal(s.step(), 3);
    const validate = s.calls[2].config.validateInput;
    assert.equal(validate(secretKey), undefined);
    assert.equal(typeof validate(invalid), 'string');
  }
});

test('optional description is bounded and control characters are refused', async () => {
  for (const value of ['', ' ', 'x'.repeat(200), 'custom']) {
    const s = setup({ inputs: [value] });
    const plan = await s.run();
    assert.equal(
      plan.description,
      value.trim() ? value : 'Accès LLM test-model',
    );
  }
  for (const value of [
    'x'.repeat(201),
    'bad\ntext',
    'bad\u007ftext',
    'bad\u009ftext',
  ]) {
    const s = setup({ inputs: [value] });
    assert.equal(await s.run(), undefined);
    assert.equal(s.step(), 3);
    assert.equal(typeof s.calls.at(-1).config.validateInput(value), 'string');
  }
  const s = setup({ modelId: `a\n${'x'.repeat(500)}` });
  const plan = await s.run();
  assert.equal(plan.description.length, 200);
  assert.ok(!plan.description.includes('\n'));
});

test('missing/invalid IAM applications, user IDs and forged picks cannot return plans', async () => {
  for (const apps of [
    [],
    [{ id: 'invalid', name: 'app' }],
    [{ id: appId, name: 'bad\nname' }],
    [{ id: appId, name: '' }],
    [{ id: appId, name: 'x'.repeat(201) }],
  ]) {
    const s = setup({ application: true, apps });
    assert.equal(await s.run(), undefined);
    assert.equal(s.step(), 3);
  }
  assert.equal(await setup({ userId: 'invalid' }).run(), undefined);
  assert.equal(await setup({ forgePick: true }).run(), undefined);
});

test('cancel/default dismissal or any non-confirming consent never authorizes generation', async () => {
  for (const consent of ['Annuler', '', 'Other', 'Générer']) {
    const s = setup({ consent });
    assert.equal(await s.run(), undefined);
    assert.equal(s.step(), 5);
  }
});
