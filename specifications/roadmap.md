## État courant — améliorations apps après revue 2026-10-22

Le registre historique LocalResources a été retiré : la découverte workspace
LocalInventory possède la liste locale. Les destinations de création externes
restent permises ; l'ouverture explicite du projet ne dépend d'aucun enregistrement.
Les handles IAM stables, invalidation SecretStorage, statuts de scan complets/incomplets,
annulation bornée des écritures et purge playground sont vérifiés localement.
Le build récursif et le gate VSIX final isolé préparent des refactors ultérieurs,
pas une migration massive déjà livrée. Les suites arrêtées restent opt-in ; les
12 wheels Python prouvent installation/configuration, pas intégration SDK/DeepEval.
Le plan et la matrice exhaustive d'actions sont rattachés aux Beads .3.23.39–.43 ;
installed/native/live/whole-product restent séparés des preuves locales.

# Scaleway AI Toolkit — delivery roadmap

## Mise à jour — rationalisation 2026-10-22

Les anciens générateur portable, politique MCP non raccordée, moteur futur de
création dédié et sondes de recherche ont été retirés du produit. Les anciens
rapports et sections historiques ne décrivent pas ces chemins comme actifs.
Le parcours courant utilise LocalCreation/composeAgentProject, les accès IAM
vérifiés et deployService avec journal/reconciliation. Le runtime Python reste
expérimental et séparé, sans liaison au host. Les checks de sources sont des
tests documentaires, pas des preuves de disponibilité ou de runtime.


Updated2026-10-21 for configurable selected-model playground and session coordination. **Beads owns tasks, dependencies and status**; this document owns delivery sequencing and product boundaries. Historical milestones below are dated records, not current executable instructions. Local/mock, packaged-host, visual, live-account and production acceptance are different levels.

## Local resource inventory correction — stakeholder 2026-10-22 00:22

jgh.3.23.13: Ressources locales → Agents / Tools lists detected local projects from workspace roots in a central table, no longer opens creation/templates immediately. Top-right + Créer un agent / + Créer un outil opens Construire createAgent/createTool (template chooser + generation). Cloud inventory create buttons first route local inventory; its create buttons route Build. Mes templates retains project/global library.

Read-only marker discovery (agent.json/agent.authoring.json/agent.py; tool.py/server.py) includes root and depth3 descendants, max256 dirs/8192 entries; excludes .git/node_modules/.venv/dist/.scaleway-ai and symlinks. Markers are candidates, not validated/runtime/deployed claims. Partial scans/errors distinct from empty. Native editor open rechecks trust, scope and marker identity; same-user path races remain. No code content persistence or execution. Installed visual acceptance remains open; systematic VSIX generation applies.

## Deployed-resource navigation correction — stakeholder 2026-10-22 00:04

Mes ressources → Agents / Tools owns **deployed Scaleway services**, never generated local-project inventory. Slice jgh.3.23.11 replaces the incorrect local-inventory destination with a central deployed-resource page and top-right + Créer un agent / + Créer un outil buttons routing to Ressources locales → Agents / Tools. The create action prepares local code only, never deploys. Local generated projects remain implementation data for future local resource management, not cloud inventory.

Current cloud agent/tool listing adapter and service classification are absent. The page explicitly says inventory unavailable/non-loaded, not verified zero deployed resources. Follow-up jgh.5.3.5 owns source-backed project/region service reads and approved identity mapping; do not count every container, dedicated model or local project as an agent/tool. No native Scaleway agent API is presumed. This UI correction performs no cloud reads; installed visuals/full deployed inventory acceptance remain open.

## Agent/tool/template creation implementation — stakeholder authority 2026-10-21 22:33

Current user approved local implementation plus project/global origin labels and project precedence on same template ID. Parent outcomes remain separate from delivered leaves. New local creation route opens from Resources locales → Agents/Tools or Construire → Créer un agent/tool. Mes templates shows merged project/user libraries plus predefined source separately; workspace roots ordered first, user last, first valid ID wins. User home means the Linux extension-host home (including remote Linux host), not browser home. Unsupported OS fails closed; non-file workspace schemes are not used as local filesystem paths.

