/**
 * The hub's own projection for `GET|HEAD /v1/hub-state` (#4236).
 *
 * Pure: it takes the config and an already-computed login summary and returns the DTO. The
 * route owns admission, the role gate and the size ceiling; this module owns what a client is
 * allowed to learn. Keeping the projection here — and building each row field by field rather
 * than spreading a provider or a login summary — is what makes "no keys, no emails, no account
 * ids" checkable by reading one function. A spread would silently start exporting whatever the
 * next field added to those records happens to be.
 *
 * Contract and caps live in `src/remote/hub-state.ts` so the client validates the same shape.
 */
import {
  HUB_STATE_SCHEMA_VERSION,
  MAX_HUB_STATE_OAUTH_PROVIDERS,
  MAX_HUB_STATE_PROVIDERS,
  MAX_HUB_STATE_SUBAGENT_MODELS,
  HUB_STATE_AUTH_MODES,
  type HubStateDTO,
  type HubStateOAuthEntry,
  type HubStateProvider,
} from "../remote/hub-state";
import { DEFAULT_SUBAGENT_MODELS } from "../config/subagent-models";
import type { OcxConfig } from "../types";

export type HubStateConfigView = Pick<OcxConfig, "providers" | "subagentModels" | "claudeCode" | "hub">;

/** A login summary row as `oauthLoginSummary()` returns it; extra fields are never read. */
export interface HubStateLoginRow {
  provider: string;
  loggedIn: boolean;
}

/**
 * The hub's effective featured roster: the same "unset means the defaults, an explicit `[]`
 * means none" rule `buildClaudeAgentDefs` applies, so a client that delegates from this list
 * sees exactly what the hub itself would offer.
 */
export function hubSubagentRoster(config: Pick<OcxConfig, "subagentModels">): string[] {
  const roster = config.subagentModels === undefined ? DEFAULT_SUBAGENT_MODELS : config.subagentModels;
  return roster
    .filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
    .map(entry => entry.trim())
    .slice(0, MAX_HUB_STATE_SUBAGENT_MODELS);
}

export function buildHubState(
  config: HubStateConfigView,
  logins: readonly HubStateLoginRow[],
  hubVersion: string,
): HubStateDTO {
  const providers: HubStateProvider[] = Object.entries(config.providers ?? {})
    .slice(0, MAX_HUB_STATE_PROVIDERS)
    .map(([name, provider]) => ({
      name,
      adapter: provider.adapter,
      authMode: provider.authMode !== undefined && HUB_STATE_AUTH_MODES.includes(provider.authMode)
        ? provider.authMode
        : null,
      // Presence only. Identical to the projection GET /api/providers already ships.
      hasCredential: Boolean(provider.apiKey),
      disabled: provider.disabled === true,
    }));
  // Field-by-field, never a spread: oauthLoginSummary also carries the operator's email.
  const oauth: HubStateOAuthEntry[] = logins
    .slice(0, MAX_HUB_STATE_OAUTH_PROVIDERS)
    .map(entry => ({ provider: entry.provider, loggedIn: entry.loggedIn === true }));
  return {
    schemaVersion: HUB_STATE_SCHEMA_VERSION,
    runtimeRole: "hub",
    hubVersion,
    origin: config.hub?.dataPublicOrigin ?? null,
    providers,
    oauth,
    subagentModels: hubSubagentRoster(config),
    // Same predicate the launch path uses: absence means enabled.
    claudeCode: { enabled: config.claudeCode?.enabled !== false },
  };
}
