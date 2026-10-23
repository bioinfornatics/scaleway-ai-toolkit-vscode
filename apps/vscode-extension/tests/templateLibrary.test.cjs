const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
  parseTemplate,
  discoverTemplates,
  writeTemplate,
  TEMPLATE_LIMITS,
} = require('../dist/templateLibrary');
const linux = { skip: process.platform !== 'linux' };
function definition(id = 'sample', kind = 'agents') {
  return {
    version: 1,
    id,
    label: 'Sample',
    kind,
    description: 'Offline base',
    files: { 'README.md': 'Safe instructions' },
  };
}
function base(root) {
  return path.join(root, '.scaleway-ai', 'templates');
}
async function fixture(t) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'scw-template-library-'),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
async function put(root, name, value, kind = 'agents') {
  const dir = path.join(base(root), kind);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, name),
    typeof value === 'string' ? value : JSON.stringify(value),
  );
}

test('strict v1 schema, isolated files and generic errors', () => {
  const input = definition();
  const parsed = parseTemplate(input);
  input.files['README.md'] = 'changed';
  assert.equal(parsed.files['README.md'], 'Safe instructions');
  const bad = [
    null,
    [],
    {},
    'json',
    { ...definition(), version: 2 },
    { ...definition(), extra: true },
    { ...definition(), apiKey: 'fixture-only' },
    { ...definition(), kind: new String('agents') },
    { ...definition(), kind: 'agent' },
    { ...definition(), id: '../id' },
    { ...definition(), label: ' ' },
    { ...definition(), description: false },
    { ...definition(), files: {} },
    { ...definition(), files: { a: 1 } },
    { ...definition(), files: { a: '', 'a/b': '' } },
    { ...definition(), files: { 'Readme.md': '', 'README.md': '' } },
    { ...definition(), files: { a: 'x'.repeat(TEMPLATE_LIMITS.fileBytes) } },
    {
      ...definition(),
      files: Object.fromEntries(
        Array.from({ length: TEMPLATE_LIMITS.payloadFiles + 1 }, (_, i) => [
          `f${i}`,
          '',
        ]),
      ),
    },
  ];
  for (const value of bad)
    assert.throws(() => parseTemplate(value), { message: 'invalid_template' });
});

test('paths reject traversal, absolute, platform unsafe and secret files', () => {
  for (const name of [
    '../x',
    '/x',
    './x',
    'a//b',
    'a/../b',
    'a\\b',
    'C:x',
    'a\0b',
    'a?',
    'a*',
    'a|b',
    'CON.txt',
    'nul',
    'x.',
    'x ',
    '.env',
    '.env.prod',
    'id_rsa',
    'credentials.json',
  ])
    assert.throws(
      () => parseTemplate({ ...definition(), files: { [name]: '' } }),
      { message: 'invalid_template' },
    );
  assert.equal(
    parseTemplate({
      ...definition(),
      files: {
        'nested/agent.md': '',
        '.env.example': 'API_KEY=$' + '{API_KEY}',
      },
    }).files['nested/agent.md'],
    '',
  );
});

test('credential literals rejected and environment references allowed', () => {
  for (const content of [
    'API_KEY=fixture-only',
    '{"password":"fixture-only"}',
    'client_secret: fixture-only',
    'Authorization: Bearer fixture-only',
    'Bearer fixture-only',
    'https://user:fixture-only@example.invalid',
    '-----BEGIN PRIVATE KEY-----',
    'sk-abcdefghijklmnopqrstu',
    'SCW_SECRET_KEY = "fixture-only"',
    'apiKey: "fixture-only"',
  ])
    assert.throws(
      () =>
        parseTemplate({ ...definition(), files: { 'config.txt': content } }),
      { message: 'invalid_template' },
    );
  for (const content of [
    'API_KEY=$' + '{API_KEY}',
    'API_KEY="$API_KEY"',
    'apiKey: process.env.API_KEY',
    'token = os.getenv("TOKEN")',
    'password = os.environ["PASSWORD"]',
    'Authorization: "Bearer $' + '{TOKEN}"',
    'token: "{{ env.TOKEN }}"',
  ])
    assert.equal(
      parseTemplate({ ...definition(), files: { 'config.txt': content } })
        .files['config.txt'],
      content,
    );
  assert.throws(
    () => parseTemplate({ ...definition(), description: 'token=fixture-only' }),
    { message: 'invalid_template' },
  );
});

test(
  'missing dirs cause no filesystem effects; invalid roots fail closed',
  linux,
  async (t) => {
    const root = await fixture(t);
    assert.deepEqual(
      await discoverTemplates(
        [path.join(root, 'project')],
        path.join(root, 'home'),
        'agents',
      ),
      { entries: [], issues: [] },
    );
    assert.deepEqual(await fs.readdir(root), []);
    for (const roots of [['relative'], Array(33).fill(root)])
      assert.deepEqual(await discoverTemplates(roots, root, 'agents'), {
        entries: [],
        issues: ['invalid_template_roots'],
      });
  },
);

