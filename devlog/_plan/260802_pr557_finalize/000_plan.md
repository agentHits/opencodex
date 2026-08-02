# PR #557 finalize — research (2026-08-02)

Branch `codex/pr533-update-recovery-hardening`, worktree `260727-pr533-current`.
Policy decision (maintainer, 2026-08-02): **안 A fail-closed** — Wibias recommendation.

## Facts established at P

- Branch is 16 ahead / 768 behind origin/dev; merge-base `800ebc931`.
- dev carries NONE of this work: `sanitizeUpdateJobText` / `npm-cache-preflight`
  count on origin/dev:src/update/job.ts = 0. The branch is the sole carrier.
- Merge surface: 14 files changed in both (37 conflict markers): `src/update/job.ts`,
  `src/update/index.ts`, `src/config.ts`, tests ×5 (`update-job`, `update-stop-first`,
  `ocx-launcher-source`, `config`, `windows-deploy-close-regressions`),
  docs-site cli reference (zh-cn, ru), others. 599 paths merge clean; 166 removed
  in remote (dev deletions, branch untouched).
- Open Wibias blocker (sanitizer): `src/update/job.ts:324-330` regexes use
  `[^\s"'<>]`, so `C:\Users\Alice Smith\.npm\_cacache\tmp\entry` leaks whole and
  `/Users/Alice Smith/.npm/_cacache/tmp` half-redacts. Wibias ran the exact
  regexes against those inputs — reproduction is authoritative.
- Closed blocker (preflight): `src/update/npm-cache-preflight.mjs:98-113`
  `accessSync` R/W/X fail-closed — DO NOT TOUCH.
- Auto-recovery path to remove (policy A): `recoverFailedGuiUpdate`
  (`src/update/job.ts:908`) step 4 — `findNpmRecoveryLaunchers` + restart-candidate
  loop + unhealthy-candidate kill. Detection/reporting steps 1-3 (healthy probe,
  oldPid identity, replacement-became-healthy) stay: they only observe and refuse,
  never start a process. The success-path `restartAfterUpdate` stays untouched.
- Attribution obligation (Wibias): PR description and final merge commit must
  credit #533 and @WZBbiao (imported commits keep the `wzb` author identity but
  GitHub does not link the email).

## Claim ledger

| # | Claim | Source | Status |
|---|-------|--------|--------|
| 1 | Sanitizer leaks space-containing profile paths | Wibias review on #557 (ran the regexes) | verified by reviewer; re-prove red in B |
| 2 | Preflight blocker closed | Wibias review | verified; non-goal |
| 3 | Auto-recovery races a live installer (policy rationale) | Wibias recommendation; maintainer decision A | decision recorded |
| 4 | dev has no part of this branch's feature code | `git show origin/dev:src/update/job.ts` grep = 0 | verified |

## Out of scope

- Force-push / rebase. Merge origin/dev in (regular push afterwards).
- Any change to the fail-closed preflight (blocker 1).
