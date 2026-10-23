# ElysiaJS · typescript
Base backend · SDK agent à intégrer.

Local authoring scaffold. No dependencies installed or code executed during generation.
Review dependency constraints and APIs; no lockfile or installed-framework compatibility certification is supplied.
Backend shells do not implement an agent loop or MCP protocol. Agent SDK mapping to Scaleway, trusted budgets and tool policy remain to integrate; no default provider or fallback.

Elysia targets Bun. Install/review Bun separately; the extension does not install it.


## CLI shell
Parser: built-in node:util.parseArgs (Node.js 22+/Bun). After build: `node dist/backend-cli.js --help` or `--check` (CLI shell only; no dependency/configuration proof). Serving requires explicit `--serve --host 127.0.0.1 --port 3000` and reviewed authentication; run with Bun, not Node. No AI loop is integrated. Library modules remain import-only.
