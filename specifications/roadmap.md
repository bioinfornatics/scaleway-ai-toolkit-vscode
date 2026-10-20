# Scaleway AI Toolkit — delivery roadmap

Updated 2026-10-20 23:46 +02:00 from stakeholder Foundry navigation reminder and installed-catalog failure report. **Beads owns tasks, dependencies and current status**; this document owns delivery sequencing and product boundaries, not a parallel task checklist. Experimental VSIX milestones do not close production/value/design gates.

## Immediate delivery order

| Order | Outcome | Beads authority | Acceptance boundary |
|---|---|---|---|
| 1 | Make the real model catalog visible in the installed extension | `scaleway_ai_vscode-jgh.3.22` | Diagnose installed version/command/gate/load/render first; actual packaged host opens catalog with public model entries. Independent dedicated error/empty status; user verifies journey. Adapter-only HTTP success insufficient. |
| 2 | Align implemented navigation with Foundry resources/discovery/build | `scaleway_ai_vscode-jgh.3.23`, depends on `.3.22` | Resources separate from commercial catalog; move synthetic demo to Local Resources; no dead advanced actions. Keyboard/theme/visible host verification. |
| 3 | Default-project selector and reviewed project-creation design | `scaleway_ai_vscode-jgh.3.24`, depends on `.3.23` | Switch project via organization name and persistent default; Create project requires separately scoped write implementation/confirmation. Planning grants no cloud writes. |
| 4 | Complete capability-aware model catalog and read-only explorer | existing `.3.3`, `.3.6`, connection `.3.2` | Reuse recorded routes, shapes and contradictions; provenance/lifecycle/unknowns, cache invalidation, IAM and returned endpoints. Existing production dependencies remain. |
| 5 | Real streaming Model Playground, saved experiments and runnable exports | existing `.3.4`, `.3.5`, acceptance `.3.7` | Verified user-token inference transport, selected model and explicit bounded spend; cancellation, usage/cost uncertainty, secrets absent from exports. Current playground remains synthetic. |

## Catalog incident and existing API knowledge

Stakeholder reports at 23:46 that catalog is still not visible through the extension. Latest generated artifact is 0.0.13; the installed version and exact failure path were **not independently verified**. Do not assume version mismatch or IAM failure. `.3.20` closure records implementation/public-adapter evidence, not accepted user-visible catalog journey. `.3.22` tracks the regression explicitly.

Reuse the detailed observations already in `.3.3`, `.3.6`, `.1.2`, `.1.3`, and scoped transport notes in `.3.2`:

| Source / route | What it establishes | What it does not establish |
|---|---|---|
| Stakeholder console GET `/product-catalog/v2alpha1/catalog?currency=EUR&language=fr_FR&organization_id=<org>&service_categories=generative_apis` | Observed `generative_apis.models[]`, `api_id`, model-specific capabilities/lifecycle and regional SKU price leaves. Detailed extracted inventory retained in `.3.3`. | Complete official schema, captured auth headers, current live JWT acceptance; 31 vs console12 remains unresolved. Not identical to public products route. |
| Official SDK public GET `/product-catalog/v2alpha1/public-catalog/products?product_types=generative_apis&region=fr-par&page=N&page_size=100` | Public unauthenticated route verified; actual preview adapter grouped 33 product names from SKU variants. Sources/evidence below. | Account inference access, invocation IDs or complete console capability/price projection. |
| Dedicated GET `/inference/v1/regions/fr-par/models?order_by=created_at_desc&project_id=<project>` plus source-derived paging filters | Model catalog with UUID/variants and node support; zero-project sentinel observed in prior data. | Deployment existence, hardware stock/quota or blanket foreign-project permission; current extension JWT acceptance remains unverified live. |
| GET regional `/deployments` and returned embedded endpoints | Existing selected-project resources, separate from model catalog. | Endpoint reachability or hosted agent service; do not fabricate URLs or standalone endpoint list. |

Evidence references: `evidence/documentation/scaleway-model-catalog-v1.json`, `evidence/validation/public-model-catalog-adapter-v1.json`, `evidence/validation/vscode-real-catalogs-preview-v13.json`, source snapshots under `evidence/schemas/`. Read prior Beads notes before any new API research. Never reconstruct them as original raw captures. No token/cookie/credential extraction from the installed session.

