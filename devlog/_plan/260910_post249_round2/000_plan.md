# 260910 post-2.49 round 2 — two-lane stacked delivery

## Context

Round 1 (`devlog/_plan/260909_post249_scope_cleanup/`) landed 17 PRs and closed
16 issues; `origin/dev` closed at `cd813d3d9`. Three issues were left open by
decision: #3978 (deferred until the compaction status contract settles), #3506
(direction comment only — translation fidelity, not a proxy-side progress
cutoff), #2495 (feasibility study says it needs its own cycle).

This round the user chose **two lanes instead of eight**: two managed worktrees,
each publishing a four-PR stack on `dev`, merged lane by lane under main-session
control.

## Scope

Eight issues, all selected because the fix is mechanical and needs no maintainer
policy judgment, plus one contributor PR to land.

| Lane | Order | Issue | One line |
|---|---|---|---|
| A | 1 | #4129 | shadowCallIntercept on a combo runs one attempt, never enters the failover loop |
| A | 2 | #4148 | mid-conversation Claude `role: system` messages are hoisted into `instructions`, breaking the cache prefix |
| A | 3 | #1711 | zero-credit models/combos are still offered as selectable catalog entries |
| A | 4 | #4141 | after `ocx update` the launchd job never comes back (legacy `unload`, strict load-failure check) |
| B | 1 | #4038 | Logs conflates first-token latency with delivery speed; no decode-rate metric |
| B | 2 | #3666 | no way to filter free models in the Dashboard catalog |
| B | 3 | #3859 | stored account emails are unconditionally masked, with no operator opt-out |
| B | 4 | #4075 | "model sync failed" does not explain the model-discovery dependency |
| — | — | #4147 | contributor PR #4153 already carries the confirmed ZCode schema; review and land it |

## Out of scope

- The live-proxy incident and `src/service.ts` test isolation: PR #4152 owns that,
  driven by a separate task. This round does not touch it, and no lane may run
  `ocx service`, `ocx start/stop/restart`, `launchctl`, or `systemctl`.
- Live-probe issues: #3782, #3765, #3719, #4143, #4126, #3781, #3775, #3433,
  #3522, #3661, #3506.
- Policy issues needing an interview: #3630, #2730, #3729, #2511, #3377, #4079,
  #4024, #3417, #3898, #4055, #3705.

## Constraints carried from the user

1. **Never run the local product suite**, `bun test`, `bun install`,
   `bun run typecheck`, `bun run build`, or lint. Exact-head remote CI is the
   only gate. Skipped local checks are labelled NOT RUN in the PR body.
2. Push with `--no-verify`.
3. A cancelled CI run is never passing evidence. If a concurrency group cancels
   a gate with no success at the same SHA, re-trigger and wait for a real
   conclusion.
4. Merge order and rebase timing belong to the main session. Lanes stack on
   `dev` as it was at lane start and do not rebase or merge on their own.
5. Subagents are `xai/grok-4.6` and are bounded verifiers; lane worker threads
   run `anthropic/claude-opus-5` as their main agent.
6. No heartbeat automations. The main session polls.

## Terminal outcome

DONE when all eight lane issues and #4147 are closed against merged `dev` commits
with exact-head CI evidence, and `110_delivery_record.md` records the round.
