# PR1 — macOS launchd repair/status (issue #4236 defects 1 & 2)

Branch `codex/260911-l4-launchd-repair`, based on `dev` (`babb76449`). First of the four-PR
hub single-port stack; the others target this branch's head in turn.

Scope: `src/service.ts` macOS path only, plus the two shared test-safety guards the work
uncovered. Defects 3 and 4 from the issue (secondary-port misdiagnosis, `ocx status` fence
comparison) are deliberately left to PR2, which owns the loopback listener.

## What shipped

### A — `installLaunchd()` (repair must not be an outage)

1. **No-op pre-check.** The plist is rendered BEFORE anything is written. If the rendered
   bytes equal the on-disk bytes, the data-token file is unchanged, and
   `launchdJobMatchesPlist()` reports `{loaded:true, matchesPlist:true}`, the function
   re-asserts 0600 on the plist, refreshes install state, logs
   `service is already loaded from the current plist; nothing to do.` and returns. launchd is
   not touched at all. This is the headline fix: a repair of a healthy hub used to evict it
   unconditionally.
2. **Backup + rollback.** The previous plist bytes are held in memory and copied to
   `<plist>.prev` before the overwrite. On terminal failure the bytes go back, a
   bootout/settle/bootstrap tries to re-register them, and the thrown error states whether
   that worked.
3. **`bootstrap gui/$uid <plist>` replaces `load -w`.** `bootout` was already
   domain-explicit; `load` acts on the CALLER's bootstrap domain, so from ssh/cron/another
   bootstrap context the old pair deleted the gui-domain job and registered nothing.
4. **Bounded settle between bootout and bootstrap** — up to 5 × 200 ms while
   `launchctl print gui/$uid/<label>` still answers 0, the launchd twin of the Windows
   `SCHEDULER_SETTLE_DELAYS_MS` idea. `bootout` is asynchronous, so the old back-to-back
   retry raced the same exiting job twice and added nothing.
5. **Success is `launchctl print` agreeing, never stderr.** `launchdJobMatchesPlist` is
   consulted against the command this install actually baked, and `writeServiceInstallState`
   runs only after it agrees. Stderr regexes are advisory routing signals now.
6. **One retry, routed by the failure.** Exit 5 / `Bootstrap failed` → `kickstart -k`, then
   `enable` + a second bootout/bootstrap (see the launchctl findings below). Exit 0 with a
   disagreeing `print` → one more bootout/bootstrap, because that is the silent no-op. Any
   other failure (malformed plist, EPERM) throws immediately so the real stderr reaches the
   operator undelayed — the property the previous code had and kept.
7. **Error text names the outage and the remedy**: the job was evicted from `gui/<uid>` and
   is not running, `launchctl bootstrap gui/<uid> <plist>` recovers it, plus
   `launchctl print` and `launchctl print-disabled` to inspect.
8. **`stableLauncherEntry()` prefers the recorded launcher** when it is still an absolute
   executable file, falling back to the PATH walk otherwise (defect 1g). A repair from a
   context without `ocx` on PATH no longer rewrites a working launcher-form plist into the
   version-pinned Bun + CLI pair.

### B — `statusLaunchd()` / `diagnoseService()` darwin branch

`launchctl list | grep <label> || true` is gone. New `probeLaunchdLoadState()` asks
`launchctl print` in BOTH `gui/<uid>` and `user/<uid>` (the way `inspectLaunchd` does), keeps
the 112/113 distinction, and returns a four-state verdict:

| state | `running` | `viable` | summary |
|---|---|---|---|
| `loaded-current` | true | `!stale` | `installed and loaded (launchd; …)` |
| `loaded-stale` | true | `!stale` | `installed and loaded from an OLDER plist (launchd; …)` |
| `not-loaded` | false | false | `installed, not loaded (launchd; …)` |
| `unknown` | false | `!stale` | `installed; launchd state could not be verified — <reason> (launchd; …)` |

`deriveLaunchdServiceDiagnostic()` is a pure function so all four are testable without a live
launchd. `platformServiceInstallCleanupOps` (the install-cleanup twin) now uses the same probe
and `bootout` instead of `launchctl list` + legacy `unload`, and keeps failing closed on
`unknown` — installing new assets over a manager we could not query is the unsafe direction.

### C — `serviceCommand` repair branch

`repairService()` is wrapped, so `reportServiceServing("repaired")` runs even when repair
throws. The failure is printed and `process.exitCode` is 1 either way. This matters precisely
because darwin repair can now roll back: the operator needs the "did anything come back?"
answer, and a throw used to escape to the top level and skip it.

### D — `stopLaunchd` / `uninstallLaunchd`

