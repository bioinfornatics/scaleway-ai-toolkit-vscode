const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');
const app = path.resolve(__dirname, '..');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scw-pack-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function put(root, name, text) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
test('recursive build preserves paths, shared CJS and user files; rejects unsafe inputs', async (t) => {
  const root = fixture(t);
  put(
    root,
    'src/extension.ts',
    "import {value} from './nested'; export const activate=()=>value();",
  );
  put(root, 'src/nested/index.ts', "export {value} from './value';");
  put(root, 'src/nested/value.ts', 'export const value=()=>1;');
  put(root, 'dist/user.js', 'user content');
  put(root, 'dist/nested/user.txt', 'retain');
  const { buildExtension } = await import(
    pathToFileURL(path.join(app, 'build.mjs'))
  );
  await buildExtension(root, false);
  require(path.join(root, 'dist/nested/value.js')).value = () => 9;
  assert.equal(require(path.join(root, 'dist/extension.js')).activate(), 9);
  fs.unlinkSync(path.join(root, 'src/nested/value.ts'));
  put(root, 'src/nested/index.ts', 'export const value=()=>2;');
  await buildExtension(root, false);
  assert.equal(fs.existsSync(path.join(root, 'dist/nested/value.js')), false);
  assert.equal(
    fs.readFileSync(path.join(root, 'dist/user.js'), 'utf8'),
    'user content',
  );
  assert.equal(
    fs.readFileSync(path.join(root, 'dist/nested/user.txt'), 'utf8'),
    'retain',
  );
  fs.symlinkSync('/tmp', path.join(root, 'src/link'));
  await assert.rejects(buildExtension(root, false), /symlinks/);
  fs.unlinkSync(path.join(root, 'src/link'));
  put(root, 'src/escape.ts', "export {value} from '../../outside';");
  await assert.rejects(buildExtension(root, false), /escapes src/);
  fs.unlinkSync(path.join(root, 'src/escape.ts'));
  put(root, 'src/new.ts', 'export const n=1;');
  put(root, 'dist/new.js', 'user file');
  await assert.rejects(buildExtension(root, false), /overwrite user/);
});
test('VSIX verifier rejects mutated/missing/traversal/duplicate/symlink/bomb ZIP and missing dependencies', (t) => {
  const root = fixture(t);
  put(
    root,
    'dist/extension.js',
    'exports.activate=()=>{throw new Error("must not activate")};',
  );
  put(root, 'media/icon.svg', '<svg/>');
  put(root, 'LICENSE', fs.readFileSync(path.join(app, 'LICENSE')));
  put(root, 'README.md', '# Fixture README\n');
  put(root, 'THIRD_PARTY_NOTICES.md', '# Fixture notices\n');
  put(root, 'assets/templates/example.txt', 'payload');
  put(
    root,
    'package.json',
    JSON.stringify({
      name: 'fixture',
      version: '0.0.37',
      publisher: 'fixture-publisher',
      license: 'CeCILL-2.1',
      main: './dist/extension.js',
      engines: { vscode: '^1.96.0' },
    }),
  );
  const make = (mode) => {
    const archive = path.join(root, mode + '.vsix');
    const code = [
      'import pathlib,zipfile,stat,sys',
      'root=pathlib.Path(sys.argv[1]);archive=sys.argv[2];mode=sys.argv[3]',
      "with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED) as z:",
      " z.writestr('[Content_Types].xml','<Types/>');z.writestr('extension.vsixmanifest','<PackageManifest><Metadata><Identity Id=\"fixture\" Version=\"'+('0.0.36' if mode=='version-mismatch' else '0.0.37')+'\" Publisher=\"fixture-publisher\"/></Metadata></PackageManifest>')",
      " for p in root.rglob('*'):",
      "  if not p.is_file() or p.suffix=='.vsix':continue",
      "  rel=p.relative_to(root).as_posix();name='extension/'+{'LICENSE':'LICENSE.txt','README.md':'readme.md'}.get(rel,rel)",
      "  if mode=='missing' and name=='extension/media/icon.svg':continue",
      "  if mode=='license-missing' and name=='extension/LICENSE.txt':continue",
      "  if mode=='license-mutated' and name=='extension/LICENSE.txt':z.writestr(name,b'bad-license');continue",
      "  if mode=='readme-missing' and name=='extension/readme.md':continue",
      "  if mode=='readme-mutated' and name=='extension/readme.md':z.writestr(name,b'bad-readme');continue",
      "  if mode=='license-original-name' and rel=='LICENSE':name='extension/LICENSE'",
      "  if mode=='readme-original-name' and rel=='README.md':name='extension/README.md'",
      "  if mode=='notices-wrong-case' and rel=='THIRD_PARTY_NOTICES.md':name='extension/third_party_notices.md'",
      "  z.writestr(name,b'mutated' if mode=='mutated' and name=='extension/media/icon.svg' else p.read_bytes())",
      " if mode=='extra-tool':z.writestr('extension/scripts/ci/tool.py','bad')",
      " if mode=='extra-root':z.writestr('extension/CHANGELOG.md','bad')",
      " if mode=='traversal':z.writestr('../escape','bad')",
      " if mode=='duplicate':z.writestr('extension/media/icon.svg','duplicate')",
      " if mode=='symlink':",
      "  info=zipfile.ZipInfo('extension/media/link');info.external_attr=(stat.S_IFLNK|0o777)<<16;z.writestr(info,'/tmp')",
      " if mode=='bomb':z.writestr('extension/media/bomb',b'0'*(2*1024*1024))",
    ].join('\n');
    const zipped = spawnSync('python3', ['-c', code, root, archive, mode], {
      encoding: 'utf8',
    });
    assert.equal(zipped.status, 0, zipped.stderr);
    return spawnSync(
      'python3',
      [path.join(app, 'verifyVsix.py'), archive, '--root', root],
      { encoding: 'utf8' },
    );
  };
  const valid = make('valid');
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(JSON.parse(valid.stdout).minimumHostValidation, 'UNKNOWN');
  for (const mode of [
    'missing',
    'license-missing',
    'license-mutated',
    'readme-missing',
    'readme-mutated',
    'license-original-name',
    'readme-original-name',
    'notices-wrong-case',
    'extra-tool',
    'extra-root',
    'version-mismatch',
    'mutated',
    'traversal',
    'duplicate',
    'symlink',
    'bomb',
  ]) {
    const result = make(mode);
    assert.notEqual(result.status, 0, mode);
    assert.match(result.stderr, /verification FAILED/);
  }
  put(
    root,
    'dist/extension.js',
    'require("missing-scw-dependency");exports.activate=()=>{};',
  );
  const missing = make('dependency');
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /Isolated dependency load failed/);
});
