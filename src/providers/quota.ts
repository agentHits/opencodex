
import { listCodexAuthAccountsSnapshot } from "../codex/auth-api";
import { resolveEnvValue } from "../config";
import { getAccountCredential, getAccountSet, markAccountNeedsReauth } from "../oauth/store";
import { apiKeyPoolEntryId } from "./api-keys";
import { captureConfigGeneration, sweepExpiredOnWrite } from "../lib/state-store-sweeper";
import { ACCOUNT_QUOTA_TTL_MS, ACTIVE_ACCOUNT_QUOTA_TTL_MS, INACTIVE_ACCOUNT_QUOTA_TTL_MS, CACHE_TTL_MS } from "./quota-wire";
import { replaceCachedProviderQuotas } from "./quota-routing-cache";
import {
  commitKiroAccountUsageState,
  fetchKiroUsageSnapshot,
  type KiroUsageSnapshot,
  kiroUsageContextForAccount,
} from "./kiro-usage";
import { mapQuotaRoster, type ProviderApiKeyQuota } from "./quota-key-accounts";
import type { OcxConfig, OcxProviderConfig } from "../types";
import type { ProviderQuota, QuotaFailureCode } from "./quota-types";
import {
  accountReportCurrent,
  AUTHORITATIVE_EMPTY_QUOTA,
  bumpProviderQuotaInvalidationEpoch,
  cacheKeyWithAggregationState,
  getProviderQuotaReportCache,
  hasCodexPoolProvider,
  inflight,
  invalidationEpoch,
  isBuiltInChatGptForwardProvider,
  isProviderQuotaReportCurrent,
  LAST_GOOD_MAX_AGE_MS,
  providerQuotaBeforePublishForTests,
  routingEvidence,
  setProviderQuotaReportCache,
  TERMINAL_QUOTA_FAILURE,
  type CodexAuthAccountsSnapshotPromise,
  type ProviderQuotaProbeResult,
  type ProviderQuotaReport,
  type ProviderQuotaResponse,
} from "./quota/report-cache";
import {
  accountCacheKey,
  accountQuotaCache,
  accountQuotaInflight,
  explicitAccountEpoch,
  explicitAccountReader,
  explicitQuotaConfig,
  explicitQuotaDestination,
  explicitQuotaIdentity,
  getTokenForAccountQuotaProbe,
  hasPassiveAccountQuota,
  hydrateAccountQuotaCache,
  mayCommitAccountQuotaKey,
  mayCommitProviderQuotaKey,
  normalizeAnthropicQuota,
  persistAccountQuotaCache,
  supportsPerAccountQuota,
  type AccountQuotaCacheEntry,
  type ProviderAccountQuota,
} from "./quota/account-cache";
import {
  fetchAnthropicQuota,
  fetchAnthropicUsageQuota,
  fetchChatGptForwardQuota,
  fetchCursorQuota,
  fetchKiroQuota,
  fetchMuseKeyQuota,
  fetchPassiveProviderQuota,
  fetchXaiQuota,
} from "./quota/vendor-probes-oauth";
import { fetchCommandCodeQuota, fetchKimiQuota } from "./quota/vendor-probes-key";
import { antigravityQuotaDiagnosticIdentity, fetchAntigravityQuota, probeAntigravityUsageQuota } from "./quota/antigravity";
import {
  fetchExplicitAccountQuota,
  maybeFetchProviderQuota,
  providerObservationAccountKey,
} from "./quota/account-probes";

export type { ProviderQuota, ProviderQuotaCreditsUsd, ProviderQuotaWindow } from "./quota-types";
export { QUOTA_RESPONSE_MAX_BYTES } from "./quota-wire";
export {
  clearProviderQuotaCache,
  publishKeyReportForTests,
  readProviderQuotaJsonForTests,
  setProviderQuotaBeforePublishForTests,
  type ProviderQuotaReport,
  type ProviderQuotaResponse,
} from "./quota/report-cache";
export {
  clearAccountQuotaCache,
  getCachedProviderAccountQuota,
  hasPassiveAccountQuota,
  parseAnthropicRateLimitHeaders,
  providerOAuthAccountQuotaMode,
  readPassiveProviderAccountQuotas,
  recordAnthropicAccountQuotaFromHeaders,
  recordPassiveAccountQuota,
  reconcileProviderAccountQuotaRows,
  resetProviderQuotaReconcileStateForTests,
  setCachedProviderAccountQuotaForTests,
  supportsPerAccountQuota,
  sweepExpiredProviderAccountQuotaRows,
  type ProviderAccountQuota,
} from "./quota/account-cache";
export { fetchAntigravityUsageQuota, isCanonicalAntigravityQuotaUrl, setAntigravityAccountQuotaTransportForTests } from "./quota/antigravity";
export { parseOllamaCloudQuota, parseZaiQuotaLimits, providerApiKeyQuotaMode } from "./quota/vendor-probes-key";
export { parseXaiCreditsResponse } from "./quota/vendor-probes-oauth";
export {
  fetchProviderApiKeyQuotas,
  providerObservationAccountKeyForTests,
} from "./quota/account-probes";