`bootout gui/<uid>/<label>` first; legacy `unload` survives only for `status === null`, i.e.
launchctl could not be spawned at all. Exit 3 ("No such process") is the not-loaded case, not
a failure. `uninstallLaunchd` routes through `stopLaunchd` and also removes `<plist>.prev`.

### Two test-safety guards this work uncovered

Both were pre-existing, and both were hitting this machine.

- **`assertNotRealLaunchAgentsUnderTest`** (`src/lib/test-home-guard.ts`) plus an injectable
  `plistPath` on `installLaunchd`. `os.homedir()` reads the password database, not `$HOME`, so
  the suite's HOME sandbox does not move `~/Library/LaunchAgents`. The existing
  `withLaunchAgentHome()` helper in `service.test.ts` was therefore inert, and every
  `installLaunchd` case rewrote the developer's live `com.opencodex.proxy.plist` with a
  definition whose token file, log path and homes pointed into a temp sandbox. launchd holds
  its own parsed copy, so nothing broke until the job next restarted.
- **`serviceStatePaths()` drops the legacy default-home entry under an armed test process.**
  That entry exists so an install made before `OPENCODEX_HOME` was set can still be found, but
  it is the real `~/.opencodex/service-state.json`, so a sandboxed test still wrote the live
  record. Observed directly: one run replaced this host's `codexHome`/`opencodexHome` with
  `/var/folders/...` paths.

Both real files on this machine were restored from the live job's own
`launchctl print` output and re-verified (`plutil -lint` OK, command identical to the running
job, 0600, `/healthz` 200). Nothing was left in `~/Library/LaunchAgents` by this work.

## launchctl semantics, measured on this host

macOS 26 / Darwin 27.0.0, arm64, uid 501. Measured with a throwaway
`com.opencodex.test-probe` label in a temp plist running `/bin/sleep 600`, never against the
live `com.opencodex.proxy` job (`launchctl print gui/501/com.opencodex.proxy` returned 0
before and after every probe). The probe was booted out and its files deleted.

```
launchctl print gui/501/<label>            → 113 absent, 0 loaded
launchctl print user/501/<label>            → 113 (the shipped agent lives in gui/ only)
launchctl print gui/99999/<label>           → 112 (no such domain)
launchctl bootstrap gui/501 <plist>         → 0 first time
launchctl bootstrap gui/501 <plist> (again) → 5  "Bootstrap failed: 5: Input/output error"
launchctl load -w <plist> while bootstrapped→ 0  AND "Load failed: 5: Input/output error"   ← the silent no-op
launchctl kickstart -k gui/501/<label>      → 0 when loaded, 113 when absent
launchctl bootout gui/501/<label>           → 0 when loaded, 3 "Boot-out failed: 3: No such process"
```

Second probe, the finding that changed the design:

```
launchctl disable gui/501/<label>           → 0
launchctl bootstrap gui/501 <plist>         → 5  "Bootstrap failed: 5: Input/output error"   ← same code, different cause
launchctl kickstart -k gui/501/<label>      → 113
launchctl load -w <plist>                   → 0, job loaded, and print-disabled flips to "enabled"
launchctl enable gui/501/<label>            → 0
launchctl bootstrap gui/501 <plist>         → 0, job loaded
```

So **exit 5 is ambiguous**: either something is still bootstrapped under the label, or the
label sits in the domain's disabled list. The `-w` in the legacy `load -w` was doing the
second job silently, and dropping it without `enable` would have made a disabled job
permanently unrepairable. The retry therefore tries `kickstart -k` (live job) and then
`enable` + bootstrap (disabled list), in that order. `enable` runs ONLY on that retry, so an
ordinary repair does not quietly undo a deliberate `launchctl disable`.

Residue worth noting: `launchctl enable`/`disable` write a per-uid override database, so
`launchctl print-disabled gui/501` now carries an inert `"com.opencodex.test-probe" => enabled`
entry for a label that no longer exists. There is no launchctl verb to remove an override
record; it references nothing and is harmless.

## Decisions

- **`unknown` keeps `viable` true.** `isServiceViable() === false` is what makes
  `src/update/index.ts` (after a service refresh exits 0) and `src/update/job.ts:1229` treat a
  healthy supervisor as dead and start a COMPETING proxy on the service's own port. A probe
  that could not be run is not evidence against the service, so `unknown` reports honestly in
  the summary — no "not loaded", no `ocx service repair` — and does not disprove viability.
  `startable` is likewise untouched, so the tray still hands the start to `ocx service start`,
  which no-ops on an already-loaded job. `src/cli/status.ts:216`-`222` still appends
  "registered but NOT serving … re-run 'ocx service repair'" only when `installed && !live`,
  which stays honest: with `unknown` AND a live proxy it prints the unverified summary under
  `✅ Proxy: running` and recommends nothing.
