"""Minimal agent using the selected Scaleway endpoint. No call on import."""
import sys
if __package__:
    from .config import load_project_config
else:
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from agent_app.config import load_project_config


def build_agent():
    config = load_project_config()
    from strands import Agent
    from strands.models.openai import OpenAIModel
    client_args = dict(base_url=config.endpoint, max_retries=0)
    client_args.update(zip(["api_key"], [config.key]))
    model = OpenAIModel(model_id=config.model_id, client_args=client_args, stream=False)
    return Agent(model=model, tools=[], system_prompt="You are a helpful assistant.", callback_handler=None)

def _run():
    if sys.argv[1:] == ["--check"]:
        load_project_config()
        print("Configuration présente ; aucun appel réseau.")
        return
    agent = build_agent()
    prompt = " ".join(sys.argv[1:]) or "Bonjour"
    print(agent(prompt))

def main():
    try:
        _run()
        return 0
    except Exception:
        print("Échec : vérifiez les dépendances, la configuration et l’accès au modèle.", file=sys.stderr)
        return 1

if __name__ == "__main__":
    sys.exit(main())
