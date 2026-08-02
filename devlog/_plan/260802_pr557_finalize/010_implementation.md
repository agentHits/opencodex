# PR #557 finalize — implementation (one cycle)

## Step order (dependency-ordered)

1. **Merge origin/dev into the branch** and resolve the 14 both-changed files
   semantically: branch feature semantics on top of dev's evolution. Never drop
   either side's behavior silently; every conflict hunk gets a named decision in
   the commit message or this doc's amendment.
2. **Sanitizer fix (red-green first)** in `src/update/job.ts`
   `sanitizeUpdateJobText`.
3. **Fail-closed policy A** in `recoverFailedGuiUpdate` + type/test updates.
4. **Docs**: manual recovery path (docs-site troubleshooting, EN; locale files
   must not contradict).
5. **Gates + push + PR update** (body, attribution, undraft).

## Step 2 — sanitizer (anchor-based, space-tolerant)

Rewrite rules in order:

- npm/cache paths: `(?:[A-Za-z]:[\\/]|\/)[^"'<>\n]*?(?:\.npm|_cacache|_npx|\.opencodex-)`
  with prefix allowing spaces (non-greedy up to first anchor), then consume
  space-free trailing segments `([\\/][^\s"'<>]+)*` → `[redacted npm path]`.
  npm cache internals have no spaces; the space risk lives in the profile prefix.
- ocx.mjs launcher paths: prefix allows spaces → `ocx.mjs` (keep `\b`, do not
  swallow trailing args).
- user-path fallback (no anchor): redact the username component including ONE
  optional space segment: `(\/(?:Users|home)\/)[^/\s"'<>]+(?:\s+[^/\s"'<>]+)?`
  → `$1[redacted]`. Anchor rule runs first, so `.npm`-carrying cases never reach
  this rule half-matched.
- uid/gid rules unchanged.

Red-green tests (port Wibias's exact inputs):

- `C:\Users\Alice Smith\.npm\_cacache\tmp\entry` → `[redacted npm path]`
- `C:\Users\AliceSmith\.npm\_cacache\tmp\entry` → `[redacted npm path]`
- `/Users/Alice Smith/.npm/_cacache/tmp` → `[redacted npm path]` (whole)
- `/home/alice/.npm/_cacache/tmp` → `[redacted npm path]`
- `/Users/Alice Smith/some/other.log` → `/Users/[redacted]/some/other.log`
- uid/gid lines unchanged behavior.

## Step 3 — fail-closed (policy A)

In `recoverFailedGuiUpdate` (`src/update/job.ts:908`):

- KEEP steps 1-3 (probe-healthy, oldPid-identity, replacement-healthy) — pure
  observation/refusal, no process start.
- REPLACE step 4 (launcher discovery + restart loop + candidate kill) with:
  log `Update command failed after the proxy stopped. Automatic recovery is
  disabled: the failed installer may still be mutating the global package tree.
  Restore the package, then run 'ocx service install' or 'ocx start --port N'.`
  and return `"failed"`.
- REMOVE the now-dead recovery machinery ONLY where nothing else references it
  (map callers first): `findNpmRecoveryLaunchers`, validated-launcher helpers,
  `recoveryLaunchersFn` io hook, `FailedUpdateRecovery = "restarted"` variant,
  `recoverFailedGuiUpdateForTests` recovery-candidate cases. KEEP
  `packageLauncherPath` / `restartAfterUpdate` (success path) and
  `npm-cache-preflight.mjs` / `recovery-tree-scan.mjs` (preflight path).
- Update branch tests to fail-closed expectations: recovery-restart tests become
  "job failed, no start attempted, manual instruction logged" tests; the
  step 1-3 observation tests stay.

## Step 4 — docs

- docs-site troubleshooting (EN): "update failed, proxy is down" → the fail-closed
  rationale (one line) + manual path: verify/reinstall package, then
  `ocx service install` or `ocx start --port N`; job log names the exact command.
- Check zh-cn/ja/ru/ko troubleshooting pages for auto-recovery claims; amend any
  contradiction (the branch already touches docs-site cli reference in 2 locales —
  keep consistent).

## Activation scenarios (C)

1. Red: Wibias's four sanitizer inputs leak before the fix (assert exact current
   bad outputs), pass after.
2. Fail-closed: a GUI npm update whose installer exits nonzero after a proxy stop
   results in job.status failed, zero calls to the restart io hooks, and the
   manual instruction in the sanitized job log. Activation: io-spy test.
3. Observation preserved: replacement-becomes-healthy still yields "still-running"
   with no restart. Activation: existing step 1-3 tests green.
4. Full `bun run test`, `bun run typecheck`, `bun run privacy:scan` on the merged
   branch.

## Push plan (user-approved for this PR)

Regular `git push` of the merge+fix commits (no force). Then `gh pr ready 557`,
PR body update (policy decision + evidence + `Refs #533` + @WZBbiao credit), and
a summary comment. If the remote rejects non-FF → STOP and ask (UNSAFE).
