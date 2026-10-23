# Dedicated public-source evidence review

Record `dedicated-public-review-2026-10-20`; owning task `scaleway_ai_vscode-jgh.1.3`; [specification](../../providers/scaleway/dedicated.md). Method: unauthenticated public GitHub API tree/commit resolution followed by exact raw-source retrieval, documentation/source review, deterministic offline extraction. No credentials, authenticated/provider API calls, model calls, provisioning, dependency installation, Beads mutations, commits or sync. Approval reference: public-source research only; no live approval used.

## Reproducible upstream sources

Full URLs and source SHA-256 are in [dedicated-provenance.json](../schemas/dedicated-provenance.json). Commit resolution used unauthenticated `https://api.github.com/repos/scaleway/{repository}/commits?per_page=1`; recursive trees were untruncated. Content was retrieved as `https://raw.githubusercontent.com/scaleway/{repository}/{commit}/{source_path}`. Moving HEAD was resolved once, then all snapshots use immutable full commit URLs. Retrieval timestamps are in the manifest, not substituted for docs frontmatter validation dates.

| Repository | Full commit | Relevant source |
|---|---|---|
| scaleway-sdk-go | `46763ab9fc78781eca1af94bd3a83750d3a2068f` | api/inference/v1/inference_sdk.go; inference_utils.go; api/account/v3/account_sdk.go |
| scaleway-sdk-js | `e05f031e8590090311adf028747139fe7b490d59` | packages_generated/inference/src/v1/api.gen.ts, types.gen.ts, marshalling.gen.ts, metadata.gen.ts; packages_generated/account/src/v3 equivalents; packages/client/src/scw/fetch/resource-paginator.ts, build-fetcher.ts; auth.ts, client-settings.ts, constants.ts; package manifests |
| docs-content | `1dd79adcf1f8ccbded698d2776871c21d50bac06` | pages/generative-apis/how-to/create-deployment.mdx, dedicated-deployment-with-private-network.mdx, manage-allowed-ips.mdx, configure-autoscaling.mdx; IAM permission table; organization-quotas.mdx |

These are official repository source snapshots, not issued OpenAPI artifacts. [Source-derived shapes](../schemas/dedicated-response-shapes.schema.json) are a deliberately partial JSON Schema projection. Requiredness, numerical bounds, complete errors and some nested types are not inferred. Generated source itself remains the authoritative inspected evidence. Local extractor and output hashes are recorded separately in [validation record](dedicated-validation.json).

## Supported source findings

- Generated Go and JS agree on regional `/models`, `/deployments`, deployment detail and `/node-types`, and global account projects. Deployment endpoints are embedded; no standalone ListEndpoints appears in either inspected API. JS metadata labels list pagination as offset.
- JS coverage is positive: listModels/listDeployments/listNodeTypes/getDeployment/getModel/getDeploymentCertificate and account ProjectAPI.listProjects/getProject. Wait helpers, AbortSignal transport propagation and pagination helpers exist. `.all()` executes remaining pages through Promise.all; bounded discovery must not equate SDK convenience with request authorization.
- JS inference locality and Go Regions list fr-par only. Generic Region type is not product availability.
- Endpoint Go comment specifies exactly one network discriminator, private-network-only reachability and GetDeploymentCertificate CA. `disable_auth` is explicit. Docs require VPC-attached application resources plus CA verification; no local connectivity observed.
- Hardware stock/disabled flags and model quantization compatibility are separate from organization node quotas. Organization quota docs say Dedicated Deployment is limited by node type; the referenced `macros/ai/ai-managed-inference.mdx` snapshot is marketing prose, not a quota table. No numerical quota inferred.
- Known deployment lifecycle includes scaling/deleted plus creating/deploying/ready/error/deleting/locked/unknown_status. Source wait completion is not inference success. Go default poll/timeout is 15 seconds/30 minutes; model wait terminal states ready/error and deployment wait ready/error/locked.

## Contradictions and limits retained

1. **Quickstart:** architecture previously observed endpoint-list code labeled as model listing on Dedicated API quickstart. Current pinned docs-content quickstart is Serverless, so it does not reproduce that snippet. Rendered API reference could not be recaptured (403). Generated operation evidence resolves our adapter operation without assuming GET /endpoints; no upstream correction or complete API absence claim.
2. **IAM migration:** manage-allowed-ips docs (validation 2026-04-15) recommend replacing InferenceReadOnly with GenerativeApisModelAccess and InferenceFullAccess with GenerativeApisFullAccess, retaining old names at least through 2026-06-01. The same pinned permission table still places old names under Dedicated and new under Serverless. Current equivalence/removal/least privilege remains unknown; source inspection cannot resolve account policy acceptance.
3. **Node ordering:** generated listNodeTypes description mentions order_by, but request types and URL query builder do not expose it. Do not invent that parameter.
4. **Scaling:** docs describe manual scaling beta, not verified automatic autoscaling. Go max_size comment says equal min_size, autoscaling unsupported. No transition graph, HA observation or timing guarantee for selected deployment established.
5. **Removed ACLs:** manage-allowed-ips source says Allowed IPs ACL feature removed; IAM conditions and VPC ACLs are alternatives. Do not promise legacy API ACL operations.

## Failed public retrievals (no bypass)

- `https://www.scaleway.com/en/developers/api/inference/`: HTTP 403.
- `https://www.scaleway.com/en/developers/api/account/`: HTTP 403.
- `https://www.scaleway.com/en/developers/api/generative-apis/dedicated/`: attempted candidate URL, HTTP 403; existence/canonical status not established.
- `https://www.scaleway.com/robots.txt`: HTTP 403; no scraping of rendered site proceeded.
- `https://raw.githubusercontent.com/scaleway/scaleway-api/master/swagger/inference.v1.swagger.json`: attempted candidate location, HTTP 404; not evidence of a real published schema URL or absence of provider OpenAPI elsewhere.

No login wall bypass, cookies, alternate authenticated headers or private payload collection was attempted. Successful public raw-source downloads are exact manifest-backed bytes; failed requests have status/error observations only, not fake downloaded artifacts.

## Remaining verification

Official downloadable schema retrieval and exact rendered quickstart reproduction remain blocked. Live IAM/scope denial tests, regional inventory, catalog visibility, node stock/organization quota balance, page-size/error contracts, private route/DNS/TLS/auth, endpoint/model-specific Strands behavior and any provisioning/lifecycle reconciliation were **not run**. Published package manifests, dependency resolution and VS Code ESM/bundle footprint also not tested. Public schema/source coverage supports the thin REST recommendation; it does not prove production or live compatibility. Repeat source pin/hash review upon upstream change; endpoint/model/project/IAM/network changes invalidate dependent future live evidence.
