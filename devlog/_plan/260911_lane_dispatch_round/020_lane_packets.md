# Lane dispatch packets — 260911

Seven implementation lanes, one Codex thread each, one worktree each, dispatched in one round.
They run concurrently because their file territories do not intersect (`010_lane_partition.md`).

## Shared frame

Every packet carries this frame; only `SCOPE` differs.

**Repository.** Your worktree is listed in your packet. It is already checked out on your lane
branch, cut from `origin/dev` `6d3ad12e3` (2.51.0). Work only there. Do not `git worktree add`,
move, or remove any worktree, and do not touch another lane's directory.

**Loop.** Run `$codexclaw:cxc-loop` as HOTL for your lane's scope: one work-phase per issue in your
stack, in the given order. Your goal ends when your last PR is green and reported, not when you
think the code is right.

**Subagents.** Unlimited `xai/grok-4.6` subagents, read-only. Use them to reproduce, to read the
call sites you are about to change, to hunt for a second caller of the same helper, and to audit
your own diff adversarially before you push. A subagent finding enters your work only with an exact
`path:line` anchor. Subagents never write, commit, push, or call a mutating `gh`.

**MUST NOT.**

- No local product suite: no `bun test`, no `bun run test`, no `bun run test:changed`, no
  `bun run typecheck`, no `bun run build:gui`, no `bun install`. Report them as `NOT RUN`.
- No merge, no release, no force-push to any shared branch, no direct push to `dev`.
- No edits to `scripts/test-layout/layout.json`, `tests/fixtures/test-layout-expected.json`, or
  `gui/src/i18n/*`. Name new test files `tests/<domain>/<name>.test.ts` so the layout regex seeds
  place them. If you believe you need one of those files, stop and report instead.
- No file outside your lane's territory. A change that needs another lane's file is a report, not a
  patch.
- No security write-up in `devlog/`; scratch space only, per `AGENTS.md`.

**MUST.**

- Prefix every mutating git command with `git -c core.hooksPath=/dev/null`. This repository's hooks
  can start a GUI install, typecheck, and build, which the no-local-suite rule forbids.
- Push with `--no-verify`.
- Write the focused regression test that `AGENTS.md` requires for a behaviour change, in the domain
  directory next to the existing tests for that subsystem. You will not run it; hosted CI will.
- Fill every section of `.github/PULL_REQUEST_TEMPLATE.md`. Put `Closes #<issue>` in the body. In
  **Verification**, state plainly that local suite, typecheck, and build were `NOT RUN` by operator
  instruction and that hosted CI on the exact pushed head is the proof.
- When you carry, supersede, or reimplement another author's pull request, add a `Co-authored-by`
  trailer naming that author in a branch commit. Resolve the address with
  `gh api users/<login> --jq '.id'` and use `<id>+<login>@users.noreply.github.com`. Prose is not a
  substitute; `.github/scripts/pr-carry-attribution.cjs` reads the trailer.
- Keep a devlog unit for your lane under `devlog/_plan/260911_l<N>_<slug>/`, with the plan, the
  evidence you actually captured, and the decision you made where the issue left room.

**Stacking.** Your first PR targets `dev`. Your second targets your first PR's head branch, your
third targets your second. `enforce-target` allows that for children of an open parent. After a
parent lands, retarget the child to `dev`. Do not register a native GitHub stack.

**Stop conditions.** Stop and report, do not decide, when: the fix requires a policy the issue does
not already fix; the change would touch another lane's territory; a locale key or a layout-json entry
turns out to be unavoidable; or hosted CI fails for a reason outside your diff.

**Report format to the orchestrator.** For each PR: number, exact head SHA, the CI run id and its
conclusion, the issue it closes, the co-authors credited, and anything you decided that the issue
left open. Say `NOT RUN` for local checks; never imply a suite you did not run.

**Decision boundary.** You do not merge. You do not close another author's PR. You do not rank your
lane against another. When your last PR is green, report and stop.

## L1 — responses and tool contract

Worktree `~/.codex/worktrees/260911-l1/opencodex`, branch `codex/260911-l1-responses-core`.

1. **#4172 — OpenCode Go sessionless requests omit `x-opencode-session`.** The issue fixes the
   expected behaviour precisely: every request routed to the canonical Go destination carries the
   header; a request with real conversation identity keeps its stable per-conversation value; a
   request with no identity gets an isolated per-request value rather than none and rather than one
   shared global id; an explicitly supplied header still wins. Carry PR #4184 by `chilung-cgu`,
   which is at `CHANGES_REQUESTED` — read the review first and decide what survives. This is the
   most urgent item in the round: upstream ended the grace period on 09/06 and now errors on
   requests without the header, which is recorded with its source in the issue comments.
2. **#4176 — a routed provider prefixes a bare Codex tool with `default.`,** and
   `default.view_image` is then rejected as undeclared. Two competing pull requests exist and both
   are at `CHANGES_REQUESTED`: #4181 by `chilung-cgu` normalizes the invented prefix back at the
   undeclared-tool guard, #4171 by `rrmlima` handles the code-mode `view_image` call through unified
   exec. Land one coherent fix, credit both authors, and say in the PR body why the other shape was
   not taken.

Territory: `src/server/responses/*`, `src/server/chat-completions.ts`, `src/server/claude-messages.ts`,
`src/server/request-log-conversation.ts`, `src/server/responses-undeclared-tool-guard.ts`,
`src/providers/opencode-go-transport.ts`, `src/types/tools.ts`,
`src/responses/code-mode-helper-compat.ts`.

