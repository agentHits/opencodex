/**
 * macOS repair/status protocol — issue #4236, defects 1 and 2.
 *
 * The reported failure: one `ocx service repair` on a hub took the public proxy, the
 * management ingress and the loopback listener down at once, printed success, and left
 * `ocx status` recommending the same repair. On darwin `repair` IS `installLaunchd`, which
 * evicted the live job with a domain-explicit `bootout`, re-registered with the
 * domain-IMPLICIT legacy `launchctl load -w`, and accepted exit-0-with-empty-stderr as
 * proof. Measured on macOS 27.0 (Darwin 27, arm64) with a throwaway
 * `com.opencodex.test-probe` label:
 *
 *   launchctl print gui/$uid/<label>      → 0 loaded | 113 no such service | 112 no such domain
 *   launchctl bootstrap gui/$uid <plist>  → 0 first time, 5 "Bootstrap failed: 5" when bootstrapped
 *   launchctl load -w <plist>             → 0 AND "Load failed: 5" when bootstrapped (the no-op)
 *   launchctl kickstart -k gui/$uid/<l>   → 0 loaded | 113 absent
 *   launchctl bootout gui/$uid/<label>    → 0 evicted | 3 "Boot-out failed: 3: No such process"
 *
 * Every case here drives the injected seam and reaches no real launchd: the
 * live-service-manager guard refuses `bootout`/`bootstrap` from an armed test process, and
 * `installLaunchd` is handed an explicit plist path because `os.homedir()` reads the
 * password database rather than `$HOME` — so the suite's HOME sandbox does NOT move
 * `~/Library/LaunchAgents`, and a case without that seam rewrites the developer's own live
 * `com.opencodex.proxy.plist`.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildPlist,
  deriveLaunchdServiceDiagnostic,
  installLaunchd,
  probeLaunchdLoadState,
  resolvedProxyEnv,
  runLaunchctl,
  stableLauncherEntry,
} from "../../src/service";
import { protectedLaunchAgentsDirForTests } from "../../src/lib/test-home-guard";
import { repoPath } from "../helpers/repo-root";

/**
 * Pin OPENCODEX_HOME per case. `buildPlist` reads config through `getConfigDir()`, and when
 * OPENCODEX_HOME is absent that falls back to `join(homedir(), ".opencodex")` — the real
 * one, because `os.homedir()` ignores `$HOME`. A sibling file in the same Bun worker that
 * clears or restores the variable would otherwise make these cases fail on the real-home
 * guard instead of on anything they assert.
 */
beforeEach(() => {
  const home = mkdtempSync(join(tmpdir(), "ocx-launchd-home-"));
  mkdirSync(join(home, ".opencodex"), { recursive: true });
  process.env.OPENCODEX_HOME = join(home, ".opencodex");
});

type LaunchctlResult = { ok: boolean; stdout: string; stderr: string; status: number | null };

function ok(stdout = ""): LaunchctlResult {
  return { ok: true, stdout, stderr: "", status: 0 };
}
function fail(status: number, stderr: string): LaunchctlResult {
  return { ok: false, stdout: "", stderr, status };
}

/**
 * A `runLaunchctl` stand-in that records every argv and answers from a per-verb script.
 * `bootstrap` consumes its queue; exhausting it is a fixture bug, not a passing case.
 */
function recordingLaunchctl(script: {
  bootstrap?: LaunchctlResult[];
  print?: LaunchctlResult;
  kickstart?: LaunchctlResult;
  bootout?: LaunchctlResult;
}) {
  const argv: string[][] = [];
  let bootstraps = 0;
  const launchctl = ((args: string[]): LaunchctlResult => {
    argv.push([...args]);
    const verb = args[0] ?? "";
    if (verb === "bootstrap") {
      const queued = script.bootstrap?.[bootstraps++];
      if (!queued) throw new Error(`unexpected bootstrap #${bootstraps}: the fixture queued ${script.bootstrap?.length ?? 0}`);
      return queued;
    }
    // Default `print` is 113 so the settle loop sees an evicted domain and returns at once.
    if (verb === "print") return script.print ?? fail(113, "Could not find service");
    if (verb === "kickstart") return script.kickstart ?? ok();
    if (verb === "bootout") return script.bootout ?? ok();
    return ok();
  }) as typeof runLaunchctl;
  return { argv, launchctl };
}

