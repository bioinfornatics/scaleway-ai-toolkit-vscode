# Authorization policy — explicit approvals and pre-effect enforcement

Revision 0.1 — 2026-10-20. Task scaleway_ai_vscode-jgh.1.4. **Proposed normative policy, not runtime proof.** Default deny/offline. Current stakeholder authority permits repository implementation, review and acceptance assessment in dependency order, including offline test execution; it does not supply missing account, budget, participant or visual-source decisions. No account/live/spend/provisioning/publishing/commit/Git or Dolt sync. Parent manages task state. Authorization to implement/review/judge documents is not approval for a paid model judge or data upload.

## Independent approvals

Host-originated explicit consent is immutable, expiring, auditable and revocable; no model/workspace/tool/session/IPC approved=true can create it. Each operation needs **all** applicable grants, not any one. Accessible review shows connection/account/project/region, canonical destination, data and estimated-versus-unknown cost; navigation/rendered links never imply approval. Never ask for keys in chat.

| Class | Authorizes only / required fields | Does not authorize |
|---|---|---|
| Offline inspect/synthetic review | Authorized repository implementation and document/fixture reads/writes; fake test inputs. | Real network/account/tools/install or remote judge. |
| Authenticated discovery | Named read-only GET operations, exact account/connection/organization/project/region, IAM and destination/path/method list, request/time/concurrency caps. | Inference, data upload, provisioning or release. |
| Inference | Named verified model/capability/endpoint, parameters, approved synthetic or separately consented data, request/token/time/concurrency/money caps. | Workspace transmission without data grant or cloud resource writes. |
| Workspace data transmission | Minimized immutable file/range/dataset digest, sensitivity exclusions, purpose, recipients/region, onward transfer and retention. | General filesystem access, changed snapshot, additional MCP/judge/store recipients. |
| Runtime/MCP/tool mandate | Workspace Trust AND executable/version/config/schema/argv/env/cwd/roots/effect/destination review, bounded loop and retry/recovery policy. | Arbitrary shell/network or unreviewed tool/server change. SDK selection/trust alone is insufficient. |
| Evaluation/model judge | Dataset/case/version, deterministic vs model provenance, data/inference consent and shared parent budget. | Implicit judge calls or policy expansion from judge text. |
| External session store/telemetry | Exact adapter/destination/auth/tenant scope/schema/encryption/access/retention/delete/minimized payloads. | Unsolicited telemetry, active authority persistence or arbitrary prompt storage. |
| Dedicated model deployment | Exact account/project/region/resource/model/node/quota/network, explicit EULA decision, estimate vs unknown cost, async IDs/reconcile/cleanup plan. | Hosted app/registry/deletion or publishing. |
| Hosted application/registry | Independently reviewed build context/image digest, registry push, hosting target, credentials/network/state/time/spend and owned-resource plan. | Model deployment or extension publication. |
| Destructive cleanup | Exact owned resource IDs/current scope/state/consequences and reviewed action. | Automatic deletion after error or read navigation. |
| Publish/release/commit/remote sync | Exact artifact/repository/registry/identity/version/visibility/provenance and distinct release gates. | None authorized here; packaging/deploy/code review is not this grant. |

Before any future authenticated spike, explicitly record approved account owner/scope, least-privilege expiring IAM identity, synthetic inputs, operation/destination list, maximum requests/tokens/concurrency/time/money, pricing/usage confidence, redacted evidence, retry/cancellation/unknown-effect reconciliation and expiry. Uncomputable upper paid exposure blocks action. A discovery test plan is not discovery approval.

## Credential and endpoint destination rules

