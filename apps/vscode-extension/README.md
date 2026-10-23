# Scaleway AI Toolkit

Découvrez les modèles Scaleway, préparez des projets Agents ou Outils et réutilisez vos templates dans VS Code.

Extension communautaire en preview, sans affiliation officielle à Scaleway. Les bases générées doivent être configurées et vérifiées avant utilisation.

## Installer

Prérequis : VS Code 1.96 ou supérieur. La création de fichiers et les bibliothèques de templates nécessitent un workspace local Linux approuvé. Aucun SDK agent n’est requis pour parcourir le catalogue.

1. Ouvrez **Extensions → … → Installer à partir d’un VSIX**.
2. Sélectionnez le fichier VSIX fourni avec la livraison.
3. Lancez **Developer: Reload Window** depuis la palette de commandes.
4. Ouvrez la vue **Scaleway AI** dans la barre d’activité.

## Choisir le bon espace

| Espace | Contenu |
| --- | --- |
| Découvrir → Catalogue de modèles | Offres de modèles, détails et tarifs |
| Construire | Création locale d’un agent ou d’un outil ; playground modèle |
| Ressources locales → Agents / Tools | Projets détectés dans les dossiers du workspace |
| Mes templates → Agents / Tools | Bases personnelles réutilisables |
| Mes ressources → Clés API | Inventaire IAM et présence du secret local |
| Mes ressources → Déploiements dédiés | Services dédiés du projet |
| Mes ressources → Agents / Tools | Emplacement des ressources cloud ; inventaire encore indisponible |

Un modèle sélectionné n’est pas un déploiement. Un projet local n’est pas une ressource cloud. Un template n’est pas un projet exécutable.

## Créer un agent ou un outil

1. Ouvrez **Construire → Créer un agent** ou **Créer un tool**.
2. Sélectionnez **Python**, **TypeScript** ou **Rust**.
3. Pour un agent, choisissez séparément le **Backend** et le **Framework IA**, puis renseignez le **Nom de l’agent**. Par exemple : Python + FastAPI + Strands.
4. Choisissez un modèle du catalogue **Serverless**, ou un **Déploiement dédié** du projet. À la confirmation de création, choisissez une clé API locale réutilisable, ou importez/générez explicitement une clé. Le modèle et la clé sont des choix distincts ; les anciens secrets restent conservés.
5. Pour un outil, choisissez un framework compatible. Vous pouvez aussi partir d’un template prédéfini ou personnel.
6. Consultez les fichiers proposés.
7. Pour un agent, choisissez le **Dossier parent du projet** dans le formulaire (le workspace unique est présélectionné), puis cliquez sur **Créer** et confirmez les fichiers. Le nom de l’agent devient le sous-dossier créé à cet emplacement. Aucun second sélecteur de destination n’apparaît après Créer. Pour un outil, le choix du workspace et du nom reste dans le parcours de création.

Si la liste est vide, ajoutez un modèle Serverless à **Mes ressources** avec **Utiliser**, ou déployez un service dédié depuis le catalogue, puis ouvrez la liste pour l’actualiser. La création de template reste possible sans modèle.

Résultat : la base choisie est générée dans le nouveau dossier avec le nom du projet. Aucun fichier existant n’est remplacé. La génération seule n’installe aucune dépendance, ne lance aucun code et ne crée aucune ressource cloud.

### Frameworks disponibles

| Langage | Bases SDK pour Agents | Bases backend pour Agents et Outils |
| --- | --- | --- |
| Python | Strands, LangChain | FastAPI, Django |
| TypeScript | LangChain, Strands, Mastra | NestJS, ElysiaJS avec Bun |
| Rust | Aucune base SDK agent | Axum, Actix Web |

Une base sans framework est également disponible pour chaque langage. Les outils ne proposent pas les SDK agents. Pour les agents, les fichiers backend et SDK sont réunis dans le projet ; leur raccordement reste à compléter. Python utilise src/agent_app/api.py pour le backend et src/agent_app/agent.py pour le SDK ; TypeScript utilise src/agent.ts et src/agent-sdk.ts. Un template personnel conserve son langage. La version 1 est copiée telle quelle ; la version 2 permet une injection explicite de variables.

**Après création :** lisez le README du projet, configurez les dépendances et le modèle, puis vérifiez le code avant de le lancer. Les bases backend nécessitent l’intégration du SDK agent ou du transport outil/MCP. Les bases SDK nécessitent encore le raccordement à Scaleway et la configuration du runtime.

## Configuration privée de l’agent

À la confirmation de création, la clé API choisie et revalidée est copiée dans un **.env local privé**, avec le modèle et son endpoint :

