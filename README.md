# Scaleway AI Toolkit pour VS Code

Découvrez les modèles Scaleway et créez des bases de projets Agents ou Outils sans quitter VS Code. Réutilisez vos templates dans plusieurs projets.

Extension communautaire en preview, sans affiliation officielle à Scaleway.

## Installer

Prérequis : VS Code 1.96 ou supérieur. Utilisez un workspace local Linux approuvé pour créer des projets et gérer des templates.

1. Récupérez le fichier VSIX fourni avec la livraison.
2. Dans VS Code, ouvrez **Extensions → … → Installer à partir d’un VSIX**.
3. Sélectionnez le fichier, puis lancez **Developer: Reload Window** depuis la palette de commandes.
4. Ouvrez la vue **Scaleway AI** dans la barre d’activité.

Pour une installation en terminal, consultez les [instructions VSIX](artifacts/README.md).

## Commencer

| Objectif | Parcours | Résultat |
| --- | --- | --- |
| Découvrir les modèles | Découvrir → Catalogue de modèles | Modèles, détails et tarifs disponibles |
| Créer un projet agent | Construire → Créer un agent | Fichiers d’une base Python, TypeScript ou Rust |
| Créer un projet outil | Construire → Créer un tool | Fichiers d’une base compatible avec le langage |
| Retrouver ses projets | Ressources locales → Agents / Tools | Projets détectés dans le workspace |
| Réutiliser une base personnelle | Mes templates → Agents / Tools | Templates du projet et de l’utilisateur |

**Premier essai sans compte :** ouvrez un dossier, choisissez **Construire → Créer un agent**, sélectionnez un langage et une base, puis confirmez le nouveau dossier. La création copie les fichiers ; elle ne lance pas le code.

## Utiliser Scaleway

Le catalogue public ne nécessite pas de connexion. Pour accéder aux ressources de votre compte, sélectionnez un projet et suivez la connexion dans le navigateur. Toute création de clé API demande votre confirmation.

Les appels de modèle et les déploiements peuvent être facturés. Vérifiez le projet, le modèle et le tarif avant de confirmer une action.

## À savoir

- Les projets générés sont des bases à compléter, pas des agents prêts à exécuter.
- Les nouvelles bases intégrées peuvent préparer leurs dépendances avec uv, Bun ou Cargo déjà présents ; elles ne lancent aucune inférence et ne déploient rien. Les templates personnels sont préservés.
- **Mes ressources → Agents / Tools** est réservé aux ressources cloud ; leur inventaire n’est pas encore disponible.
- Le playground hors ligne est une démonstration, distincte des appels réels au modèle.

## Documentation

- [Guide d’utilisation](apps/vscode-extension/README.md) : connexion, création, templates et modèles.
- [Présentation du produit](PRODUCT.md) : objectifs et périmètre.
- Contribution : [architecture](specifications/architecture.md) et [références techniques](specifications/references/README.md).

## Organisation du dépôt

- `apps/vscode-extension/` : extension, assets et tests dans `tests/`.
- `runtimes/` : runtime Python et ses tests.
- `specifications/` : architecture et références techniques.
- `artifacts/` : VSIX et rapports de validation locaux, exclus des nouveaux ajouts Git.

Pour vérifier l’extension : `cd apps/vscode-extension && npm test`.
La création de projets n’exécute pas ces tests et ne réalise aucun appel cloud.
Les anciens tests documentaires/discovery ont été retirés. Les sources publiques épinglées et leurs rapports historiques restent sous `specifications/references/`.

Le runtime Python sous `runtimes/` reste un sous-projet expérimental hors ligne :
il n’est ni embarqué ni lancé par l’extension. Les prototypes de transport et les
anciens validateurs de recherche ont été retirés ; les tests de l’extension
ciblent ses adaptateurs et parcours réellement implémentés.
## Agent API FastAPI + Strands (A2A)

La composition **Agent → API → Python + FastAPI + Strands** utilise A2A SDK `1.2.3` (protocole 1.0), et non le chat modèle. La webapp conserve `/api/chat` ; le CLI Strands conserve son invocation synchrone sans serveur. Modifiez les instructions dans `src/agent_app/agent.py` : l’executor A2A utilise réellement son constructeur `build_agent` avec un agent et un client HTTP borné par requête.

Depuis la racine du projet généré : `uv run python -m agent_app.service_cli --check`, puis lancement explicite avec `--serve`. Le fichier `.env` reste à la racine (répertoire de travail), aussi avec un wheel installé. GET `/.well-known/agent-card.json`, POST `/a2a` (`Content-Type: application/json`, `A2A-Version: 1.0`) :

```json
{"jsonrpc":"2.0","id":"1","method":"SendMessage","params":{"message":{"messageId":"input-1","role":"ROLE_USER","parts":[{"text":"Hello"}]}}}
```

Réponse immédiate `result.message` uniquement : ni streaming, outils, fichiers, métadonnées, tâches durables, reprise, annulation ou push. Seul le protocole 1.0 est pris en charge : en-tête A2A-Version absent, dupliqué ou non pris en charge rejeté avant parsing/exécution. Chaque requête immédiate utilise un handler SDK V2 isolé, drainé via son API publique aclose() dans un finally (erreurs/annulation incluses), sans transformer une erreur en succès. Les méthodes non prises en charge sont rejetées avant exécution. Loopback numérique uniquement, sans Origin ni forwarding ; ce n’est pas une authentification de production. Limites : 4 requêtes concurrentes, corps 32768 octets/10 s, entrée 8000 caractères, réponse 32000 caractères, appel modèle 30 s/1024 tokens/65536 octets. URL upstream exacte, sans retries/proxies/redirections. Secrets et erreurs upstream ne sont pas renvoyés.

Preuve locale : génération, mocks de structs/parsing SDK et méthodes de teardown extraites du tag public (pas une preuve SDK installé), transport HTTPX réel avec upstream simulé, build/tests et VSIX. Inspection du cache Strands `1.61.1` et des sources A2A `1.2.3` ; pas d’installation complète du SDK, d’inférence réelle, d’exposition externe ou de validation d’interface installée. La relecture indépendante reste requise.
