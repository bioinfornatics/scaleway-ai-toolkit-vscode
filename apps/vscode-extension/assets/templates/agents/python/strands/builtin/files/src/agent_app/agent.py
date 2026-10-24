"""Minimal agent using the selected Scaleway endpoint. No call on import."""
import argparse
import sys
if __package__:
    from .config import load_project_config
else:
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from agent_app.config import load_project_config


def build_agent(*, http_client=None, max_tokens=None):
    config = load_project_config()
    from strands import Agent
    from strands.models.openai import OpenAIModel
    client_args = dict(base_url=config.endpoint, max_retries=0)
    client_args.update(zip(["api_key"], [config.key]))
    if http_client is not None:
        client_args["http_client"] = http_client
    params = {} if max_tokens is None else {"max_tokens": max_tokens}
    model = OpenAIModel(model_id=config.model_id, client_args=client_args, stream=False, params=params)
    return Agent(model=model, tools=[], system_prompt="You are a helpful assistant.", callback_handler=None)

def _run(args):
    if args.check:
        load_project_config()
        print("Configuration present; No network calls.")
        return
    agent = build_agent()
    prompt = " ".join(args.prompt) or "Hello"
    print(agent(prompt))

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(add_help=False, description="Scaleway model agent; normal execution may incur inference charges.")
    parser.add_argument("--help", "-h", action="store_true", help="Show this help and exit")
    parser.add_argument("--check", action="store_true", help="Validate local configuration without inference")
    parser.add_argument("prompt", nargs="*", help="Message (default: Hello); use -- before literal flags")
    args = parser.parse_args(argv)
    if args.help:
        parser.print_help()
        return 0
    try:
        _run(args)
        return 0
    except Exception:
        print("Failed: check dependencies, configuration and model access.", file=sys.stderr)
        return 1

if __name__ == "__main__":
    sys.exit(main())
