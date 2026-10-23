"""Offline exact generated source execution; SDK/ASGI mocks, never installed runtime proof."""
import asyncio
import builtins
import json
import os
import sys
import types
import httpx as installed_httpx
assert installed_httpx.__version__ == "0.28.1"

files = json.load(sys.stdin)
package = types.ModuleType("agent_app"); package.__path__ = []
sys.modules["agent_app"] = package
config = types.ModuleType("agent_app.config")
exec(files["src/agent_app/config.py"], config.__dict__)
sys.modules[config.__name__] = config
# Explicit synthetic environment; no reads from real project/user configuration.
config.load_project_config = lambda: config.load_config({"SCW_API_KEY": "synthetic-private-key", "SCW_INFERENCE_BASE_URL": state.get("endpoint", "https://example.invalid/v1"), "SCW_INFERENCE_MODEL_ID": "offline-model"})
api = types.ModuleType("agent_app.service_api")
sys.modules[api.__name__] = api
original_import = builtins.__import__
def guard(name, *args, **kwargs):
    if name.split(".")[0] in {"agno", "httpx", "openai", "fastapi", "uvicorn"}:
        raise AssertionError("runtime import on module import")
    return original_import(name, *args, **kwargs)
builtins.__import__ = guard
exec(files["src/agent_app/service_api.py"], api.__dict__)
builtins.__import__ = original_import
state = {"runs": [], "dispatches": [], "clients": [], "agents": [], "native": 0, "closed": 0}

class Response:
    def __init__(self, status_code=200, content=b"{}", headers=None, request=None):
        self.status_code = status_code; self.content = content; self.request = request
    async def aiter_raw(self):
        for offset in range(0, len(self.content), 1024):
            yield self.content[offset:offset+1024]
    async def aclose(self): state["closed"] += 1
class InnerTransport:
    def __init__(self, **kwargs): assert kwargs == {"retries": 0, "trust_env": False}
    async def handle_async_request(self, request):
        state["dispatches"].append(request)
        return Response(state.get("upstream_status", 200), b"x" * state.get("upstream_size", 1))
    async def aclose(self): pass
class Client:
    def __init__(self, **kwargs):
        assert kwargs["timeout"] == 30 and kwargs["follow_redirects"] is False and kwargs["trust_env"] is False
        self.transport = kwargs["transport"]; state["clients"].append(self)
    async def __aenter__(self): return self
    async def __aexit__(self, *args): await self.transport.aclose()
class Model:
    def __init__(self, **kwargs):
        assert kwargs["base_url"] == state.get("endpoint", "https://example.invalid/v1").rstrip("/") and kwargs["id"] == "offline-model"
        assert kwargs["api_key"] == "synthetic-private-key"
        assert kwargs["max_tokens"] == 1024 and kwargs["max_retries"] == 0 and kwargs["timeout"] == 30
        self.client = kwargs["http_client"]
class Agent:
    def __init__(self, **kwargs):
        assert kwargs["debug_mode"] is False and kwargs["tools"] == [] and kwargs["telemetry"] is False and kwargs["db"] is None and kwargs["add_history_to_context"] is False
        self.model = kwargs["model"]; state["agents"].append(self)
    async def arun(self, message, **kwargs):
        assert kwargs["debug_mode"] is False and isinstance(kwargs["session_id"], str) and kwargs["stream"] is False
        state["runs"].append((message, kwargs["session_id"]))
        if message == "wait":
            state["started"].set(); await state["release"].wait()
        if message == "error": raise RuntimeError("PRIVATE_UPSTREAM_DETAIL")
        await self.model.client.transport.handle_async_request(types.SimpleNamespace(method="POST", url=installed_httpx.URL(state.get("endpoint", "https://example.invalid/v1").rstrip("/") + "/chat/completions")))
        return types.SimpleNamespace(content=("x" * 32001 if message == "long" else "mock-reply"))
class Request:
    def __init__(self, chunks): self.chunks = chunks
    async def stream(self):
        for chunk in self.chunks: yield chunk
