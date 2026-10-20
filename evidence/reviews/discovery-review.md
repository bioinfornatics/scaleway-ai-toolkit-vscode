# Discovery acceptance review

Date: 2026-10-20. Method: parent artifact/code review, executed offline checks and delegated read-only acceptance review. This is an engineering assessment, not stakeholder visual selection, user research, paid model judging or production authorization. Beads remains status authority; this record captures the evidence available at review time.

## Verdict

- .1.4: PASS for threat-model/document acceptance only: 26 concrete threats map to boundaries, mitigation, future executable assertions, residual risks and R01/R03/R07/R08/R12. Credential transports, endpoint policy, mandates, atomic budgets, revocation and unknown effects are explicit. All 26 runtime security cases remain not_run.
- .1.2: PARTIAL/BLOCKED. Public source/release evidence and 47-row tri-state catalog matrix exist; live availability and authenticated discovery IDs remain unknown. Test-only wire examples pass, not production adapter or Strands integration. Partial schema/project-path semantics, account approval, credentials and separate inference budget still missing.
- .1.3: PARTIAL/BLOCKED. 55 pinned source snapshots, partial source-derived schemas and positive JS SDK read coverage support a narrow REST recommendation. Complete official OpenAPI/quickstart retrieval encountered 403; IAM naming/least privilege, account scope, quotas, regions and private reachability remain unresolved.
- .1.1: PROPOSAL/BLOCKED. Neutral counterbalanced SC1 protocol exists. Sample, thresholds, participant access/consent, study ownership/privacy and fair working comparison paths are not agreed or observed.
- Offline validation task: PASS within its deliberately narrow acceptance. 83 snapshot hashes, traceability, JSON, schema references and capability uncertainty checked; 24 unittest checks pass.

## Findings and dispositions

1. HIGH implementation gate: released Strands BeforeModelCallEvent excludes structured_output; raw request debug logging and retry layers also need containment. Provider review and threat T13/T24 require independently verified all-dispatch guards, disabling unguarded paths. Not a runtime fix or acceptance; .1.5/.4.2 stay blocked.
2. HIGH model compatibility gate: generic GPT-OSS tools attribute contradicts explicit Chat Completions restriction. Matrix records transport-specific limitation; do not choose it for tool agents or silently switch to Responses.
3. MEDIUM evidence limitation: synthetic helpers test themselves, not production clients. Headers/status/TLS/DNS/tool-argument transport and actual cancellation are not exercised. Their module docs and result records explicitly limit claims. Future implementation must reuse adversarial cases against actual effect adapters.
4. MEDIUM reference-helper limitation: DONE framing is treated as wire success without complete model-specific finish-reason validation; unsupported parameters are filtered rather than returning a user-visible validation error. No production code consumes these helpers. Production normalization must separately validate terminal/usage semantics and explicitly reject or review unsupported requested options.
5. LOW documentation authority drift: delegated documents described their restricted write assignments as global user authority. Parent corrected security introductions/policy to acknowledge current repository implementation authorization while preserving independent account/spend/participant/source/release gates.

Delegated reviewer summary agreed that .1.4 is documentation-complete and .1.1–.1.3 cannot pass full acceptance. Its task ended at turn limit; no usable detailed review artifact was returned, so the concrete findings above are the parent review, not invented independent findings. Other delegates also reported tool/turn-limit failures after leaving artifacts; parent inspected and executed validation rather than trusting completion messages.

## Reproduce

Run from repository root, without credentials or installs:

~~~bash
PYTHONDONTWRITEBYTECODE=1 python3 tooling/validate_discovery.py
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests/discovery -v
PYTHONDONTWRITEBYTECODE=1 python3 evidence/schemas/dedicated-validate.py
~~~

The dedicated validator executes our local extractor and checks deterministic regeneration; it does not execute downloaded SDK sources. Default commands do not send network requests. No actual runtime-security/Strands/live-provider/hosting/user-study/UI QA checks passed. No cloud resources created or publication/commit/push/sync performed.
