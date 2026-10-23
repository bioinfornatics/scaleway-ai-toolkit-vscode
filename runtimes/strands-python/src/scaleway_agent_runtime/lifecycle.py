"""Bounded OFFLINE lifecycle fixtures; not a production runtime transport.

Only host-registered synthetic runners taking a cancellation Event are supported. A resolver must
return the current immutable OfflineGrant on every operation. The full launch is
matched against its trusted template; HTTP cannot register runners or grants.
Live starts always fail closed. Memory-only keys never evict within an instance.

Gaps: no durable ledger/broker/dispatcher barrier, no Strands/provider adapter,
no general schema validator, no schema runtime-event stream or authenticated child
launcher. /replay returns bounded offline snapshots, /events is unsupported.
Health/stop are authenticated offline extensions. Host must validate bootstrap PID,
nonce/address/version against its launched child and supply dedicated anonymous pipes.
The host resolver must be bounded/nonblocking; it runs inside the registry lock.
Trusted Python callbacks are not sandboxed: cancellation is cooperative, hung workers
are daemonized and remain counted until exit. No remote-abort claim is made.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import math
import os
import re
import select
import socket
import stat
import threading
import time
import uuid
from urllib.parse import urlsplit, parse_qs

VERSION = "1.0.0"
_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")
_HEX = re.compile(r"[a-f0-9]{64}\Z")


class ControlError(Exception):
    def __init__(self, status, code):
        self.status, self.code = status, code
        super().__init__(code)


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _json(data):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError()
            result[key] = value
        return result
    return json.loads(data, object_pairs_hook=pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))


@dataclass(frozen=True)
class OfflineGrant:
    """Host-only registration. JSON strings prevent mutable request-derived authority.

    launch_json contains the reviewed runtime-http launch minus request_id and
    idempotency_key. binding_json contains the reviewed binding minus run_id and
    runtime_instance_id. Resolver owns expiry/revocation and issuer authenticity.
    expires_at is a monotonic deadline, not a request timestamp.
    """
    reference: str
    issuer: str
    launch_json: str
    binding_json: str
    expires_at: float
    runner: object = field(repr=False, compare=False)
    offline_only: bool = True


@dataclass
class _Run:
    binding: dict
    reference: str
    grant: OfflineGrant
    deadline: float
    cancel: threading.Event = field(default_factory=threading.Event)
    state: str = "running"
    sequence: int = 0
    events: deque = field(default_factory=deque)


class OfflineController:
    def __init__(self, resolver, *, max_runs=64, max_active=4, replay_limit=16,
                 run_timeout=30.0, cleanup_timeout=0.5):
        if (any(type(n) is not int or not 1 <= n <= 1024
                for n in (max_runs, max_active, replay_limit)) or
                any(not math.isfinite(n) or not 0 < n <= 3600
                    for n in (run_timeout, cleanup_timeout))):
            raise ValueError("invalid limits")
        self.instance_id = uuid.uuid4().hex
        self.resolver = resolver
        self.max_runs, self.max_active = max_runs, max_active
        self.replay_limit = replay_limit
        self.run_timeout, self.cleanup_timeout = run_timeout, cleanup_timeout
        self._lock = threading.RLock()
        self._runs, self._keys, self._workers = {}, {}, set()
        self._closed = threading.Event()
        self._monitor = threading.Thread(target=self._watch, daemon=True)
        self._monitor.start()

    def _grant(self, reference):
        try:
            grant = self.resolver(reference)
            if (not isinstance(grant, OfflineGrant) or grant.reference != reference or
                    not grant.offline_only or grant.expires_at <= time.monotonic() or
                    not callable(grant.runner)):
                raise ValueError()
            return grant
        except Exception:
            raise ControlError(403, "forbidden") from None

    def _append(self, run):
        run.sequence += 1
        run.events.append({"sequence": run.sequence, "local_state": run.state,
                           "remote_outcome": "not_sent"})
        while len(run.events) > self.replay_limit:
            run.events.popleft()

    def _finish(self, run, state):
        if run.state not in ("succeeded", "failed", "cancelled"):
            run.state = state
            self._append(run)

    def _snapshot(self, run, operation):
        return {"operation": operation, "contract_version": VERSION,
                "binding": json.loads(_canonical(run.binding)), "local_state": run.state,
                "remote_outcome": "not_sent", "last_sequence": run.sequence}

    def start(self, launch, *, live=False):
        if live:
            raise ControlError(503, "service_unavailable")
        try:
            if not isinstance(launch, dict) or not _ID.fullmatch(launch["request_id"]) or not _ID.fullmatch(launch["idempotency_key"]):
                raise ValueError()
            reference = launch["mandate"]["mandate_ref"]
            if not _ID.fullmatch(reference):
                raise ValueError()
            canonical = dict(launch)
            key = canonical.pop("idempotency_key")
            canonical.pop("request_id")
            digest = hashlib.sha256(_canonical(canonical).encode()).hexdigest()
        except (KeyError, TypeError, ValueError):
            raise ControlError(400, "invalid_request") from None
        with self._lock:
            if self._closed.is_set():
                raise ControlError(503, "service_unavailable")
            grant = self._grant(reference)
            try:
                trusted = _json(grant.launch_json)
                seed = _json(grant.binding_json)
                if canonical != trusted or trusted["operation"] != "launch" or trusted["contract_version"] != VERSION:
                    raise ValueError()
                scope_revision = seed["scope"]["scope_revision"]
                requested_duration = trusted["agent_spec"]["requested_budget"]["max_duration_ms"] / 1000
                duration = min(self.run_timeout, requested_duration, grant.expires_at - time.monotonic())
                if duration <= 0:
                    raise ValueError()
            except (KeyError, TypeError, ValueError):
                # Different request against an already reserved key is a conflict.
                for (issuer, scope, old_key), (old_digest, run_id) in self._keys.items():
                    if issuer == grant.issuer and old_key == key and self._runs[run_id].reference == reference:
                        raise ControlError(409, "idempotency_conflict") from None
                raise ControlError(409, "scope_mismatch") from None
            slot = (grant.issuer, scope_revision, key)
            if slot in self._keys:
                old_digest, run_id = self._keys[slot]
                if old_digest != digest:
                    raise ControlError(409, "idempotency_conflict")
                run = self._authorized(run_id)
                return self._snapshot(run, "accepted")
            if len(self._runs) >= self.max_runs or len(self._workers) >= self.max_active:
                raise ControlError(429, "queue_limit")
            run_id = uuid.uuid4().hex
            binding = dict(seed, run_id=run_id, runtime_instance_id=self.instance_id)
            run = _Run(binding, reference, grant, time.monotonic() + duration)
            self._runs[run_id] = run
            self._keys[slot] = (digest, run_id)
            self._append(run)
            worker = threading.Thread(target=self._execute, args=(run,), daemon=True)
            self._workers.add(worker)
            worker.start()
            return self._snapshot(run, "accepted")

    def _authorized(self, run_id):
        run = self._runs.get(run_id)
        if run is None:
            raise ControlError(403, "forbidden")
        try:
            current = self._grant(run.reference)
        except ControlError:
            run.cancel.set()
            self._finish(run, "cancelled")
            raise
        if current != run.grant or current.runner is not run.grant.runner:
            run.cancel.set()
            self._finish(run, "cancelled")
            raise ControlError(409, "stale_revision")
        return run

    def health(self):
        with self._lock:
            return {"offline_only": True, "live_available": False,
                    "instance_id": self.instance_id, "stopped": self._closed.is_set()}

    def status(self, run_id):
        with self._lock:
            return self._snapshot(self._authorized(run_id), "status")

    def cancel(self, run_id, binding):
        with self._lock:
            run = self._authorized(run_id)
            if binding != run.binding:
                raise ControlError(409, "scope_mismatch")
            run.cancel.set()
            if run.state == "running":
                run.state = "cancel_requested"
                self._append(run)
            return self._snapshot(run, "cancel_ack")

    def replay(self, run_id, after_sequence):
        with self._lock:
            run = self._authorized(run_id)
            if type(after_sequence) is not int or not 0 <= after_sequence <= run.sequence:
                raise ControlError(400, "invalid_request")
            if after_sequence < run.events[0]["sequence"] - 1:
                raise ControlError(410, "replay_unavailable")
            return {"offline_snapshots": [dict(e) for e in run.events if e["sequence"] > after_sequence]}

    def _execute(self, run):
        state = "succeeded"
        try:
            # No request-selected code, arguments, shell, tools or network adapter.
            with self._lock:
                self._authorized(run.binding["run_id"])
                if time.monotonic() >= run.deadline:
                    run.cancel.set()
                if run.cancel.is_set() or self._closed.is_set():
                    return
            run.grant.runner(run.cancel)
        except Exception:
            state = "failed"
        finally:
            with self._lock:
                try:
                    self._authorized(run.binding["run_id"])
                except ControlError:
                    run.cancel.set()
                if time.monotonic() >= run.deadline or self._closed.is_set():
                    run.cancel.set()
                self._finish(run, "cancelled" if run.cancel.is_set() else state)
                self._workers.discard(threading.current_thread())

    def _watch(self):
        while not self._closed.wait(0.02):
            with self._lock:
                for run in self._runs.values():
                    if run.state in ("running", "cancel_requested"):
                        try:
                            self._authorized(run.binding["run_id"])
                        except ControlError:
                            run.cancel.set()
                            self._finish(run, "cancelled")
                        if time.monotonic() >= run.deadline:
                            run.cancel.set()
                            self._finish(run, "cancelled")

    def stop(self):
        self._closed.set()
        with self._lock:
            for run in self._runs.values():
                run.cancel.set()
                self._finish(run, "cancelled")
            workers = list(self._workers)
        deadline = time.monotonic() + self.cleanup_timeout
        for thread in [self._monitor] + workers:
            if thread is not threading.current_thread():
                thread.join(max(0, deadline - time.monotonic()))


def _pipe(fd):
    if not stat.S_ISFIFO(os.fstat(fd).st_mode):
        raise ValueError("invalid bootstrap")


class LoopbackRuntime:
    """Dedicated pipe bootstrap, HTTP control; no env/argv capability option."""
    @classmethod
    def bootstrap(cls, controller, read_fd, reply_fd, *, setup_timeout=1.0,
                  request_timeout=1.0, max_body=65536):
        runtime = None
        try:
            if read_fd == reply_fd or not 0 < setup_timeout <= 10:
                raise ValueError()
            _pipe(read_fd)
            _pipe(reply_fd)
            deadline, data = time.monotonic() + setup_timeout, b""
            while not data.endswith(b"\n"):
                remaining = deadline - time.monotonic()
                if remaining <= 0 or not select.select([read_fd], [], [], remaining)[0]:
                    raise ValueError()
                part = os.read(read_fd, 1025 - len(data))
                if not part or len(data) + len(part) > 1024:
                    raise ValueError()
                data += part
            message = _json(data)
            if set(message) != {"capability", "nonce", "contract_version"} or message["contract_version"] != VERSION:
                raise ValueError()
            if not _HEX.fullmatch(message["capability"]) or not _HEX.fullmatch(message["nonce"]):
                raise ValueError()
            runtime = cls(controller, message["capability"], request_timeout, max_body)
            reply = (_canonical({"nonce": message["nonce"], "instance_id": controller.instance_id,
                                 "address": "127.0.0.1", "port": runtime.port,
                                 "pid": os.getpid(), "supported_versions": [VERSION],
                                 "offline_only": True}) + "\n").encode()
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not select.select([], [reply_fd], [], remaining)[1]:
                raise ValueError()
            if os.write(reply_fd, reply) != len(reply):
                raise ValueError()
            runtime._thread.start()
            return runtime
        except Exception:
            if runtime:
                runtime._server.server_close()
            controller.stop()
            raise ValueError("bootstrap failed") from None
        finally:
            for fd in {read_fd, reply_fd}:
                try:
                    os.close(fd)
                except OSError:
                    pass

    def __init__(self, controller, _capability, request_timeout, max_body):
        if (not math.isfinite(request_timeout) or not 0 < request_timeout <= 10 or
                type(max_body) is not int or not 1 <= max_body <= 1048576):
            raise ValueError("invalid limits")
        self.controller, self._capability = controller, _capability
        self.request_timeout, self.max_body = request_timeout, max_body
        self._stopped = threading.Event()
        owner = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.0"

            def setup(self):
                self.request.settimeout(owner.request_timeout)
                super().setup()
                self.timer = threading.Timer(owner.request_timeout, self.expire)
                self.timer.daemon = True
                self.timer.start()

            def expire(self):
                try:
                    self.request.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

            def finish(self):
                self.timer.cancel()
                try:
                    super().finish()
                except OSError:
                    pass

            def log_message(self, *args):
                pass

            def send_error(self, code, message=None, explain=None):
                self.respond(code, {"error": {"code": "invalid_request", "message": "Request rejected.", "retry_disposition": "never"}})

            def respond(self, status, body):
                encoded = _canonical(body).encode()
                try:
                    self.send_response(status)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(encoded)))
                    self.send_header("Connection", "close")
                    self.end_headers()
                    self.wfile.write(encoded)
                except OSError:
                    pass
                self.close_connection = True

            def __getattr__(self, name):
                # Unknown HTTP verbs still pass capability/Host checks.
                if name.startswith("do_"):
                    return self.handle_control
                raise AttributeError(name)

            def do_GET(self):
                self.handle_control()

            def do_POST(self):
                self.handle_control()

            def handle_control(self):
                request_id = "invalid"
                try:
                    headers = self.headers
                    def single(name):
                        values = headers.get_all(name, [])
                        if len(values) != 1:
                            raise ControlError(400, "invalid_request")
                        return values[0]
                    if self.client_address[0] != "127.0.0.1":
                        raise ControlError(403, "forbidden")
                    if headers.get_all("Origin") or any(k.lower() == "forwarded" or k.lower().startswith("x-forwarded-") or k.lower().startswith("proxy-") for k in headers):
                        raise ControlError(403, "forbidden")
                    authorization = headers.get_all("Authorization", [])
                    if len(authorization) != 1 or not hmac.compare_digest(authorization[0], "Bearer " + owner._capability):
                        raise ControlError(401, "unauthorized")
                    if single("Host") != "127.0.0.1:" + str(owner.port):
                        raise ControlError(403, "forbidden")
                    if single("X-Contract-Version") != VERSION:
                        raise ControlError(422, "unsupported_version")
                    request_id = single("X-Request-Id")
                    if not _ID.fullmatch(request_id):
                        request_id = "invalid"
                        raise ControlError(400, "invalid_request")
                    target = urlsplit(self.path)
                    if target.scheme or target.netloc or target.fragment or "%" in self.path:
                        raise ControlError(400, "invalid_request")
                    if headers.get_all("Transfer-Encoding") or headers.get_all("Expect"):
                        raise ControlError(400, "invalid_request")
                    if self.command == "POST":
                        length = single("Content-Length")
                        if not re.fullmatch(r"0|[1-9][0-9]{0,7}", length):
                            raise ControlError(400, "invalid_request")
                        if int(length) > owner.max_body:
                            raise ControlError(413, "payload_limit")
                        if single("Content-Type") != "application/json":
                            raise ControlError(400, "invalid_request")
                        raw = self.rfile.read(int(length))
                        if len(raw) != int(length):
                            raise ControlError(400, "invalid_request")
                        body = _json(raw)
                        if not isinstance(body, dict):
                            raise ControlError(400, "invalid_request")
                    else:
                        if headers.get_all("Content-Length") not in (None, ["0"]):
                            raise ControlError(400, "invalid_request")
                        body = None
                    path = target.path
                    replay_path = re.fullmatch(r"/v1/runs/([A-Za-z0-9._-]+)/replay", path)
                    if target.query and not replay_path:
                        raise ControlError(400, "invalid_request")
                    if self.command == "GET" and path == "/v1/health":
                        result, status = owner.controller.health(), 200
                    elif self.command == "POST" and path == "/v1/stop" and body == {}:
                        result, status = {"stopping": True, "remote_abort_confirmed": False}, 202
                        threading.Thread(target=owner.stop, daemon=True).start()
                    elif self.command == "POST" and path == "/v1/runs":
                        if body.get("request_id") != request_id or body.get("contract_version") != VERSION or single("Idempotency-Key") != body.get("idempotency_key"):
                            raise ControlError(400, "invalid_request")
                        result, status = owner.controller.start(body), 202
                    else:
                        match = re.fullmatch(r"/v1/runs/([A-Za-z0-9][A-Za-z0-9._-]{0,127})(/cancel|/replay|/events)?", path)
                        if not match:
                            raise ControlError(422, "unsupported_feature")
                        run_id, suffix = match.groups()
                        if self.command == "GET" and suffix is None:
                            result, status = owner.controller.status(run_id), 200
                        elif self.command == "POST" and suffix == "/cancel":
                            if set(body) != {"operation", "contract_version", "request_id", "binding"} or body["operation"] != "cancel" or body["contract_version"] != VERSION or body["request_id"] != request_id:
                                raise ControlError(400, "invalid_request")
                            result, status = owner.controller.cancel(run_id, body["binding"]), 202
                        elif self.command == "GET" and suffix == "/replay":
                            query = parse_qs(target.query, strict_parsing=True)
                            if set(query) != {"after_sequence"} or len(query["after_sequence"]) != 1 or not re.fullmatch(r"0|[1-9][0-9]{0,9}", query["after_sequence"][0]):
                                raise ControlError(400, "invalid_request")
                            cursor = query["after_sequence"][0]
                            if headers.get_all("Last-Event-ID", [cursor]) != [cursor]:
                                raise ControlError(400, "invalid_request")
                            result, status = owner.controller.replay(run_id, int(cursor)), 200
                        else:
                            raise ControlError(422, "unsupported_feature")
                    result["request_id"] = request_id
                    self.respond(status, result)
                except ControlError as error:
                    self.respond(error.status, {"operation": "error", "contract_version": VERSION, "request_id": "invalid",
                                               "error": {"code": error.code, "message": "Request rejected.", "retry_disposition": "never"}})
                except Exception:
                    self.respond(400, {"operation": "error", "contract_version": VERSION, "request_id": "invalid",
                                       "error": {"code": "invalid_request", "message": "Request rejected.", "retry_disposition": "never"}})

        class Server(HTTPServer):
            request_queue_size = 4
            def handle_error(self, request, client_address):
                pass
        self._server = Server(("127.0.0.1", 0), Handler)
        self.port = self._server.server_address[1]
        self._thread = threading.Thread(target=lambda: self._server.serve_forever(poll_interval=0.02), daemon=True)

    def stop(self):
        if self._stopped.is_set():
            return
        self._stopped.set()
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(self.request_timeout + 0.1)
        self.controller.stop()
