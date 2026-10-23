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