```dotenv
SCW_INFERENCE_BASE_URL='https://api.scaleway.ai/<projet>/v1'
SCW_INFERENCE_MODEL_ID='deepseek-v4.1-flash'
SCW_API_KEY='<clé API choisie>'
```

Le fichier est créé sans remplacement, avec des permissions 0600 sur Linux. La règle /.env est ajoutée à .gitignore. Un template qui contient déjà un .env est refusé pour éviter une collision.

**La clé est en clair dans ce fichier.** Ne partagez pas le dossier sans retirer le .env. L’exclusion Git n’empêche pas les sauvegardes ou les autres programmes locaux de le lire. La déconnexion de l’extension ne supprime pas la copie ; la révocation distante invalide la clé, mais ne supprime pas le fichier.

La clé n’entre jamais dans Mustache, les templates enregistrés, les aperçus ou les exports de bibliothèque. La création d’un template ou d’un outil ne copie aucune clé. Un service dédié nécessite un endpoint public IAM non ambigu ; aucun endpoint privé n’est choisi automatiquement.

Les bases générées doivent encore charger ce fichier selon leur runtime et intégrer les contrôles du modèle. La présence du .env ne rend pas l’agent exécutable.

## Ouvrir le projet et installer ses dépendances

Après création, choisissez **Ouvrir le projet** ou **Installer les dépendances**. L’installation demande une confirmation séparée et apparaît dans une tâche VS Code.

| Langage | Gestionnaire | Manifeste | Commande proposée |
| --- | --- | --- | --- |
| Rust | Cargo | Cargo.toml | cargo fetch |
| Python | uv | pyproject.toml | uv sync |
| TypeScript | Bun | package.json | bun install |

Installez le gestionnaire sur l’hôte où fonctionne l’extension avant de lancer cette action. Les commandes peuvent télécharger des paquets et exécuter leurs scripts de construction. Aucun agent n’est lancé. La tâche affiche les erreurs, notamment si le gestionnaire est absent.

Les bases Python fournies conservent requirements.txt et ajoutent pyproject.toml pour uv. Les noms de paquets sont normalisés en minuscules avec des tirets.

### Structure des agents Python fournis

```text
pyproject.toml          # package installable : Hatchling + uv
requirements.txt       # dépendances du backend / SDK
src/agent_app/          # package importable, nom fixe agent_app
  config.py            # lecture explicite de la configuration
  api.py / agent.py    # selon le backend et le SDK choisis
tests/unit/            # tests pytest hors ligne
tests/integration/     # emplacement documenté, raccordement à écrire
evals/                 # squelette d’évaluation optionnelle
```

Le nom de distribution correspond au nom du projet normalisé ; les imports
utilisent toujours `agent_app`. `uv sync` installe le package et le groupe
`dev` contenant pytest. Après installation, lancez `uv run pytest`. Les tests
fournis vérifient uniquement la configuration, sans réseau, SDK ni secret.
Le `.env` n’est pas chargé automatiquement par ces modules.

**DeepEval est optionnel** : son groupe `eval` n’est pas installé par défaut.
Après revue des dépendances, `uv sync --group eval` permet de l’ajouter.
`uv run pytest evals -m integration` ignore le squelette sans opt-in.
Avec `AGENT_RUN_EVALS=1`, celui-ci échoue volontairement tant que l’adaptateur
d’évaluation n’a pas été implémenté : aucun score artificiel ni appel LLM
automatique. Consultez `evals/README.md` avant tout raccordement et appel payant.

Cette structure concerne les **agents Python embarqués uniquement**. Les tools
et les templates personnels conservent leur structure déclarée. Les bases
restent à raccorder au backend, au SDK et aux contrôles de dispatch avant usage
réel ; les tests de configuration ne certifient pas ce runtime.


## Retrouver ses projets locaux

1. Ouvrez **Ressources locales → Agents / Tools**.
2. Actualisez après avoir ajouté un projet au workspace.
3. Ouvrez ses fichiers depuis la table pour les modifier dans l’éditeur.

La table reste vide si aucun projet reconnu n’est présent. Le bouton de création ouvre le parcours **Construire**. Les projets hors workspace ne sont pas listés.

## Créer et réutiliser ses templates

1. Ouvrez **Mes templates → Agents / Tools**.
2. Cliquez sur le bouton de création en haut à droite.
3. Choisissez une base et un nouvel identifiant.
4. Sélectionnez la bibliothèque **Projet** ou **Utilisateur**.
5. Confirmez la destination affichée.

Résultat : un template JSON est enregistré dans la bibliothèque, pas un projet exécutable. Il devient disponible pour une prochaine création.

