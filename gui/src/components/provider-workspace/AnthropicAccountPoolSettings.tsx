/**
 * OAuth account-pool controls for Anthropic and generic providers.
 *
 * Anthropic keeps quotaWindow and its experimental warning. Generic OAuth
 * providers (including Google Antigravity) share the same /api/pool/settings
 * contract without quotaWindow: the toggle is proactive pre-dispatch selection,
 * while 429 rotation stays presence-driven.
 * Opt-in Anthropic OAuth account pool controls (#294).
 * Experimental. The conditions it is meant for are static helper text next to the toggle,
 * with the selection details behind a disclosure: the notice describes how to use the pool,
 * so it is not announced as a live alert. Load and save failures keep their own messages.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT } from "../../i18n/shared";
import { getPoolSettings, putPoolSettings, PoolSettingsSaveStateUnknownError } from "../../pool-settings";
import "../../styles/anthropic-native-messages.css";
import {
  ACCOUNT_POOL_QUOTA_WINDOWS,
  DEFAULT_ACCOUNT_POOL_QUOTA_WINDOW,
  DEFAULT_ACCOUNT_POOL_STICKY_LIMIT,
  DEFAULT_ACCOUNT_POOL_STRATEGY,
  normalizeAccountPoolQuotaWindow,
  normalizeAccountPoolStickyLimit,
  normalizeAccountPoolStrategy,
  parseAccountPoolStickyLimitDraft,
  type AccountPoolQuotaWindow,
  type AccountPoolStrategy,
} from "../../account-pool-strategy";
import AccountPoolStrategyControls from "../AccountPoolStrategyControls";
import AccountPoolStrategyPreview from "../AccountPoolStrategyPreview";
import { Select } from "../../ui";

/** The public guide section that explains pool selection, failover and its limits. */
const ANTHROPIC_POOL_GUIDE_URL = "https://opencodex.me/guides/claude-code/#claude-oauth-account-pool-experimental";

const QUOTA_WINDOW_LABEL_KEYS = {
  "five-hour": "accountPool.quotaWindowFiveHour",
  weekly: "accountPool.quotaWindowWeekly",
  "max-utilization": "accountPool.quotaWindowMaxUtilization",
} as const;

type PoolState = {
  enabled: boolean;
  threshold: number;
  strategy: AccountPoolStrategy;
  stickyLimit: number;
  quotaWindow: AccountPoolQuotaWindow;
  supported: string[];
  nativeMessages: boolean;
};

function controlId(provider: string, suffix: string): string {
  const safe = provider.replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "") || "oauth";
  if (provider === "anthropic") {
    if (suffix === "quota-window") return "anthropic-pool-quota-window";
    if (suffix === "strategy") return "anthropic-pool-strategy";
    if (suffix === "sticky-limit") return "anthropic-pool-sticky-limit";
  }
  return safe + "-" + suffix;
}
/**
 * The enabled status line names only what the selected strategy actually reads
 * (src/oauth/anthropic-routing.ts). Round-robin rotates new sessions and refusal recovery
 * through the ring and reads no usage, threshold or window. Fill-first drains the active
 * account to its threshold in the window, then advances in stable order; at threshold 0 it
 * stays until cooldown or sign-in. Quota keeps a healthy active account under the threshold
 * and otherwise, and during recovery, picks the lowest usage in the window.
 */
function enabledStatus(
  t: ReturnType<typeof useT>,
  strategy: AccountPoolStrategy,
  threshold: number,
  quotaWindow: AccountPoolQuotaWindow,
): string {
  const window = t(QUOTA_WINDOW_LABEL_KEYS[quotaWindow]);
  if (strategy === "round-robin") return t("anthropicPool.enabledRoundRobinDesc");
  if (strategy === "fill-first") {
    return threshold === 0
      ? t("anthropicPool.enabledFillFirstNoThresholdDesc")
      : t("anthropicPool.enabledFillFirstDesc", { threshold, window });
  }
  return threshold === 0
    ? t("anthropicPool.enabledNoProactiveDesc", { window })
    : t("anthropicPool.enabledDesc", { threshold, window });
}

