# Agent minimal strands

Le framework choisi consomme explicitement le modèle et l’endpoint Scaleway du .env privé. Aucun appel à l’import ou à la création. Sans outils ni backend obligatoire.

Installer explicitement avec npm install, compiler avec npm run build, puis lancer node dist/agent.js "Votre message". Avec un backend et une pile IA, lancer dist/agent-sdk.js.
--check vérifie la configuration locale sans réseau ni import du SDK. Sans message, Bonjour est envoyé. Un lancement normal peut être facturé. Ne partagez pas .env.
Le backend, les outils et la logique métier appartiennent à votre équipe. Aucun déploiement automatique.
Les tests de configuration restent hors réseau ; l’inférence réelle et la compatibilité installée doivent être vérifiées séparément.


## CLI model agent
Parser: built-in node:util.parseArgs (Node.js 22+/Bun). `node dist/agent.js --help` works without configuration or SDK imports. `node dist/agent.js --check` validates local configuration without inference. `node dist/agent.js "Your message"` preserves the existing model execution (potentially billed); default prompt: Bonjour. Use `--` before literal flags in the prompt. Unknown flags fail without network. Python console script requires the installed/generated pyproject; TypeScript requires build first (composed backend uses dist/agent-sdk.js).
