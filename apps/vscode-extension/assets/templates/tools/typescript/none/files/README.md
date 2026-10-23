# Sans framework · typescript
Fonction locale · sans serveur.

Local authoring scaffold. No dependencies installed or code executed during generation.
Review dependency constraints and APIs; no lockfile or installed-framework compatibility certification is supplied.
Backend shells do not implement an agent loop or MCP protocol. Agent SDK mapping to Scaleway, trusted budgets and tool policy remain to integrate; no default provider or fallback.


## CLI shell
Parser: built-in node:util.parseArgs (Node.js 22+/Bun). After build: `node dist/cli.js --help` or `--check` (CLI shell only; no dependency/configuration proof). No AI loop is integrated. Library modules remain import-only.
