# Lane dispatch packets (wp2)

Six `xai/grok-4.6` subagents, dispatched in one round, fresh context each, read-only.
They run concurrently because their questions are independent; none reads another's output.

## Shared packet frame

Every packet carries the same frame, with only `SCOPE` and `QUESTIONS` differing.

- **Repository:** `/Users/jun/.codex/worktrees/b53a/opencodex`, branch
  `codex/260910-250-regression-audit-release` at the freeze SHA.
- **Comparison:** `git diff 2f3f73629...origin/dev -- <lane paths>`. `2f3f73629` is
  released `v2.49.0`; the right side is the 2.50.0 candidate.
- **MUST NOT:** no writes, edits, commits, pushes, stashes, or branch changes; no test
  suite, typecheck, build, or install; no mutating `gh` call. Read-only `git` and
  `gh api`/`gh run list` only. Do not fix anything found — report it.
- **PROOF:** every finding needs an exact `path:line` on the candidate side, or a literal
  command with its output. Unanchored claims are discarded, so do not pad the return.
- **RETURN FORMAT:** `VERDICT` (`NO-BLOCKER` or `BLOCKERS-FOUND`), then one numbered entry
  per finding with `ANCHOR`, `WHAT BREAKS` (the concrete user-visible failure and the input
  that triggers it), `CLAUSE` (which of the eight blocker clauses, or `non-blocking`), and
  `CONFIDENCE` (`certain` / `likely` / `needs-runtime-check`). Then `FILES READ`.
- **DECISION BOUNDARY:** the lane reports evidence and unresolved judgments. It does not
  decide whether the release proceeds, does not rank against other lanes, and does not
  weaken a finding because it looks hard to fix.

A lane that finds nothing returns `NO-BLOCKER` and its `FILES READ`. A short honest
return beats a long speculative one; the triage protocol discards unanchored text anyway.

## Per-lane questions

**L1 — responses and request pipeline.** Does the hosted web-search bridge arm only when
opted in, and does a failure fall back rather than hang or leak? Is the search cell placed
in stream order, and are bridge continuations bounded? Does the non-streaming
context-overflow classification return a classified reply on every exhausted-target path?
Does agent-task recovery on a mid-thread model switch preserve encrypted content? Does the
configurable body admission limit still have a safe default and reject rather than buffer?

**L2 — codex accounts, quota, OAuth.** Can a deferred validation leave an account in a
state where it is neither usable nor visibly failed? Does a revoked pool grant reach a
terminal verdict instead of retrying forever? Does clearing reauth state ever clear it for
the wrong account? Does the new account plan field ever carry a value that identifies the
user into a log or the wire?

**L3 — catalog, providers, combos, config.** Does free-model classification ever mark a
paid model free, or drop a model whose `pricingStatus` is absent rather than `"free"`?
Does quota-exhausted inactive marking recover when quota returns? Does the AI Studio
discovery restoration change behavior for custom gateways? Can a cross-provider blocked
model redirect cycle?

**L4 — management API, service, GUI.** Does any management route lose its auth check? Does
the routed-account label reach a response a browser can read without a session? Does the
launchd bootout recovery ever tear down a healthy job? Do the nine i18n locales contradict
`en` on a destructive action's confirmation text?

**L5 — security, privacy, release surface.** Is email masking still on by default, and does
the opt-out require an explicit operator action? Does `bun run privacy:scan`'s contract
still hold for every new log site? Does any `src/lab/` module now reach `src/router.ts`,
`src/server/lifecycle.ts`, or `src/server/responses/core.ts`? Is there any `await` in the
synchronous `startServer` activation window? Is any gitlink tracked?

**L6 — operator CLI surface.** Does `ocx status` apply the same masking default as the
library? Does `ocx account refresh` mint or reuse a dashboard session, and does it spend
the user's identity without the code-level gate? Does `--free-only` drop models with an
absent `pricingStatus`? Does `--account` filtering match on a value that is masked in the
stored log? Does the committed `skills/ocx` surface map name any command
`src/cli/capabilities.ts` does not register?

## What the main session does with the returns

Nothing is accepted on the lane's authority. Every `BLOCKERS-FOUND` entry is re-derived
against the tree before it enters the wp2 findings table, exactly as the round-1 roadmap
findings were. `040_triage_protocol.md` governs from there.
