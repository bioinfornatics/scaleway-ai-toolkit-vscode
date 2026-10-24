import * as TOML from '@iarna/toml';
import { a2aApi, a2aExecutor, a2aReadme } from './a2aService';
import { composeAgentProject } from './agentProject';
import { interactiveAgent } from './interactiveAgent';
import {
  prepareEmbeddedProject,
  renderProjectTemplate,
} from './projectGenerator';
import type { ListedModel } from './provider';
import {
  apiCapability,
  compatibleServiceSdk,
  supportsCli,
  supportsIntegrated,
  supportsInteractive,
} from './serviceCompatibility';
import type { StackChoice } from './stackScaffold';
import { parseTemplate, type TemplateDefinition } from './templateLibrary';

export interface ServiceOptions {
  projectType: 'agent' | 'webapp';
  exposure: 'none' | 'cli' | 'api';
  frontend: 'nextjs' | 'vite';
  architecture: 'integrated' | 'separate';
}

const transport = String.raw`import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const envFile = fileURLToPath(new URL("../.env", import.meta.url));
export function loadServiceConfig() {
  if (existsSync(envFile)) for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const split = line.indexOf("="); if (split < 1) throw new Error("invalid_config");
    const field = line.slice(0, split).trim();
    const value = line.slice(split + 1).trim().replace(/^["']|["']$/g, "");
    if (process.env[field] === undefined) process.env[field] = value;
  }
  const base = (process.env.SCW_INFERENCE_BASE_URL || "").replace(/\/$/, "");
  const model = process.env.SCW_INFERENCE_MODEL_ID;
  const key = process.env.SCW_API_KEY;
  const url = new URL(base);
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search || url.hash || !model || !key) throw new Error("invalid_config");
  return { base, model, key };
}
export function validMessage(value: unknown): value is { message: string } {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    typeof (value as { message?: unknown }).message === "string" &&
    !!(value as { message: string }).message.trim() && (value as { message: string }).message.length <= 8000;
}
export async function chat(message: string): Promise<string> {
  if (!validMessage({ message })) throw new Error("invalid_request");
  const { base, model, key } = loadServiceConfig();
  const response = await fetch(base + "/chat/completions", {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(30000),
    headers: Object.fromEntries([["Authorization", ["Bearer", key].join(" ")], ["Content-Type", "application/json"]]),
    body: JSON.stringify({ model, messages: [{ role: "user", content: message }], max_tokens: 1024 }),
  });
  if (!response.ok || Number(response.headers.get("content-length") || 0) > 65536 || !response.body) throw new Error("endpoint_failure");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const item = await reader.read(); if (item.done) break;
    size += item.value.byteLength; if (size > 65536) throw new Error("endpoint_failure"); chunks.push(item.value);
  } } finally { await reader.cancel(); }
  const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const reply = result?.choices?.[0]?.message?.content;
  if (typeof reply !== "string" || reply.length > 32000) throw new Error("endpoint_failure");
  return reply;
}
`;

const pythonTransport = `import json
import os
from pathlib import Path
import urllib.request
from urllib.parse import urlsplit

def load_service_config():
    env_file = Path.cwd() / ".env"
    for line in env_file.read_text().splitlines() if env_file.is_file() else []:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        field, value = line.split("=", 1)
        os.environ.setdefault(field.strip(), value.strip().strip(chr(39) + chr(34)))
    base = os.environ.get("SCW_INFERENCE_BASE_URL", "").rstrip("/")
    model = os.environ.get("SCW_INFERENCE_MODEL_ID", "")
    key = os.environ.get("SCW_API_KEY", "")
    url = urlsplit(base)
    if url.scheme != "https" or not url.hostname or url.username or url.password or url.query or url.fragment or not model or not key:
        raise ValueError("invalid_config")
    return base, model, key

def chat(message):
    if not isinstance(message, str) or not message.strip() or len(message) > 8000:
        raise ValueError("invalid_request")
    base, model, key = load_service_config()
    data = json.dumps({"model": model, "messages": [{"role": "user", "content": message}], "max_tokens": 1024}).encode()
    headers = {"Content-Type": "application/json"}
    headers.update(zip(["Authorization"], [" ".join(["Bearer", key])]))
    request = urllib.request.Request(base + "/chat/completions", data=data, headers=headers)
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
        raw = response.read(65537)
    if len(raw) > 65536:
        raise ValueError("endpoint_failure")
    reply = json.loads(raw)["choices"][0]["message"]["content"]
    if not isinstance(reply, str) or len(reply) > 32000:
        raise ValueError("endpoint_failure")
    return reply
`;

