# Lane dispatch packets — 260911 (revision 2, after audit round 1)

Seven implementation lanes, one Codex thread each, one worktree each, dispatched in one round.
Territories are explicit file lists so that no two lanes own the same file; revision 1 used globs
and audit round 1 found two silent overlaps (`030_audit_round1.md`).

## Shared frame

**Repository.** Your worktree is named in your packet, already checked out on your lane branch, cut
from `origin/dev` `6d3ad12e3` (2.51.0). Work only there. Do not add, move, or remove a worktree, and
do not open another lane's directory.

**Loop.** Run `$codexclaw:cxc-loop` as HOTL for your lane: one work-phase per issue, in the given
order. Your goal ends when your last PR is green and reported, not when the code looks right.

**Subagents.** Unlimited `xai/grok-4.6` subagents, read-only, spawned with `spawn_agent`
(`model: "xai/grok-4.6"`). Use them to reproduce, to read the call sites you are about to change,
to find a second caller of a helper you are touching, and to review your own staged diff
adversarially before you push. A finding enters your work only with an exact `path:line` anchor.
Subagents never write, commit, push, or call a mutating `gh`. Treat a `fail` verdict the way this
round did: fold it in and re-audit, do not argue with it.

**MUST NOT.**

- No local product suite: no `bun test`, no `bun run test`, no `bun run test:changed`, no
  `bun run typecheck`, no `bun run build:gui`, no `bun install`. Report them as `NOT RUN`.
- No merge, no release, no force-push to a shared branch, no direct push to `dev`.
- No file outside your owned list. A fix that needs another lane's file is a report, not a patch.
- No locale key in `gui/src/i18n/*`. If you need one, stop and report.
- No security write-up in `devlog/`; scratch space only, per `AGENTS.md`.

**MUST.**

- Prefix every mutating git command with `git -c core.hooksPath=/dev/null`. This repository's hooks
  can start a GUI install, typecheck, and build, which the no-local-suite rule forbids.
- Push with `--no-verify`.
- Write the focused regression test `AGENTS.md` requires for a behaviour change, in the domain
  directory beside the existing tests for that subsystem, and register it in both
  `scripts/test-layout/layout.json` `explicit` and `tests/fixtures/test-layout-expected.json`. You
  will not run it; hosted CI will. Those two maps are append-only lists and other lanes are adding to
  them too — the orchestrator resolves the conflicts at merge, so do not skip the entry.
- Fill every section of `.github/PULL_REQUEST_TEMPLATE.md` and put `Closes #<issue>` in the body. In
  **Verification**, state plainly that the local suite, typecheck, and build were `NOT RUN` by
  operator instruction and that hosted CI on the exact pushed head is the proof.
- When you carry, supersede, or reimplement another author's PR, add a `Co-authored-by` trailer in a
  branch commit. Resolve the address with `gh api users/<login> --jq '.id'` and use
  `<id>+<login>@users.noreply.github.com`. Prose is not a substitute;
  `.github/scripts/pr-carry-attribution.cjs` reads the trailer.
- Keep a devlog unit under `devlog/_plan/260911_l<N>_<slug>/` with your plan, the evidence you
  actually captured, and any decision the issue left open.

**Stacking.** Your first PR targets `dev`; your second targets your first PR's head branch, your
third targets your second. `enforce-target` allows that for children of an open parent. Retarget a
child to `dev` after its parent lands. No native GitHub stacks.

**Decisions already made for you.** Audit round 1 found six items where the issue left a real choice
open, which would have made the lane decide maintainer policy. Those calls are recorded in your
packet. Implement the recorded decision; if you believe it is wrong, report the reason and stop.

**Stop conditions.** Stop and report when the fix needs a file you do not own, when it needs a policy
no issue has fixed, when a locale key turns out to be unavoidable, or when hosted CI fails for a
reason outside your diff.

**Report format.** Per PR: number, exact head SHA, CI run id and conclusion, the issue it closes, the
co-authors credited, and any decision you made. Say `NOT RUN` for local checks; never imply a suite
you did not run.

**Decision boundary.** You do not merge, do not close another author's PR, and do not rank your lane
against another. When your last PR is green, report and stop.

## L1 — Responses pipeline and tool contract