Historical checkpoint (superseded by the current sequencing above): strict bounded version-1 template envelopes (distinct from portable agent contract 1.0.0); read-only safe discovery; native JSON drafts, bounded import, confirmed exclusive template creation and native editing; preview and confirmed exclusive project materialization, preserving edits. Identity-only tracked local-resource inventory routes Mes ressources Agents/Tools to native editors. Unknown custom template layouts can be created but may fail registration: files retained, no automatic retry or execution. Trust and stale scopes checked after asynchronous UI steps. No model-local option.

Agent source creation includes evidence-profile-pinned Strands Python mapping, external credentials and editable instructions/model authoring note. A bare model ID does not fabricate capability/endpoint/scope provenance: it creates incomplete agent.authoring.json, not an execution-ready portable spec. Full model-reference generation can produce actual contract schema with content revision; offline general validator rejects unsupported versions, duplicate keys, nonfinite/unsafe integers, depth/byte limits, malformed revisions and screened credential literals. It does not grant endpoint/execution authority. Model/endpoint broker integration remains jgh.4.1/.4.4 acceptance.

Runtime dispatch, authenticated loopback lifecycle and MCP policy modules are offline candidates only: in-memory ledgers/registries and synthetic/injected clients; no durable broker, complete runtime/SSE integration, host launch or real Run/Stop acceptance. Do not expose real agent execution controls from these mocks. jgh.4.2/.3/.4.4.2/.4.7 remain incomplete; no installs, tools, paid inference or cloud actions performed or implicitly approved by generation. No deletion/automatic overwrite; native-editor saves have no atomic save-time protection. Directory fd/identity checks reduce replacement races but do not eliminate same-user mkdir/lstat races or make staged publication atomic. Failed writes may leave partial new files for review.

Current local and mocked checks must be recorded against exact candidate; installed visual/keyboard remains jgh.3.23.1, agent end-to-end remains jgh.4.7. Old descriptive-preview implementation/evidence below is historical, not proof of the current integrated workflow.

## Historical local resources and templates — stakeholder revision 2026-10-21 22:23

Slice jgh.3.23.7: **Mes ressources → Projet / Modèles / Agents / Tools / Ressources locales (Agents, Tools) / Mes templates (Agents, Tools) / Récents**. No local model entry in the MVP; the synthetic demo remains accessible from developer actions, not a local model inventory. This supersedes the local submenu below.

Local Agents/Tools open intermediate pages inspired by the supplied Foundry Create Agent screen: predefined bases and personal-template source. Currently descriptive previews only (Strands Python, Strands with tools, Python function, MCP tool): selection opens a descriptive preview; generation, installation and execution are explicitly pending. Personal-template storage locations are now approved (see below); discovery/merging and CRUD implementation remain deferred. Actual selectable scaffolds/runtime remain jgh.4.1/.2/.4; do not confuse descriptive template selection with a generatable scaffold. Opening these pages has no filesystem or network effects. Installed visual/keyboard acceptance remains jgh.3.23.1.

Storage decision **approved by stakeholder 2026-10-21 22:32, not implemented**: merge project and user-global libraries in Mes templates. Agents: `<workspace>/.scaleway-ai/templates/agents/*` + `~/.scaleway-ai/templates/agents/*`. Tools: `<workspace>/.scaleway-ai/templates/tools/*` + `~/.scaleway-ai/templates/tools/*`. Project templates remain portable and optionally Git-versioned; global templates are reusable across projects. Keep predefined templates as a separate source from this personal-library union.

Proposed, **not yet approved**: display origin (Projet / Utilisateur) and prefer the project version when stable template IDs collide; discovery must never silently overwrite either file. Resolve identity/schema, collision handling, multi-root and local/remote home semantics, imports and workspace trust before implementation. Secrets remain outside templates; discovery/selection does not authorize template execution or paid inference. No directory creation, filesystem discovery or runtime change is delivered by recording this decision.

