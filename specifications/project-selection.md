# Project selection and guarded creation

## Implemented preview selection

Définir le projet Scaleway opens a native chooser with Changer de projet. This initiates browser login when needed, lists linked organizations by name via IAM connections, lists scoped projects, and saves a user-bound default. Cancelling does not create or modify cloud resources. The direct Switch project command remains available. Creation is explicitly unavailable, not a dead functional action or console-link substitute.

## Planned creation contract — not execution authority

Existing source snapshot projects-go-account_sdk.go describes POST /account/v3/projects with name and organization_id. Before implementation validate current SDK route and wire shape/error contract. The wizard must select an existing authorized organization, collect a validated project name, show exact account/organization/name and effect, and require a final explicit Create project confirmation. No IAM privilege escalation, auto-key creation or inferred write mandate.

Only a successful response with validated returned project id/name/organization sets the default. Store only metadata in account-bound globalState. An ambiguous timeout/connection loss after dispatch is an unknown outcome: no automatic POST retry. Any reconciliation uses a separately bounded reviewed GET; a name match alone cannot prove ownership or uniqueness. Keep the previous default on failure/ambiguity. Disable double submits. Do not call the provider during tree expansion or startup.

Authentication expiry, logout, project switch and trust revocation must invalidate pending results. Any returned mismatch is rejected, not adopted. Tests must cover duplicate/ambiguous outcomes, IAM denial, cancellation before/after send, expired JWT, stale result/default assignment and absence of secrets. User confirmation of one creation does not authorize deletion, further resource creation or inference.

Beads .3.24 owns full selector/creation scope and production prerequisites; .3.24.1 owns the implemented chooser plus this creation design subset. No cloud writes have been performed.


## Implemented creation slice — 0.0.25

The previously unavailable creation action is now wired to a fixed-origin,
fixed-path, single POST transport after final native confirmation. Source:
evidence/schemas/projects-go-account_sdk.go CreateProjectRequest/CreateProject;
body name/organization_id/description. User-token control header reuses the pinned
SDK JWT mapping. No default provider organization/name, retries, redirects or IAM
escalation. Unknown outcomes preserve the previous project. Trust/session invalidation
during preference writes rolls back local defaults; no automatic cloud deletion.
Transport and controller tests cover malformed/foreign response, denial/server error,
after-send abort, final-confirmation cancellation and stale defaults. No live creation
has been executed; parent .3.24 retains production/IAM/design acceptance.
