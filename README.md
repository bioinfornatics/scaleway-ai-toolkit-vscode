# Scaleway AI Toolkit pour VS Code

Découvrez les modèles Scaleway et créez des bases de projets Agents ou Outils sans quitter VS Code. Réutilisez vos templates dans plusieurs projets.

Extension communautaire en preview, sans affiliation officielle à Scaleway.

## Installer

Prérequis : VS Code 1.96 ou supérieur. Utilisez un workspace local Linux approuvé pour créer des projets et gérer des templates.

1. Téléchargez le fichier `.vsix` dans les **Assets** de la [release GitHub](https://github.com/bioinfornatics/scaleway-ai-toolkit-vscode/releases).
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

## Build CI et livraison communautaire

Le code est sous [CeCILL-2.1](LICENSE) ; la copie embarquée dans le VSIX est vérifiée octet par octet. Cette licence ne donne pas de droits sur les marques. Les icônes de la version publiée sont des créations géométriques originales sous CeCILL-2.1, sans logo Scaleway. Le mainteneur a explicitement approuvé le 24 octobre 2026 cette livraison neutre et la conservation de l’historique Git déjà public. Les anciennes icônes restent uniquement dans cet historique : cette décision ne constitue pas une autorisation de marque. Voir [la provenance des nouvelles icônes](specifications/references/documentation/agent-logo-v38/provenance.json).

Commande canonique locale (dépendances déjà installées) :

```bash
cd apps/vscode-extension
npm run package -- --out /tmp/scaleway-preview-unique.vsix
```

Elle refuse un fichier existant et exécute typecheck, build, sélection explicite des tests, packaging et vérification des octets du VSIX, licence et identité/version/publisher compris. Les suites historiques arrêtées restent exclues ; `--full` est uniquement un opt-in explicite. Le chargement CommonJS isolé n’active pas l’extension : compatibilité effective VS Code minimum, inférence, SDK/backend réels et production ne sont pas certifiés.

`buildCI` utilise Ubuntu 24.04, Node 22, Python 3.12, uv 0.12.24, Bun 1.3.3 et Rust stable. Les dépendances npm verrouillées sont installées avec `npm ci --ignore-scripts`. Hatchling >=1.27,<2, pytest >=8,<10 et les helpers de fixtures httpx 0.28.1, protobuf 7.35.1 et PyYAML 6.0.3 sont préchauffés avec leurs dépendances d’outillage dans une venv et un cache uv temporaires ; aucune installation Python globale. La preuve wheel (`SCW_PYTHON_WHEEL_PROOF=1`) reste strictement hors ligne, sans dépendances runtime ni inférence. Les versions résolues et limites sont journalisées. La CI préchauffe explicitement les dépendances Rust déclarées clap/axum/tokio dans une fixture temporaire : téléchargement dans une étape réseau dédiée, puis compilation hors ligne. Le cache est une optimisation, pas un prérequis ; les programmes générés ne sont pas exécutés pendant ce préchauffage, mais Cargo peut exécuter les build scripts et macros de ses dépendances. Deux preuves Actix peuvent rester explicitement non vérifiées si leur cache est incomplet. Les actions utilisent des tags de version publics, pas des SHA supposés ; leur épinglage vérifié reste à effectuer. Le run GitHub 40079766804 a validé le packaging : 942 tests réussis, zéro échec, deux preuves Actix explicitement non vérifiées.

Après résolution documentée des droits, revue des secrets/historique et autorisation de push explicite, la livraison future est **manuelle seulement** : pousser uniquement main et un tag `v0.0.38` pointant sur le même commit, définir la variable de dépôt `PUBLIC_RELEASE_APPROVED=true`, puis lancer le workflow `Gated GitHub VSIX prerelease` depuis main avec ce tag. Le gate contrôle version actuelle/verrou, publisher communautaire, dépôt bioinfornatics, licence et tag existant ; les étapes d’upload sont également bloquées sans cette variable. Protéger les tags de release contre toute modification avant publication : le contrôle distant réduit la fenêtre de course, sans rendre atomiques contrôle du tag et création de release. Remettre la variable à false ensuite. Le seul job doté de `contents: write` crée une prerelease GitHub avec VSIX + SHA-256, sans écraser une livraison existante. Pas de Marketplace, npm publish, PAT ou secret Scaleway ; seul le jeton GitHub éphémère du job de livraison est utilisé.

Avant toute publication, exclure credentials, données clients et transcriptions privées ; `.env`, venv/caches et rapports locaux sont ignorés sans supprimer les templates `.env.example` déjà suivis. Les refs Beads/Entire ne font pas partie d’un push de code/release. Les logs CI contiennent uniquement des fixtures synthétiques et des preuves de build ; vérifier leur contenu avant de lever le gate.

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

### Preview 0.0.38

Nouveau logo original « assistant + action », inspiré par une proposition image-mcp puis reconstruit en SVG sans halo. Icône de package PNG 256 × 256 transparente et icône monochrome adaptative pour la barre d’activité. La release 0.0.37 est conservée ; aucun changement des runtimes agents.