## Historical navigation and local-first agents — stakeholder revision 2026-10-21

Navigation slice jgh.3.23.6.1/.2: **Projet → Modèles → Agents → Ressources locales → Récents**. Modèles is a leaf opening a central overview, without Serverless/Dédiés submenus. It contains workspace-selected Serverless references (inference access unverified) and existing dedicated deployments, not commercial catalogue offers. Agents follows immediately and currently shows a visibly pending journey, not functional Create/Run/Deploy controls. Opening these overviews does not fetch cloud resources.

Agent target: editable **Strands Python code → explicit model/endpoint configuration → local test → guided image publication and Serverless Containers deployment → playground of the existing hosted service**. Local execution is not offline inference: a remote model call can incur cost and needs its own authority. Container Registry is a hidden implementation detail, not the initial agent inventory. A dedicated model remains a model; the container hosts agent logic, not necessarily model weights. Secrets stay outside code/images; image identity, service ownership, costs and cleanup must be explicit before cloud actions.

Local schema/scaffold/runtime/UI work is split under jgh.4.1/.2/.4; packaging and cloud planning under jgh.5.2/.3/.4. No Docker build, image push, live inference or deployment is authorized by navigation work. Cloud approval jgh.5.3.3 remains blocked; installed visual/keyboard acceptance remains jgh.3.23.1. Earlier target tables below retain historical context and do not override this revision.

## Current execution checkpoint — 2026-10-21, backlog reduction

- Current user authority: continue roadmap development locally; no cloud, key effects, deployment, commit/push/Dolt sync or Entire mutation. Playground testing explicitly stopped by user at14:45; do not resume from broad backlog requests without explicit reauthorization. User plans to test live personally later.
- 398.6.1 and ahh closed for corrected installed Serverless mock acceptance only (328 tests); 398.6.2 still blocked, 398.6.3 not run. Local acceptance does not close parent requirements.
- 398.4.1/.2 closed for local dedicated policy/transport/native-consent code mocks (451 tests). 398.4.3 records24 installed mock checks; additional interrupted QA artifacts are not assumed accepted. Parent398.4 remains open, testing halted. Evidence: dedicated-playground-installed-398.json.
- Current primary398.5: .1 format/standalone exports and .2 source/native-file actions implemented. Independent code review found Unicode/status-cost/bounded-read defects, corrected under .3 with26 isolated data/file/export tests and typecheck passing; independent re-review and UI/installed evidence remain open. No playground tests rerun. Evidence: real-experiments-398-5.json.
- Next: finish narrow correction review398.5.3 without playground execution; retain398.5 full acceptance until required evidence exists. Review remaining MVP requirements against delivered evidence, not blanket parent closure. Live/production/design/participant/advanced release gates remain distinct.
- Historical baseline and delivery order below are retained for context; this checkpoint governs current work. Current save/export source is newer than the previous installed VSIX.

## Current baseline — 2026-10-21

- Source package version0.0.37; artifacts/scaleway-ai-toolkit-preview-0.0.37.vsix exists from previous catalogue delivery. Its existence does not prove it includes the current uncommitted playground changes. Rebuild/hash in isolated installed QA before claiming current package validation.
- Catalogue/actions/resources separation and reviewed dedicated creation code already exist; no new paid deployment authorized here.
- 398.1/.2/.3 complete for source-backed/local mocked acceptance: real Serverless text transport, prompt/output cap, Run/Stop, streaming/partial/errors/scope isolation and conditional usage/cost. 320tests/typecheck/Biome/diff-check recorded in artifacts/validation/service-playground-configurable-398.json.
- Model identity is configurable, no Mistral whitelist or per-model live-test prerequisite. Declared non-chat-only operations/entirely retired offerings blocked; missing/conflicting capability data permits explicit basic chat trial with warning. No model fallback.
- Use/resources preserve capabilities/prices in memory; persistence is identity-only. Model playground does not require/start Strands Python.
- Current implementation installed visual QA and new cloud inference are not_run. Existing catalogue evidence and historical representative smoke do not verify the new installed transport.
- Workspace mixes pre-existing uncommitted deliveries. No commit/push or remote sync authorized by this coordination update.

