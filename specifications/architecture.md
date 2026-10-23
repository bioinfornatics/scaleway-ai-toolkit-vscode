# Architecture and capability contract

Revision 0.1 — proposal, not implemented or deployment-tested.

<a id="architecture"></a>
## Architecture

TypeScript VS Code extension host owns commands, TreeDataProviders, connection context, SecretStorage, API clients, process lifecycle and typed webview IPC. Webviews are presentation only and receive no credentials. Use native VS Code controls where possible; rich playground/builder/inspector in focused editor panels.

Separate inference transport (OpenAI-compatible operations supported by the chosen endpoint) from control-plane APIs (Scaleway projects/deployments/endpoints/registry/hosting). Never infer support for the entire OpenAI API. Scaleway JS SDK versus thin REST adapters is a phase-0 decision based on tested API coverage and packaging.

Versioned portable agent spec -> thin Strands Python SDK-backed local HTTP runtime -> common versioned stream/event protocol -> inspector/evaluator. Strands supplies orchestration; our wrapper supplies portable configuration, credential resolution, pre-effect policy enforcement and normalized evidence, without a duplicate agent loop. Deployment adapters package that runtime without requiring an active extension. A stateless container application must use an explicit session-store adapter if durable sessions are required.

<a id="capabilities"></a>
## Documented versus unverified

| Capability | Documentation finding | Remaining verification |
|---|---|---|
| Serverless inference | OpenAI-compatible service at https://api.scaleway.ai/v1 | Auth, discovery, stream framing, cancellation, model-specific features and usage |
| Dedicated inference | Regional models/deployments/endpoints/node types; documentation identifies fr-par | Actual schema/SDK methods, pagination, IAM, quota, license and async lifecycle |
| Application hosting | Serverless Containers hosts stateless HTTP web applications | SSE behavior, timeout/idle limits, concurrency, network reachability and state |
| Observability | Cockpit supports metrics/logs/traces | OTLP ingestion/query/auth and correlated application trace path |
| Managed agent service | Not verified | Do not promise agent/thread/vector-store APIs; research before claims |
| Retrieval/fine-tuning | Deferred integrations | Backend selection, authorized data, training/runtime support and budget |

The Dedicated Deployment quickstart labels an endpoint-list example as model listing, while later text refers to List Models. Treat generated examples as fallible; verify the downloadable schema and official endpoint definitions rather than copying that inconsistency.

<a id="security"></a>
## Trust and effect boundaries

Detailed controls: [threat model](security/threat-model.md), [authorization policy](security/authorization-policy.md), [synthetic future security cases](security/security-test-cases.md). Threat-model completion defines required controls; it does not establish runtime security. Provider synthesis: [serverless](providers/scaleway/serverless.md) and [dedicated APIs](providers/scaleway/dedicated.md), with pinned source evidence and explicit unresolved live/schema/IAM checks.

Extension host secrets; webview untrusted rendering; workspace code untrusted until Workspace Trust; MCP servers/processes separately approved; remote model output/tool content untrusted; cloud writes billable and independently authorized. Validate IPC and output; redact headers and credential-like strings. Prompt injection must not widen tool policy. Bind results to originating run/spec/scope versions.

Tools may execute within an explicit bounded mandate without approving every loop step. Effect class distinguishes read/view, local prepare, simulated, externally sent/accepted and proven result. After timeout or disconnect, reconcile unknown provider effects before retry; cancellation does not prove rollback. Never assume private-network endpoints are reachable from the local extension.

<a id="decisions"></a>
## Accepted repository organization

Use the [progressive contract-first monorepo](repository-organization.md), accepted in [ADR 0002](decisions/0002-contract-first-repository.md). Extension host, presentation-only webviews, VS Code-independent core, separate provider transports and an independently runnable Strands runtime have explicit dependency boundaries. Our language-neutral contracts are separate from provider schema/capability evidence. Current-phase documentation is organized now; contract versions and executable packages await their existing gates. Organization approval is not compatibility proof or production implementation authorization.

## Proposed choices and rejected alternatives

Standalone extension instead of Toolkit fork: actual Toolkit source absent. Scaleway-first adapters rather than a universal multi-provider workbench: makes initial outcome testable and limits maintenance. Strands Python selected by stakeholder on 2026-10-20 instead of bespoke orchestration or simultaneous framework support; live transport, policy and packaging compatibility remain unverified. See [ADR 0001](decisions/0001-strands-agent-sdk.md). Native editor workspaces instead of standalone web dashboard: preserves current developer context and avoids redundant shell. Serverless Containers candidate instead of claiming managed-agent parity: hosting constraints must be proven. No production services are being implemented in this planning step.

<a id='agent-sdk'></a>
## Accepted output-validation baseline

[ADR 0003](decisions/0003-prompt-json-bounded-repair.md) selects ordinary prompt-requested JSON plus strict local validation and error-guided model-only correction, with five retries and at most six physical sends under shared budgets. Native structured_output/parse paths are disabled in the baseline, not claimed compatible. The offline helper is independent of provider discovery/UI and does not duplicate the Strands agent loop. Actual sender/retry pre-effect enforcement, unknown usage recovery and live compatibility still require evidence.

## Selected agent SDK and responsibility boundaries

Strands Python is selected for agent creation/execution against Scaleway serverless/dedicated inference. Inspected OpenAIModel accepts configurable clients/client_args and uses Chat Completions; this is source-level feasibility, not live compatibility. Pin a verified released SDK version and explicitly configure Scaleway base URL/model/external credentials; no provider defaults/fallbacks.

Create agent means portable project/spec; run means local Strands HTTP wrapper; deploy means host that application on validated compute. Catalog models, dedicated deployments and local/hosted applications remain distinct. No native Scaleway CreateAgent/thread/session service or agent SDK has been established in inspected sources; this is not proof of permanent absence.

Verify tool/stream/structured-output/usage contracts, pre-effect hooks, revocation/cancellation, dependency packaging, external session storage and redacted events. Microsoft 365 Agents SDK supplies channel integration; Microsoft Agent Framework orchestration. Harness² is research harness optimization, not an officially supported Google product; defer it instead of using it as baseline runtime. Detailed decision/sources: [ADR 0001](decisions/0001-strands-agent-sdk.md).


## Model-first and advanced runtime boundary

Stakeholder-confirmed 2026-10-20: the phase 1 model workflow uses extension-host
TypeScript provider adapters for connection, discovery, playground and read-only
control-plane operations; it does not route through or require the Python agent
runtime. Webviews communicate only with the extension host. Generated Python
examples are standalone outputs, not a mandatory extension dependency.

Phase 2 advanced agent creation/execution introduces the separate authenticated
HTTP/SSE Strands runtime client and portable agent contract. Shared event concepts
may be reused, but no Strands-specific objects leak into basic UI/core contracts.
Agent runtime launch and tools remain explicit approved actions, never triggered
by model browsing. .1.5 specifies this boundary, not an earlier agent UI release.

## Accepted delivery sequence — 2026-10-20

Stakeholder confirms: model MVP -> dedicated model deployment (.5.1) -> advanced
local agents (.4.1 onward) -> optional hosted application. Keep existing IDs/phase
labels as historical grouping; the dependency graph carries the approved order.
Serverless remains usable without dedicated deployment. No writes/spend implied.

Contracts: [ADR0004](decisions/0004-runtime-contracts.md),
[runtime protocol](runtime-protocol.md).
