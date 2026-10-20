# Scaleway AI Toolkit — Offline Preview 0.0.2

Experimental community VS Code extension, no Scaleway affiliation. No real model
connection, account calls, credentials, telemetry or Python dependency.

## Install and try

    code --install-extension artifacts/scaleway-ai-toolkit-preview-0.0.2.vsix --force

Reload Window after updating. Command Palette: **Scaleway AI: Open Offline Preview**.

- **Mes ressources**: offline context, synthetic models, last experiment.
- **Outils de développement**: Découvrir / demo catalogue; Construire et tester /
  model playground. Catalogue uses native Quick Pick, not a separate catalog page.
- **Aide et retours**: getting started and official documentation (opens browser
  only when clicked; extension itself makes no provider requests).

Select a model then open **Playground modèle** in the central editor. Enter an
instruction, press **Exécuter** or Ctrl+Enter. Response streams in the same editor.
**Arrêter** stops the synthetic stream; partial output is preserved.
**Ouvrir l’expérience JSON** opens an untitled editor; save only if you choose.
Closing the playground cancels its current run. No prompt/output automatically
saved; no state survives extension reload. Model selection alone never executes.

Resources/actions/help match the approved Foundry-inspired organization, not Azure
service parity. Agents/deployment/evaluation menus are absent until implemented.
UI uses VS Code theme tokens, native trees and keyboard controls. Webview has
nonce CSP, no network, textContent-only output and strict closed host messages.
This preview IPC is separate from advanced versioned runtime contracts.

## Build

    cd apps/vscode-extension
    npm ci --ignore-scripts
    npm run package

Private package, pinned tooling/npm lock; runtime uses VS Code/Node only. VSIX
excludes sources/tests/build dependencies. No publication, tag or push.

Next increment: real connection through SecretStorage and scoped model catalogue,
then explicitly bounded real inference. Optional Python agents/cloud hosting do
not gate this model-first workflow. Production/design/value approval remains
separate from this user-authorized incremental experimental implementation.
