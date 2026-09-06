import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { removeTreeWithRetry } from "../helpers/remove-tree";
import { repoPath } from "../helpers/repo-root";
import { INTERNAL_DEADLINE_MS, SPAWN_BUDGET_MS } from "../helpers/test-budget";

// Deliberately independent of the real six-file policy: expansion, quoting, and
// index-based ownership must work for canonical paths relative to tests/.
const SERIAL_FILES = [
  "serial/falcon.test.ts",
  "nested/lane/ibis.test.ts",
  "serial/lynx.test.ts",
  "other/tern.test.ts",
];
const GENERAL_FILES = ["general/ordinary.test.ts", "general/falcon-extra.test.ts"];
const ASSERTION_STATUS = 23;
const CRASH_STATUS = 139;
const CRASH_SIGNATURES = [
  "oh no: Bun has crashed",
  "Internal assertion failure",
  "Segmentation fault at address 0x1234",
  "Illegal instruction",
  "Bus error",
  "Aborted (core dumped)",
];

type Invocation = { kind: "manifest" | "test"; argv: string[]; pid: number };
type FixtureOptions = {
  manifest?: string[];
  manifestStatus?: number;
  missing?: string;
  collision?: boolean;
  target?: "main" | string;
  outcomes?: Array<"assert" | "crash">;
  crashSignature?: string;
};

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function macosTestBlock(shard: number): string {
  const workflow = Bun.YAML.parse(readFileSync(repoPath(".github/workflows/ci.yml"), "utf8")) as {
    jobs: Record<string, { steps: Array<{ name?: string; run?: string }> }>;
  };
  const run = workflow.jobs["platform-macos"]?.steps.find(step => step.name === "Test")?.run;
  if (!run) throw new Error("platform-macos must contain the executable Test step");
  // Render the existing Actions expression too, so the old workflow reaches
  // the ownership assertions instead of failing with Bash's 'bad substitution'.
  return run.replace(/\$\{\{\s*matrix\.shard\s*\}\}/g, String(shard));
}

// Only the Bun CLI is replaced. Bash, arrays, find, pipes, PIPESTATUS, and
// filesystem validation all execute unchanged from the actual YAML run block.
const FAKE_BUN = String.raw`
import { appendFileSync, readFileSync } from "node:fs";
const config = JSON.parse(readFileSync(process.env.MACOS_FIXTURE_CONFIG, "utf8"));
const log = process.env.MACOS_FIXTURE_LOG;
const argv = process.argv.slice(2);
const record = kind => appendFileSync(log, JSON.stringify({ kind, argv, pid: process.pid }) + "\n");
if (argv[0] === "-e") {
  record("manifest");
  process.stdout.write(config.manifest.join("\n") + (config.manifest.length ? "\n" : ""));
  process.exit(config.manifestStatus);
}
if (argv[0] !== "test") {
  console.error("unexpected fake Bun invocation", JSON.stringify(argv));
  process.exit(97);
}
record("test");
const matches = args => config.target === "main" ? args.includes("tests")
  : args.some(arg => arg.replace(/^\.\//, "") === "tests/" + config.target);
if (!matches(argv)) process.exit(0);
const attempts = readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line))
  .filter(entry => entry.kind === "test" && matches(entry.argv)).length;
const outcome = config.outcomes[attempts - 1];
if (outcome === "assert") {
  console.error("(fail) fixture assertion: expected true, received false");
  process.exit(config.assertionStatus);
}
if (outcome === "crash") {
  // Deliberately not the final output line: the shell must capture the stream.
  console.error(config.crashSignature);
  console.error("fixture runtime diagnostic tail");
  process.exit(config.crashStatus);
}
process.exit(0);
`;

function createFixture(directory: string, options: FixtureOptions): void {
  mkdirSync(join(directory, "bin"));
  mkdirSync(join(directory, "tmp"));
  for (const file of [...SERIAL_FILES, ...GENERAL_FILES]) {
    if (file === options.missing) continue;
    mkdirSync(dirname(join(directory, "tests", file)), { recursive: true });
    writeFileSync(join(directory, "tests", file), "");
  }
  if (options.collision) {
    mkdirSync(join(directory, "tests/collision"));
    writeFileSync(join(directory, "tests/collision", basename(SERIAL_FILES[0]!)), "");
  }
  writeFileSync(join(directory, "fake-bun.mjs"), FAKE_BUN);
  writeFileSync(join(directory, "bin/bun"),
    `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(join(directory, "fake-bun.mjs"))} "$@"\n`,
    { mode: 0o755 });
  writeFileSync(join(directory, "config.json"), JSON.stringify({
    manifest: SERIAL_FILES, manifestStatus: 0, target: "main", outcomes: [],
    assertionStatus: ASSERTION_STATUS, crashStatus: CRASH_STATUS,
    crashSignature: CRASH_SIGNATURES[0], ...options,
  }));
}

