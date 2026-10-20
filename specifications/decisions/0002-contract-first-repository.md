# ADR 0002 — Progressive contract-first monorepo

Date: 2026-10-20. Decision owner: project maintainer/requesting stakeholder.
Status: accepted by stakeholder response “validated” to the proposed organization.
Beads: scaleway_ai_vscode-jgh.1.7.

## Context
The repository is specification-only. TypeScript extension code and a separately runnable Strands Python application need shared contracts, clear trust boundaries and reproducible provider evidence. SDK choice is accepted in [ADR 0001](0001-strands-agent-sdk.md); compatibility and implementation gates remain outstanding.

## Decision
Use a small monorepo with language-neutral contracts and progressively introduced executable packages. Preserve existing product/specification locations and Beads as the sole task/status authority. Adopt the ownership, dependency and validation rules in [repository organization](../repository-organization.md).

Create current-phase documentation and evidence entry points now. Introduce contract versions through .1.5 and executable packages only when their implementation gates and applicable authorization permit. Do not create empty package trees or speculative runtime schemas.

## Alternatives
A single extension containing orchestration would compromise portability and blur execution boundaries. Separate repositories would add cross-language contract/version coordination overhead at this stage. Microservices, multiple agent frameworks and a generalized provider/plugin platform add unproven complexity and are deferred.

## Consequences
Offline tests are the default. Provider snapshots are distinct from our portable contracts. Generated bindings must conform in both languages. Runtime pre-effect policy is required, but in-process enforcement is not itself a sandbox; isolation requirements remain a threat-model decision. Deployment must not depend on an active extension.

## Approval scope
Approval covers repository organization and documentation preparation, not completion of discovery tasks, portable-contract acceptance, UI/build approval, production implementation, dependency installation, authenticated requests, inference budgets, provisioning, publication, Git commits/pushes or Dolt remote sync.