| Bibliothèque | Agents | Outils |
| --- | --- | --- |
| Projet | `.scaleway-ai/templates/agents/` | `.scaleway-ai/templates/tools/` |
| Utilisateur | `~/.scaleway-ai/templates/agents/` | `~/.scaleway-ai/templates/tools/` |

Les deux bibliothèques sont réunies dans la table. À identifiant égal, le template du projet est prioritaire. Avec plusieurs dossiers de workspace, le premier template valide dans leur ordre est retenu. La table reste vide si vous n’avez aucun template personnel ; les bases fournies restent disponibles dans **Construire**.

Pour adapter une base, utilisez **Nouveau template**, modifiez le brouillon dans l’éditeur, puis enregistrez-le dans la bibliothèque. Pour ajouter un fichier existant, utilisez **Importer un template JSON**. Après modification, actualisez la table. N’incluez jamais de clé API ni de secret.

### Template personnel simple : version 1

Enregistrez un objet JSON contenant uniquement ces champs :

```json
{
  "version": 1,
  "id": "mon-outil",
  "label": "Mon outil",
  "kind": "tools",
  "description": "Base Python pour un outil local.",
  "files": {
    "tool.py": "def main():\n    pass\n"
  }
}
```

Utilisez `agents` ou `tools` pour `kind`, des chemins relatifs pour `files` et un identifiant en minuscules, chiffres et tirets. Pour apparaître dans l’inventaire local, le projet généré doit contenir un fichier reconnu, par exemple `agent.py` ou `tool.py`.

### Template paramétrable : version 2

Le format du catalogue est un JSON propre à l’extension, pas un format Cookiecutter. La syntaxe d’injection est **Mustache**, avec un sous-ensemble limité aux variables simples.

Déclarez le langage, son gestionnaire et les fichiers à rendre. Les autres fichiers restent inchangés. Exemple de base Python compatible uv :

```json
{
  "version": 2,
  "id": "python-uv-agent",
  "label": "Agent Python avec uv",
  "kind": "agents",
  "description": "Base Python paramétrable.",
  "project": {
    "language": "python",
    "package_manager": "uv",
    "engine": "mustache",
    "render": {
      "README.md": "text",
      "pyproject.toml": "toml",
      "config.json": "json"
    }
  },
  "files": {
    "README.md": "# {{project_name}}",
    "pyproject.toml": "[project]\nname = \"{{package_name}}\"\nversion = \"0.1.0\"\nrequires-python = \">=3.11\"\ndependencies = []\n[tool.uv]\npackage = false\n",
    "config.json": "{\"model_id\": \"{{model_id}}\"}",
    "agent.py": "# Compléter le raccordement modèle et runtime.\n"
  }
}
```

| Variable | Valeur |
| --- | --- |
| project_name | Nom saisi pour le projet |
| package_name | Nom en minuscules ; underscores remplacés par des tirets |
| module_name | Identifiant Python préfixé app_ ; tirets remplacés par des underscores |
| model_id | Identifiant du modèle sélectionné, ou chaîne vide sans modèle |

Les modes **json** et **toml** remplacent les valeurs de chaînes, puis sérialisent le document. Le mode **text** accepte les variables de nom, pas model_id : utilisez un fichier de configuration JSON/TOML pour le modèle. Les chemins et les clés ne sont pas paramétrables.

Une variable inconnue est refusée. Sections, lambdas, partials, changements de délimiteurs, tags non échappés et hooks ne sont pas acceptés. Vous ne pouvez pas déclarer une commande d’installation dans le template.

Utilisez les couples **python/uv**, **typescript/bun** ou **rust/cargo**. Une version 1 ne déclenche jamais une installation déduite du contenu. Les versions 1 et 2 fonctionnent dans les bibliothèques projet et utilisateur, avec la même priorité du projet.

Les bases fournies avec l’extension sont livrées dans `assets/templates/<agents|tools>/<langage>/<framework>/files/`, avec un manifeste `template.json`. Elles restent disponibles sans téléchargement.

## Se connecter à Scaleway

Le catalogue public s’ouvre sans compte. Les ressources privées nécessitent une connexion et un projet.

1. Cliquez sur le sélecteur de projet, puis **Changer de projet**.
2. Confirmez l’ouverture du navigateur et connectez-vous sur Scaleway.
3. Revenez dans VS Code. Si demandé, confirmez la création d’une clé API valable 30 jours pour l’extension.
4. Choisissez votre organisation par son nom, puis votre projet.

Vous pouvez aussi utiliser **Scaleway AI: Utiliser une clé API existante** depuis la palette de commandes. Les secrets sont conservés dans le stockage sécurisé de VS Code, pas dans les fichiers du projet.

