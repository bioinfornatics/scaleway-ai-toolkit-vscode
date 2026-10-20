# Scaleway serverless — reviewed contract

> **2026-10-20 update:** Original source review below is historical. See [scoped live evidence and discovery acceptance](../../../evidence/reviews/provider-acceptance-20261020.md). Production, minimum IAM, all-model conformance, deployment and private reachability are not certified.

Revision 1.0.0 · 2026-10-20 · scaleway_ai_vscode-jgh.1.2.
Authority: [capabilities](../../architecture.md#capabilities), [ADR0001](../../decisions/0001-strands-agent-sdk.md).

**Public documentation/source review only; no credentials, live discovery/inference, provider writes, spend, installs or external code execution.**

## Evidence and provenance

[Source manifest](../../../evidence/documentation/serverless-sources-v1.json) captures URLs, UTC retrieval dates, revisions, raw/sanitized SHA256 and sanitization. Pinned Scaleway docs: 1dd79adcf1f8ccbded698d2776871c21d50bac06. [Matrix v1](../../../evidence/capabilities/serverless-matrix-v1.json) records 47 catalog entries with supported/unsupported/unknown **documentation** evidence and separate unknown live results. Catalog names are not authenticated serverless IDs; no live availability invented. [Partial rendered schema projection](../../../evidence/documentation/serverless-schema-projection-v1.json) is developer reference v1, not complete OpenAPI or portable contract; request/response fields and schema commit unavailable. Public scaleway/api main/master lookups returned 404, not proof of permanent absence. [Strands excerpts](../../../evidence/compatibility/strands-review-v1.md), [check plan](../../../evidence/documentation/serverless-check-plan-v1.json).

Line locations refer to manifest snapshots; one public credential-shaped example replaced without changing line count. Downloaded wheel stayed outside repo; only ZIP data inspected.

## Endpoint/authentication/scope

scw-models 13–23 documents GET https://api.scaleway.ai/v1/models, Bearer auth and basic inference-model metadata. Not deployments, feature matrix, serving weights, lifecycle or quota discovery. No complete response schema/pagination established. scw-auth 13–31 requires Bearer secret key; 48–61 lists GenerativeApisModelAccess/GenerativeApisFullAccess/AllProductsFullAccess. Narrow query permission is a candidate, not proven sufficient for other operations; no broad privileges by default.

Developer projection lists GET /v1/models but POST /{project_id}/v1/chat/completions and similar project-scoped inference paths. Older docs use /v1/chat/completions. Optional/default-project semantics unresolved; this does not prove older URLs stopped working. Verify base path/project scope under separate approval, no fallback requests. Prose mentions Paris/fr-par/optional region path but operation projection contains project_id, not region. Hostname does not establish selectable region or residency. Native managed agent/thread/session catalog remains unknown.

## Parameters/streams/models

scw-chat 55–85 lists messages/model, sampling, stream/stream_options/tools/tool_choice/response_format support; excludes frequency_penalty/n/top_logprobs/logit_bias/user. Developer description additionally excludes metadata/prompt_cache_key/store/audio output and other matrix-listed parameters. Incomplete overlapping lists do not prove parity: endpoint/model/API allowlist required; unknown options blocked or explicitly approved for experiments. Strands params does not filter Scaleway options.

scw-function-calling 302–320 documents streamed tools, not live model framing. scw-compatibility cumulative usage section explicitly applies to Dedicated Deployment; cannot establish serverless usage. Its “OpenAI never returns streaming usage” claim is stale relative to modern include_usage. Missing usage unknown, not zero; do not sum cumulative snapshots.

scw-supported-models restrictions:
- 690–710 GPT-OSS 120b: generic tools Yes but Chat Completions tools explicitly unsupported, Responses recommended. Selected OpenAIModel uses Chat Completions: unsuitable tool-agent candidate under this transport; no silent Responses/SDK switch.
- 238–263 Gemma 3: tools Partial/reliability-limited maps unknown, parallel No.
- 729–750 Llama 3.3 and 341–364 Mistral Small 3.2: documented structured/function/parallel Yes, candidates only, no live proof.
- No/EOL catalog status is documented unsupported availability, not a live observation. Dedicated quantized identifiers are not serverless selectors. Generic features may span offerings/API transports.

scw-lifecycle 16–35 permits redirecting retired strings to alternative models: same identifier does not prove same weights. Invalidate on connection/credential, org/project, base path/API, model/serving revision, lifecycle, quota/permissions, sources/schema/SDK/dependency changes. Unexpected discovery/errors/streams stale affected evidence. Historical snapshots stay historical; TTL is not proof.

## Released Strands and safety

PyPI strands-agents 1.61.1, Python >=3.10, tag python/v1.61.1, commit 5cb880559e5ed88bd55de2779e72d060020f756b reviewed. sdk-python API currently redirects to harness-sdk monorepo; strands-py SDK differs from harness-py. ADR links currently real but moving. Official pinned docs verify strands-agents[openai], from strands import Agent / from strands.models.openai import OpenAIModel and client_args base_url/api_key. Published wheel OpenAI/hooks/Agent bytes exactly match release source. Exact tested OpenAI dependency lock unresolved (allowed >=1.68,<3).

Always explicit configured OpenAIModel/discovered ID/approved origin/base path/external credential. Agent None/string defaults Bedrock; forbid unintended Mantle/auxiliary/default/fallback routes and raw debug request logs/unchecked telemetry.

Release buffers tool argument deltas until completion; progressive remote tool events not established. Emits final-event usage only; final missing means unknown. Structured output uses separate nonstream beta.chat.completions.parse. BeforeToolCallEvent.cancel_tool feasible deny hook, but BeforeModelCallEvent explicitly excludes structured_output. Hooks-only paid-call guard insufficient: guard every dispatch/retry/auxiliary path or disable unguarded paths. Validate final modified tools/arguments atomically against mandate/revocation/step/token/concurrency limits.

Agent.cancel/caller cancel_signal and cleanup support local safe-point cancellation, not immediate remote abort, billing stop, rollback or arbitrary synchronous tool interruption. Preserve partial output/unknown usage and accepted/unknown effects; reconcile before retry.

## Errors and verification gate

scw-errors 16–45 shows nested recent vs flat legacy envelopes (legacy sample lacks comma); 51–61 lists 400/401/403/404/422/429/500 and SSE errors after HTTP 200. Invalid keys may be 403 per docs, not always 401. HTTP 200 alone not success. scw-rate-limits says org-shared quotas; 2026-10-19 scw-rate-change adds project limits/per-user daily/monthly budgets. Verify effective scope, never hardcode example limits.

Check plan separates public review, offline fixtures, separately authorized discovery GET and separately approved bounded inference. **Documentation portion complete; full .1.2 not legitimately closable as verified**: test-only synthetic wire examples now execute (see ../../../evidence/validation/offline-discovery.json), but production adapter and actual Strands fixtures are absent, schema/project semantics partial, and no approved account/credential mandate/budget exists for live proof. Only explicit acceptance of narrower blocked research completion plus durable remaining blockers could justify closure. No Beads mutation/commit/push.
