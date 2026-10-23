import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, openSync, closeSync, linkSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--out' || !args[1].endsWith('.vsix'))) throw new Error('Usage: node package.mjs [--out path.vsix]');
const out = args.length ? path.resolve(args[1]) : path.resolve(root, '../../artifacts/scaleway-ai-toolkit-preview-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID() + '.vsix');
mkdirSync(path.dirname(out), { recursive: true });
if (existsSync(out)) throw new Error('Refusing to overwrite VSIX: ' + out);
const pending = path.join(path.dirname(out), '.pending-' + randomUUID() + '.vsix');
closeSync(openSync(pending, 'wx', 0o600));
function run(command, argv) {
  const result = spawnSync(command, argv, { cwd: root, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw result.error || new Error(command + ' failed (' + result.status + ')');
}
try {
  run('npm', ['run', 'typecheck']);
  run(process.execPath, ['build.mjs']);
  run(process.execPath, ['tests/runScoped.mjs']);
  run(path.join(root, 'node_modules/.bin/vsce'), ['package', '--no-dependencies', '--allow-missing-repository', '--skip-license', '--out', pending]);
  run('python3', ['verifyVsix.py', pending, '--root', root]);
  // Atomic exclusive publication on the same filesystem; never replace a candidate.
  linkSync(pending, out);
  console.log('Verified VSIX: ' + out);
} finally {
  unlinkSync(pending);
}