Worktree `~/.codex/worktrees/260911-l1/opencodex`, branch `codex/260911-l1-responses-core`.

Owned files: `src/server/responses/core.ts`, `compact.ts`, `policy-fallback.ts`,
`src/server/chat-completions.ts`, `src/server/claude-messages.ts`,
`src/server/request-log-conversation.ts`, `src/server/responses-undeclared-tool-guard.ts`,
`src/providers/opencode-go-transport.ts`, `src/types/tools.ts`. You do **not** own
`codex-ws-exchange.ts`, `codex-ws-wire.ts` (L6) or `codex-auth-error.ts` (L3).

1. **#4172 — OpenCode Go sessionless requests omit `x-opencode-session`.** The issue fixes the
   expected behaviour: every request routed to the canonical Go destination carries the header; a
   request with real conversation identity keeps its stable per-conversation value; a request with
   no identity gets an isolated per-request value rather than none and rather than one shared global
   id; an explicitly supplied header still wins. Carry PR #4184 by `chilung-cgu` (open, not a draft,
   `CHANGES_REQUESTED`) — read the review before rewriting. Most urgent item in the round: upstream
   ended the grace period on 09/06 and now errors on requests without the header.
2. **#4176 — a routed provider prefixes a bare Codex tool with `default.`,** and
   `default.view_image` is rejected as undeclared. **Decision: normalize the invented prefix back at
   the undeclared-tool guard**, the #4181 shape, because that is the expected behaviour the issue
   states. #4181 by `chilung-cgu` is open, not a draft, `CHANGES_REQUESTED`; #4171 by `rrmlima` is a
   **draft** at `CHANGES_REQUESTED` and its unified-exec rewrite is out of round scope. Credit
   `rrmlima` only if you reuse code from #4171.

`core.ts` is the most contended file in the repository — four open PRs touch it. Keep the diff
minimal and do not reformat around your change.

## L2 — provider quota and catalog

Worktree `~/.codex/worktrees/260911-l2/opencodex`, branch `codex/260911-l2-catalog-provider`.

Owned files: `src/providers/quota*.ts`, BigModel preset definitions, `src/codex/catalog/*` except
`effort.ts` (L4).

1. **#4201 — BigModel Responses Coding Plan: missing quota probe and GLM-5.3-Flash catalog support.**
   A provider-compatibility report from `bluesmilery`. #4210 by `Ingwannu` is an **open draft** at
   `REVIEW_REQUIRED` restoring BigModel preset quota visibility, and it also touches
   `docs-site/**/guides/providers.md`. Read it first and either build on it with attribution or stay
   clear of it.

`src/providers/quota.ts` is contended by four open PRs. Prefer a preset or catalog-side fix; if the
change genuinely belongs in `quota.ts`, keep it surgical and name the overlap in your report.

## L3 — Codex account pool

Worktree `~/.codex/worktrees/260911-l3/opencodex`, branch `codex/260911-l3-account-pool`.

Owned files: `src/codex/account-*.ts`, `plan.ts`, `plan-from-token.ts`, `warmup.ts`,
`model-entitlements.ts`, `src/server/responses/codex-auth-error.ts`, and one key in `src/config.ts`.

1. **#4126 — a newly created ChatGPT Free account fails Codex warmup with HTTP 404.** Carry PR #4188
   by `chilung-cgu` (open **draft**, `REVIEW_REQUIRED`, reset by the readiness gate rather than
   rejected on merit). It also carries eight `docs-site/**/guides/codex-integration.md` files; keep
   the documentation that describes this change.
2. **#4212 — an account stuck on a failed credential refresh silently drops its models.** The ask is
   attribution, not new routing: when a model disappears or a request is refused because an account
   is unusable, name the account and the reason where the operator already looks. The refusal string
   lives at `src/server/responses/codex-auth-error.ts:35`, which is yours for this round.
3. **#4211 — keep Free-tier accounts out of pool selection.** **Decision: ship**
   **`codexPool.excludedPlans` as an array, absent by default**, so an existing install sees no
   behaviour change. Do not ship `minimumPlan`: ranking plans needs an ordering this repository does
   not have.

## L4 — service, update, CLI, and connected client

