import { afterEach, describe, expect, test } from "bun:test";
import {
  antigravityReplayMetricsForTests,
  antigravityUsesReplayCache,
  applyAntigravityReplay,
  clearAntigravityReplay,
  observeAntigravityReplay,
  setAntigravityReplayLimitsForTests,
} from "../src/adapters/google-antigravity-replay";
import { sanitizeAntigravityClaudeSignatures } from "../src/adapters/google-antigravity-wire";

afterEach(() => setAntigravityReplayLimitsForTests(null));

const SIG = "sig-1234567890abcdef"; // >= 16 chars
const MODEL = "gemini-3-pro";
const SESSION = "-12345";

describe("antigravity reasoning-replay cache", () => {
  // Signatures are keyed by functionCall identity (name + args), so observe/apply use functionCall parts.
  const fcPart = (name: string, args: unknown, sig?: string, nested = false) => {
    const part: Record<string, unknown> = { functionCall: { name, args } };
    if (sig && nested) part.extra_content = { google: { thought_signature: sig } };
    else if (sig) part.thoughtSignature = sig;
    return part;
  };

  test("observe then apply re-injects the signature onto the matching functionCall part", () => {
    observeAntigravityReplay(MODEL, SESSION, [fcPart("get_x", { a: 1 }, SIG)]);
    const contents = [
      { role: "user", parts: [{ text: "hi" }] },
      { role: "model", parts: [{ functionCall: { name: "get_x", args: { a: 1 } } }] },
    ];
    applyAntigravityReplay(MODEL, SESSION, contents);
    expect((contents[1].parts[0] as { thoughtSignature?: string }).thoughtSignature).toBe(SIG);
  });

  test("ignores signatures shorter than the minimum length", () => {
    observeAntigravityReplay(MODEL, SESSION, [fcPart("get_x", {}, "short")]);
    const contents = [{ role: "model", parts: [{ functionCall: { name: "get_x", args: {} } }] }];
    applyAntigravityReplay(MODEL, SESSION, contents);
    expect((contents[0].parts[0] as { thoughtSignature?: string }).thoughtSignature).toBeUndefined();
  });

  test("does not clobber an existing signature on the outgoing part", () => {
    observeAntigravityReplay(MODEL, SESSION, [fcPart("get_x", {}, SIG)]);
    const contents = [{ role: "model", parts: [{ functionCall: { name: "get_x", args: {} }, thoughtSignature: "existing-sig-abcdef" }] }];
    applyAntigravityReplay(MODEL, SESSION, contents);
    expect((contents[0].parts[0] as { thoughtSignature?: string }).thoughtSignature).toBe("existing-sig-abcdef");
  });

  test("reads the nested extra_content.google.thought_signature alias", () => {
    observeAntigravityReplay(MODEL, SESSION, [fcPart("get_x", {}, SIG, true)]);
    const contents = [{ role: "model", parts: [{ functionCall: { name: "get_x", args: {} } }] }];
    applyAntigravityReplay(MODEL, SESSION, contents);
    expect((contents[0].parts[0] as { thoughtSignature?: string }).thoughtSignature).toBe(SIG);
  });

  test("clear-on-invalid empties the entry", () => {
    observeAntigravityReplay(MODEL, SESSION, [fcPart("get_x", {}, SIG)]);
    clearAntigravityReplay(MODEL, SESSION);
    const contents = [{ role: "model", parts: [{ functionCall: { name: "get_x", args: {} } }] }];
    applyAntigravityReplay(MODEL, SESSION, contents);
    expect((contents[0].parts[0] as { thoughtSignature?: string }).thoughtSignature).toBeUndefined();
  });

  test("retains EVERY signature across a sequential tool loop (regression)", () => {
    // Step 1: FC1 returns sig A.
    observeAntigravityReplay(MODEL, SESSION, [fcPart("fc1", { i: 1 }, "sig-aaaaaaaaaaaaaaaa")]);
    // Step 2: FC2 returns sig B (different identity, same partIndex 0).
    observeAntigravityReplay(MODEL, SESSION, [fcPart("fc2", { i: 2 }, "sig-bbbbbbbbbbbbbbbb")]);
    // Next request history has both model turns; BOTH must get their own signature back.
    const contents = [
      { role: "model", parts: [{ functionCall: { name: "fc1", args: { i: 1 } } }] },
      { role: "user", parts: [{ text: "result1" }] },
      { role: "model", parts: [{ functionCall: { name: "fc2", args: { i: 2 } } }] },
    ];
    applyAntigravityReplay(MODEL, SESSION, contents);
    expect((contents[0].parts[0] as { thoughtSignature?: string }).thoughtSignature).toBe("sig-aaaaaaaaaaaaaaaa");
    expect((contents[2].parts[0] as { thoughtSignature?: string }).thoughtSignature).toBe("sig-bbbbbbbbbbbbbbbb");
  });

  test("nested arg objects do not collide on the identity key (regression)", () => {
    // Same tool name + same top-level key shape, but different NESTED values → distinct signatures.
    observeAntigravityReplay(MODEL, SESSION, [fcPart("edit", { outer: { x: 1, y: 2 }, z: 3 }, "sig-nested-aaaa0000")]);
    observeAntigravityReplay(MODEL, SESSION, [fcPart("edit", { outer: { x: 9, y: 8 }, z: 3 }, "sig-nested-bbbb1111")]);
    const contents = [
      { role: "model", parts: [{ functionCall: { name: "edit", args: { outer: { x: 1, y: 2 }, z: 3 } } }] },
      { role: "model", parts: [{ functionCall: { name: "edit", args: { outer: { x: 9, y: 8 }, z: 3 } } }] },
    ];
    applyAntigravityReplay(MODEL, SESSION, contents);
    expect((contents[0].parts[0] as { thoughtSignature?: string }).thoughtSignature).toBe("sig-nested-aaaa0000");
    expect((contents[1].parts[0] as { thoughtSignature?: string }).thoughtSignature).toBe("sig-nested-bbbb1111");
  });

  test("key is order-independent for nested object keys (observe vs history key order)", () => {
    observeAntigravityReplay(MODEL, SESSION, [fcPart("e", { a: { p: 1, q: 2 } }, "sig-orderindep00000")]);
    // History serializes the same args with a different key order.
    const contents = [{ role: "model", parts: [{ functionCall: { name: "e", args: { a: { q: 2, p: 1 } } } }] }];
    applyAntigravityReplay(MODEL, SESSION, contents);
    expect((contents[0].parts[0] as { thoughtSignature?: string }).thoughtSignature).toBe("sig-orderindep00000");
  });

  test("claude models do not use the replay cache", () => {
    expect(antigravityUsesReplayCache("claude-opus-4.6")).toBe(false);
    expect(antigravityUsesReplayCache("gemini-3-pro")).toBe(true);
    observeAntigravityReplay("claude-opus-4.6", SESSION, [fcPart("get_x", {}, SIG)]);
    const contents = [{ role: "model", parts: [{ functionCall: { name: "get_x", args: {} } }] }];
    applyAntigravityReplay("claude-opus-4.6", SESSION, contents);
    expect((contents[0].parts[0] as { thoughtSignature?: string }).thoughtSignature).toBeUndefined();
  });

  test("retains long sequential loops up to the 256-call production boundary", () => {
    for (let i = 0; i < 260; i++) {
      observeAntigravityReplay(MODEL, SESSION, [
        fcPart(`call-${i}`, { i }, `sig-${String(i).padStart(3, "0")}-${"x".repeat(16)}`),
      ]);
    }
    expect(antigravityReplayMetricsForTests()).toMatchObject({ sessions: 1, calls: 256 });

    const oldest = [{ role: "model", parts: [fcPart("call-0", { i: 0 })] }];
    const newest = [{ role: "model", parts: [fcPart("call-259", { i: 259 })] }];
    applyAntigravityReplay(MODEL, SESSION, oldest);
    applyAntigravityReplay(MODEL, SESSION, newest);
    expect((oldest[0].parts[0] as { thoughtSignature?: string }).thoughtSignature).toBeUndefined();
    expect((newest[0].parts[0] as { thoughtSignature?: string }).thoughtSignature).toContain("sig-259");
  });

  test("session byte pressure evicts the least-recently-used call", () => {
    setAntigravityReplayLimitsForTests({ maxBytesPerSession: 180 });
    for (const name of ["one", "two", "three"]) {
      observeAntigravityReplay(MODEL, SESSION, [fcPart(name, {}, `sig-${name}-${"x".repeat(16)}`)]);
    }

    const metrics = antigravityReplayMetricsForTests();
    expect(metrics.totalBytes).toBeLessThanOrEqual(180);
    expect(metrics.calls).toBe(2);
    const contents = ["one", "two", "three"].map(name => ({ role: "model", parts: [fcPart(name, {})] }));
    applyAntigravityReplay(MODEL, SESSION, contents);
    expect((contents[0].parts[0] as { thoughtSignature?: string }).thoughtSignature).toBeUndefined();
    expect((contents[2].parts[0] as { thoughtSignature?: string }).thoughtSignature).toContain("sig-three");
  });

  test("apply refreshes call and session LRU without extending TTL", () => {
    setAntigravityReplayLimitsForTests({ maxEntries: 2, maxCallsPerSession: 2 });
    observeAntigravityReplay(MODEL, "one", [fcPart("old", {}, "sig-old-1234567890")]);
    observeAntigravityReplay(MODEL, "one", [fcPart("new", {}, "sig-new-1234567890")]);
    applyAntigravityReplay(MODEL, "one", [{ role: "model", parts: [fcPart("old", {})] }]);
    observeAntigravityReplay(MODEL, "one", [fcPart("third", {}, "sig-third-12345678")]);

    const calls = ["old", "new", "third"].map(name => ({ role: "model", parts: [fcPart(name, {})] }));
    applyAntigravityReplay(MODEL, "one", calls);
    expect((calls[0].parts[0] as { thoughtSignature?: string }).thoughtSignature).toContain("sig-old");
    expect((calls[1].parts[0] as { thoughtSignature?: string }).thoughtSignature).toBeUndefined();

    observeAntigravityReplay(MODEL, "two", [fcPart("tool", {}, "sig-two-1234567890")]);
    applyAntigravityReplay(MODEL, "one", [{ role: "model", parts: [fcPart("old", {})] }]);
    observeAntigravityReplay(MODEL, "three", [fcPart("tool", {}, "sig-three-12345678")]);
    expect(antigravityReplayMetricsForTests().sessions).toBe(2);
    const evicted = [{ role: "model", parts: [fcPart("tool", {})] }];
    applyAntigravityReplay(MODEL, "two", evicted);
    expect((evicted[0].parts[0] as { thoughtSignature?: string }).thoughtSignature).toBeUndefined();
  });

  test("global byte pressure evicts the least-recently-used session", () => {
    setAntigravityReplayLimitsForTests({ maxTotalBytes: 210 });
    for (const session of ["session-one", "session-two", "session-three"]) {
      observeAntigravityReplay(MODEL, session, [fcPart("tool", { session }, `sig-${session}-${"x".repeat(16)}`)]);
    }

    expect(antigravityReplayMetricsForTests()).toMatchObject({ sessions: 2, calls: 2 });
    const first = [{ role: "model", parts: [fcPart("tool", { session: "session-one" })] }];
    const last = [{ role: "model", parts: [fcPart("tool", { session: "session-three" })] }];
    applyAntigravityReplay(MODEL, "session-one", first);
    applyAntigravityReplay(MODEL, "session-three", last);
    expect((first[0].parts[0] as { thoughtSignature?: string }).thoughtSignature).toBeUndefined();
    expect((last[0].parts[0] as { thoughtSignature?: string }).thoughtSignature).toContain("session-three");
  });

  test("oversized replacement preserves the prior valid signature", () => {
    setAntigravityReplayLimitsForTests({ maxSignatureBytes: 32 });
    observeAntigravityReplay(MODEL, SESSION, [fcPart("tool", { a: 1 }, "sig-valid-1234567890")]);
    const before = antigravityReplayMetricsForTests();
    observeAntigravityReplay(MODEL, SESSION, [fcPart("tool", { a: 1 }, "x".repeat(33))]);

    const contents = [{ role: "model", parts: [fcPart("tool", { a: 1 })] }];
    applyAntigravityReplay(MODEL, SESSION, contents);
    expect((contents[0].parts[0] as { thoughtSignature?: string }).thoughtSignature)
      .toBe("sig-valid-1234567890");
    expect(antigravityReplayMetricsForTests().totalBytes).toBe(before.totalBytes);
  });

  test("duplicate replacement keeps exact byte accounting", () => {
    observeAntigravityReplay(MODEL, SESSION, [fcPart("tool", { a: 1 }, "sig-first-123456789")]);
    const firstBytes = antigravityReplayMetricsForTests().totalBytes;
    observeAntigravityReplay(MODEL, SESSION, [fcPart("tool", { a: 1 }, "sig-other-123456789")]);

    const metrics = antigravityReplayMetricsForTests();
    expect(metrics).toMatchObject({ sessions: 1, calls: 1 });
    expect(metrics.totalBytes).toBe(firstBytes);
  });

  test("large canonical arguments retain only a fixed-size digest key", () => {
    observeAntigravityReplay(MODEL, SESSION, [
      fcPart("huge", { text: "x".repeat(512 * 1024) }, "sig-fixed-key-123456"),
    ]);

    const metrics = antigravityReplayMetricsForTests();
    expect(metrics).toMatchObject({ sessions: 1, calls: 1 });
    expect(metrics.totalBytes).toBeLessThan(256);
  });

  test("expired exact sessions release calls and byte accounting", () => {
    const realNow = Date.now;
    let current = 1_000;
    Date.now = () => current;
    try {
      observeAntigravityReplay(MODEL, SESSION, [fcPart("tool", {}, SIG)]);
      current += 60 * 60 * 1_000 + 1;
      const contents = [{ role: "model", parts: [fcPart("tool", {})] }];
      applyAntigravityReplay(MODEL, SESSION, contents);
      expect((contents[0].parts[0] as { thoughtSignature?: string }).thoughtSignature).toBeUndefined();
      expect(antigravityReplayMetricsForTests())
        .toEqual({ sessions: 0, calls: 0, totalBytes: 0, largestSessionBytes: 0 });
    } finally {
      Date.now = realNow;
    }
  });
});

describe("claude-on-antigravity inline signature sanitization", () => {
  test("drops thinking blocks lacking a valid signature on model turns", () => {
    const contents = [
      { role: "model", parts: [{ thought: true, text: "no sig" }, { text: "answer" }] },
    ];
    sanitizeAntigravityClaudeSignatures(contents);
    expect(contents[0].parts).toHaveLength(1);
    expect((contents[0].parts[0] as { text?: string }).text).toBe("answer");
  });

  test("keeps thinking blocks that carry a signature", () => {
    const contents = [
      { role: "model", parts: [{ thought: true, text: "kept", thoughtSignature: SIG }] },
    ];
    sanitizeAntigravityClaudeSignatures(contents);
    expect(contents[0].parts).toHaveLength(1);
  });

  test("strips signature fields from non-model (user) parts", () => {
    const contents = [
      { role: "user", parts: [{ text: "hi", thoughtSignature: SIG, thought_signature: SIG }] },
    ];
    sanitizeAntigravityClaudeSignatures(contents);
    const part = contents[0].parts[0] as { thoughtSignature?: string; thought_signature?: string };
    expect(part.thoughtSignature).toBeUndefined();
    expect(part.thought_signature).toBeUndefined();
  });
});
