# MCP Python scaffold
No server is launched/registered by generation. Review dependencies, transport/authentication, schemas, arguments/results and grants before manual launch. Pin from specifications/references/compatibility/runtime-contract-profile-v1.json; not a production lock.


## CLI shell
Parser: Python stdlib argparse. `python cli.py --help`, `python cli.py --check` (shell only; not dependency/configuration validation). Serving is explicit: `python cli.py --serve`; review transport/authentication first. No inference loop is integrated. Import-only API/config/library modules retain their library form.
