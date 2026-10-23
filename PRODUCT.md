# Présentation du produit

<a id="vision"></a>
## Vision

Permettre aux développeurs de découvrir les modèles Scaleway et de préparer des applications IA depuis leur workspace VS Code, avec des fichiers qu’ils peuvent lire, modifier et réutiliser.

<a id="users"></a>
## À qui s’adresse l’extension ?

- Développeurs qui comparent des modèles et préparent des agents ou des outils.
- Équipes qui souhaitent partager des bases de projets sans partager de secrets.

<a id="value"></a>
## Utilité

Réunir le catalogue, la création de projets et les templates dans un même espace. L’objectif est de réduire les changements d’outils ; le gain de temps n’a pas encore été mesuré auprès des utilisateurs.

<a id="scope"></a>
## Périmètre actuel

| Fonction | Ce que vous obtenez |
| --- | --- |
| Catalogue | Modèles, détails et tarifs disponibles |
| Connexion Scaleway | Sélection d’organisation et de projet |
| Création locale | Bases Agents/Outils en Python, TypeScript et Rust |
| Templates personnels | Bibliothèques projet et utilisateur |
| Ressources locales | Projets reconnus dans le workspace |
| Playground Serverless | Essais texte explicites, potentiellement facturés |
| Déploiement dédié | Préparation et confirmation d’un service cloud |

Les bases générées restent à compléter. L’exécution complète des agents, leur hébergement, l’inventaire cloud Agents/Outils, l’inspection et les évaluations ne sont pas encore disponibles comme parcours complets.

<a id="principles"></a>
## Principes

- **Guider par l’action** : choisir une base, vérifier les fichiers, confirmer la destination.
- **Garder les fichiers accessibles** : produire du code et des configurations modifiables.
- **Séparer les objets** : un template, un projet local et une ressource cloud sont distincts.
- **Confirmer les effets** : ne pas lancer du code ou créer une ressource payante par simple navigation.
- **Expliquer les limites** : ne pas présenter une base comme une application prête pour la production.

<a id="evidence"></a>
## Maturité

L’extension est une preview communautaire, sans affiliation officielle à Scaleway. La présence d’une fonction ne constitue pas une certification de compatibilité, de sécurité ou de production. Les preuves et exigences de développement sont conservées séparément.

<a id="ownership"></a>
## Contrôle utilisateur

Vous choisissez le projet, les fichiers à créer et les actions cloud à confirmer. Aucun secret ne doit être intégré aux templates. Un appel de modèle ou un service dédié peut être facturé par Scaleway.

<a id="references"></a>
## Commencer

Suivez le [guide d’utilisation](apps/vscode-extension/README.md). Pour comprendre les exigences de développement, consultez la [spécification produit](specifications/product.md).