1. Host SecretStorage or approved external mechanism resolves secrets; specs/config/exports carry references only. No secrets in chat, fixtures, workspace config, webview, IPC, logs, evidence or exports. API keys inherit organization IAM bearer permissions; prefer expiring least-privilege IAM applications where supported. Live IAM enforcement remains unverified.
2. Bind each reference to connection, credential generation, organization and enforceable project/region, purpose, exact canonical origin and path/method allowlist. Control-plane adapter adds **X-Auth-Token** only; inference adds **Authorization: Bearer** only. No dual headers, URL query/userinfo tokens or inherited tool environment. If same underlying key is permitted, purpose/destination separation still applies; distinct least-privilege references preferred.
3. Strict URL parser rejects userinfo, fragments, unsafe schemes/ambiguous encodings/noncanonical numeric addresses. Normalize case/IDNA consistently; show canonical destination before approval. Public cloud requires HTTPS, exact hostname/port and segment-aware path/method (not suffix/prefix resemblance such as infer.invalid.attacker.invalid or /v1evil). Endpoint/model change invalidates capabilities/grants. Documented serverless candidate https://api.scaleway.ai/v1 is **not** a grant or availability proof.
4. Returned public/private dedicated endpoint is untrusted candidate data. Verify provider contract, owning resource/project/region, intended service/path, network exposure and credential suitability, then explicit review. API return alone never expands approved destinations. Control-plane regional origins must come from verified schemas, not guessed paths.
5. Disable automatic 301/302/303/307/308 following for credential-bearing/effectful requests in every HTTP/SDK layer, including same-origin path redirects. Never forward credential-bearing headers or auto-resend on a transition. New endpoint requires fresh operation approval, destination validation and purpose-bound credential. Unauthenticated candidate fetch redirects also require per-hop network policy and never confer authentication consent.
6. Require TLS chain/expiry/hostname validation; no verify=false/rejectUnauthorized=false/global TLS relaxation. Custom private CA only explicitly reviewed scoped connection/destination, not workspace-controlled override. Private reachability remains unknown until separate evidence; unreachable means labelled failure, not TLS bypass/public fallback.
7. General cloud/tool egress denies metadata/link-local/loopback/private/multicast/unspecified/reserved IPs including IPv6/mapped variants. Normalize DNS/IP, check each resolved and actual connected peer every attempt with pinning/equivalent enforcement while preserving hostname TLS; if unenforceable, deny. Noncanonical IP/protocol/proxy tricks rejected. Explicit private exception needs exact route/network/endpoint/purpose, never metadata or runtime access. Documentation/test ranges only fake transport inputs, no real egress.
8. Ignore uncontrolled proxy/DNS/credential environment discovery; explicit proxies require reviewed header/destination policy. All nested clients/dependencies/SDK retries/telemetry obey egress policy. No default Bedrock/OpenAI or alternate provider fallback: explicit pinned Scaleway provider/base URL/model/external reference required. Disable unsolicited telemetry. Network approval alone is not data/tool authorization.

## Immutable mandates, runtime and scope

Host-issued validated versioned mandate includes ID/issuer/epoch/expiry; connection/credential generation/organization/project/region; endpoint/model/capability fingerprint; run/attempt/session namespace/spec/prompt/data digest revisions; trust/server/executable/config/tool schema digests; trusted effect classes/tool argument constraints/argv/env/cwd/filesystem roots/network destinations; secret references by purpose; request/step/token/time/concurrency/money ceilings; retry/idempotency/reconciliation and revoke channel. Unknown version/key/tool/effect/destination/price is deny. Parent evaluation mandate caps all child runs/judges.

Local HTTP runtime binds explicit 127.0.0.1 or ::1/random port, authenticates every effect/event route with high-entropy per-instance host-held capability, validates Host/Origin and rejects wildcard CORS/binds or token URLs. Webview goes through host, not raw runtime. Bound payload/rate/time/queue. Restart rotates capability; no old authority resume. Loopback does not protect against host/same-user compromise. Hosted runtime requires distinct verified service/tenant authentication.

Caches bind connection/key generation/organization/project/region/endpoint/capability. Events additionally bind run/attempt/session/spec/prompt/model/data/epoch and sequence. Switch/revoke invalidates pending clients/results; late/wrong-scope events cannot replace active output. Deduplicate replay/usage; retain redacted labelled partial history where appropriate. Discovery failure is not empty success.

## Mandatory pre-effect algorithm and atomic budgets

**Required contract, not runnable code or verified Strands hook.** Pin actual SDK/client version and prove interception before every model/tool/MCP/socket/OS effect, sequential/parallel/nested/retry/provider-internal. Post-tool logging cannot enforce. All effect adapters route through shared policy. Missing coverage/policy exception disables effects and raises blocker; Strands retains orchestration, no duplicate custom loop.

