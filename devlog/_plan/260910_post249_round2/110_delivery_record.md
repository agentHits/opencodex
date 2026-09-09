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

| Item | Issue | Branch | PR | Head | CI | Merged | Issue closed |
|---|---|---|---|---|---|---|---|
| roadmap | — | `codex/devlog-post249-round2` | #4155 | `9abb66387` | green | | — |
| A1 | #4129 | `lane-a/1-4129` | | | | | |
| A2 | #4148 | `lane-a/2-4148` | | | | | |
| A3 | #4141 | `lane-a/3-4141` | | | | | |
| B1 | #3666 | `lane-b/1-3666` | | | | | |
| B2 | #4075 | `lane-b/2-4075` | | | | | |
| B3 | #3859 | `lane-b/3-3859` | | | | | |
| B4 | #1711 | `lane-b/4-1711` | | | | | |
| B5 | #4038 | `lane-b/5-4038` | | | | | |
| — | #4147 | contributor `fix/zcode-export-reasoning` | #4153 | | | | |

## Decisions taken during the round

Record each one here as it happens, with who decided and on what evidence. A
dropped item is a decision, not a gap — say why it was dropped and leave the issue
open with a comment explaining the state it was left in.

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
