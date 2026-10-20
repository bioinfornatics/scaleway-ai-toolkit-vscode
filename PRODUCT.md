# Product vision

<!-- impeccable:product-schema 1 -->
Revision: 0.1 — 2026-10-20. Status: stakeholder-requested concept; proposed scope and defaults, not validated user research or implementation approval.

<a id="vision"></a>
## Vision

Enable developers to move from a Scaleway model experiment to a reproducible, evaluated and inspectable AI application from their existing VS Code workspace. Equivalent developer workflows to Microsoft Foundry Toolkit are the objective; literal Azure-service parity and menu cloning are not.

<a id="users"></a>
## Users and shared outcome

Primary responsibility: an AI/application developer must select a model, test a prompt, implement bounded tools, establish application quality and deliver runnable code.
Complementary responsibility: a platform operator must control credentials, deployment scope, spend, execution rights and operational recovery. These are responsibilities, not researched personas.
Shared service boundary: VS Code extension, local generated application/runtime and explicitly selected Scaleway resources. External MCP servers and retrieval backends are separate trust boundaries.
Shared outcome: a working application with reproducible configuration, inspectable runs and identifiable resources that can be cleaned up.

<a id="value"></a>
## Value hypothesis and current alternative

Current alternative (inferred): Scaleway console playground plus SDK scripts, terminal/container commands and separate dashboards. Existing console/SDK capabilities may already be sufficient; compare against them fairly.
Hypothesis: the extension reduces total effort from model selection to useful, reproducible application output, including credential setup, verification, corrections and switching overhead. Frequency, demand, willingness to maintain and measurable advantage are unknown.
Observable first-slice outcome: starting with an authorized account and a VS Code workspace, the developer connects, selects a supported model, completes a streaming test, saves the prompt and runs exported code outside the extension. No secrets appear in workspace files, UI messages or captured logs.
The extension is a deterministic development workbench, not a mandatory coding chatbot. AI is the application/model under test; direct controls remain available. A single impressive response is not quality evidence.

<a id="scope"></a>
## Capabilities and staged scope

Phase 0: verify API contracts, selected Strands Python/Scaleway compatibility, security boundaries, developer value and hosting constraints.
Phase 1/MVP: secure user browser connection, usable model catalog, streaming playground, saved experiments, Python/TypeScript export and read-only dedicated deployment browsing. Current incremental delivery order and acceptance boundaries: [roadmap](specifications/roadmap.md). User-reported invisible installed catalog takes priority over further menu expansion.
Phase 2: portable agent specification, one Strands Python SDK-backed local HTTP runtime, user-approved MCP tools, inspector and evaluations. SDK selection accepted by stakeholder; compatibility and safety unverified.
Phase 3: dedicated model deployment and containerized agent application hosting, hosted playground, status/logs, trace integration and cleanup.
Phase 4: retrieval backends, additional runtimes/providers and fine-tuning only after demand and feasibility are verified.
Non-goals for MVP: Foundry Agent Service compatibility, native Scaleway agent/thread/vector-store claims, fine-tuning, ONNX conversion, Windows profiling, autonomous cloud management, multi-framework runtime parity and marketplace publication.

<a id="principles"></a>
## Product principles and constraints

- Portable outputs: saved specifications and exported code remain useful without VS Code.
- Truthful resources: model deployment is not agent hosting; an object bucket is not a vector search service.
- Capability-aware controls: unsupported or unknown model features are not shown as supported.
- Context before action: make connection, project, region, endpoint and effects visible.
- Bound execution: budgets, steps, concurrency, cancellation and explicit tool mandates.
- Safe defaults: no navigation-triggered execution, secret leakage or automatic billable resource creation.
- Progressive disclosure: native resource trees and task navigation; focused editor workspaces, not a dashboard of equal-weight panels.
- VS Code-native design: theme tokens, native icons/trees, keyboard access, focus management and high-contrast compatibility. No supplied official Scaleway design system or brand template.

<a id="evidence"></a>
## Evidence and confidence

Stakeholder input: request for Foundry-equivalent Scaleway workflows; supplied Foundry feature inventory and sidebar screenshot; explicit request to persist specifications and plan in Beads.
External documentation inspected in the prior analysis: Scaleway serverless OpenAI-compatible inference, Dedicated Deployment API, HTTP/stateless Serverless Containers and Cockpit monitoring. These are documentation findings, not authenticated tests.
Local source inspection: foundry-dev-tools README states Toolkit is closed-source; Canvas is a separate available implementation. Repository MIT license does not cover absent Toolkit source.
Inferences: developers experience cross-tool friction; extension orchestration may reduce it.
Selected direction (stakeholder, 2026-10-20): Strands Python agent SDK; see [ADR 0001](specifications/decisions/0001-strands-agent-sdk.md). Agent creation produces portable application code/config, not presumed native cloud agent resources.
Assumptions: initial users have Scaleway access; selected Strands adapter fits verified model contracts; stateless HTTP hosting may fit Serverless Containers subject to tests. No SDK compatibility test has run.
Unknown: audience size, task frequency, baseline effort, exact feature availability, permissions, quota, prices, hosting timeouts and managed agent service availability. No user studies conducted.

<a id="ownership"></a>
## Ownership and authorization

Decision owner: requesting stakeholder/project maintainer; identity and commercial role beyond this request are not inferred. Agent may prepare documents and Beads planning now. Production coding, visual source approval, participant recruitment, authenticated spikes, paid provisioning, publishing and remote synchronization require their applicable explicit authority.
No automatic telemetry collection; never capture prompts/documents/responses as usage analytics. European hosting is not an automatic compliance guarantee.

<a id="references"></a>
## References

- Local reference: /home/jmercier/Codes/third-parties/foundry-dev-tools/README.md and microsoft-foundry/README.md. Toolkit explicitly not open source; Canvas separately documented.
- https://www.scaleway.com/en/docs/generative-apis/quickstart/
- https://www.scaleway.com/en/developers/api/inference
- https://www.scaleway.com/en/docs/serverless-containers/quickstart/
- https://www.scaleway.com/en/docs/cockpit/
- Stakeholder screenshot: conversation attachment, Foundry sidebar. No local image bytes available to copy; not an approved Scaleway screen source.