/**
 * Hand freshly committed provider reports to the optional quota-reset observer.
 *
 * Lazy import on purpose: this module is statically reachable from
 * src/server/responses/core.ts (via oauth/anthropic-routing.ts), so a static edge would put
 * the observer and its sink registry on every install's request path.
 *
 * No previous snapshot is passed. The observer keeps its own persisted last-seen map,
 * because `previous` here is bound only when `cache.key === key` and the key digest at
 * cacheKeyWithAggregationState includes quota values and updatedAt — so it is empty exactly
 * when a reset happened.
 *
 * Account identity is resolved SYNCHRONOUSLY, before any await. Two reasons, both observed:
 * pool failover rewrites `activeAccountId` during request routing
 * (promoteAnthropicActiveAccount -> setActiveAccount), so a 429 between this commit and a
 * later async read would attribute this report to a different account and overwrite that
 * account's baseline with these numbers. fetchAnthropicQuota already captures
 * `probedAccountId` before awaiting for exactly this reason; the observer must not be
 * sloppier than the cache it observes.
 *
 * Observations are serialized through a module-level promise chain for the same reason as
 * the codex seam: Bun does not resolve concurrent import() calls in call order, and an
 * out-of-order baseline swap manufactures false resets that then burn the durable
 * idempotence key.
 */
let pendingProviderObservation: Promise<void> = Promise.resolve();


function notifyProviderQuotaSnapshot(
  reports: ReadonlyArray<ProviderQuotaReport>,
  config: OcxConfig,
): void {
  if (reports.length === 0) return;
  // Resolved here, synchronously, while the identity is still the one that produced these
  // reports.
  const observations = reports.map(report => ({
    scope: report.provider,
    accountKey: providerObservationAccountKey(report.provider, config),
    quota: report.quota,
  }));
  pendingProviderObservation = pendingProviderObservation
    .then(async () => {
      const observer = await import("../quota/reset-observer");
      if (!observer.hasQuotaResetSink()) return;
      const { providerWindowObservations } = await import("../quota/window-mapping");
      for (const observation of observations) {
        observer.observeQuotaSnapshot({
          scope: observation.scope,
          accountKey: observation.accountKey,
          windows: providerWindowObservations(observation.quota),
        });
      }
    })
    .catch(() => {
      // Detection is best-effort: a quota refresh must never fail because of it. Swallowing
      // here also keeps the chain alive — a rejected link would poison every later one.
    });
}

/** Await the observation chain. Tests only: production never needs to join it. */
export function flushProviderQuotaObservationsForTests(): Promise<void> {
  return pendingProviderObservation;
}