## Immediate delivery order

| Order | Outcome | Execution / acceptance authority | Boundary |
|---|---|---|---|
| 1 | Verify actual installed selected-model playground locally | 398.6.1; aggregate398.6, R03 owner jgh.3.4 | Isolated VS Code, synthetic scope and mocked inference, actual host/webview + visible/keyboard/theme evidence. Coordinate jgh.3.23.1; no account traffic. |
| 2 | Validate representative Serverless inference from installed extension | 398.6.3 blocked by localQA398.6.1 and approval398.6.2 | Exact project/model/executor/physical-call cap/output cap/monetary budget/secure delivery/stop rules required. Common contract, not all models. msz key effects need separate approval. |
| 3 | Complete selected dedicated endpoint invocation | 398.4; acceptance jgh.3.4 / dedicated jgh.5.1 | Endpoint binding, network/TLS/auth and parameter policy, mocked transport/UI first. No arbitrary endpoint/fallback/inferred reachability; live authority separate. |
| 4 | Save and export real experiments | 398.5; acceptance jgh.3.5 | Separate real/partial/error format from offline, safe persistence and independently runnable Python/TS mock-verified examples without secrets. Split leaf tasks when starting. |
| 5 | Close whole MVP acceptance, not incremental-code checkboxes | jgh.3.2/.3/.4/.5/.6/.7, navigation jgh.3.23.1, key verification msz | Existing requirement/security/accessibility/IAM/participant/production gates retained. Experimental slices do not close whole stories/phases. |

Orders recommend sessions, not blanket dependency rewrites. Dedicated/export local work can proceed when its own technical prerequisites are met; unrelated cloud approval must not block offline implementation.

## Coordination and acceptance ownership

398 is a delivery epic under jgh.3, not an executable task. Historical phase IDs remain stable. jgh.3.4 owns streaming/recovery acceptance;398.2/.3/.4 implement it. jgh.3.5 owns R04;398.5 implements real save/export. jgh.3.7 owns MVP;398.6 contributes installed/live evidence. Related links avoid duplicate work without inventing blockers.

398.6 children: .1 installed localQA, .2 blocked human authorization, .3 live execution depends on both. msz is blocked pending its own key/read/revoke mandate, not implicitly part of .2. bd ready does not grant cloud authority; inspect scope and use local-only filter.

Workflow: [Beads / Entire coordination contract](coordination.md). Durable handoff/session/checkpoint links live in Beads, no parallel markdown task/MEMORY file. Session20261021_9 has pending work; no new checkpoint created for this implementation.

## Historical milestones — dated evidence, not the next-work queue

Below, “playground synthetic”, “latest0.0.25”, “planning only” and historical commit permissions apply to their original record, not the current baseline above. Current user/repository authorization wins.

### Initial catalogue delivery order (historical)

Earlier delivery prioritized visible catalogue jgh.3.22, navigation jgh.3.23 and project selector jgh.3.24. Reuse their evidence and preserve outstanding visual/IAM/full-product acceptance; do not reimplement delivered catalogue or restart discovery.

## Catalog incident and existing API knowledge

Stakeholder reports at 23:46 that catalog is still not visible through the extension. Latest generated artifact is 0.0.13; the installed version and exact failure path were **not independently verified**. Do not assume version mismatch or IAM failure. `.3.20` closure records implementation/public-adapter evidence, not accepted user-visible catalog journey. `.3.22` tracks the regression explicitly.

Reuse the detailed observations already in `.3.3`, `.3.6`, `.1.2`, `.1.3`, and scoped transport notes in `.3.2`:

