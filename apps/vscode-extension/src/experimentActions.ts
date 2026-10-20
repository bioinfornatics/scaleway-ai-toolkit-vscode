import { Buffer } from 'node:buffer';
import * as vscode from 'vscode';
import type { Experiment } from './demo';
import {
  decodeExperiment,
  encodeExperiment,
  exportOfflineExample,
} from './experiments';

/** User-initiated file operations only; never overwrite existing content automatically. */
export async function saveExperiment(experiment: Experiment): Promise<boolean> {
  const bytes = encodeExperiment(experiment);
  // Native dirty editor: VS Code owns Save/Save As and overwrite confirmation.
  const document = await vscode.workspace.openTextDocument({
    language: 'json',
    content: Buffer.from(bytes).toString('utf8'),
  });
  await vscode.window.showTextDocument(document, { preview: false });
  // Do not write with fs.writeFile: the user sees exact content and controls the final native save.
  await vscode.commands.executeCommand('workbench.action.files.saveAs');
  return true;
}
export async function loadExperiment(): Promise<Experiment | undefined> {
  const uris = await vscode.window.showOpenDialog({
    title: 'Reprendre une expérience hors ligne',
    canSelectMany: false,
    canSelectFiles: true,
    canSelectFolders: false,
    filters: { 'Expérience JSON': ['json'] },
  });
  const uri = uris?.[0];
  if (uri?.scheme !== 'file') return;
  const stat = await vscode.workspace.fs.stat(uri);
  if (stat.size > 131072) throw new Error('experiment_too_large');
  const parsed = decodeExperiment(await vscode.workspace.fs.readFile(uri));
  if (!parsed) throw new Error('invalid_offline_experiment');
  return parsed;
}
export async function exportExperiment(experiment: Experiment): Promise<void> {
  const selected = await vscode.window.showQuickPick(
    [
      { label: 'Python · replay hors ligne', language: 'python' as const },
      {
        label: 'TypeScript · replay hors ligne',
        language: 'typescript' as const,
      },
    ],
    { title: 'Exporter une expérience autonome (sans inférence)' },
  );
  if (!selected) return;
  const document = await vscode.workspace.openTextDocument({
    language: selected.language,
    content: exportOfflineExample(experiment, selected.language),
  });
  await vscode.window.showTextDocument(document, { preview: false });
}
