# Candidate runtime hosting — documentation and local assessment

Owner: scaleway_ai_vscode-jgh.1.6; first authorized slice .1.6.1.
Reviewed 2026-10-20. **Conditional candidate, not cloud/runtime acceptance.**
Advanced hosting remains optional after model MVP, dedicated model workflow and
advanced local agents. No Python dependency added to model MVP.

## Evidence and authority

Current maintainer request authorizes documentation and local tests (streaming,
duration, concurrency, authentication, sessions), commits when necessary, **no push**.
No provisioning, credential access, inference or new spend was authorized by that
first slice. The later request accepts doing the spike and local commits, no push;
the transport spike and cloud envelope were assessed historically. Their executable tooling has since been retired. Exact target/budget/credentials and reviewed hosted image remain missing,
so no cloud write or live hosting test has executed.

Ten public Scaleway pages are pinned to docs-content commit
**d3f08c7b3d7b60a982572ca6ce5e18b91b1ce811** in
[the manifest](../../references/documentation/hosting-sources-v1.json), with
retrieval timestamps, source/public URLs and SHA256. Page validation dates differ
from retrieval dates; recheck freshness before deployment. Public snapshots are
unchanged; placeholder secrets in them are upstream examples, not account secrets.

[Local evidence](../../../specifications/references/validation/hosting-local-v1.json) records the
Python version/platform, input hashes, command and results. Documentation proves
what sources state; loopback tests prove the **synthetic probe only**, neither
Scaleway ingress nor Strands/runtime-http/runtime-events implementation.

## Limits and implications

| Axis | Pinned documentation finding | Local result / remaining cloud check |
|---|---|---|
| Streaming | HTTP/1.1 and HTTP/2; FAQ also names WebSockets/gRPC. No explicit SSE flush, buffering, heartbeat or stream idle cutoff guarantee found. | Incremental SSE first event, heartbeat, exactly one deadline event and disconnect cleanup pass locally. Cloud buffering/compression/idle cutoff/reconnect/header forwarding **unknown**. HTTP support alone is not SSE acceptance. |
| Duration | HTTP timeout configurable **10 seconds to 60 minutes**. Scale-to-zero **15 minutes**, scale-down **30 seconds**: neither is a stream idle timeout. | Scaled local deadlines 0.3–2s, bounded stream socket I/O only. No 60-minute experiment. Heartbeats do not extend total request timeout; timeout/disconnect is not remote rollback. |
| Concurrency | Default/max **80 requests per instance**, configurable lower down to 1; max scale **200 instances**, invocation rate **5000/s**, subject to quotas/account verification. | Synthetic cap at 2 active streams, third gets 429; health headroom. Not 80-model-call throughput/global admission enforcement. Long SSE occupies request capacity; reserve status/cancel headroom, bound queues and use external atomic run/dispatch budgets across replicas. |
| Authentication | Private ingress rejects unauthenticated calls via **X-Auth-Token**; IAM application/API key with **ContainersPrivateAccess**. Legacy JWT creation deprecated; migration notes existing-token/granularity transition. | Local random 256-bit bearer/Host/no-Origin tests only. IAM gateway/least privilege/Authorization forwarding **not_run**. IAM project access does not establish tenant/run ownership or effect mandate. No new JWT dependency or exact cutoff claim. |
| Sessions | Stateless, ephemeral storage; no Block Storage attachment. Temporary disk **24000 MiB** is not persistence. FAQ suggests external storage; no reviewed replica-affinity guarantee. | Ownership, cursor replay, evicted-cursor 410, empty state after simulated restart and shared fake adapter tested. No real DB/durable journal/atomic idempotency/multi-process test. Store unavailable -> 503, never relaunch. Object Storage alone does not prove ledger transaction semantics. |
| Network | Private Network/VPC support; optional private endpoint/public endpoint disablement; private egress routed to PN, DNS via VPC; one PN/container. Transient connections/cold-start impact documented. | No cloud egress. Public inference/dedicated private endpoint/store DNS/TLS/IAM reachability needs live approval. No dedicated public IP; no assumed stable egress allowlisting. |
| Footprint | Image **linux/amd64**, recommended uncompressed size **below 1 GB**. One exposed port, use **PORT**. CPU 70–6000 mvCPU, RAM 128–12228 MB documented. | Stdlib probe only; full Strands image, dependencies, RSS, cold start, probes and sandbox not tested. Existing SDK profile is not container lock/SBOM. |

Primary sources: [limits](https://www.scaleway.com/en/docs/serverless-containers/reference-content/containers-limitations/),
[concurrency](https://www.scaleway.com/en/docs/serverless-containers/reference-content/containers-concurrency/),
[security](https://www.scaleway.com/en/docs/serverless-containers/how-to/secure-a-container/),
[IAM migration](https://www.scaleway.com/en/docs/serverless-containers/how-to/migrate-jwt-to-iam-authentication/),
[FAQ](https://www.scaleway.com/en/docs/serverless-containers/faq/),
[Private Networks](https://www.scaleway.com/en/docs/serverless-containers/reference-content/containers-private-networks/).
Exact reviewed bytes and remaining pages are linked in the manifest.

## Local versus hosted trust profiles

The [local v1 protocol](../../runtime-protocol.md) retains loopback-only binding,
per-instance bearer, exact Host/no Origin, private bootstrap pipe and broker.
Do **not** expose this unchanged publicly. Hosted profile needs reviewed listener/PORT,
trusted ingress/Host allowlist, HTTPS, workload/provider credential delivery, trusted
tenant issuer, run authorization, revocation and durable mandate/budget ledger.
IAM key/ingress bearer never grants paid/tool effects; session state stores no
secrets or active mandates. Hosted security decisions remain prerequisites.

Do not trust client-supplied X-Forwarded-For for security. The pinned header page
states X-Real-IP is overwritten but also contains inconsistent wording about last
proxy versus address list: parsing/meaning remains unverified. Internal
K-Proxy-Request/X-SCW-Source is not guaranteed. Verify X-Request-ID preservation
rather than assuming the local contract ID survives gateway injection unchanged.
Forwarding headers do not mint identity/authority.

## Reproducible checks

The historical synthetic probe and its validators have been retired from the active tree. The archived reports below record the old candidate, not reproducible checks of current source. Current offline runtime checks are documented in [the runtime README](../../../runtimes/strands-python/README.md); they do not certify hosting.

## Conditional decision and next gate

Keep Containers as candidate for bounded stateless HTTP work. No support claim or
production packaging unblock from this slice. In-memory-only session/ledger and
background execution surviving request end/scale-to-zero are **incompatible**
with required durable paid execution.

Before cloud spike obtain separate bounded mandate: exact project/region, resource
names/quotas, maximum duration/request/concurrency, cost ceiling, permitted
create/update/delete and cleanup authority. Use synthetic output, initially no
inference; approve image digest, ingress IAM/tenant design, external store,
retention and safe evidence. Verify real SSE TTFB/gaps/heartbeat, timeout boundary
including silent interval, reconnect across replicas, auth/header propagation,
status/cancel capacity, scale/restart and egress. Cleanup requires read-back cloud
inventory; local listener cleanup is not cloud deletion evidence.

Compare explicitly authorized Instance/other compute if proxy cuts/buffers SSE,
duration exceeds 60 minutes, background execution is essential or routing/storage
cannot meet approved semantics. Jobs (documented up to 24h) may suit batch but are
not assumed interactive SSE replacement. No alternative selected/provisioned.
Live hosting, full SDK image/security and durable sessions remain blocked.
