"""Local, synthetic loopback tests only; no cloud/inference/Strands execution."""
import copy
from dataclasses import replace
import http.client
import json
import os
from pathlib import Path
import secrets
import socket
import sys
import threading
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from scaleway_agent_runtime.lifecycle import (
    ControlError, OfflineController, OfflineGrant, LoopbackRuntime,
)

def fixtures():
    # Minimal synthetic values actually consumed by OfflineController, not a
    # schema fixture or evidence of a production Agent integration.
    launch = {"operation": "launch", "contract_version": "1.0.0",
              "request_id": "fixture-request", "idempotency_key": "fixture-key",
              "mandate": {"mandate_ref": "fixture-mandate"},
              "agent_spec": {"requested_budget": {"max_duration_ms": 30000}}}
    binding = {"epoch": 1, **{key: "a" * 64 for key in
        ("spec_revision", "prompt_revision", "data_revision", "model_revision")},
        "scope": {"connection_ref": "connection", "credential_generation": 1,
                  "organization_ref": "organization", "project_ref": "project",
                  "region": "fr-par", "scope_revision": "b" * 64}}
    return launch, binding


class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.launch, seed = fixtures()
        canonical = copy.deepcopy(self.launch)
        canonical.pop("request_id")
        canonical.pop("idempotency_key")
        self.called = 0
        self.release = threading.Event()
        def runner(cancel):
            self.called += 1
            while not self.release.wait(0.005):
                if cancel.is_set():
                    break
        self.grant = OfflineGrant(self.launch["mandate"]["mandate_ref"], "host",
                                  json.dumps(canonical), json.dumps(seed),
                                  time.monotonic() + 60, runner)
        self.registry = {self.grant.reference: self.grant}
        self.controller = OfflineController(self.registry.get, max_runs=2,
                                            max_active=1, replay_limit=2,
                                            run_timeout=1, cleanup_timeout=0.05)
        self.capability, self.nonce = secrets.token_hex(32), secrets.token_hex(32)
        read_fd, write_fd = os.pipe()
        reply_read, reply_write = os.pipe()
        message = {"capability": self.capability, "nonce": self.nonce,
                   "contract_version": "1.0.0"}
        os.write(write_fd, (json.dumps(message) + "\n").encode())
        os.close(write_fd)
        self.runtime = LoopbackRuntime.bootstrap(self.controller, read_fd, reply_write,
                                                 request_timeout=0.15, max_body=16000)
        self.bootstrap = json.loads(os.read(reply_read, 1024))
        os.close(reply_read)
        self.addCleanup(self.runtime.stop)
        self.addCleanup(self.release.set)

    def request(self, method="GET", path="/v1/health", body=None, headers=None):
        h = {"Authorization": "Bearer " + self.capability,
             "Host": "127.0.0.1:" + str(self.runtime.port),
             "X-Contract-Version": "1.0.0", "X-Request-Id": "fixture-request"}
        if body is not None:
            h["Content-Type"] = "application/json"
            if isinstance(body, dict) and "request_id" in body:
                h["X-Request-Id"] = body["request_id"]
            if isinstance(body, dict) and "idempotency_key" in body:
                h["Idempotency-Key"] = body["idempotency_key"]
        for key, value in (headers or {}).items():
            if value is None:
                h.pop(key, None)
            else:
                h[key] = value
        conn = http.client.HTTPConnection("127.0.0.1", self.runtime.port, timeout=1)
        try:
            conn.request(method, path, json.dumps(body) if body is not None else None, h)
            response = conn.getresponse()
            data = response.read()
            return response.status, json.loads(data), dict(response.getheaders())
        finally:
            conn.close()

    def accepted(self):
        status, result, _ = self.request("POST", "/v1/runs", self.launch)
        self.assertEqual(status, 202, result)
        return result

    def wait_terminal(self, run_id):
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            state = self.controller.status(run_id)["local_state"]
            if state in ("succeeded", "failed", "cancelled"):
                return state
            time.sleep(0.01)
        self.fail("local terminal timeout")

    def test_bootstrap_nonce_instance_versions_and_rotation(self):
        self.assertEqual(self.bootstrap["nonce"], self.nonce)
        self.assertEqual(self.bootstrap["instance_id"], self.controller.instance_id)
        self.assertEqual(self.bootstrap["address"], "127.0.0.1")
        self.assertEqual(self.bootstrap["supported_versions"], ["1.0.0"])
        self.assertEqual(self.bootstrap["pid"], os.getpid())
        self.assertEqual(self.runtime._server.server_address[0], "127.0.0.1")
        self.assertNotIn(self.capability, json.dumps(self.bootstrap))
        self.assertGreater(self.bootstrap["port"], 0)
        other = OfflineController(self.registry.get)
        self.addCleanup(other.stop)
        self.assertNotEqual(other.instance_id, self.controller.instance_id)

    def test_health_auth_required_no_cors(self):
        for value in (None, "Bearer wrong", "Basic abc"):
            status, result, headers = self.request(headers={"Authorization": value})
            self.assertEqual(status, 401)
            self.assertNotIn("instance_id", result)
            self.assertFalse(any(k.lower().startswith("access-control-") for k in headers))
        status, result, _ = self.request()
        self.assertEqual(status, 200)
        self.assertTrue(result["offline_only"])
        self.assertFalse(result["live_available"])

    def test_unsupported_methods_also_require_auth_and_host(self):
        for method in ("OPTIONS", "PUT", "DELETE", "INVENTED"):
            self.assertEqual(self.request(method, headers={"Authorization": None})[0], 401)
            self.assertEqual(self.request(method, headers={"Host": "localhost"})[0], 403)
            self.assertEqual(self.request(method)[0], 422)

    def test_origin_host_forwarding_and_query_rejected(self):
        for h in ({"Origin": "null"}, {"Origin": "http://localhost"},
                  {"Host": "localhost:" + str(self.runtime.port)},
                  {"Host": "127.0.0.1"}, {"Forwarded": "for=127.0.0.1"},
                  {"X-Forwarded-Host": "127.0.0.1"}, {"Proxy-Authorization": "x"}):
            self.assertEqual(self.request(headers=h)[0], 403)
        for path in ("/v1/health?token=x", "http://127.0.0.1/v1/health", "/v1/health#x"):
            self.assertEqual(self.request(path=path)[0], 400)
        self.assertEqual(self.request(headers={"X-Contract-Version": "2"})[0], 422)

    def test_duplicate_auth_and_host_rejected(self):
        for name, value in (("Authorization", "Bearer " + self.capability),
                            ("Host", "127.0.0.1:" + str(self.runtime.port))):
            conn = http.client.HTTPConnection("127.0.0.1", self.runtime.port, timeout=1)
            conn.putrequest("GET", "/v1/health", skip_host=True)
            conn.putheader("Host", "127.0.0.1:" + str(self.runtime.port))
            conn.putheader("Authorization", "Bearer " + self.capability)
            conn.putheader(name, value)
            conn.putheader("X-Contract-Version", "1.0.0")
            conn.putheader("X-Request-Id", "fixture-request")
            conn.endheaders()
            response = conn.getresponse()
            self.assertIn(response.status, (400, 401))
            response.read()
            conn.close()

    def test_body_limits_framing_and_generic_errors(self):
        self.assertEqual(self.request("POST", "/v1/runs", {"canary": "x" * 17000})[0], 413)
        self.assertEqual(self.request("POST", "/v1/runs", self.launch,
                                      {"Transfer-Encoding": "chunked"})[0], 400)
        self.assertEqual(self.request("POST", "/v1/runs", self.launch,
                                      {"Content-Type": "text/plain"})[0], 400)
        bad = copy.deepcopy(self.launch)
        bad["mandate"]["mandate_ref"] = "CANARY"
        status, result, _ = self.request("POST", "/v1/runs", bad)
        self.assertEqual(status, 403)
        self.assertNotIn("CANARY", json.dumps(result))
        self.assertNotIn(self.capability, json.dumps(result))
        self.assertEqual(self.request("GET", "/v1/health", {})[0], 400)

    def test_idempotency_and_no_request_registered_authority(self):
        first = self.accepted()
        duplicate = copy.deepcopy(self.launch)
        duplicate["request_id"] = "another-request"
        self.assertEqual(self.request("POST", "/v1/runs", duplicate)[1]["binding"], first["binding"])
        different = copy.deepcopy(self.launch)
        different["input"] = "unreviewed"
        self.assertEqual(self.request("POST", "/v1/runs", different)[0], 409)
        self.assertEqual(self.request("POST", "/v1/runs", self.launch,
                                      {"Idempotency-Key": "different"})[0], 400)
        different["idempotency_key"] = "new-key"
        different["approved"] = True
        self.assertEqual(self.request("POST", "/v1/runs", different)[0], 409)
        self.assertEqual(self.request("POST", "/v1/mandates", {})[0], 422)
        deadline = time.monotonic() + 1
        while not self.called and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertEqual(self.called, 1)

    def test_cancel_binding_and_no_abort_claim(self):
        first = self.accepted()
        run_id = first["binding"]["run_id"]
        path = "/v1/runs/" + run_id + "/cancel"
        cancel = {"operation": "cancel", "contract_version": "1.0.0",
                  "request_id": "cancel-request", "binding": first["binding"]}
        bad = copy.deepcopy(cancel)
        bad["binding"]["epoch"] += 1
        self.assertEqual(self.request("POST", path, bad)[0], 409)
        self.assertEqual(self.request("POST", path, cancel, {"Authorization": None})[0], 401)
        status, ack, _ = self.request("POST", path, cancel)
        self.assertEqual(status, 202)
        self.assertEqual(ack["operation"], "cancel_ack")
        self.assertEqual(ack["remote_outcome"], "not_sent")
        self.assertNotIn("remote_abort_confirmed", ack)
        self.assertEqual(self.wait_terminal(run_id), "cancelled")
        self.release.set()
        time.sleep(0.02)
        self.assertEqual(self.controller.status(run_id)["local_state"], "cancelled")

    def test_status_replay_auth_retention_and_cursor(self):
        first = self.accepted()
        run_id = first["binding"]["run_id"]
        base = "/v1/runs/" + run_id
        self.assertEqual(self.request(path=base, headers={"Authorization": None})[0], 401)
        self.assertEqual(self.request(path=base + "/replay?after_sequence=0",
                                      headers={"Authorization": None})[0], 401)
        self.assertEqual(self.request(path=base)[0], 200)
        self.assertEqual(self.request(path="/v1/runs/unknown")[0], 403)
        self.assertEqual(self.request(path=base + "/events?after_sequence=0")[0], 400)
        self.assertEqual(self.request(path=base + "/events")[0], 422)
        self.assertEqual(self.request(path=base + "/replay?after_sequence=0",
                                      headers={"Last-Event-ID": "1"})[0], 400)
        self.assertEqual(self.request(path=base + "/replay?after_sequence=0&token=x")[0], 400)
        self.assertEqual(self.request(path=base + "/replay?after_sequence=999")[0], 400)
        self.assertEqual(self.request(path=base + "/replay?after_sequence=0")[0], 200)
        self.controller.cancel(run_id, first["binding"])
        self.wait_terminal(run_id)
        self.assertEqual(self.request(path=base + "/replay?after_sequence=0")[0], 410)
        events = self.request(path=base + "/replay?after_sequence=1")[1]["offline_snapshots"]
        self.assertEqual([e["sequence"] for e in events], [2, 3])
        self.assertEqual(events[-1]["local_state"], "cancelled")

    def test_revoke_and_expiry_deny_read_duplicate_and_dispatch(self):
        first = self.accepted()
        run_id = first["binding"]["run_id"]
        self.registry.clear()
        self.assertEqual(self.request(path="/v1/runs/" + run_id)[0], 403)
        self.assertEqual(self.request("POST", "/v1/runs", self.launch)[0], 403)
        deadline = time.monotonic() + 1
        while self.controller._runs[run_id].state != "cancelled" and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertEqual(self.controller._runs[run_id].state, "cancelled")
        self.registry[self.grant.reference] = replace(self.grant, expires_at=time.monotonic() - 1)
        self.assertEqual(self.request("POST", "/v1/runs", self.launch)[0], 403)
        self.registry[self.grant.reference] = replace(self.grant, issuer="changed")
        self.assertEqual(self.request(path="/v1/runs/" + run_id)[0], 409)

    def test_live_always_fails_closed(self):
        with self.assertRaises(ControlError) as error:
            self.controller.start(self.launch, live=True)
        self.assertEqual(error.exception.status, 503)
        self.registry[self.grant.reference] = replace(self.grant, offline_only=False)
        self.assertEqual(self.request("POST", "/v1/runs", self.launch)[0], 403)
        self.assertEqual(self.called, 0)

    def test_limits_keep_completed_idempotency_keys(self):
        self.release.set()
        first = self.accepted()
        self.wait_terminal(first["binding"]["run_id"])
        second = copy.deepcopy(self.launch)
        second["idempotency_key"] = "key-two"
        status, result, _ = self.request("POST", "/v1/runs", second)
        self.assertEqual(status, 202)
        self.wait_terminal(result["binding"]["run_id"])
        third = copy.deepcopy(self.launch)
        third["idempotency_key"] = "key-three"
        self.assertEqual(self.request("POST", "/v1/runs", third)[0], 429)
        self.assertEqual(self.accepted()["binding"], first["binding"])
        self.assertEqual(self.called, 2)

    def test_active_limit(self):
        self.accepted()
        another = copy.deepcopy(self.launch)
        another["idempotency_key"] = "key-two"
        self.assertEqual(self.request("POST", "/v1/runs", another)[0], 429)

    def test_slow_body_connection_expires_and_server_recovers(self):
        sock = socket.create_connection(("127.0.0.1", self.runtime.port), timeout=1)
        request = ("POST /v1/runs HTTP/1.1\r\nHost: 127.0.0.1:%s\r\nAuthorization: Bearer %s\r\n"
                   "X-Contract-Version: 1.0.0\r\nX-Request-Id: fixture-request\r\n"
                   "Content-Type: application/json\r\nContent-Length: 100\r\n\r\n{") % (self.runtime.port, self.capability)
        sock.sendall(request.encode())
        time.sleep(0.22)
        try:
            self.assertEqual(sock.recv(4096), b"")
        finally:
            sock.close()
        self.assertEqual(self.request()[0], 200)

    def test_hung_worker_deadline_cleanup_and_failures_content_free(self):
        block = threading.Event()
        self.addCleanup(block.set)
        def hung(cancel):
            block.wait(3)
        self.registry[self.grant.reference] = replace(self.grant, runner=hung)
        self.controller.run_timeout = 0.05
        first = self.accepted()
        self.assertEqual(self.wait_terminal(first["binding"]["run_id"]), "cancelled")
        self.assertEqual(len(self.controller._workers), 1)
        start = time.monotonic()
        self.runtime.stop()
        self.assertLess(time.monotonic() - start, 0.4)
        self.assertFalse(self.runtime._thread.is_alive())
        self.assertFalse(self.controller._monitor.is_alive())
        self.assertTrue(all(t.daemon for t in self.controller._workers))
        with self.assertRaises(ControlError):
            self.controller.start(self.launch)
        with self.assertRaises(OSError):
            socket.create_connection(("127.0.0.1", self.runtime.port), timeout=0.1)

    def test_runner_exception_is_not_serialized(self):
        def fail(cancel):
            raise RuntimeError("CANARY-private")
        self.registry[self.grant.reference] = replace(self.grant, runner=fail)
        first = self.accepted()
        run_id = first["binding"]["run_id"]
        self.assertEqual(self.wait_terminal(run_id), "failed")
        self.assertNotIn("CANARY", json.dumps(self.controller.status(run_id)))

    def test_authenticated_stop(self):
        self.assertEqual(self.request("POST", "/v1/stop", {}, {"Authorization": None})[0], 401)
        self.assertEqual(self.request("POST", "/v1/stop", {})[0], 202)
        self.runtime._thread.join(1)
        self.assertFalse(self.runtime._thread.is_alive())

    def test_short_capability_bootstrap_rejected(self):
        for capability in ("a" * 32, "not-hex" * 10):
            controller = OfflineController(lambda _: None, cleanup_timeout=0.02)
            read_fd, write_fd = os.pipe()
            reply_read, reply_write = os.pipe()
            os.write(write_fd, (json.dumps({"capability": capability, "nonce": self.nonce,
                                          "contract_version": "1.0.0"}) + "\n").encode())
            os.close(write_fd)
            with self.assertRaisesRegex(ValueError, "bootstrap failed"):
                LoopbackRuntime.bootstrap(controller, read_fd, reply_write)
            self.assertEqual(os.read(reply_read, 1024), b"")
            os.close(reply_read)
            self.assertFalse(controller._monitor.is_alive())

    def test_bootstrap_requires_dedicated_pipe_closes_on_timeout(self):
        controller = OfflineController(lambda _: None, cleanup_timeout=0.02)
        read_fd, write_fd = os.pipe()
        reply_read, reply_write = os.pipe()
        start = time.monotonic()
        with self.assertRaisesRegex(ValueError, "bootstrap failed"):
            LoopbackRuntime.bootstrap(controller, read_fd, reply_write, setup_timeout=0.03)
        self.assertLess(time.monotonic() - start, 0.2)
        for fd in (read_fd, reply_write):
            with self.assertRaises(OSError):
                os.fstat(fd)
        os.close(write_fd)
        os.close(reply_read)
        self.assertTrue(controller.health()["stopped"])


if __name__ == "__main__":
    unittest.main()