Worktree `~/.codex/worktrees/260911-l4/opencodex`, branch `codex/260911-l4-service-cli`.

Owned files: `src/update/*`, `src/service*.ts`, `src/cli/*`, `src/client/*`,
`src/lib/process-control.ts`, `src/codex/catalog/effort.ts`, `src/codex/cli-install-provenance.ts`.

1. **#4202 — global pnpm installations cannot self-update.** Carry PR #4203 by `oliver-mee` (open
   **draft**, `CHANGES_REQUESTED`, **36 files**). **Decision: trim to the pnpm self-update path plus
   the tests and the one documentation page that path requires.**
2. **#4169 — every stop refusal is reported as a `CODEX_HOME` ownership mismatch,** hiding
   `respawnable_service` and looping the operator. Carry PR #4170 by `yeongjunyoo` (open **draft**,
   `REVIEW_REQUIRED`); it touches `src/lib/process-control.ts`, which you own.
3. **#4204 — Windows: a stale persisted CLI 0.135.0 strips max/ultra while Desktop runs 0.153.4.**
   The clamp is `src/codex/catalog/effort.ts:441`. #4178 by `luvs01` is open, not a draft, with full
   CI green and already owns `src/codex/cli-install-provenance.ts`: if it lands first, rebase onto
   it; otherwise keep your change out of that file and say so.
4. **#4207 — the connected catalog reports success while the local Codex CLI rejects unsupported
   reasoning levels.** Same clamp as #4204, which is why both live here. Client side is
   `src/client/hub-client.ts:145`, `src/client/connect.ts:542`, `src/cli/connect.ts:187`.
   **Decision: fail closed — when the projection is not compatible with the local client, block
   readiness rather than reporting success.**

## L5 — file IO and client integrations

Worktree `~/.codex/worktrees/260911-l5/opencodex`, branch `codex/260911-l5-integrations-io`.

Owned files: `src/config/atomic-write.ts`, `src/integrations/*`. No open PR touches either, so this
lane can move fastest.

1. **#4197 — the DSH integration's atomic replace changes file ownership and causes `EACCES` across
   UIDs.** **Decision: refuse the integration write when the target exists and its owner is not the
   process euid, with an explicit API error. Do not relax the `0600` hardening and do not attempt
   `fchown`.** A metadata-preserving replace can be proposed afterwards as its own issue.
2. **#4214 — add Cline as a supported client integration.** Follow the existing registry pattern in
   `src/integrations/registry.ts`; do not invent a parallel mechanism.

## L6 — streaming and vendor tool leakage

Worktree `~/.codex/worktrees/260911-l6/opencodex`, branch `codex/260911-l6-streaming-tools`.

Owned files: `src/server/responses/codex-ws-exchange.ts`, `codex-ws-wire.ts`, `src/adapters/qoder/*`.

1. **#4191 — a long Codex thread fails only through the proxy** (WS 1006 / response prelude timeout)
   while the bypass works immediately. The prelude timeout is
   `src/server/responses/codex-ws-exchange.ts:214`. Reproduce first: establish what length and timing
   trigger it and where the prelude budget is spent. **Decision: the only in-scope fix is to classify
   and report the timeout honestly, including the close code and the cause.** A configurable prelude
   budget, an SSE fallback, or a size preflight comes back as a report, not a patch.
2. **#4190 — vendor CLI agent scaffolding leaks into routed output** for `qoder`: an MCP
   lazy-loading reminder and tool-call markup reach the user. The leak is in `src/adapters/qoder/`.

## L7 — documentation

Worktree `~/.codex/worktrees/260911-l7/opencodex`, branch `codex/260911-l7-docs`.

Owned files: `docs-site/**/guides/providers.md` and `docs-site/**/guides/remote-hub.md`. Other lanes
own the pages that document their own changes.

1. **#4215 — state whether each provider login consumes a subscription allowance or bills per
   token.** Write the rule per authentication mode, then one explicit line per provider that supports
   both. Coordinate through the orchestrator if L2's carry of #4210 also edits `providers.md`.
2. **#4200 — the remote hub guide breaks on a fresh config** (nested `ocx config set` fails when the
   parent object is absent) and has no macOS data-plane TLS example. Fix the English source first;
   translations are a follow-up, not a blocker.

