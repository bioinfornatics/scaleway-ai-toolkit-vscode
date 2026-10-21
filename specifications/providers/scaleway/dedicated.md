# Scaleway projects and Dedicated Deployment control plane

> **2026-10-20 update:** Original source review below is historical. See [scoped live evidence and discovery acceptance](../../../evidence/reviews/provider-acceptance-20261020.md). Production, minimum IAM, all-model conformance, deployment and private reachability are not certified.

Verified public-source snapshot: 2026-10-20. Owner: `scaleway_ai_vscode-jgh.1.3`; authority: [architecture capabilities](../../architecture.md#capabilities). **Documentation/source inspection only; no authenticated discovery, inference, provisioning, quota or reachability test.** This is a schema-backed adapter recommendation, not an implemented client or production mandate.

## Evidence and provenance

- [Exact public source manifest](../../../evidence/schemas/dedicated-provenance.json): raw URLs, full commits, retrieval timestamp, bytes and SHA-256 for each upstream snapshot.
- Go SDK commit `46763ab9fc78781eca1af94bd3a83750d3a2068f`: generated `api/inference/v1/inference_sdk.go`, `api/account/v3/account_sdk.go`, handwritten inference wait utilities.
- JS SDK commit `e05f031e8590090311adf028747139fe7b490d59`: generated inference v1 and account v3 API/types/marshalling plus client transport/pagination. Repository package metadata: `@scaleway/sdk-inference` 2.20.3, `@scaleway/sdk-account` 2.16.3, `@scaleway/sdk-client` 2.16.0. These are **source manifest versions**, not verification of published tarballs or installed dependency versions.
- Official docs-content commit `1dd79adcf1f8ccbded698d2776871c21d50bac06`; reviewed source snapshots and contradictions: [dedicated evidence](../../../evidence/documentation/dedicated-review.md), [projects/IAM evidence](../../../evidence/documentation/projects-review.md).
- [Dedicated response shapes](../../../evidence/schemas/dedicated-response-shapes.schema.json), [projects shapes](../../../evidence/schemas/projects-response-shapes.schema.json), [operation inventory](../../../evidence/schemas/dedicated-read-operations.source-derived.json) are **source-derived partial schema extracts, NOT official OpenAPI**. Rebuild with `python3 evidence/schemas/dedicated-extract.py`. Exact source snapshots are retained beside them.

Rendered official API pages returned HTTP 403; an attempted public swagger location returned 404. No successful official downloadable OpenAPI retrieval is claimed. The alternative is verifiable generated SDK sources, not invented schemas. Extracts preserve Go JSON names/types but do not infer requiredness, limits, error contracts or default behavior; unexpanded nested types are unconstrained. Use as evidence, not a production validator.

## Read-only operation contract

Control-plane origin: `https://api.scaleway.com`; IAM secret key in `X-Auth-Token` (JS constant `x-auth-token`). Explicit host-owned connection context supplies organization, project and region; never inherit workspace/cloud-profile defaults implicitly. No secret or provider client belongs in a webview.

| Operation | GET path | Supported query parameters / returned scope | JS coverage |
|---|---|---|---|
| Projects | `/account/v3/projects` | `organization_id`, `name`, `page`, `page_size`, `order_by`, `project_ids`; `projects`, `total_count` | account v3 `ProjectAPI.listProjects` |
| Project detail | `/account/v3/projects/{project_id}` | `organization_id` inside returned Project, not regional | `ProjectAPI.getProject` |
| Dedicated model catalog | `/inference/v1/regions/{region}/models` | `project_id`, `organization_id`, `name`, `tags`, `order_by`, `page`, `page_size`; `models`, `total_count` | inference v1 `API.listModels` |
| Model detail | `/inference/v1/regions/{region}/models/{model_id}` | Model record; no project query in this operation | `API.getModel` |
| Deployments | `/inference/v1/regions/{region}/deployments` | `project_id`, `organization_id`, `name`, `tags`, `order_by`, `page`, `page_size`; `deployments`, `total_count` | `API.listDeployments` |
| Deployment detail | `/inference/v1/regions/{region}/deployments/{deployment_id}` | Deployment record, including `endpoints` | `API.getDeployment` |
| Node types | `/inference/v1/regions/{region}/node-types` | `include_disabled_types`, `page`, `page_size`; `node_types`, `total_count` | `API.listNodeTypes` |
| Private CA certificate, separately approved if needed | `/inference/v1/regions/{region}/deployments/{deployment_id}/certificate` | PEM file/Blob, not JSON list; JS sends `dl=1` | `API.getDeploymentCertificate` |

Only the explicit approved GET subset should be exposed. Endpoint POST/PATCH/DELETE methods exist in SDK sources; they are not authorized here and do not establish a GET endpoint-list operation. SDK defaults, optional request types and generated examples are not permission to omit application scoping.

### Pagination and regions

All four lists use numbered offset pages with `page`, `page_size`, `total_count` (not an assumed cursor). SDK paginator begins at page 1 when omitted. `await list…()` gives a first-page response, not all resources; enriched promises offer `.all()` and async iteration. `.all()` uses `Promise.all` over remaining pages, so do not use it for an unbounded discovery mandate. Explicit sequential pages with abort signal, timeout and page/item budgets are preferable. Preserve the same scope and ordering on every page; deduplicate IDs and label partial/truncated results. Counts can change during traversal; this is not snapshot isolation. No numeric maximum page size or list-wide consistency guarantee was established.

`listNodeTypes` requires `includeDisabledTypes` in the JS request type; deliberately pass true for an explanatory inventory or false for enabled candidates. Despite generated node-list prose mentioning `order_by`, neither inspected JS/Go request fields nor JS URL parameters exposes it: do not send that undocumented parameter.

Both inference JS `API.locality.regions` and Go `API.Regions()` name **only `fr-par`**. Account projects are global. Generic SDK Region types and regional dropdown prose are not proof of support in `nl-ams`, `pl-waw` or any other product region. Start with `fr-par` as pinned product-specific source evidence; display live regional support as unknown until approved discovery.

### Catalog, deployment and hardware are different resources

Model: `id`, `name`, `project_id`, `status`, `description`, `has_eula`, `nodes_support`, parameter/size fields, timestamps and `region`. `nodes_support[].nodes[]` links node type names to quantizations (`quantization_bits`, `allowed`, `max_context_size`). Use this compatibility metadata; do not assume every node can host every model or that catalog membership proves tools/stream/structured-output support. Model license acceptance is a separate future write decision; never auto-accept `has_eula`.

Deployment: `id`, `name`, `project_id`, `model_id`, `model_name`, `node_type_name`, `status`, `size`, `min_size`, `max_size`, optional `error_message`/quantization, timestamps, region and **embedded `endpoints[]`**. Resolve the selected model ID/name from these records; a deployment is not a model catalog entry or a hosted agent application.

Endpoint: `id`, provider-returned `url`, `disable_auth`, and exactly one of `public_network` / `private_network` (the latter contains `private_network_id`). Never fabricate endpoint URLs from deployment IDs. The source describes a private CA certificate accessible via GetDeploymentCertificate. Endpoint network union must be validated before use; missing/ambiguous details are unknown, not implicitly public.

NodeType: `name`, `stock_status`, `disabled`, `beta`, GPU/VRAM/vCPU/memory metadata and region. Stock enum: `unknown_stock`, `low_stock`, `out_of_stock`, `available`. **Available stock + enabled hardware + compatible model is not organization quota or successful provisioning.** Organization-quota docs explicitly limit Dedicated Deployment by maximum nodes per node type. The imported quota macro contains descriptive marketing text, not a usable quota table in this snapshot. No account-specific quota/usage endpoint or balance is established by these inference/account sources. Do not substitute serverless token/request rate quotas for dedicated capacity.

## Organization/project isolation and IAM

API keys inherit bearer (IAM user/application) policy rights and are scoped to one Organization; preferred Object Storage project is not the dedicated API selection rule. Confirm returned Project.organization_id matches the selected organization before using its ID. Bind caches/results to connection + organization + project + region and invalidate on scope/credential change. Deployment details lack a project query, so enforce returned `project_id` and region checks; never use a workspace-supplied resource ID to bypass selection. Catalog/global curated records may have different project semantics: retain provenance, distinguish public catalog from project custom models and mark visibility unknown rather than assuming every catalog record must belong to the active project.

Permission-set source lists `ProjectManager` for project CRUD/listing (does **not** grant project-resource access), `OrganizationReadOnly` for organization information including quotas, `InferenceReadOnly` for deployment reads and `InferenceFullAccess` for CRUD. Do not request broad write access merely to discover resources; minimum project-list permission and permission coverage for models/node types/certificates require provider confirmation. Authorization errors are not empty inventories.

**IAM contradiction, unresolved:** pinned dedicated access guidance says rename `InferenceReadOnly` → `GenerativeApisModelAccess` and `InferenceFullAccess` → `GenerativeApisFullAccess`, with old names retained at least until 2026-06-01; pinned permission table still groups the old names under Dedicated Deployment and new names under Serverless. As of this 2026-10-20 review, that past minimum date proves neither removal nor control-plane equivalence. Do not silently substitute names, treat inference permission as billable inference authorization, or grant AllProductsFullAccess. Current permission identifiers, project-list least privilege, endpoint invocation rights and policy-condition behavior remain blockers for explicit approved GET-only discovery / provider confirmation.

## Async lifecycle and reachability

Known deployment states: `unknown_status`, `creating`, `deploying`, `ready`, `error`, `deleting`, `locked`, `scaling`, `deleted`. Model states: `unknown_status`, `preparing`, `downloading`, `ready`, `error`. Preserve unknown/future states as non-ready. A returned object or successful write response is not readiness; a ready deployment is not reachable endpoint/auth/inference proof. Go WaitForDeployment stops at ready/error/locked; wait utilities default to 15-second polls and 30-minute timeout. JS also exposes wait helpers; custom status predicates and bounded budgets are necessary rather than assuming SDK terminal means success. No wait/provision action was performed. Read-only explorer shows lifecycle and errors, not retry/delete actions. Timeout/cancellation does not roll back provider effects; any future writes require reconciliation before retry.

Docs describe manual node-count scaling in public beta, with 15–30 minute changes. Pinned generated Go deployment `max_size` comment says autoscaling unsupported and must equal `min_size`. Neither proves automatic min/max autoscaling, HA in a particular deployment or an exact lifecycle transition graph. Keep scaling behavior source-qualified and live-unverified.

Private endpoint docs require an application Instance attached within the same VPC and downloaded deployment TLS certificate; Go states the URL is accessible only from the Private Network. Local VS Code, remote extension host and hosted runtime have different routes/DNS/trust stores. Mark private reachability **unknown/blocked**, never fallback to a public endpoint or turn TLS verification off. Any later certificate retrieval/trust installation, route probe or inference needs its own scoped approval; it is not established by deployment listing. Dedicated endpoints default to IAM auth; `disable_auth` can differ per endpoint. Do not forward a token if authentication is disabled, and do not automatically modify auth settings. Documentation says old Allowed IP ACL feature was removed; IAM conditions/VPC ACLs are alternatives, not a promised API ACL field.

### No arbitrary credential forwarding

Control-plane token is restricted to fixed approved HTTPS origin and allowlisted GET paths. Never follow redirects with credentials to a changed origin. Provider-returned inference URLs are data, not blanket trust: require binding to selected deployment/project/region and explicit endpoint origin/base-path approval; reject userinfo, credential query strings, unexpected scheme/host/port/path and ambiguous network metadata. Private-address exceptions require an explicit selected-network mandate; generic localhost/metadata/internal URLs are denied. Do not derive a universal domain suffix rule from one sample URL. Use separately configured data-plane Bearer auth only for an approved model operation when endpoint auth is enabled; control-plane client must not service arbitrary inference URLs. Webview/workspace/model output cannot override hosts, trust, scope or credential source. Full header/query/body redaction, cancellation and request budgets belong in the host policy wrapper.

## Adapter recommendation: thin GET REST, not missing SDK coverage

**Recommend a narrow policy-bound REST adapter for initial read-only explorer**, with independent control-plane/inference transports. Reason: a small stable read subset makes explicit scope, hostname/verb allowlists, runtime response validation, sequential bounded pagination and secret handling easy to audit. This recommendation is not a claim the JS SDK lacks support: both ProjectAPI and inference API cover the required reads, embedded endpoints, certificate and abort signals. SDK pagination/marshalling are concrete reusable functionality, and a narrowly wrapped SDK is a viable alternative.

Concrete source constraints: generated calls fall back to client default organization/region/page size; the public API classes also expose billable writes; source package manifests are ESM and use workspace/catalog dependency ranges; SDK transport supports custom `httpClient`/interceptors and constructs requests from `settings.apiURL + path`; auth interceptor attaches the secret header; `.all()` can fan out pages concurrently. The thin adapter avoids implicit defaults/overbroad surface, but must implement wire decoding, partial-list/error handling and redaction rather than pretend HTTP alone is safe. Before choosing SDK for implementation, verify released manifests, VS Code extension-host ESM/bundle/size compatibility, transport origin enforcement/redirect handling and cancellation/error contracts in offline tests. No dependency install, bundle test or published release verification occurred; packaging is an explicit remaining gate.

## Quickstart inconsistency disposition

Architecture records a Dedicated API quickstart that labels endpoint-list code as model listing, then mentions List Models. The current pinned docs-content `pages/generative-apis/quickstart.mdx` is **Serverless**, not that rendered Dedicated API quickstart; the rendered API page was blocked (403), so the exact historical snippet was not recaptured or independently reproduced here. Do not claim it was corrected upstream.

Authoritative operation resolution for this adapter: pinned JS and Go generated APIs agree ListModels is GET regional `/models`; ListDeployments/GetDeployment contain endpoints; JS complete API inventory has endpoint create/update/delete but **no ListEndpoints**. Therefore ignore the inconsistent endpoint-list example, use models for catalog and embedded endpoints for resources, and expose no assumed GET `/endpoints`. Absence is bounded to the inspected source revision, not a permanent API absence claim.

## Outcomes and remaining gates

Passed: unauthenticated public retrieval, commit/hash provenance, source-derived response/operation evidence, JS coverage review, offline extraction/hash validation. Not run: authenticated API conformance, IAM denial/isolation, organization quota/usage/stock observations, regional availability, private DNS/route/TLS/auth, dedicated model features/Strands transport, async provisioning/reconciliation and SDK packaging. Official OpenAPI retrieval and exact rendered quickstart recapture blocked by public-site 403. IAM naming/minimum rights, catalog visibility, page limits/error semantics and quota discovery remain unresolved.

Any later access must be separately authorized, bounded GET-only on the reviewed origin/scope, with explicit page/item/time budgets and sanitized evidence. Inference, writes, deployment/license acceptance and private-network effects require distinct mandates. Changes to provider revision, endpoint/model, scope, IAM or network invalidate dependent observations. No production readiness or live compatibility is asserted.

## Revue fournisseur 2026-10-21 — contrats encore incomplets

Sources épinglées SDK25895fc5 et réponse publique intégrale dans evidence/documentation/dedicated-review-v29/manifest.json. managed_inference retourne sept offres de nœuds fr-par et une offre de stockage. Les montants EUR sont Money units+nanos, mais la mesure node size1 ne précise pas la période : ne pas convertir en EUR/h ni comparer au plafond horaire. Les quotas IAM comportent désormais limits par localité ; sans usage courant et mapping technique dédié, ils ne prouvent pas une capacité restante. L’opération GetModelEula reste absente du SDK généré malgré sa mention dans un commentaire. Ces inconnues bloquent la création payante ; aucune route EULA devinée.

## Complément tarifaire 2026-10-21 — période corroborée

La FAQ officielle épinglée docs-content d3f08c7b précise la durée facturée en minutes, le démarrage après disponibilité et l’absence de pause lorsque les ressources restent provisionnées. Les données __NEXT_DATA__ de la page officielle pricing/model-as-a-service relient exactement apiId/région/SKU au montant perMinute avec isApproximation=false. Les sept montants correspondent au catalogue public relu par l’adaptateur. Le tableau hourly est une approximation d’affichage ; l’équivalent horaire de H100 est 3.3996 EUR, pas 3.40 EUR dans la comparaison exacte. Evidence et hashes : evidence/documentation/dedicated-prices-v30/manifest.json. Cette corroboration publique datée ne prouve pas le prix effectif du compte, le quota restant, les droits ni les EULA. L’ancienne inconnue de période du catalogue seul est conservée dans la projection brute, avec corroboration séparée.

## Lecture des quotas — VSIX0.0.31

La commande native explicite inspectQuotas utilise le chemin SDK /iam/v1alpha1/quota, organization_id distinct du projet, order_by=name_asc, page1..5/page_size100. Adapter strict limites par localité, bounds exactement limit ou unlimited=true, noms techniques conservés. Zéro n’est pas absent ; unlimited n’est pas un budget illimité. Les nombres JSON hors safe integer sont refusés ; chaînes uint64 exactes acceptées. Snapshot éphémère non persisté, usage/restant toujours unknown et createRights/dedicatedNodeMapping unverified. Tests synthétiques seulement pour le compte, aucun GET authentifié exécuté par l’agent.

## Route EULA confirmée dans la documentation API — 2026-10-21

CORRECTION de l’inconnue antérieure : la page officielle /en/developers/api/inference/models#get-a-model-eula expose GET /inference/v1/regions/{region}/models/{model_id}/eula, fr-par, 200 application/json scaleway.inference.v1.Eula content:string. Le SDK généré inspecté reste incomplet sur cette opération. Page et extrait capturés/hachés dans evidence/documentation/model-eula-v32. L’extension0.0.32 permet une lecture explicite du modèle has_eula=true déjà connu dans le contexte courant, texte brut borné/digest. Lecture ne vaut pas acceptation. Auth JWT réelle de ce GET, droits et termes du compte non validés ; exemples docs API-key ne réintroduisent pas de clés dans l’extension.
