import * as vscode from 'vscode';
import { catalogHtml, parseCatalogInput } from './catalog';
import { visibleCatalogModels } from './catalogVisibility';
import { Connection } from './connection';
import { type DemoModel, type Experiment, models, runDemo } from './demo';
import { parseInput } from './ipc';
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
  let selected: DemoModel = models[0];
  let last: Experiment | undefined;
  let active: { cancelled: boolean } | undefined;
  let panel: vscode.WebviewPanel | undefined;
  let catalogPanel: vscode.WebviewPanel | undefined;
  let response = '';
  let message = 'Prêt · Ctrl+Entrée pour exécuter';
  const changed = new vscode.EventEmitter<void>();
  const updateCatalog = () => {
    void catalogPanel?.webview.postMessage({
      type: 'catalog-state',
      serverless: visibleCatalogModels(connection.serverless),
      dedicated: visibleCatalogModels(connection.dedicatedCatalog),
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
  };
  const update = () => {
    void panel?.webview.postMessage({
      type: 'state',
      model: selected.id,
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
  const connection = new Connection(context, refresh);
  context.subscriptions.push(connection);
  const modelNodes = (): Node[] =>
    models.map((m) => ({
      id: m.id,
      label: m.label.replace('Demo · ', ''),
      icon: selected.id === m.id ? 'check' : 'symbol-method',
      description: selected.id === m.id ? 'Sélectionné' : 'Synthétique',
      command: 'scalewayAI.select',
      args: [m.id],
    }));
  const realModelNodes = (
    kind: 'serverless' | 'dedicated' | 'dedicated-catalog',
  ): Node[] => {
    const rows =
      kind === 'serverless'
        ? connection.serverless
        : kind === 'dedicated-catalog'
          ? connection.dedicatedCatalog
          : connection.dedicated;
    return visibleCatalogModels(rows).map((m) => ({
      id: `${kind}:${m.id}`,
      label: m.label,
      icon: 'symbol-method',
      description: m.status,
      command: 'scalewayAI.modelInfo',
      args: [kind, m.id],
    }));
  };
  const resources = (): Node[] => [
    {
      id: 'project',
      label: connection.project
        ? `Projet Scaleway : ${connection.project.name}`
        : 'Définir le projet Scaleway',
      icon: 'organization',
      command: 'scalewayAI.setProject',
    },
    ...(connection.project
      ? [{ id: 'region', label: 'Région dédiée : fr-par', icon: 'globe' }]
      : []),
    {
      id: 'real-models',
      label: 'Modèles',
      icon: 'library',
      command: 'scalewayAI.refreshModels',
      children: [
        {
          id: 'load',
          label: connection.busy
            ? 'Chargement…'
            : 'Charger / actualiser les modèles',
          icon: 'refresh',
          command: 'scalewayAI.refreshModels',
        },
        {
          id: 'serverless',
          label: 'Serverless · catalogue',
          command: 'scalewayAI.openCatalog',
          description: connection.serverlessState,
          children: realModelNodes('serverless'),
        },
        {
          id: 'dedicated',
          label: 'Déploiements dédiés',
          command: 'scalewayAI.loadModels',
          description: connection.dedicatedState,
          children: realModelNodes('dedicated'),
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
              label: 'Dernière expérience de démo',
              description: last.status,
              command: 'scalewayAI.experiment',
            },
          ]
        : [{ id: 'no-recent', label: 'Aucune expérience récente' }],
    },
    {
      id: 'local',
      label: 'Ressources locales',
      icon: 'device-desktop',
      children: [
        {
          id: 'models',
          label: 'Démonstration hors ligne',
          icon: 'beaker',
          children: modelNodes(),
        },
      ],
    },
  ];
  const tools = (): Node[] => [
    {
      id: 'discover',
      label: 'Découvrir',
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
      children: [
        {
          id: 'playground',
          label: 'Playground modèle',
          icon: 'beaker',
          command: 'scalewayAI.playground',
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
            label: 'Se déconnecter',
            icon: 'sign-out',
            command: 'scalewayAI.disconnect',
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
  register('scalewayAI.setProject', async () => {
    await connection.ready;
    const choice = await vscode.window.showQuickPick(
      [
        {
          label: 'Changer de projet',
          description: 'Choisir le projet Scaleway par défaut',
          id: 'switch',
        },
      ],
      {
        title: 'Projet Scaleway par défaut',
        placeHolder: connection.project
          ? connection.project.name +
            ' · création de projet non disponible dans cette preview'
          : 'Choisir un projet existant · création non disponible',
      },
    );
    if (choice?.id === 'switch') await connection.switchProject();
  });
  register('scalewayAI.switchProject', () => connection.switchProject());
  register('scalewayAI.loadModels', () => connection.loadModels());
  register('scalewayAI.refreshModels', async () => {
    await connection.loadCatalogs();
    if (connection.connected && connection.project)
      await connection.loadModels();
  });
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
      origin.webview.html = catalogHtml(origin.webview, context.extensionUri);
      const messages = origin.webview.onDidReceiveMessage(
        async (value: unknown) => {
          if (catalogPanel !== origin) return;
          const input = parseCatalogInput(value);
          if (!input) return;
          if (input.type === 'ready') updateCatalog();
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
        if (catalogPanel === origin) catalogPanel = undefined;
      });
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
  register('scalewayAI.disconnect', () => connection.disconnect());
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
          ' Inférence réelle non implémentée dans ce VSIX.',
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
  const status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    20,
  );
  status.text = '$(beaker) Scaleway AI: Offline';
  status.command = 'scalewayAI.open';
  status.show();
  context.subscriptions.push(status, changed, {
    dispose: () => {
      if (active) active.cancelled = true;
      panel?.dispose();
      catalogPanel?.dispose();
      last = undefined;
    },
  });
  update();
}
export function deactivate(): void {}
