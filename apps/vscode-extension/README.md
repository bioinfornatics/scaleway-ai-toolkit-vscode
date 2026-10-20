# Scaleway AI Toolkit — Offline Preview 0.0.1

First **installable experimental VS Code extension**. Community project, no
Scaleway affiliation. Local-only evaluation artifact, not Marketplace release or
production provider compatibility. No cloud requests, credentials, Python or tools.

## Try the VSIX

From the repository root:

    code --install-extension artifacts/scaleway-ai-toolkit-preview-0.0.1.vsix

Alternatively: Extensions -> ... -> Install from VSIX, select the file.
Reload VS Code if requested. Open Command Palette and run
**Scaleway AI: Open Offline Preview**. The activity bar view lists two clearly
synthetic models. Click one to select it, then:

1. Run **Scaleway AI: Run Offline Playground** (palette or view title).
2. Enter a short prompt. Watch the simulated stream in the Output panel.
3. Cancel via the progress notification or **Scaleway AI: Cancel Demo**.
4. Run **Scaleway AI: Open Last Experiment** to inspect JSON in an untitled editor;
   Save As only if you choose to persist your prompt/output.

Prompts/last experiment remain in memory until reload/deactivation. No automatic
workspace/globalState persistence or telemetry. Output does not echo the prompt.
One demo at a time. Selection does not execute a model. All results explicitly
say synthetic/offline; no fake provider prices, quota, usage or deployment status.

## Development

    cd apps/vscode-extension
    npm ci --ignore-scripts
    npm test
    npm run package

Node 22 tooling; TypeScript; npm lockfile. VSIX has only compiled JS, manifest,
icon and documentation; build dependencies and tests excluded. Private npm package;
no npm/Marketplace publication, release tag or push configured.

Development host without installing into your normal profile:

    code --new-window --extensionDevelopmentPath=/absolute/path/to/apps/vscode-extension

## Incremental direction

This delivers a visible model-first slice, not advanced agent hosting. Next useful
increment: real connection via host SecretStorage and scoped read-only model list;
then bounded, explicitly authorized real model streaming. Saved experiments and
standalone export follow. Cloud hosting and Python agents are not prerequisites.
No webview is needed yet: native views, input, progress, Output and editors reuse
VS Code accessibility/themes. Existing production/design/value acceptance remains
separate from this explicitly requested experimental VSIX.