const verbs = (argv: string[][]): string[] => argv.map(args => args[0] ?? "");

/** A fixture LaunchAgents directory plus the plist path inside it. */
function fixturePlist(): string {
  return join(mkdtempSync(join(tmpdir(), "ocx-launchd-repair-")), "com.opencodex.proxy.plist");
}

/** The plist `installLaunchd` will render in this process, for the byte-identical case. */
function renderedPlist(): string {
  return buildPlist(resolvedProxyEnv(), { launcher: stableLauncherEntry() });
}

describe("installLaunchd: repair must not be an outage (#4236 defect 1)", () => {
  test("a healthy job loaded from a byte-identical plist is a no-op — launchd is never touched", () => {
    const plistPath = fixturePlist();
    writeFileSync(plistPath, renderedPlist(), "utf8");
    const { argv, launchctl } = recordingLaunchctl({});

    installLaunchd({
      launchctl,
      plistPath,
      matches: () => ({ loaded: true, matchesPlist: true }),
      sleepSync: () => {},
    });

    // THE regression: no bootout, no bootstrap, no kickstart. Repairing a serving hub
    // used to evict it unconditionally.
    expect(argv).toEqual([]);
    // And nothing was backed up, because nothing was overwritten.
    expect(existsSync(`${plistPath}.prev`)).toBe(false);
  });

  test("an identical plist whose job is loaded from an OLDER command still reloads", () => {
    const plistPath = fixturePlist();
    writeFileSync(plistPath, renderedPlist(), "utf8");
    let matchCalls = 0;
    const { argv, launchctl } = recordingLaunchctl({ bootstrap: [ok()] });

    installLaunchd({
      launchctl,
      plistPath,
      // First call is the no-op pre-check (stale ⇒ do the repair); the second is the
      // post-bootstrap verification.
      matches: () => ({ loaded: true, matchesPlist: matchCalls++ > 0 }),
      sleepSync: () => {},
    });

    expect(verbs(argv)).toContain("bootstrap");
  });

  test("the reload is domain-explicit bootstrap, not legacy load -w", () => {
    const plistPath = fixturePlist();
    const { argv, launchctl } = recordingLaunchctl({ bootstrap: [ok()] });

    installLaunchd({
      launchctl,
      plistPath,
      matches: () => ({ loaded: true, matchesPlist: true }),
      sleepSync: () => {},
    });

    // `load` acts on the CALLER's bootstrap domain, so from ssh/cron it deleted the
    // gui-domain job and registered nothing (defect 1a).
    expect(verbs(argv)).not.toContain("load");
    expect(verbs(argv)).not.toContain("unload");
    const bootstrap = argv.find(args => args[0] === "bootstrap");
    expect(bootstrap?.[1]).toMatch(/^gui\/\d+$/);
    expect(bootstrap?.[2]).toBe(plistPath);
    const bootout = argv.find(args => args[0] === "bootout");
    expect(bootout?.[1]).toMatch(/^gui\/\d+\/com\.opencodex\.proxy$/);
    // bootout before bootstrap, with the settle probe in between.
    expect(verbs(argv).indexOf("bootout")).toBeLessThan(verbs(argv).indexOf("bootstrap"));
  });

  test("the settle loop waits while print still answers 0, and is bounded", () => {
    const plistPath = fixturePlist();
    const delays: number[] = [];
    // `print` keeps answering 0: the job has not finished exiting.
    const { argv, launchctl } = recordingLaunchctl({ bootstrap: [ok()], print: ok("live") });

    installLaunchd({
      launchctl,
      plistPath,
      matches: () => ({ loaded: true, matchesPlist: true }),
      sleepSync: ms => { delays.push(ms); },
    });

    // 5 × 200 ms, then give up and try the bootstrap anyway — a wedged domain must reach
    // the diagnosable throw rather than hang.
    expect(delays).toEqual([200, 200, 200, 200, 200]);
    expect(verbs(argv).filter(v => v === "print")).toHaveLength(5);
  });

  test("a clean bootstrap that did not take is a FAILURE, whatever stderr says", () => {
    const plistPath = fixturePlist();
    // Both bootstraps exit 0 with empty stderr — the old success condition exactly.
    const { argv, launchctl } = recordingLaunchctl({ bootstrap: [ok(), ok()] });

    expect(() => installLaunchd({
      launchctl,
      plistPath,
      matches: () => ({ loaded: false, matchesPlist: false }),
      sleepSync: () => {},
    })).toThrow(/could not bootstrap/);

    // Exit 0 + `print` disagreeing is a silent no-op, so it IS worth one more eviction.
    expect(verbs(argv).filter(v => v === "bootstrap")).toHaveLength(2);
  });

  test("'Bootstrap failed: 5' tries kickstart -k before a second eviction", () => {
    const plistPath = fixturePlist();
    let matchCalls = 0;
    const { argv, launchctl } = recordingLaunchctl({
      bootstrap: [fail(5, "Bootstrap failed: 5: Input/output error")],
    });

    installLaunchd({
      launchctl,
      plistPath,
      // First verification (right after the refused bootstrap) fails; the one after
      // `kickstart -k` succeeds.
      matches: () => {
        const loaded = matchCalls++ >= 1;
        return { loaded, matchesPlist: loaded };
      },
      sleepSync: () => {},
    });

    expect(verbs(argv)).toContain("kickstart");
    const kickstart = argv.find(args => args[0] === "kickstart");
    expect(kickstart?.slice(1)).toEqual(["-k", kickstart?.[2] ?? ""]);
    expect(kickstart?.[2]).toMatch(/^gui\/\d+\/com\.opencodex\.proxy$/);
    // One bootstrap only: kickstart recovered it without a second eviction window.
    expect(verbs(argv).filter(v => v === "bootstrap")).toHaveLength(1);
  });

  /**
   * The second meaning of exit 5. Measured on macOS 27.0: `launchctl disable gui/$uid/<label>`
   * makes `bootstrap` fail with the SAME "Bootstrap failed: 5: Input/output error" while
   * `print` reports 113 and `kickstart -k` reports 113. Legacy `load -w` cleared that flag —
   * that is what the `-w` meant — so dropping it without `enable` would make a disabled job
   * permanently unrepairable.
   */
  test("a DISABLED job is enabled and bootstrapped, the modern spelling of load -w", () => {
    const plistPath = fixturePlist();
    let matchCalls = 0;
    const { argv, launchctl } = recordingLaunchctl({
      bootstrap: [fail(5, "Bootstrap failed: 5: Input/output error"), ok()],
      kickstart: fail(113, 'Could not find service "com.opencodex.proxy" in domain for user gui: 501'),
    });

    installLaunchd({
      launchctl,
      plistPath,
      // Loaded only after the enable + second bootstrap. `kickstart` failing
      // short-circuits its own verification, so this is asked exactly twice.
      matches: () => {
        const loaded = matchCalls++ >= 1;
        return { loaded, matchesPlist: loaded };
      },
      sleepSync: () => {},
    });

    expect(verbs(argv)).toEqual(["bootout", "print", "bootstrap", "kickstart", "enable", "bootout", "print", "bootstrap"]);
    const enable = argv.find(args => args[0] === "enable");
    expect(enable?.[1]).toMatch(/^gui\/\d+\/com\.opencodex\.proxy$/);
  });

  test("an ordinary repair never runs enable, so a deliberate disable is not undone", () => {
    const plistPath = fixturePlist();
    const { argv, launchctl } = recordingLaunchctl({ bootstrap: [ok()] });

    installLaunchd({
      launchctl,
      plistPath,
      matches: () => ({ loaded: true, matchesPlist: true }),
      sleepSync: () => {},
    });

    expect(verbs(argv)).not.toContain("enable");
  });

  test("a malformed plist is not retried — the real stderr reaches the operator", () => {
    const plistPath = fixturePlist();
    const { argv, launchctl } = recordingLaunchctl({
      bootstrap: [fail(1, "Could not read plist: invalid XML")],
    });

    expect(() => installLaunchd({
      launchctl,
      plistPath,
      matches: () => ({ loaded: false, matchesPlist: false }),
      sleepSync: () => {},
    })).toThrow(/invalid XML/);

    expect(verbs(argv).filter(v => v === "bootstrap")).toHaveLength(1);
    expect(verbs(argv)).not.toContain("kickstart");
  });

  test("terminal failure restores the previous plist bytes and names the manual remedy", () => {
    const plistPath = fixturePlist();
    const previous = "<plist>the definition that was serving</plist>\n";
    writeFileSync(plistPath, previous, "utf8");
    const { argv, launchctl } = recordingLaunchctl({ bootstrap: [ok(), ok(), ok()] });

    let thrown: unknown;
    try {
      installLaunchd({
        launchctl,
        plistPath,
        matches: () => ({ loaded: false, matchesPlist: false }),
        sleepSync: () => {},
      });
    } catch (error) {
      thrown = error;
    }

    const message = thrown instanceof Error ? thrown.message : String(thrown);
    // The operator must be told the job is DOWN — the silent version of this is the outage.
    expect(message).toMatch(/evicted from gui\/\d+/);
    // And given the one command that recovered the real host, which `ocx` never printed.
    expect(message).toMatch(/launchctl bootstrap gui\/\d+ /);
    expect(message).toContain(plistPath);
    // Exit 5 can also mean the label sits in the domain's disabled list, so point at it.
    expect(message).toMatch(/launchctl print-disabled gui\/\d+/);
    // Rollback: the bytes that were serving are back on disk, and backed up next to it.
    expect(readFileSync(plistPath, "utf8")).toBe(previous);
    expect(readFileSync(`${plistPath}.prev`, "utf8")).toBe(previous);
    // The third bootstrap is the rollback's own re-registration attempt.
    expect(verbs(argv).filter(v => v === "bootstrap")).toHaveLength(3);
  });

  test("a fresh install has nothing to restore and says so without inventing a rollback", () => {
    const plistPath = fixturePlist();
    const { argv, launchctl } = recordingLaunchctl({ bootstrap: [ok(), ok()] });

    expect(() => installLaunchd({
      launchctl,
      plistPath,
      matches: () => ({ loaded: false, matchesPlist: false }),
      sleepSync: () => {},
    })).toThrow(/ocx service install/);

    expect(existsSync(`${plistPath}.prev`)).toBe(false);
    expect(verbs(argv).filter(v => v === "bootstrap")).toHaveLength(2);
  });

  test("the armed test guard refuses the developer's real LaunchAgents directory", () => {
    // Without the seam above, every case in this file rewrote the live plist.
    expect(() => installLaunchd({
      plistPath: join(protectedLaunchAgentsDirForTests(), "com.opencodex.proxy.plist"),
      launchctl: recordingLaunchctl({}).launchctl,
      matches: () => ({ loaded: true, matchesPlist: true }),
      sleepSync: () => {},
    })).toThrow(/real LaunchAgents directory/);
  });
});

