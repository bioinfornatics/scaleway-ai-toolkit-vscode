"""TEST-ONLY executable wire-contract examples; not a production adapter.

All helpers below are deliberately local reference behavior. Tests exercise these
helpers, NOT repository code, cloud endpoints, SDKs, or Strands integration.
Fixtures assume a synthetic scoped page envelope and OpenAI-shaped SSE payloads.
Policy: invalid/missing totals fall back to bounded short-page pagination;
SSE success requires a complete [DONE] event (finish_reason alone is not enough).
"""

import codecs
import json
import math
import unittest
from dataclasses import dataclass


class ReferenceWireError(ValueError):
    """TEST-ONLY explicit protocol failure, never an empty successful result."""


@dataclass(frozen=True)
class ReferenceDiscoveryResult:
    status: str
    models: tuple = ()
    error: str = ""


def reference_discover(fetch, scope, *, page_size=2, max_pages=3):
    """TEST-ONLY synchronous, sequential, bounded synthetic discovery client.

    fetch receives (scope, one-based page, limit), never a server-supplied URL.
    Foreign scope is rejected, not followed. Partial failure is not success.
    """
    if type(page_size) is not int or page_size < 1:
        raise ValueError("positive page_size required")
    if type(max_pages) is not int or max_pages < 1:
        raise ValueError("positive max_pages required")
    found = []
    try:
        for page in range(1, max_pages + 1):
            envelope = fetch(scope, page, page_size)
            if not isinstance(envelope, dict) or "error" in envelope:
                raise ReferenceWireError("malformed/error envelope")
            if envelope.get("scope") != scope:
                raise ReferenceWireError("foreign scope")
            rows = envelope.get("models")
            if not isinstance(rows, list) or len(rows) > page_size:
                raise ReferenceWireError("malformed model list")
            for row in rows:
                if (not isinstance(row, dict) or row.get("scope") != scope
                        or not isinstance(row.get("id"), str) or not row["id"]):
                    raise ReferenceWireError("malformed/foreign model")
            found.extend(row["id"] for row in rows)
            total = envelope.get("total_count")
            valid_total = type(total) is int and total >= 0
            if valid_total and total < len(found):
                raise ReferenceWireError("inconsistent total")
            if valid_total and len(found) == total:
                return ReferenceDiscoveryResult("success", tuple(found))
            if len(rows) < page_size:
                if valid_total:
                    raise ReferenceWireError("premature short page")
                return ReferenceDiscoveryResult("success", tuple(found))
        return ReferenceDiscoveryResult("incomplete", tuple(found), "page bound reached")
    except Exception as exc:
        return ReferenceDiscoveryResult("error", (), str(exc))


def reference_usage(value):
    """TEST-ONLY unknown fields/missing usage stay unknown; invalid values fail."""
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ReferenceWireError("usage must be an object")
    result = {}
    for key in ("prompt_tokens", "completion_tokens", "total_tokens"):
        if key not in value or value[key] is None:
            result[key] = None
            continue
        count = value[key]
        if (type(count) not in (int, float) or not math.isfinite(count)
                or count < 0 or int(count) != count):
            raise ReferenceWireError("invalid usage count")
        result[key] = int(count)
    return result


def _reject_json_constant(value):
    raise ReferenceWireError("nonfinite JSON constant: " + value)


