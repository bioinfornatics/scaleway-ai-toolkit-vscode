# SC1 developer value validation protocol

> **Accord partiel du mainteneur — 2026-10-20 :** responsable de l’étude et des données confirmé ; comparaison extension/console+SDK jusqu’à exécution autonome, cible 8 participants consentants, 40 minutes par parcours, gain médian >=20% et >=3 minutes sans dégrader réussite/sécurité, données synthétiques et enregistrement désactivé acceptés. Consentements individuels, recrutement, critères détaillés de réussite, confidentialité/rétention/retrait et parcours de comparaison fonctionnels restent à finaliser. Les validations techniques provider ne sont pas une étude utilisateur. Le ticket .1.1 reste bloqué ; les mentions « not agreed » ci-dessous décrivent la proposition initiale et doivent être lues avec cet accord partiel.


Revision 0.1 — 2026-10-20. **PROPOSED protocol; not stakeholder-agreed, not executed.**
Owner task: scaleway_ai_vscode-jgh.1.1 (read-only reference; this document does not change Beads).
Authorities: [PRODUCT value hypothesis](../../PRODUCT.md#value), [experience EXP1](../experience.md#experiments), [SC1 journey](../experience.md#journeys), [validation entry point](README.md).

## 1. Decision and evidence boundary

Question: Does the VS Code extension reduce complete developer effort to obtain a useful, reproducible Scaleway model experiment compared with the existing console playground plus SDK workflow, without reducing success or safety?

The baseline may already be sufficient. Cross-tool friction, demand, task frequency, benefit and maintenance value are hypotheses, not observations. Documentation and agent walkthroughs are not representative-user evidence. No participants have been recruited, consent collected, sessions conducted, thresholds agreed, or visual sources approved by this document.

The current user authorizes implementation. This is not consent on behalf of representative developers, agreement to this study's thresholds, recruitment/access authorization, a credential grant, or a bounded cloud-spending mandate. Earlier planning-only wording in the task and PRODUCT is historical; the current implementation authorization does not resolve the separate study authorities. This file neither approves source visuals nor passes EXP1, EXP4 or G6.

**Current .1.1 verdict: BLOCKED on agreement**, not blocked on writing a protocol. Its acceptance criterion requires agreed access/consent, baseline, benefit target and guardrails. Observed results remain NOT RUN; an agreed protocol alone would not demonstrate developer value.

## 2. Ownership and approval before execution

| Responsibility | Required decision/evidence | Current status |
|---|---|---|
| Stakeholder/maintainer, decision owner | Accept target population, fair comparison, threshold and continue/change/stop rule | Not agreed |
| Study lead/facilitator | Named person, recruitment permissions, script, accessibility arrangements, scheduling | Not nominated |
| Representative developers | Individual voluntary participation and separately optional recording consent | No participants or consent |
| Account/operator owner | Least-privilege scope, destination, credentials delivery, inference limits, charges and cleanup mandate | No study mandate supplied |
| Privacy/data custodian | Named custodian, access list, lawful handling, retention, deletion/withdrawal route | Not nominated/agreed |
| Technical verifier | Pin working build, console path, SDK/dependencies, model support and success checker before recruitment | Not verified |

Record dated decisions and scope explicitly before scheduling. Organization or implementation permission cannot substitute for individual consent. No outreach, authenticated requests or billable actions follow automatically from this proposal.

## 3. Population, sample and study purpose — PROPOSED

Recruit developers who actually own model experimentation and delivery of runnable code and have authorized Scaleway access. Record coarse prior experience with VS Code, Scaleway console and the chosen SDK language; do not infer a researched persona from a job title. Include console/SDK-experienced developers, not only extension enthusiasts or project contributors. Accommodate keyboard/accessibility needs equally in both arms. The requesting maintainer or an agent can pilot mechanics, but is not a substitute for representative participants.

Propose **8 representative participants**, two in each of four order/task sequences below, for a directional formative comparison. This permits balanced order and inspection of individual pairs; it is not a powered efficacy study or population adoption estimate. Final recruitment criteria, sample size, compensation and feasibility require agreement. If access is limited, report that limitation and do not call maintainer-only testing representative research. A larger confirmatory study requires a separately justified sample/power plan informed by variability and practical effect size, not a post-hoc sample extension until the target passes.

## 4. Neutral task and identical success predicate

Neutral participant instruction (do not mention hoped-for speed savings):

> Using the assigned workflow and approved account, choose a supported text model, connect securely, test the supplied synthetic prompt with streaming output, save enough information to reproduce the experiment, and obtain a runnable SDK example. Review it and run it in a standalone terminal outside VS Code. Confirm that it uses the same prompt, model and supported settings. You may use the supplied official documentation. Tell us when finished or if you wish to stop.

Start each arm with the same trusted, empty **study-only** workspace, authorized account available, no stored connection in that arm, and the task envelope supplied. Account creation/contracting is an eligibility prerequisite outside SC1; record this exclusion and any operator preparation separately. Developer sign-in, credential acquisition/secure configuration, installs, dependency setup and troubleshooting needed after the start are timed, not silently precompleted. Shared machine prerequisites may be installed before both arms only if listed and identical; arm-specific installs and console navigation remain inside the clock.

Success requires all of the following, checked identically in both arms:

1. Correct approved account/project/region/endpoint selected; supported model and streaming capability verified, not guessed from a static catalog.
2. Synthetic prompt explicitly sent; incremental output observed and completed status distinguished from partial/cancelled/error. A single attractive answer is not a quality measure.
3. A local portable experiment record contains the exact synthetic messages, model identifier, endpoint reference, supported parameters, dependency/runtime versions and completion status, **without credentials**. Reload/review demonstrates it is sufficient to reproduce the input configuration.
4. Reviewed code (exported, adapted from the console's example, or written with official SDK documentation) plus run instructions/dependency lock are saved without overwriting edits or embedding credentials. Console artifacts need not match the extension's file format or UI.
5. From a fresh standalone OS terminal, **not VS Code's integrated terminal and not an extension command**, run the code with approved secure credential delivery and no extension APIs/process dependency. Confirm streaming completion against the saved configuration. Include terminal opening, install/configuration, execution, verification and all corrections in time.
6. Secret-handling and effect guardrails hold. Optional blinded artifact review uses anonymous arm labels and a common checklist.

Use two equivalent synthetic fixtures A and B, for example a short fictional event summary with three required facts and a concise requested output. Match token length, complexity and acceptance checks; validate equivalence in a mechanics pilot. No customer documents, repository code, personal data or copyrighted private material. Model wording need not be identical across repeats: check the required facts and input/configuration fidelity, not exact generated prose. Failure of content checks requires correction or honest failure in either arm.

## 5. Arms and fair console + SDK baseline

**E — Extension:** install/activate the pinned extension if required; connect through its supported secure flow; discover/select a model; set the supplied prompt/settings; explicitly stream; save/review; export the assigned SDK language; inspect code; execute independently as above.

**C — Console + SDK:** use the current authorized Scaleway console playground; navigate/sign in and select the same endpoint/model; configure the equivalent prompt/settings; explicitly stream; save a reproducibility record using native save/export if available or a permitted manual file; obtain the console's SDK snippet if available or use official SDK docs; adapt/review it; install dependencies and run independently as above. Copying examples and ordinary terminal/editor tools is allowed. Do not force developers to write everything from scratch, forbid baseline conveniences, or give E hidden preparation. No mandatory AI coding assistant in either arm; any additional aids must be agreed symmetrically and recorded before the study.

Same machine/network, account permissions, model, endpoint, request/token limits, prompt criteria, language and documentation access per pair. Choose Python or TypeScript before allocation, balancing familiarity and keeping language constant within each pair; report language-specific results rather than claiming an untested language works. Pin extension build and SDK/runtime/dependency versions; timestamp the console version/path and capability verification. No SC2 Strands tools, MCP, deployment, agents, hosting, retrieval or fine-tuning are needed for SC1.

Verify the actual console supports the assigned streaming path before enrollment. If it does not, report the mismatch and obtain an agreed comparison variant (such as console selection plus SDK streaming); do not invent console capabilities, secretly change the arm or claim like-for-like playground results. If E lacks runnable export, use a prototype only for formative usability, not end-to-end value evidence.

## 6. Counterbalanced paired procedure — PROPOSED

Each participant completes both arms; allocate equally, stratifying coarse baseline familiarity where feasible:

| Sequence | First timed task | Second timed task |
|---|---|---|
| 1 | E with fixture A | C with fixture B |
| 2 | C with fixture B | E with fixture A |
| 3 | E with fixture B | C with fixture A |
| 4 | C with fixture A | E with fixture B |

1. Complete consent, eligibility and approved account/budget checks without collecting secrets. Give equal neutral orientation and a short practice task distinct from A/B. Time/record orientation separately; it is not evidence of task benefit.
2. State the task and start the wall clock before workflow-specific setup. Observe with minimal interruption; use retrospective questions instead of continuous think-aloud that could distort timing. Both arms receive the same task envelope and allowed references.
3. Timestamp milestones: setup ready; scope/model verified; first stream complete; experiment saved; code reviewed; independent execution verified. Record errors, assistance, switching and waiting continuously.
4. Use a **PROPOSED 40-minute cap per arm**; stop sooner on withdrawal/safety breach. Record incomplete outcome and last milestone. Facilitator may intervene immediately for safety. Non-safety help follows an identical agreed escalation script and is labeled assisted, never unaided.
5. Take an equal break; reset study workspace, connection state and arm-specific credentials/caches without deleting personal files. Do not let the second arm reuse first-arm code, saved experiments, credentials or dependency preparation for free. Use isolated equivalent environments; list unavoidable shared OS/cache prerequisites and report their effects. Familiarity acquired in the first arm cannot be reset; counterbalancing and order reporting address it, not eliminate it.
6. Repeat with the other arm/fixture. Obtain a short post-arm ease/confidence rating and final neutral interview: what helped, what impeded, which workflow would be used next and why? Preferences are secondary self-report, not proof of benefit or adoption.
7. Verify artifacts, revoke/clear study credentials and check approved cleanup. Record overhead separately unless developer cleanup is a required step, in which case count it equally in both arms. No pre-existing resources are deleted.

Pilot the script and timers on synthetic/mock services first. Pilot or agent timings validate mechanics only and are excluded from representative results. Any protocol change after enrollment is versioned, justified and reported; material changes require renewed consent/approval and a new analysis cohort.

## 7. Measurements and analysis — PROPOSED, preregister before sessions

Primary metrics are **complete independent task success** and **total elapsed task time**, not time to the first response. Report setup, switching, export, standalone environment work, waiting and corrections; do not hide the external SDK work because it occurs outside VS Code.

| Measure | Operational definition |
|---|---|
| Unaided / assisted / incomplete success | Common predicate above, plus assistance status and cap/withdrawal reason |
| Total elapsed time | Start instruction through all verified deliverables; no removal of ordinary network/install waits |
| Active effort and wait time | Observed hands-on task work vs identifiable passive waiting, with ambiguous intervals labeled unknown |
| Setup and export costs | Milestone intervals, including secure credential setup and independent execution/configuration |
| Switching overhead | Count transitions among VS Code, browser/console, standalone terminal and documentation; duration only when observable, no invented estimate |
| Errors/corrections | Wrong scope/model/settings, install/export failures, retries, recoveries and facilitator interventions |
| Safety | Secret exposure or unsafe handling attempts, unapproved data/effects/spend, incidence and severity in each arm |
| Artifact utility | Config fidelity, reloadability, dependency/run instructions and successful standalone streaming check |
| Secondary experience | Same post-arm rating scale and qualitative comments; coarse prior familiarity and order |

For each participant with two successful arms, compute relative elapsed improvement **100 × (C time − E time) / C time** and absolute saving **C time − E time**. Report all paired rows (pseudonymous), medians, range/spread and counts, separated by order, fixture and assistance. Report active effort similarly as secondary analysis; a wait-driven speedup is not automatically less developer effort.

Do not erase failed/assisted sessions, replace failures with fast times, or report only successful pairs as the headline. Publish success counts for all consented completed sessions, incomplete/capped counts, safety stops and withdrawals consistent with consent. For capped arms report time as “at least 40 minutes; incomplete,” not completed at 40. A sensitivity summary may use the cap as a lower bound but is not a success-time estimate. Withdrawal data use depends on consent; don't assume missing values are zero. Site-wide outages may justify a reschedule under a predefined rule applied to both arms; preserve excluded-session counts and reasons. Unknown usage/cost remains unknown, not zero.

This small formative sample supports a directional decision, not statistical significance or generalized value claims. Include console-efficient counterexamples and learning/order effects. Report insufficient evidence if too few valid pairs remain; do not recruit selectively until a favorable median appears.

## 8. Benefit threshold — explicitly PROPOSED, NOT stakeholder-agreed

Candidate practical decision target for the proposed 8-participant formative study:

- At least **7 of 8 complete E unaided**, with E unaided successes no fewer than C.
- At least **6 participants complete both arms unaided** to interpret speed; fewer means insufficient comparative evidence.
- Across those paired unaided successes, **median relative elapsed improvement ≥20% AND median absolute saving ≥3 minutes**. These are separate median checks, not evidence of a particular participant distribution.
- E active-effort median does not exceed C; no material order-only explanation; artifact utility is not worse.
- **Zero secret exposures, unconsented transmissions or unauthorized effects** in E; no increase in unsafe handling attempts relative to C. Safety defects in C also stop that session; baseline insecurity is not permission to relax E safeguards.

Rationale: require both a relative and a practically noticeable absolute change in the complete workflow, plus success and safety, before investing in broad integration. The numbers are a starting point for negotiation, not measured baseline values, accepted commercial requirements or a power-derived boundary. The stakeholder must agree the practical benefit, success tolerance, sample/cap and evidence sufficiency **before** execution. If the agreed sample changes, explicitly revise counts/thresholds before data collection; do not silently scale them afterwards.

## 9. Consent, privacy and effect safety

Provide a plain-language consent sheet explaining comparison purpose, activities/duration, data captured, cloud recipient/region, cost payer, foreseeable risks, optional recording, confidentiality, retention, access and withdrawal contact. Participation is voluntary; refusal/withdrawal has no employment or access penalty. Compensation, if any, is not conditional on finishing or favorable feedback. Obtain individual consent before observation; obtain separate optional screen/audio recording consent. Declining recording must not exclude an otherwise eligible participant if manual observation suffices.

Default data: random participant ID, coarse experience bands, sequence, timings, checklist outcomes, redacted error categories and optional comments. **No automatic telemetry**, keystroke logging, shell history capture, raw credential headers, environment dumps, request dumps, full transcripts or real workspace contents. Capture no real names/emails in result files. Consent/contact records remain separate, access-restricted and never committed to this repository. Screen recording defaults off; if separately approved, exclude sign-in/secret entry and personal windows; pause before they appear. Recording cannot make secret capture acceptable.

Propose encrypted access-restricted local storage accessible only to the named study lead/custodian; raw notes/optional recordings deleted within **30 days after the decision**, contact/consent linkage deleted when no longer required under the agreed policy, and only non-identifying aggregate evidence retained. Actual retention, legal obligations, withdrawal deadline and deletion verification require custodian agreement before enrollment. Explain that withdrawal removes identifiable raw data until the disclosed anonymization cutoff; do not promise removal from irreversible aggregates. Avoid publishing quotes or granular subgroup data that identify people without separate permission.

Use only allowlisted synthetic study input. **No personal or business workspace data is read or sent**: no attachments, repository indexing, implicit context, .env reads, tool/MCP execution or customer prompts. Saved fixtures/artifacts are study-only synthetic data. Consent to study participation, workspace trust and permission to read files are not onward-transmission authority.

Each live arm requires a separate bounded mandate naming account/project/region/endpoint/model, intended synthetic requests, allowed catalog reads, recipient, validity period, max requests/tokens/time/concurrency and hard currency exposure including cancellations/retries/standalone reruns. The operator approves who pays and secure credential delivery. Verify current pricing and enforceable limits; if price/exposure is unknown, do not send. Navigation must not initiate inference; each Send/run is explicit. Local consent is not cloud account authority.

Use least-privilege study credentials held in the extension's secure storage or approved OS/process secret facility for SDK execution. Never put credentials in code, workspace files, command-line arguments/history, webviews, screenshots, logs or evidence; never ask participants to paste keys into the study form. No deployment/resource creation, IAM changes, credential broadening, publishing or cloud hosting is in scope. Cleanup/revocation is limited to explicitly approved study artifacts/credentials, not automatic cloud deletion.

Allow cancel/stop and revocation; cancel does not prove remote requests or charges were undone. Unknown external outcomes freeze further requests pending approved reconciliation, never blind retry. On leak/unapproved effect: stop both collection and new effects, isolate evidence without spreading the secret, notify the owner/custodian, revoke credentials under authority and document only sanitized facts. Mock/dry-run checks can establish mechanics/safety coverage, not live developer value. Live permission-denial/recovery injection requires a separate reviewed mandate; never intentionally leak real secrets to test handling.

## 10. Continue / change / stop decision rubric

| Decision | Evidence required | Consequence |
|---|---|---|
| **Continue** | Agreed protocol executed with representative consented users; practical benefit/success thresholds met; safety guardrails hold; useful independent artifacts; order/failure limitations disclosed | Proceed to next bounded product validation. Do not imply source approval, production/cloud mandate, generalized adoption, EXP4/G6 pass or demand for SC2/SC3 |
| **Change** | Benefit limited to a subtask, assisted completion dominates, exports/setup offset playground gains, order/familiarity explains advantage, or evidence insufficient | Narrow/fix scope, revise the hypothesis and preregister a new comparison. Keep failures and counterevidence; do not retrospectively lower targets |
| **Stop** | Adequate agreed comparison shows no meaningful complete-task gain or worse utility/success; unacceptable safety/privacy cost; account/participant authority unavailable or withdrawn | Stop the study or product investment as appropriate; preserve sanitized rationale and honor deletion/cleanup. Baseline sufficiency is a legitimate outcome |
| **Blocked / not run** | Required agreement, consent, access, fair working paths or measurable criteria absent | No value verdict. Report exact missing decisions; implementation/dry-run activity cannot fill the evidence gap |

## 11. Unresolved decisions and honest .1.1 handoff

1. Who is the named study lead, privacy custodian and final value decision owner, and who can authorize recruitment?
2. Which representative population, language/familiarity mix, sample, accessibility support and compensation are approved? No representative participants currently consented.
3. Are C/E task equivalence, setup boundary, four sequences, common artifact checker, assistance policy, 40-minute cap and outage/exclusion rules agreed?
4. Are the **PROPOSED** 20% plus 3-minute median benefit, success counts, active-effort condition and safety guardrails accepted, changed or rejected before measurement?
5. Which real console/SDK path, pinned working extension, model/streaming contract and standalone export have been verified? Who supplies the authorized account and bounded inference/budget mandate?
6. What privacy notice, recording opt-in, storage/access, retention and withdrawal/deletion policy are approved, and where will sanitized observed evidence be held?
7. What dated agreement record will satisfy .1.1, and what later evidence/approval is required to evaluate value and visual/prototype quality separately?

**Document complete as a proposal; .1.1 remains BLOCKED on these agreements.** No user-value evidence, participants, consent, approved threshold, visual approval or study execution is claimed. No Beads status change, cloud action, commit or push is performed by this specification.
