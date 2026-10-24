export const interactiveAgent = String.raw`"""Explicit foreground conversation. No model calls on import/help/check."""
import argparse
import sys
if __package__:
    from .agent import build_agent
    from .config import load_project_config
else:
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from agent_app.agent import build_agent
    from agent_app.config import load_project_config

def main(argv=None):
    parser = argparse.ArgumentParser(description="Foreground conversation; messages may incur inference charges.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="Check local configuration without inference")
    mode.add_argument("--interactive", action="store_true", help="Wait for messages; exit, EOF or Ctrl+C stops")
    args = parser.parse_args(argv)
    if not args.check and not args.interactive:
        parser.print_help()
        return 0
    try:
        if args.check:
            load_project_config()
            print("Configuration present; no inference.")
            return 0
        agent = None
        while True:
            message = input("You > ")
            if message.strip().lower() == "exit":
                return 0
            if not message.strip():
                continue
            if len(message) > 8000:
                print("Invalid message: maximum 8000 characters.", file=sys.stderr)
                continue
            if agent is None:
                agent = build_agent(max_tokens=1024)
            print(agent(message))
    except (EOFError, KeyboardInterrupt):
        return 0
    except Exception:
        print("Failed: check dependencies, configuration and model access.", file=sys.stderr)
        return 1

if __name__ == "__main__":
    sys.exit(main())
`;