**Se déconnecter (local)** ne révoque pas la clé distante. Pour la supprimer côté Scaleway, utilisez **Révoquer la clé API et se déconnecter**.

## Découvrir et tester un modèle

1. Ouvrez **Découvrir → Catalogue de modèles**.
2. Consultez les détails, le tarif et la disponibilité du modèle.
3. Choisissez **Utiliser** pour préparer l’accès Serverless, ou **Déployer** pour préparer un service dédié. Ouvrez ensuite le modèle depuis **Mes ressources** pour accéder au playground.

### Playground Serverless

Pour un modèle de chat Serverless, sélectionnez le projet, saisissez un prompt texte, vérifiez la limite de sortie et cliquez sur **Exécuter**. Cette action envoie un appel réel et peut être facturée. **Utiliser** ouvre le choix d’accès : réutiliser la clé de connexion, importer une clé existante, ou générer une clé pour vous-même ou une application IAM existante. Choisissez la description et l’expiration de la nouvelle clé, puis confirmez sa création. L’extension vérifie les métadonnées IAM de la clé et la présence du modèle dans la liste API, sans envoyer de prompt. Les endpoints sont préconfigurés par Scaleway : aucun déploiement dédié n’est créé. La clé de l’agent est distincte de l’identité de connexion à l’extension. Pour générer une clé d’application, vos droits IAM doivent le permettre ; aucune application ni politique de permission n’est créée automatiquement. La clé reste dans SecretStorage et peut être copiée dans le `.env` privé lors de la création d’agent. Cette configuration ne prouve pas une inférence réussie. **Choisir une clé API** permet de changer le credential sélectionné ; une nouvelle création nécessite une nouvelle confirmation. La création du projet agent ne lance ni inférence ni déploiement.


**Arrêter** interrompt la lecture locale et conserve la réponse partielle ; il ne garantit pas l’arrêt de la facturation distante. Les modèles non adaptés au chat et les services dédiés peuvent afficher un blocage explicite. Le playground réel ne propose pas encore la sauvegarde/export des expériences hors ligne.

### Déploiement dédié

Vérifiez le projet, la configuration, le prix et la licence avant la confirmation finale. Un déploiement confirmé crée une ressource cloud et peut entraîner des coûts. En cas de résultat incertain, relisez les services existants avant de recommencer.

### Démonstration hors ligne

Lancez **Scaleway AI: Open Offline Preview** depuis la palette de commandes. Testez une réponse synthétique, l’arrêt, l’enregistrement d’une expérience et l’export Python/TypeScript. Cette démonstration ne réalise aucun appel Scaleway et ne valide pas un modèle réel.

## Résoudre les problèmes courants

| Problème | Action |
| --- | --- |
| L’ancienne interface reste visible | Lancez **Developer: Reload Window** |
| La création locale est indisponible | Ouvrez un dossier local Linux et approuvez le workspace si vous lui faites confiance |
| Le bouton Créer est désactivé | Sélectionnez une base compatible avec le langage |
| Un template n’apparaît pas | Vérifiez le format JSON, le dossier et son identifiant ; actualisez |
| Le dossier de destination existe déjà | Choisissez un nouveau nom ; la création ne remplace pas les fichiers |
| Une ressource privée ne charge pas | Vérifiez la connexion, le projet et les droits Scaleway |
| La création s’interrompt | Inspectez le nouveau dossier avant de réessayer ; des fichiers partiels peuvent subsister |

## Limites actuelles

- Preview : les frameworks générés et les parcours cloud ne sont pas certifiés pour la production.
- Pas d’exécution complète Run/Stop des agents générés depuis l’extension.
- Pas d’inventaire cloud Agents/Outils, d’hébergement agent complet, d’inspecteur ou d’évaluations intégrées.
- Créer une base ne configure ni ses secrets ni ses autorisations d’exécution.

## Accès LLM et identifiants

**Mes ressources → Clés API** liste les clés visibles dans IAM pour l’organisation sélectionnée : description, identifiant masqué, titulaire, expiration et présence du secret dans le registre local utilisateur/projet. Une clé expirée reste visible mais ne peut pas être utilisée. Lecture bornée à cinq pages de cent clés, sans inférence. Un inventaire refusé ou non chargé ne signifie pas qu’aucune clé existe.

**Ajouter une clé API** propose réutilisation de la clé de connexion, import de la paire Access key / Secret key ou génération après confirmation. **Importer le secret** sur une ligne demande uniquement le secret de cette clé. L’API ne le restitue pas après création. **Choisir un modèle** réutilise le credential local sélectionné.