describe("probeLaunchdLoadState: a tri-state, not one swallowed bit (#4236 defect 2)", () => {
  const printed = (command: string): LaunchctlResult => ok(`{\n\targuments = {\n\t\t${command}\n\t}\n}`);

  function probeWith(answers: Array<LaunchctlResult>, expected = "exec 'ocx' start --port 10100") {
    const asked: string[] = [];
    let call = 0;
    const launchctl = ((args: string[]) => {
      asked.push(args[1] ?? "");
      return answers[call++] ?? fail(113, "Could not find service");
    }) as typeof runLaunchctl;
    return { asked, probe: probeLaunchdLoadState({ launchctl, uid: 501, expectedCommand: () => expected }) };
  }

  test("exit 0 with the expected command is loaded-current", () => {
    const { asked, probe } = probeWith([printed("exec 'ocx' start --port 10100")]);
    expect(probe.state).toBe("loaded-current");
    expect(probe.domain).toBe("gui/501");
    // The gui domain answered, so the user domain is not asked.
    expect(asked).toEqual(["gui/501/com.opencodex.proxy"]);
  });

  test("exit 0 with a different command is loaded-stale", () => {
    const { probe } = probeWith([printed("exec '/old/bun' /old/cli.ts start --port 10100")]);
    expect(probe.state).toBe("loaded-stale");
  });

  test("113 in gui is not absence — the user domain is asked too", () => {
    const { asked, probe } = probeWith([
      fail(113, "Could not find service"),
      printed("exec 'ocx' start --port 10100"),
    ]);
    // `gui/` and `user/` are independent and hold separate service sets; asking one left
    // the other free to hold a job the old `launchctl list | grep` called absent.
    expect(asked).toEqual(["gui/501/com.opencodex.proxy", "user/501/com.opencodex.proxy"]);
    expect(probe.state).toBe("loaded-current");
    expect(probe.domain).toBe("user/501");
  });

  test("113 from both domains is proof of absence", () => {
    const { probe } = probeWith([fail(113, "Could not find service"), fail(113, "Could not find service")]);
    expect(probe.state).toBe("not-loaded");
  });

  test("112 is an answer about the DOMAIN and cannot hide a job of ours", () => {
    // A headless Mac has no GUI domain and no installation either; calling that `unknown`
    // would refuse every verdict on it.
    const { probe } = probeWith([fail(112, "Could not find domain for"), fail(113, "Could not find service")]);
    expect(probe.state).toBe("not-loaded");
  });

  test("a spawn failure is unknown, never absence", () => {
    const { probe } = probeWith([{ ok: false, stdout: "", stderr: "spawn /bin/launchctl ENOENT", status: null }]);
    expect(probe.state).toBe("unknown");
    expect(probe.detail).toContain("launchctl could not be run");
  });

  test("an undocumented exit status is unknown, never absence", () => {
    // EPERM from a bootstrap server, a missing grep, an execSync maxBuffer overflow: the
    // old probe collapsed all of them into the same empty string as genuine absence.
    const { probe } = probeWith([fail(1, "Operation not permitted")]);
    expect(probe.state).toBe("unknown");
    expect(probe.detail).toContain("exited 1");
  });
});

