# Scaleway AI Toolkit — Preview 0.0.32

Experimental community VS Code extension; no Scaleway affiliation. **User browser
login without API keys**, scoped read-only projects/dedicated deployments and a
separate **offline synthetic** playground. No real inference or cloud writes.

## Install and try

    code --install-extension artifacts/scaleway-ai-toolkit-preview-0.0.32.vsix --force

Reload Window, then **Scaleway AI: Open Offline Preview** (legacy command name).

1. Click **Définir le projet Scaleway** -> **Changer de projet** for cloud resources.
   **Catalogue de modèles** opens immediately without login; its project button
   enables dedicated discovery. **Modèles** retains account-required resource loading.
   Account-required commands trigger login automatically when disconnected. There
   is no standalone login/session row in the sidebar. Login remains available in
   the Command Palette; documentation and offline demo do not require an account.
2. Confirm browser opening. Sign in on **account.scaleway.com**, not inside VS Code.
3. The browser returns the user JWT automatically to a temporary local callback.
   Return to VS Code; no token/password/key to copy or paste.
4. Select an organization **by name** from the dynamic IAM user-connections list.
   No UUID input or visit to the console is needed. Select one of its projects.
5. Charger les modèles silently lists dedicated deployments of that project in
   **fr-par** (up to 5 sequential GET), with inline loading state. No inference.

Browser credentials/MFA stay on Scaleway. The extension neither
creates an API key nor imports old keys. Successful login/disconnect deletes the
legacy preview API-key SecretStorage entry and connection metadata.

## Session and transport

Source-backed mechanism: Scaleway CLI login uses
https://account.scaleway.com/authenticate with redirectToUrl, receiving a Base64
JSON envelope with token/jwt/renewToken. We omit its subsequent CreateAPIKey step.
The SDK maps user JWT to **X-Session-Token**, not X-Auth-Token or Bearer for control
APIs. References and pinned hashes: evidence/documentation/scaleway-user-login-v1.json.
This is called **Scaleway user login**, not a verified OAuth authorization-code/
PKCE integration. No undocumented OAuth parameters or renewal endpoint invented.

JWT, user ID and expiration are persisted through **VS Code SecretStorage**.
No JWT in plaintext config, globalState, logs, webview or chat. renewToken is still
discarded; persistence does not extend token lifetime. Shape and expiry are checked
locally, not signature authenticity: Scaleway validates authenticity/IAM on requests.
Session drops 30s before the earlier of JWT exp and envelope expiry.

On activation in local VS Code, a valid saved session is restored without HTTP.
The selected organization UUID and project ID/name are stored in globalState,
bound to the connected user ID, never Settings Sync-enrolled by this extension.
They are preferences, not proof of current access: API reads still enforce IAM.
Project names may be stale until the next explicit project refresh. Changing
project lists organizations linked to the user via SDK-backed IAM
GET /iam/v1alpha1/users/{user_id}/connections (one GET). Names and IDs are shown
in a native selector; locked organizations are excluded. Names/UUID and selected
project are persisted per user. No membership creation, joining or user-token
exchange is performed. Cross-organization project access depends on the current
JWT/IAM: listing a connection alone does not prove project access. An empty/error
list is reported, not replaced by a manual UUID prompt. Live acceptance of this
endpoint remains to be verified with your session.

Reload/restart preserves session and choices. Expiry/401/403 deletes the saved JWT;
explicit Disconnect removes JWT and current-user preferences. Shutdown only clears
memory. Disconnect does not revoke the provider token or log out of the browser.
Storage failure reports a safe error; no plaintext-file fallback is attempted.

On Linux use a real keyring backend compatible with freedesktop **Secret Service**
(e.g. GNOME Keyring). VS Code supports password-store gnome-libsecret. The basic
backend is obfuscation, not secure encryption, and is not suitable for tokens.
SecretStorage abstracts platform storage: this extension cannot verify the actual
backend or guarantee the token appears as an individual Secret Service item.
We do not silently modify VS Code runtime arguments or call D-Bus directly.
See https://code.visualstudio.com/docs/configure/settings-sync#_troubleshoot-credentialstore-issues
and https://code.visualstudio.com/api/references/vscode-api#SecretStorage.
Backend correctness on your machine remains a manual check; secrets are not synced
across machines by SecretStorage. Real-keyring persistence has not been tested here.

