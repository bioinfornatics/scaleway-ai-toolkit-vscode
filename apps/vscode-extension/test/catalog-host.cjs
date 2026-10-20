const assert = require('node:assert/strict');
const fs = require('node:fs');
const vscode = require('vscode');
exports.run = async () => {
  const extension = vscode.extensions.getExtension(
    'scaleway-ai-community-preview.scaleway-ai-toolkit-preview',
  );
  assert.ok(extension);
  await extension.activate();
  const result = await vscode.commands.executeCommand('scalewayAI.openCatalog');
  assert.ok(result.panelOpened);
  assert.ok(result.publicCount > 0, result.publicStatus);
  if (process.env.SCALEWAY_PREVIEW_SMOKE_RESULT)
    fs.writeFileSync(
      process.env.SCALEWAY_PREVIEW_SMOKE_RESULT,
      JSON.stringify({
        status: 'passed',
        version: extension.packageJSON.version,
        hostVersion: vscode.version,
        packagedPath: extension.extensionPath,
        catalogCommand: result,
        authentication: 'none',
        method:
          'actual packaged extension host command with live public adapter',
      }),
    );
  if (process.env.SCALEWAY_PREVIEW_KEEP_OPEN)
    await new Promise((r) => setTimeout(r, 15000));
};
