const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const Module = require('node:module');
const ts = require('typescript');
// Compile only the owned source and its library dependency in memory. No dist
// overwrites, build scripts, Python/runtime/install/network or workspace hooks.
function source(name, fsOverride) {
  const filename = path.resolve(__dirname, '../src', `${name}.ts`);
  const module = new Module(filename);
  module.filename = filename;
  module.paths = Module._nodeModulePaths(path.dirname(filename));
  module.require = function (request) {
    if (request === './templateLibrary') return source('templateLibrary');
    if (request === './embeddedTemplates') return source('embeddedTemplates');
    if (request === 'node:fs/promises' && fsOverride) return fsOverride;
    return Module.prototype.require.call(this, request);
  };
  const code = ts.transpileModule(
    require('node:fs').readFileSync(filename, 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  module._compile(code, filename);
  return module.exports;
}
const { builtinTemplates, materializeTemplate } = source('agentScaffold');
const linux = { skip: process.platform !== 'linux' };
function definition(files = { 'nested/readme.txt': 'safe' }) {
  return {
    version: 1,
    id: 'fixture',
    label: 'Fixture',
    kind: 'agents',
    description: '',
    files,
  };
}
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scw-agent-scaffold-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
test('builtins are editable library-v1 definitions; verified pins and no execution entry points', () => {
  const profile = require('../../../specifications/references/compatibility/runtime-contract-profile-v1.json');
  const a = builtinTemplates('agents');
  assert.equal(a.length, 1);
  assert.equal(a[0].version, 1);
  assert.equal(a[0].kind, 'agents');
  assert.match(
    a[0].files['requirements.txt'],
    new RegExp(
      `strands-agents\\[openai\\]==${profile.packages['strands-agents']}`,
    ),
  );
  const agent = a[0].files['src/agent_app/agent.py'];
  const config = a[0].files['src/agent_app/config.py'];
  for (const name of [
    'SCW_INFERENCE_BASE_URL',
    'SCW_INFERENCE_MODEL_ID',
    'SCW_API_KEY',
  ])
    assert.ok(config.includes(name));
  assert.match(config, /def load_config/);
  assert.match(config, /repr=False/);
  assert.match(agent, /from \.config import load_project_config/);
  assert.match(agent, /load_project_config\(\)/);
  assert.match(agent, /OpenAIModel/);
  assert.doesNotMatch(agent, /raise RuntimeError/);
  assert.doesNotMatch(agent, /structured_output|Bedrock|os.getenv|subprocess/);
  a[0].files['README.md'] = 'local edit';
  assert.notEqual(
    builtinTemplates('agents')[0].files['README.md'],
    'local edit',
  );
  assert.deepEqual(
    builtinTemplates('tools').map((t) => t.id),
    ['python-tool', 'python-mcp-tool'],
  );
  assert.doesNotMatch(
    builtinTemplates('tools')[1].files['server.py'],
    /mcp\.run\(/,
  );
  assert.throws(() => builtinTemplates('other'), {
    message: 'invalid_template_kind',
  });
});

test(
  'actual files, private modes, external secrets not serialized; rerun preserves edits',
  linux,
  async (t) => {
    const dir = await fixture(t);
    const previous = process.env.SCW_API_KEY;
    process.env.SCW_API_KEY = 'synthetic-external-only-value';
    try {
      const template = builtinTemplates('agents')[0];
      const result = await materializeTemplate(dir, 'my-project', template);
      assert.equal(result, path.join(dir, 'my-project'));
      for (const [name, content] of Object.entries(template.files)) {
        const actual = await fs.readFile(path.join(result, name), 'utf8');
        assert.equal(actual, content);
        assert(!actual.includes(process.env.SCW_API_KEY));
        assert.equal(
          (await fs.stat(path.join(result, name))).mode & 0o777,
          0o600,
        );
      }
      assert.equal((await fs.stat(result)).mode & 0o777, 0o700);
      await fs.writeFile(path.join(result, 'agent.py'), 'manual edit');
      await assert.rejects(materializeTemplate(dir, 'my-project', template), {
        message: 'template_materialize_failed',
      });
      assert.equal(
        await fs.readFile(path.join(result, 'agent.py'), 'utf8'),
        'manual edit',
      );
      const race = await Promise.allSettled([
        materializeTemplate(dir, 'raced', definition()),
        materializeTemplate(dir, 'raced', definition()),
      ]);
      assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1);
    } finally {
      if (previous === undefined) delete process.env.SCW_API_KEY;
      else process.env.SCW_API_KEY = previous;
    }
  },
);

test(
  'malicious templates/version/paths/limits rejected before creating project',
  linux,
  async (t) => {
    const dir = await fixture(t);
    for (const files of [
      { '../escape': '' },
      { '/absolute': '' },
      { 'a\\b': '' },
      { 'a/../b': '' },
      { 'a//b': '' },
      { a: '', 'A/b': '' },
      { '.env': 'API_KEY=secret' },
      { a: 'x'.repeat(256 * 1024) },
      { a: 'password=synthetic-not-a-key' },
      { [`${'nested/'.repeat(16)}file`]: '' },
      { CON: '' },
    ]) {
      await assert.rejects(materializeTemplate(dir, 'bad', definition(files)));
      assert.deepEqual(await fs.readdir(dir), []);
    }
    await assert.rejects(
      materializeTemplate(dir, 'bad', { ...definition(), version: 2 }),
      { message: 'invalid_template' },
    );
    for (const name of [
      '../outside',
      '/absolute',
      'a/b',
      '.',
      'CON',
      'a\\b',
      'a\0b',
    ])
      await assert.rejects(materializeTemplate(dir, name, definition()), {
        message: 'template_materialize_failed',
      });
    await assert.rejects(
      materializeTemplate(path.join(dir, 'missing'), 'bad', definition()),
    );
    await assert.rejects(
      materializeTemplate(
        `${dir}/../${path.basename(dir)}`,
        'bad',
        definition(),
      ),
    );
    assert.deepEqual(await fs.readdir(dir), []);
  },
);

test(
  'existing files, symlink parents/ancestors/destinations never followed or replaced',
  linux,
  async (t) => {
    const dir = await fixture(t);
    const outside = path.join(dir, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'keep'), 'untouched');
    await fs.symlink(outside, path.join(dir, 'alias'));
    await fs.symlink(outside, path.join(dir, 'destination'));
    await fs.writeFile(path.join(dir, 'existing-file'), 'keep');
    for (const [parent, name] of [
      [path.join(dir, 'alias'), 'new'],
      [path.join(dir, 'alias', 'child'), 'new'],
      [dir, 'destination'],
      [dir, 'existing-file'],
    ])
      await assert.rejects(materializeTemplate(parent, name, definition()), {
        message: 'template_materialize_failed',
      });
    assert.deepEqual(await fs.readdir(outside), ['keep']);
    assert.equal(
      await fs.readFile(path.join(outside, 'keep'), 'utf8'),
      'untouched',
    );
    assert.equal(
      await fs.readFile(path.join(dir, 'existing-file'), 'utf8'),
      'keep',
    );
  },
);

test(
  'descriptor anchored nested-directory rename race cannot write to replacement symlink',
  linux,
  async (t) => {
    const dir = await fixture(t);
    const outside = path.join(dir, 'outside');
    await fs.mkdir(outside);
    const nested = path.join(dir, 'project', 'nested');
    const moved = path.join(dir, 'project', 'moved');
    let swapped = false;
    const custom = source('agentScaffold', {
      ...fs,
      async open(target, ...args) {
        const handle = await fs.open(target, ...args);
        if (!swapped && target.endsWith('/nested')) {
          swapped = true;
          await fs.rename(nested, moved);
          await fs.symlink(outside, nested);
        }
        return handle;
      },
    });
    await assert.rejects(
      custom.materializeTemplate(dir, 'project', definition()),
      { message: 'template_materialize_failed' },
    );
    assert(swapped);
    assert.deepEqual(await fs.readdir(outside), []);
    assert.deepEqual(await fs.readdir(moved), []);
  },
);

test(
  'new nested symlink injected before opening directory fails closed',
  linux,
  async (t) => {
    const dir = await fixture(t);
    const outside = path.join(dir, 'outside');
    await fs.mkdir(outside);
    let injected = false;
    const custom = source('agentScaffold', {
      ...fs,
      async mkdir(target, ...args) {
        const result = await fs.mkdir(target, ...args);
        if (!injected && target.endsWith('/nested')) {
          injected = true;
          await fs.rename(
            path.join(dir, 'project', 'nested'),
            path.join(dir, 'project', 'moved'),
          );
          await fs.symlink(outside, path.join(dir, 'project', 'nested'));
        }
        return result;
      },
    });
    await assert.rejects(
      custom.materializeTemplate(dir, 'project', definition()),
      { message: 'template_materialize_failed' },
    );
    assert(injected);
    assert.deepEqual(await fs.readdir(outside), []);
  },
);

test(
  'parent rename race remains anchored to opened parent, not replacement symlink',
  linux,
  async (t) => {
    const dir = await fixture(t);
    const parent = path.join(dir, 'parent');
    await fs.mkdir(parent);
    const moved = path.join(dir, 'moved');
    const outside = path.join(dir, 'outside');
    await fs.mkdir(outside);
    let swapped = false;
    const custom = source('agentScaffold', {
      ...fs,
      async open(target, ...args) {
        const handle = await fs.open(target, ...args);
        if (!swapped && target.endsWith('/parent')) {
          swapped = true;
          await fs.rename(parent, moved);
          await fs.symlink(outside, parent);
        }
        return handle;
      },
    });
    await custom.materializeTemplate(parent, 'project', definition());
    assert(swapped);
    assert.deepEqual(await fs.readdir(outside), []);
    assert.equal(
      await fs.readFile(
        path.join(moved, 'project', 'nested', 'readme.txt'),
        'utf8',
      ),
      'safe',
    );
  },
);

test(
  'partial write failures leave only owned new project for review, never overwrite existing files',
  linux,
  async (t) => {
    const dir = await fixture(t);
    let failed = false;
    const custom = source('agentScaffold', {
      ...fs,
      async open(target, ...args) {
        if (target.endsWith('/blocked.txt')) {
          failed = true;
          throw new Error('synthetic failure');
        }
        return fs.open(target, ...args);
      },
    });
    await assert.rejects(
      custom.materializeTemplate(
        dir,
        'project',
        definition({ 'a.txt': 'first', 'blocked.txt': 'second' }),
      ),
      { message: 'template_materialize_failed' },
    );
    assert(failed);
    assert.equal(
      await fs.readFile(path.join(dir, 'project', 'a.txt'), 'utf8'),
      'first',
    );
    await assert.rejects(materializeTemplate(dir, 'project', definition()), {
      message: 'template_materialize_failed',
    });
    assert.deepEqual(await fs.readdir(path.join(dir, 'project')), ['a.txt']);
  },
);

test('active template materialization rejects credential literals before any write', async (t) => {
  const dir = await fixture(t);
  for (const token of [
    `ghp_${'x'.repeat(20)}`,
    `github_pat_${'x'.repeat(20)}`,
    `sk-${'x'.repeat(8)}`,
  ]) {
    for (const value of [
      definition({ 'input.txt': token }),
      { ...definition(), label: token },
      { ...definition(), description: token },
    ])
      await assert.rejects(materializeTemplate(dir, 'bad', value));
    assert.deepEqual(await fs.readdir(dir), []);
  }
  const reference = definition({ 'config.txt': 'API_KEY=$' + '{SCW_API_KEY}' });
  await materializeTemplate(dir, 'external', reference);
  assert.equal(
    await fs.readFile(path.join(dir, 'external/config.txt'), 'utf8'),
    reference.files['config.txt'],
  );
});

test(
  'real-directory substitution between lstat and open rejects before any content write',
  linux,
  async (t) => {
    for (const component of ['project', 'nested']) {
      const dir = await fixture(t);
      const outside = path.join(dir, 'outside');
      await fs.mkdir(outside, { mode: 0o700 });
      await fs.writeFile(path.join(outside, 'keep'), 'untouched');
      let injected = false;
      let writes = 0;
      const custom = source('agentScaffold', {
        ...fs,
        async open(target, ...args) {
          if (!injected && target.endsWith(`/${component}`)) {
            injected = true;
            await fs.rename(target, path.join(dir, 'moved'));
            await fs.rename(outside, target);
          }
          if (args[0] & require('node:fs').constants.O_WRONLY) writes++;
          return fs.open(target, ...args);
        },
      });
      await assert.rejects(
        custom.materializeTemplate(dir, 'project', definition()),
        { message: 'template_materialize_failed' },
      );
      assert(injected);
      assert.equal(writes, 0);
      const inserted =
        component === 'project'
          ? path.join(dir, 'project')
          : path.join(dir, 'project', 'nested');
      assert.deepEqual(await fs.readdir(inserted), ['keep']);
      assert.equal(
        await fs.readFile(path.join(inserted, 'keep'), 'utf8'),
        'untouched',
      );
      assert.deepEqual(await fs.readdir(path.join(dir, 'moved')), []);
    }
  },
);

test(
  'mkdir EEXIST from attacker inserted nested directory is never adopted',
  linux,
  async (t) => {
    const dir = await fixture(t);
    let injected = false;
    const custom = source('agentScaffold', {
      ...fs,
      async mkdir(target, ...args) {
        if (!injected && target.endsWith('/nested')) {
          injected = true;
          await fs.mkdir(target, { mode: 0o700 });
          await fs.writeFile(path.join(target, 'keep'), 'untouched');
        }
        return fs.mkdir(target, ...args);
      },
    });
    await assert.rejects(
      custom.materializeTemplate(dir, 'project', definition()),
      { message: 'template_materialize_failed' },
    );
    assert(injected);
    assert.deepEqual(await fs.readdir(path.join(dir, 'project', 'nested')), [
      'keep',
    ]);
  },
);

test(
  'directory replaced after mkdir by non-private real directory is rejected before writing',
  linux,
  async (t) => {
    const dir = await fixture(t);
    let injected = false;
    const custom = source('agentScaffold', {
      ...fs,
      async mkdir(target, ...args) {
        const result = await fs.mkdir(target, ...args);
        if (!injected && target.endsWith('/project')) {
          injected = true;
          await fs.rename(target, path.join(dir, 'moved'));
          await fs.mkdir(target, { mode: 0o755 });
        }
        return result;
      },
    });
    await assert.rejects(
      custom.materializeTemplate(dir, 'project', definition()),
      { message: 'template_materialize_failed' },
    );
    assert(injected);
    assert.deepEqual(await fs.readdir(path.join(dir, 'project')), []);
  },
);

for (const invalidator of ['public', 'private']) {
  test(
    invalidator + ': invalid context before any I/O creates no root',
    linux,
    async (t) => {
      const dir = await fixture(t);
      let io = 0,
        secrets = 0;
      const custom = source('agentScaffold', {
        ...fs,
        async open(...args) {
          io++;
          return fs.open(...args);
        },
        async mkdir(...args) {
          io++;
          return fs.mkdir(...args);
        },
      });
      await assert.rejects(
        custom.materializeTemplate(
          dir,
          'project',
          definition(),
          {
            current: () => invalidator !== 'private',
            content() {
              secrets++;
              return 'SCW_API_KEY=synthetic';
            },
          },
          () => invalidator !== 'public',
        ),
        { message: 'template_materialize_failed' },
      );
      assert.equal(io, 0);
      assert.equal(secrets, 0);
      assert.deepEqual(await fs.readdir(dir), []);
    },
  );

  for (const phase of [
    'parent-open',
    'root-mkdir',
    'root-lstat',
    'root-open',
    'nested-mkdir',
    'tree-stat',
    'file-open',
    'file-write',
    'between-files',
  ]) {
    test(
      invalidator +
        ': paused ' +
        phase +
        ' stops future effects and preserves partial files',
      linux,
      async (t) => {
        const dir = await fixture(t);
        let valid = true,
          paused = false,
          release,
          reached,
          secrets = 0;
        const gate = new Promise((r) => {
          release = r;
        });
        const started = new Promise((r) => {
          reached = r;
        });
        const pause = async () => {
          if (!paused) {
            paused = true;
            reached();
            await gate;
          }
        };
        const custom = source('agentScaffold', {
          ...fs,
          async mkdir(target, ...args) {
            const result = await fs.mkdir(target, ...args);
            if (phase === 'root-mkdir' && target.endsWith('/project'))
              await pause();
            if (phase === 'nested-mkdir' && target.endsWith('/nested'))
              await pause();
            return result;
          },
          async lstat(target) {
            const result = await fs.lstat(target);
            if (phase === 'root-lstat' && target.endsWith('/project'))
              await pause();
            return result;
          },
          async open(target, ...args) {
            const handle = await fs.open(target, ...args);
            if (
              phase === 'parent-open' &&
              target.endsWith('/' + path.basename(dir))
            )
              await pause();
            if (phase === 'root-open' && target.endsWith('/project'))
              await pause();
            if (phase === 'tree-stat' && target.endsWith('/project')) {
              const stat = handle.stat.bind(handle);
              let calls = 0;
              handle.stat = async () => {
                const result = await stat();
                if (++calls === 2) await pause();
                return result;
              };
            }
            if (target.endsWith('/first.txt')) {
              if (phase === 'file-open') await pause();
              const write = handle.writeFile.bind(handle),
                sync = handle.sync.bind(handle);
              handle.writeFile = async (...values) => {
                const result = await write(...values);
                if (phase === 'file-write') await pause();
                return result;
              };
              handle.sync = async () => {
                const result = await sync();
                if (phase === 'between-files') await pause();
                return result;
              };
            }
            return handle;
          },
        });
        const filesToCreate = { 'first.txt': 'first', 'next.txt': 'next' };
        if (phase === 'nested-mkdir') filesToCreate['nested/last.txt'] = 'last';
        const pending = custom.materializeTemplate(
          dir,
          'project',
          definition(filesToCreate),
          {
            current: () => invalidator !== 'private' || valid,
            content() {
              secrets++;
              return 'SCW_API_KEY=synthetic';
            },
          },
          () => invalidator !== 'public' || valid,
        );
        const rejection = assert.rejects(pending, {
          message: 'template_materialize_failed',
        });
        await started;
        valid = false;
        release();
        await rejection;
        assert(paused);
        assert.equal(secrets, 0);
        const project = path.join(dir, 'project');
        if (phase === 'parent-open') {
          assert.deepEqual(await fs.readdir(dir), []);
          return;
        }
        const files = await fs.readdir(project);
        assert(!files.includes('next.txt'));
        assert(!files.includes('.env'));
        assert.equal((await fs.stat(project)).mode & 0o777, 0o700);
        if (['file-open', 'file-write', 'between-files'].includes(phase)) {
          assert.deepEqual(files, ['first.txt']);
          assert.equal(
            await fs.readFile(path.join(project, 'first.txt'), 'utf8'),
            phase === 'file-open' ? '' : 'first',
          );
          assert.equal(
            (await fs.stat(path.join(project, 'first.txt'))).mode & 0o777,
            0o600,
          );
        } else if (phase === 'nested-mkdir') {
          assert.deepEqual(files, ['nested']);
          assert.deepEqual(await fs.readdir(path.join(project, 'nested')), []);
        } else assert.deepEqual(files, []);
      },
    );
  }
}

test(
  'private environment stays fourth argument, secret extraction late and fifth default compatible',
  linux,
  async (t) => {
    const dir = await fixture(t);
    let secrets = 0;
    const result = await materializeTemplate(
      dir,
      'project',
      definition({ 'first.txt': 'public' }),
      {
        current: () => true,
        content() {
          secrets++;
          assert.equal(
            require('node:fs').readFileSync(
              path.join(dir, 'project', 'first.txt'),
              'utf8',
            ),
            'public',
          );
          return 'SCW_API_KEY=synthetic';
        },
      },
    );
    assert.equal(secrets, 1);
    assert.equal(
      await fs.readFile(path.join(result, '.env'), 'utf8'),
      'SCW_API_KEY=synthetic',
    );
    assert.equal(
      (await fs.stat(path.join(result, '.env'))).mode & 0o777,
      0o600,
    );
  },
);

test(
  'public-only materialization checks fifth callback after in-flight open',
  linux,
  async (t) => {
    const dir = await fixture(t);
    let current = true;
    const custom = source('agentScaffold', {
      ...fs,
      async open(target, ...args) {
        const handle = await fs.open(target, ...args);
        if (target.endsWith('/first.txt')) current = false;
        return handle;
      },
    });
    await assert.rejects(
      custom.materializeTemplate(
        dir,
        'project',
        definition({ 'first.txt': 'first', 'next.txt': 'next' }),
        undefined,
        () => current,
      ),
      { message: 'template_materialize_failed' },
    );
    assert.deepEqual(await fs.readdir(path.join(dir, 'project')), [
      'first.txt',
    ]);
    assert.equal(
      await fs.readFile(path.join(dir, 'project', 'first.txt'), 'utf8'),
      '',
    );
  },
);

for (const phase of ['content', 'env-open', 'env-chmod', 'env-write']) {
  test(
    'private output invalidation during ' +
      phase +
      ' preserves public files, prevents later effects',
    linux,
    async (t) => {
      const dir = await fixture(t);
      let current = true,
        writes = 0,
        syncs = 0,
        chmods = 0,
        secrets = 0;
      const custom = source('agentScaffold', {
        ...fs,
        async open(target, ...args) {
          const handle = await fs.open(target, ...args);
          if (target.endsWith('/.env')) {
            if (phase === 'env-open') current = false;
            const write = handle.writeFile.bind(handle),
              sync = handle.sync.bind(handle),
              chmod = handle.chmod.bind(handle);
            handle.chmod = async (...values) => {
              chmods++;
              const result = await chmod(...values);
              if (phase === 'env-chmod') current = false;
              return result;
            };
            handle.writeFile = async (...values) => {
              writes++;
              const result = await write(...values);
              if (phase === 'env-write') current = false;
              return result;
            };
            handle.sync = async () => {
              syncs++;
              return sync();
            };
          }
          return handle;
        },
      });
      await assert.rejects(
        custom.materializeTemplate(
          dir,
          'project',
          definition({ 'first.txt': 'public' }),
          {
            current: () => true,
            content() {
              secrets++;
              if (phase === 'content') current = false;
              return 'SCW_API_KEY=synthetic';
            },
          },
          () => current,
        ),
        { message: 'template_materialize_failed' },
      );
      assert.equal(secrets, 1);
      assert.equal(
        await fs.readFile(path.join(dir, 'project', 'first.txt'), 'utf8'),
        'public',
      );
      assert.equal(syncs, 0);
      assert.equal(writes, phase === 'env-write' ? 1 : 0);
      assert.equal(chmods, ['env-chmod', 'env-write'].includes(phase) ? 1 : 0);
      if (phase === 'content')
        assert.deepEqual(await fs.readdir(path.join(dir, 'project')), [
          'first.txt',
        ]);
      else {
        assert.equal(
          await fs.readFile(path.join(dir, 'project', '.env'), 'utf8'),
          phase === 'env-write' ? 'SCW_API_KEY=synthetic' : '',
        );
        assert.equal(
          (await fs.stat(path.join(dir, 'project', '.env'))).mode & 0o777,
          0o600,
        );
      }
    },
  );
}
