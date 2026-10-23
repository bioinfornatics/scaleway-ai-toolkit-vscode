# Agent minimal strands

Le framework choisi consomme explicitement le modèle et l’endpoint Scaleway du .env privé. Aucun appel à l’import ou à la création. Sans outils ni backend obligatoire.

Installer explicitement les dépendances avec uv sync, puis lancer uv run agent "Votre message". Avec un backend et une pile IA, seul le fichier agent IA est lancé.
--check vérifie la configuration locale sans réseau ni import du SDK. Sans message, Bonjour est envoyé. Un lancement normal peut être facturé. Ne partagez pas .env.
Le backend, les outils et la logique métier appartiennent à votre équipe. Aucun déploiement automatique.
Les tests de configuration restent hors réseau ; l’inférence réelle et la compatibilité installée doivent être vérifiées séparément.


## CLI model agent
Parser: Python stdlib argparse. `uv run agent --help` works without configuration or SDK imports. `uv run agent --check` validates local configuration without inference. `uv run agent "Your message"` preserves the existing model execution (potentially billed); default prompt: Bonjour. Use `--` before literal flags in the prompt. Unknown flags fail without network. Python console script requires the installed/generated pyproject; TypeScript requires build first (composed backend uses dist/agent-sdk.js).