const pythonApi = `from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from .service_transport import chat

app = FastAPI()

@app.post("/api/chat")
async def api_chat(request: Request):
    try:
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > 32768:
                return JSONResponse({"error": "invalid_request"}, status_code=413)
        import json
        payload = json.loads(raw)
        message = payload.get("message") if isinstance(payload, dict) else None
        if not isinstance(message, str) or not message.strip() or len(message) > 8000:
            return JSONResponse({"error": "invalid_request"}, status_code=400)
    except Exception:
        return JSONResponse({"error": "invalid_request"}, status_code=400)
    try:
        return {"reply": await run_in_threadpool(chat, message)}
    except Exception:
        return JSONResponse({"error": "chat_unavailable"}, status_code=502)
`;

const litestarApi = `import json
import asyncio
from litestar import Litestar, Request, post
from litestar.response import Response
from litestar.exceptions.http_exceptions import RequestEntityTooLarge
from .service_transport import chat

@post("/api/chat", status_code=200)
async def api_chat(request: Request) -> Response:
    try:
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > 32768:
                return Response({"error": "invalid_request"}, status_code=413)
        payload = json.loads(raw)
        message = payload.get("message") if isinstance(payload, dict) else None
        if not isinstance(message, str) or not message.strip() or len(message) > 8000:
            return Response({"error": "invalid_request"}, status_code=400)
    except RequestEntityTooLarge:
        return Response({"error": "invalid_request"}, status_code=413)
    except Exception:
        return Response({"error": "invalid_request"}, status_code=400)
    try:
        reply = await asyncio.to_thread(chat, message)
        return Response({"reply": reply}, status_code=200)
    except Exception:
        return Response({"error": "chat_unavailable"}, status_code=502)

app = Litestar(route_handlers=[api_chat], request_max_body_size=32768, debug=False)
`;

const elysiaApi = `import { Elysia } from "elysia";
import { chat, validMessage } from "./service-transport.js";
export const app = new Elysia({ serve: { maxRequestBodySize: 32768 } })
  .onError(({ set }) => { set.status = 400; return { error: "invalid_request" }; })
  .post("/api/chat", async ({ body, set }) => {
    if (!validMessage(body)) { set.status = 400; return { error: "invalid_request" }; }
    try { return { reply: await chat(body.message) }; }
    catch { set.status = 502; return { error: "chat_unavailable" }; }
  });
`;

const nodeCli = String.raw`import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, strict: true, options: {
    help: { type: "boolean", short: "h" }, check: { type: "boolean" }, serve: { type: "boolean" },
    host: { type: "string", default: "127.0.0.1" }, port: { type: "string", default: "3001" },
  } });
  if (values.help || (!values.check && !values.serve)) { console.log("Usage: service [--help|-h] [--check] [--serve --host 127.0.0.1 --port 3001]\nServing is explicit; chat requests may incur inference charges."); return; }
  if (values.host !== "127.0.0.1" || !/^\d+$/.test(values.port!) || +values.port! < 1 || +values.port! > 65535) throw new Error("invalid_bind");
  if (values.check) { (await import("./service-transport.js")).loadServiceConfig(); console.log("Local configuration present; no inference or server."); return; }
  const { app } = await import("./service-api.js");
  app.listen({ hostname: values.host, port: +values.port! });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error("Service unavailable; check dependencies and configuration."); process.exitCode = 1; });
`;

