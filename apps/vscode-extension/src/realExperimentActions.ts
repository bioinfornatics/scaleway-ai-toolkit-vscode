import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { readBoundedExperimentFile } from './boundedExperimentRead';
import { exportRealExample } from './realExperimentExports';
import {
  decodeRealExperiment,
  encodeRealExperiment,
  type RealExperiment,
} from './realExperiments';

async function acknowledge(): Promise<boolean> {
  return (
    (await vscode.window.showWarningMessage(
      'Prompts and outputs are explicitly included. Review sensitive data before saving or sharing. No hidden storage, execution or restored authority.',
      { modal: true },
      'Open document',
    )) === 'Open document'
  );
}
/** Native Save As owns destination and overwrite. Do not claim a saved result. */
export async function saveRealExchange(
  snapshot: RealExperiment,
): Promise<void> {
  const content = Buffer.from(encodeRealExperiment(snapshot)).toString('utf8');
  if (!(await acknowledge())) return;
  const document = await vscode.workspace.openTextDocument({
    language: 'json',
    content,
  });
  await vscode.window.showTextDocument(document, { preview: false });
  await vscode.commands.executeCommand('workbench.action.files.saveAs');
}
/** Never return imported data to an invocation controller. */
export async function reviewRealSnapshot(): Promise<void> {
  const uris = await vscode.window.showOpenDialog({
    title: 'Load snapshot (review only)',
    canSelectMany: false,
    canSelectFiles: true,
    canSelectFolders: false,
    filters: { 'Snapshot JSON': ['json'] },
  });
  if (uris?.length !== 1) return;
  const uri = uris[0];
  if (uri.scheme !== 'file') throw new Error('invalid_snapshot_file');
  const bytes = await readBoundedExperimentFile(uri.fsPath);
  const snapshot = decodeRealExperiment(bytes);
  if (!snapshot) throw new Error('invalid_snapshot_file');
  if (!(await acknowledge())) return;
  const content = Buffer.from(encodeRealExperiment(snapshot)).toString('utf8');
  const scheme = `scaleway-snapshot-${randomUUID()}`;
  const reviewUri = vscode.Uri.parse(`${scheme}:/review-only.json`);
  const provider = vscode.workspace.registerTextDocumentContentProvider(
    scheme,
    { provideTextDocumentContent: () => content },
  );
  let closed: vscode.Disposable | undefined;
  try {
    closed = vscode.workspace.onDidCloseTextDocument((document) => {
      if (document.uri.toString() === reviewUri.toString()) {
        provider.dispose();
        closed?.dispose();
      }
    });
    const document = await vscode.workspace.openTextDocument(reviewUri);
    await vscode.window.showTextDocument(document, { preview: false });
  } catch {
    provider.dispose();
    closed?.dispose();
    throw new Error('snapshot_review_unavailable');
  }
}
export async function exportRealExchange(
  snapshot: RealExperiment,
): Promise<void> {
  const selected = await vscode.window.showQuickPick(
    [
      {
        label: 'Python · source only · mock default',
        language: 'python' as const,
      },
      {
        label: 'TypeScript · source only · mock default',
        language: 'typescript' as const,
      },
    ],
    { title: 'Export example (opens source; never executes)' },
  );
  if (!selected) return;
  const content = exportRealExample(snapshot, selected.language);
  if (!(await acknowledge())) return;
  const document = await vscode.workspace.openTextDocument({
    language: selected.language,
    content,
  });
  await vscode.window.showTextDocument(document, { preview: false });
}