Les nouveaux enregistrements sont indépendants du modèle. Les anciens restent conservés et réutilisables ; aucune migration automatique ni suppression de secret. Les politiques IAM déterminent les droits ; le projet par défaut n’est pas une restriction IAM. Les credentials restent dans SecretStorage ; seule une valeur explicitement demandée par un bouton œil est transmise à la webview courante. Aucun identifiant du titulaire ne lui est envoyé.

Présence locale ne veut pas dire autorisation d’inférence. L’utilisation revalide les métadonnées IAM et la présence du modèle dans la liste Serverless ; cela ne prouve pas les droits d’appel du projet. Une erreur ne déclenche aucun fallback vers une autre clé.

**Mes ressources → Déploiements dédiés** conserve les services cloud du projet, séparément du catalogue de modèles. À la création d’agent, la clé choisie/revalidée est copiée dans le `.env` privé avec le modèle et son endpoint. Elle est en clair, exclue de Git ; déconnexion et révocation ne suppriment pas cette copie.

Si une création de clé a un résultat inconnu, l’extension ne la renvoie pas automatiquement. Vérifiez et révoquez les clés concernées dans Scaleway. Si le secret a été reçu et conservé, **Reprendre la configuration** réutilise cette même clé, sans nouvelle création. Un verrou restant après arrêt brutal exige de fermer toutes les fenêtres VS Code avant suppression manuelle du dossier de verrou indiqué ; les secrets en attente restent protégés dans SecretStorage.

Une vérification IAM et une présence au catalogue ne certifient pas les permissions d’inférence de chaque modèle/projet. Testez explicitement dans le playground pour confirmer un appel réel ; il peut être facturé.


## Améliorations après revue apps — candidat local

Les accès IAM ont des handles de binding stables : un renouvellement réussi
ne détruit pas les autres consommateurs du même accès. Changement/suppression
SecretStorage et remplacement de binding invalident les preuves ; les secrets déjà enregistrés sont conservés. Les nouvelles clés ne sont pas liées à un modèle ; seule une paire strictement identique est dédupliquée, sans révocation distante ni suppression de copie `.env`. La réception réelle inter-fenêtres reste
à vérifier. Le refresh mutualise les lectures pour une clé identique pendant
cette seule opération ; il ne conserve pas un cache durable d'autorisation.
Le contrôle actuel exige `getAPIKey`, la liste IAM filtrée de cette clé dans
l'organisation et le listing modèles avec le secret d'exécution. Les permissions
Scaleway minimales effectives et le droit d'inférence restent non certifiés.

La création accepte un dossier natif externe au workspace et offre ensuite
l'ouverture du projet : aucun registre historique ne peut transformer une
création réussie en échec. L'inventaire est une découverte des workspaces ouverts,
pas une liste persistée de destinations externes. Une génération interrompue
peut laisser des fichiers partiels ; aucune suppression/écrasement automatique.
Les contrôleurs playground purgent leurs références et réponses à la fermeture,
mais ce n'est pas une garantie de zéroisation de tous les buffers de l'hôte.

`npm test` lance désormais la sélection locale explicite ; le runner affiche les
suites exclues. `npm run test:full` est un opt-in distinct : ne pas le lancer si les
anciennes suites playground sont toujours arrêtées. Le gate package utilise la
sélection locale et vérifie les octets dist/media/assets/package.json du VSIX final
puis son chargement CommonJS isolé, sans activation ni inférence.

```bash
node tests/runScoped.mjs --list
SCW_PYTHON_WHEEL_PROOF=1 node --test tests/pythonInstalledLayout.test.cjs
npm run package -- --out ../../artifacts/candidat-distinct.vsix
```

La preuve wheel utilise uniquement les caches uv/Hatchling/pytest dans `/tmp`,
sans téléchargement ni installation globale. Elle vérifie 12 bases/compositions
installées hors source ; les dépendances backend/SDK ne sont pas installées.
Les agents restent des bases d'auteur fail-closed, pas des agents raccordés.
DeepEval est optionnel et non intégré ; ses métriques/dispatch/backend et les
lectures agents/tools cloud sont encore à livrer. VS Code minimal, rendu natif,
IAM réel et inference sont des preuves séparées, jamais déduites de ces tests.

### Création d’un agent : deux points de départ

Les onglets « Choisir une pile » et « Choisir un template » affichent un seul parcours à la fois. Les choix sont conservés entre les onglets ; seule la sélection active est utilisée pour générer les fichiers. Nom, service, modèle et destination restent communs. Les flèches gauche/droite et Home/End activent les onglets ; aucun changement d’onglet ne crée ni n’exécute de projet. Les fichiers d’un template ne sont pas convertis vers le langage de la pile inactive.

