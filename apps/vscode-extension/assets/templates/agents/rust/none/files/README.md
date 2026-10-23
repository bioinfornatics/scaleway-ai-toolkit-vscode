# Sans framework · rust
Base langage · SDK agent à choisir.

Local authoring scaffold. No dependencies installed or code executed during generation.
Review dependency constraints and APIs; no lockfile or installed-framework compatibility certification is supplied.
Backend shells do not implement an agent loop or MCP protocol. Agent SDK mapping to Scaleway, trusted budgets and tool policy remain to integrate; no default provider or fallback.


## CLI shell
Parser: clap 4 with derive. `cargo run -- --help` and `cargo run -- --check` check the CLI shell, not model integration. No inference loop is integrated. Cargo may need dependencies to compile; no lockfile or download is bundled.
