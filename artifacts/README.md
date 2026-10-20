# Local VSIX artifacts

`scaleway-ai-toolkit-preview-0.0.19.vsix` is the generated installable user-browser-login preview (plus separate offline playground).
Binaries are ignored by Git; source and npm lockfile are committed. Rebuild with
`cd apps/vscode-extension && npm ci --ignore-scripts && npm run package`.

Install from VS Code Extensions -> Install from VSIX, or:

    code --install-extension artifacts/scaleway-ai-toolkit-preview-0.0.19.vsix

No Marketplace publication. See `../apps/vscode-extension/README.md` for the journey.