- **`loaded-stale` keeps the viability the grep era gave it** (loaded ⇒ viable). Only the
  summary is upgraded, so the update fallback behaves exactly as before while the operator
  finally learns the live job came from an older plist — the one case where `repair` is right.
- **Verification compares the command THIS install baked**, via a new shared
  `launchdServiceCommand()` that `buildPlist` also uses, not
  `expectedLaunchdCommand(installedServiceListenPort())`. A fresh install has no install state
  yet, and a lost state file makes `expectedLaunchdCommand` fall back to the Bun + CLI pair —
  which would call a correctly loaded launcher job stale (#3464) and turn every first install
  into a rollback.
- **`<plist>.prev`, not `<plist>.prev.plist`.** launchd globs
  `~/Library/LaunchAgents/*.plist` at login, so a backup ending in `.plist` would be a second
  registration of the same Label fighting the real one for the port.
- **`installLaunchd` stays synchronous** (`ServiceOps.install` and
  `RepairServiceDeps.repairLaunchd` are `() => void`), so the settle loop uses
  `Bun.sleepSync` behind an injectable `sleepSync` seam rather than making the whole
  call chain async.
- **`startLaunchd` still uses `load -w`, deliberately.** Switching it would change
  `ocx service start` semantics (the `-w` clears the disabled list, `bootstrap` does not), and
  it already cross-checks with `launchdJobMatchesPlist` before throwing. Out of scope here.
- **`repairService()` itself still does not consult `diag.running`/`diag.viable`** (issue
  defect 1c). The no-op now lives inside `installLaunchd`, which is the only function that
  knows whether the rendered plist differs — a check in `repairService` would have to re-render
  it to be correct.

## Tests

New `tests/service/launchd-repair.test.ts` (30 cases), registered in
`scripts/test-layout/layout.json` and `tests/fixtures/test-layout-expected.json`. The five
obsolete `installLaunchd` cases in `tests/service/service.test.ts` (which asserted the `load`
verb) were removed and replaced by a pointer comment; one new `stableLauncherEntry` case was
added there, and the two existing launcher-discovery cases now pass `state: null` to stay
PATH-discovery tests.

Coverage: healthy-and-identical repair is a no-op (zero launchctl calls); identical plist but
stale live command still reloads; the reload is domain-explicit `bootstrap` with no `load` /
`unload`; the settle loop waits while `print` answers 0 and is bounded at 5 × 200 ms; exit 0
with a disagreeing `print` is a failure; exit 5 tries `kickstart -k`; a disabled job takes
`enable` + bootstrap; an ordinary repair never runs `enable`; a malformed plist is not
retried; terminal failure restores the previous bytes and names
`launchctl bootstrap gui/<uid> <plist>` and `print-disabled`; a fresh install invents no
rollback; the LaunchAgents guard refuses the real directory; the 0/112/113/spawn-failure
tri-state including "113 in gui is not absence, ask user/ too"; all four diagnostic states
with `unknown` producing neither "not loaded" nor a repair recommendation; plus source-oracle
cases for the repair-branch try/catch, the install-cleanup ops, and the state-path filter.

## Verification

Run from the worktree with `node_modules` symlinked.

```
bun run typecheck                                  → clean (no output)
bun test tests/service/launchd-repair.test.ts      → 30 pass, 0 fail, 106 expect()
bun test tests/service/service.test.ts             → 204 pass, 0 fail, 663 expect()
bun test tests/service                             → 518 pass, 9 fail
bun test tests/service tests/update \
  tests/cli/uninstall.test.ts tests/ci-workflows \
  tests/codex-integration/codex-service-manager-probe.test.ts \
  tests/test-layout.test.ts tests/test-layout-tooling.test.ts
                                                   → 1505 pass, 9 fail
bun run privacy:scan                               → Privacy scan passed
```

Those 9 failures are pre-existing and identical on `dev`: 8 `winsw` cases plus
`xAI API-key runtime injects priority while OAuth does not`. They are cross-file
`OPENCODEX_HOME` pollution inside a single domain-wide `bun test` invocation — each file
passes alone (`bun test tests/service/winsw.test.ts` → 25 pass,
`tests/service/service-tier-capability.test.ts` → 35 pass) — and the same 9 fail on a stashed
working tree at `dev`. The full suite was not run, per the lane instruction; hosted CI is the
proof.

Host state after the run: `~/Library/LaunchAgents/com.opencodex.proxy.plist` 1985 bytes,
0600, `plutil -lint` OK, command identical to `launchctl print gui/501/com.opencodex.proxy`;
`~/.opencodex/service-state.json` 320 bytes with the real homes; `~/.opencodex/service-api-token`
untouched; `/healthz` on 10100 → 200; no `*.prev` file left behind.
