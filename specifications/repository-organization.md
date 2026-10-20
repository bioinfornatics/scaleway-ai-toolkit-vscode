# Repository organization

Accepted organization: [ADR 0002](decisions/0002-contract-first-repository.md). This document describes ownership and structure, not task status or implementation approval. Beads is the work authority.

## Progressive target layout

Directories marked “later” are introduced only when relevant work is authorized; they are not required empty scaffolding.

| Path | Responsibility |
|---|---|
| PRODUCT.md | Vision, value, scope and decision ownership |
| specifications/ | Requirements, architecture, UX, security, provider synthesis and ADRs |
| .gates/ | Approval records; no credentials; organization approval does not satisfy other gates |
| .beads/ | Sole task/status and durable project-memory authority |
| evidence/ | Sanitized, reproducible documentation/schema/capability/compatibility findings |
| contracts/ (later) | Language-neutral agent-spec/v1, runtime-events/v1, runtime-http/v1 and webview-ipc/v1 |
| apps/vscode-extension/ (later) | Extension activation, features, VS Code platform services and webview presentation |
| packages/core/ (later) | VS Code-independent TypeScript state and capability decisions |
| packages/scaleway-adapter/ (later) | Separate discovery, control-plane and inference transports/normalization |
| packages/contract-types/ (later) | Generated TypeScript bindings and validators |
| runtimes/strands-python/ (later) | pyproject.toml, src/scaleway_agent_runtime/ and runtime tests |
| tests/ (later) | Cross-language contracts, offline integration, E2E, opt-in live tests and synthetic fixtures |
| examples/ (later) | Runnable outputs that do not require VS Code |
| tooling/ (later) | Contract validation/codegen and test commands |
| .github/workflows/ (later) | Credential-free CI; separate approved live/release workflows |

Extension features are grouped by outcome: connections, catalog, playground, exports and read-only resources. Each package owns its local tests. Root tests own cross-package conformance and journeys. Python runtime modules separate API, configuration, policy, events and adapters; Strands retains ownership of the agent loop.

## Dependency and trust rules

- Webviews render and send validated IPC only; no credentials, direct provider access or tool execution.
- Extension host owns commands, SecretStorage, scoped connection context and process lifecycle. It calls core logic, provider adapters and a runtime client.
- Core imports neither VS Code APIs nor provider-specific HTTP implementations. Avoid an undifferentiated shared/utils package.
- Provider adapters normalize verified APIs; they do not decide UI behavior or grant authorization.
- Runtime is independently runnable and explicitly configured for approved endpoints/model/credentials; no implicit provider fallback or second agent loop.
- Contracts expose our portable definitions, not Strands objects or raw provider response types. Both languages validate the same examples.
- Extension approval establishes a mandate. Runtime enforcement checks authority, revocation and budgets before each effect. Hosted execution uses an equivalent trusted authorization mechanism.
- Module boundaries are not security isolation. Required process/container isolation, loopback runtime authentication and tool containment are resolved by the threat model and runtime contract work.
- Bind caches, pending requests and events to originating connection/scope/run/spec versions; reject stale or foreign results.

## Current-phase artifact ownership

| Beads task (prefix scaleway_ai_vscode-jgh) | Owning artifacts |
|---|---|
| .1.4 | security/threat-model.md, authorization-policy.md, security-test-cases.md when authored |
| .1.2 | providers/scaleway/serverless.md and evidence/capabilities/ findings when authored |
| .1.3 | providers/scaleway/dedicated.md and evidence/schemas/ snapshots when verified |
| .1.1 | validation/developer-scenario.md when its scenario and comparative criteria are agreed |
| .1.5 | Versioned portable/runtime contracts after its prerequisites |
| .1.6 | providers/scaleway/hosting.md and hosting evidence after its prerequisites |

Assign parallel contributors separate owning files. One integration owner synthesizes results into architecture and ADRs. Add paths to Beads as deliverables are authored; do not duplicate status in Markdown.

## Contract and evidence versioning

Our protocol/spec versions and provider API/schema snapshots have independent lifecycles. Never substitute provider response schemas for the portable agent format. Protocol definitions include compatibility rules, unsupported-version errors, terminal/partial/error/cancellation semantics and unknown usage. Generate bindings where practical; check generated drift and TypeScript/Python conformance in offline tests. SDK releases and source/schema revisions are pinned during verification, not guessed now.

Evidence records follow [evidence rules](../evidence/README.md). Supported/unsupported/unknown capabilities retain endpoint/model/context and provenance; documentation, source inspection, fixtures and live verification are not interchangeable.

## Quality and operational defaults

Default commands and CI are credential-free with no cloud provisioning. Progress through formatting/lint/types, schema and generated-drift checks, unit/offline integration, cross-language conformance, then extension journey/theme/keyboard tests as implementation arrives. Live GET discovery requires account/scope approval; inference requires separate spend approval; writes/provisioning require reviewed effect authority. A skipped live check is not a pass.

Select one TypeScript package manager/lockfile and one Python environment/lock strategy through packaging decisions. No dependencies are installed by accepting this structure. Validate extension packaging and independently runnable exports/runtime under their applicable gates. Defer orchestration tooling, plugin infrastructure, additional runtimes and deployment stacks until justified.
