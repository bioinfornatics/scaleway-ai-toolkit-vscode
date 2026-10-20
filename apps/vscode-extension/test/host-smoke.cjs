/** Real Extension Host smoke; run in an isolated VS Code profile. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vscode = require('vscode');
exports.run = async () => {
  const extension = vscode.extensions.getExtension('scaleway-ai-community-preview.scaleway-ai-toolkit-preview');
  assert.ok(extension, 'extension registered');
  await extension.activate();
  assert.ok(extension.isActive);
  const commands = await vscode.commands.getCommands(true);
  for (const id of ['scalewayAI.open', 'scalewayAI.playground', 'scalewayAI.cancel', 'scalewayAI.experiment']) assert.ok(commands.includes(id), id);
  await vscode.commands.executeCommand('scalewayAI.open');
  await vscode.commands.executeCommand('scalewayAI.select', 'demo-code');
  await vscode.commands.executeCommand('scalewayAI.cancel');
  if (process.env.SCALEWAY_PREVIEW_SMOKE_RESULT) fs.writeFileSync(process.env.SCALEWAY_PREVIEW_SMOKE_RESULT, JSON.stringify({status: 'passed', hostVersion: vscode.version, activation: true, commands: true, nativeViewOpen: true, selectedModelCommand: true, manualPlayground: 'not_run'}));
};
