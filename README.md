# Scaleway AI Toolkit for VS Code

A community extension concept for discovering, testing, building, evaluating and deploying AI applications on Scaleway without leaving VS Code.

**Status:** experimental installable VS Code extension with automatic user browser login (JWT, no API key), project switch and bounded read-only model catalogs and dedicated resource discovery, plus separate offline streaming/cancel and experiment JSON. Real inference, full live-extension verification, production/design acceptance and cloud deployment remain separate gates. Name and branding are provisional; no official Scaleway affiliation is claimed.

## Try the first VSIX

Artifact: `artifacts/scaleway-ai-toolkit-preview-0.0.13.vsix` (generated locally).

```sh
code --install-extension artifacts/scaleway-ai-toolkit-preview-0.0.13.vsix
```

Run **Scaleway AI: Open Offline Preview**, select a synthetic model, then
**Scaleway AI: Ouvrir le playground modèle**. Run/stop and inspect the last experiment in the central editor
from the Command Palette. [Extension instructions and build](apps/vscode-extension/README.md).
The offline demo requires no credentials or Python. Real discovery is opt-in:
Mes ressources -> Projet -> Se connecter à Scaleway in the browser, then scoped project selection and dedicated deployments.
JWT persists via VS Code SecretStorage; organization/project preferences are user-bound; Serverless public offering catalog is available; inference JWT access remains unverified and disabled. No inference or resource writes.

## Product authority

- [Product vision](PRODUCT.md#vision): users, value, scope, evidence and decision ownership.
- [Product specification](specifications/product.md#requirements): numbered requirements and acceptance criteria.
- [Experience rationale and service blueprint](specifications/experience.md#service-blueprint): journeys, backstage lanes, recovery and proposed tests.
- [Design contract](specifications/design-contract.json) and [experience blueprint](specifications/experience-blueprint.json): structurally checkable Product/UX/UI declarations.
- [Architecture and capability boundaries](specifications/architecture.md#architecture).
- [Threat model](specifications/security/threat-model.md), [authorization policy](specifications/security/authorization-policy.md) and [security case specifications](specifications/security/security-test-cases.md).
- [Serverless research](specifications/providers/scaleway/serverless.md), [dedicated API research](specifications/providers/scaleway/dedicated.md) and [proposed comparative protocol](specifications/validation/developer-scenario.md).
- [Offline verification results](evidence/validation/offline-discovery.json) and [acceptance review](evidence/reviews/discovery-review.md).
- [Runtime hosting limits: public documentation and local HTTP tests](specifications/providers/scaleway/hosting.md); cloud streaming/auth/durable sessions remain unverified.
- [Executable Node-to-Python hosting transport spike](tooling/hosting-spike/README.md): extension-host transport checks and bounded cloud proposal; no deployment executed.
- [Selected agent SDK: Strands Python](specifications/decisions/0001-strands-agent-sdk.md): accepted SDK choice, not tested integration or build approval.
- [G1 discovery decision](.gates/01-brief-to-ideation.md): experiment, not validated value or build approval.

## Accepted JSON-output strategy

[ADR 0003](specifications/decisions/0003-prompt-json-bounded-repair.md): ordinary model calls request JSON; strict local parsing/schema validation drives safe error-guided correction, with five retries maximum, shared send/spend limits and no tools during repair. Native structured_output is disabled in the baseline. The [standalone offline helper](runtimes/strands-python/README.md) implements this baseline without SDK dependencies. Beads tracks its acceptance separately from live compatibility gates.

## Repository organization

The [accepted progressive contract-first monorepo](specifications/repository-organization.md) separates the extension, provider adapters and independently runnable Strands runtime around language-neutral contracts. [ADR 0002](specifications/decisions/0002-contract-first-repository.md) records stakeholder approval of organization only. Current-phase entry points: [security](specifications/security/README.md), [Scaleway providers](specifications/providers/scaleway/README.md), [value validation](specifications/validation/README.md) and [evidence rules](evidence/README.md). Executable package trees are deferred until their gates open.

## Work tracking

Beads is the sole implementation task/status authority. Run `bd ready`, `bd blocked`, `bd show <id>`, and `bd prime`. Task descriptions link to the owning specifications; do not maintain a parallel Markdown backlog.

Existing Git/Beads/Entire setup and hooks are preserved. No remote is configured. No commits, pushes, Dolt remote synchronization, recording setup or publishing are authorized by this planning request.

Implementation epic: scaleway_ai_vscode-jgh. Inspect with bd show scaleway_ai_vscode-jgh.
