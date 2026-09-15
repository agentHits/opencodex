import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyModelFamilyForQuota,
  hasHeadroomEvidence,
  isAccountQuotaExhausted,
  rankAccountsByHeadroom,
  rankAccountsByResetFirst,
} from "../../src/oauth/account-quota-rank";
import {
  clearGenericFailoverHealth,
  preferredInitialAccount,
  rotateGenericOAuthAccountOn429,
} from "../../src/oauth/generic-account-failover";
import { getAccountSet, saveCredential, setActiveAccount } from "../../src/oauth/store";
import { clearAccountQuotaCache, setCachedProviderAccountQuotaForTests } from "../../src/providers/quota";
import type { OcxConfig, OcxProviderConfig } from "../../src/types";
import { removeTreeWithRetry } from "../helpers/remove-tree";

const originalHome = process.env.OPENCODEX_HOME;
let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ocx-ag-family-rank-"));
  process.env.OPENCODEX_HOME = home;
  clearGenericFailoverHealth();
});

afterEach(() => {
  clearGenericFailoverHealth();
  clearAccountQuotaCache();
  if (originalHome === undefined) delete process.env.OPENCODEX_HOME;
  else process.env.OPENCODEX_HOME = originalHome;
  removeTreeWithRetry(home);
});

const PROVIDER = {
  adapter: "google",
  authMode: "oauth",
} as unknown as OcxProviderConfig;

function config(): OcxConfig {
  return {
    providers: {
      "google-antigravity": { ...PROVIDER, oauthAccountFailover: { enabled: true } },
    },
    oauthAccountFailover: { enabled: true },
  } as unknown as OcxConfig;
}

function seedWindows(accountId: string, gem: number, cla: number): void {
  setCachedProviderAccountQuotaForTests("google-antigravity", accountId, {
    updatedAt: Date.now(),
    customWindows: [
      { label: "Gem", percent: gem },
      { label: "Gem (Weekly)", percent: gem },
      { label: "Cla", percent: cla },
      { label: "Cla (Weekly)", percent: cla },
    ],
  });
}

describe("classifyModelFamilyForQuota", () => {
  test("maps Gemini and Claude ids, and ignores Gemma", () => {
    expect(classifyModelFamilyForQuota("google-antigravity", "gemini-3.8-flash")).toBe("gem");
    expect(classifyModelFamilyForQuota("google-antigravity", "claude-sonnet-4-5")).toBe("cla");
    expect(classifyModelFamilyForQuota("google-antigravity", "gemma-3-27b")).toBeUndefined();
    expect(classifyModelFamilyForQuota("xai", "gemini-3.8-flash")).toBeUndefined();
    expect(classifyModelFamilyForQuota("google-antigravity", undefined)).toBeUndefined();
  });
});

describe("Antigravity family ranking", () => {
  test("does not treat a spent Claude window as Gemini exhaustion", () => {
    seedWindows("a", 10, 100);
    seedWindows("b", 80, 5);
    expect(isAccountQuotaExhausted("google-antigravity", "a", "gemini-3.8-flash")).toBe(false);
    expect(isAccountQuotaExhausted("google-antigravity", "a", "claude-sonnet-4-5")).toBe(true);
    expect(rankAccountsByHeadroom("google-antigravity", ["a", "b"], "gemini-3.8-flash")[0]).toBe("a");
    expect(rankAccountsByHeadroom("google-antigravity", ["a", "b"], "claude-sonnet-4-5")[0]).toBe("b");
  });

  test("falls back to the unranked ring when family labels are missing", () => {
    setCachedProviderAccountQuotaForTests("google-antigravity", "a", {
      updatedAt: Date.now(),
      customWindows: [{ label: "Other", percent: 1 }],
    });
    setCachedProviderAccountQuotaForTests("google-antigravity", "b", {
      updatedAt: Date.now(),
      customWindows: [{ label: "Other", percent: 99 }],
    });
    expect(hasHeadroomEvidence("google-antigravity", ["a", "b"], "gemini-3.8-flash")).toBe(false);
    expect(rankAccountsByHeadroom("google-antigravity", ["b", "a"], "gemini-3.8-flash")).toEqual(["b", "a"]);
  });
});