export default function AnthropicAccountPoolSettings({
  apiBase,
  accountCount,
  provider = "anthropic",
  onThresholdChange,
}: {
  apiBase: string;
  accountCount: number;
  provider?: string;
  onThresholdChange?: (threshold: number) => void;
}) {
  const t = useT();
  const isAnthropic = provider === "anthropic";
  const [state, setState] = useState<PoolState | null>(null);
  const [draft, setDraft] = useState("80");
  const [stickyDraft, setStickyDraft] = useState(String(DEFAULT_ACCOUNT_POOL_STICKY_LIMIT));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [warning, setWarning] = useState(false);
  const [reloadRequired, setReloadRequired] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [reloading, setReloading] = useState(false);
  const onThresholdChangeRef = useRef(onThresholdChange);
  const mountedRef = useRef(true);
  const apiBaseRef = useRef(apiBase);
  const saveAbortRef = useRef<AbortController | null>(null);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      saveAbortRef.current?.abort();
      saveAbortRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    onThresholdChangeRef.current = onThresholdChange;
    apiBaseRef.current = apiBase;
  }, [apiBase, onThresholdChange]);

  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    void Promise.resolve()
      .then(() => getPoolSettings(apiBase, provider, (input, init) => fetch(input, init), { signal: ac.signal }))
      .then(settings => {
        if (!settings) throw new Error("load");
        return settings;
      })
      .then(json => {
        if (cancelled) return;
        const nextThreshold = typeof json.autoSwitchThreshold === "number" ? json.autoSwitchThreshold : 80;
        const nextSticky = normalizeAccountPoolStickyLimit(json.stickyLimit);
        setState({
          enabled: json.enabled === true || json.enabledEffective === true,
          threshold: nextThreshold,
          strategy: normalizeAccountPoolStrategy(json.strategy),
          stickyLimit: nextSticky,
          quotaWindow: json.quotaWindow == null
            ? DEFAULT_ACCOUNT_POOL_QUOTA_WINDOW
            : normalizeAccountPoolQuotaWindow(json.quotaWindow),
          supported: json.supported,
          nativeMessages: json.nativeMessages === true,
        });
        setDraft(String(nextThreshold));
        onThresholdChangeRef.current?.(nextThreshold);
        setStickyDraft(String(nextSticky));
        setLoadError(false);
        setReloadRequired(false);
        setError(null);
        setWarning(false);
        setReloading(false);
      })
      .catch(() => {
        if (cancelled || ac.signal.aborted) return;
        setLoadError(true);
        setReloading(false);
      });
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [apiBase, provider, reloadVersion]);

  const save = useCallback(async (next: {
    enabled: boolean;
    threshold: number;
    strategy: AccountPoolStrategy;
    stickyLimit: number;
    quotaWindow: AccountPoolQuotaWindow;
    nativeMessages: boolean;
  }) => {
    const requestApiBase = apiBase;
    saveAbortRef.current?.abort();
    const controller = new AbortController();
    saveAbortRef.current = controller;
    const currentRequest = () => mountedRef.current && apiBaseRef.current === requestApiBase
      && saveAbortRef.current === controller && !controller.signal.aborted;
    const previousState = state;
    setSaving(true);
    setError(null);
    setWarning(false);
    try {
      // The client owns the field mapping: `threshold` becomes `autoSwitchThreshold` and the
      // provider is always sent, so no call site can forget either.
      const json = await putPoolSettings(requestApiBase, provider, {
        enabled: next.enabled,
        threshold: next.threshold,
        strategy: next.strategy,
        stickyLimit: next.stickyLimit,
        ...(isAnthropic ? { quotaWindow: next.quotaWindow, nativeMessages: next.nativeMessages } : {}),
      }, (input, init) => fetch(input, init), { signal: controller.signal });
      if (!currentRequest()) return;
      if (!json) throw new Error("save");
      const savedThreshold = typeof json.autoSwitchThreshold === "number" ? json.autoSwitchThreshold : next.threshold;
      const savedStrategy = normalizeAccountPoolStrategy(json?.strategy ?? next.strategy);
      const savedSticky = normalizeAccountPoolStickyLimit(json?.stickyLimit ?? next.stickyLimit);
      const savedWindow = json?.quotaWindow == null
        ? next.quotaWindow
        : normalizeAccountPoolQuotaWindow(json.quotaWindow);
      setState({
        enabled: json.enabled ?? next.enabled,
        threshold: savedThreshold,
        strategy: savedStrategy,
        stickyLimit: savedSticky,
        quotaWindow: savedWindow,
        supported: json.supported.length > 0 ? json.supported : (previousState?.supported ?? []),
        nativeMessages: json.nativeMessages === true,
      });
      setDraft(String(savedThreshold));
      onThresholdChangeRef.current?.(savedThreshold);
      setStickyDraft(String(savedSticky));
      setWarning(json.warning === "config_bookkeeping_failed");
    } catch (failure) {
      if (!currentRequest()) return;
      if (failure instanceof PoolSettingsSaveStateUnknownError) {
        setState(null);
        setReloadRequired(true);
        setLoadError(false);
        setError(null);
        return;
      }
      setError(t("anthropicPool.saveFailed"));
      if (previousState) {
        setState(previousState);
        setDraft(String(previousState.threshold));
        setStickyDraft(String(previousState.stickyLimit));
      }
    } finally {
      const ownsSave = saveAbortRef.current === controller;
      if (ownsSave) saveAbortRef.current = null;
      if (ownsSave && mountedRef.current && apiBaseRef.current === requestApiBase) setSaving(false);
    }
  }, [apiBase, isAnthropic, provider, state, t]);

  const enabled = state?.enabled === true;
  const threshold = state?.threshold ?? 80;
  const strategy = state?.strategy ?? DEFAULT_ACCOUNT_POOL_STRATEGY;
  const stickyLimit = state?.stickyLimit ?? DEFAULT_ACCOUNT_POOL_STICKY_LIMIT;
  const parsedDraft = Number(draft);
  const previewThreshold = Number.isInteger(parsedDraft) && parsedDraft >= 0 && parsedDraft <= 100
    ? parsedDraft
    : threshold;
  const quotaWindow = state?.quotaWindow ?? DEFAULT_ACCOUNT_POOL_QUOTA_WINDOW;
  const showQuotaWindow = isAnthropic || (state?.supported ?? []).includes("quotaWindow");
  const nativeMessages = state?.nativeMessages ?? true;
  const quotaWindowInert = strategy === "round-robin";
  const loading = reloading || (state === null && !loadError && !reloadRequired);
  const controlsDisabled = loading || saving || loadError || reloadRequired;
  const toggleDisabled = controlsDisabled || (!enabled && accountCount < 2);
  const titleKey = isAnthropic ? "anthropicPool.title" : "genericPool.title";
  const enabledDesc = isAnthropic
    ? (threshold === 0
      ? t("anthropicPool.enabledNoProactiveDesc", { window: t(QUOTA_WINDOW_LABEL_KEYS[quotaWindow]) })
      : t("anthropicPool.enabledDesc", { threshold, window: t(QUOTA_WINDOW_LABEL_KEYS[quotaWindow]) }))
    : (threshold === 0 ? t("genericPool.enabledNoProactiveDesc") : t("genericPool.enabledDesc", { threshold }));
  const disabledDesc = t(isAnthropic ? "anthropicPool.disabledDesc" : "genericPool.disabledDesc");

  return (
    <div className="card anthropic-pool-card" aria-busy={loading || saving}>
      <div className="card-row" style={{ alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <strong>{t(titleKey)}</strong>
          <div className="card-sub" style={{ marginTop: 4 }}>
            {reloadRequired
              ? t("anthropicPool.saveStateUnknown")
              : loadError
              ? t(isAnthropic ? "anthropicPool.loadFailed" : "genericPool.loadFailed")
              : loading
                ? t("common.loading")
                : enabled
                  ? (isAnthropic ? enabledStatus(t, strategy, threshold, quotaWindow) : enabledDesc)
                  : disabledDesc}
          </div>
        </div>
        <button
          type="button"
          className={`toggle ${enabled ? "on" : ""}`}
          disabled={toggleDisabled}
          aria-pressed={reloadRequired ? undefined : enabled}
          aria-label={t(titleKey)}
          title={enabled ? t("anthropicPool.on") : t("anthropicPool.off")}
          onClick={() => {
            void save({
              enabled: !enabled,
              threshold,
              strategy,
              stickyLimit,
              quotaWindow,
              nativeMessages,
            });
          }}
        >
          <span className="toggle-knob" />
        </button>
      </div>

      <p className="card-sub anthropic-pool-card__notice">
        {t("anthropicPool.experimentalWarning")}
      </p>

      {accountCount < 2 && (
        <div className="card-sub" style={{ marginTop: 8 }}>
          {t(isAnthropic ? "anthropicPool.needTwoAccounts" : "genericPool.needTwoAccounts")}
        </div>
      )}

      <details className="anthropic-pool-card__details">
        <summary>{t("anthropicPool.detailsSummary")}</summary>
        <p>{t("anthropicPool.detailsEnabling")}</p>
        <p>{t("anthropicPool.detailsFailover")}</p>
        <p>{t("anthropicPool.detailsActivity")}</p>
        <label className="anthropic-pool-card__native-messages">
          <input
            type="checkbox"
            checked={state ? nativeMessages : false}
            disabled={controlsDisabled || !state}
            aria-label={t("anthropicPool.nativeMessagesLabel")}
            aria-describedby="anthropic-pool-native-messages-help"
            onChange={(event) => {
              void save({ enabled, threshold, strategy, stickyLimit, quotaWindow, nativeMessages: event.target.checked });
            }}
          />
          <span className="anthropic-pool-card__native-messages-copy">
            <span className="field-label">{t("anthropicPool.nativeMessagesLabel")}</span>
            <span id="anthropic-pool-native-messages-help" className="card-sub">{t("anthropicPool.nativeMessagesHelp")}</span>
          </span>
        </label>
        <p>
          <a href={ANTHROPIC_POOL_GUIDE_URL} target="_blank" rel="noreferrer">{t("anthropicPool.detailsGuide")}</a>
        </p>
      </details>

      {enabled && state && (
        <>
          {(isAnthropic || strategy === "fill-first") && (
          <label className="field anthropic-pool-card__field">
            <span className="field-label">{t(isAnthropic ? "anthropicPool.threshold" : "genericPool.threshold")}</span>
            <input
              className="input mono"
              type="number"
              min={0}
              max={100}
              step={1}
              value={draft}
              disabled={controlsDisabled}
              aria-label={t(isAnthropic ? "anthropicPool.thresholdAria" : "genericPool.thresholdAria")}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => {
                const parsed = Number(draft);
                if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
                  setDraft(String(threshold));
                  setError(t("anthropicPool.thresholdInvalid"));
                  return;
                }
                if (parsed !== threshold) {
                  void save({
                    enabled: true,
                    threshold: parsed,
                    strategy,
                    stickyLimit,
                    quotaWindow,
                    nativeMessages,
                  });
                }
              }}
            />
            <div className="card-sub" style={{ marginTop: 4 }}>
              {t(isAnthropic ? "anthropicPool.thresholdHelp" : "genericPool.thresholdHelp")}
            </div>
          </label>
          )}

          <AccountPoolStrategyControls
            strategy={strategy}
            allowResetFirst={!isAnthropic}
            compact={!isAnthropic}
            stickyDraft={stickyDraft}
            disabled={controlsDisabled}
            strategySelectId={controlId(provider, "strategy")}
            stickyInputId={controlId(provider, "sticky-limit")}
            onStrategyChange={(next) => {
              if (next === strategy) return;
              void save({
                enabled: true,
                threshold,
                strategy: next,
                stickyLimit,
                quotaWindow,
                nativeMessages,
              });
            }}
            onStickyDraftChange={setStickyDraft}
            onStickyCommit={(nextDraft) => {
              const parsed = parseAccountPoolStickyLimitDraft(nextDraft ?? stickyDraft);
              if (parsed === null) {
                setStickyDraft(String(stickyLimit));
                setError(t("accountPool.stickyLimitInvalid"));
                return;
              }
              if (parsed === stickyLimit) {
                setStickyDraft(String(parsed));
                return;
              }
              void save({
                enabled: true,
                threshold,
                strategy,
                stickyLimit: parsed,
                quotaWindow,
                nativeMessages,
              });
            }}
          />

          {isAnthropic && (
            <AccountPoolStrategyPreview
              strategy={strategy}
              threshold={previewThreshold}
              kind="anthropic"
              enabled={enabled}
            />
          )}

          {showQuotaWindow && (
            <div className="field anthropic-pool-card__field anthropic-pool-card__field--quota-window">
              <span className="field-label">{t("accountPool.quotaWindow")}</span>
              <Select
                id={controlId(provider, "quota-window")}
                value={quotaWindow}
                options={ACCOUNT_POOL_QUOTA_WINDOWS.map((value) => ({
                  value,
                  label: t(QUOTA_WINDOW_LABEL_KEYS[value]),
                }))}
                disabled={controlsDisabled || quotaWindowInert}
                label={t("accountPool.quotaWindow")}
                onChange={(next) => {
                  const parsed = normalizeAccountPoolQuotaWindow(next);
                  if (parsed === quotaWindow) return;
                  void save({
                    enabled: true,
                    threshold,
                    strategy,
                    stickyLimit,
                    quotaWindow: parsed,
                    nativeMessages,
                  });
                }}
              />
              <div className="card-sub" style={{ marginTop: 4 }}>{t("accountPool.quotaWindowDesc")}</div>
              <div className="card-sub" style={{ marginTop: 4 }}>
                {quotaWindowInert ? t("accountPool.quotaWindowInert") : t("accountPool.quotaWindowHint")}
              </div>
            </div>
          )}
        </>
      )}

      {reloadRequired && (
        <div role="alert" className="anthropic-pool-card__save-warning">
          <p>{t("anthropicPool.saveStateUnknown")}</p>
          {loadError && <p>{t("anthropicPool.loadFailed")}</p>}
          <button type="button" className="btn btn-ghost btn-sm" disabled={reloading} onClick={() => {
            setLoadError(false);
            setReloading(true);
            setReloadVersion(version => version + 1);
          }}>{t("anthropicPool.reloadSettings")}</button>
        </div>
      )}
      {warning && (
        <div role="status" className="anthropic-pool-card__save-warning">{t("anthropicPool.saveWarning")}</div>
      )}
      {error && (
        <div role="alert" className="card-sub" style={{ marginTop: 8, color: "var(--danger, #c44)" }}>
          {error}
        </div>
      )}
    </div>
  );
}