Callback: IPv4 loopback only, OS-selected port, localhost redirect, random 192-bit
path correlation inside redirectToUrl, exact path/Host/peer/method, no Origin or
request body, bounded headers/query, one successful consumption, 3-minute timeout,
cancel and cleanup. No callback query/token logging. Success page has no-store,
no-referrer and nonce CSP and replaces the credential URL in browser history.
The provider's acceptance of the randomized localhost callback path remains to
be verified live; this is not a provider-verified state/PKCE guarantee. Like the
CLI flow, token arrives in a URL; localhost processes and browser machinery are
part of the trust boundary. Invalid callbacks do not consume the pending login.

**Local desktop VS Code only for browser login in this preview.** Remote SSH,
WSL, Containers and Codespaces hosts are blocked rather than opening an unusable
remote loopback callback. Workspace Trust required. Startup and tree navigation
make no API requests. A connected user session is not automatically permission
to run inference or mutate resources.

Control GET uses fixed api.scaleway.com routes, no retries/redirects/proxy env,
10s request deadline, 2MiB response limit, max5 sequential pages per collection.
No response body/header/error details logged; safe error codes only. A 401/403
drops the local session; check IAM/organization and reconnect, no key fallback.
Local minimum projections are not full production wire-schema validation.

## Model catalogs versus deployments

**Catalogue de modèles** now opens a persistent searchable central editor catalog, not the
existing deployment list. Mes ressources -> Modèles separates:

- **Serverless · catalogue**: public commercial Generative APIs offerings in fr-par,
  from GET /product-catalog/v2alpha1/public-catalog/products?product_types=generative_apis&region=fr-par.
  Input/output/cache/batch SKUs are grouped by product name; lifecycle statuses are
  preserved, including deprecated offerings. Catalog presence does not prove
  account access, active serving or suitability of that name as inference ID.
  No prices or feature compatibility are inferred from grouped variants.
- **Modèles dédiés à déployer**: GET regional /inference/v1/regions/fr-par/models,
  scoped by selected project/organization. Returned selected-project records and
  provider zero-project sentinel records are kept separate by provenance label.
  Zero sentinel support is based on prior observed catalog evidence; the semantics
  are not a blanket permission to accept arbitrary foreign-project models.
- **Déploiements dédiés**: existing resources in selected project/fr-par only,
  not a catalog. Empty result reads **Aucun déploiement**; error is not empty.

Model refresh loads public catalog, dedicated catalog then existing deployments
sequentially, at most 5 pages per collection (15 GET total), only on explicit action.
Catalogue de modèles loads catalogs only (max10 GET), then updates the catalog panel.
Each catalog has independent loading/error/empty states. Public route sends **no
credential**, even when logged in; user JWT is used only for reviewed control routes.
Public catalog opens immediately without an account/project gate. It loads independently
of pending secure storage or account work. Selecting a project from the catalog
initiates the browser/organization/project journey for dedicated discovery.

Public catalog was checked with unauthenticated HTTP and the actual extension
adapter. Dedicated catalog/deployment JWT access remains unverified live in this
increment. Source records: evidence/documentation/scaleway-model-catalog-v1.json.
**No JWT is sent to api.scaleway.ai**; inference JWT support remains unverified.
Clicking a real model shows offering/scope information only. The playground is
still synthetic; no model invocation, deployment creation, EULA acceptance or
other resource write is performed. No API-key fallback.

## Offline playground

Mes ressources -> Démonstration hors ligne -> choose a synthetic model.
Outils de développement -> Construire et tester -> **Playground modèle**.
Enter prompt, Exécuter/Ctrl+Enter; Arrêter preserves partial output. Open experiment
JSON and save only if desired. Closing the panel cancels the demo. No prompt/output
automatically saved, no credentials passed to the webview, no API usage/billing.

## Build and verification

    cd apps/vscode-extension
    npm ci --ignore-scripts
    npm run package