const pythonCli = `import argparse
import sys

def main(argv=None):
    parser = argparse.ArgumentParser(description="Local service; requests may incur inference charges.")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--serve", action="store_true")
    parser.add_argument("--host", choices=["127.0.0.1"], default="127.0.0.1")
    parser.add_argument("--port", type=int, default=3001)
    args = parser.parse_args(argv)
    if not 1 <= args.port <= 65535:
        parser.error("invalid port")
    try:
        if args.check:
            from agent_app.service_transport import load_service_config
            load_service_config()
            print("Local configuration present; no inference or server.")
        elif args.serve:
            import uvicorn
            uvicorn.run("agent_app.service_api:app", host=args.host, port=args.port)
        else:
            parser.print_help()
        return 0
    except Exception:
        print("Service unavailable; check dependencies and configuration.", file=sys.stderr)
        return 1

if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        print("Service unavailable; check dependencies and configuration.", file=sys.stderr)
        sys.exit(1)
`;

const ui = `"use client";
import { useState, type FormEvent } from "react";
export default function Chat() {
  const [message, setMessage] = useState(""); const [reply, setReply] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || !message.trim()) return;
    setBusy(true); setError(""); setReply("");
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }), signal: AbortSignal.timeout(35000) });
      if (!response.ok) throw new Error("request_failed");
      const result = await response.json(); if (typeof result.reply !== "string") throw new Error("invalid_response");
      setReply(result.reply);
    } catch { setError("Chat unavailable. Check the local server configuration."); }
    finally { setBusy(false); }
  }
  return <main><h1>Model chat</h1><p>Submitting calls the model and may incur charges.</p>
    <form onSubmit={submit}><label htmlFor="message">Message</label><br />
      <textarea id="message" value={message} maxLength={8000} required onChange={event => setMessage(event.target.value)} />
      <br /><button disabled={busy || !message.trim()}>{busy ? "Sending…" : "Send"}</button></form>
    <p role="alert">{error}</p><pre aria-live="polite" style={{ whiteSpace: "pre-wrap" }}>{reply}</pre></main>;
}
`;

const nextRoute = `import { chat, validMessage } from "../../../src/service-transport";
export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    if (!request.body) return Response.json({ error: "invalid_request" }, { status: 400 });
    const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { const item = await reader.read(); if (item.done) break;
      size += item.value.byteLength; if (size > 32768) return Response.json({ error: "invalid_request" }, { status: 413 }); chunks.push(item.value);
    } } finally { await reader.cancel(); }
    payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return Response.json({ error: "invalid_request" }, { status: 400 }); }
  if (!validMessage(payload)) return Response.json({ error: "invalid_request" }, { status: 400 });
  try { return Response.json({ reply: await chat(payload.message) }); }
  catch { return Response.json({ error: "chat_unavailable" }, { status: 502 }); }
}
`;

