"""Explicit local AgentOS serving. Import/help/check never import runtime SDKs."""
import argparse
import sys
if __package__:
    from .config import load_project_config
else:
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from agent_app.config import load_project_config


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(add_help=False, description="Agno AgentOS: local API; submitted chat may incur inference charges.")
    parser.add_argument("--help", "-h", action="store_true")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--serve", action="store_true")
    parser.add_argument("--host", choices=["127.0.0.1"], default="127.0.0.1")
    parser.add_argument("--port", type=int, default=3001)
    args = parser.parse_args(argv)
    if args.help:
        parser.print_help()
        return 0
    if not 1 <= args.port <= 65535:
        parser.error("invalid port")
    try:
        if args.check:
            from agent_app.service_api import load_runtime_config
            load_runtime_config()
            print("Configuration présente ; aucun appel réseau ni serveur.")
        elif args.serve:
            from agent_app.service_api import create_app
            import uvicorn
            uvicorn.run(create_app(), host=args.host, port=args.port, proxy_headers=False, access_log=False)
        else:
            parser.print_help()
        return 0
    except Exception:
        print("Service indisponible ; vérifiez dépendances et configuration.", file=sys.stderr)
        return 1

if __name__ == "__main__":
    sys.exit(main())