class ReferenceSSE:
    """TEST-ONLY incremental bytes parser; LF/CRLF, not full SSE specification.

    No reconnection, HTTP, IDs/retry, tool calls, or production integration.
    A complete DONE frame is mandatory. EOF never dispatches an unframed event.
    Usage is the latest cumulative snapshot, never a sum of snapshots.
    """

    def __init__(self):
        self.decoder = codecs.getincrementaldecoder("utf-8")("strict")
        self.pending = ""
        self.data = []
        self.text = ""
        self.usage = None
        self.finish_reason = None
        self.done = False
        self.error = None
        self.closed = False

    def feed(self, chunk):
        if self.closed or self.error:
            return
        try:
            self.pending += self.decoder.decode(chunk)
            while "\n" in self.pending:
                line, self.pending = self.pending.split("\n", 1)
                if line.endswith("\r"):
                    line = line[:-1]
                self._line(line)
        except (ValueError, UnicodeError, TypeError) as exc:
            self.error = str(exc)

    def _line(self, line):
        if self.done:
            return
        if not line:
            if self.data:
                payload = "\n".join(self.data)
                self.data = []
                self._event(payload)
            return
        field, separator, value = line.partition(":")
        if field == "data":
            if separator and value.startswith(" "):
                value = value[1:]
            self.data.append(value)

    def _event(self, payload):
        if payload == "[DONE]":
            self.done = True
            return
        event = json.loads(payload, parse_constant=_reject_json_constant)
        if not isinstance(event, dict) or "error" in event:
            raise ReferenceWireError("invalid/error event")
        choices = event.get("choices", [])
        if not isinstance(choices, list):
            raise ReferenceWireError("invalid choices")
        additions = []
        reason = self.finish_reason
        for choice in choices:
            if not isinstance(choice, dict):
                raise ReferenceWireError("invalid choice")
            delta = choice.get("delta", {})
            if not isinstance(delta, dict):
                raise ReferenceWireError("invalid delta")
            content = delta.get("content")
            if content is not None:
                if not isinstance(content, str):
                    raise ReferenceWireError("invalid content")
                additions.append(content)
            if choice.get("finish_reason") is not None:
                reason = choice["finish_reason"]
        usage = reference_usage(event["usage"]) if "usage" in event else self.usage
        self.text += "".join(additions)
        self.finish_reason = reason
        self.usage = usage

    def finish(self):
        if not self.closed:
            self.closed = True
            try:
                self.pending += self.decoder.decode(b"", final=True)
            except UnicodeError as exc:
                self.error = str(exc)
            if not self.error and not self.done:
                self.error = "truncated stream: no framed DONE"
        return "error" if self.error else "success"


class ReferenceOutputGate:
    """TEST-ONLY scope AND generation tokens guard late asynchronous updates."""

    def __init__(self):
        self.generation = 0
        self.current = None
        self.output = ""

    def start(self, scope):
        self.generation += 1
        self.current = (scope, self.generation)
        self.output = ""
        return self.current

    def cancel(self, token):
        if token == self.current:
            self.current = None

    def replace(self, token, output):
        if token != self.current or self.current is None:
            return False
        self.output = output
        return True


def reference_parameters(requested, features):
    """TEST-ONLY allowlist: only explicit True enables known optional params."""
    supported = {"temperature": "temperature", "tools": "tool_calling"}
    return {key: value for key, value in requested.items()
            if key in supported and features.get(supported[key]) is True}


