# Portable contracts v1

Owner: Beads .1.5. Normative design for advanced execution; not a server,
production validator or release approval. JSON Schema Draft 7; exact envelope
version 1.0.0. Contracts are ours, separate from provider/OpenAI/Strands types.

## Files and ownership

- agent-spec/v1/schema.json: saved configuration, not authority.
- runtime-http/v1/schema.json: typed request/response bodies, not all authorization checks.
- runtime-events/v1/schema.json: safe runtime-origin events.
- webview-ipc/v1/schema.json: reference-only host/webview action slice.
- fixtures/: synthetic examples and invalid/sequence cases consumed in both languages.
- [Architecture ADR](../specifications/decisions/0004-runtime-contracts.md).
- [Operational protocol](../specifications/runtime-protocol.md).

## Validation requirements

Closed objects reject unknown properties/versions. Local-only schema references;
no remote resolution. Application additionally enforces max JSON body 256 KiB,
event 32 KiB, JSON depth 32, duplicate-key/nonfinite rejection, integer-safe values,
UTF-8 and recursively sanitized serialization. Schema validates shape, not secret
absence, grants, endpoint trust, causal event order, known capabilities, ledger
atomicity or truthful outcomes. Opaque references resolve only through trusted
host/runtime registries, never workspace-provided URL/environment/command data.

Spec revision is SHA256 of canonical UTF-8 JSON excluding its own revision field;
object keys sorted lexicographically, no whitespace, NFC strings, arrays retain
order, finite numbers represented per RFC 8785/JCS. Implementations must use an
actual JCS implementation, not ordinary JSON.stringify; fixtures use placeholder
digests and do not prove digest computation. Scope/data/tool/model revisions have
separate canonical inputs. Reject inconsistent digests before effects.

Exact version negotiation: v1.0.0 only initially. Unknown major/minor/patch is
unsupported_version until both sides explicitly advertise and test it. No silent
migration. Future additions require new version and conformance fixtures; historical
schemas/examples remain unchanged. Existing spec edits require diff/review, never
silent overwrite or auto-execution after migration.

## Shared model target

serverless model_id is discovery identifier; dedicated catalog_model_ref,
deployment_ref, endpoint_ref and inference_model_id are distinct. The same model
reference can serve model playground and advanced agents. Endpoint references are
not URLs or permissions. Scope refs resolve distinct org/project values even when
provider IDs happen to match. fr-par is the currently reviewed scope, not a promise
that the provider can never support more regions.

max_output_tokens maps to verified Chat Completions max_tokens; unknown feature or
unsupported sampling parameter is a validation error, not silently filtered.
No native structured_output/provider parse baseline. prompt_json_local_validation
max_retries=5/max_physical_sends=6 is a ceiling within the same smaller parent budget;
transport retries consume it, and correction sends cannot use tools/replay the agent.

## Tool and content boundary

Specs carry tool/config/schema references only. Executable/config/argument effect
classification and grants come from trusted registries and host review, not model
text or file declarations. Raw args/results are not event bodies: immutable revisions
and approved result refs permit separately controlled inspection. text.delta is
untrusted, sanitized content for explicitly consented display only; no automatic
trace/session persistence. An event may never cause tool dispatch.

IPC initial slice routes intents by immutable content/selection references. Editable
prompt/agent document transport is intentionally not exposed here: host-owned text
editors/content registry create revisions under approved workspace reads. A future
webview edit transport must add a separately versioned bounded content contract;
this schema is not a complete Agent Builder UI or mandatory chat interface.

## Reproduce

npm ci --prefix tooling/contract-validation --ignore-scripts --registry=https://registry.npmjs.org/
tooling/contract-validation/node_modules/.bin/tsc -p tooling/contract-validation
node tooling/contract-validation/dist/validate.js
Python jsonschema==4.26.0: python tooling/contract-validation/validate.py
Compare JSON results from both commands. Default cases are offline and credential-free.