describe("deriveLaunchdServiceDiagnostic: what status is allowed to claim", () => {
  const diagnostics = "paths ok";

  test("loaded-current is loaded and viable", () => {
    const diag = deriveLaunchdServiceDiagnostic({
      installed: true, stale: false, load: { state: "loaded-current", domain: "gui/501" }, diagnostics,
    });
    expect(diag.summary).toContain("installed and loaded (launchd;");
    expect(diag.running).toBe(true);
    expect(diag.viable).toBe(true);
  });

  test("loaded-stale says which plist, instead of claiming health", () => {
    const diag = deriveLaunchdServiceDiagnostic({
      installed: true, stale: false, load: { state: "loaded-stale", domain: "gui/501" }, diagnostics,
    });
    expect(diag.summary).toContain("loaded from an OLDER plist");
    expect(diag.running).toBe(true);
  });

  test("not-loaded keeps the actionable text", () => {
    const diag = deriveLaunchdServiceDiagnostic({
      installed: true, stale: false, load: { state: "not-loaded" }, diagnostics,
    });
    expect(diag.summary).toContain("installed, not loaded (launchd;");
    expect(diag.running).toBe(false);
    expect(diag.viable).toBe(false);
  });

  test("unknown never prints 'installed, not loaded' and never recommends repair", () => {
    const diag = deriveLaunchdServiceDiagnostic({
      installed: true,
      stale: false,
      load: { state: "unknown", detail: "launchctl print gui/501/com.opencodex.proxy exited 1" },
      diagnostics,
    });
    // The reported symptom was `installed, not loaded` above a live proxy, with
    // `re-run 'ocx service repair'` attached — the command that causes defect 1.
    expect(diag.summary).not.toContain("not loaded");
    expect(diag.summary).not.toContain("service repair");
    expect(diag.summary).toContain("could not be verified");
    expect(diag.summary).toContain("exited 1");
    // And `viable` stays true: `isServiceViable() === false` is what makes the update
    // fallback (src/update/index.ts, src/update/job.ts) treat a successful repair as a
    // dead supervisor and start a COMPETING proxy on the service's own port. A failed
    // probe is not evidence against the service.
    expect(diag.viable).toBe(true);
    expect(diag.startable).toBe(true);
  });

  test("stale baked paths still win over every load state", () => {
    for (const state of ["loaded-current", "loaded-stale", "not-loaded", "unknown"] as const) {
      const diag = deriveLaunchdServiceDiagnostic({ installed: true, stale: true, load: { state }, diagnostics });
      expect(diag.summary).toContain("installed, but stale");
      expect(diag.viable).toBe(false);
    }
  });

  test("not installed reports absence whatever the probe says", () => {
    const diag = deriveLaunchdServiceDiagnostic({
      installed: false, stale: false, load: { state: "unknown", detail: "x" }, diagnostics,
    });
    expect(diag.summary).toBe(`not installed (${diagnostics})`);
    expect(diag.viable).toBe(false);
  });
});