export async function fetchProviderQuotaReports(config: OcxConfig, forceRefresh = false): Promise<ProviderQuotaResponse> {
  // A Pool report's cache signature and provider fetch must share one account snapshot.
  // Preserve force semantics when deciding whether that snapshot refreshes upstream data.
  const prefetchedCodexSnapshot = hasCodexPoolProvider(config)
    ? listCodexAuthAccountsSnapshot(config, forceRefresh)
    : undefined;
  const keyCandidate = cacheKeyWithAggregationState(config, prefetchedCodexSnapshot);
  const key = typeof keyCandidate === "string" ? keyCandidate : await keyCandidate;
  const writerGeneration = captureConfigGeneration();
  const now = Date.now();
  // The cache fast path must not extend a preserved last-good row past its 30-minute bound:
  // a row preserved at age 29:59 plus a full 5-minute TTL would otherwise serve until ~35min.
  // An OBSERVED row is exempt: it carries the observation time, which is older than the bound
  // by construction and never becomes fresher on its own. Without the exemption a single
  // configured passive provider makes this predicate permanently false, so every dashboard
  // poll re-probes every OTHER provider upstream instead of serving the 5-minute cache.
  const currentCache = getProviderQuotaReportCache();
  const cacheFresh = currentCache && currentCache.key === key && now - currentCache.ts < CACHE_TTL_MS
    && currentCache.response.reports.every(item =>
      (item.observed === true || now - item.updatedAt < LAST_GOOD_MAX_AGE_MS)
      && isProviderQuotaReportCurrent(item));
  if (!forceRefresh && cacheFresh) return currentCache!.response;
  const joinable = inflight.get(key);
  if (!forceRefresh && joinable && joinable.epoch === invalidationEpoch) return joinable.promise;
  // A forced probe takes commit authority: older in-flight probes must not overwrite its result.
  if (forceRefresh) bumpProviderQuotaInvalidationEpoch();
  const epoch = invalidationEpoch;

  const promise = (async (): Promise<ProviderQuotaResponse> => {
    const previousCache = getProviderQuotaReportCache();
    const previous = previousCache && previousCache.key === key ? previousCache.response.reports : [];
    const probeResults = await Promise.all(
      Object.entries(config.providers).map(([name, provider]) => (
        maybeFetchProviderQuota(name, provider, config, forceRefresh, prefetchedCodexSnapshot)
      )),
    );
    const fresh = probeResults.filter((item): item is ProviderQuotaReport => (
      item !== null && item !== TERMINAL_QUOTA_FAILURE && item !== AUTHORITATIVE_EMPTY_QUOTA
    ));
    // Both sentinels suppress the previous row. A terminal failure means the response was
    // invalid; an authoritative empty means the response was valid and said there are no
    // model windows. Either way the old row is no longer true, which is what separates them
    // from `null` (told us nothing — keep the last-good row).
    const terminalFailures = new Set(
      Object.keys(config.providers).filter((_, index) => (
        probeResults[index] === TERMINAL_QUOTA_FAILURE
        || probeResults[index] === AUTHORITATIVE_EMPTY_QUOTA
      )),
    );
    await providerQuotaBeforePublishForTests?.();
    let commitKey: string | null = null;
    if (epoch === invalidationEpoch) {
      const commitKeyCandidate = cacheKeyWithAggregationState(config);
      commitKey = typeof commitKeyCandidate === "string" ? commitKeyCandidate : await commitKeyCandidate;
    }

    // Keep bounded last-good rows when a probe fails transiently; terminal-invalid provider
    // responses explicitly suppress their old row. Never re-stamp preserved timestamps.
    // Note: the cache key encodes the provider set (name/adapter/authMode/disabled/baseUrl),
    // so previous rows always correspond to currently configured, enabled providers — a
    // disabled or removed provider changes the key and starts from an empty previous set.
    const cutoff = Date.now() - LAST_GOOD_MAX_AGE_MS;
    const byProvider = new Map<string, ProviderQuotaReport>();
    const generationMismatchedProviders = new Set<string>();
    for (const item of previous) {
      // Same exemption as the fast path. A passive row reaching `previous` is not a probe
      // that went quiet — there is no probe — so age cannot condemn it.
      if (item.observed !== true && item.updatedAt < cutoff) continue;
      if (isProviderQuotaReportCurrent(item)) byProvider.set(item.provider, item);
      else generationMismatchedProviders.add(item.provider);
    }
    for (const item of fresh) {
      if (isProviderQuotaReportCurrent(item)) {
        byProvider.set(item.provider, item);
        generationMismatchedProviders.delete(item.provider);
      } else {
        byProvider.delete(item.provider);
        generationMismatchedProviders.add(item.provider);
      }
    }
    // Terminal-invalid probes suppress their previous row (transient failures keep it).
    for (const provider of terminalFailures) {
      byProvider.delete(provider);
      generationMismatchedProviders.delete(provider);
    }

    const response = { generatedAt: Date.now(), reports: [...byProvider.values()] };
    // Commit only when this probe still holds authority (no clear/force superseded it).
    if (
      epoch === invalidationEpoch
      && commitKey === key
      && generationMismatchedProviders.size === 0
    ) {
      const reports = response.reports.filter(item => mayCommitProviderQuotaKey(item.provider, writerGeneration));
      setProviderQuotaReportCache({ key, ts: Date.now(), response: { ...response, reports } });
      replaceCachedProviderQuotas(reports, routingEvidence);
      notifyProviderQuotaSnapshot(reports, config);
    }
    return response;
  })();

  const entry = { epoch, promise };
  inflight.set(key, entry);
  try {
    return await promise;
  } finally {
    if (inflight.get(key) === entry) inflight.delete(key);
  }
}





