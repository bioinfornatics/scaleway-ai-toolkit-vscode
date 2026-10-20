# Product specification

Revision 0.1 — 2026-10-20. Proposed baseline derived from the stakeholder goal and initial analysis. Product authority: [vision](../PRODUCT.md#vision). Status lives in Beads, not this document.

<a id="requirements"></a>
## Requirements and acceptance

### R01 — Connection and scope (MVP)
Use VS Code SecretStorage for credential material; store only safe connection references in workspace configuration. Display connection, project and region where relevant. Distinguish serverless inference scope from regional dedicated resources. Test invalid/revoked credentials and least-privilege IAM. Acceptance: switching connection cannot reuse another connection's cached resources or pending result; secrets never enter webview messages, exports or logs.

### R02 — Catalog and capabilities (MVP)
Discover actual available models through verified provider contracts, not a hardcoded marketing list. Support pagination/cache freshness and accurate unavailable states. Represent streaming, tool calls, structured outputs, images, embeddings and usage as supported/unsupported/unknown with provenance. Acceptance: unavailable discovery is not an empty-success list; unknown capabilities do not unlock dependent controls; endpoint changes invalidate stale capability data.

### R03 — Playground (MVP)
Select a supported model, edit system/user messages and supported parameters, stream a response, cancel and retry safely. Keep pending runs bound to their originating connection/model/prompt revision. Handle partial output, throttling, network failure and unsupported parameters. Acceptance: cancellation stops local processing and reports provider cancellation uncertainty honestly; late output does not replace another experiment; region/data destination remains visible before send. Multimodal inputs are deferred until capabilities and data consent are verified.

### R04 — Save and export (MVP)
Version saved prompt/settings without credentials; export runnable Python and TypeScript examples using external secret references. Acceptance: exported code runs outside the extension; existing files and manual edits require diff/review before overwrite; saved, generated and actually executed states are distinct.

### R05 — Resource browsing (MVP)
Read-only dedicated deployment and endpoint views filtered to selected project/region, with refresh, pagination and permission/error states. Acceptance: changing scope invalidates stale results; no create/update/delete side effect from navigation; last-known status is labeled stale during failed refresh.

### R06 — Portable agent specification (phase 2)
Versioned validated specification for connection reference, prompt, parameters, output schema, tools, retrieval, runtime and evaluations. Acceptance: round-trip read/write and schema validation tests, unsupported-version errors, no embedded secrets, and existing edits preserved.

### R07 — Local runtime and tools (phase 2)
Stakeholder-selected Strands Python SDK inside a thin HTTP runtime; reuse its agent loop with verified pre-effect policy hooks, bounded execution, timeouts, cancellation and normalized events. Explicit Scaleway transport/external credentials; no provider fallback or duplicate custom orchestration loop. MCP server launch requires Workspace Trust and explicit approved configuration. Acceptance: injected tool output cannot grant authority; budgets/steps enforced; revocation stops new actions; unknown external effects are reconciled before retry; untrusted projects cannot execute workspace code.

### R07a — Validated JSON output and bounded correction
Accepted baseline: [ADR 0003](decisions/0003-prompt-json-bounded-repair.md). Request JSON through ordinary model calls, parse strictly and validate locally; native Strands structured_output/provider parse shortcuts disabled. Each parse/schema failure supplies normalized, redacted and bounded errors plus the fixed schema and safe previous output for model-only correction. max_retries=5 means six logical attempts maximum; all physical sends including transport retries share a six-send ceiling and parent budgets. No tools or entire agent rerun during repair. Stop on policy/auth/budget/revocation/cancellation/unknown effects; exhaustion is explicit failure, never invalid-output success. Acceptance: deterministic offline tests cover corrected feedback, sixth-send success/exhaustion, no seventh send, strict local-only validation, secret-safe errors, budget/revocation and no native path/tool dispatch; actual Strands guards/live compatibility remain separate checks.

### R08 — Inspector and evaluation (phase 2)
Correlate model/tool events, timings, errors and run identifiers. Dataset evaluation supports versioned cases, deterministic metrics and optional clearly labeled model judges. Acceptance: cancelled/partial/error runs excluded from success totals or explicitly labeled; traces redact secrets and minimize payloads; evaluation concurrency/spend bounded; metrics and judge provenance recorded.

### R09 — Dedicated model deployment (phase 3)
Wizard backed by verified models/node types, permissions and regional availability. Review resources, network exposure, estimated-versus-unknown cost and model EULA before activation. Acceptance: no automatic EULA acceptance; asynchronous state polling, partial-failure reconciliation and cleanup; destructive operations require explicit reviewed scope.

### R10 — Hosted agent application (phase 3)
Package runtime/application, build image, push to selected registry and deploy to validated hosting target. Serverless Containers is a candidate, not guaranteed; persistent sessions must be externalized. Acceptance: deployment contract documents HTTP/streaming duration, state and networking limits; created resource IDs retained; failed provisioning recoverable without blind duplication; hosted playground uses same event protocol as local inspector.

### R11 — Monitoring and cleanup (phase 3)
Provide deployment status/logs and local traces; validate Cockpit trace integration separately. Acceptance: provider acceptance not reported as proven healthy runtime; trace links retain run/project scope; owned-resource cleanup and failure reconciliation tested; no mandatory collection of prompts or documents.

### R12 — Accessibility, security and operational quality (all phases)
VS Code light/dark/high-contrast themes; keyboard-first navigation, descriptive labels, correct focus and zoom. Extension/webview IPC typed and validated, restrictive CSP, output sanitization, least privilege, consent before transmitting workspace data, no unsolicited telemetry. Acceptance: automated tests plus rendered keyboard/theme checks; no untreated critical/high security issue; release build/package tested only under separate release authorization.

<a id="release-slices"></a>
## Release slice boundaries

MVP ends at exported runnable model example and read-only dedicated resources. It does not promise a deployed agent. Phase 2 ends at reproducible local tool-using agent and comparable evaluations. Phase 3 ends at hosted application inspected and removable. Advanced work stays research/backlog until evidence justifies it.

<a id="quality-evidence"></a>
## Required verification evidence

Record unit/integration coverage, fixture versus live-test provenance, model capability versions, error/recovery cases, secret scanning, visual-source approvals where applicable and runtime/deployment evidence. Real account tests require an authorized account and budget; absent access is a blocker, not a passed test. UI approval and prototype QA cannot prove user value or production authorization.
