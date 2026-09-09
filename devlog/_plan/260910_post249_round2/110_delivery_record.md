# Delivery record

Append-only. One row per deliverable, filled when it actually lands on `dev`.

## Round opened

- Base: `origin/dev` `cd813d3d9` (round-1 close, PR #4150).
- Roadmap: PR #4155 `docs(devlog): plan the post-2.49 round-2 two-lane delivery`,
  head `9abb66387`. Exact-head CI green — `gh run view 34410586758 --exit-status`
  returns 0 for Cross-platform CI at that SHA, with React Doctor, Enforce PR target
  branch and PR hygiene also 0. No run at that SHA was cancelled.
- Lanes dispatched as two Codex worktree threads running `anthropic/claude-opus-5`,
  each instructed to use read-only `xai/grok-4.6` subagents for verification only.

## Ledger

| Item | Issue | PR | Head | CI | Merged as | Issue closed |
|---|---|---|---|---|---|---|
| roadmap | — | #4155 | `3b9fab90e` | green | `a7509fe00` | — |
| A1 | #4129 | #4157 | `421aea87a` | green | `4498fb910` | yes |
| A2 | #4148 | #4161 | `799330bcf` | green | `5b8f1fcfa` | yes |
| A3 | #4141 | — | | | | held on #4152 |
| B1 | #3666 | #4156 | `3ff57ce49` | blocked | | |
| B2 | #4075 | #4158 | `3dc7bd19b` | blocked | | |
| B3 | #3859 | #4160 | | green | | parent blocked |
| B4 | #1711 | — | | | | awaiting decision |
| B5 | #4038 | — | | | | awaiting decision |
| — | #4147 | #4153 | `abf35fa94` | green | | |

A1 and A2 were audited again **after** they landed, against `origin/dev` rather
than against the lane's own report. Both match the fix the plan chose, both
regression tests are genuinely red on the old code, and nothing the plan named as
"must stay green" was deleted to make the suite pass. Record:
`_research/_audit_wp2.md`.

One behaviour worth knowing, found by that audit and not by the change itself: a
Claude request carrying **only** in-messages system text and no `metadata.user_id`
now emits no `prompt_cache_key` at all, because the fallback hashes `systemParts`
and that is empty once the reminders move into the timeline. That is absence, not
rotation — before the change those turns produced a key that moved every turn — so
it is an improvement, but a request in that exact shape no longer gets a proxy-set
key.

## Decisions taken during the round

Record each one here as it happens, with who decided and on what evidence. A
dropped item is a decision, not a gap — say why it was dropped and leave the issue
open with a comment explaining the state it was left in.

**Lane re-split, main session, after the roadmap audit.** #1711 moved from Lane A
to Lane B because the two lanes' write sets overlapped in
`src/codex/catalog/parsing.ts`, `provider-fetch.ts` and `Models.tsx`. Lanes are
now 3 and 5. Evidence: `_research/_audit.md` finding 8, commit `9abb66387`.

**#4148 scope, main session, recorded in the plan and the PR body.** Every
in-messages system message becomes a developer item, not only the ones after the
first user turn. A leading-only hoist keeps the old test green while still
mutating `instructions` when a client injects a fresh leading system message each
turn, which is the reported failure.

**#4141 held, main session.** It must rebase onto PR #4152, which rewrites the
same `runLaunchctl` runner and belongs to the separate task investigating the
live-proxy shutdowns. Lane A was told to hold rather than invent a second seam.

**Lane B dammed by the UI-screenshot gate, escalated to the maintainer.**
`enforce-target` requires a screenshot whenever a PR mentions `gui` and auto-drafts
until one exists, so #4156 and #4158 fail on that alone with every other check
green. Producing one needs `bun run build:gui`, which this round's no-local-build
constraint forbids. #4160 is fully green but sits behind them. Lane B reported
itself blocked rather than working around the gate, which is the correct behaviour.

## Rules this record exists to enforce

- A PR is only "merged" here once `git fetch origin && git merge-base --is-ancestor`
  proves the merge commit is on `dev`.
- "CI green" means a run at the **exact head SHA** concluded `success`, proven by
  `gh run view <id> --exit-status`. A cancelled run never counts.
- PRs here target `dev`, so GitHub does not auto-close the linked issue. The
  "Issue closed" column is only ticked after closing it by hand with the merge
  commit as evidence.
- Local suite, typecheck, build, lint and `privacy:scan` are NOT RUN for every item
  in this round, by the maintainer's constraint. Remote CI is the only gate, and
  each PR body says so.