class DiscoveryContracts(unittest.TestCase):
    def fetcher(self, pages):
        self.calls = []

        def fetch(scope, page, limit):
            self.calls.append((scope, page, limit))
            value = pages[page - 1]
            if isinstance(value, Exception):
                raise value
            return value
        return fetch

    @staticmethod
    def page(ids, **extra):
        return dict(scope="project-a", models=[
            {"id": value, "scope": "project-a"} for value in ids], **extra)

    def test_empty_success_is_distinct_from_malformed_or_error(self):
        result = reference_discover(self.fetcher([self.page([])]), "project-a")
        self.assertEqual((result.status, result.models, result.error),
                         ("success", (), ""))
        for bad in (None, [], {}, {"scope": "project-a", "models": None},
                    {"scope": "project-a", "models": [], "error": "denied"},
                    self.page([""]), RuntimeError("transport failed")):
            with self.subTest(bad=bad):
                result = reference_discover(self.fetcher([bad]), "project-a")
                self.assertEqual(result.status, "error")
                self.assertEqual(result.models, ())
                self.assertTrue(result.error)

    def test_missing_or_invalid_total_uses_sequential_short_page_fallback(self):
        for extra in ({}, {"total_count": None}, {"total_count": -1},
                      {"total_count": "3"}, {"total_count": True},
                      {"total_count": 3.5}, {"total_count": float("nan")},
                      {"total_count": float("inf")}):
            with self.subTest(extra=extra):
                fetch = self.fetcher([self.page(["a", "b"], **extra),
                                      self.page(["c"], **extra)])
                result = reference_discover(fetch, "project-a")
                self.assertEqual(result.status, "success")
                self.assertEqual(result.models, ("a", "b", "c"))
                self.assertEqual(self.calls, [("project-a", 1, 2), ("project-a", 2, 2)])

    def test_valid_total_stops_without_extra_request(self):
        result = reference_discover(self.fetcher([
            self.page(["a", "b"], total_count=2)]), "project-a")
        self.assertEqual(result.status, "success")
        self.assertEqual(len(self.calls), 1)

    def test_endless_full_pages_are_bounded_not_success(self):
        result = reference_discover(self.fetcher([self.page(["a", "b"])] * 3),
                                    "project-a", max_pages=3)
        self.assertEqual(result.status, "incomplete")
        self.assertEqual([call[1] for call in self.calls], [1, 2, 3])

    def test_foreign_scope_is_not_returned_or_followed(self):
        foreign = self.page(["leak"])
        foreign["models"][0]["scope"] = "project-b"
        for page in (foreign, dict(scope="project-b", models=[],
                                   next="https://foreign.invalid/page")):
            with self.subTest(page=page):
                result = reference_discover(self.fetcher([page]), "project-a")
                self.assertEqual((result.status, result.models), ("error", ()))
                self.assertEqual(self.calls, [("project-a", 1, 2)])

    def test_later_page_error_does_not_become_partial_success(self):
        result = reference_discover(self.fetcher([
            self.page(["a", "b"]), RuntimeError("failed page")]), "project-a")
        self.assertEqual((result.status, result.models), ("error", ()))

    def test_inconsistent_total_is_error(self):
        for page in (self.page(["a", "b"], total_count=1),
                     self.page(["a"], total_count=3)):
            self.assertEqual(reference_discover(self.fetcher([page]),
                                               "project-a").status, "error")