`src/server/responses/core.ts` is the most contended file in the repository — four open PRs touch
it. Keep the diff minimal, do not reformat, and do not opportunistically clean up around your change.

## L2 — catalog and provider compatibility

Worktree `~/.codex/worktrees/260911-l2/opencodex`, branch `codex/260911-l2-catalog-provider`.

1. **#4201 — BigModel Responses Coding Plan: missing quota probe and GLM-5.3-Flash catalog support.**
   A provider-compatibility report from `bluesmilery`. #4210 by `Ingwannu` is an open draft
   restoring BigModel preset quota visibility; read it before you write anything and either build on
   it with attribution or stay clear of it.
2. **#4207 — the connected catalog reports success while the local Codex CLI rejects unsupported
   reasoning levels.** Related to #3775, which is the same rejection seen from the CLI side.

Territory: `src/providers/quota*.ts`, `src/codex/catalog/*`, provider preset definitions.

`src/providers/quota.ts` is contended by four open PRs. Prefer a preset or catalog-side fix; if the
change genuinely belongs in `quota.ts`, keep it surgical and name the overlap in your report.

## L3 — Codex account pool

Worktree `~/.codex/worktrees/260911-l3/opencodex`, branch `codex/260911-l3-account-pool`.

1. **#4126 — a newly created ChatGPT Free account fails Codex warmup with HTTP 404.** Carry PR
   #4188 by `chilung-cgu`, which retries warmup with `gpt-5.6-luna` on 400 and 404; it was reset to
   draft by the readiness gate, not rejected on merit.
2. **#4212 — an account stuck on a failed credential refresh silently drops its models.** The ask is
   attribution, not new routing: when a model disappears or a request is refused because an account
   is unusable, name the account and the reason on the surfaces the operator already reads.
3. **#4211 — keep Free-tier accounts out of pool selection.** Opt-in, default off, so an existing
   install sees no behaviour change. This is the one place in this round where a lane may add a
   configuration field, and only the key the issue names.

Territory: `src/codex/account-*.ts`, `src/codex/plan.ts`, `src/codex/plan-from-token.ts`,
`src/codex/warmup.ts`, `src/codex/model-entitlements.ts`, `src/codex/account-pause.ts`.

## L4 — service, update, and operator CLI

Worktree `~/.codex/worktrees/260911-l4/opencodex`, branch `codex/260911-l4-service-cli`.

1. **#4202 — global pnpm installations cannot self-update.** Carry PR #4203 by `oliver-mee`
   (`CHANGES_REQUESTED`, 20 files). Trim it to the defect; a self-update path is not the place for
   adjacent refactoring.
2. **#4169 — every stop refusal is reported as a `CODEX_HOME` ownership mismatch,** hiding
   `respawnable_service` and looping the operator. Carry PR #4170 by `yeongjunyoo`.
3. **#4204 — Windows: a stale persisted CLI 0.135.0 strips max/ultra while Codex Desktop runs
   0.153.4.** #4178 by `luvs01` is review-ready with full CI green and already owns
   `src/codex/cli-install-provenance.ts`. Do not duplicate it: if it lands first, rebase onto it;
   otherwise keep your change out of that file and say so.

Territory: `src/update/*`, `src/service*.ts`, `src/cli/*`, and the stop/ownership refusal paths.

## L5 — file IO and client integrations

Worktree `~/.codex/worktrees/260911-l5/opencodex`, branch `codex/260911-l5-integrations-io`.

1. **#4197 — the DSH integration's atomic replace changes file ownership and causes `EACCES` across
   UIDs.** The issue already argues the safe shape: do not relax the global `0600` hardening in
   `atomic-write.ts`; refuse the integration write when the target exists and its owner is not the
   process euid, and only then consider a metadata-preserving replace. Decide which of the two you
   ship and justify it.
2. **#4214 — add Cline as a supported client integration.** Follow the existing registry pattern in
   `src/integrations/registry.ts`; do not invent a parallel mechanism.

Territory: `src/config/atomic-write.ts`, `src/integrations/*`. No open PR touches either, so this
lane is free to move fastest.

## L6 — streaming and vendor tool leakage

Worktree `~/.codex/worktrees/260911-l6/opencodex`, branch `codex/260911-l6-streaming-tools`.

1. **#4191 — a long Codex thread fails only through the proxy** (WS 1006 / response prelude
   timeout) while the bypass works immediately. Your first deliverable is a reproduction, not a
   patch: establish what input length and timing reproduce it and where the prelude budget is
   actually spent. If the cause lands inside L1's territory, stop and report rather than editing it.
2. **#4190 — vendor CLI agent scaffolding leaks into routed output** for `qoder`: an MCP
   lazy-loading reminder and tool-call markup reach the user.

## L7 — documentation

Worktree `~/.codex/worktrees/260911-l7/opencodex`, branch `codex/260911-l7-docs`.

1. **#4215 — state whether each provider login consumes a subscription allowance or bills per
   token.** Write the rule per authentication mode, then one explicit line per provider that
   supports both.
2. **#4200 — the remote hub guide breaks on a fresh config** (nested `ocx config set` fails when the
   parent object is absent) and has no macOS data-plane TLS example. Fix the English source first;
   translations are a follow-up, not a blocker.

Territory: `docs-site/**` only. No `src` change belongs in this lane.