### Projets imbriqués et workspace

Après création, « Ajouter au workspace actuel » ajoute explicitement le sous-projet comme dossier de workspace distinct ; « Ouvrir le projet » reste une ouverture dans une nouvelle fenêtre. Aucun ajout automatique, installation ni registre parent `.vscode` n’est créé. Le parent et l’enfant peuvent apparaître à deux endroits dans l’Explorer ; certains outils peuvent parcourir les deux racines. Pour conserver cette organisation, utilisez la commande native **File: Save Workspace As…** et enregistrez un fichier `.code-workspace`. L’extension ne l’écrit pas et n’écrase aucune configuration existante. L’ajout du premier dossier peut recharger l’hôte d’extension ; l’inventaire local redécouvre les projets à partir de leurs fichiers, pas d’un index parent.

### Retrouver la ressource créée

Les actions post-création sont communes aux agents et aux outils. « Voir dans les ressources locales » ouvre et actualise l’inventaire correspondant si le projet est sous une racine du workspace. Pour une destination externe, ajoutez d’abord explicitement le projet au workspace ; aucun enregistrement invisible n’est fait. Une détection limitée en profondeur/budget peut rester incomplète : l’ajout comme racine distincte permet d’inspecter le projet directement. « Reconnu » ne signifie ni exécutable ni MCP attesté. Aucun bouton de lancement arbitraire n’est activé : bases agents authoring et futures commandes locales/container demandent un contrat runtime, des gardes, consentement et arrêt dédiés.

### Inventaire local et fichiers supprimés

La liste est reconstruite depuis les dossiers du workspace, sans registre persistant. Un événement filesystem invalide immédiatement les lignes et déclenche une détection regroupée ; revenir sur la page ou Actualiser relit également le disque. Les racines qui se recouvrent sont dédupliquées. Un `src/agent_app/agent.py` interne à un projet marqué ne devient pas un autre agent ; un sous-projet avec son propre marqueur JSON reste visible. `agent.creation.json` des templates personnels est reconnu. Les marqueurs JSON attestent seulement leur présence, pas la validité du projet ; les scripts isolés restent candidats non attestés. Les watchers peuvent manquer des événements selon l’hôte/exclusions VS Code : Actualiser reste disponible. Aucune suppression de fichiers ni retrait automatique de racines du workspace.

### Exécuter un agent local

Dans Agents locaux, **Configurer** ouvre un brouillon JSON non enregistré. Après intégration réelle du projet, enregistrez volontairement `.vscode/scaleway-agent-run.json` :

```json
{
  "version": 1,
  "ready": true,
  "runtime": "python",
  "entry": "src/agent_app/agent.py",
  "args": []
}
```

Runtimes de cette tranche : `python3` pour `.py`, `node` pour `.js`, sur hôte Linux, exécutables déjà installés et résolus depuis PATH. Aucun shell, installation, uv sync ou container pull/build automatique. Les scripts TypeScript doivent être compilés explicitement avant de sélectionner le `.js`. Le programme reçoit son propre dossier comme cwd, mais son code **n’est pas sandboxé** : accès fichiers, réseau, environnement et éventuel `.env`/inférence payante restent possibles. La confirmation mentionne ces risques. Le ready flag est une déclaration utilisateur, pas une preuve qualité ou de droits IAM. Les marqueurs `incomplete:true` bloquent le lancement ; modifier ce champ ne réalise pas l’intégration backend/SDK et ne supprime aucun dispatch guard du code.

**▶ Exécuter** apparaît uniquement si la configuration et le point d’entrée peuvent être vérifiés. Les tâches démarrées par l’extension ont un identifiant propre : **■ Arrêter** reste accessible dans Exécutions locales après disparition d’une ligne, et **Journal** ouvre les événements de lifecycle. La sortie réelle du programme est dans le terminal de tâche VS Code. L’arrêt est une demande et ne garantit pas la terminaison de tous les enfants ; seuls les événements de tâche attestent sa fin. Pas de contrôle des tâches démarrées hors extension. Les fichiers vérifiés sont relus après consentement, mais modifications de dépendances/imports, résolution PATH et races pathname-to-execution ne sont pas éliminées. Les outils et containers restent hors activation de ce premier lancement d’agents.

### Configuration de lancement générée

