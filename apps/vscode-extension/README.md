# Scaleway AI Toolkit — Preview 0.0.6

Experimental community VS Code extension; no Scaleway affiliation. Real **read-only
connection/project/model discovery** plus a separate **offline** playground.
No real inference, cloud writes, telemetry, OAuth browser login or Python runtime.

## Install

    code --install-extension artifacts/scaleway-ai-toolkit-preview-0.0.6.vsix --force

Reload Window after updating. Run **Scaleway AI: Open Offline Preview** to open the
sidebar (legacy command name retained).

## Connect and switch project

1. Mes ressources -> **Configurer une clé API**, ou **Projet : sélectionner** si aucune connexion configurée.
2. Saisir le nom, l’UUID d’organisation puis le secret API dans le champ masqué.
3. Confirmer la lecture limitée des projets, puis choisir le projet et fr-par.
4. Modèles -> Charger / actualiser les modèles et confirmer les lectures.

**Un seul mécanisme : clé API.** Aucun navigateur n’est ouvert par ce parcours,
aucune connexion OAuth, récupération JWT/cookie ou mot de passe Scaleway.
L’action séparée **Aide et retours -> Comment obtenir une clé API** ouvre uniquement
la documentation officielle. Elle ne connecte pas l’extension et n’attend aucun
retour navigateur. Une session console Scaleway n’est pas une connexion API VS Code.

La clé est conservée dans SecretStorage uniquement ; nom et organisation dans
globalState, pas le workspace. Projet session-only. Changer de projet réutilise la
clé ; Supprimer la connexion API efface la clé/métadonnées et annule les lectures.
Une seule connexion dans cette version. Workspace Trust requis pour les lectures.
Les arbres ne chargent rien automatiquement. Utilisez une clé à droits limités et
ne la transmettez jamais dans le chat/fichiers. Sur VS Code distant, stockage et
transport suivent l’extension host distant, pas une garantie d’isolation locale.

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

## Brand asset notice

Scaleway mark sourced from official website favicon assets; rights remain with
Scaleway. Used at maintainer request for local experimental identification, not
endorsement or official extension. Publication requires separate brand review.
ai-PULSE event branding not used. Source/hash provenance is recorded in the repo
at evidence/documentation/scaleway-icon-preview-v1.json.