async function fetchAccountQuota(
  provider: string,
  accountId: string,
  forceRefresh: boolean,
  providerConfig?: OcxProviderConfig,
): Promise<AccountQuotaCacheEntry> {
  if (!supportsPerAccountQuota(provider)) return { ts: Date.now(), quota: null, unavailable: true };
  if (explicitAccountReader(provider)) return fetchExplicitAccountQuota(provider, accountId, forceRefresh, providerConfig);
  hydrateAccountQuotaCache();
  const key = accountCacheKey(provider, accountId);
  const writerGeneration = captureConfigGeneration();
  const cached = accountQuotaCache.get(key);
  const set = getAccountSet(provider);
  const isActive = set?.activeAccountId === accountId;
  const ttl = isActive ? ACTIVE_ACCOUNT_QUOTA_TTL_MS : INACTIVE_ACCOUNT_QUOTA_TTL_MS;
  const resetPassed = !isActive && cached?.quota?.customWindows?.some(w => {
    return typeof w.resetAt === "number" && w.resetAt <= Date.now() && w.percent > 0;
  });

  if (!forceRefresh && cached && (Date.now() - cached.ts < ttl) && !resetPassed) {
    if (provider === "google-antigravity" && cached.quotaFailure && cached.quotaFailureIsCurrent?.() !== true) return { ...cached, quotaFailure: undefined };
    return provider === "anthropic" ? { ...cached, quota: normalizeAnthropicQuota(cached.quota, Date.now()) } : cached;
  }
  const joinable = accountQuotaInflight.get(key);
  if (joinable) return joinable;

  const epoch = explicitAccountEpoch;
  const probe = (async (): Promise<AccountQuotaCacheEntry> => {
    let diagnosticIdentity: string | undefined;
    let quotaFailure: QuotaFailureCode | undefined;
    const quotaFailureIsCurrent = () => {
      try { return epoch === explicitAccountEpoch && diagnosticIdentity !== undefined && diagnosticIdentity === antigravityQuotaDiagnosticIdentity(accountId); }
      catch { return false; }
    };
    const diagnosticFields = () => quotaFailure && quotaFailureIsCurrent() ? { quotaFailure, quotaFailureIsCurrent } : {};
    try {
      if (provider === "google-antigravity") diagnosticIdentity = antigravityQuotaDiagnosticIdentity(accountId);
      let quota: ProviderQuota | null;
      let kiroSnapshot: KiroUsageSnapshot | null = null;
      if (provider === "kiro") {
        // Kiro resolves the bearer and its routing metadata from ONE account-scoped
        // snapshot. It deliberately does not use getTokenForAccountQuotaProbe: that
        // helper refuses to refresh a background `local-cli` slot because Anthropic's
        // lock can adopt a mismatched Claude CLI identity, but Kiro marks every
        // CLI-imported credential `local-cli`, so the same rule would blank the quota of
        // every inactive pool account the moment its token expired.
        kiroSnapshot = await fetchKiroUsageSnapshot(await kiroUsageContextForAccount(accountId));
        quota = kiroSnapshot?.quota ?? null;
      } else {
        const token = await getTokenForAccountQuotaProbe(provider, accountId);
        if (provider === "google-antigravity") {
          // Per-account Gem/Cla windows (#1082). The project id is part of the stored
          // credential; without it the probe cannot be made, and that is "unavailable",
          // never 0%.
          const credential = getAccountCredential(provider, accountId);
          diagnosticIdentity = credential?.access === token ? antigravityQuotaDiagnosticIdentity(accountId, credential) : undefined;
          if (!diagnosticIdentity || !credential?.projectId) throw new Error("antigravity account unavailable");
          const result = await probeAntigravityUsageQuota(token, credential.projectId);
          if (result.kind === "available") {
            quota = result.quota;
            if (result.source === "google-antigravity:fetchAvailableModels" && cached?.quota?.customWindows) {
              const existingWeekly = cached.quota.customWindows.filter(w => /week/i.test(w.label));
              if (existingWeekly.length > 0) {
                const merged = [...(quota.customWindows ?? [])];
                for (const w of existingWeekly) {
                  if (!merged.some(m => m.label === w.label)) {
                    merged.push(w);
                  }
                }
                quota = { ...quota, customWindows: merged };
              }
            }
          } else {
            quota = null;
          }
          if (result.kind === "unavailable") quotaFailure = result.failure;
        } else if (provider === "anthropic") {
          quota = await fetchAnthropicUsageQuota(token);
        } else {
          return { ts: Date.now(), quota: null, unavailable: true };
        }
      }
      if (!quota) {
        // Preserve last-good bars and mark unavailable; advance TTL so failures
        // negative-cache instead of re-probing on every GUI poll.
        const entry: AccountQuotaCacheEntry = {
          ts: Date.now(),
          // Settle once for all joiners against observations committed during the probe.
          quota: provider === "anthropic"
            ? normalizeAnthropicQuota(accountQuotaCache.get(key)?.quota, Date.now()) : cached?.quota ?? null,
          unavailable: true,
          ...diagnosticFields(),
        };
        if (mayCommitAccountQuotaKey(key, writerGeneration)) {
          accountQuotaCache.set(key, entry);
          if (provider === "kiro") commitKiroAccountUsageState(key, null);
          sweepExpiredOnWrite(entry.ts);
        }
        return entry;
      }
      const entry: AccountQuotaCacheEntry = {
        ts: Date.now(), quota: provider === "anthropic" ? normalizeAnthropicQuota(quota, Date.now()) : quota,
      };
      if (mayCommitAccountQuotaKey(key, writerGeneration)) {
        accountQuotaCache.set(key, entry);
        persistAccountQuotaCache();
        // Exhaustion state rides the SAME commit guard as the quota row: a probe from a
        // superseded config generation must not publish either half.
        if (provider === "kiro") commitKiroAccountUsageState(key, kiroSnapshot);
        sweepExpiredOnWrite(entry.ts);
      }
      return entry;
    } catch (err) {
      if (provider === "google-antigravity") {
        quotaFailure = "account_unavailable";
        if (err instanceof Error && (err.message.includes("400") || err.message.includes("invalid_grant"))) {
          void markAccountNeedsReauth(provider, accountId, true).catch(() => {});
        }
      }
      const entry: AccountQuotaCacheEntry = {
        ts: Date.now(),
        quota: provider === "anthropic"
          ? normalizeAnthropicQuota(accountQuotaCache.get(key)?.quota, Date.now()) : cached?.quota ?? null,
        unavailable: true,
        ...diagnosticFields(),
      };
      if (mayCommitAccountQuotaKey(key, writerGeneration)) {
        accountQuotaCache.set(key, entry);
        sweepExpiredOnWrite(entry.ts);
      }
      return entry;
    }
  })().finally(() => {
    if (accountQuotaInflight.get(key) === probe) accountQuotaInflight.delete(key);
  });
  accountQuotaInflight.set(key, probe);
  return probe;
}