Private package; no Marketplace/npm publication, tag or push. Tests use synthetic
JWTs, mocked VS Code/provider and real loopback HTTP callbacks. Passing tests do
not establish real Scaleway sign-in, callback acceptance or API compatibility.
User test needed: browser login -> automatic return -> scoped projects -> dedicated
reads -> disconnect. Do not share token, callback URL, passwords or cookies.
Next increment depends on this real-account feedback and establishing JWT model
access; no API-key substitution. Production/design/value gates remain separate.

## Brand asset notice

Scaleway mark comes from official website favicon assets. Rights remain with
Scaleway; local experimental identification only, not endorsement. Publication
requires separate brand review. ai-PULSE event branding not used. Asset provenance:
evidence/documentation/scaleway-icon-preview-v1.json.

## Preview 0.0.32 navigation and catalog visibility fix

Resources now separate **Projet Scaleway**, **Modèles**, **Récents**, and
**Ressources locales** (synthetic demo). Developer tools separate **Découvrir**
(real model catalog) and **Construire** (model playground). No advanced empty
agent/tools/knowledge/evaluation/monitor menus. Project chooser offers Switch;
Create project is unavailable until its guarded write workflow is implemented.
See specifications/project-selection.md for design and limits.

The catalog is a persistent editor with searchable text-only cards, independent
public and dedicated status, refresh and project controls. It opens before HTTP,
not after waiting for account/project/dedicated reads. Public requests coalesce
and do not wait for pending SecretStorage. Untrusted workspace displays an explicit
explanation; approve the workspace for HTTP. Dedicated errors do not hide public
offers. No credentials or provider endpoint input in the catalog webview.

Packaged extension host catalog command (0.0.14 and final0.0.32) verified live public
33 offerings in isolated trusted test workspace. This is stronger than standalone
adapter testing, but it does not prove screenshot card rendering, keyboard/theme
review or actual-account dedicated acceptance; those checks remain outstanding.

## Qualité du code

Biome 2.5.15 (dépendance de développement épinglée) contrôle les sources TypeScript,
les scripts/CSS des webviews, les tests et les JSON du projet. Les sorties générées,
le lockfile, les dépendances et les logos sont hors périmètre.

- npm run check : formatage, lint recommandé et imports, sans modification ; avertissements bloquants.
- npm run lint : lint seul, sans modification.
- npm run format : appliquer le formatage.
- npm run package : contrôle Biome, compilation stricte et tests avant génération du VSIX.

Biome et sa configuration ne sont pas embarqués dans le VSIX.

### Types Node dans l’éditeur

Le tsconfig de ce paquet déclare explicitement les types node et vscode ; les
modules du processus Extension Host importent Buffer depuis node:buffer.
@types/node est déjà une dépendance de développement épinglée. Depuis ce dossier,
utilisez npm ci --ignore-scripts pour restaurer les dépendances si nécessaire.
Si une erreur de types persiste uniquement dans VS Code, ouvrez le fichier sous
src puis utilisez « TypeScript: Go to Project Configuration » pour vérifier le
projet associé, et « TypeScript: Restart TS Server » pour actualiser le service.
Biome ne remplace pas le contrôle des types effectué par npm run build.

### Offres retirées

Le catalogue central et la navigation des modèles masquent les offres dont tous
les statuts sont retired, end_of_life ou eol. Un produit regroupant une variante
retirée et une variante active reste visible. Les statuts inconnus restent visibles
sans garantie de disponibilité. Les données API brutes sont conservées et les
déploiements existants ne sont jamais masqués par ce filtre.

### Interagir avec les cartes du catalogue

Chaque carte propose « Voir les détails », accessible avec Tab puis Entrée/Espace.
La fiche dans le même catalogue indique le statut, la source, le périmètre et les
limites des actions disponibles. Fermer revient au bouton d’origine (ou à la
recherche après une actualisation). Les informations sont résolues depuis le
catalogue du processus hôte, pas depuis des métadonnées envoyées par la webview.
Aucun test d’inférence ou déploiement n’est déclenché. Le playground synthétique
n’est pas présenté comme un test du modèle réel.

### Disponibilité et déploiement

