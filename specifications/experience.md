# Experience rationale and service blueprint

Revision 0.1. Hypothesis, not observed UX research. Machine declarations: [design contract](design-contract.json) and [experience blueprint](experience-blueprint.json).

<a id="service-blueprint"></a>
## Shared service blueprint

| Moment | Developer lane | Operator/maintainer lane | Backstage/system | Result and recovery |
|---|---|---|---|---|
| Connect | Select approved connection and model destination | Supply least-privilege access/policy | SecretStorage, scope-aware discovery/cache | Authorized context or explicit credential/permission failure; no secret echo |
| Experiment | Choose model, edit prompt, stream, save/export | Control spend and data policy | Capability-aware inference, abort, origin-bound results | Runnable example; partial/cancelled state never reported as complete |
| Build locally | Configure portable Strands agent spec and tools, inspect execution | Approve bounded tool mandate | Strands Python wrapper, Workspace Trust, MCP policy, normalized events | Reproducible local agent; stop/reconcile tool errors without losing edits |
| Evaluate | Compare dataset cases and inspect failures | Agree safety/quality acceptance | Bounded evaluation runner, metrics and redaction | Versioned results; missing/partial metrics not zero |
| Deploy | Review configuration and activate authorized deployment | Approve budget/exposure/license and target | Registry, hosting/inference APIs, resource ledger | Provider acceptance then health evidence; reconcile partial provisioning |
| Operate | Inspect chat/tool run and return to code | Monitor and clean up resources | Shared event protocol, Cockpit/log integration | Correlated evidence and resource deletion verification; unknown effects shown |

<a id="journeys"></a>
## Coverage and journey boundaries

SC1 (developer, MVP): trigger = need to try a Scaleway model; start = trusted VS Code workspace, account available, no stored connection; end = saved experiment and exported example successfully run outside VS Code. Common scenario: synthetic non-sensitive text prompt, one verified text model; no customer documents or hardcoded live model availability. Cover disconnected, connecting, permission-denied, catalog loading/unknown/empty, ready, streaming, cancelled/partial/error, saved and export-review states.
SC2 (developer, phase 2): start = successful saved experiment; end = bounded tool-using local agent inspected and evaluated against saved cases. Critical recovery: untrusted workspace, revoked tool permission, timeouts, malformed tool output, budget exhaustion and interrupted evaluation.
SC3 (operator, phase 3): start = reviewed evaluated application/spec version and authorized deployment mandate; end = verified hosted response and trace plus tested cleanup path. Critical recovery: unavailable quota, private-network reachability, partial provisioning, unknown image/deploy effect and failed cleanup.
Coverage: SC1 is the first design slice; SC2 and SC3 are deliberately deferred for visual exploration until contracts are stable, not excluded from the product. Fine-tuning/retrieval are outside the first slice.

<a id="layout-rationale"></a>
## Information architecture and reasons

My Resources answers what exists in the selected cloud/local scope. Developer Tools answers what action comes next. Keep both as native sidebar trees; show only implemented features. A focused editor playground owns prompt, parameters, result and export rather than forcing users into a permanent transcript sidebar. Model capability details, raw traces and advanced parameters are progressive details. Scope is visible near actions because wrong-account execution is costly. Native VS Code theming and components preserve familiarity; no official Scaleway visual-conformity claim.
The supplied Foundry screenshot is an information-architecture reference, not approval of a complete Scaleway journey. Rejected: copying all menus with placeholders (false functionality); generic marketing dashboard (wrong task); mandatory conversational navigation (less direct than existing controls).

<a id="intent-and-safety"></a>
## Intent, opportunities and exceptions

Playground conversation is scoped model testing, not a general assistant running cloud commands. Intent locations: compare in catalog/results, prepare in prompt/spec editor, inspect in run details, activate deployment in its exact-version review. Direct controls remain available. Preserve manual edits and navigation/scope/period/filter/object/origin/return context; late results attach to originating run, never seize focus.
Proactive opportunities (automatic recommendations or scheduled agent work) are deferred: no evidenced trigger or mandate. Exceptions (credential failure, tool policy denial, budget exhaustion and ambiguous external effects) are in-scope contextual recovery. No autonomous provisioning. Within an explicitly approved local tool mandate the loop may execute eligible tools up to its limits, with stop available and reconciliation after uncertainty.
Editable artifacts are prompt/spec/code/evaluation files. Presentations/decks are not a feature. Generated code requires diff review and must not overwrite user edits.

<a id="experiments"></a>
## Decision-changing tests — not run

EXP1 value: compare complete SC1 against console playground + SDK script, including setup, verification and correction. Owner: stakeholder/maintainer to nominate study lead. Baseline: task success, total effort/time, switching and secret-handling errors, currently unmeasured. Target improvement threshold and participant access unknown; agree before execution. Guardrail: no secret leakage or increase in unsafe actions. Method: representative developers perform neutral equivalent tasks with non-sensitive data, consent and privacy arrangements. Sample/duration rationale deferred until access and study goal agreed. Continue if agreed benefit and guardrails hold; change scope if only a subtask benefits; stop if no meaningful gain or unacceptable safety cost. Counterevidence: console/SDK may already solve the task efficiently. Not executable user study yet.
EXP2 feasibility: verify real provider contracts with an authorized test account and budget, record schemas/capabilities/recovery results without secrets. Continue only when supported path exists; disable unsupported features or change adapter if incompatible. No authenticated spike executed.
EXP3 hosting: smallest streaming stateless agent on proposed target, test timeout/concurrency/session/network limits, cancellation and resource cleanup under approved budget. Change target to suitable compute if incompatible. No cloud resource created.
EXP4 usability: after complete selected sources and scoped prototype approval, verify unaided SC1 success/error recovery with representative users. Agent walkthrough and structural validators are not user research. G6 cannot pass without agreed thresholds and actual evidence.
