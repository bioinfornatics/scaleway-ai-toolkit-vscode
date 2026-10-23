# Django · python
Base backend · transport outil/MCP à intégrer.

Local authoring scaffold. No dependencies installed or code executed during generation.
Review dependency constraints and APIs; no lockfile or installed-framework compatibility certification is supplied.
Backend shells do not implement an agent loop or MCP protocol. Agent SDK mapping to Scaleway, trusted budgets and tool policy remain to integrate; no default provider or fallback.


## CLI shell
Parser: Python stdlib argparse. `python tool_cli.py --help`, `python tool_cli.py --check` (shell only; not dependency/configuration validation). Serving is explicit: `python tool_cli.py --serve --host 127.0.0.1 --port 3000`; review transport/authentication first. No inference loop is integrated. Import-only API/config/library modules retain their library form.
