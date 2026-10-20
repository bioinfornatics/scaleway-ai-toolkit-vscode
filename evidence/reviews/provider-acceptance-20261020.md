# Provider discovery acceptance — 2026-10-20

## Verdict and scope

.1.2 PASS against discovery acceptance: versioned tri-state matrix v2, 17 observed IDs,
three actual Strands OpenAIModel calls for Mistral Small 3.2 (generation, stream/usage,
tool proposal without execution). Official model tokenizer revision/hash pinned;
local input counts 6/11/76 exactly match provider usage; output 22/19/10.
Reported token cost EUR0.0000318, not final invoice/tax. No retry/fallback.

.1.3 PASS against schema-backed adapter decision with explicit live-access blockers,
as permitted by its existing criterion. Pinned partial generated SDK schemas and
thin policy-bound GET REST recommendation cover project/catalog/deployment/embedded
endpoints/node types/pagination/fr-par. Project detail matches organization;
58 catalogue models, zero deployments, seven node types, 568 organization quotas.
Stock is distinct from quota; other-region quotas do not prove service availability.

Evidence: [GET summaries](../validation/provider-live-discovery-v1.json),
[Strands smoke](../validation/strands-live-smoke-v1.json),
[matrix v2](../capabilities/serverless-matrix-v2.json).
Prior discovery-review.md/no-live wording is historical, not current evidence.

## Offline checks and limitations

Five actual SDK MockTransport tests: stream/usage, denial without retries, no
redirect following, local cancellation without replay, unsupported-parameter
validation requirement. SDK passes unsupported parameters: application allowlist
mandatory. Existing 32 synthetic discovery checks cover pagination/scope/errors,
unknown usage and stale events. Local cancel is not remote rollback or zero billing.
No complete official OpenAPI/minimum IAM proof; permission-name conflict, catalogue
sentinel semantics and authoritative quota mapping remain unknown. No arbitrary
cross-project probes, live saturation, deliberate credential revocation or unsafe
retry. No production Agent security or native structured output validated.

Live lifecycle, endpoint isolation/private DNS/route/TLS/certificate checks remain
BLOCKED by no deployment/private-network mandate. No paid deployment is needed for
this discovery closure; no capability or permission is fabricated.

## Existing implementation gates retained

.1.5 contracts preserve unknowns and scope/trust boundaries.
.3.2/.3.6 implement minimum-IAM errors, runtime schema/isolation validation and
verified quota associations. .4.2 needs durable all-dispatch/retry guards, final
tool-argument validation and cancellation/reconciliation; SDK smoke is not an Agent.
.5.1/.5.3 retain separate paid provisioning/license/lifecycle/network authority.
Discovery closure grants no UI/value/production/cloud/write mandate.

## Reproduce offline

python3 tooling/validate_discovery.py
python3 -m unittest discover -s tests/discovery -v
Isolated SDK environment: strands-agents[openai]==1.61.1, openai==2.54.0,
httpx==0.28.1; python evidence/compatibility/test_strands_transport_offline.py -v.
Live results are historical, not automatically replayable. No account IDs, secrets,
raw private payloads or model outputs retained in evidence. Tokenizer/env outside repo.
