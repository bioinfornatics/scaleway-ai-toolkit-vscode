import { readdir, lstat, mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const marker = '// scaleway-ai generated build output; do not edit';
const inside = (root, file) => file.startsWith(root + path.sep);
const safeName = (name) => /^[A-Za-z0-9_.-]+$/.test(name) && name !== '.' && name !== '..';
async function walk(root, relative = '', depth = 0, budget = { count: 0 }) {
  if (depth > 16) throw new Error('Build depth limit exceeded');
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe build directory');
  const files = [];
  for (const item of await readdir(root, { withFileTypes: true })) {
    if (++budget.count > 4096 || !safeName(item.name)) throw new Error('Unsafe build input or entry limit');
    const absolute = path.join(root, item.name);
    const current = relative ? relative + '/' + item.name : item.name;
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) throw new Error('Build symlinks forbidden');
    if (info.isDirectory()) files.push(...await walk(absolute, current, depth + 1, budget));
    else if (!info.isFile() || info.nlink !== 1 || info.size > 32 * 1024 * 1024) throw new Error('Unsafe build file');
    else files.push(current);
  }
  return files.sort();
}
async function generated(file) {
  const text = await readFile(file, 'utf8');
  // Recognize our marker and pre-migration esbuild outputs, never arbitrary JS.
  return text.startsWith(marker + '\n') ||
    (text.startsWith('"use strict";\nvar __') && text.includes('var __defProp = Object.defineProperty;') &&
      text.trimEnd().endsWith('module.exports = { ...module.exports };'));
}
export async function buildExtension(root = fileURLToPath(new URL('.', import.meta.url)), validateAssets = true) {
  root = path.resolve(root);
  const src = path.join(root, 'src');
  const dist = path.join(root, 'dist');
  const inputs = await walk(src);
  const entries = inputs.filter((name) => name.endsWith('.ts') && !name.endsWith('.d.ts'));
  if (!entries.length) throw new Error('No build entries');
  const outputs = new Set(entries.map((name) => name.replace(/\.ts$/, '.js')));
  if (outputs.size !== entries.length) throw new Error('Duplicate build output');
  await mkdir(dist, { recursive: true });
  const existing = await walk(dist);
  for (const name of existing) {
    if (outputs.has(name) && !await generated(path.join(dist, name))) throw new Error('Refusing to overwrite user output: ' + name);
  }
  const result = await build({
    absWorkingDir: root,
    entryPoints: entries.map((name) => path.join(src, name)),
    outbase: src, outdir: dist, write: false, bundle: true,
    platform: 'node', target: 'node22', format: 'cjs', external: ['vscode'],
    plugins: [{ name: 'local-modules', setup(builder) {
      builder.onResolve({ filter: /^\.\.?\// }, async (args) => {
        if (!inside(src, args.importer)) return;
        if (args.path.includes('\\') || args.path.includes('\0')) throw new Error('Unsafe local import');
        const base = path.resolve(path.dirname(args.importer), args.path);
        if (!inside(src, base)) throw new Error('Local import escapes src');
        const candidates = [base, base + '.ts', path.join(base, 'index.ts')];
        const resolved = candidates.find((file) => entries.includes(path.relative(src, file).split(path.sep).join('/')));
        if (!resolved) throw new Error('Local runtime import has no build entry: ' + args.path);
        let relative = path.relative(path.dirname(args.importer), resolved).split(path.sep).join('/').replace(/\.ts$/, '');
        if (!relative.startsWith('.')) relative = './' + relative;
        return { path: relative, external: true };
      });
    } }],
    banner: { js: marker },
    footer: { js: 'module.exports = { ...module.exports };' },
    sourcemap: false, logLevel: 'info',
  });
  for (const output of result.outputFiles) {
    if (!inside(dist, output.path)) throw new Error('Build output escapes dist');
    await mkdir(path.dirname(output.path), { recursive: true });
    await writeFile(output.path, output.contents, { flag: 'w' });
  }
  for (const name of existing) {
    if (name.endsWith('.js') && !outputs.has(name) && await generated(path.join(dist, name))) await unlink(path.join(dist, name));
  }
  if (validateAssets) await import('./verifyAssets.mjs');
  return [...outputs];
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error('build.mjs accepts no CLI paths');
  await buildExtension();
}
