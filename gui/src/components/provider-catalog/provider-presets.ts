/**
 * provider-catalog/provider-presets.ts
 *
 * Pure data owner for the add-provider catalog: the /api/provider-presets DTO
 * shape, tier classification (delegating to the provider-workspace catalog
 * predicates), search filtering, and deterministic sorting. No React, no fetch.
 */

import { providerTier, type ProviderTier, type WorkspaceProvider, type WorkspaceItem } from "../../provider-workspace/catalog";
import { isLocalProvider } from "../../provider-workspace/kind";
import type { ProviderPayload } from "../../provider-payload";

/** Row shape returned by GET /api/provider-presets (mirrors DerivedProviderPreset). */
export interface CatalogPreset {
  id: string;
  label: string;
  adapter: string;
  baseUrl: string;
  responsesPath?: string;
  defaultModel?: string;
  /** "oauth": account login · "forward": ChatGPT passthrough · "key": API key · "local": local scaffold. */
  auth: "oauth" | "forward" | "key" | "local";
  /** OAuth registry id (for auth === "oauth"). */
  oauthProvider?: string;
  /** Where to create/copy the API key (for auth === "key" catalog providers). */
  dashboardUrl?: string;
  note?: string;
  /** API key is optional — provider works without one (keyless free). */
  keyOptional?: boolean;
  /** Free pricing — may still require an API key (e.g. NVIDIA NIM). */
  freeTier?: boolean;
  /** Sponsor tier (SPONSORS.md). Sponsor rows are pinned to the top of their tab and chipped. */
  sponsor?: "main" | "standard";
  sponsorUrl?: string;
  /**
   * Endpoint picker (e.g. Qwen Cloud). Choice without `baseUrl` = Custom (show text field).
   */
  baseUrlChoices?: Array<{ id: string; label: string; baseUrl?: string }>;
  codexAccountMode?: "direct" | "pool";
  provider?: ProviderPayload;
}

/** A configured name alone cannot identify a sponsor after its endpoint is edited. */
export function matchingWorkspacePreset(item: WorkspaceItem, presets: CatalogPreset[]): CatalogPreset | undefined {
  const endpoint = (value: string) => {
    try {
      const url = new URL(value.trim());
      if (url.username || url.password || url.search || url.hash) return undefined;
      return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
    } catch { return undefined; }
  };
  const base = endpoint(item.baseUrl);
  if (!base) return undefined;
  return presets.find(preset => preset.id === item.name && preset.adapter === item.adapter
    && endpoint(preset.baseUrl) === base);
}

/**
 * Adapt a preset row to the WorkspaceProvider shape the tier predicates expect
 * (preset `auth` ↔ config `authMode`; booleans normalized).
 */
export function presetTierInput(preset: CatalogPreset): WorkspaceProvider {
  return {
    adapter: preset.adapter,
    baseUrl: preset.baseUrl,
    authMode: preset.auth,
    freeTier: !!preset.freeTier,
    keyOptional: !!preset.keyOptional,
  };
}

/** Three-way tier for a catalog preset row (accounts wins over free; else paid). */
export function presetTier(preset: CatalogPreset): ProviderTier {
  return providerTier(preset.id, presetTierInput(preset));
}

/**
 * Browse tabs in the add-provider catalog. Four-way, and deliberately NOT `ProviderTier`:
 * the workspace keeps a three-way pricing/ownership tier for badges, rail sorting and the
 * Free count, where `isFreeProvider` folds local runtimes into free on purpose. Only the
 * catalog needs Local as a browse destination, so the split stops at this file.
 */
export type CatalogTier = "accounts" | "free" | "local" | "paid";

/**
 * A local-runtime row: explicit `local` auth or a loopback base URL. Delegates to the one
 * helper the providers rail already classifies with, so a preset and its configured
 * counterpart can never disagree about being local.
 */
export function isLocalCatalogPreset(preset: CatalogPreset): boolean {
  return isLocalProvider(presetTierInput(preset));
}

/** Tab buckets for the catalog: accounts / free / local / paid, preserving input order per bucket. */
export function bucketPresets(presets: CatalogPreset[]): Record<CatalogTier, CatalogPreset[]> {
  const buckets: Record<CatalogTier, CatalogPreset[]> = { accounts: [], free: [], local: [], paid: [] };
  for (const preset of presets) {
    // Local is peeled off AFTER `presetTier` has spoken, which is what lets `presetTier`
    // keep returning `"free"` for Ollama and leaves the workspace Free count untouched.
    //
    // Accounts is checked first as a forward guard, not because the case can arise today:
    // `isAccountProvider` requires the exact `https://chatgpt.com/backend-api/codex` base
    // URL, so no row can be both accounts-tier and loopback. If that classifier is ever
    // widened, this ordering is what stops a local-looking account row from being pulled
    // out of the tab where a user logs in.
    const tier = presetTier(preset);
    const bucket: CatalogTier = tier === "accounts" ? "accounts"
      : isLocalCatalogPreset(preset) ? "local"
      : tier;
    buckets[bucket].push(preset);
  }
  return buckets;
}

/** Case-insensitive search across label and id only (never adapter/baseUrl). */
export function filterPresets(presets: CatalogPreset[], query: string): CatalogPreset[] {
  const q = query.trim().toLowerCase();
  if (!q) return presets;
  return presets.filter(p => p.label.toLowerCase().includes(q) || p.id.toLowerCase().includes(q));
}

/** Every nonempty note has a full-text route: rendered clipping depends on width,
 * adapter chips and badges, so no character threshold can safely hide the control. */
export function noteNeedsReveal(note: string | undefined): boolean {
  return !!note?.trim();
}
