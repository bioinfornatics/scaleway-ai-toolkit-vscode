import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

export async function main(argv: string[] = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, strict: true, allowPositionals: false,
    options: { help: { type: "boolean", short: "h" }, check: { type: "boolean" }, serve: { type: "boolean" }, host: { type: "string", default: "127.0.0.1" }, port: { type: "string", default: "3000" } } });
  if (values.help) { console.log("Usage: cli [--help|-h] [--check] [--serve] [--host address] [--port 1..65535]\nAuthoring shell only; no AI loop integrated. --check does not verify dependencies."); return; }
  const port = Number(values.port);
  if (!/^\d+$/.test(values.port ?? "") || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid port (1..65535)");
  if (values.check) { console.log("CLI shell valid; dependencies and runtime integration not verified. No network or server."); return; }
  if (!values.serve) { console.log("Pass --serve explicitly after reviewing authentication; --help lists options."); return; }
  const { app } = await import("./tool.js");
  app.listen({ hostname: values.host, port });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error("CLI failed; check arguments and reviewed runtime dependencies."); process.exitCode = 1; });
