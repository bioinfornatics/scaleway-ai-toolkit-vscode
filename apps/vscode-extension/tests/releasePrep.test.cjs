const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const app = path.resolve(__dirname, '..');
const repo = path.resolve(app, '../..');
const read = (p) => fs.readFileSync(path.join(repo, p), 'utf8');
test('release gate accepts only current preview tag and matching LICENSE', () => {
  const run = (tag) =>
    spawnSync('python3', [path.join(__dirname, 'releaseGate.py'), tag], {
      encoding: 'utf8',
    });
  const result = run('v0.0.38');
  assert.equal(result.status, 0, result.stderr);
  for (const tag of [
    '0.0.38',
    'v0.0.36',
    'v1.0.0',
    'v0.0.38-rc1',
    'v0.0.38' + String.fromCharCode(10),
    'v0.0.38;echo bad',
  ])
    assert.notEqual(run(tag).status, 0, tag);
  assert.deepEqual(
    fs.readFileSync(path.join(app, 'LICENSE')),
    fs.readFileSync(path.join(repo, 'LICENSE')),
  );
  assert.ok(
    !read('apps/vscode-extension/package.mjs').includes('--skip-license'),
  );
});
test('metadata gate rejects mutated publisher/version/license/repository/private/lock', () => {
  const code = [
    'import importlib.util,pathlib,tempfile,json,sys',
    'source=pathlib.Path(sys.argv[1]); spec=importlib.util.spec_from_file_location("gate",source); gate=importlib.util.module_from_spec(spec); spec.loader.exec_module(gate)',
    'original=json.loads((source.parents[1]/"package.json").read_text()); lock=json.loads((source.parents[1]/"package-lock.json").read_text())',
    'with tempfile.TemporaryDirectory() as tmp:',
    ' root=pathlib.Path(tmp)/"apps"/"vscode-extension"; root.mkdir(parents=True)',
    ' (root.parents[1]/"LICENSE").write_bytes(b"fixture"); (root/"LICENSE").write_bytes(b"fixture")',
    ' for key,value in [("publisher","other"),("version","0.0.36"),("license","UNLICENSED"),("repository",{"url":"https://example.invalid"}),("private",False)]:',
    '  mutated=dict(original); mutated[key]=value; (root/"package.json").write_text(json.dumps(mutated)); (root/"package-lock.json").write_text(json.dumps(lock))',
    '  try: gate.validate("v0.0.38",root)',
    '  except ValueError: pass',
    '  else: raise AssertionError(key)',
    ' (root/"package.json").write_text(json.dumps(original)); lock["version"]="0.0.36"; (root/"package-lock.json").write_text(json.dumps(lock))',
    ' try: gate.validate("v0.0.38",root)',
    ' except ValueError: pass',
    ' else: raise AssertionError("lock")',
  ].join(String.fromCharCode(10));
  const result = spawnSync(
    'python3',
    ['-c', code, path.join(__dirname, 'releaseGate.py')],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
});
test('workflows are read-only by default; manual gate and no secrets on fork PRs', () => {
  const ci = read('.github/workflows/buildCI.yml');
  const pkg = read('.github/workflows/package.yml');
  const release = read('.github/workflows/release.yml');
  for (const workflow of [ci, pkg, release]) {
    assert.ok(
      workflow.includes(
        'permissions:' + String.fromCharCode(10) + '  contents: read',
      ),
    );
    for (const forbidden of [
      'pull_request_target',
      'secrets.',
      'secrets: inherit',
      'npm publish',
      'vsce publish',
      'SCW_API_KEY',
      'NODE_AUTH_TOKEN',
    ])
      assert.ok(!workflow.includes(forbidden), forbidden);
  }
  for (const workflow of [pkg, release])
    assert.ok(workflow.includes('persist-credentials: false'));
  assert.ok(ci.includes('pull_request:'));
  assert.ok(release.includes('workflow_dispatch:'));
  assert.ok(!release.includes('  push:'));
  assert.equal(release.split('contents: write').length - 1, 1);
  assert.equal(
    release.split("vars.PUBLIC_RELEASE_APPROVED == 'true'").length - 1,
    2,
  );
  for (const required of [
    'needs: [validate, package]',
    '--verify-tag --prerelease',
    'sha256sum --check',
    'RELEASE_TAG: ' + '$' + '{{ inputs.tag }}',
  ])
    assert.ok(release.includes(required), required);
  for (const required of [
    "vars.PUBLIC_RELEASE_APPROVED == 'true'",
    "SCW_PYTHON_WHEEL_PROOF: '1'",
    'npm ci --ignore-scripts',
    'npm run package -- --out',
    "UV_OFFLINE: '1'",
  ])
    assert.ok(pkg.includes(required), required);
  for (const forbidden of ['--full', 'cargo fetch', 'uv sync', 'bun install'])
    assert.ok(!pkg.includes(forbidden));
});
test('release uses original neutral icons and excludes former branded assets', () => {
  const crypto = require('node:crypto');
  const manifest = JSON.parse(read('apps/vscode-extension/package.json'));
  assert.equal(manifest.icon, 'media/toolkit-icon.png');
  for (const old of ['scaleway-icon.png', 'scaleway-mark.svg'])
    assert.ok(!fs.existsSync(path.join(app, 'media', old)));
  const provenance = JSON.parse(
    read(
      'specifications/references/documentation/agent-logo-v38/provenance.json',
    ),
  );
  for (const [file, digest] of Object.entries(provenance.files))
    assert.equal(
      crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(app, 'media', file)))
        .digest('hex'),
      digest,
    );
  const icon = read('apps/vscode-extension/media/toolkit.svg');
  assert.ok(icon.includes('currentColor'));
  assert.ok(icon.includes('<mask'));
  assert.ok(icon.includes('AI agent assistant'));
  assert.ok(!icon.includes('<filter'));
  assert.ok(!icon.includes('M8.37'));
});
test('CI provisions real fixture helpers before offline proofs', () => {
  const workflow = read('.github/workflows/package.yml');
  for (const dependency of [
    'httpx==0.28.1',
    'protobuf==7.35.1',
    'PyYAML==6.0.3',
  ])
    assert.ok(workflow.includes(dependency), dependency);
});
test('workflow YAML parses when local PyYAML is installed (no download)', (t) => {
  const probe = spawnSync('python3', ['-c', 'import yaml'], {
    encoding: 'utf8',
  });
  if (probe.status !== 0)
    return t.skip('PyYAML not installed; textual checks still run');
  const code =
    'import pathlib,yaml,sys; files=list(pathlib.Path(sys.argv[1]).glob("*.yml")); assert len(files)==3; [yaml.load(p.read_text(),Loader=yaml.BaseLoader) for p in files]';
  const result = spawnSync(
    'python3',
    ['-c', code, path.join(repo, '.github/workflows')],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
});

test('Rust bootstrap fixture matches reviewed template data and cannot run locally', () => {
  const script = path.join(app, 'scripts/ci/bootstrap-rust.py');
  const code = [
    'import importlib.util,pathlib,tempfile,tomllib,sys,unittest.mock as mock',
    'spec=importlib.util.spec_from_file_location("bootstrap",sys.argv[1]); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)',
    'with tempfile.TemporaryDirectory() as tmp:',
    ' manifest=module.prepare(pathlib.Path(tmp)/"fixture"); data=tomllib.loads(manifest.read_text()); assert data["dependencies"]==module.EXPECTED["axum"]',
    ' assert (manifest.parent/"src/lib.rs").read_text().splitlines()==["#[derive(clap::Parser)]","pub struct CompileOnly {}"]',
    ' calls=[]',
    ' def fake(argv,**kwargs):',
    '  calls.append((argv,kwargs))',
    '  if argv[1]=="fetch": pathlib.Path(argv[-1]).with_name("Cargo.lock").write_text("# mock resolved lock")',
    ' with mock.patch.dict(module.os.environ,{"GITHUB_ACTIONS":"true","CARGO_NET_OFFLINE":"false","RUNNER_TEMP":tmp}),mock.patch.object(sys,"argv",[sys.argv[1]]),mock.patch.object(module.subprocess,"run",side_effect=fake): module.main()',
    ' assert len(calls)==2; assert calls[0][0][1:3]==["fetch","--manifest-path"]',
    ' assert calls[1][0][1:5]==["build","--offline","--locked","--all-targets"]; assert calls[1][1]["env"]["CARGO_NET_OFFLINE"]=="true"',
    ' with mock.patch.dict(module.EXPECTED,{"none":{"unreviewed":"1"}}):',
    '  try: module.prepare(pathlib.Path(tmp)/"bad")',
    '  except ValueError: pass',
    '  else: raise AssertionError("dependency drift accepted")',
  ].join(String.fromCharCode(10));
  const proof = spawnSync('python3', ['-c', code, script], {
    encoding: 'utf8',
  });
  assert.equal(proof.status, 0, proof.stderr);
  const blocked = spawnSync('python3', [script], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_ACTIONS: 'false' },
  });
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /requires GitHub Actions/);
});

