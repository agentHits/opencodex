/**
 * #4202 review (Ingwannu, blocking on PR #4203): the pnpm path may resolve a dependency
 * outside the package directory, but the npm verifier must stay confined to the candidate's
 * own tree. Node's resolver walks the ancestor chain, so a global npm candidate can otherwise
 * satisfy its bundled-Bun requirement from a sibling package's install. Three decisions read
 * that verdict — accepting the stage, rolling back after the swap, and reaping the only
 * backup at boot — so a non-self-contained candidate called healthy costs the known-good copy.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  bootRestoreProbe,
  verifyInstallTree,
  verifyPnpmInstallTree,
} from "../../src/update/transactional-install.mjs";
import { removeTreeWithRetry } from "../helpers/remove-tree";

const PKG = "@bitkyc08/opencodex";
const BUN_BYTES = 10 * 1024 * 1024 + 1024;

/** A dependency directory that would satisfy the manifest if it were ever consulted. */
function writeDependency(dir: string, name: string, opts: { truncated?: boolean } = {}): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name }));
  if (name === "bun") {
    writeFileSync(join(dir, "bun.exe"), Buffer.alloc(opts.truncated ? 1024 : BUN_BYTES));
  }
}

/** The package itself, with no dependencies of its own unless the caller adds them. */
function writePackage(packageDir: string, version: string): void {
  mkdirSync(join(packageDir, "bin"), { recursive: true });
  mkdirSync(join(packageDir, "node_modules"), { recursive: true });
  writeFileSync(join(packageDir, "package.json"), JSON.stringify({
    name: PKG, version, dependencies: { bun: "1", zod: "1" },
  }));
  writeFileSync(join(packageDir, "bin", "ocx.mjs"), "#!/usr/bin/env node\n" + "x".repeat(2048));
}

