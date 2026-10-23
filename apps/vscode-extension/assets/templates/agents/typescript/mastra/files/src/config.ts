import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
export function loadConfig() {
  const file = resolve(fileURLToPath(new URL("../", import.meta.url)), ".env");
  if (existsSync(file)) for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const index = line.indexOf("=");
    const name = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    if (index < 1) throw new Error("Invalid .env");
    if (process.env[name] === undefined) process.env[name] = value;
  }
  const endpoint = process.env.SCW_INFERENCE_BASE_URL;
  const modelId = process.env.SCW_INFERENCE_MODEL_ID;
  const key = process.env.SCW_API_KEY;
  if (!endpoint || !modelId || !key) throw new Error("Missing configuration");
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("Invalid endpoint");
  return { endpoint, modelId, key };
}
