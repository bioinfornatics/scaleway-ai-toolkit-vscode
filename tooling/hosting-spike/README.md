# Hosting spike — transport useful to the VS Code extension

Owner .1.6.2. Deliverable: executable Node-to-Python HTTP/SSE assessment, not an
extension feature, production runtime or completed cloud deployment. Node 22;
Python standard library; no npm package/dependency install.

Run from repository root:

    node --test tests/hosting/transport.test.mjs
    python3 -m unittest discover -s tests/hosting -v

## What this contributes to the extension

The future **extension host**, not a webview, must own transport credentials,
AbortSignal, response limits, deadlines and event reconstruction. This spike tests
those behaviors against a real Python listener. Cancellation interrupts the local
socket; it does not claim remote inference cancellation/rollback. Reads/reconnects
never launch an agent. A future production adapter must validate runtime v1 schemas,
full origin/scope/run bindings, durable mandates/ledger and complete output/usage.
This synthetic parser is deliberately incompatible with runtime v1/provider events.

Model MVP remains TypeScript -> Scaleway model adapters, without Python or hosted
agent startup. This assessment informs optional **advanced** hosted agents, not
model playground prerequisites. No extension UI/scaffold is created or design/value
production gate bypassed. Next implementation milestone is .3.1 when its .2.5
production mandate is granted; then connection -> catalog -> streaming playground
-> saved experiments/exports/read-only resources, before advanced agents.

## Implemented behaviors

- GET-only route allowlist, one physical send, no redirect/retry or environment proxy.
- HTTPS with default certificate verification for non-loopback destinations.
- Separate in-memory Authorization bearer and optional X-Auth-Token header.
- Deadline and AbortSignal close the request/response; response/frame byte ceilings.
- Incremental strict UTF-8 and synthetic SSE sequence/terminal checks.
- Results/errors contain only counters/timings/fixed codes, no body/URL/token.
- Tests bootstrap synthetic secrets through inherited fd3; no secret env/argv/stdout.

Only loopback has executed. HTTPS certificate/proxy/IAM integration remains not_run.
No CLI takes credentials; no automatic deployment or production bootstrap. Server
fixture discards stderr, has test-only state and stays loopback-only. Do not deploy
it. Test process fd3 is a synthetic seam, not verified production secret broker.
Parser is bounded and shape-specific, not a general SSE/JSON Schema implementation;
JSON duplicate-key rules and full runtime semantics remain production work.

## Cloud execution gate (proposal, not accepted spending parameters)

The user accepted doing the spike and committing deliverables, with no push.
Execution is still blocked on the precise target, budget and secure credentials.
Suggested envelope to confirm:

| Parameter | Proposed value |
|---|---|
| Target | One explicitly identified test project in fr-par |
| Resources | One dedicated spike namespace + one private Container + spike image; never shared resources |
| Inference/tools/storage | None; synthetic events, no provider calls, no durable DB creation |
| Instances | min 0, max 1; platform concurrency 4, application streams 2; retain status/cancel headroom |
| Requests | At most 40 data-plane/control-plane physical sends, sequential except up to 3 test streams; no automatic retries |
| Time | At most 30 minutes from first resource write; HTTP boundary profile 10s, synthetic stream about 15s |
| Budget | **To be supplied/confirmed by owner**; no guessed price or reliance on free tier |
| Auth | Pre-provisioned least-privilege IAM access and separate app test bearer; no IAM policy/key mutation by default |
| Operations | Create/configure/deploy and delete only named spike-owned resources/image, inventory read-back |

Before first write: verify permissions/quotas, exact resource names, registry target,
reviewed immutable linux/amd64 image digest, hardened temporary hosted listener and
pricing upper bound. Abort before write if any is missing. There is no reviewed
hosted image yet; neither Python fixture nor local bearer profile is eligible.
Do not treat 30-minute duration as a cost cap: instances/registry/retention can incur
cost beyond active requests. Cleanup must be independently verified, including
image/namespace deletion and absence of survivors; record unknown cleanup honestly.

Cloud cases: missing/invalid IAM denied; missing app authorization denied; valid
SSE incremental with heartbeat; silent interval; request timeout despite heartbeat;
2 streams plus saturated third and responsive status; disconnect/reconnect to same
synthetic session; instance replacement loses volatile state; no replacement run.
Session durability across replicas is **not** proved by this no-DB spike. Run
separate approved external store/ledger tests before paid agent hosting acceptance.
No 60-minute/max80/multi-replica/private-inference/cold-start claim from this envelope.

## Decision and reporting

Record passed/failed/not_run independently for each axis plus cloud inventory
cleanup. If gateway buffering/cutoff or required duration/state cannot meet approved
semantics, compare compute rather than promising Containers support. Keep .1.6 open
until required cloud evidence or accepted explicit blockers are reviewed.

[Current public/local limits](../../specifications/providers/scaleway/hosting.md).
[Cross-language spike evidence](../../evidence/validation/hosting-transport-v1.json).
