import { Buffer } from 'node:buffer';
import { constants } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { lstat, mkdir, open } from 'node:fs/promises';
import * as path from 'node:path';
import { loadEmbeddedTemplates } from './embeddedTemplates';
import {
  parseTemplate,
  type TemplateDefinition,
  type TemplateKind,
} from './templateLibrary';

/** Fresh definitions copied from validated packaged files, never inline fallback. */
export function builtinTemplates(kind: TemplateKind): TemplateDefinition[] {
  if (!['agents', 'tools'].includes(kind))
    throw new Error('invalid_template_kind');
  return loadEmbeddedTemplates(kind, 'builtin').map((entry) => entry.template);
}

function fdPath(handle: FileHandle, child: string): string {
  return `/proc/self/fd/${handle.fd}/${child}`;
}
async function openDirectory(
  target: string,
  checkCurrent: () => void,
): Promise<FileHandle> {
  checkCurrent();
  let current = await open('/', constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    checkCurrent();
    for (const component of target.split('/').filter(Boolean)) {
      checkCurrent();
      const next = await open(
        fdPath(current, component),
        constants.O_RDONLY |
          constants.O_DIRECTORY |
          constants.O_NOFOLLOW |
          constants.O_NONBLOCK,
      );
      const previous = current;
      current = next;
      await previous.close();
      checkCurrent();
    }
    return current;
  } catch (error) {
    await current.close().catch(() => {});
    throw error;
  }
}

async function createDirectory(
  parent: FileHandle,
  name: string,
  checkCurrent: () => void,
): Promise<FileHandle> {
  checkCurrent();
  const target = fdPath(parent, name);
  await mkdir(target, { mode: 0o700 }); // Never adopt an EEXIST directory.
  checkCurrent();
  const identity = await lstat(target);
  checkCurrent();
  if (!identity.isDirectory() || (identity.mode & 0o777) !== 0o700)
    throw new Error();
  checkCurrent();
  const handle = await open(
    target,
    constants.O_RDONLY |
      constants.O_DIRECTORY |
      constants.O_NOFOLLOW |
      constants.O_NONBLOCK,
  );
  try {
    checkCurrent();
    const actual = await handle.stat();
    checkCurrent();
    const visible = await lstat(target);
    checkCurrent();
    if (
      !visible.isDirectory() ||
      actual.dev !== identity.dev ||
      actual.ino !== identity.ino ||
      visible.dev !== identity.dev ||
      visible.ino !== identity.ino
    )
      throw new Error();
    return handle;
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}

/** Linux /proc descriptor-anchored exclusive bounded writes; fail closed on
 * other OSes. Portable Node has no rename-noreplace directory publication. This
 * fallback exclusively creates a 0700 final directory and checks lstat/fstat
 * identity before any file write. It never adopts pre-existing directories.
 * There remains an uncloseable mkdir/lstat window against same-UID attackers;
 * this is NOT complete same-UID race protection or atomic staged publication.
 * No cleanup after failure: unlink could remove a concurrent replacement.
 * Validity is checked before effects and after I/O; already in-flight I/O may
 * complete after invalidation. Owned partial output remains for manual review.
 * Descriptor closure is unconditional cleanup, never project rollback.
 * No execution or authority implied. */
export async function materializeTemplate(
  parent: string,
  name: string,
  value: TemplateDefinition,
  privateEnvironment?: { current(): boolean; content(): string },
  current: () => boolean = () => true,
): Promise<string> {
  const checkCurrent = (): void => {
    if (!current() || (privateEnvironment && !privateEnvironment.current()))
      throw new Error();
  };
  const template = parseTemplate(value);
  if (
    privateEnvironment &&
    (template.kind !== 'agents' ||
      Object.keys(template.files).some((p) =>
        p.split('/').some((part) => part.toLowerCase() === '.env'),
      ))
  )
    throw new Error('private_env_conflict');
  let base: FileHandle | undefined;
  let root: FileHandle | undefined;
  const owned = new Map<string, FileHandle>();
  try {
    if (
      process.platform !== 'linux' ||
      !constants.O_NOFOLLOW ||
      !constants.O_DIRECTORY ||
      typeof parent !== 'string' ||
      !path.isAbsolute(parent) ||
      parent.includes('\0') ||
      parent.split('/').some((part) => part === '.' || part === '..') ||
      typeof name !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)
    )
      throw new Error();
    const directories = new Set<string>();
    for (const file of Object.keys(template.files)) {
      const parts = file.split('/');
      if (parts.length > 16) throw new Error();
      for (let i = 1; i < parts.length; i++)
        directories.add(parts.slice(0, i).join('/'));
    }
    if (
      directories.size > 128 ||
      Object.values(template.files).reduce(
        (sum, content) => sum + Buffer.byteLength(content),
        0,
      ) >
        256 * 1024
    )
      throw new Error();
    checkCurrent();
    base = await openDirectory(parent, checkCurrent);
    checkCurrent();
    root = await createDirectory(base, name, checkCurrent);
    owned.set('', root);
    checkCurrent();
    // Build and anchor the entire directory tree before exposing file content.
    for (const directory of [...directories].sort(
      (a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b),
    )) {
      const parts = directory.split('/');
      const component = parts.pop() ?? '';
      const parentHandle = owned.get(parts.join('/'));
      if (!parentHandle) throw new Error();
      checkCurrent();
      owned.set(
        directory,
        await createDirectory(parentHandle, component, checkCurrent),
      );
      checkCurrent();
    }
    const checkTree = async (): Promise<void> => {
      checkCurrent();
      for (const [directory, handle] of owned) {
        const parts = directory.split('/');
        const component = parts.pop() ?? '';
        const parentHandle = directory ? owned.get(parts.join('/')) : base;
        if (!parentHandle) throw new Error();
        checkCurrent();
        const visible = await lstat(
          fdPath(parentHandle, directory ? component : name),
        );
        checkCurrent();
        const actual = await handle.stat();
        checkCurrent();
        if (
          !visible.isDirectory() ||
          visible.dev !== actual.dev ||
          visible.ino !== actual.ino
        )
          throw new Error();
      }
    };
    await checkTree();
    for (const [file, content] of Object.entries(template.files)) {
      await checkTree();
      const parts = file.split('/');
      const filename = parts.pop() ?? '';
      const directory = owned.get(parts.join('/'));
      if (!directory) throw new Error();
      checkCurrent();
      const handle = await open(
        fdPath(directory, filename),
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await checkTree();
        checkCurrent();
        await handle.writeFile(content, 'utf8');
        checkCurrent();
        await handle.sync();
        checkCurrent();
      } finally {
        await handle.close();
      }
    }
    await checkTree();
    if (privateEnvironment) {
      checkCurrent();
      // Obtain secret only after the public tree is created and anchored.
      const content = privateEnvironment.content();
      if (
        typeof content !== 'string' ||
        Buffer.byteLength(content) > 8192 ||
        !current() ||
        !privateEnvironment.current()
      )
        throw new Error();
      checkCurrent();
      const handle = await open(
        fdPath(root, '.env'),
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await checkTree();
        checkCurrent();
        await handle.chmod(0o600);
        checkCurrent();
        await handle.writeFile(content, 'utf8');
        checkCurrent();
        await handle.sync();
        checkCurrent();
      } finally {
        await handle.close();
      }
    }
    await checkTree();
    checkCurrent();
    return path.join(parent, name);
  } catch {
    throw new Error('template_materialize_failed');
  } finally {
    for (const handle of [...owned.values()].reverse())
      await handle.close().catch(() => {});
    await base?.close().catch(() => {});
  }
}
