import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

export async function main(argv: string[] = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, strict: true, allowPositionals: false,
    options: { help: { type: "boolean", short: "h" }, check: { type: "boolean" } } });
  if (values.help) { console.log("Usage: cli [--help|-h] [--check]\nAuthoring shell only; no AI loop integrated. --check does not verify dependencies."); return; }
  if (values.check) { console.log("CLI shell valid; dependencies and runtime integration not verified. No network or server."); return; }
  const { add } = await import("./tool.js");
  console.log(add(2, 3));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error("CLI failed; check arguments and reviewed runtime dependencies."); process.exitCode = 1; });