Les nouvelles bases Python et TypeScript connues reçoivent automatiquement `.vscode/scaleway-agent-run.json` pendant la composition, avec `ready:false`. Python cible le fichier du package ; TypeScript cible `dist/agent.js` après compilation explicite. Un template personnel conserve sa propre configuration si elle est fournie dans ses fichiers ; aucune commande n’est devinée pour lui. Les bases Rust ne reçoivent pas de lancement Python/Node inapproprié. L’inventaire affiche « Intégration requise — commande déjà définie » pour une base encore incomplète, et « Voir la configuration » ouvre le fichier existant au lieu d’un nouveau brouillon. Les anciens projets ne sont pas migrés/sauvegardés silencieusement. Aucune configuration générée ne réalise le raccordement SDK/backend, ne retire une garde ni n’installe/exécute le projet.

La création d’agent affiche le chemin final prévu (dossier parent + nom), actualisé pendant la saisie sans recharger le formulaire. Le bouton de choix du parent reste indépendant. Cet aperçu ne vérifie pas encore l’existence du chemin ; la création exclusive et sa confirmation font autorité. Les onglets utilisent désormais les couples couleur/fond primaire et secondaire du thème, avec soulignement et graisse renforcés pour l’état actif.

L’action post-création proposée en premier est **Ajouter au workspace actuel**, pour privilégier la construction d’agents/outils dans un monorepo. L’ouverture dans une nouvelle fenêtre reste une alternative. L’ordre ne déclenche aucune action : l’ajout, l’installation et l’exécution restent des choix explicites distincts ; la présentation native des boutons dépend de VS Code.

Après création et tentative de préparation des dépendances, le point d’entrée source
vérifié (par exemple `src/agent_app/agent.py` pour Python/Strands) s’ouvre dans un
onglet **épinglé**, avant toute tentative d’ajout du dossier au workspace. Cette
ouverture pour modifier le code ne dépend pas de l’extension Python ni de la
confirmation du `.venv`. La sélection Python reste en attente et reprend après
ajout de la racine ou rechargement de l’hôte ; le point d’entrée peut alors être
rouvert indépendamment. Les avertissements de préparation/sélection restent
applicables : un fichier ouvert ne prouve ni analyse IDE prête, ni environnement
confirmé, ni agent exécuté. Aucun appel modèle n’est déclenché par cette ouverture.

### Retirer un agent local

« − Retirer… » distingue retrait de racine workspace (fichiers conservés) et demande de corbeille du dossier complet, incluant le `.env`. Seuls les projets marqués imbriqués dans une autre racine peuvent être mis à la corbeille : racine principale, dépôt Git, sous-projets, liens, arbres trop volumineux ou exécutions propres actives sont bloqués. Confirmation et revalidation de l’arbre obligatoires. La corbeille est demandée via VS Code, sans second essai définitif par l’extension ; disponibilité et comportement effectifs dépendent du fournisseur/hôte. Une suppression réussie peut précéder un refus de retrait workspace, signalé séparément. Aucun effet Scaleway, aucune révocation clé API. Des changements concurrents après dernière revalidation restent possibles avec l’API pathname ; le retrait de fichiers ne sauvegarde pas les buffers éditeur.

## Création et inventaire KISS — 2026-10-23
Les projets créés depuis les piles/bases fournies Python ou TypeScript disposent désormais
d’un client autonome `scaleway_agent.py` ou `scaleway_agent.cjs`, qui charge le `.env` privé
et appelle `/chat/completions` sur le modèle/endpoint sélectionné. La commande de lancement
est configurée à la création. Python 3 ou Node.js 22+ doit être installé ; ce client ne
nécessite pas de dépendance tierce ni de compilation. Les bases backend/framework restent
disponibles à l’équipe de développement ; le client autonome ne prétend pas intégrer ces bases.
La création ne lance aucune inférence. `--check` contrôle la configuration sans réseau ;
un lancement normal envoie le message fourni, ou Bonjour sans argument, et peut être facturé.
Les templates personnels ne sont pas modifiés par ce raccordement ; Rust conserve son
parcours spécifique et n’est pas déclaré lançable par le runner Python/Node.
Les anciens projets ne sont pas migrés automatiquement.
Agents locaux utilise Projet / État / Actions : nom et chemin regroupés, détails repliables,
boutons verticaux et actions secondaires différenciées. Les voyants Configuré (vert),
À compléter (orange), Bloqué (rouge) ont un libellé et une explication survol/focus.
Configuré signifie configuration et point d’entrée présents, pas endpoint testé ni processus
en cours. Les protections de consentement, fichiers, workspace, arrêt et retrait restent actives.
Vérification locale : transport mocké et --check hors réseau ; rendu natif/inférence réelle non vérifiés.

