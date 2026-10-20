# Verification evidence

Purpose: reproducible, sanitized support for specifications—not a parallel backlog or an archive of private provider responses. This entry point contains no new provider verification.

Introduce subdirectories as evidence exists: documentation/ (reviewed sources), capabilities/ (versioned endpoint/model observations), schemas/ (pinned official schema snapshots), compatibility/ (Strands/transport/hosting findings). Synthetic response fixtures belong in tests/fixtures/ when test packages exist, with provenance linked here.

## Required record metadata

- Record identifier, source URL(s), retrieval/verification date and authoring method.
- API/schema/SDK release or commit revision where available; explicitly note moving/unpinned sources.
- Method: documentation review, source inspection, synthetic fixture test, authorized live discovery or authorized live inference/provisioning.
- Sanitized endpoint/model/scope context; use pseudonymous connection references, not sensitive account identifiers.
- Finding and supported/unsupported/unknown outcome, limitations, contradictions and freshness/invalidation rules.
- Linked owning specification, requirement and Beads issue; reproducible test command and outcome for executed checks.
- Applicable approval reference for live checks, without embedding credentials or private approval details.

A schema snapshot is provider evidence, not our portable contract. GET model discovery is not a feature matrix. Fixture conformance is not provider availability. Skipped or inaccessible live verification must remain explicit, never marked passed. Endpoint/model/scope changes invalidate dependent capability observations.

## Data handling

Store public source material and synthetic/sanitized records only. Never commit tokens, authorization headers, signed URLs, account/project identifiers, raw private payloads, prompts/documents/responses or unredacted traces. Public endpoint origins may be recorded where safe; redact query credentials and private endpoint details. Review records and fixtures before Git staging or sharing. Keep private/live artifacts outside the repository; ignore rules do not substitute for sanitization.

## Current acceptance evidence

- [Provider discovery acceptance, 2026-10-20](reviews/provider-acceptance-20261020.md).
- [Sanitized live GET summaries](validation/provider-live-discovery-v1.json).
- [Bounded actual Strands transport smoke](validation/strands-live-smoke-v1.json).
- [Capability matrix v2](capabilities/serverless-matrix-v2.json).
- [SDK offline transport cases](compatibility/test_strands_transport_offline.py).

These update historical no-live statements; old source snapshots and matrix v1 are
not rewritten. Validation tooling's not_run list describes its offline check scope,
not a global denial of the separately recorded live smoke. No production security
or private/deployment acceptance is implied. Public upstream credential-like examples
in hash-pinned source snapshots are provider examples, not this account credentials.
