# Agno + AgentOS local runtime

Dedicated **Python API**, not an interchangeable Strands backend or an integrated Next server. Agno builds/orchestrates the agent; AgentOS adds its FastAPI runtime. This starter calls **Agent.arun** through the product adapter, not the model-only urllib endpoint transport used by other service bases.

## Explicit operations

After reviewing/installing dependencies yourself: uv sync, then uv run agent --help, uv run agent --check, or **uv run agent --serve**. No inference occurs during generation, import, help, check, or serving startup. Only a submitted chat invokes the model and may incur charges. Bind defaults to 127.0.0.1:3001, non-loopback hosts are rejected. The extension's agent runner stays **not-ready** and does not manage this server.

Run commands from the generated project root: the process working directory is the root contract, including installed wheel console commands. Only cwd/.env is read by explicit check/serve; no ancestor search or user environment-file discovery. Existing environment variables take precedence. Use server-only SCW_INFERENCE_BASE_URL (HTTPS API base including /v1), SCW_INFERENCE_MODEL_ID (exact provider model ID) and SCW_API_KEY. Never NEXT_PUBLIC_ or VITE_ variables. OpenAILike receives explicit id/base_url/key; no default provider or endpoint, redirects, proxy environment or client retries. Agno v3.1.10 / OpenAI 2.54.0 / httpx 0.28.1 are explicit requirements; FastAPI/Uvicorn starter ranges are not locks. Dependencies and real Scaleway compatibility have not been installed or verified by generation.

## Restricted adapter, not the open Control Plane API

Only POST /api/chat accepts exactly {"message":"..."} and returns {"reply":"..."}. Native /agents/*/runs, sessions, uploads, docs, MCP and WebSocket routes are blocked by an **outer ASGI gate**, before AgentOS. No caller-selected model, URL, session, tools, extra fields or background/streaming run options. No tools/MCP/tracing/scheduler/database/file-system tools, persistent history, telemetry, Control Plane or external exposure by default. Fresh agent and generated session identity per request; one concurrent request; no automatic retry. Message limit8000 characters, input32768 bytes, upstream response65536 bytes, output32000 characters, body-ingestion deadline10s (408 on timeout), endpoint timeout30s/whole run35s. Errors are fixed and never echo upstream bodies, prompts or secrets.

Gate requires loopback peer + local Host + application/json; Origin, when present, must be localhost/127.0.0.1 on3000,3001,5173. A local process can call the adapter and incur inference; this is not authentication or a multi-user production service. Native routes remain denied even if OS_SECURITY_KEY/JWT is configured. Do not expose an inner get_app() result or remove the gate: AgentOS without auth defaults to no central credentials. If independently enabling native APIs later, review official Security & Auth, distinct OS_SECURITY_KEY or JWT/RBAC, CSRF, rate limits, budgets and exposure. Never reuse the provider API key as an OS key.

Edit src/agent_app/service_api.py (build_agent, instructions, adapter/policy), config.py, and agent.py (argparse). Build wheel manually with uv build. The common offline config tests remain in tests/unit; evals are opt-in and do not prove Agno orchestration.

Optional Next/Vite frontends proxy only /api/chat to127.0.0.1:3001. No secrets in frontend files; Next production rewrite supported, Vite proxy is dev-only. Browser UI and installed runtime validation remain separate from mocked tests.

## Official grounding (retrieved2026-10-24)

- https://docs.agno.com/agent-os/introduction
- https://docs.agno.com/models/providers/openai-like
- https://docs.agno.com/agent-os/security/overview
- https://github.com/agno-agi/agno/blob/v3.1.10/libs/agno/agno/os/app.py
- https://github.com/agno-agi/agno/blob/v3.1.10/libs/agno/agno/models/openai/chat.py

API factory uses AgentOS(agents, base_app, tracing=False, telemetry=False, scheduler=False, mcp=False, db=None, auto_provision_dbs=False). Official introduction's Workspace/Sqlite/tracing/scheduler/MCP example is deliberately **not** copied.

The official agno[os] extra supplies AgentOS import dependencies; scheduler/tracing libraries are present but not enabled. SDK logging is suppressed before import, debug_mode=False, and Uvicorn access logs are disabled: provider exceptions must not print raw content. This standalone runtime changes its own process logging only.
