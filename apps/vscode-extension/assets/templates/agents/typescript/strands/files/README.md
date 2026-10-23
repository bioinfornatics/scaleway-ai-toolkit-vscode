# Agent minimal strands

Le framework choisi consomme explicitement le modèle et l’endpoint Scaleway du .env privé. Aucun appel à l’import ou à la création. Sans outils ni backend obligatoire.

Installer explicitement avec npm install, compiler avec npm run build, puis lancer node dist/agent.js "Votre message". Avec un backend et une pile IA, lancer dist/agent-sdk.js.
--check vérifie la configuration locale sans réseau ni import du SDK. Sans message, Bonjour est envoyé. Un lancement normal peut être facturé. Ne partagez pas .env.
Le backend, les outils et la logique métier appartiennent à votre équipe. Aucun déploiement automatique.
Les tests de configuration restent hors réseau ; l’inférence réelle et la compatibilité installée doivent être vérifiées séparément.