test('workflow semantics isolate Rust network bootstrap from offline canonical proofs', (t) => {
  const probe = spawnSync('python3', ['-c', 'import yaml'], {
    encoding: 'utf8',
  });
  if (probe.status !== 0) return t.skip('PyYAML unavailable; no download');
  const code = [
    'import pathlib,sys,yaml',
    'data=yaml.load(pathlib.Path(sys.argv[1]).read_text(),Loader=yaml.BaseLoader); job=data["jobs"]["proof"]; steps=job["steps"]',
    'assert job["env"]["CARGO_NET_OFFLINE"]=="true"',
    'online=[s for s in steps if s.get("env",{}).get("CARGO_NET_OFFLINE")=="false"]; assert len(online)==1',
    'assert online[0]["run"]=="python3 apps/vscode-extension/scripts/ci/bootstrap-rust.py"',
    'proof=next(s for s in steps if s.get("name","").startswith("Canonical")); assert steps.index(online[0])<steps.index(proof)',
    'assert proof["env"]["UV_OFFLINE"]=="1"; assert "npm run check" in proof["run"]',
    'assert all("cargo fetch" not in s.get("run","") for s in steps)',
    'assert not any("runner." in str(value) for value in job["env"].values())',
    'init=steps[0]; assert init["name"]=="Initialize isolated runner paths"; assert "UV_CACHE_DIR=$RUNNER_TEMP/scw-uv-cache" in init["run"]; assert "CARGO_TARGET_DIR=$RUNNER_TEMP/scw-cargo-target" in init["run"]; assert init["run"].count("$GITHUB_ENV")==2',
    'assert any(s.get("uses")=="actions/cache@v4" for s in steps)',
  ].join(String.fromCharCode(10));
  const result = spawnSync(
    'python3',
    ['-c', code, path.join(repo, '.github/workflows/package.yml')],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
});

// Registry-confirmed 0.0.8 is the published repair for read@1.0.7's ~0.0.4.
test('read locks a published mute-stream version within its dependency range', () => {
  const lock = JSON.parse(
    fs.readFileSync(path.join(app, 'package-lock.json'), 'utf8'),
  );
  const reader = lock.packages['node_modules/read'];
  const mute = lock.packages['node_modules/mute-stream'];
  assert.equal(reader.version, '1.0.7');
  assert.equal(reader.dependencies['mute-stream'], '~0.0.4');
  assert.equal(mute.version, '0.0.8');
  const [major, minor, patch] = mute.version.split('.').map(Number);
  assert.equal(major, 0);
  assert.equal(minor, 0);
  assert.ok(patch >= 4 && patch <= 8);
  assert.equal(
    mute.resolved,
    'https://registry.npmjs.org/mute-stream/-/mute-stream-0.0.8.tgz',
  );
  assert.equal(
    mute.integrity,
    'sha512-nnbWWOkoWyUsTjKrhgD0dcz22mdkSnpYqbEjIm2nhwhuxlSkpywJmBo8h0ZqJdkp73mb90SssHkN4rsRaBAfAA==',
  );
});