const integratedCli = String.raw`const { parseArgs } = require("node:util");
const { spawn } = require("node:child_process");
function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, strict: true, options: {
    help: { type: "boolean", short: "h" }, check: { type: "boolean" }, serve: { type: "boolean" }
  } });
  if (values.help || (!values.check && !values.serve)) { console.log("Usage: service [--help|-h] [--check] [--serve]\n--serve starts Next explicitly on loopback; chat may incur charges."); return; }
  if (values.check) { console.log("CLI valid; Next dependencies/configuration not verified. No server or inference."); return; }
  const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "dev", "--hostname", "127.0.0.1"], { cwd: __dirname, stdio: "inherit" });
  child.on("error", () => { console.error("Service unavailable."); process.exitCode = 1; });
  child.on("exit", code => { process.exitCode = code ?? 1; });
}
try { main(); } catch { console.error("Service unavailable; check arguments and dependencies."); process.exitCode = 1; }
`;

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
function frontendFiles(
  next: boolean,
  integrated: boolean,
): Record<string, string> {
  const files: Record<string, string> = {};
  files['package.json'] = json({
    name: 'service-frontend',
    private: true,
    type: 'module',
    scripts: next
      ? {
          dev: 'next dev --hostname 127.0.0.1',
          build: 'next build',
          start: 'next start --hostname 127.0.0.1',
        }
      : {
          dev: 'vite --host 127.0.0.1',
          build: 'tsc --noEmit && vite build',
          preview: 'vite preview --host 127.0.0.1',
        },
    dependencies: {
      ...(next ? { next: '^15.5.0' } : {}),
      react: '^19.1.0',
      'react-dom': '^19.1.0',
    },
    devDependencies: {
      typescript: '^5.9.0',
      '@types/node': '^22.0.0',
      '@types/react': '^19.0.0',
      '@types/react-dom': '^19.0.0',
      ...(!next ? { vite: '^7.1.0', '@vitejs/plugin-react': '^5.0.0' } : {}),
    },
    engines: { node: '>=22.12.0' },
  });
  files['tsconfig.json'] = json({
    compilerOptions: {
      target: 'ES2022',
      lib: ['dom', 'dom.iterable', 'esnext'],
      strict: true,
      skipLibCheck: true,
      esModuleInterop: true,
      module: 'ESNext',
      moduleResolution: 'bundler',
      jsx: next ? 'preserve' : 'react-jsx',
      noEmit: true,
      ...(next ? { plugins: [{ name: 'next' }] } : {}),
    },
    include: next
      ? [
          'next-env.d.ts',
          'app/**/*.ts',
          'app/**/*.tsx',
          ...(integrated ? ['src/service-transport.ts'] : []),
          '.next/types/**/*.ts',
        ]
      : ['src', 'vite.config.ts'],
  });
  if (next) {
    files['app/page.tsx'] = ui;
    files['app/layout.tsx'] =
      'import type { ReactNode } from "react";\nexport default function Layout({ children }: { children: ReactNode }) { return <html lang="en"><body>{children}</body></html>; }\n';
    files['next-env.d.ts'] =
      '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n';
    files['next.config.mjs'] = integrated
      ? 'export default {};\n'
      : 'export default { async rewrites() { return [{ source: "/api/chat", destination: "http://127.0.0.1:3001/api/chat" }]; } };\n';
  } else {
    files['src/Chat.tsx'] = ui;
    files['src/main.tsx'] =
      'import { createRoot } from "react-dom/client";\nimport Chat from "./Chat";\ncreateRoot(document.getElementById("root")!).render(<Chat />);\n';
    files['index.html'] =
      '<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>Model chat</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n';
    files['vite.config.ts'] =
      'import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\nexport default defineConfig({ plugins: [react()], server: { proxy: { "/api/chat": { target: "http://127.0.0.1:3001" } } } });\n';
  }
  return files;
}