Code inspection identifies **hypotheses, not a proven incident cause**: `openCatalog` is behind the account/project gate, waits for public and dedicated discovery before opening QuickPick, and loading returns early while busy. A standalone public-adapter check does not exercise those paths. Prioritize exact command/host evidence and isolated failure scenarios; make public catalog review resilient to optional dedicated failure. No unrelated hosting spike.

## Foundry-aligned target navigation

The stakeholder inventory is a functional reference, not permission to copy proprietary code or claim Azure service parity. Show only implemented useful actions in the delivered VSIX.

| Section | Target action/resource | Current or planned delivery |
|---|---|---|
| Mes ressources | Définir le projet Scaleway | Account-bound default; switch selector `.3.24`; browser login triggered when necessary, no standalone login row. |
| Mes ressources | Modèles / Serverless / Déploiements dédiés | Project-access/resource context distinct from discovery offers. Availability unknown must remain explicit. |
| Mes ressources | Récents, Ressources locales | Saved/recent experiments and synthetic local demo; `.3.23` layout, `.3.5` durable experiments. |
| Mes ressources | Agents, Outils, Connaissances, Évaluations | Phase2 or later; expose only with implementations below. |
| Découvrir | Catalogue de modèles | Visible catalog first `.3.22`, capability-aware completion `.3.3`. |
| Découvrir | Catalogue d’outils | `.4.3` approved MCP configuration/policy; not implemented yet. |
| Construire | Playground modèle | Existing offline central editor; real model route `.3.4`. |
| Construire | Créer un agent, Inspecteur d’agent | `.4.1/.4.2/.4.4/.4.5`, Strands Python, not native Scaleway agent service. |
| Construire | Déployer sur Scaleway, Playground agent hébergé | `.5.1` dedicated model deployment is distinct from `.5.3/.5.4` hosting our agent application. |
| Surveiller | Status, logs and validated traces | `.5.5`, sanitized and evidence-backed Cockpit integration. |
| Aide et retours | Getting started, documentation, meaningful feedback | Public help accessible without login. No invented public support/release destination. |

Project creation is not model deployment. Both require explicit scoped cloud-write approval; navigation/click alone never authorizes creation. Classic has no current Scaleway counterpart. Model Conversion and Fine-tuning are reference inventory, not implicit promises.

## Later stages and retained gates

- Model-first MVP: connection, usable catalog, bounded real playground, saved experiments, Python/TypeScript exports, read-only resources. No Strands installation prerequisite.
- Optional reviewed dedicated model deployment: `.5.1`; existing approved sequencing before `.4.1` retained without moving IDs/parents or claiming write authority.
- Phase2 local agents/tools/inspection/evaluations: `.4.*`; portable app/spec, bounded runtime and tools.
- Phase3 hosted applications/cleanup/monitoring: `.5.2`–`.5.6`; hosting spike scope/budget/image gates remain separate.
- Phase4 evidence-led Knowledge/retrieval, fine-tuning and additional providers: `.6.*`.
- Production/value/design acceptance remains `.2.5`, `.3.1`–`.3.7`; experimental issue closures are not blanket approval.

## Evidence language

Use four separate statements: implemented in source, tested with fixtures, verified in packaged Extension Host, verified by user/live account. Do not substitute one for another. Catalog invisibility is unresolved until its own acceptance evidence is recorded. Current request authorizes roadmap/Beads planning, not authenticated account calls, inference or cloud writes. Local commits remain allowed by standing instruction; no push or remote sync.

## Incremental follow-through — 2026-10-21

.3.22 implementation/packaged-host slice completed: catalog editor opens immediately,
public offers load independently from account/trust/storage/dedicated work, trust
and errors are visible states. Actual packaged command returns33 public offers;
original user-specific failure path not uniquely identified. Visual/manual user
acceptance remains explicit follow-up, not claimed from adapter/host alone.

.3.23 source navigation implemented in0.0.15: project/models/recent/local resources,
discover catalog/build playground. Full visual/theme/keyboard acceptance remains
open. .3.24.1 delivers default-project chooser and guarded creation design;
.3.24 full production/creation scope remains open, no cloud writes authorized.
