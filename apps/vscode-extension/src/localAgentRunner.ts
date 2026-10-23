import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath, stat } from 'node:fs/promises';
import * as path from 'node:path';
import * as TOML from '@iarna/toml';
import * as vscode from 'vscode';

const CONFIG = '.vscode/scaleway-agent-run.json';
const LIMIT = 2 * 1024 * 1024;
interface Launch {
  version: 1 | 2;
  consoleScript?: 'agent';
  ready: boolean;
  runtime: 'python' | 'node';
  entry: string;
  args: string[];
}
interface Prepared {
  launch: Launch;
  digest: string;
  executable: string;
}
export interface LocalRun {
  id: string;
  name: string;
  state: string;
  active: boolean;
}
interface OwnedRun extends LocalRun {
  directory: string;
  execution?: vscode.TaskExecution;
  task?: vscode.Task;
  stopRequested?: boolean;
}
export function parseLocalLaunch(value: unknown, requireReady = true): Launch {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid_launch');
  const v = value as Record<string, unknown>;
  if (
    (v.version === 2
      ? Object.keys(v).sort().join(',') !==
          'args,consoleScript,entry,ready,runtime,version' ||
        v.consoleScript !== 'agent' ||
        v.runtime !== 'python'
      : Object.keys(v).sort().join(',') !==
          'args,entry,ready,runtime,version' || v.version !== 1) ||
    typeof v.ready !== 'boolean' ||
    (requireReady && v.ready !== true) ||
    !['python', 'node'].includes(v.runtime as string) ||
    typeof v.entry !== 'string' ||
    v.entry.length > 512 ||
    !v.entry ||
    v.entry.includes('\\') ||
    v.entry.includes('\0') ||
    path.isAbsolute(v.entry) ||
    v.entry
      .split('/')
      .some(
        (p) => !p || p === '.' || p === '..' || !/^[A-Za-z0-9_.-]+$/.test(p),
      ) ||
    !(v.runtime === 'python'
      ? v.entry.endsWith('.py')
      : /\.(?:js|cjs)$/.test(v.entry)) ||
    !Array.isArray(v.args) ||
    v.args.length > 32 ||
    v.args.some(
      (a) =>
        typeof a !== 'string' ||
        a.length > 1024 ||
        a.includes('\0') ||
        /[\r\n]/.test(a),
    )
  )
    throw new Error('invalid_launch');
  return {
    version: v.version as 1 | 2,
    ...(v.version === 2 ? { consoleScript: 'agent' as const } : {}),
    ready: v.ready as boolean,
    runtime: v.runtime as Launch['runtime'],
    entry: v.entry,
    args: [...v.args] as string[],
  };
}
/** Linux descriptor-anchored bounded reads; process execution remains pathname based. */
async function read(
  directory: string,
  relative: string,
  limit: number,
): Promise<Buffer> {
  if (process.platform !== 'linux' || !path.isAbsolute(directory))
    throw new Error('unsupported_host');
  const parts = path.join(directory, relative).split('/').filter(Boolean);
  if (parts.some((p) => p === '.' || p === '..'))
    throw new Error('unsafe_path');
  let parent = await open('/', constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    for (const part of parts.slice(0, -1)) {
      const next = await open(
        '/proc/self/fd/' + parent.fd + '/' + part,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      await parent.close();
      parent = next;
    }
    const handle = await open(
      '/proc/self/fd/' + parent.fd + '/' + parts.at(-1),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.nlink !== 1 || before.size > limit)
        throw new Error('unsafe_file');
      const bytes = Buffer.alloc(limit + 1);
      let size = 0;
      while (size < bytes.length) {
        const result = await handle.read(
          bytes,
          size,
          bytes.length - size,
          null,
        );
        if (!result.bytesRead) break;
        size += result.bytesRead;
      }
      const after = await handle.stat();
      if (
        size !== before.size ||
        size > limit ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs
      )
        throw new Error('changed_file');
      return bytes.subarray(0, size);
    } finally {
      await handle.close();
    }
  } finally {
    await parent.close();
  }
}
async function prepare(directory: string): Promise<Prepared> {
  const config = await read(directory, CONFIG, 16384);
  const launch = parseLocalLaunch(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(config)),
    false,
  );
  const hash = createHash('sha256').update(config);
  for (const marker of [
    'agent.authoring.json',
    'agent.creation.json',
    'agent.json',
  ]) {
    try {
      await lstat(path.join(directory, marker));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    const bytes = await read(directory, marker, 65536);
    const authoring = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    );
    if (
      !authoring ||
      typeof authoring !== 'object' ||
      Array.isArray(authoring) ||
      authoring.incomplete === true
    )
      throw new Error('authoring_incomplete');
    hash.update(marker).update(bytes);
  }
  if (!launch.ready) throw new Error('integration_required');
  hash.update(await read(directory, launch.entry, LIMIT));
  let executable = launch.runtime === 'python' ? 'python3' : 'node';
  if (launch.runtime === 'python') {
    let project = false;
    try {
      const manifest = await read(directory, 'pyproject.toml', 65536);
      if (launch.consoleScript) {
        hash.update(manifest);
        const parsed = TOML.parse(manifest.toString('utf8')) as {
          project?: { scripts?: { agent?: string } };
        };
        if (
          parsed.project?.scripts?.agent !== 'agent_app.agent:main' ||
          launch.entry !== 'src/agent_app/agent.py'
        )
          throw new Error('invalid_console_entry');
      }
      project = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (project) {
      try {
        for (const folder of ['.venv', '.venv/bin']) {
          const info = await lstat(path.join(directory, folder));
          if (!info.isDirectory() || info.isSymbolicLink())
            throw new Error('unsafe_env');
        }
        executable = path.join(directory, '.venv/bin/python');
        const resolved = await realpath(executable);
        const info = await stat(resolved);
        if (!info.isFile() || !(info.mode & 0o111))
          throw new Error('unsafe_env');
        hash.update(
          JSON.stringify([
            executable,
            resolved,
            info.dev,
            info.ino,
            info.size,
            info.mtimeMs,
          ]),
        );
      } catch {
        throw new Error('environment_required');
      }
    }
  }
  if (launch.consoleScript) {
    if (executable === 'python3') throw new Error('environment_required');
    // Execute the installed entry, never uv run here (which could install on launch).
    executable = path.join(directory, '.venv/bin/agent');
    const info = await lstat(executable);
    if (!info.isFile() || info.isSymbolicLink() || !(info.mode & 0o111))
      throw new Error('console_entry_required');
    hash.update(await read(directory, '.venv/bin/agent', 65536));
  }
  return { launch, executable, digest: hash.digest('hex') };
}
export class LocalAgentRunner implements vscode.Disposable {
  private disposed = false;
  private runs = new Map<string, OwnedRun>();
  private pending = new Set<string>();
  private output = vscode.window.createOutputChannel(
    'Scaleway · exécutions locales',
  );
  private listeners: vscode.Disposable[];
  constructor(private changed: () => void) {
    this.listeners = [
      vscode.tasks.onDidStartTaskProcess((event) => {
        const run = this.find(event.execution);
        if (!run) return;
        run.state = 'En cours';
        this.output.appendLine(run.name + ' : processus démarré.');
        this.changed();
      }),
      vscode.tasks.onDidEndTaskProcess((event) => {
        const run = this.find(event.execution);
        if (!run) return;
        run.state =
          event.exitCode === 0
            ? 'Terminé (code 0)'
            : event.exitCode === undefined
              ? 'Fin du processus — résultat inconnu'
              : 'Échec (code ' + event.exitCode + ')';
        this.output.appendLine(run.name + ' : ' + run.state);
        this.changed();
      }),
      vscode.tasks.onDidEndTask((event) => {
        const run = this.find(event.execution);
        if (!run) return;
        run.active = false;
        run.execution = undefined;
        run.task = undefined;
        if (['Démarrage', 'En cours', 'Arrêt demandé'].includes(run.state))
          run.state = 'Tâche terminée — résultat inconnu';
        this.pending.delete(run.directory);
        this.changed();
      }),
    ];
  }
  private find(execution: vscode.TaskExecution): OwnedRun | undefined {
    if (this.disposed) return;
    const run = this.runs.get(execution.task.definition.localRunId);
    if (
      run &&
      ((run.execution === undefined && run.task === execution.task) ||
        run.execution === execution) &&
      run.active
    )
      return run;
  }
  isBusy(directory: string): boolean {
    return [
      ...this.pending,
      ...[...this.runs.values()]
        .filter((run) => run.active)
        .map((run) => run.directory),
    ].some((target) => {
      const relative = path.relative(directory, target);
      return (
        relative === '' ||
        (relative !== '..' &&
          !relative.startsWith(`..${path.sep}`) &&
          !path.isAbsolute(relative))
      );
    });
  }
  list(): LocalRun[] {
    return [...this.runs.values()].map(({ id, name, state, active }) => ({
      id,
      name,
      state,
      active,
    }));
  }
  async readiness(directory: string): Promise<string> {
    if (this.disposed) return 'Indisponible';
    try {
      await prepare(directory);
      return 'Lancement configuré — effets non vérifiés';
    } catch (error) {
      if (error instanceof Error && error.message === 'environment_required')
        return 'Configuration requise — préparez le .venv du projet avec uv sync';
      if (
        error instanceof Error &&
        ['authoring_incomplete', 'integration_required'].includes(error.message)
      )
        return 'Intégration requise — commande déjà définie';
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        try {
          await read(directory, CONFIG, 16384);
          return 'Point d’entrée absent — compilation ou installation à vérifier';
        } catch {}
      }
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return 'Configuration requise';
      return 'Configuration invalide ou inaccessible';
    }
  }
  /** Display only known authoring fields; never notes, endpoints, credentials or arbitrary JSON. */
  async projectInfo(directory: string): Promise<[string, string][]> {
    for (const marker of ['agent.authoring.json', 'agent.creation.json']) {
      try {
        const bytes = await read(directory, marker, 65536);
        const value = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(bytes),
        );
        if (!value || typeof value !== 'object' || Array.isArray(value))
          return [];
        const fields: [string, unknown][] = [
          ['Langage', value.language],
          ['Backend', value.backend],
          ['Framework IA', value.ai_framework],
          ['Template', value.template_id],
          [
            'Modèle',
            value.selected_model?.model_id ??
              value.selected_deployment?.model_id,
          ],
          [
            'Service',
            value.selected_model?.kind === 'serverless'
              ? 'Serverless'
              : value.selected_deployment?.kind === 'dedicated'
                ? 'Dédié'
                : undefined,
          ],
        ];
        return fields.filter(
          (pair): pair is [string, string] =>
            typeof pair[1] === 'string' &&
            /^[A-Za-z0-9][A-Za-z0-9_. /-]{0,127}$/.test(pair[1]) &&
            !/^(?:sk-|gh[pousr]_|github_pat_|AKIA)/.test(pair[1]),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return [];
      }
    }
    return [];
  }
  /** Read-only navigation: ready/incomplete do not prevent editing the entry. */
  async openEntry(
    directory: string,
    current: () => boolean,
    revalidate: () => Promise<void> = async () => {},
  ): Promise<void> {
    await openLocalAgentEntry(
      directory,
      () => !this.disposed && current(),
      revalidate,
    );
  }
  async configure(directory: string, current: () => boolean): Promise<void> {
    if (!current() || this.disposed || !vscode.workspace.isTrusted) return;
    try {
      await read(directory, CONFIG, 16384);
      if (!current() || this.disposed || !vscode.workspace.isTrusted) return;
      const document = await vscode.workspace.openTextDocument(
        vscode.Uri.file(path.join(directory, CONFIG)),
      );
      if (!current() || this.disposed || !vscode.workspace.isTrusted) return;
      await vscode.window.showTextDocument(document);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const content = JSON.stringify(
      {
        version: 1,
        ready: false,
        runtime: 'python',
        entry: 'src/agent_app/agent.py',
        args: [],
      },
      null,
      2,
    );
    const document = await vscode.workspace.openTextDocument({
      language: 'json',
      content,
    });
    if (!current() || this.disposed || !vscode.workspace.isTrusted) return;
    await vscode.window.showTextDocument(document);
    if (!current() || this.disposed || !vscode.workspace.isTrusted) return;
    await vscode.window.showInformationMessage(
      'Brouillon non enregistré. Enregistrez volontairement dans ' +
        path.join(directory, CONFIG) +
        '. Configurez le runtime, le point d’entrée et ready:true après vérification. Un agent incomplete:true reste bloqué ; modifier ce champ ne réalise pas son intégration.',
    );
  }
  async start(
    directory: string,
    name: string,
    current: () => boolean,
  ): Promise<void> {
    directory = path.resolve(directory);
    if (
      this.disposed ||
      !current() ||
      !vscode.workspace.isTrusted ||
      this.pending.has(directory) ||
      [...this.runs.values()].some((r) => r.directory === directory && r.active)
    )
      return;
    if (this.pending.size >= 8) throw new Error('run_limit');
    this.pending.add(directory);
    let run: OwnedRun | undefined;
    try {
      const first = await prepare(directory);
      if (!current() || this.disposed || !vscode.workspace.isTrusted) return;
      const executable = first.executable;
      const args = first.launch.consoleScript
        ? [...first.launch.args]
        : [path.join(directory, first.launch.entry), ...first.launch.args];
      const accepted = await vscode.window.showWarningMessage(
        'Exécuter cet agent local ?',
        {
          modal: true,
          detail:
            JSON.stringify([executable, ...args]) +
            '\nDossier : ' +
            directory +
            '\nCode local NON sandboxé : fichiers, réseau, variables d’environnement et .env possibles ; appels LLM potentiellement payants. Aucun contrôle global des effets du programme. Aucune installation ni téléchargement de container par l’extension. Arrêter ne garantit pas l’arrêt de tous les processus enfants. Vérifiez le code et la configuration.',
        },
        'Exécuter',
      );
      if (
        accepted !== 'Exécuter' ||
        !current() ||
        this.disposed ||
        !vscode.workspace.isTrusted
      )
        return;
      const second = await prepare(directory);
      if (
        first.digest !== second.digest ||
        !current() ||
        this.disposed ||
        !vscode.workspace.isTrusted
      )
        throw new Error('changed_launch');
      while (this.runs.size >= 32) {
        const old = [...this.runs.values()].find((r) => !r.active);
        if (!old) break;
        this.runs.delete(old.id);
      }
      run = {
        id: randomBytes(16).toString('hex'),
        name,
        directory,
        state: 'Démarrage',
        active: true,
      };
      this.runs.set(run.id, run);
      this.changed();
      const task = new vscode.Task(
        { type: 'scaleway-local-agent', localRunId: run.id },
        vscode.TaskScope.Workspace,
        'Agent local · ' + name,
        'Scaleway AI',
        new vscode.ProcessExecution(executable, args, { cwd: directory }),
      );
      task.presentationOptions = {
        reveal: vscode.TaskRevealKind.Always,
        panel: vscode.TaskPanelKind.Dedicated,
        clear: false,
      };
      run.task = task;
      this.output.appendLine(
        name +
          ' : lancement confirmé. Sortie du programme dans le terminal de tâche VS Code.',
      );
      const execution = await vscode.tasks.executeTask(task);
      if (run.active) run.execution = execution;
      if (
        this.disposed ||
        !current() ||
        !vscode.workspace.isTrusted ||
        run.stopRequested
      ) {
        execution.terminate();
        run.state = 'Arrêt demandé';
        this.changed();
        return;
      }
      this.changed();
    } catch {
      if (run) {
        run.active = false;
        run.state = 'Lancement échoué';
        run.execution = undefined;
        this.changed();
      }
      if (!this.disposed && current())
        await vscode.window.showWarningMessage(
          'Lancement refusé ou échoué : configuration incomplète, fichier modifié, runtime indisponible ou contexte changé. Aucun diagnostic sensible affiché.',
        );
    } finally {
      if (!run?.active) this.pending.delete(directory);
    }
  }
  stop(id: string): void {
    const run = this.runs.get(id);
    if (this.disposed || !run?.active) return;
    run.stopRequested = true;
    run.execution?.terminate();
    run.state = 'Arrêt demandé';
    this.output.appendLine(
      run.name + ' : arrêt demandé (confirmation de fin attendue).',
    );
    this.changed();
  }
  logs(id: string): void {
    if (!this.disposed && this.runs.has(id)) this.output.show(true);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const run of this.runs.values()) {
      try {
        run.execution?.terminate();
      } catch {}
    }
    for (const listener of this.listeners) listener.dispose();
    this.runs.clear();
    this.pending.clear();
    this.output.dispose();
    this.changed = () => {};
  }
}

