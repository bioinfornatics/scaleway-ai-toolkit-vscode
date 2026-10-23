import { opendir, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadEmbeddedTemplates } = require('./dist/embeddedTemplates.js');
const root = fileURLToPath(new URL('./assets/templates/', import.meta.url));
const expected = new Set();
let templates = 0;
let payloads = 0;
for (const kind of ['agents', 'tools']) for (const usage of ['stack', 'builtin']) {
  for (const entry of loadEmbeddedTemplates(kind, usage, root, expected)) {
    templates++;
    payloads += Object.keys(entry.template.files).length;
  }
}
// Tree accounting never reopens manifest/payload content by pathname.
let entries = 0;
async function inspect(directory, relative = '', depth = 0) {
  if (depth > 12) throw new Error('Asset depth limit exceeded');
  const stream = await opendir(directory);
  try {
    for await (const item of stream) {
      if (++entries > 4096) throw new Error('Asset entry limit exceeded');
      const absolute = path.join(directory, item.name);
      const current = relative ? relative + '/' + item.name : item.name;
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink()) throw new Error('Asset symlinks forbidden');
      if (stat.isDirectory()) await inspect(absolute, current, depth + 1);
      else if (!stat.isFile() || stat.nlink !== 1 || !expected.delete(current)) throw new Error('Unexpected or unsafe asset');
    }
  } finally { await stream.close().catch(() => {}); }
}
await inspect(root);
if (expected.size) throw new Error('Missing declared assets');
console.log(JSON.stringify({ embeddedTemplates: templates, payloadFiles: payloads, validation: 'PASS' }));