/** Apply to endpoint-adapted StackChoice templates. Framework sources stay intact. */
export function composeServiceProject(
  backend: StackChoice | undefined,
  ai: StackChoice | undefined,
  name: string,
  model?: ListedModel,
  personal?: TemplateDefinition,
  projectId?: string,
  options?: ServiceOptions,
): TemplateDefinition {
  const opts = options ?? {
    projectType: 'agent',
    exposure: 'cli',
    frontend: 'nextjs',
    architecture: 'separate',
  };
  if (
    !['agent', 'webapp'].includes(opts.projectType) ||
    !['none', 'cli', 'api'].includes(opts.exposure) ||
    !['nextjs', 'vite'].includes(opts.frontend) ||
    !['integrated', 'separate'].includes(opts.architecture)
  )
    throw new Error('invalid_service_options');
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name))
    throw new Error('invalid_project_name');
  if (opts.exposure === 'none') {
    if (
      opts.projectType !== 'agent' ||
      personal ||
      !supportsInteractive(ai?.language, ai?.framework) ||
      (backend &&
        (backend.category !== 'basic' || backend.language !== 'python'))
    )
      throw new Error('unsupported_interactive_agent');
    const composed = composeAgentProject(
      undefined,
      ai,
      name,
      model,
      undefined,
      projectId,
    );
    const base = renderProjectTemplate(
      composed.version === 1
        ? prepareEmbeddedProject(composed, 'python')
        : composed,
      { name },
    );
    const files: Record<string, string> = {
      ...base.files,
      'src/agent_app/interactive.py': interactiveAgent,
    };
    const pkg = TOML.parse(files['pyproject.toml']) as unknown as {
      project: { scripts: Record<string, string> };
    };
    pkg.project.scripts ??= {};
    pkg.project.scripts['scaleway-agent'] = 'agent_app.interactive:main';
    files['pyproject.toml'] = TOML.stringify(pkg);
    files['.vscode/scaleway-agent-run.json'] = json({
      version: 1,
      ready: false,
      runtime: 'python',
      entry: 'src/agent_app/interactive.py',
      args: ['--help'],
    });
    files['service.authoring.json'] = json({
      version: 1,
      ...opts,
      transport: 'strands-interactive',
      main_source: 'src/agent_app/agent.py',
      install_verified: false,
      build_verified: false,
      local_only: true,
    });
    files['README.md'] +=
      '\n\n## Agent interface: None\nPython + Strands only. Explicit foreground conversation: scaleway-agent --interactive. Default/--help show help; --check reads project-root .env without inference. One Agent built at first valid message and reused for history. No API, daemon, tasks or background inference. Blank messages ignored; exit, EOF/Ctrl+C stop. Maximum 8000 characters, fixed errors, no retries. agent.py stays one-shot. Native/live verification not run.\n';
    return parseTemplate({ ...base, files });
  }
  const agentos = backend?.framework === 'agentos';
  if (
    agentos &&
    (backend?.language !== 'python' ||
      !compatibleServiceSdk('agentos', ai?.framework))
  )
    throw new Error('incompatible_agentos_sdk');
  if (agentos && opts.exposure === 'cli' && opts.projectType === 'agent')
    throw new Error('agentos_requires_api');
  if (
    agentos &&
    opts.projectType === 'webapp' &&
    opts.architecture === 'integrated'
  )
    throw new Error('unsupported_integrated_service');
  if (opts.projectType === 'agent' && opts.exposure === 'cli') {
    const cliLanguage =
      ai?.language ?? backend?.language ?? personal?.project?.language;
    if (!personal && (!cliLanguage || !supportsCli(cliLanguage)))
      throw new Error('unsupported_cli_language');
    return composeAgentProject(
      backend?.category === 'basic' ? backend : undefined,
      ai,
      name,
      model,
      personal,
      projectId,
    );
  }
  if (personal)
    throw new Error('personal_service_requires_explicit_integration');
  const integrated =
    opts.projectType === 'webapp' && opts.architecture === 'integrated';
  const language = backend?.language ?? ai?.language;
  if (integrated && !supportsIntegrated(opts.frontend, language))
    throw new Error('unsupported_integrated_service');
  const capability = apiCapability(backend?.language, backend?.framework);
  if (!integrated && (backend?.category !== 'backend' || !capability))
    throw new Error('unsupported_api_backend');
  if (ai && ai.language !== language) throw new Error('incompatible_language');
  let base = composeAgentProject(
    integrated
      ? backend
        ? { ...backend, category: 'basic' }
        : undefined
      : backend,
    ai,
    name,
    model,
    undefined,
    projectId,
  );
  if (!language) throw new Error('missing_service_language');
  base = renderProjectTemplate(
    base.version === 1 ? prepareEmbeddedProject(base, language) : base,
    { name },
  );
  const a2a =
    opts.projectType === 'agent' &&
    opts.exposure === 'api' &&
    backend?.framework === 'fastapi' &&
    ai?.framework === 'strands' &&
    language === 'python';
  const files = { ...base.files };
  let entry: string;
  if (integrated) {
    const front = frontendFiles(true, true);
    const pkg = JSON.parse(files['package.json'] ?? '{}');
    const nextPkg = JSON.parse(front['package.json']);
    front['package.json'] = json({
      ...pkg,
      ...nextPkg,
      name: name.toLowerCase(),
      dependencies: { ...pkg.dependencies, ...nextPkg.dependencies },
      devDependencies: { ...pkg.devDependencies, ...nextPkg.devDependencies },
    });
    Object.assign(files, front);
    // Next bundles route modules; import.meta.url is not a stable project root.
    files['src/service-transport.ts'] = transport.replace(
      'fileURLToPath(new URL("../.env", import.meta.url))',
      'process.cwd() + "/.env"',
    );
    files['app/api/chat/route.ts'] = nextRoute;
    files['service-cli.cjs'] = integratedCli;
    entry = 'service-cli.cjs';
  } else if (language === 'python') {
    if (!agentos && !a2a)
      files['src/agent_app/service_transport.py'] = pythonTransport;
    if (a2a) {
      files['src/agent_app/a2a_executor.py'] = a2aExecutor;
      files['src/agent_app/config.py'] = files[
        'src/agent_app/config.py'
      ].replace(
        'Path(__file__).resolve().parents[2] / ".env"',
        'Path.cwd() / ".env"',
      );
    }
    if (!agentos)
      files['src/agent_app/service_api.py'] = a2a
        ? a2aApi
        : capability?.adapter === 'litestar'
          ? litestarApi
          : pythonApi;
    files['src/agent_app/service_cli.py'] = agentos
      ? files['src/agent_app/agent.py']
      : a2a
        ? pythonCli
            .replace(
              'from agent_app.service_transport import load_service_config',
              'from agent_app.config import load_project_config as load_service_config',
            )
            .replace(
              'uvicorn.run("agent_app.service_api:app", host=args.host, port=args.port)',
              'from agent_app.service_api import create_app\n            uvicorn.run(create_app(args.port), host=args.host, port=args.port, proxy_headers=False, access_log=False, log_level="critical")',
            )
        : pythonCli;
    const manifest = TOML.parse(files['pyproject.toml']) as {
      project: Record<string, unknown>;
    };
    if (a2a)
      manifest.project.dependencies = [
        ...(manifest.project.dependencies as string[]),
        'a2a-sdk[http-server]==1.2.3',
      ];
    manifest.project.scripts = {
      ...(manifest.project.scripts as Record<string, string>),
      service: 'agent_app.service_cli:main',
    };
    files['pyproject.toml'] = TOML.stringify(manifest as TOML.JsonMap);
    entry = 'src/agent_app/service_cli.py';
  } else {
    files['src/service-transport.ts'] = transport;
    files['src/service-api.ts'] = elysiaApi;
    files['src/service-cli.ts'] = nodeCli;
    const pkg = JSON.parse(files['package.json']);
    pkg.scripts = {
      ...pkg.scripts,
      service: 'bun dist/service-cli.js',
      start: 'bun dist/service-cli.js --serve',
    };
    files['package.json'] = json(pkg);
    entry = 'dist/service-cli.js';
  }
  if (opts.projectType === 'webapp' && !integrated) {
    for (const [path, content] of Object.entries(
      frontendFiles(opts.frontend === 'nextjs', false),
    ))
      files[`frontend/${path}`] = content;
    if (language === 'typescript') {
      const pkg = JSON.parse(files['package.json']);
      pkg.scripts = {
        ...pkg.scripts,
        'frontend:install': 'bun install --cwd frontend',
        'frontend:dev': 'bun run --cwd frontend dev',
        'frontend:build': 'bun run --cwd frontend build',
      };
      files['package.json'] = json(pkg);
    }
  }
  files['.vscode/scaleway-agent-run.json'] = json({
    version: 1,
    ready: false,
    runtime: language === 'python' ? 'python' : 'node',
    entry,
    args: ['--help'],
  });
  files['service.authoring.json'] = json({
    version: 1,
    ...opts,
    transport: agentos
      ? 'agno-agentos'
      : a2a
        ? 'a2a-strands'
        : 'server-side-endpoint-client',
    main_source: integrated
      ? 'app/page.tsx'
      : language === 'python'
        ? a2a
          ? 'src/agent_app/agent.py'
          : 'src/agent_app/service_api.py'
        : 'src/service-api.ts',
    install_verified: false,
    build_verified: false,
    local_only: true,
  });
  files['.env.example'] =
    'SCW_INFERENCE_BASE_URL=\nSCW_INFERENCE_MODEL_ID=\nSCW_API_KEY=$SCW_API_KEY\n';
  files['.gitignore'] =
    `${files['.gitignore'] ?? ''}\n.env\n.env.*\n!.env.example\nnode_modules/\n.next/\ndist/\nfrontend/dist/\n.venv/\n`;
  files['README.md'] =
    (files['README.md'] ?? '') +
    '\n\n## Composed service (explicit launch)\n' +
    (a2a
      ? a2aReadme
      : agentos
        ? 'POST /api/chat executes Agno Agent.arun with OpenAILike inside AgentOS, returns {"reply":"..."}. Native routes are blocked by LocalSurface.\n'
        : 'POST /api/chat accepts {"message":"..."}, returns {"reply":"..."}, and calls the Scaleway HTTPS endpoint server-side. SDK sources remain for authoring; this route uses an independent endpoint transport.\n') +
    'Create only root .env with SCW_INFERENCE_BASE_URL, SCW_INFERENCE_MODEL_ID and SCW_API_KEY. Never use NEXT_PUBLIC_ or VITE_ credentials. No caller-provided endpoint URLs.\n' +
    (integrated
      ? 'Install: bun install. Build: bun run build. Explicit run: node service-cli.cjs --serve (dev), or bun run start after build. Edit app/page.tsx and app/api/chat/route.ts.\n'
      : language === 'python'
        ? 'Install: uv sync. Check: uv run python -m agent_app.service_cli --check. Explicit run: uv run python -m agent_app.service_cli --serve. Build wheel: uv build. Edit src/agent_app/service_api.py.\n'
        : 'Install: bun install. Build: bun run build. Check: bun dist/service-cli.js --check. Explicit run: bun dist/service-cli.js --serve. Elysia requires Bun, not Node. Edit src/service-api.ts.\n') +
    (opts.projectType === 'webapp' && !integrated
      ? 'Frontend: cd frontend && bun install && bun run build; bun run dev starts explicitly. /api/chat proxy expects backend 127.0.0.1:3001. Next production uses rewrites; Vite proxy is dev-only (production needs a reverse proxy).\n'
      : '') +
    'Help precedes configuration/dependency imports. No server/inference on import/generation. Only submitted requests incur inference. Agent launch stays not-ready: review/run manually; agent runner does not manage servers.\n' +
    (a2a
      ? 'A2A limits are documented above; review before any external exposure.\n'
      : 'Limits: 8000 message characters / 32768 request bytes, 30s endpoint timeout, 65536 response bytes. Fixed errors never return endpoint bodies/secrets. Loopback only: add authentication, CSRF/rate limiting and deployment review before external exposure.\n') +
    'Next ^15.5, React ^19.1, Vite ^7.1 are starter ranges, not locks or locally verified compatibility/security claims. Node >=22.12 / current Bun required. No installs, framework builds or browser checks performed.\n';
  return parseTemplate({
    ...base,
    files,
    ...(base.project ? { project: { ...base.project, render: {} } } : {}),
  });
}
