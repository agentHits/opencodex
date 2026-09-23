import { resolveEnvValue } from "../../config";
import { getAccountCredential, getAccountSet } from "../../oauth/store";
import type { OcxConfig, OcxProviderConfig } from "../../types";
import { apiKeyPoolEntryId } from "../api-keys";
import {
  AUTHORITATIVE_EMPTY_QUOTA,
  TERMINAL_QUOTA_FAILURE,
  accountReportCurrent,
  isBuiltInChatGptForwardProvider,
  LAST_GOOD_MAX_AGE_MS,
  type CodexAuthAccountsSnapshotPromise,
  type ProviderQuotaProbeResult,
} from "./report-cache";
import { ACCOUNT_QUOTA_TTL_MS } from "../quota-wire";
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
  type AccountQuotaCacheEntry,
} from "./account-cache";
import { fetchCommandCodeQuota, fetchKimiQuota, keyQuotaReaderForProvider } from "./vendor-probes-key";
import {
  fetchAnthropicQuota,
  fetchChatGptForwardQuota,
  fetchCursorQuota,
  fetchKiroQuota,
  fetchMuseKeyQuota,
  fetchPassiveProviderQuota,
  fetchXaiQuota,
} from "./vendor-probes-oauth";
import { fetchAntigravityQuota } from "./antigravity";
import { readProviderApiKeyQuotas, type ProviderApiKeyQuota } from "../quota-key-accounts";

export async function fetchProviderApiKeyQuotas(config: OcxConfig, name: string, forceRefresh = false): Promise<ProviderApiKeyQuota[]> {
  const provider = config.providers[name];
  if (!provider || !keyQuotaReaderForProvider(name, provider)) return [];
  return readProviderApiKeyQuotas(config, name, forceRefresh, async (isolatedProvider, isolatedConfig) => {
    const result = await maybeFetchProviderQuota(name, isolatedProvider, isolatedConfig, false);
    if (result === TERMINAL_QUOTA_FAILURE) return { kind: "terminal" };
    if (result === AUTHORITATIVE_EMPTY_QUOTA) return { kind: "empty" };
    return result ? { kind: "quota", quota: result.quota } : { kind: "unavailable" };
  });
}
export async function maybeFetchProviderQuota(
  name: string,
  provider: OcxProviderConfig,
  config: OcxConfig,
  forceRefresh: boolean,
  prefetchedCodexSnapshot?: CodexAuthAccountsSnapshotPromise,
): Promise<ProviderQuotaProbeResult> {
  if (provider.disabled === true) return null;
  try {
    if (isBuiltInChatGptForwardProvider(name, provider)) {
      return fetchChatGptForwardQuota(config, name, provider, forceRefresh, prefetchedCodexSnapshot);
    }
    if (provider.authMode === "oauth" && explicitAccountReader(name)) return await fetchExplicitCurrentQuota(name, provider, config);
    if (provider.authMode === "oauth" && name === "anthropic") return fetchAnthropicQuota(name);
    if (provider.authMode === "oauth" && name === "google-antigravity") return await fetchAntigravityQuota(name);
    if (provider.authMode === "oauth" && name === "kiro") return fetchKiroQuota(name);
    // meta-muse: a device-logged-in account can be probed at the key endpoint; an
    // imported or pasted one cannot, and falls back to its last in-band observation.
    // The probe is tried first and its failure is never fatal to the row.
    if (provider.authMode === "oauth" && hasPassiveAccountQuota(name)) {
      return (await fetchMuseKeyQuota(name)) ?? await fetchPassiveProviderQuota(name);
    }
    const reader = keyQuotaReaderForProvider(name, provider);
    // Keep destination/auth fields bound to the same request as the reader's captured
    // bearer, even if the live provider object changes while the quota probe awaits.
    return reader ? reader(name, { ...provider }) : null;
  } catch {
    return null;
  }
}
/**
 * Stable per-account observation key for one provider report.
 *
 * OAuth providers key by active account id. Key-auth providers have NO account set, so
 * every key in `apiKeyPool` would collapse onto "default" and rotating from a spent key to
 * a fresh one would read as a reset (measured: 97% -> 12% fired a false surprise). The
 * cache key already discriminates these at cacheKey() via apiKeyPoolEntryId, so this
 * mirrors that discriminator instead of inventing a second notion of identity.
 */
export function providerObservationAccountKey(provider: string, config: OcxConfig): string {
  const oauthAccountId = getAccountSet(provider)?.activeAccountId;
  if (oauthAccountId !== undefined) return `${provider}\u0000${oauthAccountId}`;
  const providerConfig = config.providers[provider];
  const resolvedKey = typeof providerConfig?.apiKey === "string"
    ? resolveEnvValue(providerConfig.apiKey)?.trim()
    : undefined;
  const keyId = resolvedKey ? apiKeyPoolEntryId(resolvedKey) : "default";
  return `${provider}\u0000key:${keyId}`;
}

