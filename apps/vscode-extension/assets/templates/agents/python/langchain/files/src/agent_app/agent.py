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
    from langchain.agents import create_agent
    from langchain_openai import ChatOpenAI
    options = dict(model=config.model_id, base_url=config.endpoint, max_retries=0)
    options.update(zip(["api_key"], [config.key]))
    model = ChatOpenAI(**options)
    return create_agent(model=model, tools=[], system_prompt="You are a helpful assistant.")

def main():
    if sys.argv[1:] == ["--check"]:
        load_project_config()
        print("Configuration présente ; aucun appel réseau.")
        return
    agent = build_agent()
    prompt = " ".join(sys.argv[1:]) or "Bonjour"
    result = agent.invoke({"messages": [{"role": "user", "content": prompt}]})
    print(result["messages"][-1].content)

if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("Échec : vérifiez les dépendances, la configuration et l’accès au modèle.", file=sys.stderr)
        sys.exit(1)
