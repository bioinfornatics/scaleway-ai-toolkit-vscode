"""Bounded OFFLINE Strands 1.61.1 adapter; not a server or live authority.

Uses OpenAIModel(client=..., stream=False).stream(messages), not an Agent loop,
Bedrock defaults, tools, beta.parse, or hook-only authorization. BeforeModelCallEvent
is insufficient: pinned hooks explicitly exclude structured_output. The injected
client's chat.completions.create is the physical-send barrier. Broker/sender are
trusted Python dependencies, never reconstructed from run/spec JSON. This fake
ledger is process-local; live remains unconditionally disabled pending durable
ledger, authenticated private broker, dependency lock and provider acceptance.
"""
from __future__ import annotations

import asyncio
import copy
import importlib.metadata
import json
import math
import re
import threading
import time
import uuid
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Callable, Protocol

SDK_VERSION = "1.61.1"
TARGET = "https://api.scaleway.ai/v1/chat/completions"
_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")
_DIGEST = re.compile(r"[a-f0-9]{64}\Z")


def _require(condition):
    if not condition:
        raise Denied("invalid_request")


class Denied(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def _positive(value, ceiling):
    return type(value) is int and 0 < value <= ceiling


@dataclass(frozen=True)
class Binding:
    """Immutable canonical full runtime-event binding; no credentials/grants."""
    canonical: str

    @classmethod
    def from_dict(cls, value):
        v = copy.deepcopy(value)
        keys = {"run_id", "scope", "spec_revision", "prompt_revision", "data_revision",
                "model_revision", "runtime_instance_id", "epoch"}
        scope_keys = {"connection_ref", "credential_generation", "organization_ref",
                      "project_ref", "region", "scope_revision"}
        try:
            _require(type(v) is dict and set(v) == keys)
            _require(type(v["scope"]) is dict and set(v["scope"]) == scope_keys)
            for k in ("run_id", "runtime_instance_id"):
                _require(type(v[k]) is str and _ID.fullmatch(v[k]))
            for k in ("spec_revision", "prompt_revision", "data_revision", "model_revision"):
                _require(type(v[k]) is str and _DIGEST.fullmatch(v[k]))
            s = v["scope"]
            for k in ("connection_ref", "organization_ref", "project_ref"):
                _require(type(s[k]) is str and _ID.fullmatch(s[k]))
            _require(s["region"] == "fr-par" and _DIGEST.fullmatch(s["scope_revision"]))
            _require(_positive(s["credential_generation"], 2147483647))
            _require(_positive(v["epoch"], 2147483647))
        except (Denied, KeyError, TypeError):
            raise Denied("invalid_request") from None
        return cls(json.dumps(v, sort_keys=True, separators=(",", ":")))

    def as_dict(self):
        return json.loads(self.canonical)


@dataclass(frozen=True)
class Grant:
    ref: str
    binding: Binding
    credential_ref: str
    model_id: str
    expires: float
    max_output_tokens: int
    max_output_bytes: int
    timeout: float
    # Reviewed conservative total input bound and prices in EUR microunits/token.
    input_token_bound: int
    input_rate: int
    output_rate: int
    target: str = TARGET
    max_physical_sends: int = 6
    input_limit: int = 100000
    output_limit: int = 100000
    spend_limit: int = 1000000

    def __post_init__(self):
        if (type(self.binding) is not Binding or not _ID.fullmatch(self.ref)
            or not _ID.fullmatch(self.credential_ref) or self.target != TARGET
            or type(self.model_id) is not str or not 1 <= len(self.model_id) <= 256
            or not math.isfinite(self.expires) or not 0 < self.timeout <= 3600
            or not _positive(self.input_token_bound, 10000000)
            or not _positive(self.max_physical_sends, 6)
            or any(not _positive(x, 1000000000) for x in
                   (self.input_limit, self.output_limit, self.spend_limit))
            or not _positive(self.max_output_tokens, 32768)
            or not _positive(self.max_output_bytes, 1048576)
            or any(type(x) is not int or not 0 <= x <= 1000000
                   for x in (self.input_rate, self.output_rate))):
            raise Denied("invalid_request")


class Registry:
    """Host-injected in-memory reference registry, separate from launch claims.

    All ledgers/adapters using this registry share its physical dispatch barrier.
    revoke/cancel completion prohibits new sends; it does not undo prior sends.
    """
    def __init__(self, grants=(), *, clock=time.monotonic):
        self._grants = {g.ref: g for g in grants}
        self._cancelled = set()
        self.gate = threading.RLock()
        self.clock = clock

    def current(self, ref, binding):
        with self.gate:
            g = self._grants.get(ref)
            if g is None:
                raise Denied("revoked")
            if g.binding != binding:
                raise Denied("scope_mismatch")
            if binding.canonical in self._cancelled:
                raise Denied("revoked")
            if self.clock() >= g.expires:
                raise Denied("revoked")
            return g

    def revoke(self, ref):
        with self.gate:
            self._grants.pop(ref, None)

    def cancel(self, binding):
        with self.gate:
            self._cancelled.add(binding.canonical)


@dataclass
class OfflineLedger:
    """Shared six-send reference ceiling; retained unknown exposure never refunded."""
    max_sends: int = 6
    input_limit: int = 100000
    output_limit: int = 100000
    spend_limit: int = 1000000
    sends: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    spend: int = 0
    frozen: bool = False
    active: bool = False
    _registry: Registry | None = field(default=None, repr=False)

    def __post_init__(self):
        if not _positive(self.max_sends, 6) or any(not _positive(v, 1000000000)
            for v in (self.input_limit, self.output_limit, self.spend_limit)):
            raise Denied("invalid_request")


@dataclass(frozen=True)
class PhysicalRequest:
    target: str
    model_id: str
    prompt: str = field(repr=False)
    max_output_tokens: int = 1
    max_output_bytes: int = 1
    deadline: float = 0
    # Credential material never enters this object, events or returned diagnostics.


class Broker(Protocol):
    async def resolve(self, grant: Grant) -> Callable: ...


@dataclass(frozen=True)
class Outcome:
    state: str
    text: str = field(repr=False)
    events: tuple = ()


def _model_factory(client, model_id, max_tokens):
    """Lazy exact API. No SDK import, credentials or provider setup at import time."""
    if importlib.metadata.version("strands-agents") != SDK_VERSION:
        raise Denied("unsupported_version")
    # Pinned source logs the whole formatted request. Fail closed if enabled;
    # do not globally rewrite application logging configuration.
    import logging
    if logging.getLogger("strands.models.openai").isEnabledFor(logging.DEBUG):
        raise Denied("unsupported_feature")
    from strands.models.openai import OpenAIModel
    return OpenAIModel(client=client, model_id=model_id, stream=False,
                       params={"max_tokens": max_tokens})


class Adapter:
    def __init__(self, registry: Registry, ledger: OfflineLedger, broker: Broker,
                 *, model_factory=_model_factory, offline=True):
        if offline is not True:
            raise Denied("unsupported_feature")  # no live opt-in until gates exist
        if type(registry) is not Registry or type(ledger) is not OfflineLedger:
            raise Denied("forbidden")
        with registry.gate:
            if ledger._registry is not None and ledger._registry is not registry:
                raise Denied("forbidden")
            ledger._registry = registry
        self.registry, self.ledger, self.broker = registry, ledger, broker
        self.model_factory = model_factory

    async def run(self, ref: str, binding: Binding, prompt: str, *,
                  max_output_tokens: int, max_output_bytes: int, timeout: float):
        events = []
        attempt = uuid.uuid4().hex
        sent = False
        settled = False
        text = ""
        cancelled = False
        deadline = 0.0

        def emit(kind, data):
            events.append({"contract_version": "1.0.0", "event_id": uuid.uuid4().hex,
                           "binding": binding.as_dict(), "sequence": len(events) + 1,
                           "origin": "runtime", "sdk_version": SDK_VERSION,
                           "type": kind, "data": data})

        if type(binding) is not Binding:
            raise Denied("invalid_request")
        # Reject direct construction of a noncanonical/malformed Binding.
        if Binding.from_dict(binding.as_dict()) != binding:
            raise Denied("invalid_request")
        emit("run.started", {"state": "running"})
        code = None
        try:
            grant = self.registry.current(ref, binding)
            if (type(prompt) is not str or not prompt or len(prompt.encode()) > min(32768, grant.input_token_bound)
                or not _positive(max_output_tokens, grant.max_output_tokens)
                or not _positive(max_output_bytes, grant.max_output_bytes)
                or type(timeout) not in (int, float) or not math.isfinite(timeout)
                or not 0 < timeout <= grant.timeout):
                raise Denied("invalid_request")
            # Conservative caller-reviewed token bound, never guessed from usage.
            # Byte bound is additional protection; tokenizer/pricing proof is pending.
            deadline = min(grant.expires, self.registry.clock() + timeout)
            async with asyncio.timeout(timeout):
                sender = await self.broker.resolve(grant)
                if not callable(sender):
                    raise Denied("forbidden")

                async def create(**request):
                    nonlocal sent, settled
                    expected = {"model": grant.model_id, "stream": False,
                                "max_tokens": max_output_tokens, "tools": [],
                                "messages": [{"role": "user", "content": [{"type": "text", "text": prompt}]}]}
                    if request != expected:
                        raise Denied("unsupported_feature")
                    with self.registry.gate:
                        if sent or self.registry.current(ref, binding) != grant:
                            raise Denied("revoked")
                        if self.registry.clock() >= deadline:
                            raise Denied("deadline_exceeded")
                        l = self.ledger
                        cost = grant.input_token_bound * grant.input_rate + max_output_tokens * grant.output_rate
                        if l.frozen:
                            raise Denied("usage_unknown")
                        if (l.active or l.sends >= min(l.max_sends, grant.max_physical_sends)
                            or l.input_tokens + grant.input_token_bound > min(l.input_limit, grant.input_limit)
                            or l.output_tokens + max_output_tokens > min(l.output_limit, grant.output_limit)
                            or l.spend + cost > min(l.spend_limit, grant.spend_limit)):
                            raise Denied("budget_exceeded")
                        l.input_tokens += grant.input_token_bound
                        l.output_tokens += max_output_tokens
                        l.spend += cost
                        l.sends += 1
                        l.active = True
                        sent = True
                        emit("model.attempt", {"attempt_id": attempt, "physical_send_count": l.sends,
                             "phase": "initial", "effect_state": "dispatch_intent"})
                    response = await sender(PhysicalRequest(grant.target, grant.model_id, prompt,
                                                           max_output_tokens, max_output_bytes, deadline))
                    # OpenAI nonstream complete response: no EOF->end_turn default.
                    try:
                        c = response.choices
                        _require(len(c) == 1 and c[0].finish_reason == "stop")
                        _require(not getattr(c[0].message, "tool_calls", None))
                        _require(not getattr(c[0].message, "refusal", None))
                        content = c[0].message.content
                        _require(type(content) is str and len(content.encode()) <= max_output_bytes)
                        u = response.usage
                        counts = (u.prompt_tokens, u.completion_tokens, u.total_tokens)
                        _require(all(type(x) is int and x >= 0 for x in counts))
                        i, o, total = counts
                        _require(total == i + o and i <= grant.input_token_bound and o <= max_output_tokens)
                    except (Denied, AttributeError, TypeError, UnicodeError):
                        raise Denied("usage_unknown") from None
                    with self.registry.gate:
                        l.input_tokens -= grant.input_token_bound - i
                        l.output_tokens -= max_output_tokens - o
                        l.spend -= cost - (i * grant.input_rate + o * grant.output_rate)
                        settled = True
                        emit("usage.updated", {"attempt_id": attempt, "usage": {
                            "status": "known", "input_tokens": i, "output_tokens": o,
                            "total_tokens": total, "spend_microunits": i * grant.input_rate + o * grant.output_rate,
                            "semantics": "attempt_total"}})
                        self.registry.current(ref, binding)
                        if self.registry.clock() >= deadline:
                            raise Denied("deadline_exceeded")
                    return response

                client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
                model = self.model_factory(client, grant.model_id, max_output_tokens)
                chunks = []
                async for event in model.stream([{"role": "user", "content": [{"text": prompt}]}]):
                    delta = event.get("contentBlockDelta", {}).get("delta", {})
                    if set(delta) - {"text"}:
                        raise Denied("unsupported_feature")
                    if "text" in delta:
                        chunks.append(delta["text"])
                        if len("".join(chunks).encode()) > max_output_bytes:
                            raise Denied("usage_unknown")
                if not sent or not settled:
                    raise Denied("usage_unknown")
                self.registry.current(ref, binding)
                if self.registry.clock() >= deadline:
                    raise Denied("deadline_exceeded")
                text = "".join(chunks)
        except asyncio.CancelledError:
            self.registry.cancel(binding)
            cancelled, code = True, "revoked"
        except TimeoutError:
            code = "deadline_exceeded"
        except Denied as exc:
            code = exc.code if exc.code in {"unsupported_version", "invalid_request",
                "forbidden", "scope_mismatch", "budget_exceeded", "revoked",
                "deadline_exceeded", "usage_unknown", "unsupported_feature"} else "provider_error"
        except Exception:
            code = "provider_error"  # no raw exception/body/logging
        finally:
            if sent:
                with self.registry.gate:
                    self.ledger.active = False
                    if not settled:
                        self.ledger.frozen = True
                        emit("usage.updated", {"attempt_id": attempt, "usage": {
                            "status": "unknown", "reason": "unverified", "reservation_retained": True}})
        if code:
            text = ""
            emit("run.error", {"code": code, "message": "Dispatch stopped.", "retry_disposition": "never"})
        state = "cancelled" if cancelled else "failed" if code else "succeeded"
        emit("run.terminal", {"state": state, "output_status": "none" if code else "complete",
            "remote_outcome": "completed" if settled else "unknown" if sent else "not_sent",
            "usage_status": "known" if settled or not sent else "unknown",
            "physical_send_count": self.ledger.sends, "reconciliation_required": sent and not settled})
        return Outcome(state, text, tuple(events))
