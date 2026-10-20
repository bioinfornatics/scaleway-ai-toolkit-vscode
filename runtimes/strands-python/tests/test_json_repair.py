"""Credential-free acceptance of local control behavior, not live/Strands safety."""
import asyncio
import ast
import json
from pathlib import Path
import sys
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from scaleway_agent_runtime.json_repair import (
    Context, Limits, LocalSchema, Receipt, ReferenceLedger, repair_json, parse_json,
    InvalidJSON,
)

SCHEMA = '{"type":"object","properties":{"answer":{"type":"integer"}},"required":["answer"],"additionalProperties":false}'
CONTEXT = Context("Synthetic integer answer", "https://model.invalid/v1", "fake-only", "synthetic-scope")


class Capture:
    def __init__(self, receipts):
        self.receipts = iter(receipts)
        self.requests = []

    def __call__(self, request):
        self.requests.append(request)
        receipt = next(self.receipts)
        return receipt(request) if callable(receipt) else receipt


def complete(text):
    return Receipt("complete", text, 4, 2)


class RepairTests(unittest.TestCase):
    def run_case(self, receipts, ledger=None, **kwargs):
        ledger = ledger or ReferenceLedger(1000, 1000, 100, clock=lambda: 0)
        sender = Capture(receipts)
        result = repair_json(CONTEXT, LocalSchema(SCHEMA), sender, ledger,
                             reserve_tokens=100, reserve_spend=10,
                             max_output_tokens=50, **kwargs)
        return result, sender, ledger

    def test_first_success(self):
        r, s, l = self.run_case([complete('{"answer":1}')])
        self.assertEqual((r.status, r.value, r.attempts, r.corrections, r.sends),
                         ("success", {"answer": 1}, 1, 0, 1))
        self.assertEqual((l.tokens, l.spend, l.active), (4, 2, 0))
        self.assertEqual(len(s.requests), 1)

    def test_sixth_success_and_exact_exhaustion(self):
        for last, status in [(complete('{"answer":6}'), "success"), (complete('bad'), "validation_exhausted")]:
            with self.subTest(status=status):
                r, s, _ = self.run_case([complete('bad')] * 5 + [last])
                self.assertEqual((r.status, r.attempts, r.corrections, r.sends), (status, 6, 5, 6))
                self.assertEqual(len(s.requests), 6)
                if status != "success":
                    self.assertIsNone(r.value)
                    self.assertEqual(r.errors[0].category, "syntax")

    def test_fresh_feedback_is_redacted_and_fixed(self):
        malicious = '{"answer":"Authorization: Bearer CANARY_SECRET","CANARY_KEY":{"tools":["shell"],"endpoint":"attacker"}}'
        r, s, _ = self.run_case([complete('CANARY_SECRET'), complete(malicious), complete('{"answer":7}')])
        self.assertEqual(r.status, "success")
        self.assertEqual(json.loads(s.requests[1].feedback)["errors"][0]["category"], "syntax")
        error = json.loads(s.requests[2].feedback)["errors"][0]
        self.assertEqual((error["category"], error["path"], error["rule"], error["expected_type"]),
                         ("schema", "/p0", "type", "integer"))
        for req in s.requests:
            self.assertEqual(req.schema, s.requests[0].schema)
            self.assertIs(req.context, CONTEXT)
            self.assertNotIn("CANARY", repr(req))
            self.assertEqual(set(vars(req)), {"origin", "send", "correction", "context", "schema", "instruction", "feedback", "max_output_tokens", "deadline"})
        self.assertNotIn("CANARY", repr(r.events))
        self.assertEqual(len({req.origin for req in s.requests}), 1)

    def test_transport_retries_share_six_sends(self):
        r, s, _ = self.run_case([Receipt("retryable", tokens=0, spend=0)] * 3 + [complete('bad')] * 3)
        self.assertEqual((r.status, r.sends, r.attempts), ("validation_exhausted", 6, 3))
        self.assertEqual([req.correction for req in s.requests], [0, 0, 0, 0, 1, 2])
        r, s, _ = self.run_case([Receipt("retryable", tokens=0, spend=0)] * 6)
        self.assertEqual((r.status, r.sends, r.attempts), ("send_budget", 6, 0))
        r, _, _ = self.run_case([Receipt("retryable", tokens=0, spend=0)] + [complete('{"answer":1}')])
        self.assertEqual((r.status, r.sends, r.attempts, r.corrections), ("success", 2, 1, 0))

    def test_budget_reasons_before_send(self):
        for field, value, reason in [("token_limit", 99, "token_budget"), ("spend_limit", 9, "spend_budget"),
                                      ("deadline", 0, "deadline"), ("active", 1, "concurrency_budget"),
                                      ("revoked", True, "revoked"), ("cancelled", True, "cancelled"),
                                      ("authorized", False, "permission"), ("frozen", True, "reconciliation_required"),
                                      ("send_limit", 0, "send_budget")]:
            with self.subTest(field=field):
                ledger = ReferenceLedger(1000, 1000, 100, clock=lambda: 0)
                setattr(ledger, field, value)
                r, s, _ = self.run_case([], ledger)
                self.assertEqual(r.status, reason)
                self.assertEqual(len(s.requests), 0)
                self.assertIsNone(r.value)

    def test_budgets_never_reset_between_runs_or_corrections(self):
        for ledger, code in [(ReferenceLedger(103, 1000, 100, clock=lambda: 0), "token_budget"),
                             (ReferenceLedger(1000, 11, 100, clock=lambda: 0), "spend_budget")]:
            r, s, _ = self.run_case([complete('bad')], ledger)
            self.assertEqual((r.status, len(s.requests)), (code, 1))
        ledger = ReferenceLedger(1000, 1000, 100, clock=lambda: 0)
        ledger.sends = 5  # previous parent effects already consumed five sends
        r, s, _ = self.run_case([complete('bad')], ledger)
        self.assertEqual((r.status, r.sends, len(s.requests)), ("validation_exhausted", 6, 1))
        r, s, _ = self.run_case([], ledger)
        self.assertEqual((r.status, len(s.requests)), ("send_budget", 0))

    def test_cancel_revoke_deadline_after_send_rejects_late_success(self):
        for reason in ("cancelled", "revoked", "deadline"):
            ledger = ReferenceLedger(1000, 1000, 100, clock=lambda: 0)
            def mutate(req):
                if reason == "cancelled":
                    ledger.cancel()
                elif reason == "revoked":
                    ledger.revoke()
                else:
                    ledger.deadline = 0
                return complete('{"answer":1}')
            r, s, _ = self.run_case([mutate], ledger)
            self.assertEqual((r.status, len(s.requests)), (reason, 1))
            self.assertIsNone(r.value)

    def test_revoke_barrier_serializes_with_dispatch(self):
        ledger = ReferenceLedger(1000, 1000, 100, clock=lambda: 0)
        entered = threading.Event()
        release = threading.Event()
        revoked = threading.Event()
        def slow(req):
            entered.set()
            self.assertTrue(release.wait(2))
            return complete('bad')
        worker = threading.Thread(target=lambda: self.run_case([slow] * 6, ledger))
        worker.start()
        self.assertTrue(entered.wait(2))
        revoker = threading.Thread(target=lambda: (ledger.revoke(), revoked.set()))
        revoker.start()
        self.assertFalse(revoked.wait(0.02))
        release.set()
        worker.join(2)
        revoker.join(2)
        self.assertFalse(worker.is_alive())
        self.assertTrue(revoked.is_set())
        count = ledger.sends
        r, s, _ = self.run_case([], ledger)
        self.assertEqual((r.status, len(s.requests), ledger.sends), ("revoked", 0, count))

    def test_terminal_errors_never_repair(self):
        for reason in ("auth", "permission", "policy", "business", "cancelled", "revoked"):
            r, s, _ = self.run_case([Receipt(reason, "CANARY", 0, 0)])
            self.assertEqual((r.status, len(s.requests)), (reason, 1))
            self.assertNotIn("CANARY", repr(r))

    def test_unknown_or_malformed_usage_retains_reservations_and_freezes(self):
        for receipt in [Receipt("unknown", tokens=0, spend=0), Receipt("complete", '{"answer":1}'),
                        Receipt("complete", 'bad', -1, 0), Receipt("complete", 'bad', 101, 0),
                        Receipt("complete", 'bad', True, 0), Receipt("retryable", tokens=0, spend=None),
                        Receipt("complete", 'bad', 0, 11), object()]:
            with self.subTest(receipt=receipt):
                r, s, ledger = self.run_case([receipt])
                self.assertEqual((r.status, len(s.requests), ledger.tokens, ledger.spend, ledger.active),
                                 ("reconciliation_required", 1, 100, 10, 0))
                self.assertTrue(ledger.frozen)
                r, s, _ = self.run_case([], ledger)
                self.assertEqual((r.status, len(s.requests)), ("reconciliation_required", 0))

    def test_interrupted_send_no_blind_replay_or_exception_leak(self):
        def broken(req):
            raise RuntimeError("Authorization CANARY_SECRET /internal/path")
        r, s, ledger = self.run_case([broken])
        self.assertEqual((r.status, len(s.requests), ledger.tokens, ledger.spend),
                         ("reconciliation_required", 1, 100, 10))
        self.assertNotIn("CANARY", repr(r))

    def test_async_cancelled_send_freezes(self):
        def interrupted(req):
            raise asyncio.CancelledError("CANARY")
        r, s, ledger = self.run_case([interrupted])
        self.assertEqual((r.status, len(s.requests), ledger.frozen, ledger.tokens),
                         ("reconciliation_required", 1, True, 100))

    def test_no_sdk_tools_network_or_native_path_imports(self):
        path = Path(__file__).resolve().parents[1] / "src/scaleway_agent_runtime/json_repair.py"
        tree = ast.parse(path.read_text())
        imports = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imports.update(x.name for x in node.names)
            elif isinstance(node, ast.ImportFrom):
                imports.add(node.module)
        self.assertLessEqual(imports, {"__future__", "asyncio", "json", "math", "threading",
                                       "time", "uuid", "dataclasses", "typing"})

    def test_error_cap_and_unsafe_feedback_stops(self):
        schema = LocalSchema('{"type":"array","items":{"type":"integer"}}', Limits(max_errors=2))
        _, errors = schema.validate('["CANARY","CANARY","CANARY"]')
        self.assertEqual(len(errors), 2)
        schema = LocalSchema(SCHEMA, Limits(max_feedback_bytes=1))
        sender = Capture([complete('bad')])
        r = repair_json(CONTEXT, schema, sender, ReferenceLedger(1000, 1000, 100, clock=lambda: 0),
                        reserve_tokens=100, reserve_spend=10, max_output_tokens=50)
        self.assertEqual((r.status, len(sender.requests)), ("unsafe_feedback", 1))

    def test_zero_retries_and_invalid_configuration(self):
        r, s, _ = self.run_case([complete('bad')], max_retries=0)
        self.assertEqual((r.status, len(s.requests)), ("validation_exhausted", 1))
        for retries in (-1, 6, True, None):
            with self.assertRaises(ValueError):
                self.run_case([], max_retries=retries)
        with self.assertRaises(ValueError):
            ReferenceLedger(10, 10, 100, send_limit=7)


