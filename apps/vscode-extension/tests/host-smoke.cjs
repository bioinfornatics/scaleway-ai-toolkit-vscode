const assert = require('node:assert/strict');
const fs = require('node:fs');
const vscode = require('vscode');
exports.run = async () => {
  const extension = vscode.extensions.getExtension(
    'scaleway-ai-community-preview.scaleway-ai-toolkit-preview',
  );
  assert.ok(extension);
  await extension.activate();
  assert.ok(extension.isActive);
  const commands = await vscode.commands.getCommands(true);
  for (const id of [
    'scalewayAI.open',
    'scalewayAI.playground',
    'scalewayAI.cancel',
    'scalewayAI.experiment',
    'scalewayAI.catalog',
    'scalewayAI.getStarted',
    'scalewayAI.login',
    'scalewayAI.switchProject',
    'scalewayAI.loadModels',
    'scalewayAI.disconnect',
    'scalewayAI.revokeAPIKey',
    'scalewayAI.useServerless',
    'scalewayAI.deployModel',
    'scalewayAI.openService',
  ])
    assert.ok(commands.includes(id));
  await vscode.commands.executeCommand('scalewayAI.open');
  await vscode.commands.executeCommand('scalewayAI.select', 'demo-code');
  await vscode.commands.executeCommand('scalewayAI.playground');
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await vscode.commands.executeCommand('scalewayAI.cancel');
  await extension.activate();
  if (process.env.SCALEWAY_PREVIEW_SMOKE_RESULT)
    fs.writeFileSync(
      process.env.SCALEWAY_PREVIEW_SMOKE_RESULT,
      JSON.stringify({
        status: 'passed',
        hostVersion: vscode.version,
        activation: true,
        commands: true,
        nativeViewOpen: true,
        centralPlaygroundCommand: true,
        manualPlayground: 'not_run',
      }),
    );
};