function runShard(shard: number, options: FixtureOptions = {}) {
  // Spaces and a quote in cwd exercise the executable/config/log path quoting
  // without inventing manifest characters forbidden by the source path policy.
  const directory = mkdtempSync(join(tmpdir(), "ocx macos' lanes-"));
  let pid: number | undefined;
  let interrupted = false;
  try {
    createFixture(directory, options);
    const log = join(directory, "invocations.jsonl");
    // Use the runner's native /bin/bash (Bash 3 on macOS), never a shell mock.
    const result = spawnSync("/bin/bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", macosTestBlock(shard)], {
      cwd: directory, encoding: "utf8", detached: true,
      timeout: INTERNAL_DEADLINE_MS, killSignal: "SIGKILL", maxBuffer: 256 * 1024,
      env: {
        PATH: `${join(directory, "bin")}:/usr/bin:/bin`, HOME: directory,
        TMPDIR: join(directory, "tmp"), RUNNER_TEMP: join(directory, "tmp"), CI: "true",
        MACOS_TEST_SHARD: String(shard),
        MACOS_FIXTURE_CONFIG: join(directory, "config.json"), MACOS_FIXTURE_LOG: log,
      },
    });
    pid = result.pid;
    interrupted = Boolean(result.error || result.signal);
    if (result.error) throw result.error;
    if (result.signal) throw new Error(`macOS shell terminated by ${result.signal}: ${result.stderr}`);
    const invocations: Invocation[] = existsSync(log)
      ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line))
      : [];
    return { status: result.status, output: result.stdout + result.stderr, invocations };
  } finally {
    // A shell timeout must not leave its tee/fake-Bun descendants behind.
    try {
      if (interrupted && pid && pid > 0) process.kill(-pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    } finally {
      removeTreeWithRetry(directory);
    }
  }
}

function testCalls(result: ReturnType<typeof runShard>): Invocation[] {
  return result.invocations.filter(call => call.kind === "test");
}