## Templates frameworks minimaux — correction 2026-10-23
Strands Python/TypeScript, LangChain Python/TypeScript et Mastra construisent désormais
un agent avec leur vrai SDK et le modèle/endpoint/clé Scaleway du .env. Aucun appel
à l’import ni à la création ; --check valide uniquement la configuration sans SDK/réseau.
Le lancement d’une pile IA cible src/agent_app/agent.py en Python ; dist/agent.js ou
dist/agent-sdk.js en TypeScript selon la composition. Les dépendances doivent être
installées explicitement, TypeScript doit être compilé. Le client HTTP autonome est
réservé aux bases sans framework IA. Le backend n’est pas imposé au lancement de l’agent.
Les exemples n’ajoutent ni outils ni fallback fournisseur. Les backends et Rust restent
des bases de développement, pas des frameworks IA certifiés. Templates personnels et
anciens projets préservés. Les vérifications mockées ne prouvent pas l’inférence réelle
ni la compatibilité complète des SDK installés.

### Choisir une clé et afficher sa copie locale

**Créer un agent** propose deux listes distinctes : modèle / déploiement et **Clé API**.
La sélection de clé est indépendante du modèle et conservée lors d’une actualisation du même contexte.
Seules les clés dont le secret est enregistré localement et qui ne sont pas expirées sont proposées.
Utilisez **Ajouter / importer une clé API…** si nécessaire. La clé choisie est revalidée avant
sa copie dans le fichier privé .env ; aucun remplacement silencieux par la clé de connexion.

Dans **Clés API**, les colonnes **Clé API** et **Clé secrète** sont masquées par défaut.
Chaque copie locale a deux boutons œil accessibles : un clic divulgue uniquement le champ choisi
à la webview courante, en ligne ; un second clic le masque et annule sa demande en attente.
Aucune demande automatique à l’ouverture. Les valeurs sont effacées à l’actualisation, lors
d’une autre action, d’une perte de focus, d’un masquage de la vue ou d’un changement de contexte.
Attention au partage d’écran et aux captures : ne diffusez pas ces credentials.
Les valeurs divulguées restent transitoires : aucun cache persistant, presse-papiers ni journal
de l’extension ; elles ne figurent pas dans le HTML initial ni dans les métadonnées.
Une copie expirée peut être affichée, mais pas utilisée pour créer un agent. Aucune récupération
ou recréation de secret via IAM ; un secret absent doit être importé par son détenteur.
L’inventaire et la présence locale ne certifient ni les politiques IAM du projet ni une inférence.


### Parseurs CLI des bases intégrées
Les **26 bases intégrées** fournissent leurs points d’entrée CLI avec des parseurs
remplaçables par votre équipe : Python `argparse` (stdlib, sans dépendance ajoutée),
TypeScript/Bun `node:util.parseArgs` (strict, Node.js 22+), Rust `clap` 4 avec `derive`.
Les templates personnels et projets déjà créés ne sont pas migrés. Les modules
bibliothèque, API et configuration restent importables sans lancement automatique.

- Agents modèle : `uv run agent --help`, `uv run agent --check`,
  `uv run agent "Votre message"` ; pour TypeScript compilé :
  `node dist/agent.js --help` (ou `dist/agent-sdk.js` avec une composition backend).
  Le client autonome Node utilise `node scaleway_agent.cjs --help`.
  `--check` conserve la validation locale de configuration, sans SDK/inférence.
  Un lancement normal conserve le prompt par défaut « Bonjour » et peut être facturé.
  Utilisez `--` pour un prompt littéral commençant par un tiret.
- Shells backend/bibliothèque : Python `python -m agent_app.backend_cli --help`
  (avec le paquet installé) ou `python tool_cli.py --help` (`cli.py` pour MCP) ;
  TypeScript `node dist/backend-cli.js --help` / `node dist/cli.js --help` ;
  Rust `cargo run -- --help`. Leur `--check` vérifie **uniquement le shell CLI**,
  pas les dépendances, la configuration métier ni l’intégration IA.
  Les serveurs exigent `--serve`, avec `--host 127.0.0.1 --port 3000`
  pour les backends HTTP ; Elysia s’exécute avec Bun, MCP conserve son transport
  stdio (`python cli.py --serve`) et exige une revue transport/authentification.
  Aucun nouveau loop d’agent IA n’est intégré à ces shells.

`--help` fonctionne avant lecture de configuration/.env ou import d’un SDK/backend ;
les flags inconnus échouent sans réseau, et `--check` ne lance jamais de serveur.
Rust exige une compilation (et éventuellement les dépendances Cargo) avant de
pouvoir exécuter le binaire ; l’aide ne constitue pas une preuve de compatibilité native.
