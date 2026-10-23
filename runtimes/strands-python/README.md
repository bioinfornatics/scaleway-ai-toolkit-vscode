# Offline JSON repair helper

Implementation of ADR 0003 / R07a plus experimental offline dispatch and loopback lifecycle modules. No live transport, production agent loop, tools or credentials.

## Packaging decision

Python >=3.11, standard library only, source-tree tests via unittest. No install,
build backend or third-party schema library is selected. The pyproject records
an empty dependency set; there is no dependency-resolution lockfile to maintain.
Production runtime packaging/SDK dependency locking remain separate work.

Run from repository root:

    python3 -m unittest discover -s runtimes/strands-python/tests -v

## Local schema contract

Supply schema as JSON text to LocalSchema. It validates and pins a canonical
copy. Supported subset: one type (object/array/string/integer/number/boolean/null),
enum, properties, required, boolean additionalProperties, items,
minItems/maxItems, minLength/maxLength, minimum/maximum. Integer includes JSON
numbers with no fractional part; booleans are not numbers. Missing properties
are allowed unless required; additional properties are allowed unless false.
All other keywords (including $schema, $ref, format, pattern, unions, schema-valued
additionalProperties, and annotations) are rejected, not ignored. This is NOT a
full JSON Schema 2020-12 implementation or the provider-schema validator.
No references, external resolution, code execution, coercion or substring extraction.
Limits bound UTF-8 bytes, nesting, nodes and error count. Duplicate keys,
nonfinite/overflow numbers, invalid Unicode and Markdown are invalid.

## Feedback safety and results

Every correction requests a full JSON value with the unchanged prompt, schema,
endpoint, model and scope. Previous output is always omitted: this conservative
redaction policy deliberately trades repair context for no content leakage.
Feedback contains only fixed categories/rules/types, parser line/column and
schema property ordinal paths (/p0) or array indices (/i0). Paths reveal no
response keys/values; property ordinals correspond to order in the pinned schema.
If bounded safe feedback cannot be built, stop with unsafe_feedback.
Original prompt/schema/context are trusted caller-approved data; this module
cannot discover secrets in them or establish approval itself.

Result.success includes only a completely received, strictly validated value
(including valid null). Other results carry no value. validation_exhausted has
last normalized errors and counters. Validation proves shape, not truth, business
correctness or authorization. Events contain generated origin IDs, counters and
normalized errors, not bodies, destination, prompt, headers or exception text.
They are returned in memory, never persisted or uploaded automatically.

## Sender and ledger boundary

Inject one model-only Sender accepting an immutable Request and returning a
Receipt. Request has no tools, MCP, native parse/structured-output or fallback
configuration. Each invocation MUST correspond to exactly one physical dispatch
and enforce output tokens, bytes and deadline. Disable all hidden SDK/HTTP
retries. Surface only a verified retryable non-accepted outcome, with known usage;
it consumes the same six-send ceiling but is not a JSON correction. Interruptions,
unknown outcomes/usage and sender exceptions freeze spending, retaining exposure.
Auth/permission/policy/business failures stop without output repair.

reserve_tokens covers ALL input plus maximum output; reserve_spend is a known
conservative integer microunit bound, not a price guessed from responses. The
trusted adapter must compute and enforce both. Receipt usage is verified total
per-send tokens/spend (not a cumulative stream delta). Unknown/malformed or above-
reservation usage freezes the ledger. Known settlement refunds unused exposure.
One initial generation plus at most five corrections, at most six physical sends
including transport retries; parent counters never reset between stages/runs.

ReferenceLedger is a single-process, synchronous in-memory fake/shared ledger.
Its lock serializes dispatch and revoke/cancel completion. Revoke completion
prevents later dispatch transitions; already-started work is not rolled back.
A blocked synchronous sender delays revoke completion; production needs a
cancellable dispatcher and durable atomic ledger, not this reference as authority.
Deadlines are checked before and after sends; hard interruption during the call
is the sender's responsibility. Known late results after revoke/cancel/deadline
never become success. The fake serializes concurrency and tests its cap; it does
not prove multi-process concurrency enforcement, journaling or crash recovery.

Integration .4.2 must separately prove pinned Strands ordinary-call interception,
all physical retries, reservation pricing/input bounds, durable budget/revocation,
cancellation, origin/scope/spec correlation and actual provider usage contracts.
No live/provider or production security test is claimed by these offline tests.

## Experimental offline modules

`dispatch.py` exercises a bounded Strands 1.61.1 ordinary-call adapter through trusted injected dependencies and a process-local fake ledger. Live mode is disabled. The optional installed-SDK test is skipped when the exact SDK is absent; no dependency is installed by the tests.

`lifecycle.py` supplies synthetic loopback control with dedicated-pipe bootstrap, per-instance capability, authorization, bounded replay, idempotency and cooperative cancellation. Tests bind only OS-assigned localhost ports. Worker cancellation is cooperative, not process isolation or remote rollback. Neither module is wired into the extension or accepted for cloud/production use. Durable authority, dependency locking and provider acceptance remain separate gates.
