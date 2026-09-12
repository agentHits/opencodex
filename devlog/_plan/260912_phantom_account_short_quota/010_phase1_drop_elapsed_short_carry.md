# Phase 1 — drop elapsed account-level short carry

## IN

- `src/codex/quota.ts`: carry paths in `mergeAccountQuota` (credits-only +
  no-incoming-short else branch) and the parallel copy in `updateAccountQuota`.
- `tests/codex-integration/codex-quota-parser-parity.test.ts`: regression rows
  next to the #4122 Spark attribution block.
- this unit's plan/closeout docs.

## OUT

- GUI row construction (`QuotaBars`, `normalizeQuotaForPlan`).
- Changing `getAccountQuota` to strip elapsed shorts at read time (would hide
  the reset instant from five-hour auto-refresh).
- Changing WHAM `parseUsageQuota` Spark-primary attribution.
- Hydrate/persist rewrite of already-elapsed tuples except insofar as the next
  merge persist writes the cleaned snapshot.

## Diff (quota.ts)

Add helpers beside `snapshotHasShort`:

```ts
const RESET_AT_SECONDS_MAX = 10_000_000_000; // same split as isTerminalShortWindow

function shortResetHasElapsed(resetAt: number | undefined, now: number): boolean {
  if (typeof resetAt !== "number" || !Number.isFinite(resetAt) || resetAt <= 0) return false;
  const resetAtMs = resetAt < RESET_AT_SECONDS_MAX ? resetAt * 1000 : resetAt;
  return resetAtMs <= now;
}

function assignCarriedShort(next, existing, now): void {
  if (!existing || shortResetHasElapsed(existing.shortResetAt, now)) return;
  // copy shortPercent/shortObservedAt/shortResetAt/shortWindowSeconds when present
}
```

Replace the four unconditional `existing.short*` assignments in the
`creditsOnly` branch and the `else` (no incoming short) branch with
`assignCarriedShort(next, existing, updatedAt)`.

Tighten `preserveKnownShort` so an elapsed existing short is not treated as
known policy evidence:

```ts
const preserveKnownShort = policyEvidence
  && quota.shortPercent === undefined
  && finitePercent(existing?.shortPercent)
  && !shortResetHasElapsed(existing?.shortResetAt, updatedAt);
```

In `updateAccountQuota`, skip copying short* when
`shortResetHasElapsed(existing.shortResetAt, quota.updatedAt)`.

Do **not** drop an incoming snapshot that itself contains short*. Auto-refresh
and routing tests seed elapsed `shortResetAt` as a stored fact.

## Tests (parser-parity)

1. Seed elapsed short + weekly; apply Spark-model 5h headers from the existing
   `SPARK_HEADERS` fixture → short* absent, weekly 21, Spark customWindows
   present. (This is the live Pro failure: #4122 write path plus leftover carry.)
2. Seed elapsed short; apply a Pro WHAM parse (weekly primary 604800s + Spark
   additional_rate_limits) → short* absent, weekly and Spark customWindows kept.
   This is the live refresh path for the affected account.
3. Seed elapsed short; apply weekly-only headers (10080 minutes) → short* absent,
   weekly updated.
4. Seed live short (`shortResetAt = nowSec + 3600`); apply weekly-only headers →
   short* retained, weekly updated.
5. Seed elapsed short; `setAccountQuotaFromParsed({ shortPercent, shortResetAt })`
   as an explicit incoming short → tuple remains (incoming-has-short path).
6. Seed elapsed short; credits-only `setAccountQuotaFromParsed({ resetCredits })`
   → short* absent, weekly and credits kept.

Red before the patch: (1) and (2) fail because the else branch recopies
`shortPercent: 4`. Green after: those rows pass; (3) and (4) keep current
carry/store behavior.

## Accept

- c1: live cache + `quota.ts` file:line + alternatives in `000_plan.md`.
- c2: diff + the four rows above (red-green by construction; local suite NOT RUN).
- c3/c4: PR + merge evidence in closeout.