/** Test-only view of the observation account key. */
export function providerObservationAccountKeyForTests(provider: string, config: OcxConfig): string {
  return providerObservationAccountKey(provider, config);
}
async function readExplicitAccountQuota(provider: string, accountId: string, configured?: OcxProviderConfig): Promise<{
  result: ProviderQuotaProbeResult;
  identity: string | undefined;
  isCurrent: () => boolean;
} | null> {
  const target = explicitQuotaConfig(provider, configured);
  if (!target || !explicitQuotaDestination(provider, target)) return null;
  const config = { ...target };
  const epoch = explicitAccountEpoch;
  const accessToken = await getTokenForAccountQuotaProbe(provider, accountId);
  const credential = getAccountCredential(provider, accountId);
  if (!credential || credential.access !== accessToken) return null;
  // Pair the post-renewal credential with the destination captured before renewal.
  const identity = explicitQuotaIdentity(provider, accountId, config);
  const isCurrent = () => epoch === explicitAccountEpoch
    && identity === explicitQuotaIdentity(provider, accountId, configured);
  if (!isCurrent()) return null;
  let result: ProviderQuotaProbeResult;
  switch (provider) {
    case "xai": result = await fetchXaiQuota(provider, { accessToken, upstreamAccountId: credential.accountId }); break;
    case "cursor": result = await fetchCursorQuota(provider, accessToken); break;
    case "kimi": result = await fetchKimiQuota(provider, config, accessToken); break;
    case "command-code": result = await fetchCommandCodeQuota(provider, config, accessToken); break;
    default: return null;
  }
  return { result, identity, isCurrent };
}
export async function fetchExplicitAccountQuota(provider: string, accountId: string, force: boolean, configured?: OcxProviderConfig): Promise<AccountQuotaCacheEntry> {
  const key = accountCacheKey(provider, accountId);
  const identity = explicitQuotaIdentity(provider, accountId, configured);
  const previous = accountQuotaCache.get(key);
  const cached = identity && previous?.identity === identity && previous.isCurrent?.() ? previous : undefined;
  if (!force && cached && Date.now() - cached.ts < ACCOUNT_QUOTA_TTL_MS
    && (!cached.quota || Date.now() - cached.quota.updatedAt < LAST_GOOD_MAX_AGE_MS)) return cached;
  const flightKey = `${key}\u0000${identity ?? "missing"}`;
  const running = accountQuotaInflight.get(flightKey);
  if (running) return running;
  const epoch = explicitAccountEpoch;
  const lastGood = cached?.quota && Date.now() - cached.quota.updatedAt < LAST_GOOD_MAX_AGE_MS ? cached.quota : null;
  const flight = (async (): Promise<AccountQuotaCacheEntry> => {
    let read: Awaited<ReturnType<typeof readExplicitAccountQuota>> = null;
    try { read = await readExplicitAccountQuota(provider, accountId, configured); } catch { /* unavailable */ }
    const isCurrent = read?.isCurrent ?? (() => epoch === explicitAccountEpoch && !!identity
      && identity === explicitQuotaIdentity(provider, accountId, configured));
    const result = read?.result;
    const current = epoch === explicitAccountEpoch && isCurrent();
    const quota = current && result && typeof result !== "symbol" ? result.quota : null;
    const empty = result === AUTHORITATIVE_EMPTY_QUOTA;
    const entry: AccountQuotaCacheEntry = {
      ts: Date.now(),
      quota: quota ?? (current && result !== TERMINAL_QUOTA_FAILURE && !empty
        && lastGood && Date.now() - lastGood.updatedAt < LAST_GOOD_MAX_AGE_MS ? lastGood : null),
      ...(!current || (!quota && !empty) ? { unavailable: true as const } : {}),
      identity: read?.identity ?? identity,
      isCurrent: () => epoch === explicitAccountEpoch && isCurrent(),
    };
    if (entry.isCurrent?.()) accountQuotaCache.set(key, entry);
    return entry;
  })().finally(() => { if (accountQuotaInflight.get(flightKey) === flight) accountQuotaInflight.delete(flightKey); });
  accountQuotaInflight.set(flightKey, flight);
  return flight;
}
async function fetchExplicitCurrentQuota(provider: string, config: OcxProviderConfig, liveConfig: OcxConfig): Promise<ProviderQuotaProbeResult> {
  const id = getAccountSet(provider)?.activeAccountId;
  if (!id) return null;
  const read = await readExplicitAccountQuota(provider, id, config);
  if (!read) return null;
  const isCurrent = () => liveConfig.providers[provider] === config
    && read.isCurrent() && getAccountSet(provider)?.activeAccountId === id;
  if (!isCurrent()) return TERMINAL_QUOTA_FAILURE;
  if (read.result && typeof read.result !== "symbol") accountReportCurrent.set(read.result, isCurrent);
  return read.result;
}
