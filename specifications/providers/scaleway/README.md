# Scaleway provider specifications

Baseline: [documented versus unverified](../../architecture.md#capabilities).

Owning tasks: scaleway_ai_vscode-jgh.1.2 (serverless.md), .1.3 (dedicated.md), .1.6 (hosting.md). These documents are introduced when findings are authored; this entry point asserts no additional verification.

Keep inference transport distinct from control-plane APIs. Cover model discovery/features, projects/catalog/deployments/embedded endpoints/hardware, pagination, IAM and product-specific regional scope. Pin official schema/source revisions during verification. Hosting findings separately cover streaming/timeouts, state, network reachability, concurrency and cleanup.

Link claims to [sanitized evidence](../../../evidence/README.md). Preserve unknowns and contradictions. No full OpenAI API parity, managed-agent API, account quota, regional availability or private-network reachability may be inferred from a compatible endpoint or source inspection alone.

## Discovery acceptance — 2026-10-20

Beads .1.2/.1.3 are closed for scoped discovery acceptance. See
[acceptance report](../../../evidence/reviews/provider-acceptance-20261020.md),
[observed capability matrix v2](../../../evidence/capabilities/serverless-matrix-v2.json)
and [bounded Strands smoke](../../../evidence/validation/strands-live-smoke-v1.json).
Source reviews/v1 matrices remain historical. Production safety, minimum IAM,
authoritative quota joins, private endpoints and deployment lifecycle are not certified.
.1.5 is the next ready implementation-contract task; later gates remain in Beads.
