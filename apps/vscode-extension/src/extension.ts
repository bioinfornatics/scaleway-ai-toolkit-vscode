import * as vscode from 'vscode';
import { catalogHtml, parseCatalogInput } from './catalog';
import { catalogDetails } from './catalogDetails';
import { CatalogHealth } from './catalogHealth';
import { visibleCatalogModels } from './catalogVisibility';
import { Connection } from './connection';
import { dedicatedConsent } from './dedicatedConsent';
import { dedicatedInvocationPolicy } from './dedicatedInvocationPolicy';
import { type DemoModel, type Experiment, models, runDemo } from './demo';
import { DeployedResources } from './deployedResources';
import {
  exportExperiment,
  loadExperiment,
  saveExperiment,
} from './experimentActions';
import { parseInput } from './ipc';
import { LocalCreation } from './localCreation';
import { LocalInventory } from './localInventory';
import { initializeCompiledIde, initializePythonIde } from './projectActions';
import type { ListedModel } from './provider';
import { serverlessInvocation } from './provider';
import { modelsOverviewHtml, parseOverviewInput } from './resourceOverview';
import { ServicePlayground } from './servicePlayground';
import { servicePlaygroundHtml } from './servicePlaygroundView';
import { playgroundHtml } from './webview';

interface Node {
  id: string;
  label: string;
  icon?: string;
  command?: string;
  args?: unknown[];
  children?: Node[];
  description?: string;
}
export function activate(context: vscode.ExtensionContext): void {
  initializePythonIde(context);
  initializeCompiledIde(context);
  let selected: DemoModel = models[0];
  let last: Experiment | undefined;
  let active: { cancelled: boolean } | undefined;
  let panel: vscode.WebviewPanel | undefined;
  let catalogPanel: vscode.WebviewPanel | undefined;
  let modelsPanel: vscode.WebviewPanel | undefined;
  let overviewToken: string | undefined;
  const liveServicePanels = new Set<vscode.WebviewPanel>();
  context.subscriptions.push({
    dispose: () => {
      try {
        for (const servicePanel of [...liveServicePanels]) {
          try {
            servicePanel.dispose();
          } catch {
            /* Continue releasing other panels. */
          }
        }
      } finally {
        liveServicePanels.clear();
      }
    },
  });
  const catalogHealth = new CatalogHealth();
  let response = '';
  let importedPrompt: string | undefined;
  let message = 'Prêt · Ctrl+Entrée pour exécuter';
  const changed = new vscode.EventEmitter<void>();
  const status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    20,
  );
  status.command = 'scalewayAI.setProject';
  const updateStatus = () => {
    const project = connection.project;
    status.text = project
      ? `$(organization) Scaleway AI · Projet : ${project.name}${connection.connected ? '' : ' · à reconnecter'}`
      : '$(organization) Scaleway AI · Choisir un projet';
    status.tooltip =
      'Choisir ou changer le projet Scaleway · sélection de contexte, pas une vérification du cloud';
  };
  const updateCatalog = () => {
    void catalogPanel?.webview.postMessage({
      type: 'catalog-state',
      revision: catalogHealth.next(),
      serverless: visibleCatalogModels(connection.serverless),
      dedicated: visibleCatalogModels(connection.dedicatedCatalog),
      deployments: connection.dedicated,
      selectedServerless: connection.serverlessResources.map(
        (model) => model.id,
      ),
      publicStatus: connection.serverlessState,
      dedicatedStatus: connection.dedicatedCatalogState,
      scope: connection.project
        ? `Projet : ${connection.project.name} · fr-par`
        : 'Catalogue public · choisissez un projet pour les modèles dédiés',
    });
  };
  const refresh = () => {
    changed.fire();
    updateCatalog();
    updateStatus();
    deployedResources.refresh();
    localCreation.modelsChanged();
    if (modelsPanel) renderModelsOverview();
  };
  const update = () => {
    void panel?.webview.postMessage({
      type: 'state',
      model: selected.id,
      ...(importedPrompt !== undefined ? { prompt: importedPrompt } : {}),
      running: !!active,
      output: response || 'La réponse simulée apparaîtra ici.',
      status: message,
      hasExperiment: !!last,
    });
    void vscode.commands.executeCommand(
      'setContext',
      'scalewayAI.running',
      !!active,
    );
  };
  const localInventory = new LocalInventory(context);
  context.subscriptions.push(localInventory);
  const localCreation = new LocalCreation(context, {
    current: () => ({
      key:
        connection.connected && connection.project
          ? JSON.stringify(connection.project)
          : '',
      projectId: connection.connected ? connection.project?.id : undefined,
      status: connection.dedicatedState,
      apiKeys:
        connection.connected && connection.project ? connection.apiKeys : [],
      rows: connection.connected
        ? [...connection.serverless, ...connection.dedicated]
        : [],
    }),
    credentialScope: (projectId, model, keyId) =>
      connection.modelCredentialScope(projectId, model, keyId),
    addKey: async () => {
      await connection.configureAPIKey();
    },
    refresh: async () => {
      if (!(await connection.ensureProject())) return;
      await connection.loadPublicCatalog();
      await connection.loadModels();
      await connection.refreshAPIKeys(true);
    },
  });
  context.subscriptions.push(localCreation);
  const deployedResources = new DeployedResources(context, () => ({
    projectName: connection.project?.name,
    connected: connection.connected,
  }));
  context.subscriptions.push(deployedResources);
  const connection = new Connection(context, refresh);
  context.subscriptions.push(connection);
  const resources = (): Node[] => [
    {
      id: 'project',
      label: connection.project
        ? `Projet : ${connection.project.name}`
        : 'Choisir un projet',
      icon: 'organization',
      command: 'scalewayAI.setProject',
    },
    {
      id: 'api-keys',
      label: 'Clés API',
      icon: 'key',
      command: 'scalewayAI.openAPIKeys',
    },
    {
      id: 'dedicated-deployments',
      label: 'Déploiements dédiés',
      icon: 'server',
      command: 'scalewayAI.openDeployments',
    },
    {
      id: 'agents',
      label: 'Agents',
      icon: 'hubot',
      command: 'scalewayAI.openAgents',
    },
    {
      id: 'resource-tools',
      label: 'Tools',
      icon: 'tools',
      command: 'scalewayAI.openTools',
    },
    {
      id: 'local',
      label: 'Ressources locales',
      icon: 'device-desktop',
      children: [
        {
          id: 'local-agents',
          label: 'Agents',
          icon: 'hubot',
          command: 'scalewayAI.openLocalAgents',
        },
        {
          id: 'local-tools',
          label: 'Tools',
          icon: 'tools',
          command: 'scalewayAI.openLocalTools',
        },
      ],
    },
    {
      id: 'templates',
      label: 'Mes templates',
      icon: 'files',
      children: [
        {
          id: 'templates-agents',
          label: 'Agents',
          icon: 'hubot',
          command: 'scalewayAI.openAgentTemplates',
        },
        {
          id: 'templates-tools',
          label: 'Tools',
          icon: 'tools',
          command: 'scalewayAI.openToolTemplates',
        },
      ],
    },
    {
      id: 'recent',
      label: 'Récents',
      icon: 'history',
      children: last
        ? [
            {
              id: 'last',
              label: 'Dernière expérience',
              description: last.status,
              command: 'scalewayAI.experiment',
            },
          ]
        : [{ id: 'no-recent', label: 'Aucune expérience récente' }],
    },
  ];
  const tools = (): Node[] => [
    {
      id: 'discover',
      label: 'Découvrir',
      icon: 'search',
      children: [
        {
          id: 'real-catalog',
          label: 'Catalogue de modèles',
          icon: 'library',
          command: 'scalewayAI.openCatalog',
        },
      ],
    },
    {
      id: 'build',
      label: 'Construire',
      icon: 'tools',
      children: [
        {
          id: 'create-agent',
          label: 'Créer un agent',
          icon: 'add',
          command: 'scalewayAI.createAgent',
        },
        {
          id: 'create-tool',
          label: 'Créer un tool',
          icon: 'add',
          command: 'scalewayAI.createTool',
        },
        {
          id: 'playground',
          label: 'Playground modèle',
          icon: 'beaker',
          command: 'scalewayAI.playground',
        },
        {
          id: 'experiments',
          label: 'Expériences',
          icon: 'history',
          children: [
            {
              id: 'load-experiment',
              label: 'Reprendre une expérience',
              icon: 'folder-open',
              command: 'scalewayAI.loadExperiment',
            },
            ...(last
              ? [
                  {
                    id: 'save-experiment',
                    label: 'Enregistrer l’expérience',
                    icon: 'save',
                    command: 'scalewayAI.saveExperiment',
                  },
                  {
                    id: 'export-experiment',
                    label: 'Exporter Python / TypeScript',
                    icon: 'code',
                    command: 'scalewayAI.exportExperiment',
                  },
                ]
              : []),
          ],
        },
      ],
    },
  ];
  const help = (): Node[] => [
    {
      id: 'start',
      label: 'Bien démarrer',
      icon: 'book',
      command: 'scalewayAI.getStarted',
    },
    {
      id: 'docs',
      label: 'Documentation Scaleway',
      icon: 'link-external',
      command: 'scalewayAI.documentation',
    },
    ...(connection.connected
      ? [
          {
            id: 'logout',
            label: 'Se déconnecter (local)',
            icon: 'sign-out',
            command: 'scalewayAI.disconnect',
          },
          {
            id: 'revokeKey',
            label: 'Révoquer la clé API et se déconnecter',
            icon: 'key',
            command: 'scalewayAI.revokeAPIKey',
          },
        ]
      : []),
  ];
  const createView = (id: string, roots: () => Node[]) => {
    const provider: vscode.TreeDataProvider<Node> = {
      onDidChangeTreeData: changed.event,
      getChildren: (node) => node?.children ?? roots(),
      getParent: () => undefined,
      getTreeItem: (node) => {
        const item = new vscode.TreeItem(
          node.label,
          node.children
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.None,
        );
        item.id = node.id;
        item.description = node.description;
        if (node.icon) item.iconPath = new vscode.ThemeIcon(node.icon);
        if (node.command)
          item.command = {
            command: node.command,
            title: node.label,
            arguments: node.args,
          };
        return item;
      },
    };
    const view = vscode.window.createTreeView(id, {
      treeDataProvider: provider,
    });
    context.subscriptions.push(view);
    return view;
  };
  createView('scalewayAI.models', resources);
  createView('scalewayAI.tools', tools);
  createView('scalewayAI.help', help);
  const accountCommands = new Set([
    'scalewayAI.loadModels',
    'scalewayAI.refreshModels',
  ]);
  const register = (id: string, callback: (...args: unknown[]) => unknown) =>
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async (...args: unknown[]) => {
        // One shared gate for account-required actions; public/offline actions stay public.
        if (accountCommands.has(id) && !(await connection.ensureProject()))
          return;
        return callback(...args);
      }),
    );
  let overviewMode: 'keys' | 'dedicated' = 'keys';
  let overviewScope: ReturnType<Connection['inferenceScope']> | undefined;
  const clearOverviewScope = () => {
    const previous = overviewScope;
    overviewScope = undefined;
    overviewToken = undefined;
    previous?.dispose();
  };
  const renderModelsOverview = () => {
    if (!modelsPanel) return;
    clearOverviewScope();
    if (
      connection.connected &&
      connection.project &&
      vscode.workspace.isTrusted
    ) {
      try {
        overviewScope = connection.inferenceScope();
      } catch {
        // No usable session: render an empty page, never request credentials.
      }
    }
    const scope = overviewScope;
    const rendered = modelsOverviewHtml(
      modelsPanel.webview,
      context.extensionUri,
      scope?.project.name,
      scope ? connection.apiKeys : [],
      scope
        ? connection.dedicated.filter(
            (row) =>
              !row.deploymentInfo ||
              row.deploymentInfo.projectId === scope.project.id,
          )
        : [],
      connection.dedicatedState,
      connection.apiKeysState,
      overviewMode,
    );
    overviewToken = rendered.token;
    modelsPanel.webview.html = rendered.html;
    scope?.signal.addEventListener(
      'abort',
      () => {
        if (overviewScope !== scope) return;
        clearOverviewScope();
        if (!modelsPanel) return;
        const empty = modelsOverviewHtml(
          modelsPanel.webview,
          context.extensionUri,
          undefined,
          [],
          [],
          'Non chargé',
          'Non chargé',
          overviewMode,
        );
        // Invalidated documents cannot dispatch account actions.
        modelsPanel.webview.html = empty.html;
      },
      { once: true },
    );
  };
  const openOverview = () => {
    clearOverviewScope();
    if (!modelsPanel) {
      modelsPanel = vscode.window.createWebviewPanel(
        'scalewayAI.resources',
        overviewMode === 'keys' ? 'Clés API' : 'Déploiements dédiés',
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          localResourceRoots: [
            vscode.Uri.joinPath(context.extensionUri, 'media'),
          ],
        },
      );
      const origin = modelsPanel;
      const messages = origin.webview.onDidReceiveMessage(
        async (value: unknown) => {
          if (modelsPanel !== origin) return;
          const input = parseOverviewInput(value);
          if (!input || !overviewToken || input.token !== overviewToken) return;
          if (input.type === 'catalog') {
            await vscode.commands.executeCommand('scalewayAI.openCatalog');
            return;
          }
          const scope = overviewScope;
          if (!scope?.current()) return;
          if (input.type === 'refresh') {
            overviewToken = undefined;
            if (overviewMode === 'keys') await refreshAPIKeysView();
            else await connection.loadModels();
            if (modelsPanel === origin) renderModelsOverview();
            return;
          }
          if (input.type === 'add-key') {
            if (overviewMode !== 'keys') return;
            overviewToken = undefined;
            await connection.configureAPIKey();
            if (modelsPanel === origin) renderModelsOverview();
            return;
          }
          if (input.type === 'reveal-key') {
            if (
              overviewMode !== 'keys' ||
              !scope.current() ||
              !connection.apiKeys.some(
                (key) => key.id === input.id && key.secretAvailable,
              )
            )
              return;
            overviewToken = undefined;
            await connection.revealAPIKey(input.id);
            if (modelsPanel === origin) renderModelsOverview();
            return;
          }
          if (input.type === 'import-key' || input.type === 'use-key') {
            if (overviewMode !== 'keys') return;
            const key = connection.apiKeys.find((key) => key.id === input.id);
            if (!key || key.expiresAt <= Date.now() + 30000 || !scope.current())
              return;
            if (input.type === 'import-key') {
              overviewToken = undefined;
              await connection.configureAPIKey(input.id);
              if (modelsPanel === origin) renderModelsOverview();
            } else {
              if (!key.secretAvailable) return;
              const model = await connection.useAPIKey(input.id);
              if (
                model &&
                modelsPanel === origin &&
                overviewMode === 'keys' &&
                overviewScope?.current() &&
                overviewScope.project === scope.project
              )
                await showService(model);
            }
            return;
          }
          if (input.type !== 'open' || overviewMode !== 'dedicated') return;
          const member = connection.dedicated.some(
            (row) =>
              row.id === input.id &&
              row.kind === 'dedicated' &&
              row.status !== 'deleted' &&
              (!row.deploymentInfo ||
                row.deploymentInfo.projectId === scope.project.id),
          );
          if (!member || !scope.current()) return;
          await vscode.commands.executeCommand(
            'scalewayAI.openService',
            input.id,
          );
        },
      );
      origin.onDidDispose(() => {
        messages.dispose();
        if (modelsPanel === origin) {
          clearOverviewScope();
          modelsPanel = undefined;
        }
      });
    } else modelsPanel.reveal(vscode.ViewColumn.One);
    modelsPanel.title =
      overviewMode === 'keys' ? 'Clés API' : 'Déploiements dédiés';
    renderModelsOverview();
  };
  const openResourceView = async (mode: 'keys' | 'dedicated') => {
    await connection.ready;
    overviewMode = mode;
    openOverview();
    if (
      connection.connected &&
      connection.project &&
      vscode.workspace.isTrusted
    ) {
      if (mode === 'keys') await refreshAPIKeysView(true);
      else await connection.loadModels(true);
    }
  };
  let apiKeysRefresh: Promise<void> | undefined;
  const refreshAPIKeysView = (silent = false): Promise<void> => {
    if (apiKeysRefresh) return apiKeysRefresh;
    apiKeysRefresh = connection.refreshAPIKeys(silent).finally(() => {
      apiKeysRefresh = undefined;
    });
    return apiKeysRefresh;
  };
  register('scalewayAI.openModels', () => openResourceView('keys'));
  register('scalewayAI.openAPIKeys', () => openResourceView('keys'));
  register('scalewayAI.openDeployments', () => openResourceView('dedicated'));
  register('scalewayAI.configureAPIKey', async () => {
    await connection.configureAPIKey();
  });
  if (context.secrets?.onDidChange)
    context.subscriptions.push(
      context.secrets.onDidChange(({ key }) => {
        if (key.startsWith('scalewayAI.llmAccess.'))
          connection.invalidateAPIKeys();
      }),
    );
  register('scalewayAI.openAgents', () => deployedResources.open('agents'));
  register('scalewayAI.openTools', () => deployedResources.open('tools'));
  register('scalewayAI.openLocalAgents', () => localInventory.open('agents'));
  register('scalewayAI.openLocalTools', () => localInventory.open('tools'));
  register('scalewayAI.openAgentTemplates', () =>
    localCreation.open('agents', 'templates'),
  );
  register('scalewayAI.openToolTemplates', () =>
    localCreation.open('tools', 'templates'),
  );
  register('scalewayAI.createAgent', () => localCreation.open('agents'));
  register('scalewayAI.createTool', () => localCreation.open('tools'));
  const openExperiment = async () => {
    if (!last) {
      void vscode.window.showInformationMessage(
        'Exécutez une démonstration pour créer une expérience.',
      );
      return;
    }
    const doc = await vscode.workspace.openTextDocument({
      language: 'json',
      content: JSON.stringify(last, null, 2),
    });
    await vscode.window.showTextDocument(doc, { preview: false });
  };
  const execute = async (model: string, prompt: string) => {
    if (active || !panel) return;
    const found = models.find((m) => m.id === model);
    if (!found) return;
    selected = found;
    importedPrompt = undefined;
    const run = { cancelled: false };
    active = run;
    const origin = panel;
    response = '';
    message = 'Réponse simulée en cours…';
    refresh();
    update();
    try {
      const result = await runDemo(
        selected,
        prompt,
        () => run.cancelled,
        (chunk) => {
          if (active !== run || panel !== origin) return;
          response += chunk;
          update();
        },
      );
      if (panel === origin && active === run) {
        last = result;
        message =
          result.status === 'completed'
            ? 'Démonstration terminée · aucun appel API'
            : 'Démonstration arrêtée · réponse partielle';
      }
    } catch {
      if (panel === origin)
        message = 'Instruction invalide ou démonstration interrompue.';
    } finally {
      if (active === run) active = undefined;
      refresh();
      update();
    }
  };
  const openPlayground = () => {
    if (panel) {
      panel.reveal(vscode.ViewColumn.One);
      update();
      return;
    }
    panel = vscode.window.createWebviewPanel(
      'scalewayAI.playground',
      'Playground modèle · Offline',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'media'),
        ],
        retainContextWhenHidden: true,
      },
    );
    const origin = panel;
    origin.webview.html = playgroundHtml(origin.webview, context.extensionUri);
    const received = origin.webview.onDidReceiveMessage((value: unknown) => {
      if (panel !== origin) return;
      const input = parseInput(value);
      if (!input) return;
      if (input.type === 'ready') update();
      if (input.type === 'cancel') {
        if (active) active.cancelled = true;
      }
      if (input.type === 'experiment') void openExperiment();
      if (input.type === 'run') void execute(input.model, input.prompt);
    });
    origin.onDidDispose(() => {
      received.dispose();
      if (panel === origin) {
        if (active) active.cancelled = true;
        panel = undefined;
      }
    });
  };
  register('scalewayAI.login', () => connection.login());
  register('scalewayAI.useExistingAPIKey', () =>
    connection.useExistingAPIKey(),
  );
  register('scalewayAI.setProject', async () => {
    await connection.ready;
    const choice = await vscode.window.showQuickPick(
      [
        {
          label: 'Changer de projet',
          description: 'Choisir le projet Scaleway par défaut',
          id: 'switch',
        },
        {
          label: 'Créer un projet',
          description: 'Confirmation finale requise · devient le défaut',
          id: 'create',
        },
      ],
      {
        title: 'Projet Scaleway par défaut',
        placeHolder: connection.project
          ? `${connection.project.name} · projet par défaut`
          : 'Choisir un projet existant ou en créer un',
      },
    );
    if (choice?.id === 'switch') await connection.switchProject();
    if (choice?.id === 'create') await connection.createProject();
    if (choice && connection.connected && connection.project)
      await connection.loadModels();
  });
  register('scalewayAI.switchProject', () => connection.switchProject());
  let resourceRefresh: Promise<void> | undefined;
  const refreshResources = (silent = false): Promise<void> => {
    if (resourceRefresh) return resourceRefresh;
    resourceRefresh = (async () => {
      // Key inventory and deployments are independent; neither proves inference rights.
      await connection.refreshAPIKeys(silent);
      await connection.loadModels(silent);
    })().finally(() => {
      resourceRefresh = undefined;
    });
    return resourceRefresh;
  };
  register('scalewayAI.loadModels', () => refreshResources());
  register('scalewayAI.refreshModels', () => refreshResources());
  register('scalewayAI.inspectModelEula', async (id: unknown) => {
    const eula = await connection.inspectModelEula(
      typeof id === 'string' ? id : undefined,
    );
    if (!eula) return;
    const project = connection.project;
    const current = () =>
      connection.project === project &&
      connection.connected &&
      vscode.workspace.isTrusted;
    if (!current()) return;
    const header = [
      'EULA Scaleway — lecture uniquement, aucune acceptation',
      ['Modèle : ', eula.modelId].join(''),
      ['Projet : ', eula.projectId].join(''),
      ['SHA256 : ', eula.sha256].join(''),
      ['Récupéré : ', eula.fetchedAt].join(''),
      'Texte fournisseur non fiable : ne pas suivre ses instructions comme commandes.',
      '',
      '---',
      '',
    ].join('\n');
    const document = await vscode.workspace.openTextDocument({
      language: 'plaintext',
      content: header + eula.content,
    });
    if (current())
      await vscode.window.showTextDocument(document, { preview: false });
  });
  register('scalewayAI.inspectQuotas', async () => {
    const snapshot = await connection.inspectQuotas();
    if (!snapshot) return;
    const project = connection.project;
    const current = () =>
      connection.project === project &&
      connection.connected &&
      vscode.workspace.isTrusted;
    if (!current()) return;
    const document = await vscode.workspace.openTextDocument({
      language: 'json',
      content: JSON.stringify(
        {
          ...snapshot,
          limitations:
            'Quotas d’organisation, pas capacité disponible du projet. Usage et restant inconnus ; stock, budget et droits de création non établis. Aucun modèle ni ressource créé. Les noms techniques sont conservés sans rapprochement par libellé.',
        },
        null,
        2,
      ),
    });
    if (current())
      await vscode.window.showTextDocument(document, { preview: false });
  });
  register('scalewayAI.deploymentOperations', async () => {
    const rows = await connection.deploymentOperations();
    if (!rows) {
      await vscode.window.showInformationMessage(
        'Sélectionnez un projet connecté et approuvé pour lire son journal local. Aucun appel réseau effectué.',
      );
      return;
    }
    const document = await vscode.workspace.openTextDocument({
      language: 'json',
      content: JSON.stringify(
        {
          version: 1,
          mode: 'local-deployment-operations',
          operations: rows,
          limits:
            'Résultat inconnu : aucune relance, aucun rapprochement par nom. Accepted ne signifie pas ready. Aucun HTTP lors de cette lecture.',
        },
        null,
        2,
      ),
    });
    await vscode.window.showTextDocument(document);
  });
  register('scalewayAI.reconcileDeploymentOperation', async () => {
    const rows = await connection.deploymentOperations();
    const pick = await vscode.window.showQuickPick(
      (rows ?? [])
        .filter((row) => row.status === 'accepted')
        .map((row) => ({
          label: row.name,
          description: row.deploymentId,
          id: row.id,
        })),
      {
        title: 'Relire une ressource acceptée',
        placeHolder:
          'Un GET par ID connu ; aucun endpoint sondé, aucune création',
      },
    );
    if (pick) await connection.reconcileDeploymentOperation(pick.id);
  });
  register('scalewayAI.followDeployment', (id: unknown) =>
    connection.followDeployment(typeof id === 'string' ? id : undefined),
  );
  register('scalewayAI.stopDeploymentFollow', () =>
    connection.cancelFollowDeployment(),
  );
  register('scalewayAI.prepareDeployment', (id: unknown) =>
    connection.prepareDeployment(typeof id === 'string' ? id : undefined),
  );
  register('scalewayAI.openCatalog', async () => {
    if (!catalogPanel) {
      catalogPanel = vscode.window.createWebviewPanel(
        'scalewayAI.catalog',
        'Catalogue de modèles · Scaleway',
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          localResourceRoots: [
            vscode.Uri.joinPath(context.extensionUri, 'media'),
          ],
          retainContextWhenHidden: true,
        },
      );
      const origin = catalogPanel;
      const messages = origin.webview.onDidReceiveMessage(
        async (value: unknown) => {
          if (catalogPanel !== origin) return;
          const input = parseCatalogInput(value);
          if (!input) return;
          if (input.type === 'ready') {
            catalogHealth.ready = true;
            updateCatalog();
          }
          if (input.type === 'rendered') catalogHealth.accept(input);
          if (input.type === 'eula') {
            await vscode.commands.executeCommand(
              'scalewayAI.inspectModelEula',
              input.id,
            );
            return;
          }
          if (input.type === 'prepare' || input.type === 'deploy') {
            const row = await connection.deployModel(input.id);
            if (row) await showService(row);
            updateCatalog();
          }
          if (input.type === 'use')
            await vscode.commands.executeCommand(
              'scalewayAI.useServerless',
              input.id,
            );
          if (input.type === 'open-deployment')
            await vscode.commands.executeCommand(
              'scalewayAI.openService',
              input.id,
            );
          if (input.type === 'details') {
            const details = catalogDetails(
              input.kind === 'serverless'
                ? connection.serverless
                : connection.dedicatedCatalog,
              input.kind,
              input.id,
              connection.project
                ? `Projet : ${connection.project.name} · fr-par`
                : 'Projet non sélectionné',
            );
            await origin.webview.postMessage(
              details ?? { type: 'catalog-detail-unavailable' },
            );
          }

          if (input.type === 'refresh') {
            await connection.loadCatalogs();
            updateCatalog();
          }
          if (input.type === 'project') {
            await vscode.commands.executeCommand('scalewayAI.setProject');
            if (connection.connected && connection.project)
              await connection.loadCatalogs();
            updateCatalog();
          }
        },
      );
      origin.onDidDispose(() => {
        messages.dispose();
        if (catalogPanel === origin) {
          catalogPanel = undefined;
          catalogHealth.reset();
        }
      });
      origin.webview.html = catalogHtml(origin.webview, context.extensionUri);
    } else catalogPanel.reveal(vscode.ViewColumn.One);
    updateCatalog();
    // Open first, then load public offers. An unavailable account never hides the panel.
    await connection.loadPublicCatalog();
    updateCatalog();
    void connection.ready.then(async () => {
      if (connection.connected && connection.project)
        await connection.loadCatalogs();
      updateCatalog();
    });
    return {
      publicCount: connection.serverless.length,
      publicStatus: connection.serverlessState,
      panelOpened: !!catalogPanel,
    };
  });
  register('scalewayAI.catalogDiagnostics', async () => {
    if (!catalogPanel) return { panelOpened: false, rendererReady: false };
    updateCatalog();
    const report = await catalogHealth.wait();
    return {
      panelOpened: !!catalogPanel,
      rendererReady: catalogHealth.ready,
      rendered: !!report,
      publicCards: report?.publicCards,
      dedicatedCards: report?.dedicatedCards,
      expectedPublicCards: visibleCatalogModels(connection.serverless).length,
      expectedDedicatedCards: visibleCatalogModels(connection.dedicatedCatalog)
        .length,
    };
  });
  const showService = async (row: ListedModel) => {
    const scope = connection.project;
    const choice = await vscode.window.showQuickPick(
      [
        {
          label: 'Ouvrir dans le playground',
          id: 'playground',
          description:
            row.status === 'ready' || row.kind === 'serverless'
              ? 'Contexte modèle sélectionné'
              : 'Service pas encore prêt',
        },
        ...(row.kind === 'dedicated'
          ? [
              { label: 'Actualiser / suivre le service', id: 'follow' },
              { label: 'Historique des opérations', id: 'history' },
              { label: 'Voir les détails du service', id: 'details' },
            ]
          : [{ label: 'Voir les détails du modèle', id: 'details' }]),
      ],
      {
        title: row.label,
        placeHolder:
          row.kind === 'serverless'
            ? 'Sélection de cet espace de travail, pas un déploiement cloud'
            : `État : ${row.status ?? 'inconnu'}`,
      },
    );
    if (
      !choice ||
      connection.project !== scope ||
      !connection.connected ||
      !vscode.workspace.isTrusted
    )
      return;
    if (choice.id === 'follow') await connection.followDeployment(row.id);
    if (choice.id === 'history')
      await vscode.commands.executeCommand('scalewayAI.deploymentOperations');
    if (choice.id === 'details') {
      const document = await vscode.workspace.openTextDocument({
        language: 'json',
        content: JSON.stringify(row, null, 2),
      });
      if (connection.project === scope)
        await vscode.window.showTextDocument(document, { preview: false });
    }
    if (choice.id === 'playground') await openServicePlayground(row);
  };
  const openServicePlayground = async (row: ListedModel) => {
    if (
      !connection.connected ||
      !vscode.workspace.isTrusted ||
      !connection.project
    )
      return;
    const scope = await connection.modelInferenceScope(row);
    const snapshot = structuredClone(row);
    const binding = JSON.stringify(snapshot);
    const current = () =>
      scope.current() &&
      (snapshot.kind !== 'dedicated' ||
        connection.dedicated.some(
          (candidate) =>
            candidate.id === snapshot.id &&
            JSON.stringify(candidate) === binding,
        ));
    let approval:
      | import('./dedicatedInvocationPolicy').DedicatedEndpointApproval
      | undefined;
    try {
      if (!current()) {
        scope.dispose();
        return;
      }
      if (snapshot.kind === 'dedicated') {
        approval = await dedicatedConsent(snapshot, scope.project, current);
        if (
          !approval ||
          !current() ||
          !dedicatedInvocationPolicy(snapshot, scope.project, approval).allowed
        ) {
          scope.dispose();
          return;
        }
      }
    } catch {
      scope.dispose();
      return;
    }
    const servicePanel = vscode.window.createWebviewPanel(
      'scalewayAI.servicePlayground',
      'Playground · ' + row.label,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'media'),
        ],
      },
    );
    const controller = new ServicePlayground(
      snapshot,
      { ...scope, current },
      (state) => {
        void servicePanel.webview.postMessage(state);
      },
      undefined,
      approval ? { approval } : undefined,
    );
    const messages = servicePanel.webview.onDidReceiveMessage((value) => {
      void controller.receive(value);
    });
    liveServicePanels.add(servicePanel);
    servicePanel.onDidDispose(() => {
      liveServicePanels.delete(servicePanel);
      try {
        messages.dispose();
      } finally {
        controller.dispose();
      }
    });
    servicePanel.webview.html = servicePlaygroundHtml(
      servicePanel.webview,
      context.extensionUri,
      snapshot,
      scope.project,
      !!serverlessInvocation(snapshot),
      approval,
    );
  };
  register('scalewayAI.useServerless', async (id: unknown) => {
    if (typeof id !== 'string') return;
    const row = await connection.useServerless(id);
    if (row) {
      updateCatalog();
      await vscode.window.showInformationMessage(
        'Clé API sélectionnée · IAM vérifié et modèle annoncé par l’API. La clé est réutilisable avec d’autres modèles selon ses droits ; aucune inférence ni déploiement lancé.',
      );
    }
  });
  register('scalewayAI.openServerlessResource', async (id: unknown) => {
    if (
      typeof id !== 'string' ||
      !connection.connected ||
      !vscode.workspace.isTrusted
    )
      return;
    const row = connection.serverlessResources.find(
      (resource) => resource.id === id,
    );
    if (row) await showService(row);
  });
  register('scalewayAI.deployModel', async (id: unknown) => {
    if (typeof id !== 'string') return;
    const row = await connection.deployModel(id);
    if (row) await showService(row);
  });
  register('scalewayAI.openService', async (id: unknown) => {
    if (typeof id !== 'string') return;
    const row = await connection.deploymentDetails(id);
    if (row) await showService(row);
  });
  register('scalewayAI.deploymentDetails', async (id: unknown) => {
    if (typeof id !== 'string') return;
    const row = await connection.deploymentDetails(id);
    if (row) await showService(row);
  });
  register('scalewayAI.disconnect', () => connection.disconnect());
  register('scalewayAI.revokeAPIKey', () => connection.revokeAPIKey());
  register('scalewayAI.modelInfo', (kind: unknown, id: unknown) => {
    const row = (
      kind === 'serverless'
        ? connection.serverless
        : kind === 'dedicated-catalog'
          ? connection.dedicatedCatalog
          : connection.dedicated
    ).find((m) => m.id === id);
    if (row)
      void vscode.window.showInformationMessage(
        row.label +
          ' — ' +
          (kind === 'serverless'
            ? 'Offre du catalogue public, pas une preuve d’accès inférence avec ce JWT.'
            : kind === 'dedicated-catalog'
              ? 'Modèle à déployer, pas un déploiement existant.'
              : 'Déploiement existant du projet en fr-par.') +
          ' Playground chat Serverless : modèle sélectionné configurable, selon le type d’opération.',
      );
  });
  register('scalewayAI.open', async () => {
    await vscode.commands.executeCommand('workbench.view.extension.scalewayAI');
  });
  register('scalewayAI.select', (id: unknown) => {
    if (active) return;
    const model = models.find((m) => m.id === id);
    if (model) {
      selected = model;
      refresh();
      update();
    }
  });
  register('scalewayAI.playground', openPlayground);
  register('scalewayAI.cancel', () => {
    if (active) active.cancelled = true;
  });
  register('scalewayAI.experiment', openExperiment);
  register('scalewayAI.saveExperiment', async () => {
    if (!last || active) return;
    try {
      await saveExperiment(last);
    } catch {
      await vscode.window.showErrorMessage(
        'Impossible d’enregistrer cette expérience hors ligne.',
      );
    }
  });
  register('scalewayAI.loadExperiment', async () => {
    if (active) return;
    try {
      const experiment = await loadExperiment();
      if (!experiment || active) return;
      const model = models.find(
        (candidate) => candidate.id === experiment.model,
      );
      if (!model) return;
      last = experiment;
      selected = model;
      importedPrompt = experiment.prompt;
      response = experiment.output;
      message = 'Expérience hors ligne reprise · aucune exécution déclenchée';
      openPlayground();
      refresh();
      update();
    } catch {
      await vscode.window.showErrorMessage(
        'Expérience invalide, trop volumineuse ou inaccessible. Aucun code exécuté.',
      );
    }
  });
  register('scalewayAI.exportExperiment', async () => {
    if (!last || active) return;
    try {
      await exportExperiment(last);
    } catch {
      await vscode.window.showErrorMessage(
        'Impossible d’exporter cette expérience hors ligne.',
      );
    }
  });

  register('scalewayAI.catalog', async () => {
    const picked = await vscode.window.showQuickPick(
      models.map((m) => ({
        label: m.label.replace('Demo · ', ''),
        description: 'Synthétique · hors ligne',
        id: m.id,
      })),
      {
        title: 'Catalogue de démonstration',
        placeHolder: 'Choisir un modèle puis ouvrir son playground',
      },
    );
    if (picked && !active) {
      const model = models.find((m) => m.id === picked.id);
      if (!model) return;
      selected = model;
      refresh();
      openPlayground();
      update();
    }
  });
  register('scalewayAI.getStarted', async () => {
    const doc = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content:
        '# Bien démarrer — Scaleway AI\n\n1. Sélectionnez un modèle dans Mes ressources.\n2. Ouvrez Playground modèle dans Construire et tester.\n3. Saisissez une instruction puis Exécuter (Ctrl+Entrée).\n4. Arrêter conserve une réponse partielle.\n5. Ouvrir l’expérience JSON permet un enregistrement manuel.\n\nMode hors ligne : aucun appel API ni facturation.',
    });
    await vscode.window.showTextDocument(doc);
  });
  register('scalewayAI.documentation', () =>
    vscode.env.openExternal(
      vscode.Uri.parse('https://www.scaleway.com/en/docs/generative-apis/'),
    ),
  );
  updateStatus();
  status.show();
  context.subscriptions.push(status, changed, {
    dispose: () => {
      if (active) active.cancelled = true;
      panel?.dispose();
      catalogPanel?.dispose();
      modelsPanel?.dispose();
      last = undefined;
    },
  });
  update();
}
export function deactivate(): void {}
