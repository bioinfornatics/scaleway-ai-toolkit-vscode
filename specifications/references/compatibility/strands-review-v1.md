# Strands 1.61.1 — source/release evidence

2026-10-20 · scaleway_ai_vscode-jgh.1.2 · static public inspection only. URLs/hash/date metadata: ../documentation/serverless-sources-v1.json. No installed/imported/executed external code.

## Identity

sdk-python public API redirects to harness-sdk. Published Python SDK is **strands-agents 1.61.1**, not harness-py; monorepo strands-py source at release python/v1.61.1 commit 5cb880559e5ed88bd55de2779e72d060020f756b. Release published 2026-10-15T20:25:38Z; PyPI requires Python >=3.10. Official release-pinned provider docs (strands-source-doc-openai.txt 13–49,77–92) show strands-agents[openai], from strands import Agent, from strands.models.openai import OpenAIModel, client_args.api_key/base_url. ADR links currently valid but moving; historical sdk-python/src paths cannot be assumed valid.

Wheel strands_agents-1.61.1-py3-none-any.whl SHA256 ee0720a0dacdfa2fc745f7260a58d9868067d7bd16c2cfbcb7631475fc0258dd, PyPI uploaded 2026-10-15T20:26:08.580812Z. ZIP bytes of strands/models/openai.py, strands/hooks/events.py and strands/agent/agent.py matched release-pinned raw sources exactly. Outside repo, no execution. Base dependencies include boto3/botocore/telemetry; OpenAI extra permits openai>=1.68,<3 plus aws-bedrock-token-generator. Exact lock/runtime/import/license footprint remains pending.

## Excerpts/ref locations and implications

Locations: strands-source-openai.txt.
- 108–140 validates config/client conflicts, returns client_args unless Mantle selected.
- 511–539 copies params, defaults stream True and stream_options={include_usage: True}; request messages/model/function tools/tool_choice then **params. No provider allowlist; reserved fields can be overridden. Block these overrides and unchecked cache options.
- 673–696 caller-manages custom client or creates AsyncOpenAI per request; 736–743 invokes await client.chat.completions.create(**request). This is Chat Completions, not Responses.
- 752–800 uses tool_calls.setdefault(tool_call.index, []).append(tool_call), breaks at finish_reason then emits buffered tools/argument deltas. No progressive remote tool-argument exposure. First delta supplies ID/name (569–570): split/absent first metadata needs fixtures. Missing finish_reason defaults end_turn (803), risking success normalization for truncated EOF.
- 803–810 emits message_stop, drains stream, emits metadata only if final event has usage. Earlier usage can be lost; absent unknown, not zero. Usage-only final empty-choice chunks consumed by drain. Never sum cumulative usage snapshots.
- 811–820 classifies only openai.APIError throttling/context overflow, otherwise raises. Agent retry strategy (agent 526–557) and OpenAI retry settings separate; bound both to avoid multiplied calls.
- 846–901 structured_output calls client.beta.chat.completions.parse, removes stream/stream_options, explicit response_format=output_model. Separate nonstream paid path; params response_format can conflict. Exact dependency/schema/refusal handling untested.
- 407–424 warns/skips multi-turn reasoningContent and some cache/location blocks: not lossless parity. 729 logs full request at debug; normalized events must redact.

strands-source-hooks.txt 221–245: BeforeToolCallEvent.cancel_tool denies tool with error result; selected_tool/tool_use writable. Final dispatch must revalidate modified target/arguments with atomic mandate/revocation/concurrency state.

318–343 exact note: “This event is not fired for invocations to structured_output.” BeforeModelCallEvent.cancel cannot alone guard all paid effects. Guard transport/structured/retry/auxiliary paths or disable them.

strands-source-agent.txt 629–664 describes cancel()/caller cancel_signal, safe points model streaming/before tools/MCP/after tools. 1440–1500 closes generator, handles BaseException cancellation, cancels watcher, clears state/releases concurrency. Local cancellation feasibility, not provider abort/billing-stop/rollback or arbitrary synchronous tool interruption. Test cooperative signal/task cancel/early close/blocked read/agent reuse; reconcile accepted/unknown effects.

Agent 241,366–368 defaults None/string model to Bedrock: always explicit model object; audit auxiliary models and telemetry.

## Contradictions/result

Scaleway GPT-OSS catalog 690–710 generic tools Yes contradicted by Chat Completions tools unsupported: selected tool transport incompatible. Gemma 3 Partial maps unknown/reliability-limited, parallel No. Dedicated cumulative usage is not serverless proof; old OpenAI-no-stream-usage claim stale. Current developer schema reference adds project paths/unsupported options absent in older examples.

Static published identity/import/source transport verified; thin wrapper feasible. Live per-model compatibility/progressive tool-event requirement/complete usage/all-path pre-effect guards NOT passed. Exact dependency lock and fixture results pending parent/runtime owner; no silent SDK/provider/Responses switch. Full issue remains blocked pending separately authorized checks.
