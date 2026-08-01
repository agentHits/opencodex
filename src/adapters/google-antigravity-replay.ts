import { createHash } from "node:crypto";

/**
 * Antigravity (Cloud Code Assist) thoughtSignature reasoning-replay cache.
 *
 * Gemini-3 interleaved thinking is stateless upstream: each model content part carries a
 * `thoughtSignature` that MUST be echoed back on the matching part in the next request, or the
 * upstream rejects the turn (HTTP 400). We observe signatures on the response stream, cache them
 * per `model + session`, and re-inject them into the outgoing `request.contents` on the next turn.
 *
 * Mirrors CLIProxyAPI `internal/runtime/executor/antigravity_reasoning_replay.go`. Gemini-only;
 * Claude-on-Antigravity uses inline signature sanitization instead (see google-antigravity-wire).
 */

interface ReplayCall {
  signature: string;
  sizeBytes: number;
}

interface ReplayEntry {
  /** thoughtSignature keyed by a fixed-size digest of functionCall identity. */
  byCall: Map<string, ReplayCall>;
  sizeBytes: number;
  expiresAtMs: number;
}

const MIN_SIGNATURE_LEN = 16;
const REPLAY_TTL_MS = 60 * 60 * 1000; // 1h
const REPLAY_MAX_ENTRIES = 10_240;
const REPLAY_MAX_CALLS_PER_SESSION = 256;
const REPLAY_MAX_BYTES_PER_SESSION = 2 * 1024 * 1024;
const REPLAY_MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const REPLAY_MAX_SIGNATURE_BYTES = 64 * 1024;
const REPLAY_SWEEP_INTERVAL_MS = 60 * 1000;

interface ReplayLimits {
  maxEntries: number;
  maxCallsPerSession: number;
  maxBytesPerSession: number;
  maxTotalBytes: number;
  maxSignatureBytes: number;
}

const DEFAULT_LIMITS: ReplayLimits = {
  maxEntries: REPLAY_MAX_ENTRIES,
  maxCallsPerSession: REPLAY_MAX_CALLS_PER_SESSION,
  maxBytesPerSession: REPLAY_MAX_BYTES_PER_SESSION,
  maxTotalBytes: REPLAY_MAX_TOTAL_BYTES,
  maxSignatureBytes: REPLAY_MAX_SIGNATURE_BYTES,
};

const replayCache = new Map<string, ReplayEntry>();
let replayBytes = 0;
let lastSweepAtMs = 0;
let limits = { ...DEFAULT_LIMITS };

function replayKey(model: string, sessionId: string): string {
  return createHash("sha256").update(model).update("\0").update(sessionId).digest("hex");
}

/** Recursively canonicalize a JSON value: object keys sorted, arrays preserved. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.keys(value as Record<string, unknown>).sort()
    .map(k => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(",")}}`;
}

/** Stable fixed-size identity for a functionCall part: name + recursively canonicalized args. */
function functionCallKey(name: unknown, args: unknown): string | undefined {
  if (typeof name !== "string" || name.length === 0) return undefined;
  let argsKey = "";
  try {
    argsKey = canonicalJson(args ?? {});
  } catch {
    argsKey = "";
  }
  return createHash("sha256").update(name).update("\0").update(argsKey).digest("hex");
}

function extractSignature(part: Record<string, unknown>): string | undefined {
  const direct = part.thoughtSignature ?? part.thought_signature;
  if (typeof direct === "string" && direct.length >= MIN_SIGNATURE_LEN) return direct;
  const extra = part.extra_content as { google?: { thought_signature?: unknown } } | undefined;
  const nested = extra?.google?.thought_signature;
  if (typeof nested === "string" && nested.length >= MIN_SIGNATURE_LEN) return nested;
  return undefined;
}

function deleteSession(key: string): void {
  const entry = replayCache.get(key);
  if (!entry) return;
  replayBytes -= entry.sizeBytes;
  if (replayBytes < 0) replayBytes = 0;
  replayCache.delete(key);
}

function deleteCall(entry: ReplayEntry, key: string): void {
  const call = entry.byCall.get(key);
  if (!call) return;
  entry.byCall.delete(key);
  entry.sizeBytes -= call.sizeBytes;
  replayBytes -= call.sizeBytes;
  if (entry.sizeBytes < 0) entry.sizeBytes = 0;
  if (replayBytes < 0) replayBytes = 0;
}

function sweepExpired(now: number, force = false): void {
  if (!force && now - lastSweepAtMs < REPLAY_SWEEP_INTERVAL_MS) return;
  lastSweepAtMs = now;
  for (const [key, entry] of replayCache) {
    if (entry.expiresAtMs <= now) deleteSession(key);
  }
}

function enforceLimits(now: number): void {
  const underPressure = replayCache.size > limits.maxEntries || replayBytes > limits.maxTotalBytes;
  sweepExpired(now, underPressure);
  while (replayCache.size > limits.maxEntries || replayBytes > limits.maxTotalBytes) {
    const oldest = replayCache.keys().next().value;
    if (oldest === undefined) break;
    deleteSession(oldest);
  }
}

/** Gemini/Flash/Agent use the replay cache; Claude does not (inline sanitization instead). */
export function antigravityUsesReplayCache(model: string): boolean {
  return !/claude/i.test(model);
}

