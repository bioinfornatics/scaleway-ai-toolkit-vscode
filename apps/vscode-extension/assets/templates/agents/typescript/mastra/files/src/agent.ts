import { loadConfig } from "./config.js";
import { pathToFileURL } from "node:url";
export async function buildAgent() {
  const config = loadConfig();
  const { Agent } = await import("@mastra/core/agent");
  return new Agent({ id: "scaleway-agent", name: "Scaleway agent", instructions: "You are a helpful assistant.", model: { providerId: "scaleway", apiKey: process.env.SCW_API_KEY, modelId: config.modelId, url: config.endpoint } });
}
export async function main() {
  if (process.argv.slice(2).join(" ") === "--check") { loadConfig(); console.log("Configuration présente ; aucun appel réseau."); return; }
  const agent = await buildAgent();
  const prompt = process.argv.slice(2).join(" ") || "Bonjour";
  console.log((await agent.generate(prompt)).text);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error("Échec : vérifiez dépendances, configuration et accès au modèle."); process.exitCode = 1; });