class JsonResponse:
    def __init__(self, content, status_code): self.content=content; self.status_code=status_code
class App:
    def __init__(self, **kwargs):
        assert kwargs == {"docs_url": None, "redoc_url": None, "openapi_url": None}
    def post(self, path):
        assert path == "/api/chat"
        def register(fn): self.handler = fn; return fn
        return register
    async def __call__(self, scope, receive, send):
        if scope["type"] == "lifespan":
            state["lifespan"] = True; return
        if scope["path"] != "/api/chat":
            state["native"] += 1; raise AssertionError("native bypass")
        item = await receive()
        result = await self.handler(Request([item.get("body", b"")]))
        status = result.status_code if isinstance(result, JsonResponse) else 200
        content = result.content if isinstance(result, JsonResponse) else result
        await send({"type":"http.response.start", "status":status})
        await send({"type":"http.response.body", "body":json.dumps(content).encode()})
class OS:
    def __init__(self, **kwargs):
        for flag in ("tracing", "telemetry", "scheduler", "mcp", "auto_provision_dbs"):
            assert kwargs[flag] is False
        assert kwargs["db"] is None and kwargs["on_route_conflict"] == "error"
        assert len(kwargs["agents"]) == 1
        self.app = kwargs["base_app"]
    def get_app(self): return self.app
for name in ("agno", "agno.agent", "agno.models", "agno.models.openai", "agno.models.openai.like", "agno.os", "fastapi", "fastapi.responses", "httpx"):
    sys.modules[name] = types.ModuleType(name)
sys.modules["agno.agent"].Agent = Agent
sys.modules["agno.models.openai.like"].OpenAILike = Model
sys.modules["agno.os"].AgentOS = OS
sys.modules["fastapi"].FastAPI = App; sys.modules["fastapi"].Request = Request
sys.modules["fastapi.responses"].JSONResponse = JsonResponse
httpx = sys.modules["httpx"]; httpx.URL = installed_httpx.URL; httpx.AsyncBaseTransport = object; httpx.AsyncHTTPTransport = InnerTransport; httpx.AsyncClient = Client; httpx.Response = Response
app = api.create_app()
assert state["runs"] == [] and state["clients"] == [] and state["dispatches"] == []
async def request(raw=b'{"message":"hello"}', **updates):
    scope={"type":"http", "path":"/api/chat", "raw_path":b"/api/chat", "method":"POST", "headers":[(b"host",b"127.0.0.1:3001"),(b"content-type",b"application/json")], "client":("127.0.0.1",1000),"query_string":b""}
    scope.update(updates); output=[]
    async def receive(): return {"type":"http.request", "body":raw}
    async def send(item): output.append(item)
    await app(scope, receive, send)
    return output[0].get("status", output[0].get("code")), output[-1].get("body", b"")
