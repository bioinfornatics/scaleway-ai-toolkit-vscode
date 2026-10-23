import { Buffer } from 'node:buffer';
import { constants } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { mkdir, open, opendir } from 'node:fs/promises';
import * as path from 'node:path';

export type TemplateKind = 'agents' | 'tools';
export interface ProjectTemplate {
  language: 'python' | 'typescript' | 'rust';
  package_manager: 'uv' | 'bun' | 'cargo';
  engine: 'mustache';
  render: Record<string, 'text' | 'json' | 'toml'>;
}
export interface TemplateDefinition {
  version: 1 | 2;
  project?: ProjectTemplate;
  id: string;
  label: string;
  kind: TemplateKind;
  description: string;
  files: Record<string, string>;
}
export interface TemplateEntry {
  template: TemplateDefinition;
  origin: 'project' | 'global';
  /** Absolute .scaleway-ai/templates base, also the argument to writeTemplate. */
  root: string;
  filePath: string;
}
export const TEMPLATE_LIMITS = Object.freeze({
  fileBytes: 256 * 1024,
  files: 256,
  directoryEntries: 512,
  workspaceRoots: 32,
  payloadFiles: 64,
});

function record(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}
function safePath(value: string): boolean {
  return (
    value.length <= 240 &&
    value
      .split('/')
      .every(
        (part) =>
          !!part &&
          part !== '.' &&
          part !== '..' &&
          !/[\\:*?"<>|]/.test(part) &&
          [...part].every(
            (character) =>
              character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
          ) &&
          !/[. ]$/.test(part) &&
          !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) &&
          !/^(?:\.env(?!\.example$)|id_rsa|id_ed25519|credentials)(?:$|\.)/i.test(
            part,
          ),
      )
  );
}
// Conservative screening, not an arbitrary-secret detector. Credential values
// must be explicit environment references, not literals or encoded credentials.
const environmentValue =
  /^(?:\$\{[A-Z_][A-Z0-9_]*\}|\$[A-Z_][A-Z0-9_]*|\{\{\s*(?:env\.)?[A-Z_][A-Z0-9_]*\s*\}\}|process\.env\.[A-Z_][A-Z0-9_]*|os\.environ\[["'][A-Z_][A-Z0-9_]*["']\]|os\.getenv\(["'][A-Z_][A-Z0-9_]*["']\))$/;
function credentialFree(text: string): boolean {
  if (
    /-----BEGIN (?:[A-Z ]*PRIVATE KEY)-----|(?:https?|postgres(?:ql)?|mysql):\/\/[^\s/:]+:[^\s/@]+@|\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|AKIA[A-Z0-9]{16})\b/i.test(
      text,
    )
  )
    return false;
  const assignments =
    /["']?\b(?:[a-z0-9]+[_-])*(?:api[_-]?key|access[_-]?key|secret(?:[_-]?key)?|secret[_-]?access[_-]?key|token|access[_-]?token|refresh[_-]?token|password|passwd|authorization|credential|client[_-]?secret|private[_-]?key)["']?\s*[:=]\s*([^\r\n,;]+)/gi;
  for (const match of text.matchAll(assignments)) {
    let value = match[1].trim();
    if (value.startsWith('"') || value.startsWith("'")) {
      const quote = value[0];
      const end = value.indexOf(quote, 1);
      if (end < 0) return false;
      value = value.slice(1, end);
    }
    value = value.replace(/^Bearer\s+/i, '');
    // JSON string content may end with its enclosing quote. Only permit this
    // suffix after an otherwise exact external-environment reference.
    if (
      !environmentValue.test(value) &&
      !environmentValue.test(value.replace(/\\?"$/, ''))
    )
      return false;
  }
  for (const match of text.matchAll(/\b(?:Bearer|Basic)\s+([^\s"',;]+)/gi)) {
    if (!environmentValue.test(match[1])) return false;
  }
  return true;
}

function parseProject(
  value: unknown,
  files: Record<string, string>,
): ProjectTemplate {
  if (
    !record(value) ||
    Object.keys(value).sort().join(',') !==
      'engine,language,package_manager,render' ||
    value.engine !== 'mustache' ||
    !record(value.render)
  )
    throw new Error();
  const managers: Record<string, string> = {
    python: 'uv',
    typescript: 'bun',
    rust: 'cargo',
  };
  if (
    typeof value.language !== 'string' ||
    !Object.hasOwn(managers, value.language) ||
    managers[value.language] !== value.package_manager
  )
    throw new Error();
  const render: ProjectTemplate['render'] = Object.create(null);
  for (const [p, mode] of Object.entries(value.render)) {
    if (
      !Object.hasOwn(files, p) ||
      !['text', 'json', 'toml'].includes(mode as string)
    )
      throw new Error();
    if (
      (p === 'package.json' && mode !== 'json') ||
      (['pyproject.toml', 'Cargo.toml'].includes(p) && mode !== 'toml')
    )
      throw new Error();
    render[p] = mode as 'text' | 'json' | 'toml';
  }
  return {
    language: value.language as ProjectTemplate['language'],
    package_manager:
      value.package_manager as ProjectTemplate['package_manager'],
    engine: 'mustache',
    render,
  };
}

/** Strict v1 JSON shape; errors never include user content or credential values. */
export function parseTemplate(value: unknown): TemplateDefinition {
  try {
    if (
      !record(value) ||
      Object.keys(value).sort().join(',') !==
        (value.version === 2
          ? 'description,files,id,kind,label,project,version'
          : 'description,files,id,kind,label,version') ||
      ![1, 2].includes(value.version as number) ||
      typeof value.id !== 'string' ||
      !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value.id) ||
      (value.kind !== 'agents' && value.kind !== 'tools') ||
      typeof value.label !== 'string' ||
      !value.label.trim() ||
      value.label.length > 200 ||
      typeof value.description !== 'string' ||
      value.description.length > 4000 ||
      !record(value.files)
    )
      throw new Error();
    const names = Object.keys(value.files).sort();
    if (!names.length || names.length > TEMPLATE_LIMITS.payloadFiles)
      throw new Error();
    const files: Record<string, string> = Object.create(null);
    const folded = new Set<string>();
    for (const name of names) {
      const content = value.files[name];
      if (
        !safePath(name) ||
        folded.has(name.toLowerCase()) ||
        typeof content !== 'string' ||
        content.length > TEMPLATE_LIMITS.fileBytes ||
        !credentialFree(content)
      )
        throw new Error();
      folded.add(name.toLowerCase());
      files[name] = content;
    }
    for (const name of names) {
      if (
        names.some((other) =>
          other.toLowerCase().startsWith(`${name.toLowerCase()}/`),
        )
      )
        throw new Error();
    }
    if (!credentialFree(value.label) || !credentialFree(value.description))
      throw new Error();
    const template: TemplateDefinition = {
      version: value.version as 1 | 2,
      ...(value.version === 2
        ? { project: parseProject(value.project, files) }
        : {}),
      id: value.id,
      label: value.label,
      kind: value.kind as TemplateKind,
      description: value.description,
      files,
    };
    if (Buffer.byteLength(JSON.stringify(template)) > TEMPLATE_LIMITS.fileBytes)
      throw new Error();
    return template;
  } catch {
    throw new Error('invalid_template');
  }
}

function code(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException)?.code;
}
function fdPath(handle: FileHandle, child = ''): string {
  return `/proc/self/fd/${handle.fd}${child ? `/${child}` : ''}`;
}
/** Linux descriptor-anchored traversal: every user-controlled component is
 * opened NOFOLLOW relative to an already-open directory. On other platforms
 * fail closed, rather than claim lstat/path checks prevent rename races.
 * /proc is an OS-owned prerequisite. No directory handles escape the API.
 */
async function directory(target: string, create: boolean): Promise<FileHandle> {
  if (
    process.platform !== 'linux' ||
    !constants.O_NOFOLLOW ||
    !constants.O_DIRECTORY ||
    typeof target !== 'string' ||
    !path.isAbsolute(target) ||
    target.includes('\0')
  )
    throw new Error();
  let current = await open('/', constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    for (const part of path.resolve(target).split('/').filter(Boolean)) {
      const nextPath = fdPath(current, part);
      if (create) {
        try {
          await mkdir(nextPath, { mode: 0o700 });
        } catch (error) {
          if (code(error) !== 'EEXIST') throw error;
        }
      }
      const next = await open(
        nextPath,
        constants.O_RDONLY |
          constants.O_NOFOLLOW |
          constants.O_DIRECTORY |
          constants.O_NONBLOCK,
      );
      await current.close();
      current = next;
    }
    return current;
  } catch (error) {
    await current.close().catch(() => {});
    throw error;
  }
}
async function readTemplate(
  parent: FileHandle,
  name: string,
): Promise<TemplateDefinition> {
  const handle = await open(
    fdPath(parent, name),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      before.size > TEMPLATE_LIMITS.fileBytes
    )
      throw new Error();
    const bytes = Buffer.alloc(TEMPLATE_LIMITS.fileBytes + 1);
    let total = 0;
    while (total < bytes.length) {
      const result = await handle.read(
        bytes,
        total,
        bytes.length - total,
        null,
      );
      if (!result.bytesRead) break;
      total += result.bytesRead;
    }
    const after = await handle.stat();
    if (
      total > TEMPLATE_LIMITS.fileBytes ||
      total !== before.size ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      throw new Error();
    const text = new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.subarray(0, total),
    );
    return parseTemplate(JSON.parse(text));
  } finally {
    await handle.close();
  }
}

/** Shallow *.json inventory. Input root order wins ID collisions, then global;
 * filenames are codepoint sorted within each root. Invalid entries never hide
 * lower-priority valid ones. Missing directories are normal. No writes occur.
 * A directory over the entry cap is skipped entirely (no arbitrary subset).
 */
export async function discoverTemplates(
  workspaceRoots: string[],
  home: string,
  kind: TemplateKind,
): Promise<{ entries: TemplateEntry[]; issues: string[] }> {
  const entries: TemplateEntry[] = [];
  const issues: string[] = [];
  if (
    !Array.isArray(workspaceRoots) ||
    workspaceRoots.length > TEMPLATE_LIMITS.workspaceRoots ||
    !['agents', 'tools'].includes(kind) ||
    typeof home !== 'string' ||
    !path.isAbsolute(home) ||
    workspaceRoots.some(
      (root) => typeof root !== 'string' || !path.isAbsolute(root),
    )
  )
    return { entries, issues: ['invalid_template_roots'] };
  const roots = [
    ...workspaceRoots.map((root) => ({
      root: path.join(root, '.scaleway-ai', 'templates'),
      origin: 'project' as const,
    })),
    {
      root: path.join(home, '.scaleway-ai', 'templates'),
      origin: 'global' as const,
    },
  ];
  const seenRoots = new Set<string>();
  const seenIds = new Set<string>();
  let files = 0;
  for (const source of roots) {
    source.root = path.resolve(source.root);
    if (seenRoots.has(source.root)) continue;
    seenRoots.add(source.root);
    let parent: FileHandle | undefined;
    try {
      parent = await directory(path.join(source.root, kind), false);
      const listing = await opendir(fdPath(parent), { bufferSize: 32 });
      const names: string[] = [];
      let count = 0;
      for await (const item of listing) {
        if (++count > TEMPLATE_LIMITS.directoryEntries) throw new Error();
        if (item.name.endsWith('.json')) names.push(item.name);
      }
      names.sort();
      for (const name of names) {
        if (++files > TEMPLATE_LIMITS.files) {
          issues.push('template_file_limit');
          return { entries, issues };
        }
        try {
          const template = await readTemplate(parent, name);
          if (template.kind !== kind) throw new Error();
          if (seenIds.has(template.id)) continue;
          seenIds.add(template.id);
          entries.push({
            template,
            origin: source.origin,
            root: source.root,
            filePath: path.join(source.root, kind, name),
          });
        } catch {
          issues.push('invalid_template_file');
        }
      }
    } catch (error) {
      if (code(error) !== 'ENOENT') issues.push('invalid_template_directory');
    } finally {
      await parent?.close().catch(() => {});
    }
  }
  return { entries, issues };
}

/** Create root/kind/id.json exclusively (0600); root is the library base.
 * Never materializes files from the payload. On a failed write, a partial new
 * file can remain: no unlink cleanup, which could remove a concurrently
 * replaced file. Update/delete intentionally absent: portable Node lacks
 * an atomic expected-hash + origin-identity conditional replace/unlink.
 */
export async function writeTemplate(
  root: string,
  value: TemplateDefinition,
): Promise<string> {
  const template = parseTemplate(value);
  let parent: FileHandle | undefined;
  let handle: FileHandle | undefined;
  try {
    if (
      typeof root !== 'string' ||
      !path.isAbsolute(root) ||
      path.basename(path.resolve(root)) !== 'templates' ||
      path.basename(path.dirname(path.resolve(root))) !== '.scaleway-ai'
    )
      throw new Error();
    parent = await directory(path.join(root, template.kind), true);
    handle = await open(
      fdPath(parent, `${template.id}.json`),
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    await handle.writeFile(JSON.stringify(template), 'utf8');
    await handle.sync();
    return path.join(path.resolve(root), template.kind, `${template.id}.json`);
  } catch {
    throw new Error('template_write_failed');
  } finally {
    await handle?.close().catch(() => {});
    await parent?.close().catch(() => {});
  }
}