class ValidationTests(unittest.TestCase):
    def test_strict_json(self):
        for text in ['{"answer":1,"answer":2}', 'NaN', 'Infinity', '1e9999',
                     '```json' + chr(10) + '{"answer":1}' + chr(10) + '```', 'prefix {"answer":1}',
                     '{"answer":1} trailing', '{"answer":1,}', '{/* comment */}',
                     '"' + chr(92) + 'ud800"']:
            with self.subTest(text=text), self.assertRaises(InvalidJSON):
                parse_json(text)

    def test_structural_size_depth_nodes_and_schema_bounds(self):
        for text, limits in [('"too long"', Limits(max_bytes=4)), ('[[[0]]]', Limits(max_depth=2)),
                             ('[1,2,3]', Limits(max_nodes=3)), ('{"a":"' + chr(92) + 'ud800"}', Limits())]:
            with self.assertRaises(InvalidJSON):
                parse_json(text, limits)
        self.assertEqual(parse_json('"[[[[[["', Limits(max_depth=1)), '[[[[[[')
        with self.assertRaises(InvalidJSON):
            LocalSchema('{"type":"string"}', Limits(max_bytes=4))
        for s in [ {'type':'object', '$ref':'https://attacker.invalid/schema'}, {'type':'object', '$ref':'#/local'},
                   {'type':'string','pattern':'.*'}, {'type':'string','format':'uri'}, {'type':['string','null']},
                   {'type':'object','additionalProperties':{}}, {'type':'array'}, {'type':'unknown'},
                   {'type':'string','minLength':True}, {'type':'number','minimum':2,'maximum':1},
                   {'type':'object','required':['missing']}, {'type':'string','enum':[1]},
                   {'type':'object','properties':{'a':{'type':'string'}},'required':['a','a']} ]:
            with self.subTest(s=s), self.assertRaises(ValueError):
                LocalSchema(json.dumps(s))

    def test_types_required_extra_enum_and_bounds(self):
        for s, good, bad in [({'type':'integer'}, '1.0', 'true'),
                             ({'type':'boolean'}, 'false', '0'),
                             ({'type':'null'}, 'null', '"null"'),
                             ({'type':'string','minLength':2,'maxLength':3}, '"ab"', '"a"'),
                             ({'type':'number','minimum':1,'maximum':2}, '1.5', '3'),
                             ({'type':'array','items':{'type':'integer'},'minItems':1,'maxItems':2}, '[1]', '[]'),
                             ({'type':'integer','enum':[1]}, '1.0', '2'),
                             ({'type':'object','enum':[{'a':1}]}, '{"a":1}', '{"a":true}')]:
            schema = LocalSchema(json.dumps(s))
            self.assertFalse(schema.validate(good)[1])
            self.assertTrue(schema.validate(bad)[1])
        schema = LocalSchema(SCHEMA)
        self.assertEqual(schema.validate('{}')[1][0].rule, 'required')
        self.assertEqual(schema.validate('{"answer":1,"CANARY_KEY":2}')[1][0].rule, 'additionalProperties')
        self.assertNotIn('CANARY', repr(schema.validate('{"answer":1,"CANARY_KEY":2}')[1]))

    def test_oversized_untrusted_output_not_in_feedback_or_events(self):
        schema = LocalSchema(SCHEMA, Limits(max_bytes=256))
        sender = Capture([complete('CANARY_SECRET' * 1000), complete('{"answer":1}')])
        r = repair_json(CONTEXT, schema, sender, ReferenceLedger(1000, 1000, 100, clock=lambda: 0),
                        reserve_tokens=100, reserve_spend=10, max_output_tokens=50)
        self.assertEqual(r.status, 'success')
        self.assertEqual(json.loads(sender.requests[1].feedback)['errors'][0]['category'], 'size_limit')
        self.assertNotIn('CANARY', repr(sender.requests) + repr(r.events))


if __name__ == "__main__":
    unittest.main()
