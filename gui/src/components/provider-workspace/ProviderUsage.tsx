/**
 * ProviderUsage — the usage tab (WP090): 30-day cost/request/token metrics,
 * per-model cost breakdown table, and rate-limit windows on QuotaBars.
 */
import { Fragment, useMemo, useState } from "react";
import { useT, useI18n } from "../../i18n/shared";
import QuotaBars from "../QuotaBars";
import type { WorkspaceItem } from "../../provider-workspace/catalog";
import { formatRelativeTime, relativeTimeLabelsFromT, formatRequestCount, formatTokenCount, formatCostUsd } from "../../provider-workspace/usage";
import { accountQuotaFromReport, formatQuotaSourceLabel, type ProviderQuotaReportView } from "../../provider-workspace/report";
import type { ProviderUsageTotals, ProviderModelUsageRow, OAuthAccountRow } from "./types";

export default function ProviderUsage({ item, usageTotals, quotaReport, modelUsage, accounts }: {
  item: WorkspaceItem;
  usageTotals?: ProviderUsageTotals;
  quotaReport?: ProviderQuotaReportView;
  modelUsage?: ProviderModelUsageRow[];
  accounts?: OAuthAccountRow[];
}) {
  const t = useT();
  const { locale } = useI18n();
  const timeLabels = relativeTimeLabelsFromT(t);
  const hasUsage = usageTotals?.requests !== undefined;
  const quota = accountQuotaFromReport(quotaReport);
  const [expandedModel, setExpandedModel] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("all");

  const selectedAccount = useMemo(() => {
    if (!accounts?.length || selectedAccountId === "all") return null;
    return accounts.find(a => a.id === selectedAccountId) ?? null;
  }, [accounts, selectedAccountId]);
  void item;

  const sortedModels = useMemo(() => {
    if (!modelUsage?.length) return [];
    return modelUsage.toSorted((a, b) => b.totalTokens - a.totalTokens);
  }, [modelUsage]);

  const providerCost = useMemo(() => {
    if (!sortedModels.length) return undefined;
    let total = 0;
    let hasCost = false;
    for (const m of sortedModels) {
      if (m.estimatedCostUsd !== undefined) {
        total += m.estimatedCostUsd;
        hasCost = true;
      }
    }
    return hasCost ? total : undefined;
  }, [sortedModels]);

  return (
    <div className="pws-section">
      <div className="pws-usage-block">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <h3 className="pws-section-title" style={{ margin: 0 }}>{t("pws.usageLast30d")}</h3>
          {accounts && accounts.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label htmlFor="pws-account-filter" className="muted faint" style={{ fontSize: 13 }}>
                {t("pws.usageAccountSelector")}:
              </label>
              <select
                id="pws-account-filter"
                className="select select-sm"
                value={selectedAccountId}
                onChange={e => setSelectedAccountId(e.target.value)}
              >
                <option value="all">{t("pws.allAccountsCombined")}</option>
                {accounts.map(acc => (
                  <option key={acc.id} value={acc.id}>
                    {acc.email ?? acc.alias ?? acc.id} {acc.active ? `(${t("prov.accountActive")})` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        {selectedAccount && (
          <div style={{ marginTop: 8 }}>
            <span className="badge badge-primary">
              {selectedAccount.email ?? selectedAccount.alias ?? selectedAccount.id}
              {selectedAccount.active ? ` · ${t("prov.accountActive")}` : ""}
            </span>
          </div>
        )}
        {hasUsage ? (
          <>
            <div className="pws-usage-metrics pws-usage-metrics-3" role="group" aria-label={t("pws.usageLast30d")}>
              <div className="pws-usage-metric">
                <span className="pws-usage-metric-value mono">{formatCostUsd(providerCost, locale)}</span>
                <span className="muted pws-usage-metric-label">{t("pws.estimatedCost")}</span>
              </div>
              <div className="pws-usage-metric">
                <span className="pws-usage-metric-value">{formatRequestCount(usageTotals?.requests, locale)}</span>
                <span className="muted pws-usage-metric-label">{t("pws.metricRequests")}</span>
              </div>
              <div className="pws-usage-metric">
                <span className="pws-usage-metric-value">{formatTokenCount(usageTotals?.totalTokens, locale)}</span>
                <span className="muted pws-usage-metric-label">{t("pws.metricTokens")}</span>
              </div>
            </div>
            <p className="muted pws-cost-disclaimer">{t("pws.costDisclaimer")}</p>
          </>
        ) : (
          <p className="muted">{t("pws.usageUnavailable")}</p>
        )}
      </div>

      {sortedModels.length > 0 && (
        <div className="pws-usage-block">
          <h3 className="pws-section-title">{t("pws.modelBreakdown")}</h3>
          <div className="tbl-wrap">
            <table className="pws-model-table">
              <thead>
                <tr>
                  <th>{t("pws.col.model")}</th>
                  <th className="num">{t("pws.col.cost")}</th>
                  <th className="num">{t("pws.col.tokens")}</th>
                  <th className="num">{t("pws.col.requests")}</th>
                  <th>{t("pws.col.share")}</th>
                </tr>
              </thead>
              <tbody>
                {sortedModels.map(row => {
                  const key = row.model;
                  const isExpanded = expandedModel === key;
                  return (
                    <Fragment key={key}>
                      <tr className="pws-model-row">
                        <td className="mono">
                          <button
                            type="button"
                            className="pws-model-expand"
                            aria-expanded={isExpanded}
                            onClick={() => setExpandedModel(isExpanded ? null : key)}
                          >
                            {row.model}
                          </button>
                        </td>
                        <td className="num mono">{formatCostUsd(row.estimatedCostUsd, locale)}</td>
                        <td className="num mono">{formatTokenCount(row.totalTokens, locale)}</td>
                        <td className="num">{row.requests}</td>
                        <td>
                          <div className="pws-share-bar">
                            <div className="pws-share-bar-fill" style={{ width: `${Math.round(row.shareRatio * 100)}%` }} />
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="pws-model-detail">
                          <td colSpan={5}>
                            <div className="pws-model-detail-grid">
                              <div>
                                <span className="muted">{t("pws.tokenInput")}</span>
                                <span className="mono"> {formatTokenCount(row.inputTokens, locale)}</span>
                              </div>
                              <div>
                                <span className="muted">{t("pws.tokenOutput")}</span>
                                <span className="mono"> {formatTokenCount(row.outputTokens, locale)}</span>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="pws-usage-block">
        <h3 className="pws-section-title">{t("pws.rateLimits")}</h3>
        {quota ? (
          <>
            <QuotaBars quota={quota} plan={null} threshold={80} t={t} layout="stacked" />
            <dl className="pws-kv pws-usage-meta">
              {quotaReport?.source?.trim() && (
                <div className="pws-kv-row">
                  <dt>{t("pws.stats.source")}</dt>
                  <dd>{formatQuotaSourceLabel(quotaReport.source)}</dd>
                </div>
              )}
              <div className="pws-kv-row">
                <dt>{t("pws.stats.quotaUpdated")}</dt>
                <dd>{formatRelativeTime(quotaReport?.updatedAt, timeLabels)}</dd>
              </div>
            </dl>
          </>
        ) : (
          <p className="muted">{t("pws.quotaUnavailable")}</p>
        )}
      </div>
    </div>
  );
}