1. Parse/canonicalize typed tainted intent; trusted adapter classifies effects, not model/tool description. Assign immutable attempt. Require all approval classes, current scope/trust/config/spec/server/data revisions and approved destinations/arguments. Read-tool approval alone cannot authorize onward model transfer.
2. Compute conservative enforceable worst-case reservation from known price/input/output/request bounds. Uncomputable upper exposure denies send. Validate finite nonnegative bounded integers/units; money e.g. integer microunits. Check parent/child request/step/token/concurrency/time/money caps.
3. Under shared **durable atomic transaction/lock/CAS**, check current epoch/expiry/limits, reserve capacity and journal intent. Multi-worker runtime/evaluation needs shared durable ledger, not separate per-tool/process counters. Idempotent attempt settlement, no double refund.
4. Revalidate immediately pre-effect and serialize final authorized-to-dispatched transition against revocation using the same dispatcher barrier. Persist dispatch intent before send. No check-then-unlocked-send race: revoke completion means no subsequent transition starts; an earlier transition is conservatively possibly sent. Durable/enforcement failure prevents effect.
5. Report prepared/sent/accepted/proven/unknown states with origin/version and safe counters. Acceptance is not completion/health. Usage parsing honors verified delta/cumulative semantics, monotonicity and dedup; settle once per attempt. Release unused money only on verified usage/proven not-sent, not cancellation/timeout assumptions. Local concurrency slot may release on termination but unresolved exposure remains reserved.
6. Missing/malformed/regressing/overflow usage or price/remote outcome uncertainty retains reservation and **freezes new affected-budget effects pending reconciliation**. Unknown usage is never zero. Provider/account hard limits supplement local caps. Every SDK retry/judge/parallel child consumes shared request/time/exposure limits; retries cannot reset budget.

Bounded mandate allows multiple steps without per-step prompts only inside all constraints. Any widening of tool/effect/config/scope/destination/data/spec/price requires new review. Queued work owns no enduring approval.

## Revocation, retry and unknown effects

| State | Meaning / next action |
|---|---|
| read/view | Read authorization only; authenticated remote reads still need network/account consent. |
| local prepare/simulated | File/spec/fake output, no external send; separate send/execution approval. |
| reserved/prepared | Durable bounded intent, proven not dispatched; fresh checks before effect, proven not-sent release permitted. |
| dispatch-intent/sent | May have external effect; crash gap conservatively unknown; preserve ledger, no blind replay. |
| accepted | Provider acknowledgment, not proven completion/healthy runtime; approved bounded polling/reconcile. |
| proven result | Verified outcome/resource identity; scope-bound evidence and idempotent settlement. |
| failed-not-sent | Proven no remote effect; bounded retry with fresh policy/reservation. |
| unknown effect/usage | Timeout/disconnect/crash/missing usage; preserve exposure, block replay/new affected spending, approved reconciliation. |
| cancelled/revoked locally | No new local effects; external state independently may remain sent/accepted/unknown, never claimed rollback. |

Revoke on explicit stop, trust loss, key rotation/revocation, connection/project/region/endpoint/spec/config changes, expiry or policy violation. Monotonic epoch/shared barrier rejects queued/nested/stale work and backoff; stop local ingestion and best-effort provider/process cancellation only under reviewed termination policy. Already started remote/MCP child effects may survive: report uncertainty. Late events remain historical partial, cannot reactivate authority.

Before send journal safe operation/attempt/owning scope/reservation/resource IDs and provider-supported idempotency key. Reconcile through explicitly approved read-only lookup/status contract. Unsupported/inconclusive lookup remains blocked unknown with reviewed manual recovery; absence is not conclusive failure without provider semantics. Retry only proven not-sent or verified idempotent same operation with fresh valid grants/reservations and bounded attempt/deadline/backoff. Destructive cleanup is separate approval, not automatic rollback.

Crash/restart rotates runtime capability and reauthorizes, preserves outstanding durable reservations/epochs/intents and reconciles possible sends before resume. Corrupt/unavailable ledger fails closed; no speculative refund. Multi-worker deployment needs shared atomic budget and revocation, not local-memory authority.

## Sessions, evidence and acceptance

Stateless hosted memory is not durable session storage. Explicit external adapter needs tenant/connection/project scoped keys, authenticated destination, schema/integrity/CAS revisions, encryption/access/retention/delete approval. Store no resolved secrets/active mandates; persisted tool/model text remains untrusted. Resume validates current scope/spec/trust/budget/generation, gets fresh grant, reconciles unknown effects and ignores stored approved=true. No adapter means no durable claim; outage blocks unsafe resume.

Redact recursively/structurally before persistence/IPC/export/trace/session/error serialization: case-insensitive headers, URL/query tokens, env, nested causes, SDK dumps and stderr/known values. Secret-tainted fields must not enter events; canary/pattern scans supplement prevention. Default no prompt/document/tool bodies or unsolicited telemetry. Optional minimized content requires data/store/retention approval. Inspector records safe IDs/timings/effect states, metrics exclude or label cancelled/partial/error/unknown and distinguish deterministic/model-judge provenance. Passing fixtures does not verify live auth/provider/SDK or production security; unresolved critical/high findings need authorized explicit residual-risk decision or block release.
