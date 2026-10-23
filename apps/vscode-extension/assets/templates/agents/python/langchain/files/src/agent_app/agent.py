"""Minimal agent using the selected Scaleway endpoint. No call on import."""
import argparse
import sys
if __package__:
    from .config import load_project_config
else:
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from agent_app.config import load_project_config


def build_agent():
    config = load_project_config()
    from langchain.agents import create_agent
    from langchain_openai import ChatOpenAI
    options = dict(model=config.model_id, base_url=config.endpoint, max_retries=0)
    options.update(zip(["api_key"], [config.key]))
    model = ChatOpenAI(**options)
    return create_agent(model=model, tools=[], system_prompt="You are a helpful assistant.")

def _run(args):
    if args.check:
        load_project_config()
        print("Configuration présente ; aucun appel réseau.")
        return
    agent = build_agent()
    prompt = " ".join(args.prompt) or "Bonjour"
    result = agent.invoke({"messages": [{"role": "user", "content": prompt}]})
    print(result["messages"][-1].content)

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(add_help=False, description="Scaleway model agent; normal execution may incur inference charges.")
    parser.add_argument("--help", "-h", action="store_true", help="Show this help and exit")
    parser.add_argument("--check", action="store_true", help="Validate local configuration without inference")
    parser.add_argument("prompt", nargs="*", help="Message (default: Bonjour); use -- before literal flags")
    args = parser.parse_args(argv)
    if args.help:
        parser.print_help()
        return 0
    try:
        _run(args)
        return 0
    except Exception:
        print("Échec : vérifiez les dépendances, la configuration et l’accès au modèle.", file=sys.stderr)
        return 1

if __name__ == "__main__":
    sys.exit(main())