test(
  'project order precedence, sorted filenames, global fallback, origins and kinds',
  linux,
  async (t) => {
    const root = await fixture(t);
    const p1 = path.join(root, 'p1');
    const p2 = path.join(root, 'p2');
    const home = path.join(root, 'home');
    await put(p1, 'z.json', { ...definition('shared'), label: 'First' });
    await put(p1, 'a.json', definition('alpha'));
    await put(p2, 'a.json', { ...definition('shared'), label: 'Second' });
    await put(p2, 'b.json', definition('beta'));
    await put(home, 'a.json', { ...definition('shared'), label: 'Global' });
    await put(home, 'b.json', definition('gamma'));
    await put(home, 't.json', definition('tool', 'tools'), 'tools');
    const result = await discoverTemplates([p1, p2, p1], home, 'agents');
    assert.deepEqual(result.issues, []);
    assert.deepEqual(
      result.entries.map((e) => [e.template.id, e.origin]),
      [
        ['alpha', 'project'],
        ['shared', 'project'],
        ['beta', 'project'],
        ['gamma', 'global'],
      ],
    );
    assert.equal(result.entries[1].template.label, 'First');
    assert.equal(result.entries[1].root, base(p1));
    assert.equal(
      result.entries[1].filePath,
      path.join(base(p1), 'agents', 'z.json'),
    );
    assert.equal(
      (await discoverTemplates([p2, p1], home, 'agents')).entries.find(
        (e) => e.template.id === 'shared',
      ).template.label,
      'Second',
    );
    assert.deepEqual(
      (await discoverTemplates([p1, p2], home, 'tools')).entries.map(
        (e) => e.template.id,
      ),
      ['tool'],
    );
  },
);

test(
  'invalid JSON/UTF8, kind, size, links and directories skipped; no recursion',
  linux,
  async (t) => {
    const root = await fixture(t);
    const p = path.join(root, 'project');
    const home = path.join(root, 'home');
    await put(p, 'bad.json', '{');
    await put(p, 'kind.json', definition('kind', 'tools'));
    await put(p, 'secret.json', {
      ...definition('secret'),
      files: { 'config.txt': 'token=fixture-only' },
    });
    await put(p, 'large.json', ' '.repeat(TEMPLATE_LIMITS.fileBytes + 1));
    await put(p, 'invalid-utf8.json', '');
    await fs.writeFile(
      path.join(base(p), 'agents', 'invalid-utf8.json'),
      Buffer.from([0xff]),
    );
    await put(home, 'good.json', definition());
    const outside = path.join(root, 'outside.json');
    await fs.writeFile(outside, JSON.stringify(definition('outside')));
    await fs.symlink(outside, path.join(base(p), 'agents', 'link.json'));
    await fs.link(outside, path.join(base(p), 'agents', 'hard.json'));
    await fs.mkdir(path.join(base(p), 'agents', 'dir.json'));
    await fs.mkdir(path.join(base(p), 'agents', 'nested'));
    await fs.writeFile(
      path.join(base(p), 'agents', 'nested', 'good.json'),
      JSON.stringify(definition('nested')),
    );
    const before = await fs.readFile(outside);
    const result = await discoverTemplates([p], home, 'agents');
    assert.deepEqual(
      result.entries.map((e) => e.template.id),
      ['sample'],
    );
    assert.equal(result.issues.length, 8);
    assert(result.issues.every((i) => i === 'invalid_template_file'));
    assert.deepEqual(await fs.readFile(outside), before);
  },
);

test(
  'symlink ancestors/kind directory rejected for discovery and creation',
  linux,
  async (t) => {
    const root = await fixture(t);
    const real = path.join(root, 'real');
    const home = path.join(root, 'home');
    await put(real, 'good.json', definition());
    const alias = path.join(root, 'alias');
    await fs.symlink(real, alias);
    assert.deepEqual(
      (await discoverTemplates([alias], home, 'agents')).issues,
      ['invalid_template_directory'],
    );
    await assert.rejects(writeTemplate(base(alias), definition('new')), {
      message: 'template_write_failed',
    });
    const p = path.join(root, 'p');
    await fs.mkdir(p);
    await fs.symlink(
      path.join(real, '.scaleway-ai'),
      path.join(p, '.scaleway-ai'),
    );
    assert.equal(
      (await discoverTemplates([p], home, 'agents')).entries.length,
      0,
    );
    await assert.rejects(writeTemplate(base(p), definition('new')), {
      message: 'template_write_failed',
    });
    const q = path.join(root, 'q');
    await fs.mkdir(base(q), { recursive: true });
    await fs.symlink(
      path.join(base(real), 'agents'),
      path.join(base(q), 'agents'),
    );
    await assert.rejects(writeTemplate(base(q), definition('new')), {
      message: 'template_write_failed',
    });
    assert.equal(
      (await discoverTemplates([q], home, 'agents')).entries.length,
      0,
    );
    assert.deepEqual(await fs.readdir(path.join(base(real), 'agents')), [
      'good.json',
    ]);
  },
);

