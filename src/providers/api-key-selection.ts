import { randomUUID } from "node:crypto";
import { mutatePersistedConfig } from "../config";
import { publishAccountSelection } from "../lib/account-selection-events";
import type { OcxConfig, OcxProviderConfig } from "../types";
import type { ProviderApiKeySelection } from "../types/provider";

export function captureProviderApiKeySelection(provider: OcxProviderConfig): ProviderApiKeySelection {
  return {
    entryId: provider.apiKeyPool?.find(entry => entry.key === provider.apiKey)?.id,
    reference: provider.apiKey,
    revision: provider.apiKeySelectionRevision,
  };
}

function matchesSelection(provider: OcxProviderConfig, expected: ProviderApiKeySelection): boolean {
  const current = captureProviderApiKeySelection(provider);
  return current.entryId === expected.entryId && current.reference === expected.reference
    && current.revision === expected.revision;
}

type SelectionMutation<T> = { changed: boolean; value: T; selectionChanged?: boolean };
export type ProviderApiKeyCommit<T> =
  | { status: "committed"; provider: OcxProviderConfig; value: T }
  | { status: "superseded"; provider: OcxProviderConfig }
  | { status: "unavailable" };

/** GUI and recovery share one persisted selection transaction and post-commit notification. */
export function commitProviderApiKeySelection<T>(
  config: OcxConfig,
  name: string,
  mutation: (provider: OcxProviderConfig) => SelectionMutation<T>,
  expectedSelection?: ProviderApiKeySelection,
): ProviderApiKeyCommit<T> {
  const outcome = mutatePersistedConfig<ProviderApiKeyCommit<T> & { notify?: boolean }>(fresh => {
    const provider = fresh.providers[name];
    if (!provider || provider.authMode === "oauth" || provider.authMode === "forward") {
      return { changed: false, value: { status: "unavailable" } };
    }
    if (expectedSelection && !matchesSelection(provider, expectedSelection)) {
      return { changed: false, value: { status: "superseded", provider: structuredClone(provider) } };
    }
    const before = provider.apiKey;
    const result = mutation(provider);
    const notify = result.selectionChanged === true || before !== provider.apiKey;
    if (notify) provider.apiKeySelectionRevision = randomUUID();
    delete provider._apiKeyAttempt;
    return {
      changed: result.changed || notify,
      value: { status: "committed", provider: structuredClone(provider), value: result.value, notify },
    };
  });
  if (outcome.status === "unavailable") return { status: "unavailable" };
  const committed = outcome.value;
  if (committed.status !== "unavailable") config.providers[name] = structuredClone(committed.provider);
  if (committed.status === "committed" && committed.notify) publishAccountSelection(name, "api-key");
  return committed;
}