describe("Antigravity family-scoped cooldown", () => {
  test("a Claude 429 still keeps the account for Gemini", async () => {
    for (const accountId of ["acct-a", "acct-b"]) {
      await saveCredential("google-antigravity", {
        access: "access-" + accountId,
        refresh: "refresh-" + accountId,
        expires: Date.now() + 3_600_000,
        accountId,
      } as never, { addAccount: true });
    }
    const ids = getAccountSet("google-antigravity")?.accounts.map((account) => account.id) ?? [];
    expect(ids.length).toBe(2);
    await setActiveAccount("google-antigravity", ids[0]!);
    seedWindows(ids[0]!, 10, 100);
    seedWindows(ids[1]!, 80, 5);
    const cfg = config();
    expect(rotateGenericOAuthAccountOn429(cfg, "google-antigravity", ids[0]!, null, Date.now(), "claude-sonnet-4-5")).toBe(ids[1]);
    expect(preferredInitialAccount(cfg, "google-antigravity", Date.now(), "gemini-3.8-flash")).toBeNull();
  });
});

describe("Antigravity reset-first weekly prioritization", () => {
  test("prefers account whose weekly allowance resets earliest, even with less headroom", () => {
    const now = Date.now();
    // Account A: resets in 2 days, 1% headroom left (almost spent, but will reset soon)
    setCachedProviderAccountQuotaForTests("google-antigravity", "a", {
      updatedAt: now,
      customWindows: [
        { label: "Gem", percent: 45, resetAt: now + 2 * 3600_000 },
        { label: "Gem (Weekly)", percent: 99, resetAt: now + 2 * 86400_000 },
      ],
    });
    // Account B: resets in 7 days, 95% headroom left (fresh weekly window)
    setCachedProviderAccountQuotaForTests("google-antigravity", "b", {
      updatedAt: now,
      customWindows: [
        { label: "Gem", percent: 0, resetAt: now + 5 * 3600_000 },
        { label: "Gem (Weekly)", percent: 5, resetAt: now + 7 * 86400_000 },
      ],
    });

    // Headroom rank prefers B (more headroom)
    expect(rankAccountsByHeadroom("google-antigravity", ["a", "b"], "gemini-3.8-flash")[0]).toBe("b");
    // Reset-first rank prefers A (earlier reset, spend before it expires!)
    expect(rankAccountsByResetFirst("google-antigravity", ["b", "a"], "gemini-3.8-flash", now)[0]).toBe("a");
  });

  test("preferredInitialAccount selects soonest reset and sticks until failure", async () => {
    const now = Date.now();
    for (const accountId of ["acct-soon", "acct-later"]) {
      await saveCredential("google-antigravity", {
        access: "access-" + accountId,
        refresh: "refresh-" + accountId,
        expires: now + 3_600_000,
        accountId,
      } as never, { addAccount: true });
    }
    const ids = getAccountSet("google-antigravity")?.accounts.map(a => a.id) ?? [];
    expect(ids.length).toBe(2);

    setCachedProviderAccountQuotaForTests("google-antigravity", ids[0]!, {
      updatedAt: now,
      customWindows: [
        { label: "Gem", percent: 20 },
        { label: "Gem (Weekly)", percent: 80, resetAt: now + 2 * 86400_000 },
      ],
    });
    setCachedProviderAccountQuotaForTests("google-antigravity", ids[1]!, {
      updatedAt: now,
      customWindows: [
        { label: "Gem", percent: 0 },
        { label: "Gem (Weekly)", percent: 10, resetAt: now + 7 * 86400_000 },
      ],
    });

    const cfg = {
      providers: {
        "google-antigravity": {
          ...PROVIDER,
          oauthAccountFailover: { enabled: true, strategy: "reset-first" },
        },
      },
      oauthAccountFailover: { enabled: true },
    } as unknown as OcxConfig;

    // If later account is currently active, initial preference routes to soonest reset
    await setActiveAccount("google-antigravity", ids[1]!);
    expect(preferredInitialAccount(cfg, "google-antigravity", now, "gemini-3.8-flash")).toBe(ids[0]);

    // Once soonest account is active, it stays (sticky)
    await setActiveAccount("google-antigravity", ids[0]!);
    expect(preferredInitialAccount(cfg, "google-antigravity", now, "gemini-3.8-flash")).toBeNull();

    // When it 429s, it rotates to next available
    expect(rotateGenericOAuthAccountOn429(cfg, "google-antigravity", ids[0]!, null, now, "gemini-3.8-flash")).toBe(ids[1]);
  });
});
