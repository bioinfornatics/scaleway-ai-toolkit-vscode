"""Explicit CLI shell; importing API/library modules does not launch a server."""
import argparse
import sys


def port_number(value: str) -> int:
    try:
        port = int(value)
    except ValueError:
        raise argparse.ArgumentTypeError("port must be an integer") from None
    if not 1 <= port <= 65535:
        raise argparse.ArgumentTypeError("port must be between 1 and 65535")
    return port


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(add_help=False, description="Local authoring shell; no AI loop integrated.")
    parser.add_argument("--help", "-h", action="store_true", help="Show this help and exit")
    parser.add_argument("--check", action="store_true", help="Check the CLI shell only, without SDK imports, inference or serving")
    parser.add_argument("--serve", action="store_true", help="Start the reviewed server explicitly")
    parser.add_argument("--host", choices=["127.0.0.1"], default="127.0.0.1", help="Bind address (default: loopback)")
    parser.add_argument("--port", type=port_number, default=3000, help="Bind port (1..65535; default: 3000)")
    args = parser.parse_args(argv)
    if args.help:
        parser.print_help()
        return 0
    if args.check:
        print("CLI shell valid; dependencies and runtime integration not verified. No network or server.")
        return 0
    if not args.serve:
        parser.print_help()
        return 0
    import uvicorn
    uvicorn.run("agent_app.api:app", host=args.host, port=args.port)
    return 0


if __name__ == "__main__":
    sys.exit(main())