/**
 * Observe a parsed CCA chunk's `candidates[0].content.parts` and record thought signatures keyed by
 * the functionCall identity (name + args). Accumulates across the whole session so a sequential
 * multi-step tool loop keeps EVERY prior call's signature, not just the latest part-index slot.
 * `parts` is the already-unwrapped `response.candidates[0].content.parts`.
 */
export function observeAntigravityReplay(model: string, sessionId: string, parts: unknown[]): void {
  if (!antigravityUsesReplayCache(model) || !Array.isArray(parts) || parts.length === 0) return;
  const now = Date.now();
  const key = replayKey(model, sessionId);
  let entry = replayCache.get(key);
  if (entry?.expiresAtMs !== undefined && entry.expiresAtMs <= now) {
    deleteSession(key);
    entry = undefined;
  }
  sweepExpired(now);
  entry ??= { byCall: new Map<string, ReplayCall>(), sizeBytes: 0, expiresAtMs: 0 };
  let changed = false;
  for (const raw of parts) {
    if (!raw || typeof raw !== "object") continue;
    const part = raw as Record<string, unknown>;
    const sig = extractSignature(part);
    if (!sig) continue;
    const fc = part.functionCall as { name?: unknown; args?: unknown } | undefined;
    const ck = fc ? functionCallKey(fc.name, fc.args) : undefined;
    if (!ck) continue; // only function-call signatures are replayable by identity
    const signatureBytes = Buffer.byteLength(sig, "utf8");
    const sizeBytes = Buffer.byteLength(ck, "utf8") + signatureBytes;
    if (signatureBytes > limits.maxSignatureBytes || sizeBytes > limits.maxBytesPerSession) continue;
    const existing = entry.byCall.get(ck);
    if (existing?.signature === sig) continue;
    if (existing) deleteCall(entry, ck);
    entry.byCall.set(ck, { signature: sig, sizeBytes });
    entry.sizeBytes += sizeBytes;
    replayBytes += sizeBytes;
    changed = true;
  }
  if (!changed && replayCache.has(key)) return;
  if (!changed) return;
  while (
    entry.byCall.size > limits.maxCallsPerSession
    || entry.sizeBytes > limits.maxBytesPerSession
  ) {
    const oldest = entry.byCall.keys().next().value;
    if (oldest === undefined) break;
    deleteCall(entry, oldest);
  }
  if (entry.byCall.size === 0) {
    deleteSession(key);
    return;
  }
  entry.expiresAtMs = now + REPLAY_TTL_MS;
  replayCache.delete(key);
  replayCache.set(key, entry);
  enforceLimits(now);
}

/**
 * Re-inject cached thought signatures into the outgoing `request.contents`, matched by functionCall
 * identity across ALL model turns (not just the last one). Only fills a functionCall part that
 * lacks a real signature. Returns the same array reference (mutated in place).
 */
export function applyAntigravityReplay(model: string, sessionId: string, contents: unknown[]): unknown[] {
  if (!antigravityUsesReplayCache(model) || !Array.isArray(contents)) return contents;
  const now = Date.now();
  const key = replayKey(model, sessionId);
  const entry = replayCache.get(key);
  if (!entry || entry.expiresAtMs <= now) {
    if (entry) deleteSession(key);
    return contents;
  }
  let touched = false;
  for (const c of contents as { role?: string; parts?: unknown[] }[]) {
    if (!c || typeof c !== "object" || c.role !== "model" || !Array.isArray(c.parts)) continue;
    for (const raw of c.parts) {
      if (!raw || typeof raw !== "object") continue;
      const part = raw as Record<string, unknown>;
      const fc = part.functionCall as { name?: unknown; args?: unknown } | undefined;
      if (!fc) continue;
      if (part.thoughtSignature !== undefined || part.thought_signature !== undefined) continue;
      const ck = functionCallKey(fc.name, fc.args);
      const call = ck ? entry.byCall.get(ck) : undefined;
      if (call && ck) {
        part.thoughtSignature = call.signature;
        entry.byCall.delete(ck);
        entry.byCall.set(ck, call);
        touched = true;
      }
    }
  }
  if (touched) {
    replayCache.delete(key);
    replayCache.set(key, entry);
  }
  return contents;
}

/** Drop the cache entry when upstream rejects a signature (clear-on-invalid). */
export function clearAntigravityReplay(model: string, sessionId: string): void {
  deleteSession(replayKey(model, sessionId));
}

/** Test-only observability for count/byte-bound regressions. */
export function antigravityReplayMetricsForTests(): {
  sessions: number;
  calls: number;
  totalBytes: number;
  largestSessionBytes: number;
} {
  let calls = 0;
  let largestSessionBytes = 0;
  for (const entry of replayCache.values()) {
    calls += entry.byCall.size;
    largestSessionBytes = Math.max(largestSessionBytes, entry.sizeBytes);
  }
  return { sessions: replayCache.size, calls, totalBytes: replayBytes, largestSessionBytes };
}

/** Test seam: lower limits without allocating production-sized fixtures. */
export function setAntigravityReplayLimitsForTests(overrides: Partial<ReplayLimits> | null): void {
  __resetAntigravityReplayCache();
  limits = overrides ? { ...DEFAULT_LIMITS, ...overrides } : { ...DEFAULT_LIMITS };
}

/** Test seam. */
export function __resetAntigravityReplayCache(): void {
  replayCache.clear();
  replayBytes = 0;
  lastSweepAtMs = 0;
}