Mes ressources → Modèles sépare les offres Serverless disponibles, les modèles
dédiés à déployer et les déploiements dédiés existants. Le statut ready d’un modèle
catalogue n’est pas un endpoint déployé ; un déploiement existant peut encore être
en création ou en erreur. Serverless n’implique pas une allocation GPU dédiée.
Le parcours dédié attendu est modèle → infrastructure compatible → coût/licence/
réseau → confirmation → déploiement → endpoint utilisable. Ce parcours de création
reste à implémenter ; cette version apporte la distinction, pas la création cloud.

### Préparer un déploiement dédié

Sur une carte dédiée : « Préparer le déploiement », ou Construire → Préparer un
déploiement dédié. L’action déclenche la connexion/le choix du projet si nécessaire,
puis relit le catalogue, les types de nœuds en fr-par et les prix publics dédiés (maximum 15 GET séquentiels,
sans confirmation ni progression pour les lectures). Aucun HTTP au démarrage.

L’assistant propose les configurations ready, explicitement compatibles, activées
et en stock available/low_stock, avec les bits et le contexte fournis par l’API.
Il recueille le nom, le réseau public/privé protégé par IAM et votre plafond horaire
EUR. Ce plafond n’est PAS un tarif Scaleway ni un plafond appliqué côté fournisseur.
L’UUID du réseau privé est une référence candidate, pas une preuve d’appartenance.

La confirmation ouvre un JSON local non exécutable : prix dédié, quota, conditions
EULA et contrat de création restent à vérifier. Aucun POST, acceptation EULA,
déploiement, réseau, endpoint ou coût n’est déclenché. Un changement de compte,
projet, confiance ou une annulation stoppe le parcours. Aucun JWT dans le plan.

### Explorer les déploiements existants

Un clic sur une ressource « Dédiés · déploiements existants » relit son détail
avec un seul GET du contrôle Scaleway, puis ouvre un JSON natif en lecture seule
(copie éditable, aucune mise à jour cloud). Le document inclut le modèle exact,
le nœud, le statut, l’heure de récupération et les endpoints retournés par l’API.
Les endpoints indiquent public/privé et IAM/désactivé. Métadonnées manquantes
restent inconnues ; les URLs ambiguës ou portant des identifiants sont rejetées.
Aucun endpoint n’est sondé, aucune inférence, URL construite ou création.

### Sauvegarder, reprendre et exporter une expérience hors ligne

Après une démonstration, Construire propose « Enregistrer l’expérience » et
« Exporter Python / TypeScript (hors ligne) ». La sauvegarde ouvre le JSON exact
puis la boîte native Enregistrer sous : VS Code gère les confirmations d’écrasement.
Il n’y a ni persistance automatique des instructions ni écriture cachée.
« Reprendre une expérience hors ligne » importe un JSON local (128 Kio maximum),
valide strictement le schéma, restaure modèle/instruction/réponse sans lancer de run.
Les champs supplémentaires, modes réels ou secrets structurés sont refusés.
Les instructions/réponses saisies peuvent contenir des données sensibles : relisez
le contenu avant d’enregistrer/exporter ; aucun détecteur ne garantit leur absence.

Les scripts Python et TypeScript produits rejouent uniquement les données de cette
expérience synthétique ; ils ne sont pas des appels au modèle Scaleway réel.
Exécution indépendante : python3 experiment.py ou
node --experimental-strip-types experiment.ts (Node >=22.6). L’outillage utilise
vsce4.0.0 (Node >=22), épinglé après revue : audit npm zéro vulnérabilité à cette date.

### Créer un projet depuis le sélecteur

Définir le projet → Créer un projet liste vos organisations par nom, recueille le
nom puis demande une confirmation finale explicite avec organisation et effet.
Cette confirmation seule déclenche un POST /account/v3/projects (délai10s, aucune
redirection ni nouvelle tentative). L’action crée uniquement le projet, pas un GPU,
modèle, endpoint, réseau ou clé. Elle exige une session utilisateur valide et un
workspace approuvé. La permission IAM est contrôlée par Scaleway.