test(
  'exclusive creation, concurrent collision, permissions, symlink preservation',
  linux,
  async (t) => {
    const root = await fixture(t);
    const library = base(path.join(root, 'project'));
    const outcomes = await Promise.allSettled([
      writeTemplate(library, definition()),
      writeTemplate(library, definition()),
    ]);
    assert.equal(outcomes.filter((o) => o.status === 'fulfilled').length, 1);
    const file = path.join(library, 'agents', 'sample.json');
    const before = await fs.readFile(file);
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    await assert.rejects(
      writeTemplate(library, { ...definition(), label: 'Replacement' }),
      { message: 'template_write_failed' },
    );
    assert.deepEqual(await fs.readFile(file), before);
    const target = path.join(root, 'target');
    await fs.writeFile(target, 'unchanged');
    await fs.symlink(target, path.join(library, 'agents', 'linked.json'));
    await assert.rejects(writeTemplate(library, definition('linked')), {
      message: 'template_write_failed',
    });
    assert.equal(await fs.readFile(target, 'utf8'), 'unchanged');
    await assert.rejects(writeTemplate(root, definition()), {
      message: 'template_write_failed',
    });
    await assert.rejects(
      writeTemplate(library, { ...definition(), version: 2 }),
      { message: 'invalid_template' },
    );
    assert.equal(
      (
        await discoverTemplates(
          [path.join(root, 'project')],
          path.join(root, 'home'),
          'agents',
        )
      ).entries[0].template.id,
      'sample',
    );
  },
);

test(
  'directory-entry bound skips entire overflowing directory; total files capped',
  linux,
  async (t) => {
    const root = await fixture(t);
    const p = path.join(root, 'p');
    const home = path.join(root, 'home');
    const dir = path.join(base(p), 'agents');
    await fs.mkdir(dir, { recursive: true });
    for (let i = 0; i <= TEMPLATE_LIMITS.directoryEntries; i++)
      await fs.writeFile(path.join(dir, `ignored${i}`), '');
    await put(home, 'good.json', definition());
    assert.deepEqual((await discoverTemplates([p], home, 'agents')).issues, [
      'invalid_template_directory',
    ]);
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir);
    for (let i = 0; i <= TEMPLATE_LIMITS.files; i++)
      await put(p, `${String(i).padStart(3, '0')}.json`, definition(`id-${i}`));
    const result = await discoverTemplates([p], home, 'agents');
    assert.equal(result.entries.length, TEMPLATE_LIMITS.files);
    assert.deepEqual(result.issues, ['template_file_limit']);
  },
);

test(
  'directory swap races remain anchored: discovery and write do not follow replacement symlinks',
  linux,
  async (t) => {
    const root = await fixture(t);
    const Module = require('node:module');
    for (const operation of ['discover', 'write']) {
      const p = path.join(root, operation);
      const home = path.join(root, 'home');
      const outside = path.join(root, `outside-${operation}`);
      await put(p, 'good.json', definition('original'));
      await fs.mkdir(outside);
      await fs.writeFile(
        path.join(outside, 'good.json'),
        JSON.stringify(definition('outside')),
      );
      const dir = path.join(base(p), 'agents');
      const moved = `${dir}-moved`;
      const load = Module._load;
      const modulePath = require.resolve('../dist/templateLibrary');
      let swapped = false;
      delete require.cache[modulePath];
      Module._load = function (name, ...args) {
        if (name === 'node:fs/promises')
          return {
            ...fs,
            async open(target, ...options) {
              const handle = await fs.open(target, ...options);
              if (!swapped && target.endsWith('/agents')) {
                swapped = true;
                await fs.rename(dir, moved);
                await fs.symlink(outside, dir);
              }
              return handle;
            },
          };
        return load.call(this, name, ...args);
      };
      let library;
      try {
        library = require(modulePath);
      } finally {
        Module._load = load;
        delete require.cache[modulePath];
      }
      if (operation === 'discover') {
        const result = await library.discoverTemplates([p], home, 'agents');
        assert.deepEqual(
          result.entries.map((e) => e.template.id),
          ['original'],
        );
      } else {
        await library.writeTemplate(base(p), definition('created'));
        assert.equal(
          JSON.parse(
            await fs.readFile(path.join(moved, 'created.json'), 'utf8'),
          ).id,
          'created',
        );
      }
      assert.equal(swapped, true);
      assert.deepEqual(await fs.readdir(outside), ['good.json']);
    }
  },
);

test(
  'compact write roundtrips large payloads below the byte cap',
  linux,
  async (t) => {
    const root = await fixture(t);
    const value = {
      ...definition(),
      files: { 'large.txt': 'x'.repeat(TEMPLATE_LIMITS.fileBytes - 300) },
    };
    const file = await writeTemplate(base(root), value);
    assert((await fs.stat(file)).size <= TEMPLATE_LIMITS.fileBytes);
    assert.equal(
      (await discoverTemplates([root], path.join(root, 'home'), 'agents'))
        .entries.length,
      1,
    );
  },
);
