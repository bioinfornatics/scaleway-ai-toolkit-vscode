# ADR 0001 — Strands Python for Scaleway agents

Date: 2026-10-20. Decision owner: requesting stakeholder/project maintainer.
Status: SDK selection accepted by explicit stakeholder request; implementation and compatibility validation not performed.
Beads: scaleway_ai_vscode-jgh.1.5 (remaining runtime/event contracts), scaleway_ai_vscode-jgh.4.2 (implementation).

## Context and decision
Scaleway infrastructure SDKs/control-plane APIs and OpenAI-compatible inference are not an agent orchestration SDK. No native managed agent creation/thread/session service has been established in inspected sources; do not infer permanent absence.

Use **Strands Python agent SDK** to create/run agents against Scaleway. Configure OpenAIModel explicitly with approved serverless/dedicated endpoint, discovered model identifier and external credential. Inspected source accepts configurable client/client_args and uses Chat Completions. Pin a tested released version; source inspection is not release or live compatibility evidence.

Strands owns the agent/model/tool loop. A thin Python HTTP wrapper owns portable spec mapping, secret resolution, pre-effect mandates, session/process boundaries and normalized versioned events. Avoid a second custom loop and simultaneous framework parity.

Create agent = portable project/spec. Run = local wrapper. Deploy = host that application. Deploy model = independent dedicated inference operation. List local specs/tracked hosted applications without claiming a native Scaleway agent catalog.

## Alternatives and distinctions
- Strands is model-portable/in-process, not Bedrock-only. No implicit default provider/fallback permitted.
- Microsoft 365 Agents SDK (supplied links) provides channels/activity/auth/state integration; Microsoft Agent Framework is the closer orchestration comparison. Neither is an additional baseline dependency.
- Harness² recursively optimizes harnesses through executors/benchmarks; not an officially supported Google product. Documented Vertex setup and Codex Responses endpoint/bridge do not prove Scaleway compatibility. Unrestricted executor networking/disabled Codex sandbox conflicts with baseline; defer with separate compatibility/security/multiplied-cost research.

## Verification and remaining decisions
Verify selected-model tool calls, streamed arguments/results, structured output and parameters; cumulative/missing usage, errors/retries/cancellation; pre-effect deny/revoke/step/token/concurrency checks; no unintended providers/network telemetry; redacted origin/version model/tool/error/partial events; SDK/license/Python/dependency footprint; independently runnable exports/container and external durable state where required. Fixture tests cannot prove live provider availability.

If required contracts fail, file evidence/blocker for stakeholder review; do not silently switch SDK. SDK version, control-plane SDK/REST adapter and complete event/spec contracts remain open in Beads.

## Output-validation decision refinement

[ADR 0003](0003-prompt-json-bounded-repair.md) accepts prompt-requested JSON with strict local schema validation and bounded error-guided correction instead of native structured_output in the baseline. Five retries mean six maximum sends including shared transport-retry exposure. Correction calls are model-only and never replay the tool agent. Native shortcuts remain disabled; ordinary sender/transport guards still need verification. This refines output handling without changing SDK selection or proving compatibility.

## Roadmap and authorization
Phase 0 verifies Strands/Scaleway transport, safety and packaging and finalizes contracts. Phase 1 stays model-only MVP. Phase 2 delivers portable local Strands agents/MCP/inspection/evaluation. Phase 3 hosts same application with state/network/streaming/cleanup evidence. Phase 4 considers justified alternatives and optional harness optimization.

Selection authorizes planning/specification updates only, not implementation, installs, authenticated requests, paid provisioning, publication or Git/Dolt remote sync. Historical G1 records remain unchanged; no visual/build approval implied. Task status lives in Beads, not a parallel Markdown backlog.

## Sources (moving branches; pin during verification)
- https://github.com/strands-agents/harness-sdk
- https://github.com/strands-agents/harness-sdk/blob/main/strands-py/src/strands/models/openai.py
- https://github.com/microsoft/Agents
- https://learn.microsoft.com/en-us/python/api/agent-sdk-python/agents-overview?view=agent-sdk-python-latest
- https://github.com/microsoft/agent-framework
- https://github.com/google-research/harness2
- https://github.com/google-research/harness2/blob/main/docs/SETUP.md

## Contract decision refinement — 2026-10-20

[ADR0004](0004-runtime-contracts.md) now records versioned portable/runtime/IPC
contracts, tested SDK/runtime profile and exact authority boundaries. Three real
OpenAIModel smoke cases and five SDK mocks establish narrow transport evidence,
not full Agent/runtime/security compatibility. Earlier no-live wording is historical.
