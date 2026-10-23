"""Offline adapter tests; optional installed Strands test never uses a network client."""
import asyncio
import dataclasses
import importlib.metadata
import json
import pathlib
import sys
import unittest
from types import SimpleNamespace as NS

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "src"))
from scaleway_agent_runtime.dispatch import (Adapter, Binding, Denied, Grant,
    OfflineLedger, Registry, TARGET, _model_factory)


def binding():
    return Binding.from_dict({"run_id": "run-1", "runtime_instance_id": "runtime-1",
        "epoch": 1, **{k: "a" * 64 for k in ("spec_revision", "prompt_revision",
        "data_revision", "model_revision")}, "scope": {"connection_ref": "connection-1",
        "credential_generation": 1, "organization_ref": "org-1", "project_ref": "project-1",
        "region": "fr-par", "scope_revision": "b" * 64}})


def response(text="OK", i=3, o=1, total=4, finish="stop"):
    return NS(choices=[NS(finish_reason=finish, message=NS(content=text, tool_calls=None,
        refusal=None))], usage=NS(prompt_tokens=i, completion_tokens=o, total_tokens=total))


class FakeModel:
    def __init__(self, client, model, tokens):
        self.client, self.model, self.tokens = client, model, tokens

    async def stream(self, messages):
        r = await self.client.chat.completions.create(model=self.model, stream=False,
            max_tokens=self.tokens, tools=[], messages=[{"role": "user", "content": [
                {"type": "text", "text": messages[0]["content"][0]["text"]}]}])
        yield {"contentBlockDelta": {"delta": {"text": r.choices[0].message.content}}}


class FakeBroker:
    def __init__(self, sender):
        self.sender, self.grants = sender, []

    async def resolve(self, grant):
        self.grants.append(grant)
        return self.sender


class DispatchTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.now = 100.0
        self.b = binding()
        self.g = Grant("grant-1", self.b, "external-secret-ref", "fixture-model", 200,
                       8, 64, 2, 32, 1, 2)
        self.r = Registry([self.g], clock=lambda: self.now)
        self.l = OfflineLedger()
        self.calls = []

    async def send(self, request):
        self.calls.append(request)
        return response()

    def adapter(self, sender=None, factory=FakeModel):
        return Adapter(self.r, self.l, FakeBroker(sender or self.send), model_factory=factory)

    async def run_adapter(self, a=None, **kw):
        return await (a or self.adapter()).run("grant-1", self.b, "synthetic-private-prompt",
            **({"max_output_tokens": 8, "max_output_bytes": 64, "timeout": 1} | kw))

    async def test_known_settlement_and_redacted_events(self):
        out = await self.run_adapter()
        self.assertEqual((out.state, out.text), ("succeeded", "OK"))
        self.assertEqual((self.l.sends, self.l.input_tokens, self.l.output_tokens, self.l.spend), (1, 3, 1, 5))
        self.assertEqual(self.calls[0].target, TARGET)
        self.assertEqual(self.calls[0].max_output_tokens, 8)
        self.assertEqual(self.calls[0].deadline, 101)
        self.assertNotIn("synthetic-private", repr(self.calls[0]))
        encoded = json.dumps(out.events)
        for secret in ("synthetic-private", "external-secret-ref", "OK", TARGET):
            self.assertNotIn(secret, encoded)
        self.assertEqual([e["sequence"] for e in out.events], list(range(1, len(out.events)+1)))
        self.assertEqual(out.events[0]["type"], "run.started")
        self.assertEqual(out.events[-1]["type"], "run.terminal")
        self.assert_events(out.events)

    def assert_events(self, events):
        self.assertGreaterEqual(len(events), 2)
        for sequence, event in enumerate(events, 1):
            self.assertEqual(set(event), {"contract_version", "event_id", "binding",
                "sequence", "origin", "sdk_version", "type", "data"})
            self.assertEqual(event["contract_version"], "1.0.0")
            self.assertEqual(event["origin"], "runtime")
            self.assertEqual(event["sdk_version"], "1.61.1")
            self.assertEqual(event["sequence"], sequence)
            self.assertRegex(event["event_id"], r"^[a-f0-9]{32}$")
            self.assertEqual(event["binding"], self.b.as_dict())
            self.assertIsInstance(event["data"], dict)
        self.assertEqual(events[0]["type"], "run.started")
        self.assertEqual(events[-1]["type"], "run.terminal")

    async def test_binding_rejects_unknown_fields_bad_scope_and_revision(self):
        for patch in ({"secret": "synthetic-canary"}, {"epoch": 0},
                      {"model_revision": "unknown"}, {"run_id": "https://example.invalid"}):
            with self.assertRaises(Denied):
                Binding.from_dict(self.b.as_dict() | patch)
        for patch in ({"region": "nl-ams"}, {"credential_generation": 0},
                      {"scope_revision": "bad"}, {"secret": "synthetic-canary"}):
            value = self.b.as_dict()
            value["scope"].update(patch)
            with self.assertRaises(Denied):
                Binding.from_dict(value)

    async def test_shared_six_send_cap(self):
        for _ in range(6):
            self.assertEqual((await self.run_adapter(self.adapter())).state, "succeeded")
        out = await self.run_adapter()
        self.assertEqual(out.state, "failed")
        self.assertEqual(len(self.calls), 6)
        self.assertEqual(out.events[-2]["data"]["code"], "budget_exceeded")

    async def test_concurrent_reservation(self):
        entered, release = asyncio.Event(), asyncio.Event()
        async def blocked(req):
            self.calls.append(req); entered.set(); await release.wait(); return response()
        task = asyncio.create_task(self.run_adapter(self.adapter(blocked)))
        await entered.wait()
        second = await self.run_adapter()
        self.assertEqual(second.state, "failed")
        self.assertEqual(self.l.sends, 1)
        release.set(); self.assertEqual((await task).state, "succeeded")

    async def test_grant_not_minted_by_binding(self):
        other = dataclasses.replace(self.b, canonical=self.b.canonical.replace('run-1', 'run-2'))
        out = await self.adapter().run("grant-1", other, "x", max_output_tokens=8,
                                      max_output_bytes=64, timeout=1)
        self.assertEqual(out.state, "failed"); self.assertFalse(self.calls)
        self.r.revoke("grant-1")
        self.assertEqual((await self.run_adapter()).state, "failed")
        self.assertFalse(self.calls)

    async def test_expired_cancelled_and_revoke_after_broker(self):
        self.now = 200
        self.assertEqual((await self.run_adapter()).state, "failed")
        self.now = 100
        self.r.cancel(self.b)
        self.assertEqual((await self.run_adapter()).state, "failed")
        self.assertFalse(self.calls)
        self.r = Registry([self.g], clock=lambda: self.now)
        outer = self
        class RevokingBroker:
            async def resolve(self, grant):
                outer.r.revoke(grant.ref)
                return outer.send
        a = Adapter(self.r, OfflineLedger(), RevokingBroker(), model_factory=FakeModel)
        self.assertEqual((await self.run_adapter(a)).state, "failed")
        self.assertFalse(self.calls)

    async def test_unknown_malformed_or_over_bound_usage_retains(self):
        for r in (response(total=8), response(i=True), response(i=33, total=34),
                  response(text="x" * 65), response(finish=None), response(finish="length")):
            self.l = OfflineLedger()
            async def send(req):
                self.calls.append(req); return r
            out = await self.run_adapter(self.adapter(send))
            self.assertEqual((out.state, out.text), ("failed", ""))
            self.assertTrue(self.l.frozen)
            self.assertEqual((self.l.input_tokens, self.l.output_tokens, self.l.spend), (32, 8, 48))
            before = len(self.calls)
            await self.run_adapter(); self.assertEqual(len(self.calls), before)

    async def test_errors_redacted_no_retry(self):
        async def bad(req):
            self.calls.append(req)
            raise RuntimeError("credential-and-provider-body-private")
        with self.assertNoLogs(level="DEBUG"):
            out = await self.run_adapter(self.adapter(bad))
        self.assertNotIn("credential-and", json.dumps(out.events))
        self.assertEqual(len(self.calls), 1)
        self.assertTrue(self.l.frozen)
        self.assertEqual(out.events[-1]["data"]["remote_outcome"], "unknown")

    async def test_timeout_and_task_cancel_freeze(self):
        async def slow(req):
            self.calls.append(req); await asyncio.sleep(10)
        out = await self.run_adapter(self.adapter(slow), timeout=0.005)
        self.assertEqual(out.state, "failed"); self.assertTrue(self.l.frozen)
        self.l = OfflineLedger()
        entered = asyncio.Event()
        async def blocking(req):
            self.calls.append(req); entered.set(); await asyncio.sleep(10)
        task = asyncio.create_task(self.run_adapter(self.adapter(blocking)))
        await entered.wait(); task.cancel(); out = await task
        self.assertEqual(out.state, "cancelled"); self.assertTrue(self.l.frozen)
        n = len(self.calls); await self.run_adapter(); self.assertEqual(len(self.calls), n)

    async def test_late_known_result_never_succeeds(self):
        async def late(req):
            self.calls.append(req); self.r.revoke("grant-1"); return response()
        out = await self.run_adapter(self.adapter(late))
        self.assertEqual(out.state, "failed")
        self.assertFalse(self.l.frozen)  # independently verified usage can settle
        self.assertEqual(out.events[-1]["data"]["remote_outcome"], "completed")

    async def test_request_and_budget_caps(self):
        for kw in ({"max_output_tokens":9}, {"max_output_bytes":65}, {"timeout":3}, {"timeout":float('nan')}):
            self.assertEqual((await self.run_adapter(**kw)).state, "failed")
        self.l = OfflineLedger(input_limit=31)
        self.assertEqual((await self.run_adapter()).state, "failed")
        self.assertFalse(self.calls)

    async def test_live_and_target_fail_closed(self):
        with self.assertRaises(Denied):
            Adapter(self.r, self.l, FakeBroker(self.send), offline=False)
        for target in ("http://api.scaleway.ai/v1/chat/completions", TARGET + "?x=1",
                       "https://api.openai.com/v1/chat/completions", TARGET + "/"):
            with self.assertRaises(Denied):
                dataclasses.replace(self.g, target=target)

    async def test_lazy_source_has_no_agent_or_provider_fallback(self):
        import scaleway_agent_runtime.dispatch as module
        source = pathlib.Path(module.__file__).read_text()
        self.assertNotIn("from strands import Agent", source)
        self.assertNotIn("AsyncOpenAI(", source)
        self.assertIn("OpenAIModel(client=client", source)
        self.assertIn("stream=False", source)

    async def test_redacted_errors_and_grant_budget_intersection(self):
        async def bad(req):
            raise Denied("raw-provider-secret")
        out = await self.run_adapter(self.adapter(bad))
        self.assert_events(out.events)
        self.assertNotIn("raw-provider-secret", json.dumps(out.events))
        self.l = OfflineLedger()
        self.g = dataclasses.replace(self.g, max_physical_sends=1)
        self.r = Registry([self.g], clock=lambda: self.now)
        self.assertEqual((await self.run_adapter()).state, "succeeded")
        self.assertEqual((await self.run_adapter()).state, "failed")
        self.assertEqual(len(self.calls), 1)

    async def test_modified_sdk_request_and_hidden_replay_denied(self):
        class Modified(FakeModel):
            async def stream(model, messages):
                await model.client.chat.completions.create(model="foreign", stream=False)
                yield {}
        self.assertEqual((await self.run_adapter(self.adapter(factory=Modified))).state, "failed")
        self.assertEqual(self.l.sends, 0)
        self.assertFalse(self.calls)
        class Replay(FakeModel):
            async def stream(model, messages):
                async for event in super(Replay, model).stream(messages):
                    yield event
                async for event in super(Replay, model).stream(messages):
                    yield event
        self.assertEqual((await self.run_adapter(self.adapter(factory=Replay))).state, "failed")
        self.assertEqual(len(self.calls), 1)

    async def test_installed_exact_strands_model_offline(self):
        try:
            version = importlib.metadata.version("strands-agents")
        except importlib.metadata.PackageNotFoundError:
            self.skipTest("pinned installed SDK unavailable in this interpreter")
        self.assertEqual(version, "1.61.1")
        out = await self.run_adapter(self.adapter(factory=_model_factory))
        self.assertEqual(out.state, "succeeded", out.events)
        self.assertEqual(out.text, "OK")
        self.assertEqual(len(self.calls), 1)


if __name__ == "__main__":
    unittest.main()
