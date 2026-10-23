import { randomUUID } from 'node:crypto';
import { lstat, stat } from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { installCommand } from './projectGenerator';
import { openLocalAgentEntry } from './localAgentRunner';
import type { TemplateDefinition } from './templateLibrary';
/** Fixed executable/argv in a visible task. Templates cannot supply commands.
 * Package installation may execute dependency build scripts, with separate consent. */
export async function offerProjectActions(
  project: string,
  template: TemplateDefinition,
  current: () => boolean,
  dependenciesPrepared = false,
): Promise<void> {
  if (!current() || !vscode.workspace.isTrusted) return;
  const command = installCommand(template);
  const choice = await vscode.window.showInformationMessage(
    'Projet créé. Que souhaitez-vous faire ?',
    'Ajouter au workspace actuel',
    'Ouvrir le projet',
    'Voir dans les ressources locales',
    ...(command && !dependenciesPrepared ? ['Installer les dépendances'] : []),
  );
  if (!current() || !vscode.workspace.isTrusted) return;
  if (choice === 'Ouvrir le projet') {
    await vscode.commands.executeCommand(
      'vscode.openFolder',
      vscode.Uri.file(project),
      { forceNewWindow: true },
    );
    return;
  }
  if (choice === 'Voir dans les ressources locales') {
    const contained =
      path.isAbsolute(project) &&
      (vscode.workspace.workspaceFolders ?? []).some((folder) => {
        if (folder.uri.scheme !== 'file') return false;
        const relative = path.relative(folder.uri.fsPath, project);
        return (
          relative !== '..' &&
          !relative.startsWith(`..${path.sep}`) &&
          !path.isAbsolute(relative)
        );
      });
    if (!contained) {
      await vscode.window.showInformationMessage(
        'Ajoutez d’abord ce projet au workspace actuel pour le retrouver dans les ressources locales.',
      );
      return;
    }
    const directory = await lstat(project);
    if (!directory.isDirectory() || directory.isSymbolicLink())
      throw new Error('invalid_project');
    if (!current() || !vscode.workspace.isTrusted) return;
    await vscode.commands.executeCommand(
      template.kind === 'agents'
        ? 'scalewayAI.openLocalAgents'
        : 'scalewayAI.openLocalTools',
    );
    return;
  }
  if (choice === 'Ajouter au workspace actuel') {
    if (!path.isAbsolute(project)) throw new Error('invalid_project');
    const directory = await lstat(project);
    if (!directory.isDirectory() || directory.isSymbolicLink())
      throw new Error('invalid_project');
    if (!current() || !vscode.workspace.isTrusted) return;
    const uri = vscode.Uri.file(project);
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (
      folders.some(
        (folder) =>
          folder.uri.scheme === 'file' &&
          path.resolve(folder.uri.fsPath) === path.resolve(project),
      )
    ) {
      await vscode.window.showInformationMessage(
        'Ce projet est déjà un dossier du workspace.',
      );
      return;
    }
    // This call can reload the extension host when adding its first root.
    // Do not retain a parent registry or await any work after successful update.
    const updated = vscode.workspace.updateWorkspaceFolders(folders.length, 0, {
      uri,
      name: path.basename(project),
    });
    if (!updated && current() && vscode.workspace.isTrusted)
      await vscode.window.showWarningMessage(
        'VS Code n’a pas accepté l’ajout au workspace. Vous pouvez ouvrir le projet dans une nouvelle fenêtre.',
      );
    return;
  }
  if (choice !== 'Installer les dépendances' || !command) return;
  const accepted = await vscode.window.showWarningMessage(
    'Installer les dépendances du projet ?',
    {
      modal: true,
      detail: `${command.executable} ${command.args.join(' ')} dans ${project}\nTéléchargements réseau et scripts de dépendances possibles. Aucun agent ne sera lancé. Vérifiez le manifeste avant de confirmer.`,
    },
    'Installer',
  );
  if (accepted !== 'Installer' || !current() || !vscode.workspace.isTrusted)
    return;
  if (!path.isAbsolute(project) || (await lstat(project)).isSymbolicLink())
    throw new Error('invalid_project');
  const manifest =
    template.project?.language === 'python'
      ? 'pyproject.toml'
      : template.project?.language === 'rust'
        ? 'Cargo.toml'
        : 'package.json';
  const file = await lstat(path.join(project, manifest));
  if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1)
    throw new Error('invalid_manifest');
  if (!current() || !vscode.workspace.isTrusted) return;
  const task = new vscode.Task(
    { type: 'scaleway-project-dependencies' },
    vscode.TaskScope.Workspace,
    `Installer dépendances · ${path.basename(project)}`,
    'Scaleway AI',
    new vscode.ProcessExecution(command.executable, command.args, {
      cwd: project,
    }),
  );
  task.presentationOptions = { reveal: vscode.TaskRevealKind.Always };
  await vscode.tasks.executeTask(task);
}

