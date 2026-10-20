"""Real local HTTP tests, not Scaleway or production runtime conformance."""
import hashlib
import http.client
import json
from pathlib import Path
import socket
import time
import unittest
from local_probe import MemorySessions, running_probe


ROOT = Path(__file__).resolve().parents[2]


class HostingProbeTests(unittest.TestCase):
    def request(self, server, path="/probe/health", *, identity="alice", headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=2)
        token = next(k for k, v in server.tokens.items() if v == identity)
        h = {"Authorization": "Bearer " + token}
        if headers:
            h.update(headers)
        connection.request("GET", path, headers=h)
        response = connection.getresponse()
        return connection, response

    def status(self, server, expected, **kwargs):
        c, r = self.request(server, **kwargs)
        try:
            self.assertEqual(r.status, expected)
            return json.loads(r.read())
        finally:
            c.close()

    def wait_idle(self, server):
        end = time.monotonic() + 2
        while server.active and time.monotonic() < end:
            time.sleep(0.01)
        self.assertEqual(server.active, 0)

    def test_incremental_sse_heartbeat_deadline(self):
        with running_probe(duration=0.4) as server:
            c, r = self.request(server, "/probe/events")
            try:
                self.assertEqual(r.status, 200)
                self.assertTrue(r.headers["Content-Type"].startswith("text/event-stream"))
                start = time.monotonic()
                self.assertEqual(r.readline(), b"id: 1\n")
                self.assertEqual(r.readline(), b"event: probe\n")
                self.assertEqual(json.loads(r.readline()[6:])["kind"], "started")
                self.assertEqual(r.readline(), b"\n")
                self.assertLess(time.monotonic() - start, 0.3)
                self.assertEqual(r.readline(), b": heartbeat\n")
                rest = r.read()
                self.assertIn(b'"kind":"deadline"', rest)
                self.assertIn(b'"remote_outcome":"not_sent"', rest)
                self.assertEqual(rest.count(b"event: probe"), 1)
                self.assertGreaterEqual(time.monotonic() - start, 0.3)
                self.assertLess(time.monotonic() - start, 1.5)
            finally:
                c.close()
            self.wait_idle(server)

    def test_concurrency_cap_and_health_headroom(self):
        with running_probe(duration=1, capacity=2) as server:
            clients = [self.request(server, "/probe/events") for _ in range(2)]
            try:
                self.assertEqual([r.status for c, r in clients], [200, 200])
                self.status(server, 429, path="/probe/events")
                self.status(server, 200)
                self.assertEqual(server.peak, 2)
            finally:
                for c, r in clients:
                    r.close()
                    c.close()
            self.wait_idle(server)
            c, r = self.request(server, "/probe/events")
            self.assertEqual(r.status, 200)
            r.close()
            c.close()

    def test_disconnect_releases_slot(self):
        with running_probe(duration=1, capacity=1) as server:
            c, r = self.request(server, "/probe/events")
            self.assertEqual(r.status, 200)
            r.readline()
            r.close()
            c.close()
            self.wait_idle(server)
            c, r = self.request(server, "/probe/events")
            self.assertEqual(r.status, 200)
            r.close()
            c.close()

    def test_authentication_all_routes(self):
        with running_probe() as server:
            for path in ("/probe/health", "/probe/events", "/probe/sessions/session-a?after=1"):
                for value in ("", "Bearer wrong", "Basic wrong"):
                    body = self.status(server, 401, path=path, headers={"Authorization": value})
                    self.assertEqual(body, {"code": "unauthorized"})
            self.assertEqual(server.active, 0)

    def test_host_origin_and_query_token_rejected(self):
        with running_probe() as server:
            self.status(server, 403, headers={"Host": "evil.invalid"})
            self.status(server, 403, headers={"Origin": "null"})
            self.status(server, 400, path="/probe/events?token=synthetic")
            self.assertEqual(server.active, 0)

    def test_duplicate_authorization_rejected(self):
        with running_probe() as server:
            token = next(iter(server.tokens))
            c = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=2)
            try:
                c.putrequest("GET", "/probe/health")
                c.putheader("Authorization", "Bearer " + token)
                c.putheader("Authorization", "Bearer " + token)
                c.endheaders()
                self.assertEqual(c.getresponse().status, 401)
            finally:
                c.close()

    def test_session_isolation(self):
        with running_probe() as server:
            self.status(server, 403, path="/probe/sessions/session-a?after=1", identity="bob")
            self.assertEqual(self.status(server, 200, path="/probe/sessions/session-a?after=1"), {"events": [2, 3]})
            self.assertEqual(server.active, 0)  # Read/replay does not launch anything.

    def test_replay_gaps_and_cursor_validation(self):
        with running_probe() as server:
            self.status(server, 410, path="/probe/sessions/session-a?after=0")
            self.status(server, 400, path="/probe/sessions/session-a?after=4")
            self.status(server, 400, path="/probe/sessions/session-a?after=-1")
            self.status(server, 400, path="/probe/sessions/session-a?after=1&after=2")
            self.status(server, 400, path="/probe/sessions/session-a?after=1", headers={"Last-Event-ID": "2"})
            self.assertEqual(self.status(server, 200, path="/probe/sessions/session-a?after=3"), {"events": []})

    def test_memory_state_lost_and_token_rotates_after_restart(self):
        store = MemorySessions()
        with running_probe(sessions=store) as first:
            token = next(iter(first.tokens))
            self.status(first, 200, path="/probe/sessions/session-a?after=1")
        # Simulate a process restart with an empty store (not fresh seeded fixture).
        empty = MemorySessions()
        empty.rows.clear()
        with running_probe(sessions=empty) as second:
            self.status(second, 401, headers={"Authorization": "Bearer " + token})
            self.status(second, 410, path="/probe/sessions/session-a?after=1")

    def test_shared_fake_adapter_and_unavailable_fail_closed(self):
        store = MemorySessions()
        with running_probe(sessions=store) as first, running_probe(sessions=store) as second:
            for server in (first, second):
                self.status(server, 200, path="/probe/sessions/session-a?after=1")
            store.available = False
            for server in (first, second):
                self.status(server, 503, path="/probe/sessions/session-a?after=1")
        # Sharing a Python object is only an adapter seam, not an external DB test.

    def test_shutdown_closes_stream_and_listening_socket(self):
        with running_probe(duration=2) as server:
            port = server.server_port
            c, r = self.request(server, "/probe/events")
            self.assertEqual(r.status, 200)
        self.assertEqual(server.active, 0)
        r.read()
        r.close()
        c.close()
        with self.assertRaises(OSError):
            socket.create_connection(("127.0.0.1", port), timeout=0.2)

    def test_pinned_documentation_hashes(self):
        manifest = json.loads((ROOT / "evidence/documentation/hosting-sources-v1.json").read_text())
        self.assertEqual(len(manifest["records"]), 10)
        for record in manifest["records"]:
            self.assertIn(manifest["revision"], record["url"])
            path = (ROOT / record["snapshot_path"]).resolve()
            self.assertTrue(path.is_relative_to(ROOT))
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), record["sha256"])


if __name__ == "__main__":
    unittest.main()