function testPaths(call: Invocation): string[] {
  return call.argv.map(arg => arg.replace(/^\.\//, ""))
    .filter(arg => arg === "tests" || arg.startsWith("tests/"));
}

function targets(call: Invocation, target: string): boolean {
  return testPaths(call).includes(target === "main" ? "tests" : `tests/${target}`);
}

function optionValues(argv: string[], option: string): string[] {
  return argv.flatMap((arg, index) => arg === option ? [argv[index + 1] ?? ""]
    : arg.startsWith(`${option}=`) ? [arg.slice(option.length + 1)] : []);
}

function expectGeneralCall(call: Invocation, shard: number): void {
  const ignores = optionValues(call.argv, "--path-ignore-patterns");
  expect(ignores.toSorted()).toEqual(SERIAL_FILES.map(file => `**/${basename(file)}`).toSorted());
  expect(optionValues(call.argv, "--shard")).toEqual([`${shard}/2`]);
  expect(optionValues(call.argv, "--timeout")).toEqual(["60000"]);
  expect(call.argv).toContain("--isolate");
  expect(testPaths(call)).toEqual(["tests"]);
  // Account for every CLI argument: a name filter or extra exclusion could
  // silently drop ordinary files even while the serial ownership oracle passes.
  expect(call.argv.toSorted()).toEqual([
    "test", "--isolate", "--timeout", "60000", "tests", `--shard=${shard}/2`,
    ...SERIAL_FILES.flatMap(file => ["--path-ignore-patterns", `**/${basename(file)}`]),
  ].toSorted());
  // Exact exclusions above plus the unrestricted tests root leave these files
  // in the main pool. Similar basenames must not become accidental exclusions.
  for (const file of GENERAL_FILES) expect(ignores).not.toContain(`**/${basename(file)}`);
}

// These are explicitly Unix Bash integration tests; Windows still runs the
// existing cross-platform workflow source/layout contracts unchanged.
describe.skipIf(process.platform === "win32")("macOS serial lane shell ownership", () => {
  test("both shards own each canonical file exactly once in a fresh isolated process", () => {
    const runs = [runShard(1), runShard(2)];
    for (const [index, run] of runs.entries()) {
      expect(run.status, run.output).toBe(0);
      const calls = testCalls(run);
      const serial = calls.filter(call => !call.argv.includes("tests"));
      const owned = SERIAL_FILES.filter((_, fileIndex) => fileIndex % 2 === index);
      // First oracle deliberately fails old CI for missing isolated ownership.
      expect(serial.length, "missing isolated ownership of canonical serial files").toBe(owned.length);
      expect(calls.filter(call => call.argv.includes("tests"))).toHaveLength(1);
      expectGeneralCall(calls[0]!, index + 1);
      expect(serial.map(testPaths)).toEqual(owned.map(file => [`tests/${file}`]));
      for (const call of serial) {
        expect(call.argv).toContain("--parallel=1");
        expect(call.argv).toContain("--isolate");
        expect(optionValues(call.argv, "--timeout")).toEqual(["60000"]);
        expect(optionValues(call.argv, "--shard")).toEqual([]);
        expect(optionValues(call.argv, "--path-ignore-patterns")).toEqual([]);
      }
      const manifests = run.invocations.filter(call => call.kind === "manifest");
      expect(manifests).toHaveLength(1);
      expect(manifests[0]!.argv[1]).toContain("SERIAL_FULL_SUITE_FILES");
    }
    const calls = runs.flatMap(testCalls);
    expect(new Set(calls.map(call => call.pid)).size).toBe(calls.length);
  }, SPAWN_BUDGET_MS);

  for (const target of ["main", SERIAL_FILES[0]!] as const) {
    test(`${target}: assertion failure propagates without retry or later files`, () => {
      const run = runShard(1, { target, outcomes: ["assert"] });
      expect(run.status, run.output).toBe(ASSERTION_STATUS);
      const calls = testCalls(run);
      expect(calls).toHaveLength(target === "main" ? 1 : 2);
      expect(targets(calls.at(-1)!, target)).toBe(true);
    }, SPAWN_BUDGET_MS);

    test.each(CRASH_SIGNATURES)(`${target}: retries one runtime crash (%s), then finishes`, signature => {
      const run = runShard(1, { target, outcomes: ["crash"], crashSignature: signature });
      expect(run.status, run.output).toBe(0);
      const calls = testCalls(run);
      const attempts = calls.filter(call => targets(call, target));
      expect(attempts).toHaveLength(2);
      expect(attempts[0]!.argv).toEqual(attempts[1]!.argv);
      expect(new Set(calls.map(call => call.pid)).size).toBe(calls.length);
      expect(calls).toHaveLength(4); // Main plus two owned serial files plus one retry.
      expect(targets(calls.at(-1)!, SERIAL_FILES[2]!)).toBe(true);
    }, SPAWN_BUDGET_MS);

    test(`${target}: a repeated crash fails after exactly one retry`, () => {
      const run = runShard(1, { target, outcomes: ["crash", "crash"] });
      expect(run.status, run.output).toBe(CRASH_STATUS);
      const calls = testCalls(run);
      expect(calls).toHaveLength(target === "main" ? 2 : 3);
      const attempts = calls.filter(call => targets(call, target));
      expect(attempts).toHaveLength(2);
      expect(attempts[0]!.argv).toEqual(attempts[1]!.argv);
    }, SPAWN_BUDGET_MS);

    test(`${target}: assertion on the crash retry retains its own exit status`, () => {
      const run = runShard(1, { target, outcomes: ["crash", "assert"] });
      expect(run.status, run.output).toBe(ASSERTION_STATUS);
      const calls = testCalls(run);
      expect(calls).toHaveLength(target === "main" ? 2 : 3);
      expect(calls.filter(call => targets(call, target))).toHaveLength(2);
      expect(run.output).toContain("assertion failures are not retried");
      expect(run.output).not.toContain("crash repeated");
    }, SPAWN_BUDGET_MS);
  }

  const invalidManifests: Array<[string, FixtureOptions]> = [
    ["producer failure despite valid output", { manifestStatus: 19 }],
    ["empty manifest", { manifest: [] }],
    ["duplicate entry", { manifest: [...SERIAL_FILES, SERIAL_FILES[0]!] }],
    ["missing file", { missing: SERIAL_FILES[3] }],
    ["basename collision", { collision: true }],
    ["basename without its full relative path", { manifest: [basename(SERIAL_FILES[0]!)] }],
    ["absolute path", { manifest: [`/${SERIAL_FILES[0]}`] }],
    ["parent traversal", { manifest: ["serial/../serial/falcon.test.ts"] }],
  ];
  test.each(invalidManifests)("rejects %s before any tests start", (_name, options) => {
    for (const shard of [1, 2]) {
      const run = runShard(shard, options);
      expect(run.status, run.output).not.toBe(0);
      expect(testCalls(run), run.output).toEqual([]);
      expect(run.invocations.filter(call => call.kind === "manifest")).toHaveLength(1);
    }
  }, SPAWN_BUDGET_MS);
});
