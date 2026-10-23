"""Explicit CLI shell; importing API/library modules does not launch a server."""
import argparse
import sys


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(add_help=False, description="Local authoring shell; no AI loop integrated.")
    parser.add_argument("--help", "-h", action="store_true", help="Show this help and exit")
    parser.add_argument("--check", action="store_true", help="Check the CLI shell only, without SDK imports, inference or serving")
    parser.add_argument("--serve", action="store_true", help="Start the reviewed server explicitly")
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
    from server import mcp
    mcp.run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
