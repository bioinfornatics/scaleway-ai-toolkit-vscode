# Beads / Entire coordination contract

Established2026-10-21 by stakeholder request. Workflow contract, not a parallel backlog. **Beads owns work/status/blockers; Git owns code; Entire owns session/checkpoint context.** Tracking state never grants authority or proves correctness.

## Task hierarchy and acceptance

Epic = product outcome/phase, not execution target. Story/requirement = user outcome and full acceptance. Executable leaf = bounded result, one primary context, named specifications/references/scope. Keep IDs and phase parents stable. Link shared implementation to its acceptance owner; no duplicate transport/export code. Parent-child/related links do not replace genuine blockers.

Each leaf records outcome/owner, included scope/exclusions, probable modules and file-ownership constraints, genuine dependencies, authority (local/mock, account reads, inference/spend, writes/destruction), measurable acceptance/evidence level, and handoff (files/tests/limits/next task/session/checkpoint if actually created).

Split on result or authority, not one file per ticket. Installed mocked QA and authorized live testing are separate. Missing external approval is a blocked decision; live task depends on it. Preserve production gates; local completion does not imply full-story acceptance. Labels/metadata are selection aids, not permissions.

## Selecting work

Suggested local queue:

    bd prime
    bd ready --label local-only --exclude-label requires-approval --exclude-label coordination --exclude-type epic
    bd show <ticket>
    bd update <ticket> --claim

Filter covers labelled tasks, not every legitimate local task. Inspect description, dependencies and current authority first. Aggregates carry coordination label, avoiding them even when their existing type is task. Missing-approval live work must not appear in this queue.

## Session boundaries

One implementation session = one primary executable task or tightly coupled cluster with shared acceptance. Keep its bugfixes/tests/docs together. Start a fresh agent conversation for new outcome/domain/authority or resumption after handoff; not each file/tool call. Coordination/review can have a separate task/session.

Commit and session boundaries differ: session can yield several focused commits/checkpoints; checkpoint can include multiple sessions. No forced one-to-one mapping or automatic commit/push.

EntireCLI0.11.5 observes the agent session; it is not a generic launcher for a new Goose conversation. Start the conversation in the agent UI, then verify identity. No agent-specific launch command defined here.

## Mandatory boundary notice to the user

At each completed or blocked tranche, at handoff, and before changing the primary task/domain/authority, the agent explicitly reports these four fields. Do not silently continue with a new workstream just because there is remaining budget. During unrelated explanation-only turns, avoid repeating a full dirty inventory unnecessarily.

- **Session**: keep current session or recommend a fresh conversation; name the reason and next primary Beads task. New outcome/authority/domain/context overload calls for a fresh session; finishing tests/corrections/docs for the same acceptance stays together. Warn before beginning that next tranche. Do not manufacture a new Entire ID or stop an active conversation.
- **Commit**: recommended now, not ready, or not needed; state the coherent validated scope, remaining checks and whether authority has been granted. Recommend a focused commit once a slice is coherent/reviewed and relevant checks pass, ideally before unrelated implementation or switching branches/worktrees. A completed local slice may be committed while installed/live acceptance remains open if those limits are documented. Recommendation is not permission: never commit/push without explicit authority. No forced commit per file/ticket. Existing dirty mixed work requires hunk/ownership review, no blanket staging. If no commit, record pending state and handoff; session stop does not flush it.
- **Files**: list exact paths modified/created for the just-completed tranche; distinguish pre-existing dirty files and shared-file overlap rather than claiming all git status as agent-authored. For large sets group paths with a precise Beads/evidence inventory reference. Mention validation and unresolved failures.
- **Next actions**: give the ordered concrete next step and Beads ID, prerequisites/approval and blockers. Distinguish actions the agent completed from actions still proposed for user approval/new conversation.

Use a compact closing block, for example: Session: change before <task> (reason); Commit: recommend <scope>, approval pending; Files: <paths>; Next: <Beads ID + action/blocker>. Durable handoff stays in Beads. This request does not authorize automated notifications/hooks, source changes outside the task, commits, pushes, or Entire mutation.

## Start-of-session brief

First prompt includes primary Beads ID, bounded outcome, references/evidence, allowed operations, exclusions, acceptance and dirty-workspace handoff. Inspect/claim before implementation; no concurrent same-file edits.

    bd prime
    bd show <ticket>
    git status --short
    entire session current --json

Check resolution/identity before recording (ancestry/caller vs other-worktree fallback). Store session ID in notes or custom metadata via --set-metadata; do not use bd update --session as generic Entire link (CLI describes Claude-specific field).

## Handoff and close

1. Record files, tests/evidence, limits/blockers in Beads. Durable memory via Beads, no MEMORY.md/task checklist files.
2. Close only satisfied leaf acceptance; installed/live/full requirements remain open if unverified.
3. Review git status/diff. Commit only when explicitly authorized; stage paths/hunks and include Beads ID in focused message. No git add . across mixed work. Push/Dolt sync separately authorized.
4. For a linked commit, inspect actual checkpoint and record ID/commit in Beads. Otherwise record checkpoint not_created and uncommitted changes; never fabricate a session-to-HEAD link.
5. Hand off and start next agent conversation with task brief. Conversation ending differs from Entire state cleanup.

Read-only tracking:

    entire status
    entire checkpoint list --pending --no-pager
    entire checkpoint list --no-pager
    entire checkpoint explain --commit <commit> --no-pager

entire session stop only marks tracking ended: no checkpoint/code save. Do not stop an active conversation automatically. attach can rewrite unpushed commits or push checkpoint for already-pushed commit; not harmless handoff. No automatic attach/resume/doctor --force/generate. resume may change Git; inspect dirty work. generate/dispatch can spend tokens. Cloud search/publishing require privacy review.

## Privacy and source of truth

Entire git-refs backend; telemetry=false does not disable transcript sync on Git push. Redaction is safety net. No credentials, customer data or private prompt payload in handoff. Beads Dolt refs separate from Git code and Entire checkpoint refs; no normal JSONL import, no broad ref push. Conservative repository policy: no commit/push/Dolt remote sync without authority.

References: installed entire help0.11.5; official [capture](https://docs.entire.io/guides/checkpoints/capture-checkpoints), [storage](https://docs.entire.io/guides/checkpoints/checkpoint-storage), [security](https://docs.entire.io/security).