| Source / route | What it establishes | What it does not establish |
|---|---|---|
| Stakeholder console GET `/product-catalog/v2alpha1/catalog?currency=EUR&language=fr_FR&organization_id=<org>&service_categories=generative_apis` | Observed `generative_apis.models[]`, `api_id`, model-specific capabilities/lifecycle and regional SKU price leaves. Detailed extracted inventory retained in `.3.3`. | Complete official schema, captured auth headers, current live JWT acceptance; 31 vs console12 remains unresolved. Not identical to public products route. |
| Official SDK public GET `/product-catalog/v2alpha1/public-catalog/products?product_types=generative_apis&region=fr-par&page=N&page_size=100` | Public unauthenticated route verified; actual preview adapter grouped 33 product names from SKU variants. Sources/evidence below. | Account inference access, invocation IDs or complete console capability/price projection. |
| Dedicated GET `/inference/v1/regions/fr-par/models?order_by=created_at_desc&project_id=<project>` plus source-derived paging filters | Model catalog with UUID/variants and node support; zero-project sentinel observed in prior data. | Deployment existence, hardware stock/quota or blanket foreign-project permission; current extension JWT acceptance remains unverified live. |
| GET regional `/deployments` and returned embedded endpoints | Existing selected-project resources, separate from model catalog. | Endpoint reachability or hosted agent service; do not fabricate URLs or standalone endpoint list. |

Evidence references: `specifications/references/documentation/scaleway-model-catalog-v1.json`, `specifications/references/validation/public-model-catalog-adapter-v1.json`, `specifications/references/validation/vscode-real-catalogs-preview-v13.json`, source snapshots under `specifications/references/schemas/`. Read prior Beads notes before any new API research. Never reconstruct them as original raw captures. No token/cookie/credential extraction from the installed session.

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


## Model availability → deployment → use — stakeholder clarification 2026-10-21

The user observes rendered model cards and expects dedicated models to be
deployable, not merely described. Version 0.0.20 separates Serverless public
offers, dedicated catalog models and existing deployments in native navigation.
Catalog-ready is not deployed; deployed is not necessarily ready/reachable.
Reuse .5.1 source/console findings rather than restarting generic discovery.
The next implementation slice is a dedicated deployment preparation wizard with
offline tests, followed by reviewed allocation and endpoint use. Exact model UUID,
node compatibility/quantization, stock/quota, dedicated hourly price, EULA,
project/fr-par, network and spend cap must be explicit before creation.
No automatic allocation, license acceptance or retry after an ambiguous POST.
The stakeholder requests the feature, not an unspecified billable allocation.
Production acceptance and real-inference authorization remain separate.


## Autonomous implementation mandate — 2026-10-21 00:49

User requests implementation of the Beads roadmap, not more planning-only work.
Local implementation/fixture tests/package/necessary local commits are authorized;
paid allocation, license acceptance, live account execution and publication still
require their own explicit bounded confirmation. Do not call a research/design/
participant/production gate completed merely because its code slice exists.

Version 0.0.21 implements the native dedicated preparation wizard under .5.1.1:
source-backed model compatibility and regional node inventory, one-node candidate,
IAM-only endpoint intent, exact decimal user ceiling, non-executable local plan,
cancellation/session invalidation. This is preparation, not deployment creation.
Next independent implementation slice: enrich existing deployment explorer with
validated provider-returned model linkage/endpoints, then portable saved outputs.


Version 0.0.22 adds one-GET existing deployment details with returned endpoints,
network/auth and fetch timestamp; no probe or inference. Version 0.0.23 adds
explicit local experiment save/import and independently runnable offline replay
exports, plus reviewed vsce4 tooling (audit zero). Version 0.0.24 strengthens the
installed catalog test: actual webview JS/DOM reports 17 rendered active public
cards from33 raw offers, no account authentication. This closes the missing renderer
proof, not visual/theme/keyboard or user-specific service worker root cause.


Version 0.0.25 implements guarded project creation (.3.24.2): named organization,
explicit final name/effect confirmation, one fixed POST, no retries, validated
success-only default and uncertain-outcome handling. Agent cloud writes remain0;
actual provider JWT/IAM acceptance not_run. This adds executable code behind a
user-confirmed action, not a blanket resource/spend mandate.


## Current delivery and remaining acceptance — 0.0.25

