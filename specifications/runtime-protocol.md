# Extension / runtime protocol v1

Owner .1.5; design contract, not running service or production security acceptance.

## Two independent routes

Model MVP: webview -> host IPC -> TypeScript model/control-plane adapters -> Scaleway.
No Python install/startup required. Exports use external credential references and
remain runnable outside extension. Advanced agents: host -> local authenticated
HTTP runtime -> explicitly configured Strands -> approved inference/tools. Model
deployment uses control plane, not Strands. Hosted agent = our application, not a
presumed native Scaleway CreateAgent service.

## Local launch, credential resolution and authentication

Host resolves reviewed executable, Python environment and package-lock identity.
Launch only trusted pinned runtime entry point with no workspace-selected argv/cwd
or inherited secret/proxy/provider environment. Runtime listens on exactly 127.0.0.1
(random OS-assigned port); ::1 alternative requires explicitly negotiated address.
Host generates at least 256-bit random per-instance capability and bootstrap nonce.
Pass them through dedicated inherited anonymous pipe, never argv/env/workspace/logs.
Runtime replies on bootstrap pipe with nonce, instance ID, address/port and supported
versions; host validates address and launched process identity. Bootstrap pipe closes
after bounded setup. Logs/stderr are separate sanitized streams, never protocol.

Every route, including health/status/events, requires Authorization: Bearer runtime
capability and exact expected Host (IP:port). No browser Origin accepted on local
host-to-host API; CORS off; no query token, redirects or unauthenticated probes.
Runtime capability is not Scaleway credential or effect authority. Reject remote
peers, userinfo/fragment destinations, wildcard binds and uncontrolled proxies.
Same-user/host compromise remains a residual risk; module boundary is not isolation.

Provider credentials resolve via host/runtime owned external broker using purpose-
scoped opaque references. For local runtime, credential provisioning uses a reviewed
private IPC secret broker, not run/spec/event/HTTP JSON bodies; authenticate child
identity and bind secret to allowed canonical provider origin/path/scope/generation.
No provider credential in webview, exports, evidence or telemetry. No generic remote
secret-fetch endpoint. Broker implementation is .4.2; until verified, live execution
disabled. Hosted deployment needs separate workload/tenant credential/auth decisions
under .1.6/.5.3, never reuse local bearer as public authentication.

## HTTP route table (all prefixed /v1)

| Method / path | Body or query | Result |
|---|---|---|
| POST /runs | launch body, Idempotency-Key header matching body | 202 accepted, binding and sequence |
| GET /runs/{run_id} | binding verified from server context; version header | 200 status |
| POST /runs/{run_id}/cancel | cancel body with full binding | 202 cancel_ack; no rollback claim |
| GET /runs/{run_id}/events | after_sequence plus version header | authenticated SSE |

get_run/events schema objects describe client internal command before route encoding;
GET has no JSON body. request_id uses X-Request-Id and contract version
X-Contract-Version: 1.0.0. Only run ID and after_sequence may be query/path data;
mandate/credentials never URLs. Last-Event-ID if sent must equal after_sequence;
conflict is 400. Status/event reads require authorization to that run/binding, not
only knowledge of run ID. No new run created by read/reconnect.

Error envelope: 400 invalid_request, 401 unauthorized, 403 forbidden, 409 scope/
stale/idempotency conflict, 410 replay_unavailable, 413 payload limit, 422 unsupported
version/feature, 429 bounded queue limit, 503 ledger/service unavailable. Safe error
code/message/retry disposition only; no provider bodies, secrets or stack traces.
401/403/409/unknown outcome never trigger inference fallback/retry.

## Launch and idempotency

1. Host validates spec/current capabilities and reviews data/effects/budget.
2. Host authority registry issues immutable expiring mandate bound to full scope,
   revisions and tool set. request body contains only opaque mandate ref and binding
   claims; runtime verifies exact equality to trusted registry, not approved=true.
   Same-user client with runtime token cannot mint mandates. Runtime instance auth
   and grant lookup are separate controls. Missing ledger/registry fails closed.
3. Atomically reserve run under (issuer, scope revision, idempotency key), binding
   canonical launch digest. Identical duplicate returns original run; different
   digest returns 409. Persist before acknowledgment. Keys retained for run lifetime
   and unresolved effects; no eviction that permits replay after crash.
4. No paid send before durable budget reservation/current epoch dispatch barrier.
   Grant ceilings intersect requested limits; expired/refunded-unknown is deny.
5. Execute Strands once, normalize events, then finalize outcome.

Ordinary file/spec/run state cannot supply grants. Bootstrap authorization provisioning
requires authenticated host-controlled IPC registry, not arbitrary runtime /mandates
POST. Hosted trusted issuer design remains a hosting prerequisite.

## Events and reconstruction

SSE event: runtime-event; id: monotonic per-run sequence; data: one JSON schema event.
Event ID is opaque stable unique identity, SSE ID equals numeric sequence. Heartbeats
are SSE comments, no run authority. Authenticated stream is read-only. Explicit
bounded replay window; clients may reconnect to existing run with cursor, never resend
launch. Gap/evicted cursor returns replay_unavailable and requires status consultation.

One run.started first, consecutive sequence; binding immutable for all events.
Terminal exactly once, last in the run stream. Event duplicate accepted only as an
identical replay; differing payload under same sequence/ID is integrity failure.
Unknown event/version is rejected, not ignored as success. Resume validators seed
prior binding/sequence/terminal from trusted status/history; fixture validator tests
full streams only. Live metadata timestamps are informational, not ordering authority.

model.attempt precedes related text/tool/usage events. attempt IDs unique; corrections
share budget and physical counter, do not restart agent. Each tool call has proposal,
policy decision, approved dispatch and result with stable call ID; event proposal alone
is not dispatch. This schema intentionally omits raw args/results and internal grants.
Tool result unknown freezes related effects; no automatic replay. Count each physical
send atomically; event presence alone does not prove a send did/did not occur.

usage.updated contains latest full attempt total, never cumulative snapshots summed.
Settle attempt exactly once by durable attempt ID; reconcile additional newer usage
without double charging/refunds. Enforce total=input+output, monotonic verified counts,
known price/currency and upward rounded integer microunits. Unknown/malformed/regressing
usage retains reservation and freezes further affected effects. terminal succeeded
requires complete output, completed remote result and known settled usage; failed or
cancelled may be partial and independently remote_outcome=unknown. JSON validated
means schema-valid, not business truth. No native structured output baseline.

## Cancellation, stale results and restart

Cancel revokes run epoch via shared dispatcher barrier, prohibits new effects and
requests local Strands/process stop. cancel_ack means request accepted, not remote
abort; terminal reports partial output/unknown billing honestly. Revocation on
trust/key/scope/spec changes uses same barrier. Never refund an ambiguous send.
Late provider results may update separate reconciliation records but never reactivate
terminal run authority or mutate active UI from another binding.

Restart rotates capability/instance ID; no old-run resume under old token. Persist
intents/outstanding reservations and reconcile before fresh reviewed execution.
No durable ledger => not eligible for production paid/tool execution. Session data
stores no active mandates/secrets and cannot authorize resume. External stores need
separate scope/encryption/retention approval. No default telemetry.

## Scope of executable checks

Shared schema/sequence fixtures validate structure, basic full-stream ordering,
terminal/unknown consistency in Python and TypeScript, not actual HTTP server,
secret broker, ledger, idempotency/revoke races, replay retention, isolation or
production adapter behavior. Those remain .3.2/.3.6/.4.2/.4.3/.5.x implementation
gates. No claim of complete Agent Builder IPC, schema migration or digest codegen.
