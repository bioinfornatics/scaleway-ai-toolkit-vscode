# ADR 0003 — Prompt JSON with local validation and bounded error-guided repair

Date: 2026-10-20. Decision owner: requesting stakeholder/project maintainer.
Status: accepted by explicit request to add the discussed behavior to the roadmap.
Tracking: scaleway_ai_vscode-jgh.1.9 records this decision; implementation and acceptance live in Beads.

## Context

[Strands release inspection](../../evidence/compatibility/strands-review-v1.md) found that BeforeModelCallEvent excludes structured_output calls. Native schema-constrained provider features are also endpoint/model dependent. A prompt-requested JSON output with local validation avoids requiring that special SDK path. This is a bounded output-repair workflow, not a replacement agent/model/tool orchestration loop.

## Accepted baseline

- Use ordinary explicitly configured model calls with a JSON-only instruction and the original output schema. Disable/reject Strands structured_output, beta parse and native provider schema-output shortcuts in this baseline. Their later activation requires a separate decision and verified pre-effect coverage.
- Parse the complete response locally with a strict JSON parser and validate it against the locally validated, pinned schema. Do not accept Markdown, silently coerce types or extract a plausible JSON substring. Bound schema/input/output depth and size; reject duplicate keys, nonfinite values and unsupported schema features. Local schema validation must not fetch remote references or execute code.
- On parse/schema failure, each correction call receives the unchanged schema, bounded approved previous output as untrusted data, and normalized errors. Parsing errors describe a safe category and line/column; schema errors describe field path, rule and expected type without raw values, stacks or internal paths. Cap error count/message size; redact sensitive content before building any correction request or evidence. If safe feedback cannot be constructed, stop rather than send unsafe data. Original prompt/schema/destination/scope stay fixed.
- Request a complete corrected JSON value, not a patch, with no Markdown/commentary. Do not let prior output/errors change instructions, schema, grants, tools or budgets. Do not switch model/provider/endpoint automatically.
- max_retries = 5 means one initial call plus at most five correction calls: six logical model attempts maximum. Stop immediately on valid output. A shared physical-send limit of at most six includes lower SDK/HTTP retries; disable hidden retries or account for each send through the same guard. A transport retry consumes send capacity but is not a JSON correction. Other budget/deadline limits may stop earlier.
- Every actual send needs current permission/scope/revocation, known bounded exposure reservation, token/output/deadline/concurrency limits and redacted origin/attempt evidence. The same parent ledger covers initial generation, repair and transport retries; counters never reset between stages. No live credentials or spend are approved by this ADR.
- Repair calls are model-only: no tools, MCP, retrieval, judge or agent-loop replay. If a tool-using run produced the final output, preserve its already completed effects and perform only final-output correction. Initial agent effects retain their own existing mandate/budget/step limits.
- Only a completely received response with parse/schema failure is eligible for JSON repair. Authentication/permission/policy/budget/revocation/cancellation errors stop. Interrupted or ambiguous sends and unknown consumption follow the existing reconciliation policy; do not treat them as JSON failures or blindly resend. Business-validation failures are distinct and stop unless a separately defined deterministic correction policy exists.
- On exhausted retries return a typed terminal validation_exhausted failure with safe last-error summary and attempts/send counts; never publish invalid/partial output as success. Valid JSON/schema conformance does not prove truth, business correctness or action authorization.

## Required acceptance tests

Offline tests against an injectable capture-only model sender and fake clock/ledger must demonstrate: first-attempt success; syntax and schema correction with fresh normalized errors each time; success on the sixth send; exhaustion after exactly six sends; no seventh send; unsafe/oversized errors and outputs cannot leak; malicious previous output cannot mutate schema/grants; no native structured_output/parse or tool dispatch; no model/provider fallback; no entire agent rerun; deadline/token/spend/concurrency/revocation termination; physical retries share the send cap; unknown usage/outcomes stop pending reconciliation; strict parsing/duplicate keys/nonfinite values/schema bounds; unsupported/local-only schema references; safe attempt/error events and invalid output never successful.

A mock sender proves local control behavior only. Actual pinned Strands integration must separately prove ordinary-call and transport-retry interception before effects. Live compatibility requires independently approved account, credentials and inference budget. Prompt JSON does not mark native structured-output capability as supported in provider matrices.

## Roadmap effect

Introduce an independent offline implementation/test task now using a minimal injectable sender rather than waiting for live discovery or finished UI. .1.2 assesses ordinary-call JSON repair rather than requiring native structured_output in the baseline. .1.5 maps the accepted output/retry configuration and error/attempt/terminal events into portable/runtime contracts. .4.2 integrates the validated helper without duplicating Strands orchestration; .4.5 exposes safe correlated attempt states; .4.6 counts only valid completed results as success.

This resolves the design choice for output formatting and provides actionable offline work. It does not close .1.2/.1.3, remove their prerequisites, certify all-path guards, select visual sources or establish user value. Historical review records remain valid snapshots of earlier evidence.