/**
 * Source-oracle cases. The two remaining defects are shapes of the command dispatcher and
 * the install-cleanup ops, neither of which can be driven without a live launchd or a whole
 * CLI process, so assert the shape instead of mocking the world.
 */
describe("the surfaces around the repair (#4236 defects 1f, 1h, 2)", () => {
  const source = readFileSync(repoPath("src", "service.ts"), "utf8");

  function slice(from: string, to: string): string {
    const start = source.indexOf(from);
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf(to, start + from.length);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
  }

  test("the repair branch still reports serving when repairService throws (1f)", () => {
    const branch = slice('if (command === "repair") {', "// Non-install subcommands follow");
    // Without the catch, a throw escaped through src/cli/dispatch.ts to the top level and
    // the one command that can evict a hub never reached its own serving check.
    expect(branch).toContain("try {");
    expect(branch).toContain("await repairService();");
    expect(branch).toContain("} catch (error) {");
    expect(branch).toContain('await reportServiceServing("repaired");');
    expect(branch).toContain("process.exitCode = 1;");
    // The serving check must not be inside the try, or a throw would still skip it.
    expect(branch.indexOf("} catch (error) {")).toBeLessThan(branch.indexOf('reportServiceServing("repaired")'));
  });

  test("install cleanup uses the same probe and the modern evict verb (1h, 2)", () => {
    const ops = slice("function platformServiceInstallCleanupOps(", 'if (process.platform === "win32") {');
    // `unload` cannot evict a gui-domain job — the file's own comment on installLaunchd
    // says so — and `launchctl list` was the other half of defect 2.
    expect(ops).not.toContain("launchctl unload");
    expect(ops).not.toContain('sh("launchctl list")');
    expect(ops).toContain("probeLaunchdLoadState()");
    expect(ops).toContain('runLaunchctl(["bootout"');
    // Installing over a manager we could not query is the unsafe direction, so this probe
    // keeps failing closed on `unknown` even though `diagnoseService` does not.
    expect(ops).toContain('probe.state === "unknown"');
  });

  test("diagnoseService no longer grep-matches launchctl list (2)", () => {
    const branch = slice("export function diagnoseService()", 'if (process.platform === "win32") {');
    expect(branch).toContain("probeLaunchdLoadState()");
    expect(branch).toContain("deriveLaunchdServiceDiagnostic(");
    expect(branch).not.toContain("statusLaunchd");
    // The executable form is gone; the prose naming what it did deliberately stays.
    expect(source).not.toContain("sh(`launchctl list | grep");
  });

  /**
   * Found while building the cases above: `installLaunchd` writes install state, and
   * `serviceStatePaths()` deliberately includes a legacy `~/.opencodex/service-state.json`
   * entry for installs made before OPENCODEX_HOME existed. Under the test sandbox that
   * entry is the developer's LIVE record — one case replaced its codexHome and
   * opencodexHome with temp-directory paths before this filter existed.
   */
  test("install state never reaches the real home from a test process", () => {
    const fn = slice("function serviceStatePaths()", "function currentCodexHome(");
    expect(fn).toContain("isTestHomeGuardArmed()");
    expect(fn).toContain("protectedHomeForTests()");
    expect(fn).toContain("paths.filter(");
  });

  test("stop and uninstall prefer bootout and keep unload only as a fallback (D)", () => {
    const stop = slice("function stopLaunchd(", "function statusLaunchd(");
    expect(stop).toContain('run(["bootout"');
    // The legacy verb survives for exactly one case: launchctl could not be spawned at
    // all (`status === null`), which is the only state a second attempt can improve.
    expect(stop).toContain("launchctl unload");
    expect(stop.indexOf('run(["bootout"')).toBeLessThan(stop.indexOf("launchctl unload"));
    const uninstall = slice("function uninstallLaunchd(", "/**");
    expect(uninstall).toContain("stopLaunchd(deps)");
    expect(uninstall).not.toContain("launchctl unload");
  });
});
