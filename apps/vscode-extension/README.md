# Scaleway AI Toolkit — Preview 0.0.3

Experimental community VS Code extension; no Scaleway affiliation. Real **read-only
connection/project/model discovery** plus a separate **offline** playground.
No real inference, cloud writes, telemetry, OAuth browser login or Python runtime.

## Install

    code --install-extension artifacts/scaleway-ai-toolkit-preview-0.0.3.vsix --force

Reload Window after updating. Run **Scaleway AI: Open Offline Preview** to open the
sidebar (legacy command name retained).

## Connect and switch project

1. Mes ressources -> **Projet : sélectionner** -> native connection wizard.
2. Enter connection name, **organization UUID**, then **secret API key** in the
   masked field. Obtain these yourself from Scaleway console; never paste keys
   into chat/workspace/settings. Use a narrowly scoped key, not full owner rights.
3. Confirm bounded read-only listing of that organization’s projects (max 5 GET).
4. Select an accessible project then **fr-par** for dedicated resources.
5. Under Modèles click **Charger / actualiser les modèles** and confirm the
   read-only request scope (max 6 GET: 1 global serverless + up to 5 dedicated pages).

**Changer de projet** reuses the saved key. **Se connecter / changer de connexion**
replaces it through the same wizard. **Se déconnecter** deletes the saved key and
connection metadata, cancels pending reads and clears resource lists. Workspace
Trust is required for network connection; expanding native trees/startup never
fetches. Only one connection is stored in this increment. Project/region selection
is session-only; after reload select the project again. Name and organization ID
are saved in extension globalState, outside workspace; key only in SecretStorage.
With remote VS Code, extension runs in workspace host and uses its SecretStorage;
this is not a claim of local-machine isolation.

The Serverless list is **global and accessible to the key**, not proven project
availability. Dedicated entries are existing deployments filtered by selected
project/organization and fr-par, not dedicated model catalog entries. Empty and
failed lists are distinct; other services can fail independently. Model click
shows scope info only: **real models cannot yet execute in the playground**.
No quotas/prices/features inferred from GET discovery. A 403 may mean IAM policy
missing, not invalid key; no broad privilege escalation or automatic fallback.

Transport is fixed to api.scaleway.com (X-Auth-Token) and api.scaleway.ai (Bearer).
No arbitrary endpoint, redirects, retries or environment proxy inheritance.
Each GET has 10s deadline and 2MiB body bound; collections max5 sequential pages.
No body/header/error details logged. Local adapters use strict minimum projections,
not complete provider schemas; duplicate JSON keys/full production parser hardening
and full IAM/quota/private endpoint acceptance remain separate work.

## Offline playground

Mes ressources -> Démonstration hors ligne -> choose synthetic model.
Outils de développement -> Construire et tester -> **Playground modèle**.
Enter prompt, Exécuter/Ctrl+Enter; response stays in the central editor. Arrêter
preserves partial output. Open experiment JSON, save only if desired. Closing
playground cancels demo. No prompt/output automatically saved, no credential ever
passed to webview. Help/documentation opens browser only when explicitly clicked.

## Build

    cd apps/vscode-extension
    npm ci --ignore-scripts
    npm run package

Private package; no publishing/tag/push. Tests use synthetic keys and mocked
provider/VS Code interfaces; real account access and user login are not proven by
those tests. Native Extension Host startup is separately checked without keys.
Next increment is selected-real-model playground under explicit bounded spend,
not another hosted-agent spike. Production/design/value gates remain separate
from the requested experimental incremental implementation.
