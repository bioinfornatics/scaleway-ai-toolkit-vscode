"""TEST-ONLY loopback HTTP hosting probe. No Strands, provider calls or run effects.

Synthetic /probe routes deliberately do NOT implement runtime-http/events v1.
In-memory ownership, retention and semaphore are not production auth/storage.
"""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hmac
import json
import secrets
import threading
import time
from urllib.parse import urlsplit, parse_qs


class MemorySessions:
    """Seeded synthetic state; never persists secrets, mandates or paid effects."""
    def __init__(self):
        self.rows = {"session-a": {"owner": "alice", "events": [1, 2, 3]}}
        self.available = True

    def read(self, session_id, owner):
        if not self.available:
            return 503, None
        row = self.rows.get(session_id)
        if row is None:
            return 410, None
        if row["owner"] != owner:
            return 403, None
        return 200, row


class ProbeServer(ThreadingHTTPServer):
    daemon_threads = False
    block_on_close = True

    def __init__(self, sessions=None, duration=0.3, capacity=2):
        self.sessions = sessions if sessions is not None else MemorySessions()
        self.duration = duration
        self.interval = 0.025
        self.stop = threading.Event()
        self.slots = threading.BoundedSemaphore(capacity)
        self.lock = threading.Lock()
        self.active = 0
        self.peak = 0
        self.tokens = {secrets.token_hex(32): "alice", secrets.token_hex(32): "bob"}
        super().__init__(("127.0.0.1", 0), Handler)
        self.expected_host = "127.0.0.1:" + str(self.server_port)

    def handle_error(self, request, client_address):
        # Never log exception/request contents in this synthetic probe.
        pass


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def reply(self, status, code, payload=None):
        data = json.dumps({"code": code} if payload is None else payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(data)
        self.close_connection = True

    def do_GET(self):
        self.connection.settimeout(0.5)  # Bound a blocked write/read in test harness.
        server = self.server
        if self.client_address[0] != "127.0.0.1":
            return self.reply(403, "forbidden")
        if (self.headers.get_all("Host") != [server.expected_host]
                or self.headers.get_all("Origin") is not None):
            return self.reply(403, "forbidden")
        auth = self.headers.get_all("Authorization") or []
        owner = None
        if len(auth) == 1:
            for token, identity in server.tokens.items():
                if hmac.compare_digest(auth[0], "Bearer " + token):
                    owner = identity
        if owner is None:
            return self.reply(401, "unauthorized")
        parsed = urlsplit(self.path)
        if parsed.scheme or parsed.netloc or parsed.fragment:
            return self.reply(400, "invalid_request")
        query = parse_qs(parsed.query, keep_blank_values=True)
        if parsed.path == "/probe/health" and not query:
            return self.reply(200, "ok")
        if parsed.path == "/probe/events" and not query:
            return self.stream()
        if parsed.path == "/probe/sessions/session-a":
            if set(query) - {"after"} or any(len(v) != 1 for v in query.values()):
                return self.reply(400, "invalid_request")
            cursor = query.get("after", ["0"])[0]
            if not cursor.isascii() or not cursor.isdigit() or len(cursor) > 6:
                return self.reply(400, "invalid_request")
            cursor = int(cursor)
            ids = self.headers.get_all("Last-Event-ID")
            if ids is not None and ids != [str(cursor)]:
                return self.reply(400, "invalid_request")
            status, row = server.sessions.read("session-a", owner)
            if status != 200:
                return self.reply(status, {403: "forbidden", 410: "replay_unavailable", 503: "store_unavailable"}[status])
            # Retain only last two events; no relaunch on evicted cursor.
            if cursor < row["events"][-2] - 1:
                return self.reply(410, "replay_unavailable")
            if cursor > row["events"][-1]:
                return self.reply(400, "invalid_request")
            return self.reply(200, "ok", {"events": [n for n in row["events"][-2:] if n > cursor]})
        return self.reply(400, "invalid_request")

    def stream(self):
        server = self.server
        if not server.slots.acquire(blocking=False):
            return self.reply(429, "capacity_exceeded")
        with server.lock:
            server.active += 1
            server.peak = max(server.peak, server.active)
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache, no-transform")
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
            start = time.monotonic()
            sequence = 1
            self.wfile.write(b'id: 1\nevent: probe\ndata: {"kind":"started"}\n\n')
            self.wfile.flush()
            while not server.stop.wait(server.interval):
                if time.monotonic() - start >= server.duration:
                    sequence += 1
                    data = ('id: %d\nevent: probe\ndata: {"kind":"deadline","remote_outcome":"not_sent"}\n\n' % sequence).encode()
                    self.wfile.write(data)
                    self.wfile.flush()
                    break
                self.wfile.write(b': heartbeat\n\n')
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            # Transport disconnection stops only this synthetic stream, no rollback.
            pass
        finally:
            with server.lock:
                server.active -= 1
            server.slots.release()


@contextmanager
def running_probe(**kwargs):
    server = ProbeServer(**kwargs)
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01})
    thread.start()
    try:
        yield server
    finally:
        server.stop.set()
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
        if thread.is_alive() or server.active:
            raise RuntimeError("probe cleanup failed")