/** Called only for freshly generated host-owned agents, never personal projects. */
export async function prepareCreatedAgentProject(
  project: string,
  template: TemplateDefinition,
  current: () => boolean,
): Promise<boolean> {
  if (template.kind !== 'agents' || template.version !== 2 || !template.project)
    return true;
  if (!current() || !vscode.workspace.isTrusted) return false;
  const command = installCommand(template);
  if (!command || !template.project) return false;
  const language = template.project.language;
  const label = { python: 'Python', typescript: 'TypeScript', rust: 'Rust' }[
    language
  ];
  const steps =
    language === 'python'
      ? [{ executable: 'uv', args: ['sync'] }]
      : language === 'typescript'
        ? [
            { executable: 'bun', args: ['install'] },
            { executable: 'bun', args: ['run', 'build'] },
          ]
        : [{ executable: 'cargo', args: ['build', '--all-targets'] }];
  try {
    if (!path.isAbsolute(project)) throw new Error('invalid_project');
    const directory = await lstat(project);
    const manifest = await lstat(
      path.join(
        project,
        language === 'python'
          ? 'pyproject.toml'
          : language === 'typescript'
            ? 'package.json'
            : 'Cargo.toml',
      ),
    );
    if (
      !directory.isDirectory() ||
      directory.isSymbolicLink() ||
      !manifest.isFile() ||
      manifest.isSymbolicLink() ||
      manifest.nlink !== 1
    )
      throw new Error('invalid_project');
    if (!current() || !vscode.workspace.isTrusted) return false;
    for (const step of steps) {
      if (!current() || !vscode.workspace.isTrusted) return false;
      const preparationId = randomUUID();
      const task = new vscode.Task(
        { type: 'scaleway-project-dependencies', preparationId },
        vscode.TaskScope.Workspace,
        'Préparer ' + label + ' · ' + path.basename(project),
        'Scaleway AI',
        new vscode.ProcessExecution(step.executable, step.args, {
          cwd: project,
        }),
      );
      task.presentationOptions = { reveal: vscode.TaskRevealKind.Silent };
      const success = await new Promise<boolean>((resolve, reject) => {
        const subscriptions: vscode.Disposable[] = [];
        const finish = (ok: boolean) => {
          for (const subscription of subscriptions) subscription.dispose();
          resolve(ok);
        };
        subscriptions.push(
          vscode.tasks.onDidEndTaskProcess((event) => {
            if (event.execution.task.definition.preparationId === preparationId)
              finish(event.exitCode === 0);
          }),
        );
        subscriptions.push(
          vscode.tasks.onDidEndTask((event) => {
            if (event.execution.task.definition.preparationId === preparationId)
              finish(false);
          }),
        );
        Promise.resolve(vscode.tasks.executeTask(task)).catch((error) => {
          for (const subscription of subscriptions) subscription.dispose();
          reject(error);
        });
      });
      if (!success) throw new Error('preparation_failed');
    }
    return current() && vscode.workspace.isTrusted;
  } catch {
    if (current() && vscode.workspace.isTrusted)
      await vscode.window.showWarningMessage(
        'Projet créé, mais la préparation ' +
          label +
          ' a échoué. Vérifiez les outils installés, puis relancez : ' +
          steps
            .map((step) => [step.executable, ...step.args].join(' '))
            .join(' puis ') +
          '. Les fichiers sont conservés.',
      );
    return false;
  }
}

