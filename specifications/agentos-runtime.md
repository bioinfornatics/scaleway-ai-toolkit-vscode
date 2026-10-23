# Runtime dédié Agno + AgentOS — tranche locale 5qk

## Contrat de création

Dans Construire, Service agent/API ou Application web/API séparée/Python : choisir **AgentOS**. Le framework IA devient **Agno (intégré à AgentOS)** ; le host et le générateur rejettent explicitement une sélection SDK Strands/LangChain incompatible, sans la supprimer silencieusement. Retirer le SDK choisi via Sans framework IA avant de sélectionner AgentOS. Les autres combinaisons, choix conditionnels, templates personnels, clés, modèles, destinations, préparation et IPC restent inchangés. AgentOS n’est ni un backend interchangeable ni un serveur intégré Next.js. Le parcours agent CLI conserve ses SDK existants.

C = création de projet ; R = catalogue/prévisualisation ; U = paramètres du formulaire ; D = non proposé. UI, zones :

    = Type de projet / exposition / frontend / champs communs
    ~ Framework API : FastAPI | Litestar | AgentOS
    ~ AgentOS choisi : Framework IA = Agno (intégré, verrouillé)
    = Modèle / clé locale / destination / templates / confirmation

Le dessin définit le périmètre, pas une preuve visuelle. Tests host/renderer automatisés sous mocks ; rendu navigateur/VS Code et parcours installé NOT RUN pour cette tranche.

## Exécution générée

Base inspectable : apps/vscode-extension/assets/templates/agents/python/agentos.
Source principale src/agent_app/service_api.py ; argparse dans agent.py, copie service_cli.py pour le service composé. Factory create_app uniquement à --serve, serveur Uvicorn sur127.0.0.1:3001, proxy_headers=False, access_log=False. Aucun serveur/SDK lourd/inférence à import/help/check/génération. --check vérifie configuration locale, pas les dépendances ni les droits fournisseur. Aucune modification automatique de projets précédents/.env/settings utilisateur. Racine explicite = répertoire courant : lancer depuis la racine du projet, y compris les commandes console du wheel installé. Seul cwd/.env est lu, sans recherche dans les ancêtres ni fichiers utilisateur ; les variables existantes ont priorité.

**Orchestration réelle dans les sources :** OpenAILike explicite -> Agent.arun -> réponse RunOutput.content. AgentOS(agents,base_app).get_app() fournit l’application FastAPI ; un wrapper ASGI externe LocalSurface bloque toutes les routes sauf POST /api/chat. Chaque requête crée un agent sans historique et une session aléatoire. Aucune boucle d’inférence maison ni transport urllib model-only sur cette route.

/api/chat accepte exactement {"message":"..."}, répond {"reply":"..."}. HTTPS/base/modèle/clé exclusivement depuis le serveur. Pas d’override URL/modèle/tools/session, outils/MCP/tracing/scheduler/DB/Workspace/file-system tool/history/telemetry. Plafonds8000 caractères/32768 octets en entrée,65536 octets fournisseur,32000 caractères de sortie ; deadline ingestion10s (408), timeout fournisseur30s, run35s, concurrence1, retries0, redirections interdites, proxies environnement ignorés. Erreurs fixes sans corps distant.

LocalSurface exige peer loopback, Host local, JSON ; Origin présent limité aux frontends locaux sur3000/3001/5173. Native /agents/*/runs, sessions, uploads, docs, MCP, WebSockets restent fermés même avec OS_SECURITY_KEY/JWT. Les frontends Next/Vite séparés utilisent uniquement le proxy /api/chat vers3001 ; aucun secret frontend. Vite proxy dev-only, Next rewrites aussi production.

Ce gate n’est pas une authentification : les processus locaux peuvent invoquer le chat et engager des coûts. Pas de service multi-utilisateur ni d’accès Control Plane. Ne jamais servir le get_app() interne seul. Activer les routes natives/exposition externe exige une décision distincte, auth OS dédiée/JWT+RBAC, protections CSRF/rate/spend et revue. La clé fournisseur n’est pas une clé OS. Launch ready:false, pas de gestion serveur par LocalAgentRunner ; ouverture native épinglée à service_api.py via allowlist existante.

## Sources officielles et limites

Consultées2026-10-24 :
- https://docs.agno.com/agent-os/introduction
- https://docs.agno.com/models/providers/openai-like
- https://docs.agno.com/agent-os/security/overview
- agno-agi/agno v3.1.10, commit04330571dc84b15d03dd3c2b598f8f01d4a239e0 : libs/agno/agno/os/app.py, agent/agent.py, models/openai/chat.py, models/openai/like.py.

Le constructeur documenté autorise base_app, telemetry=False,tracing=False,scheduler=False,mcp=False,db=None,auto_provision_dbs=False. OpenAILike hérite http_client,max_retries,timeout,max_tokens d’OpenAIChat ; arun accepte stream=False/session_id. L’exemple Workspace/Sqlite/tracing/scheduler/MCP de l’introduction est volontairement exclu. Auth native par défaut none (sans JWT/OS_SECURITY_KEY) justifie le gate externe.

Requirements : agno[os]==3.1.10,openai==2.54.0,httpx==0.28.1 ; FastAPI/Uvicorn plages existantes. Pin source/version n’est pas une preuve de résolution complète des dépendances. **Aucune dépendance runtime téléchargée/installée, aucun appel fournisseur.** Mocks prouvent raccordement, politiques et erreurs du source généré, pas comportement du SDK installé. Wheel offline --no-deps (si gate disponible) prouve packaging/configuration seulement. Runtime complet, model mapping/capabilities/live provider, build frontend, visuel et installé demeurent non vérifiés. Évaluations communes opt-in, pas certification Agno.

Revue indépendante requise avant clôture scaleway_ai_vscode-5qk. Preuves ignorées : artifacts/validation/agentos-20261024-0022 ; VSIX unique version0.0.37, jamais installation automatique/commit/push.

Extra officiel agno[os] déclare les dépendances AgentOS (multipart, JWT, SQLAlchemy, scheduler/instrumentation) ; leur présence ne les active pas. Ces fonctionnalités restent désactivées explicitement. Logging SDK désactivé avant imports et debug_mode=False pour éviter les logs bruts des erreurs fournisseur (source officielle utils/log.py et models/openai/chat.py).
