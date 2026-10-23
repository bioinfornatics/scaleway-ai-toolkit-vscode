"""Agno orchestration hosted by AgentOS behind a closed, loopback-only ASGI surface.
No app/server/model dispatch on import. No tools, DB, telemetry or native run routes.
"""
import asyncio
import json
from uuid import uuid4
from urllib.parse import urlsplit
from .config import load_project_config

BODY_TIMEOUT_SECONDS = 10


def load_runtime_config():
    config = load_project_config()
    if any(ord(c) <= 32 or ord(c) == 127 for c in config.endpoint) or chr(92) in config.endpoint:
        raise ValueError("invalid_endpoint")
    url = urlsplit(config.endpoint)
    if not url.netloc or "%" in url.netloc or url.port == 0:
        raise ValueError("invalid_endpoint")
    return config


class LocalSurface:
    """Outermost gate: even AgentOS native routes cannot bypass chat policy."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "lifespan":
            return await self.app(scope, receive, send)
        async def reject(status, error):
            if scope["type"] == "websocket":
                await send({"type": "websocket.close", "code": 1008})
                return
            body = json.dumps({"error": error}).encode()
            await send({"type": "http.response.start", "status": status, "headers": [(b"content-type", b"application/json")]})
            await send({"type": "http.response.body", "body": body})
        if scope["type"] != "http" or scope.get("path") != "/api/chat" or scope.get("raw_path", b"/api/chat") != b"/api/chat":
            return await reject(404, "not_found")
        if scope.get("method") != "POST":
            return await reject(405, "method_not_allowed")
        headers = scope.get("headers", [])
        def header(name):
            values = [v.decode("latin1") for k, v in headers if k.lower() == name]
            if len(values) > 1:
                raise ValueError("duplicate_header")
            return values[0] if values else ""
        try:
            peer = scope.get("client")
            host = urlsplit("http://" + header(b"host"))
            valid_host = host.hostname in {"localhost", "127.0.0.1"} and not host.username and not host.password and host.path == "" and not host.query and not host.fragment
            if host.port is not None and not 1 <= host.port <= 65535:
                valid_host = False
            origin = header(b"origin")
            allowed_origins = {f"http://{name}:{port}" for name in ("localhost", "127.0.0.1") for port in (3000, 3001, 5173)}
            if not peer or peer[0] not in {"127.0.0.1", "::1"} or not valid_host or (origin and origin not in allowed_origins):
                return await reject(403, "local_only")
            if header(b"content-type").split(";", 1)[0].strip().lower() != "application/json":
                return await reject(415, "json_required")
            if scope.get("query_string", b""):
                return await reject(400, "invalid_request")
        except Exception:
            return await reject(400, "invalid_request")
        return await self.app(scope, receive, send)


def create_app():
    """Call only on explicit --serve. Config is server-only; no inference here."""
    config = load_runtime_config()
    # Official Agno model errors log exception strings. Disable SDK logging for this
    # standalone server BEFORE SDK imports; never print prompts/provider payloads.
    import logging
    for name in ("agno", "agno.agno", "agno-team", "agno.agno-team", "agno-workflow", "agno.agno-workflow", "openai", "httpx", "httpcore"):
        logger = logging.getLogger(name)
        logger.handlers = [logging.NullHandler()]
        logger.propagate = False
        logger.disabled = True
    import httpx
    from agno.agent import Agent
    from agno.models.openai.like import OpenAILike
    from agno.os import AgentOS
    from fastapi import FastAPI, Request
    from fastapi.responses import JSONResponse

    endpoint = httpx.URL(config.endpoint.rstrip("/") + "/chat/completions")

    class BoundedTransport(httpx.AsyncBaseTransport):
        def __init__(self):
            self.inner = httpx.AsyncHTTPTransport(retries=0, trust_env=False)

        async def handle_async_request(self, request):
            if request.method != "POST" or request.url != endpoint:
                raise ValueError("endpoint_policy")
            response = await self.inner.handle_async_request(request)
            try:
                if response.status_code != 200:
                    raise ValueError("endpoint_failure")
                raw = bytearray()
                async for chunk in response.aiter_raw():
                    raw.extend(chunk)
                    if len(raw) > 65536:
                        raise ValueError("endpoint_failure")
                return httpx.Response(200, content=bytes(raw), headers={"content-type": "application/json"}, request=request)
            finally:
                await response.aclose()

        async def aclose(self):
            await self.inner.aclose()

    def build_agent(client):
        return Agent(
            id="scaleway-agent", name="Scaleway Agent", telemetry=False, debug_mode=False,
            model=OpenAILike(id=config.model_id, base_url=config.endpoint.rstrip("/"),
                             **dict(zip(["api_key"], [config.key])), 
                             max_tokens=1024, max_retries=0, timeout=30, http_client=client),
            tools=[], db=None, add_history_to_context=False,
            instructions="You are a helpful assistant.",
        )

    base_app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    busy = asyncio.Lock()

    @base_app.post("/api/chat")
    async def api_chat(request: Request):
        try:
            async def read_body():
                raw = bytearray()
                async for chunk in request.stream():
                    raw.extend(chunk)
                    if len(raw) > 32768:
                        raise OverflowError("invalid_request")
                return raw
            raw = await asyncio.wait_for(read_body(), timeout=BODY_TIMEOUT_SECONDS)
            def unique_object(pairs):
                result = {}
                for key, value in pairs:
                    if key in result:
                        raise ValueError("invalid_request")
                    result[key] = value
                return result
            payload = json.loads(raw, object_pairs_hook=unique_object)
            if not isinstance(payload, dict) or set(payload) != {"message"}:
                raise ValueError("invalid_request")
            message = payload["message"]
            if not isinstance(message, str) or not message.strip() or len(message) > 8000:
                raise ValueError("invalid_request")
        except asyncio.TimeoutError:
            return JSONResponse({"error": "request_timeout"}, status_code=408)
        except OverflowError:
            return JSONResponse({"error": "invalid_request"}, status_code=413)
        except Exception:
            return JSONResponse({"error": "invalid_request"}, status_code=400)
        if busy.locked():
            return JSONResponse({"error": "busy"}, status_code=429)
        async with busy:
            try:
                async with httpx.AsyncClient(transport=BoundedTransport(), timeout=30, follow_redirects=False, trust_env=False) as client:
                    result = await asyncio.wait_for(build_agent(client).arun(message, session_id=str(uuid4()), stream=False, debug_mode=False), timeout=35)
                    reply = result.content
                    if not isinstance(reply, str) or len(reply) > 32000:
                        raise ValueError("invalid_response")
                    return {"reply": reply}
            except Exception:
                return JSONResponse({"error": "chat_unavailable"}, status_code=502)

    # Registered native component is deliberately not callable through LocalSurface.
    agent_os = AgentOS(agents=[build_agent(None)], base_app=base_app,
                       tracing=False, telemetry=False, scheduler=False, mcp=False,
                       db=None, auto_provision_dbs=False, on_route_conflict="error")
    return LocalSurface(agent_os.get_app())