async def verify():
    for path in ("/agents/scaleway-agent/runs", "/agents", "/sessions", "/docs", "/mcp", "/api/chat/", "/api/chat%2f"):
        status, _ = await request(path=path); assert status == 404
    assert (await request(type="websocket"))[0] == 1008
    assert (await request(method="GET"))[0] == 405
    assert (await request(raw_path=b"/%61pi/chat"))[0] == 404
    assert (await request(client=("8.8.8.8",1)))[0] == 403
    for headers, status in [
        ([(b"host",b"evil.invalid"),(b"content-type",b"application/json")],403),
        ([(b"host",b"localhost:3001"),(b"content-type",b"application/json"),(b"origin",b"https://evil.invalid")],403),
        ([(b"host",b"localhost:3001"),(b"content-type",b"text/plain")],415),
        ([(b"host",b"localhost:3001"),(b"host",b"localhost:3001")],400),
    ]: assert (await request(headers=headers))[0] == status
    assert (await request(query_string=b"model=override"))[0] == 400
    for raw, status in [(b"{}",400),(b"[]",400),(b"invalid",400),(b'{"message":"a","message":"b"}',400),(b'{"message":" ","url":"evil"}',400),(json.dumps({"message":"x"*8001}).encode(),400),(b"x"*32769,413)]:
        assert (await request(raw))[0] == status
    assert state["runs"] == [] and state["native"] == 0
    assert (await request())[0] == 200
    assert (await request(headers=[(b"host",b"localhost:3001"),(b"content-type",b"application/json"),(b"origin",b"http://localhost:5173")]))[0] == 200
    for message in ("error", "long"):
        status, body = await request(json.dumps({"message":message}).encode()); assert status == 502 and b"PRIVATE" not in body
    state["upstream_status"] = 302
    assert (await request())[0] == 502
    state["upstream_status"] = 200; state["upstream_size"] = 65537
    assert (await request())[0] == 502
    state["upstream_size"] = 1
    transport = state["clients"][-1].transport
    count = len(state["dispatches"])
    for method, url in [("GET","https://example.invalid/v1/chat/completions"),("POST","https://evil.invalid/v1/chat/completions"),("POST","http://example.invalid/v1/chat/completions"),("POST","https://example.invalid/v1/chat/completions?override=1"),("POST","https://example.invalid/v1/chat/completions/"),("POST","https://example.invalid/v1/embeddings")]:
        try: await transport.handle_async_request(types.SimpleNamespace(method=method,url=installed_httpx.URL(url)))
        except ValueError: pass
        else: raise AssertionError("endpoint policy not enforced")
    assert len(state["dispatches"]) == count
    state["started"] = asyncio.Event(); state["release"] = asyncio.Event()
    pending = asyncio.create_task(request(b'{"message":"wait"}'))
    await state["started"].wait()
    assert (await request())[0] == 429
    state["release"].set(); assert (await pending)[0] == 200
    # Real pinned HTTPX URL normalization; only orchestration/transport/ASGI are mocks.
    global app
    for endpoint in ("https://EXAMPLE.INVALID/v1", "https://example.invalid:443/v1", "https://EXAMPLE.INVALID:443/v1/"):
        state["endpoint"] = endpoint
        app = api.create_app()
        assert (await request())[0] == 200
        transport = state["clients"][-1].transport
        count = len(state["dispatches"])
        for method, url in [("GET", endpoint.rstrip("/")+"/chat/completions"), ("POST", endpoint.rstrip("/")+"/chat/completions?q=1"), ("POST", "https://evil.invalid/v1/chat/completions")]:
            try: await transport.handle_async_request(types.SimpleNamespace(method=method, url=installed_httpx.URL(url)))
            except ValueError: pass
            else: raise AssertionError("normalized endpoint restriction lost")
        assert len(state["dispatches"]) == count
        state["upstream_status"] = 302
        assert (await request())[0] == 502
        state["upstream_status"] = 200
    # A stalled stream must be cancelled before creating any agent run/client.
    class SlowRequest:
        async def stream(self):
            try:
                yield b'{"message":'
                await asyncio.Event().wait()
            finally:
                state["body_cancelled"] = True
    before = (len(state["runs"]), len(state["clients"]), len(state["dispatches"]))
    api.BODY_TIMEOUT_SECONDS = 0.01
    result = await asyncio.wait_for(app.app.handler(SlowRequest()), timeout=1)
    assert result.status_code == 408 and result.content == {"error": "request_timeout"}
    assert state["body_cancelled"] and before == (len(state["runs"]), len(state["clients"]), len(state["dispatches"]))
    api.BODY_TIMEOUT_SECONDS = 10
    assert (await request())[0] == 200
    ids = [run[1] for run in state["runs"]]; assert len(ids) == len(set(ids))
    async def receive(): return {}
    async def send(item): pass
    await app({"type":"lifespan"}, receive, send); assert state["lifespan"]
    assert state["native"] == 0
    print("PASS mocked Agno.arun + AgentOS factory, stateless/concurrency, ASGI native denial, bounded transport, safe failures")
asyncio.run(verify())
