import * as vscode from 'vscode';
import {models, DemoModel, Experiment, runDemo} from './demo';
import {parseInput} from './ipc';
import {Connection} from './connection';
import {playgroundHtml} from './webview';

interface Node {id: string; label: string; icon?: string; command?: string; args?: unknown[]; children?: Node[]; description?: string;}
export function activate(context: vscode.ExtensionContext): void {
  let selected: DemoModel = models[0];
  let last: Experiment | undefined;
  let active: {cancelled: boolean} | undefined;
  let panel: vscode.WebviewPanel | undefined;
  let response = '';
  let message = 'Prêt · Ctrl+Entrée pour exécuter';
  const changed = new vscode.EventEmitter<void>();
  const refresh = () => changed.fire();
  const update = () => {
    void panel?.webview.postMessage({type: 'state', model: selected.id, running: !!active,
      output: response || 'La réponse simulée apparaîtra ici.', status: message, hasExperiment: !!last});
    void vscode.commands.executeCommand('setContext', 'scalewayAI.running', !!active);
  };
  const connection = new Connection(context, refresh);
  context.subscriptions.push(connection);
  const modelNodes = (): Node[] => models.map(m => ({id: m.id, label: m.label.replace('Demo · ', ''),
    icon: selected.id === m.id ? 'check' : 'symbol-method', description: selected.id === m.id ? 'Sélectionné' : 'Synthétique',
    command: 'scalewayAI.select', args: [m.id]}));
  const realModelNodes = (kind: 'serverless' | 'dedicated'): Node[] => {
    const rows = kind === 'serverless' ? connection.serverless : connection.dedicated;
    return rows.map(m => ({id: kind + ':' + m.id, label: m.label, icon: 'symbol-method',
      description: kind === 'serverless' ? 'Catalogue global' : m.status,
      command: 'scalewayAI.modelInfo', args: [kind, m.id]}));
  };
  const resources = (): Node[] => [
    {id: 'connection', label: connection.metadata ? 'Session : ' + connection.metadata.name : 'Se connecter à Scaleway', icon: 'account', command: 'scalewayAI.login'},
    {id: 'project', label: connection.project ? 'Projet : ' + connection.project.name : 'Projet : sélectionner', icon: 'organization', command: 'scalewayAI.switchProject'},
    ...(connection.project ? [{id:'region',label:'Région dédiée : fr-par',icon:'globe'}] : []),
    {id: 'real-models', label: 'Modèles', icon: 'library', children: [
      {id:'load',label:connection.busy ? 'Chargement…' : 'Charger / actualiser les modèles',icon:'refresh',command:'scalewayAI.loadModels'},
      {id:'serverless',label:'Serverless',description:connection.serverlessState,children:realModelNodes('serverless')},
      {id:'dedicated',label:'Déploiements dédiés',description:connection.dedicatedState,children:realModelNodes('dedicated')},
    ]},
    {id: 'models', label: 'Démonstration hors ligne', icon: 'beaker', children: modelNodes()},
    {id: 'last', label: 'Dernière expérience de démo', icon: 'history', description: last ? last.status : 'Aucune', command: 'scalewayAI.experiment'},
  ];
  const tools = (): Node[] => [
    {id: 'discover', label: 'Découvrir', children: [{id:'real-catalog',label:'Catalogue de modèles',icon:'library',command:'scalewayAI.loadModels'}, {id: 'catalog', label: 'Catalogue de démonstration', icon: 'beaker', command: 'scalewayAI.catalog'}]},
    {id: 'build', label: 'Construire et tester', children: [{id: 'playground', label: 'Playground modèle', icon: 'beaker', command: 'scalewayAI.playground'}]},
  ];
  const help = (): Node[] => [
    {id: 'start', label: 'Bien démarrer', icon: 'book', command: 'scalewayAI.getStarted'},
    {id: 'docs', label: 'Documentation Scaleway', icon: 'link-external', command: 'scalewayAI.documentation'},
    {id:'logout',label:'Se déconnecter',icon:'sign-out',command:'scalewayAI.disconnect'},
  ];
  const createView = (id: string, roots: () => Node[]) => {
    const provider: vscode.TreeDataProvider<Node> = {
      onDidChangeTreeData: changed.event,
      getChildren: node => node?.children ?? roots(),
      getParent: () => undefined,
      getTreeItem: node => {
        const item = new vscode.TreeItem(node.label, node.children ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
        item.id = node.id; item.description = node.description;
        if (node.icon) item.iconPath = new vscode.ThemeIcon(node.icon);
        if (node.command) item.command = {command: node.command, title: node.label, arguments: node.args};
        return item;
      },
    };
    const view = vscode.window.createTreeView(id, {treeDataProvider: provider});
    context.subscriptions.push(view); return view;
  };
  createView('scalewayAI.models', resources);
  createView('scalewayAI.tools', tools);
  createView('scalewayAI.help', help);
  const register = (id: string, callback: (...args: any[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, callback));
  const openExperiment = async () => {
    if (!last) { void vscode.window.showInformationMessage('Exécutez une démonstration pour créer une expérience.'); return; }
    const doc = await vscode.workspace.openTextDocument({language: 'json', content: JSON.stringify(last, null, 2)});
    await vscode.window.showTextDocument(doc, {preview: false});
  };
  const execute = async (model: string, prompt: string) => {
    if (active || !panel) return;
    const found = models.find(m => m.id === model); if (!found) return;
    selected = found;
    const run = {cancelled: false}; active = run;
    const origin = panel;
    response = ''; message = 'Réponse simulée en cours…'; refresh(); update();
    try {
      const result = await runDemo(selected, prompt, () => run.cancelled, chunk => {
        if (active !== run || panel !== origin) return;
        response += chunk; update();
      });
      if (panel === origin && active === run) {
        last = result; message = result.status === 'completed' ? 'Démonstration terminée · aucun appel API' : 'Démonstration arrêtée · réponse partielle';
      }
    } catch { if (panel === origin) message = 'Instruction invalide ou démonstration interrompue.'; }
    finally { if (active === run) active = undefined; refresh(); update(); }
  };
  const openPlayground = () => {
    if (panel) { panel.reveal(vscode.ViewColumn.One); update(); return; }
    panel = vscode.window.createWebviewPanel('scalewayAI.playground', 'Playground modèle · Offline', vscode.ViewColumn.One,
      {enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')], retainContextWhenHidden: true});
    const origin = panel;
    origin.webview.html = playgroundHtml(origin.webview, context.extensionUri);
    const received = origin.webview.onDidReceiveMessage((value: unknown) => {
      if (panel !== origin) return;
      const input = parseInput(value); if (!input) return;
      if (input.type === 'ready') update();
      if (input.type === 'cancel') { if (active) active.cancelled = true; }
      if (input.type === 'experiment') void openExperiment();
      if (input.type === 'run') void execute(input.model, input.prompt);
    });
    origin.onDidDispose(() => { received.dispose(); if (panel === origin) { if (active) active.cancelled = true; panel = undefined; } });
  };
  register('scalewayAI.login', () => connection.login());
  register('scalewayAI.switchProject', () => connection.switchProject());
  register('scalewayAI.loadModels', async () => {if (!connection.project) await connection.switchProject(); if (connection.project) await connection.loadModels();});
  register('scalewayAI.disconnect', () => connection.disconnect());
  register('scalewayAI.modelInfo', (kind: unknown, id: unknown) => {
    const row = (kind === 'serverless' ? connection.serverless : connection.dedicated).find(m => m.id === id);
    if (row) void vscode.window.showInformationMessage(row.label + ' — ' + (kind === 'serverless' ? 'Catalogue global : accès JWT non établi.' : 'Déploiement du projet en fr-par.') + ' Inférence réelle non implémentée dans ce VSIX.');
  });
  register('scalewayAI.open', async () => { await vscode.commands.executeCommand('workbench.view.extension.scalewayAI'); });
  register('scalewayAI.select', (id: unknown) => { if (active) return; const model = models.find(m => m.id === id); if (model) {selected = model; refresh(); update();} });
  register('scalewayAI.playground', openPlayground);
  register('scalewayAI.cancel', () => { if (active) active.cancelled = true; });
  register('scalewayAI.experiment', openExperiment);
  register('scalewayAI.catalog', async () => {
    const picked = await vscode.window.showQuickPick(models.map(m => ({label: m.label.replace('Demo · ', ''), description: 'Synthétique · hors ligne', id: m.id})),
      {title: 'Catalogue de démonstration', placeHolder: 'Choisir un modèle puis ouvrir son playground'});
    if (picked && !active) {selected = models.find(m => m.id === picked.id)!; refresh(); openPlayground(); update();}
  });
  register('scalewayAI.getStarted', async () => {
    const doc = await vscode.workspace.openTextDocument({language: 'markdown', content: '# Bien démarrer — Scaleway AI\n\n1. Sélectionnez un modèle dans Mes ressources.\n2. Ouvrez Playground modèle dans Construire et tester.\n3. Saisissez une instruction puis Exécuter (Ctrl+Entrée).\n4. Arrêter conserve une réponse partielle.\n5. Ouvrir l’expérience JSON permet un enregistrement manuel.\n\nMode hors ligne : aucun appel API ni facturation.'});
    await vscode.window.showTextDocument(doc);
  });
  register('scalewayAI.documentation', () => vscode.env.openExternal(vscode.Uri.parse('https://www.scaleway.com/en/docs/generative-apis/')));
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20);
  status.text = '$(beaker) Scaleway AI: Offline'; status.command = 'scalewayAI.open'; status.show();
  context.subscriptions.push(status, changed, {dispose: () => {if (active) active.cancelled = true; panel?.dispose(); last = undefined;}});
  update();
}
export function deactivate(): void {}