/**
 * Non-blocking priority background probe for the active account after serving a turn.
 * Debounced at 30s so high-frequency prompt turns do not hammer the quota API.
 */
export function backgroundRefreshActiveAccountQuota(provider: string, accountId: string): void {
  if (!supportsPerAccountQuota(provider)) return;
  const key = accountCacheKey(provider, accountId);
  const cached = accountQuotaCache.get(key);
  if (cached && Date.now() - cached.ts < 30_000) return;
  if (accountQuotaInflight.has(key)) return;
  void fetchAccountQuota(provider, accountId, true).catch(() => {});
}

/**
 * Per-account quota rows for a provider's logged-in accounts. Probes run in parallel; a
 * single failing account never blocks the others.
 */
export async function fetchProviderAccountQuotas(
  provider: string,
  forceRefresh = false,
  providerConfig?: OcxProviderConfig,
  targetAccountId?: string | null,
): Promise<ProviderAccountQuota[]> {
  if (!supportsPerAccountQuota(provider)) return [];
  const set = getAccountSet(provider);
  if (!set) return [];
  const activeId = set.activeAccountId;
  const orderedAccounts = [...set.accounts].sort((a, b) => {
    if (a.id === activeId) return -1;
    if (b.id === activeId) return 1;
    return 0;
  });
  return mapQuotaRoster(orderedAccounts, async account => {
    const shouldForce = forceRefresh && (!targetAccountId || account.id === targetAccountId);
    const entry = await fetchAccountQuota(provider, account.id, shouldForce, providerConfig);
    const result: ProviderAccountQuota = {
      accountId: account.id,
      quota: provider === "anthropic" ? normalizeAnthropicQuota(entry.quota, Date.now()) : entry.quota,
      ...(entry.unavailable ? { unavailable: true as const } : {}),
      ...(entry.unavailable && entry.quotaFailure && entry.quotaFailureIsCurrent?.() === true ? { quotaFailure: entry.quotaFailure } : {}),
    };
    if (entry.quotaFailureIsCurrent) Object.defineProperty(result, "quotaFailureIsCurrent", { value: entry.quotaFailureIsCurrent });
    if (!explicitAccountReader(provider)) return result;
    const identity = entry.identity;
    Object.defineProperty(result, "isCurrent", { value: () => {
      if (entry.isCurrent) return entry.isCurrent();
      const credential = getAccountCredential(provider, account.id);
      return !!credential && (!identity || explicitQuotaIdentity(provider, account.id, providerConfig) === identity);
    } });
    return result;
  });
}