class SSEContracts(unittest.TestCase):
    @staticmethod
    def frame(event):
        return ("data: " + json.dumps(event, ensure_ascii=False) + "\n\n").encode()

    def test_fragmented_utf8_crlf_multiline_usage_and_done(self):
        wire = (': heartbeat\r\ndata: {"choices": [\r\n'
                'data: {"delta": {"content": "café 🧬"}}]}\r\n\r\n'
                'data: {"choices": [], "usage": {"total_tokens": 7}}\r\n\r\n'
                'data: [DONE]\r\n\r\n').encode()
        # Every possible two-fragment boundary, plus one byte at a time.
        chunkings = [[wire[:i], wire[i:]] for i in range(len(wire) + 1)]
        chunkings.append([wire[i:i + 1] for i in range(len(wire))])
        for chunks in chunkings:
            with self.subTest(lengths=[len(chunk) for chunk in chunks]):
                stream = ReferenceSSE()
                for chunk in chunks:
                    stream.feed(chunk)
                self.assertEqual(stream.finish(), "success")
                self.assertEqual(stream.text, "café 🧬")
                self.assertEqual(stream.usage["total_tokens"], 7)
                self.assertIsNone(stream.usage["prompt_tokens"])

    def test_finish_reason_and_usage_before_done(self):
        stream = ReferenceSSE()
        stream.feed(self.frame({"choices": [{"delta": {"content": "ok"},
                                              "finish_reason": "stop"}]}))
        stream.feed(self.frame({"choices": [], "usage": {"total_tokens": 2}}))
        stream.feed(b"data: [DONE]\n\n")
        self.assertEqual(stream.finish(), "success")
        self.assertEqual((stream.text, stream.finish_reason), ("ok", "stop"))

    def test_truncation_is_not_success_even_after_finish_reason(self):
        for wire in (b"", b'data: {"choices":', b"data: [DONE]\n",
                     b"data: [DONE]", b'data: {"text":"\xc3',
                     self.frame({"choices": [{"finish_reason": "stop"}]})):
            with self.subTest(wire=wire):
                stream = ReferenceSSE()
                stream.feed(wire)
                self.assertEqual(stream.finish(), "error")
                self.assertFalse(stream.done)

    def test_malformed_json_and_error_frames_cannot_be_repaired_by_done(self):
        for wire in (b"data: {broken}\n\n", b"data: []\n\n",
                     self.frame({"error": "denied"}),
                     self.frame({"choices": "wrong"}), b"data: \xff\n\n"):
            with self.subTest(wire=wire):
                stream = ReferenceSSE()
                stream.feed(wire + b"data: [DONE]\n\n")
                self.assertEqual(stream.finish(), "error")
                self.assertEqual(stream.text, "")

    def test_negative_nonfinite_and_other_invalid_usage_are_errors(self):
        for value in (-1, float("nan"), float("inf"), -float("inf"), True, "2", 1.5):
            with self.subTest(value=value):
                stream = ReferenceSSE()
                stream.feed(self.frame({"usage": {"total_tokens": value}}))
                stream.feed(b"data: [DONE]\n\n")
                self.assertEqual(stream.finish(), "error")
                self.assertIsNone(stream.usage)
        with self.assertRaises(ReferenceWireError):
            reference_usage({"total_tokens": float("inf")})

    def test_unknown_usage_is_not_zero_or_a_failure(self):
        for value in (None, {}, {"vendor_tokens": 99}, {"total_tokens": None}):
            with self.subTest(value=value):
                stream = ReferenceSSE()
                stream.feed(self.frame({"choices": [], "usage": value}))
                stream.feed(b"data: [DONE]\n\n")
                self.assertEqual(stream.finish(), "success")
                if stream.usage is not None:
                    self.assertIsNone(stream.usage["total_tokens"])
        stream = ReferenceSSE()
        stream.feed(b"data: [DONE]\n\n")
        self.assertEqual(stream.finish(), "success")
        self.assertIsNone(stream.usage)

    def test_cumulative_usage_is_latest_snapshot_not_sum(self):
        stream = ReferenceSSE()
        for count in (2, 5, 5):
            stream.feed(self.frame({"choices": [], "usage": {"total_tokens": count}}))
        stream.feed(self.frame({"choices": [{"delta": {"content": "x"}}]}))
        stream.feed(b"data: [DONE]\n\n")
        self.assertEqual(stream.finish(), "success")
        self.assertEqual(stream.usage["total_tokens"], 5)
        self.assertEqual(stream.text, "x")

    def test_done_and_closed_stream_ignore_late_content(self):
        stream = ReferenceSSE()
        stream.feed(b"data: [DONE]\n\n" + self.frame({"choices": [
            {"delta": {"content": "late"}}]}))
        self.assertEqual(stream.finish(), "success")
        stream.feed(self.frame({"choices": [{"delta": {"content": "later"}}]}))
        self.assertEqual(stream.text, "")


class ScopeAndFeatureContracts(unittest.TestCase):
    def test_changed_scope_and_same_scope_restart_reject_stale_events(self):
        for next_scope in ("project-b", "project-a"):
            with self.subTest(next_scope=next_scope):
                gate = ReferenceOutputGate()
                old = gate.start("project-a")
                gate.replace(old, "old")
                current = gate.start(next_scope)
                self.assertTrue(gate.replace(current, "current"))
                self.assertFalse(gate.replace(old, "late content/error/usage"))
                self.assertEqual(gate.output, "current")

    def test_cancel_rejects_late_events_without_erasing_current_output(self):
        gate = ReferenceOutputGate()
        token = gate.start("project-a")
        gate.replace(token, "partial")
        gate.cancel(token)
        self.assertFalse(gate.replace(token, "late"))
        self.assertEqual(gate.output, "partial")
        current = gate.start("project-b")
        gate.replace(current, "new")
        gate.cancel(token)
        self.assertTrue(gate.replace(current, "still current"))
        self.assertEqual(gate.output, "still current")

    def test_unknown_features_cannot_enable_unsupported_parameters(self):
        requested = {"temperature": 0.5, "tools": [], "future_param": True}
        for features in ({}, {"future_feature": True}, {"tool_calling": "unknown"},
                         {"tool_calling": None}, {"temperature": 1},
                         {"future_param": True}, {"temperature": False}):
            with self.subTest(features=features):
                self.assertEqual(reference_parameters(requested, features), {})
        self.assertEqual(reference_parameters(requested, {
            "temperature": True, "tool_calling": True, "future_param": True}),
            {"temperature": 0.5, "tools": []})


if __name__ == "__main__":
    unittest.main()