const PYTHON_IDE_PENDING = 'scalewayAI.pendingPythonIdeProject';
const pythonIdeResumers = new WeakMap<vscode.ExtensionContext, () => void>();
/** Resume only an explicitly queued newly-created project, never scan/migrate existing roots. */
export function initializePythonIde(context: vscode.ExtensionContext): void {
  const existing = pythonIdeResumers.get(context);
  if (existing) {
    existing();
    return;
  }
  let busy = false;
  const resume = async () => {
    if (busy || !vscode.workspace.isTrusted) return;
    const project = context.workspaceState.get<string>(PYTHON_IDE_PENDING);
    if (!project || !path.isAbsolute(project)) return;
    const exactRoot = () =>
      vscode.workspace.isTrusted &&
      (vscode.workspace.workspaceFolders ?? []).some(
        (folder) =>
          folder.uri.scheme === 'file' &&
          path.resolve(folder.uri.fsPath) === path.resolve(project),
      );
    if (!exactRoot()) return;
    busy = true;
    try {
      const directory = await lstat(project);
      const env = await lstat(path.join(project, '.venv'));
      const bin = await lstat(path.join(project, '.venv/bin'));
      const executable = path.join(project, '.venv/bin/python');
      const interpreter = await stat(executable);
      if (
        !directory.isDirectory() ||
        directory.isSymbolicLink() ||
        !env.isDirectory() ||
        env.isSymbolicLink() ||
        !bin.isDirectory() ||
        bin.isSymbolicLink() ||
        !interpreter.isFile() ||
        !(interpreter.mode & 0o111)
      )
        throw new Error('invalid_environment');
      const extension = vscode.extensions.getExtension('ms-python.python');
      if (!extension) {
        await vscode.window.showWarningMessage(
          'Projet préparé, mais l’extension Python manque pour sélectionner automatiquement le .venv. Installez l’extension Python recommandée.',
        );
        return;
      }
      const api = (await extension.activate()) as {
        environments?: {
          getActiveEnvironmentPath?: (resource: vscode.Uri) => { path: string };
          updateActiveEnvironmentPath?: (
            environment: string,
            resource: vscode.Uri,
          ) => Thenable<void>;
        };
      };
      if (
        !exactRoot() ||
        context.workspaceState.get<string>(PYTHON_IDE_PENDING) !== project
      )
        return;
      const stillPending = () =>
        exactRoot() &&
        context.workspaceState.get<string>(PYTHON_IDE_PENDING) === project;
      // A folder-only legacy setting may be routed to the parent by Python Environments.
      // Use its project-aware public API when installed; never silently fall back on failure.
      const resource = vscode.Uri.file(path.join(project, 'pyproject.toml'));
      const projectUri = vscode.Uri.file(project);
      const environmentsExtension = vscode.extensions.getExtension(
        'ms-python.vscode-python-envs',
      );
      let selected = false;
      if (environmentsExtension) {
        type Environment = {
          envId: { id: string; managerId: string };
          sysPrefix: string;
          execInfo: { run: { executable: string } };
        };
        type PythonProject = { name: string; uri: vscode.Uri };
        const projectsApi = (await environmentsExtension.activate()) as {
          getPythonProject: (uri: vscode.Uri) => PythonProject | undefined;
          addPythonProject: (project: PythonProject) => void;
          resolveEnvironment: (uri: vscode.Uri) => Promise<Environment | undefined>;
          setEnvironment: (uri: vscode.Uri, env: Environment) => Promise<void>;
          getEnvironment: (uri: vscode.Uri) => Promise<Environment | undefined>;
        };
        if (!stillPending()) return;
        if (
          !projectsApi.getPythonProject || !projectsApi.addPythonProject ||
          !projectsApi.resolveEnvironment || !projectsApi.setEnvironment ||
          !projectsApi.getEnvironment
        ) throw new Error('python_projects_api_unavailable');
        const ownsChild = () =>
          projectsApi.getPythonProject(resource)?.uri.fsPath === project &&
          projectsApi.getPythonProject(projectUri)?.uri.fsPath === project;
        if (!ownsChild())
          projectsApi.addPythonProject({ name: path.basename(project), uri: projectUri });
        if (!stillPending() || !ownsChild()) return;
        const resolved = await projectsApi.resolveEnvironment(vscode.Uri.file(executable));
        const isLocal = (value: Environment | undefined) =>
          value?.execInfo?.run?.executable === executable &&
          value.sysPrefix === path.join(project, '.venv') &&
          !!value.envId?.id && !!value.envId.managerId;
        if (!stillPending() || !ownsChild()) return;
        if (!isLocal(resolved) || !resolved) throw new Error('python_environment_unresolved');
        await projectsApi.setEnvironment(projectUri, resolved);
        for (let attempt = 0; attempt < 40 && stillPending() && ownsChild(); attempt++) {
          const folderEnv = await projectsApi.getEnvironment(projectUri);
          const fileEnv = await projectsApi.getEnvironment(resource);
          if (
            isLocal(folderEnv) && isLocal(fileEnv) &&
            folderEnv?.envId.id === resolved.envId.id &&
            folderEnv.envId.managerId === resolved.envId.managerId &&
            fileEnv?.envId.id === resolved.envId.id &&
            fileEnv.envId.managerId === resolved.envId.managerId
          ) { selected = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (!ownsChild()) return;
      } else {
        if (
          !api.environments?.updateActiveEnvironmentPath ||
          !api.environments.getActiveEnvironmentPath
        ) throw new Error('python_api_unavailable');
        await api.environments.updateActiveEnvironmentPath(executable, resource);
        for (let attempt = 0; attempt < 40 && stillPending(); attempt++) {
          if (api.environments.getActiveEnvironmentPath(resource).path === executable) {
            selected = true; break;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      if (!stillPending()) return;
      if (!selected) throw new Error('python_selection_unconfirmed');
      await openLocalAgentEntry(project, stillPending);
      if (context.workspaceState.get<string>(PYTHON_IDE_PENDING) === project)
        await context.workspaceState.update(PYTHON_IDE_PENDING, undefined);
    } catch {
      await vscode.window.showWarningMessage(
        'Projet préparé, mais la sélection automatique du .venv par VS Code a échoué. Sélectionnez l’interpréteur du projet via Python: Select Interpreter.',
      );
    } finally {
      busy = false;
    }
  };
  const safelyResume = () => {
    void resume().catch(() => {});
  };
  pythonIdeResumers.set(context, safelyResume);
  context.subscriptions.push({
    dispose: () => pythonIdeResumers.delete(context),
  });
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(safelyResume),
  );
  context.subscriptions.push(
    vscode.workspace.onDidGrantWorkspaceTrust(safelyResume),
  );
  context.subscriptions.push(vscode.extensions.onDidChange(safelyResume));
  safelyResume();
}
/** After successful uv sync, queue selection before root addition (which can reload the host). */
export async function configureCreatedPythonIde(
  project: string,
  context: vscode.ExtensionContext,
  current: () => boolean,
): Promise<boolean> {
  if (!current() || !vscode.workspace.isTrusted || !path.isAbsolute(project))
    return false;
  initializePythonIde(context);
  await context.workspaceState.update(PYTHON_IDE_PENDING, project);
  if (!current() || !vscode.workspace.isTrusted) {
    await context.workspaceState.update(PYTHON_IDE_PENDING, undefined);
    return false;
  }
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (
    !folders.some(
      (folder) =>
        folder.uri.scheme === 'file' &&
        path.resolve(folder.uri.fsPath) === path.resolve(project),
    )
  ) {
    const updated = vscode.workspace.updateWorkspaceFolders(folders.length, 0, {
      uri: vscode.Uri.file(project),
      name: path.basename(project),
    });
    if (!updated) {
      await context.workspaceState.update(PYTHON_IDE_PENDING, undefined);
      await vscode.window.showWarningMessage(
        'Environnement Python préparé, mais VS Code a refusé l’ajout du projet au workspace. Ouvrez ce dossier pour activer sa configuration Python.',
      );
      return false;
    }
  } else initializePythonIde(context);
  return true;
}

type CompiledIdeProject = { project: string; language: 'typescript' | 'rust' };
const COMPILED_IDE_PENDING = 'scalewayAI.pendingCompiledIdeProject';
const compiledIdeResumers = new WeakMap<vscode.ExtensionContext, () => void>();
/** Resume only explicitly queued new projects. Activation is not analyzer readiness proof. */
export function initializeCompiledIde(context: vscode.ExtensionContext): void {
  const existing = compiledIdeResumers.get(context);
  if (existing) { existing(); return; }
  let busy = false;
  const resume = async () => {
    if (busy || !vscode.workspace.isTrusted) return;
    const pending = context.workspaceState.get<CompiledIdeProject>(COMPILED_IDE_PENDING);
    if (!pending || !path.isAbsolute(pending.project) || !['typescript', 'rust'].includes(pending.language)) return;
    const { project, language } = pending;
    const current = () => {
      const value = context.workspaceState.get<CompiledIdeProject>(COMPILED_IDE_PENDING);
      return vscode.workspace.isTrusted && value?.project === project && value.language === language &&
        (vscode.workspace.workspaceFolders ?? []).some(f => f.uri.scheme === 'file' && path.resolve(f.uri.fsPath) === project);
    };
    if (!current()) return;
    busy = true;
    try {
      const root = await lstat(project);
      if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('invalid_project');
      const file = async (relative: string) => {
        const info = await lstat(path.join(project, relative));
        if (!info.isFile() || info.isSymbolicLink()) throw new Error('invalid_project_file');
      };
      const resource = vscode.Uri.file(path.join(project, language === 'typescript' ? 'tsconfig.json' : 'Cargo.toml'));
      await file(language === 'typescript' ? 'tsconfig.json' : 'Cargo.toml');
      if (language === 'typescript') {
        await file('node_modules/typescript/lib/tsserver.js');
        await file('node_modules/typescript/lib/tsc.js');
        const sdk = vscode.workspace.getConfiguration('typescript', resource).get<string>('tsdk');
        if (sdk !== 'node_modules/typescript/lib') throw new Error('unexpected_tsdk');
      } else {
        const linked = vscode.workspace.getConfiguration('rust-analyzer', resource).get<string[]>('linkedProjects');
        if (!Array.isArray(linked) || !linked.includes('./Cargo.toml')) throw new Error('unexpected_cargo_project');
      }
      if (!current()) return;
      const extension = vscode.extensions.getExtension(language === 'typescript' ? 'vscode.typescript-language-features' : 'rust-lang.rust-analyzer');
      if (extension) await extension.activate();
      if (!current()) return;
      await openLocalAgentEntry(project, current);
      if (!current()) return;
      await context.workspaceState.update(COMPILED_IDE_PENDING, undefined);
      if (!extension) await vscode.window.showWarningMessage(
        language === 'rust' ? 'Projet Rust préparé et ajouté au workspace. rust-analyzer manque : installez l’extension recommandée pour l’analyse IDE.' : 'Projet TypeScript préparé et ajouté au workspace. L’extension TypeScript de VS Code est indisponible.',
      );
    } catch {
      if (current()) await vscode.window.showWarningMessage('Projet créé, mais la préparation IDE ' + language + ' n’a pas pu être confirmée. Vérifiez la configuration locale et les extensions du langage. Les fichiers sont conservés.');
    } finally { busy = false; }
  };
  const safelyResume = () => { void resume().catch(() => {}); };
  compiledIdeResumers.set(context, safelyResume);
  context.subscriptions.push({ dispose: () => compiledIdeResumers.delete(context) });
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(safelyResume));
  context.subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(safelyResume));
  context.subscriptions.push(vscode.extensions.onDidChange(safelyResume));
  safelyResume();
}
export async function configureCreatedCompiledIde(
  project: string, language: 'typescript' | 'rust', context: vscode.ExtensionContext, current: () => boolean,
): Promise<boolean> {
  if (!current() || !vscode.workspace.isTrusted || !path.isAbsolute(project)) return false;
  project = path.resolve(project);
  initializeCompiledIde(context);
  await context.workspaceState.update(COMPILED_IDE_PENDING, { project, language });
  if (!current() || !vscode.workspace.isTrusted) {
    await context.workspaceState.update(COMPILED_IDE_PENDING, undefined); return false;
  }
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (!folders.some(f => f.uri.scheme === 'file' && path.resolve(f.uri.fsPath) === project)) {
    if (!vscode.workspace.updateWorkspaceFolders(folders.length, 0, { uri: vscode.Uri.file(project), name: path.basename(project) })) {
      await context.workspaceState.update(COMPILED_IDE_PENDING, undefined);
      await vscode.window.showWarningMessage('Projet préparé, mais VS Code a refusé son ajout au workspace. Ouvrez ce dossier pour activer sa configuration locale.');
      return false;
    }
  } else initializeCompiledIde(context);
  return true;
}