describe("#4202 install-tree dependency ownership", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ocx-tree-ownership-"));
  });

  afterEach(() => {
    removeTreeWithRetry(root);
  });

  /** Global npm layout: <prefix>/lib/node_modules/{@scope/pkg,bun,zod}. */
  function globalNpmFixture(opts: { ownBun?: "intact" | "truncated" } = {}): string {
    const globalRoot = join(root, "lib", "node_modules");
    const packageDir = join(globalRoot, ...PKG.split("/"));
    writePackage(packageDir, "2.0.0");
    // An unrelated global installation that happens to bundle the same dependencies.
    writeDependency(join(globalRoot, "bun"), "bun");
    writeDependency(join(globalRoot, "zod"), "zod");
    if (opts.ownBun) {
      writeDependency(join(packageDir, "node_modules", "bun"), "bun", {
        truncated: opts.ownBun === "truncated",
      });
    }
    return packageDir;
  }

  test("an npm candidate missing its own dependencies is not saved by an ancestor install", () => {
    const packageDir = globalNpmFixture();
    const result = verifyInstallTree(packageDir, "2.0.0");
    expect(result.ok).toBe(false);
    expect(result.failures).toContain("sentinel dependency missing: bun");
    expect(result.failures).toContain("sentinel dependency missing: zod");
  });

  test("an npm candidate with a truncated own Bun is not rescued by an intact ancestor Bun", () => {
    const packageDir = globalNpmFixture({ ownBun: "truncated" });
    const result = verifyInstallTree(packageDir, "2.0.0");
    expect(result.ok).toBe(false);
    expect(result.failures).toContain("bundled Bun binary missing or truncated (< 10MB)");
    // zod still has no copy inside the candidate, and the ancestor's does not count.
    expect(result.failures).toContain("sentinel dependency missing: zod");
  });

  test("a self-contained npm candidate still verifies", () => {
    const packageDir = globalNpmFixture({ ownBun: "intact" });
    writeDependency(join(packageDir, "node_modules", "zod"), "zod");
    expect(verifyInstallTree(packageDir, "2.0.0")).toEqual({ ok: true, failures: [] });
  });

  test("boot restore keeps the backup when the live tree only resolves through an ancestor", () => {
    // Live tree in a global npm layout, its dependencies supplied only by the sibling install.
    const globalRoot = join(root, "lib", "node_modules");
    const scopeDir = join(globalRoot, "@bitkyc08");
    const packageDir = join(scopeDir, "opencodex");
    writePackage(packageDir, "2.0.0");
    writeDependency(join(globalRoot, "bun"), "bun");
    writeDependency(join(globalRoot, "zod"), "zod");
    // A known-good backup from the previous swap, sitting where bootRestoreProbe looks.
    const backup = join(scopeDir, ".ocx-backup-2026-01-01T00-00-00-000Z", "opencodex");
    writePackage(backup, "1.0.0");
    writeDependency(join(backup, "node_modules", "bun"), "bun");
    writeDependency(join(backup, "node_modules", "zod"), "zod");

    const probe = bootRestoreProbe(packageDir);

    expect(probe.action).toBe("restored");
    expect(existsSync(join(packageDir, "node_modules", "bun", "package.json"))).toBe(true);
  });

  test("boot restore still reaps the backup for a genuinely self-contained live tree", () => {
    const scopeDir = join(root, "lib", "node_modules", "@bitkyc08");
    const packageDir = join(scopeDir, "opencodex");
    writePackage(packageDir, "2.0.0");
    writeDependency(join(packageDir, "node_modules", "bun"), "bun");
    writeDependency(join(packageDir, "node_modules", "zod"), "zod");
    const backupRoot = join(scopeDir, ".ocx-backup-2026-01-01T00-00-00-000Z");
    writePackage(join(backupRoot, "opencodex"), "1.0.0");

    const probe = bootRestoreProbe(packageDir);

    expect(probe.action).toBe("reaped");
    expect(existsSync(backupRoot)).toBe(false);
  });

  test("the pnpm verifier refuses an ancestor root that carries no pnpm bookkeeping", () => {
    // Same shape as the npm escape: a bare ancestor node_modules is somebody else's install.
    const packageDir = globalNpmFixture();
    const result = verifyPnpmInstallTree(packageDir, "2.0.0");
    expect(result.ok).toBe(false);
    expect(result.failures).toContain("sentinel dependency missing: bun");
  });

  test("the pnpm verifier accepts a hoisted group that pnpm's own metadata claims", () => {
    const groupRoot = join(root, "global", "v11", "node_modules");
    const packageDir = join(groupRoot, ...PKG.split("/"));
    writePackage(packageDir, "2.0.0");
    writeDependency(join(groupRoot, "bun"), "bun");
    writeDependency(join(groupRoot, "zod"), "zod");
    writeFileSync(join(groupRoot, ".modules.yaml"), "nodeLinker: hoisted\n");
    expect(verifyPnpmInstallTree(packageDir, "2.0.0")).toEqual({ ok: true, failures: [] });
  });

  test("the pnpm verifier accepts a virtual-store link reached through the package's own tree", () => {
    const store = join(root, "store", "v11", "node_modules", ".pnpm", "registry", "node_modules");
    const packageDir = join(root, "global", "v11", "node_modules", ...PKG.split("/"));
    writePackage(packageDir, "2.0.0");
    writeDependency(join(store, "bun"), "bun");
    writeDependency(join(store, "zod"), "zod");
    // pnpm's isolated linker links each declared dependency into the package's node_modules.
    symlinkSync(join(store, "bun"), join(packageDir, "node_modules", "bun"), "dir");
    symlinkSync(join(store, "zod"), join(packageDir, "node_modules", "zod"), "dir");
    expect(verifyPnpmInstallTree(packageDir, "2.0.0")).toEqual({ ok: true, failures: [] });
  });

  test("the npm verifier accepts the same virtual-store link, because the candidate owns it", () => {
    // The link lives inside the candidate's own node_modules, which is the npm contract too.
    const store = join(root, "store", "node_modules");
    const packageDir = join(root, "global", "node_modules", ...PKG.split("/"));
    writePackage(packageDir, "2.0.0");
    writeDependency(join(store, "bun"), "bun");
    writeDependency(join(store, "zod"), "zod");
    symlinkSync(join(store, "bun"), join(packageDir, "node_modules", "bun"), "dir");
    symlinkSync(join(store, "zod"), join(packageDir, "node_modules", "zod"), "dir");
    expect(verifyInstallTree(packageDir, "2.0.0")).toEqual({ ok: true, failures: [] });
  });

  test("a package root that is itself a pnpm symlink resolves through its realpath", () => {
    const target = join(root, "store", "v11", "node_modules", ".pnpm", "pkg", "node_modules", ...PKG.split("/"));
    writePackage(target, "2.0.0");
    writeDependency(join(target, "node_modules", "bun"), "bun");
    writeDependency(join(target, "node_modules", "zod"), "zod");
    const exposed = join(root, "global", "v11", "node_modules", ...PKG.split("/"));
    mkdirSync(join(root, "global", "v11", "node_modules", "@bitkyc08"), { recursive: true });
    symlinkSync(target, exposed, "dir");
    expect(verifyPnpmInstallTree(exposed, "2.0.0")).toEqual({ ok: true, failures: [] });
  });
});
