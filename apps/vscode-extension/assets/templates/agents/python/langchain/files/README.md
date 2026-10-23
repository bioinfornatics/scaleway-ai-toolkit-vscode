# Agent minimal langchain

Le framework choisi consomme explicitement le modèle et l’endpoint Scaleway du .env privé. Aucun appel à l’import ou à la création. Sans outils ni backend obligatoire.

Installer explicitement les dépendances avec uv sync, puis lancer uv run agent "Votre message". Avec un backend et une pile IA, seul le fichier agent IA est lancé.
--check vérifie la configuration locale sans réseau ni import du SDK. Sans message, Bonjour est envoyé. Un lancement normal peut être facturé. Ne partagez pas .env.
Le backend, les outils et la logique métier appartiennent à votre équipe. Aucun déploiement automatique.
Les tests de configuration restent hors réseau ; l’inférence réelle et la compatibilité installée doivent être vérifiées séparément.