export async function openLocalAgentEntry(
  directory: string,
  current: () => boolean,
  revalidate: () => Promise<void> = async () => {},
): Promise<boolean> {
  if (!current() || !vscode.workspace.isTrusted) return false;
  const resolve = async () => {
    let service: Buffer | undefined;
    try {
      service = await read(directory, 'service.authoring.json', 16384);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (service) {
      const note = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(service),
      );
      if (
        note?.version !== 1 ||
        ![
          'app/page.tsx',
          'src/agent_app/service_api.py',
          'src/service-api.ts',
        ].includes(note.main_source)
      )
        throw new Error('invalid_service_entry');
      const bytes = await read(directory, note.main_source, LIMIT);
      return {
        entry: note.main_source,
        digest: createHash('sha256')
          .update(service)
          .update(bytes)
          .digest('hex'),
      };
    }
    let config: Buffer | undefined;
    try {
      config = await read(directory, CONFIG, 16384);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (config) {
      const launch = parseLocalLaunch(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(config)),
        false,
      );
      const bytes = await read(directory, launch.entry, LIMIT);
      return {
        entry: launch.entry,
        digest: createHash('sha256').update(config).update(bytes).digest('hex'),
      };
    }
    for (const entry of [
      'scaleway_agent.py',
      'scaleway_agent.cjs',
      'src/agent_app/agent.py',
      'agent.py',
      'src/agent.ts',
      'src/agent.js',
      'src/main.rs',
    ]) {
      try {
        const bytes = await read(directory, entry, LIMIT);
        return {
          entry,
          digest: createHash('sha256').update(bytes).digest('hex'),
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    throw new Error('entry_missing');
  };
  try {
    const first = await resolve();
    if (!current() || !vscode.workspace.isTrusted) return false;
    const uri = vscode.Uri.file(path.join(directory, first.entry));
    const document = await vscode.workspace.openTextDocument(uri);
    if (
      !current() ||
      !vscode.workspace.isTrusted ||
      document.isClosed ||
      document.uri?.fsPath !== uri.fsPath
    )
      return false;
    await revalidate();
    const second = await resolve();
    if (
      first.entry !== second.entry ||
      first.digest !== second.digest ||
      !current() ||
      !vscode.workspace.isTrusted
    )
      return false;
    await vscode.window.showTextDocument(document, { preview: false });
    return true;
  } catch {
    if (current() && vscode.workspace.isTrusted)
      await vscode.window.showWarningMessage(
        'Point d’entrée absent, invalide ou modifié. Vérifiez Configuration et les fichiers du projet.',
      );
  }
  return false;
}
