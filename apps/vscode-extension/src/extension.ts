import * as vscode from 'vscode';
import { models, DemoModel, Experiment, runDemo } from './demo';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Scaleway AI — Offline Playground');
  let selected: DemoModel = models[0];
  let last: Experiment | undefined;
  let active: {cancelled: boolean} | undefined;
  const changed = new vscode.EventEmitter<void>();
  const provider: vscode.TreeDataProvider<DemoModel> = {
    onDidChangeTreeData: changed.event,
    getChildren: () => [...models],
    getParent: () => undefined,
    getTreeItem: model => {
      const item = new vscode.TreeItem(model.label, vscode.TreeItemCollapsibleState.None);
      item.description = selected.id === model.id ? 'Selected · offline' : 'Offline';
      item.tooltip = model.description + '. Click to select this synthetic model.';
      item.iconPath = new vscode.ThemeIcon(selected.id === model.id ? 'check' : 'symbol-method');
      item.command = {command: 'scalewayAI.select', title: 'Select model', arguments: [model.id]};
      return item;
    },
  };
  const view = vscode.window.createTreeView('scalewayAI.models', {treeDataProvider: provider});
  view.message = 'Offline preview · synthetic models · no credentials or charges';
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20);
  status.text = '$(beaker) Scaleway AI: Offline';
  status.tooltip = 'Open experimental offline model playground';
  status.command = 'scalewayAI.open'; status.show();
  const register = (id: string, callback: (...args: any[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, callback));
  register('scalewayAI.select', (id: unknown) => {
    const model = models.find(item => item.id === id);
    if (!model) return;
    selected = model; changed.fire();
  });
  register('scalewayAI.open', async () => {
    await vscode.commands.executeCommand('workbench.view.extension.scalewayAI');
    await view.reveal(selected, {select: true, focus: true});
  });
  register('scalewayAI.cancel', () => { if (active) active.cancelled = true; });
  register('scalewayAI.experiment', async () => {
    if (!last) { void vscode.window.showInformationMessage('Run the offline playground first.'); return; }
    const document = await vscode.workspace.openTextDocument({language: 'json', content: JSON.stringify(last, null, 2)});
    await vscode.window.showTextDocument(document, {preview: false});
    // Untitled document only: user chooses whether/where to save prompt/output.
  });
  register('scalewayAI.playground', async () => {
    if (active) { void vscode.window.showInformationMessage('A demo is running. Cancel it before starting another.'); return; }
    const prompt = await vscode.window.showInputBox({
      title: 'Scaleway AI — Offline Playground', prompt: 'Synthetic stream only. Nothing is sent to Scaleway.',
      placeHolder: 'Explain what this toolkit will do', ignoreFocusOut: true,
      validateInput: value => !value.trim() || Buffer.byteLength(value, 'utf8') > 4096 ? 'Enter 1–4096 UTF-8 bytes.' : undefined,
    });
    if (prompt === undefined) return;
    if (active) return;
    const run = {cancelled: false}; active = run;
    output.clear(); output.appendLine('OFFLINE SYNTHETIC DEMO — no API, no billing');
    output.appendLine('Model: ' + selected.label); output.appendLine(''); output.show(true);
    try {
      await vscode.window.withProgress({location: vscode.ProgressLocation.Notification,
        title: 'Scaleway AI: Simulating stream', cancellable: true}, async (_progress, token) => {
        const subscription = token.onCancellationRequested(() => { run.cancelled = true; });
        try {
          last = await runDemo(selected, prompt, () => run.cancelled || token.isCancellationRequested, chunk => output.append(chunk));
          output.appendLine(''); output.appendLine('Demo ' + last.status + '. No inference was sent.');
        } finally { subscription.dispose(); }
      });
    } catch {
      void vscode.window.showErrorMessage('Offline demo failed. No network request was made.');
    } finally { if (active === run) active = undefined; }
  });
  context.subscriptions.push(output, view, status, changed, {dispose: () => {
    if (active) active.cancelled = true;
    last = undefined;
  }});
}

export function deactivate(): void { /* resources disposed by VS Code */ }
