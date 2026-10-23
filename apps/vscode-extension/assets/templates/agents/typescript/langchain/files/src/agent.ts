import { parseArgs } from "node:util";
import { loadConfig } from "./config.js";
import { pathToFileURL } from "node:url";
export async function buildAgent() {
  const config = loadConfig();
  const { createAgent } = await import("langchain");
  const { ChatOpenAI } = await import("@langchain/openai");
  const model = new ChatOpenAI({ model: config.modelId, apiKey: process.env.SCW_API_KEY, configuration: { baseURL: config.endpoint }, maxRetries: 0 });
  return createAgent({ model, tools: [], systemPrompt: "You are a helpful assistant." });
}
export async function main(argv: string[] = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args: argv, strict: true, allowPositionals: true,
    options: { help: { type: "boolean", short: "h" }, check: { type: "boolean" } } });
  if (values.help) { console.log("Usage: agent [--help|-h] [--check] [--] [prompt ...]\n--check validates local configuration without inference. Normal execution may incur inference charges; default prompt: Bonjour."); return; }
  if (values.check) { loadConfig(); console.log("Configuration présente ; aucun appel réseau."); return; }
  const agent = await buildAgent();
  const prompt = positionals.join(" ") || "Bonjour";
  const result = await agent.invoke({ messages: [{ role: "user", content: prompt }] });
  console.log(result.messages.at(-1)?.content);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error("Échec : vérifiez dépendances, configuration et accès au modèle."); process.exitCode = 1; });