Latest testable artifact: artifacts/scaleway-ai-toolkit-preview-0.0.25.vsix.
79 tests and strict TypeScript/Biome gates pass; npm audit reports zero findings.
Isolated installed packaged host1.142.0 confirms actual webview ready/rendered and
17 active public cards from33 raw offers, no account authentication. Details:
specifications/references/validation/vscode-project-creation-v25.json.

Implemented increments (Beads children closed for these exact slices):
.5.1.1 deployment preparation, .3.6.1 deployment/endpoint explorer,
.3.5.1 explicit saved offline experiments and independently executed replay exports,
.3.26 dev tooling audit fix, .3.27.1 real packaged renderer acknowledgement,
.3.24.2 user-confirmed project creation code. No actual agent account/cloud write.

Remaining release boundaries are not treated as missing-code checkboxes:
- .3.23/.3.23.1 visual, keyboard, zoom and themes in real VS Code;
- .3.2 current-user keyring/session/IAM cross-org acceptance;
- .3.3 complete capability/invocation/price contract from the recorded console route;
- .3.4 user-JWT inference audience/streaming transport and bounded send consent;
- .5.1 dedicated price/quota/EULA and creation/reconciliation execution after exact
  project/model/node/network/budget authority (preparation is not allocation);
- parent .3.5/.3.6/.3.7 real-model exports/reachability and production acceptance;
- advanced .4/.5 hosting and .6 research retain approved sequencing and external gates.
Code behind project creation is explicit and testable, but live JWT/IAM conformance
has not been observed. The full roadmap is not declared completed.


## Journey-oriented coverage — stakeholder reference 2026-10-21 01:09

[Eight-journey mapping](functional-reference-foundry.md#eight-outcome-oriented-journeys--stakeholder-reference-2026-10-21-0109)
now binds the supplied Foundry examples/source links to the existing Beads tasks.
This is stakeholder reference, not newly verified Azure behavior or Scaleway parity.
The immediate useful outcome remains journey1: actually accessible selected model,
then testing and export, not only a visible catalog. Dedicated preparation cannot
substitute for creation/endpoint use. Journeys2/4 are our local Strands and hosted
application paths; journey3 has no verified native managed prompt-agent equivalent.
Tools, evaluation, inspector/tracing and model optimization retain their specific
contracts and later gates. No dependency or cloud authority was broadened by this
reference update. Existing resources vs actionable developer tools remains the UI
invariant; no dead menu parity.


## Continued model deployment lifecycle — 0.0.26

.5.1.2 implements reviewed payload/state engine with injected-only creation
transport and explicit existing-deployment follow action. Cost/quota/rights/EULA
reviews must be fresh; plans cannot self-authorize. Write-ahead record, single send,
unknown-outcome non-resubmission and accepted-versus-ready tested offline.
Actual allocation transport/UI remains unwired until trustworthy price/quota/EULA
and exact billable confirmation are available. Public SDK source recaptured at
25895fc5; EULA method mentioned but absent from generated file, no guessed route.
Explicit follow performs up to5 GETs with15s intervals; no startup polls or probes.
.5.1 full creation/cleanup/live acceptance remains open; this is not a deployed model.


## Clarification UX validée — 2026-10-21 09:28

Le stakeholder valide Mes ressources comme inventaire réel, non catalogue : Serverless
sélections d’espace de travail si aucune activation provider n’est établie ; Dédiés
services effectivement retournés, y compris en création. Libellés courts, états
contextualisés dans la rubrique. Catalogue central → Utiliser / Déployer / Ouvrir
existant → ressource mise à jour → playground ; actions techniques dans les détails.
Version0.0.36 implémente la séparation, le chemin de création dédiée confirmé et le
suivi borné. Le playground réel reste contexte uniquement, transport d’inférence à
livrer séparément (.3.4), jamais substitution par une démo. Beads6kv owns this slice.
Prix public et période corroborés, licence acceptée par l’utilisateur, IAM/quotas
contrôlés par le provider à la création ; aucune prétention de validation live.
