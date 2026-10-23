import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import * as path from 'node:path';
import {
  parseTemplate,
  TEMPLATE_LIMITS,
  type TemplateDefinition,
  type TemplateKind,
} from './templateLibrary';

export type EmbeddedLanguage = 'python' | 'typescript' | 'rust';
export interface EmbeddedTemplate {
  language: EmbeddedLanguage;
  framework: string;
  category: 'agent' | 'backend' | 'basic';
  usage: 'stack' | 'builtin';
  template: TemplateDefinition;
}
const MAX_TEMPLATES = 64;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
/** Source and dist both sit one level below the extension root. Never cwd/workspace. */
export const EMBEDDED_TEMPLATE_ROOT = path.join(
  __dirname,
  '..',
  'assets',
  'templates',
);
function record(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
function keys(value: Record<string, unknown>, names: string[]): boolean {
  return Object.keys(value).sort().join(',') === names.sort().join(',');
}
function directory(parent: number, child: string): number {
  return openSync(
    `/proc/self/fd/${parent}/${child}`,
    constants.O_RDONLY |
      constants.O_DIRECTORY |
      constants.O_NOFOLLOW |
      constants.O_NONBLOCK,
  );
}
function rootDirectory(root: string): number {
  if (
    process.platform !== 'linux' ||
    !path.isAbsolute(root) ||
    root.includes('\0') ||
    root.split('/').some((p) => p === '.' || p === '..')
  )
    throw new Error();
  let fd = openSync(
    '/',
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    for (const part of root.split('/').filter(Boolean)) {
      const next = directory(fd, part);
      closeSync(fd);
      fd = next;
    }
    const result = fd;
    fd = -1;
    return result;
  } finally {
    if (fd >= 0) closeSync(fd);
  }
}
/** Bounded descriptor reads: no symlinks, hardlinks, FIFOs, device files or path fallback. */
function readText(
  base: number,
  relative: string,
  budget: { remaining: number },
): string {
  const parts = relative.split('/');
  if (
    parts.some(
      (p) => !p || p === '.' || p === '..' || !/^[A-Za-z0-9_.-]+$/.test(p),
    )
  )
    throw new Error();
  const directories: number[] = [];
  let file = -1;
  try {
    let parent = base;
    for (const part of parts.slice(0, -1)) {
      parent = directory(parent, part);
      directories.push(parent);
    }
    file = openSync(
      `/proc/self/fd/${parent}/${parts[parts.length - 1]}`,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const before = fstatSync(file);
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      before.size > TEMPLATE_LIMITS.fileBytes ||
      before.size > budget.remaining
    )
      throw new Error();
    const buffer = Buffer.alloc(before.size + 1);
    let total = 0;
    while (total < buffer.length) {
      const read = readSync(file, buffer, total, buffer.length - total, null);
      if (!read) break;
      total += read;
    }
    const after = fstatSync(file);
    if (
      total !== before.size ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      throw new Error();
    budget.remaining -= total;
    return new TextDecoder('utf-8', { fatal: true }).decode(
      buffer.subarray(0, total),
    );
  } finally {
    if (file >= 0) closeSync(file);
    for (const fd of directories.reverse()) closeSync(fd);
  }
}
/** Internal asset manifest is NOT the personal-template envelope or AgentSpec.
 * base is host-only test/installation input; no browser paths are accepted.
 * Missing/corrupt assets fail closed; no repository, network or inline fallback.
 */
export function loadEmbeddedTemplates(
  kind: TemplateKind,
  usage: EmbeddedTemplate['usage'],
  base = EMBEDDED_TEMPLATE_ROOT,
  validatedPaths?: Set<string>,
): EmbeddedTemplate[] {
  let fd = -1;
  try {
    if (
      !['agents', 'tools'].includes(kind) ||
      !['stack', 'builtin'].includes(usage)
    )
      throw new Error();
    fd = rootDirectory(base);
    const budget = { remaining: MAX_TOTAL_BYTES };
    const catalog: unknown = JSON.parse(readText(fd, 'catalog.json', budget));
    validatedPaths?.add('catalog.json');
    if (
      !record(catalog) ||
      !keys(catalog, ['format_version', 'templates']) ||
      catalog.format_version !== 1 ||
      !Array.isArray(catalog.templates) ||
      !catalog.templates.length ||
      catalog.templates.length > MAX_TEMPLATES
    )
      throw new Error();
    const seen = new Set<string>();
    const ids = new Set<string>();
    const results: EmbeddedTemplate[] = [];
    for (const relative of catalog.templates) {
      if (
        typeof relative !== 'string' ||
        !/^(agents|tools)\/(python|typescript|rust)\/[a-z0-9-]+(?:\/builtin)?\/template\.json$/.test(
          relative,
        ) ||
        seen.has(relative)
      )
        throw new Error();
      seen.add(relative);
      const [entryKind, language, framework] = relative.split('/');
      const entryUsage = relative.endsWith('/builtin/template.json')
        ? 'builtin'
        : 'stack';
      if (entryKind !== kind || entryUsage !== usage) continue;
      const value: unknown = JSON.parse(readText(fd, relative, budget));
      validatedPaths?.add(relative);
      if (
        !record(value) ||
        !keys(value, [
          'format_version',
          'id',
          'label',
          'kind',
          'language',
          'framework',
          'category',
          'usage',
          'description',
          'files',
        ]) ||
        value.format_version !== 1 ||
        value.kind !== kind ||
        value.language !== language ||
        value.framework !== framework ||
        value.usage !== usage ||
        !['agent', 'backend', 'basic'].includes(value.category as string) ||
        !Array.isArray(value.files) ||
        !value.files.length ||
        value.files.length > TEMPLATE_LIMITS.payloadFiles
      )
        throw new Error();
      if (
        (kind === 'tools' && value.category === 'agent') ||
        (language === 'rust' && value.category === 'agent')
      )
        throw new Error();
      // Validate every payload mapping and metadata BEFORE reading its path.
      const placeholders: Record<string, string> = Object.create(null);
      for (const name of value.files) {
        if (typeof name !== 'string' || Object.hasOwn(placeholders, name))
          throw new Error();
        placeholders[name] = '';
      }
      const checked = parseTemplate({
        version: 1,
        id: value.id,
        label: value.label,
        kind,
        description: value.description,
        files: placeholders,
      });
      if (ids.has(checked.id)) throw new Error();
      ids.add(checked.id);
      const files: Record<string, string> = Object.create(null);
      const directoryPath = `${relative.slice(0, -'template.json'.length)}files/`;
      for (const name of Object.keys(checked.files)) {
        files[name] = readText(fd, directoryPath + name, budget);
        validatedPaths?.add(directoryPath + name);
      }
      results.push({
        language: language as EmbeddedLanguage,
        framework,
        category: value.category as EmbeddedTemplate['category'],
        usage,
        template: parseTemplate({ ...checked, files }),
      });
    }
    if (!results.length) throw new Error();
    return results;
  } catch {
    throw new Error('invalid_embedded_templates');
  } finally {
    if (fd >= 0) closeSync(fd);
  }
}