Seule une réponse vérifiée (UUID/nom/organisation) devient le défaut. Sur transport
ambigu, erreur serveur ou réponse invalide, l’ancien défaut est conservé : relisez
les projets avec Changer de projet avant de recréer. Annuler après l’envoi ne peut
pas annuler l’effet cloud ; un résultat inconnu n’est pas un échec garanti.
L’agent n’a pas exécuté de création réelle. La conformance IAM/JWT/live reste à tester.

### Suivre un déploiement existant

Construire → Suivre un déploiement existant sélectionne une ressource déjà chargée
et effectue au maximum5 GET séquentiels, espacés de15 secondes. L’état et les
endpoints restent liés au projet/fr-par. Arrêter le suivi annule uniquement les
lectures, jamais le déploiement. Aucun suivi au démarrage ni endpoint sondé.
ready ne prouve pas la joignabilité/l’inférence ; limite atteinte et erreurs sont
explicites, avec dernier état potentiellement périmé.

Le moteur interne de création/revue est testé avec transports injectés : plafond
exact, prix/quota/droits/licence confirmés et frais, journal avant l’envoi, un seul
envoi et état inconnu non resoumis. Il n’est PAS relié à un POST cloud dans cette
version : contrat EULA et source de prix/quota restent à compléter. Les plans
JSON importés ne sont jamais une autorisation. La préparation locale reste disponible.

Le journal interne des opérations de déploiement dispose maintenant d’un adaptateur persistant borné par utilisateur/organisation/projet. Une soumission interrompue est récupérée comme résultat inconnu, sans relance automatique. Cet adaptateur n’est pas encore raccordé à une création dédiée payante.

### Reprise des opérations

Dans Construire, Reprendre les opérations de déploiement lit uniquement le journal local du compte/projet courant, sans connexion ni HTTP automatique. Retrouver une ressource acceptée effectue un seul GET sur un ID enregistré après succès ; aucun rapprochement par nom, aucune relance de création, aucun sondage de l’endpoint. Le moteur interne utilise désormais ce journal ; la création dédiée payante reste non raccordée. Une réponse tardive après déconnexion conserve son ID dans le journal d’origine sans rétablir la session.

### Prix dédiés publics

La préparation relit les offres managed_inference sans JWT. Elle conserve les montants EUR units+nanos exacts, la mesure node, le SKU et l’horodatage. Lorsque SKU, type de nœud, région et montant correspondent exactement aux données officielles de prix épinglées au 21 octobre 2026, elle affiche aussi le montant par minute et son équivalent horaire HT sans arrondi. Cela reste une corroboration publique datée, pas le prix effectif du compte ni une autorisation de création. Un montant modifié invalide la corroboration. La FAQ officielle précise la facturation à la durée (minutes), après disponibilité, y compris sans trafic ; aucun arrêt automatique au plafond saisi. Quotas, droits, EULA et confirmation finale restent à vérifier.

### Quotas de l’organisation (lecture explicite)

Construire → Examiner les quotas de l’organisation effectue au maximum5 GET séquentiels sur IAM /quota pour l’organisation du projet choisi. La commande passe par la connexion utilisateur et la sélection du projet, sans confirmation GET répétée ni lecture automatique au démarrage. Le document distingue limites historiques, limites globales/régionales/zonales, zéro et unlimited. Les grands uint64 sous forme de chaînes restent exacts ; un nombre JSON déjà imprécis est rejeté. Usage courant, capacité restante, correspondance aux nœuds dédiés et droits de création restent inconnus. Aucune modification IAM ni création. Aucun JWT n’est inséré dans le document.

### Lire une EULA

Les cartes de modèles dédiés dont has_eula=true proposent Lire l’EULA. Construire propose aussi un choix parmi les modèles chargés concernés. La commande lit une seule fois la route officielle /models/{model_id}/eula, puis ouvre le contenu fournisseur en texte brut (maximum256KiB), avec SHA256 et provenance modèle/projet/horodatage. Aucune interprétation HTML, aucune exécution des instructions du texte, aucune acceptation ni persistance automatique. Sans modèle chargé, inconnu ou sans EULA, aucun GET effectué. Le JWT reste dans l’hôte. La compatibilité JWT réelle de cette route reste à confirmer avec le compte utilisateur ; aucun fallback API-key.
