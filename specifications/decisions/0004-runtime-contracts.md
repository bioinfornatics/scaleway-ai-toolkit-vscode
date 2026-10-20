# ADR 0004 — Versioned model targets and advanced Strands runtime protocol

Date 2026-10-20. Owner: requesting stakeholder/maintainer; .1.5. Contract-first
procedure accepted by stakeholder; this artifact is the resulting engineering
proposal/review baseline, not independent stakeholder acceptance of every new field.

## Decision

- Four Draft7 closed JSON schemas v1.0.0 and shared synthetic conformance cases in
  contracts/. Opaque model target reused across basic model and advanced agent use.
- Model-only TypeScript adapters remain independent of Python. Advanced runtime uses
  local authenticated HTTP/SSE. No websocket/browser-direct provider/runtime access.
- Strands owns Agent loop; wrapper handles portable spec, immutable grants, durable
  all-effect budgets, secret broker, revoke barrier and normalized events.
- Thin policy-bound REST for limited Scaleway control-plane reads/writes, not a claim
  of missing JS SDK coverage. Separate OpenAI-compatible inference client through
  Strands OpenAIModel; no fallback/default Bedrock. Future billable REST writes need
  independent mandate and idempotency/reconciliation proof.
- Spec/request bodies carry references, not credentials/executable commands/grants.
  Authority verified through private host registry/broker; local bearer only identifies
  runtime client. Hosted auth/state remain separate unresolved .1.6 decisions.
- Prompt JSON local validation + bounded model-only repair (ADR0003), no native parse.

## Pinned validation profile and packaging

strands-agents[openai] 1.61.1, OpenAI 2.54.0, httpx 0.28.1. Public Strands metadata:
Apache-2.0, source commit 5cb880559e5ed88bd55de2779e72d060020f756b, published
wheel digest in existing release evidence. SDK requires Python >=3.10; repository
helper >=3.11. Only CPython 3.14.8 Linux amd64 has executed present smoke/contract
checks; profile runtime startup must reject unverified Python/dependency combinations
until added matrix tests. No Windows/macOS/container compatibility claimed.

Isolated validation environment packages recorded in runtime-contract-profile-v1.json;
not production lock/SBOM. Strands extra pulls boto3/botocore/AWS token helper and
OpenTelemetry packages even with explicit OpenAI usage. Dependencies do not permit
AWS traffic/telemetry; disable exports and guard nested egress. MCP version is pinned
in validation profile, launch not tested or authorized by selection. No strands-tools,
dynamic workspace plugin scanning, provider auto-selection or arbitrary extras.
Production runtime packaging/lock/container/accessibility testing remains .4.2/.5.2.
Tooling npm lock only applies offline Ajv/TypeScript; not extension dependencies.

## Actual SDK mapping and limits

Agent instructions -> system prompt; messages -> Strands content blocks; tools ->
trusted ToolSpecs; max_output_tokens -> max_tokens through allowlist. Resolve model
identifier/base path from approved target; params do not inherit unknown settings.
BeforeModelCallEvent can mutate regular requests; BeforeToolCallEvent can deny tools,
but final mutation/transport retries require independent all-dispatch guard. Native
structured_output bypasses that hook and is disabled; BeforeModelCallEvent alone is
not paid-effect enforcement. Correction helper uses model-only sender, not Agent replay.

Provider OpenAIModel emits message/content deltas, buffered tool deltas, stop and
metadata usage. Version mapping converts them to runtime-events with origin, version,
run/attempt scope and sequence. Remote tool proposal is not a tool result. Present
live tool case emitted end_turn alongside tool block: wrapper distinguishes proposal
from execution and must not treat stopReason alone as successful completed agent.
Unknown usage/endpoints/capabilities preserve explicit unknown states.

## Evidence and acceptance boundary

[Live discovery review](../../evidence/reviews/provider-acceptance-20261020.md):
three bounded actual SDK calls for one serverless Mistral model; no full Agent loop,
private endpoint, native JSON or complete tools/security compatibility. Five actual
SDK mocks exercise auth/redirect/no-retry/local cancel and unsupported option handling.
Cross-language contract cases test schemas and basic state transitions, no live cloud.
[Runtime protocol](../runtime-protocol.md) specifies mandatory security/semantic checks
not established by schema validation. Production issuer/broker/ledger/server tests
remain implementation gates, not waived by this discovery task. Model deployment
and application hosting are distinct; neither performed by .1.5.

## Accepted sequencing

Maintainer 2026-10-20 21:40 accepted model MVP -> dedicated model deployment -> advanced
agent authoring/execution -> optional application hosting. Beads .4.1 now depends on
.5.1; preserve existing task IDs/parent for stable links. This is delivery sequence,
not requirement that serverless agents deploy GPUs. Existing user-value/design gates
stay; no inference/provisioning authority broadened and no pushes authorized.
