# Phase 5 — three contracts and two GUIs become one

Base: the phase-2 layer. Opens once the kernel lands.

## Thesis

One pool-settings contract and one operator surface, so a new pooled provider
needs configuration rather than another name branch.

## Current behaviour (verified on dd9a2906b)

Three management contracts:

1. Codex only. src/codex/auth-api.ts handleCodexAuthAPI :2477-2515 handles PUT
   and PATCH /api/codex-auth/pool-strategy, writing accountPoolStrategy and
   accountPoolStickyLimit. There is no GET on this path.
2. Anthropic versus generic. src/server/management/oauth-account-routes.ts
   handleOauthAccountRoutes branches on provider !== "anthropic": GET :348-361,
   PUT and PATCH :373-423 with stickyLimit and quotaWindow rejected at :395-396,
   and the anthropic write at :424-483.
3. Registry. src/server/management/route-registry.ts :95 and :110 for the Codex
   path, :263, :270 and :283 for the oauth pool path.

Two GUI surfaces, one shared control:

- shared gui/src/components/AccountPoolStrategyControls.tsx :42 and
  gui/src/account-pool-strategy.ts, whose putCodexPoolStrategy :58-65 posts to the
  Codex-only route
- Codex gui/src/components/CodexPoolStrategySetting.tsx :33 and :174
- Anthropic gui/src/components/provider-workspace/AnthropicAccountPoolSettings.tsx
  :63 GET and :117 PUT, hardcoded to provider=anthropic
- mounted by a name branch in
  gui/src/components/provider-workspace/ProviderAuthPanel.tsx :387-389,
  item.name === "anthropic" only, so the generic kind has an API and no UI

i18n: 36 accountPool.* keys in gui/src/i18n/en.ts :1981-2023, and every catalog in
gui/src/i18n/catalogs.ts :24-33 already carries 36. All nine stay in sync.

## Change surface

NEW one pool-settings DTO covering every kind, served from a single route pair
under the oauth-account-routes module, with the Codex path kept as a deprecated
alias that forwards rather than duplicating the write.

MODIFY ProviderAuthPanel to mount the pool panel from the capability returned by
poolSettingsCapability instead of item.name === "anthropic".

MODIFY AnthropicAccountPoolSettings into a kind-driven component; keep
AccountPoolStrategyControls as the shared control it already is.

MODIFY the i18n catalogs together. Any new key lands in all nine files in the same
commit, per the docs-sync rule in AGENTS.md.

## Boundary with phase 4

This layer owns oauth-account-routes.ts, the route registry entries and the GUI
pool surfaces. Phase 4 keeps key-strategy fields out of those files. If the key
pool needs an operator surface, it arrives here after both have landed, not in
parallel.

## Tests

tests/server/account-pool-management-api.test.ts for the unified DTO and the
deprecated alias; tests/cli/cli-account-pool-verbs.test.ts for CLI parity; a GUI
test that the panel mounts for a generic OAuth provider. A gui-labelled PR needs a
screenshot in its description per AGENTS.md.

## wp5 plan — one pool-settings contract

## What "three contracts" actually means

Not three routes with one shape. Three shapes, three storage locations and three
re-implementations of the same validation.

| Kind | Route | Storage | DTO fields |
|---|---|---|---|
| Codex | `PUT /api/codex-auth/auto-switch`, `PUT\|PATCH /api/codex-auth/pool-strategy` | `runtimeConfig.autoSwitchThreshold`, `.accountPoolStrategy`, `.accountPoolStickyLimit` | threshold; strategy + stickyLimit, split across two routes |
| Anthropic | `GET\|PUT\|PATCH /api/oauth/accounts/pool?provider=anthropic` | `config.anthropicAccountPool` | enabled, autoSwitchThreshold, strategy, stickyLimit, quotaWindow, `experimental: true` |
| generic | same route, other branch | `providers.<name>.oauthAccountFailover` | enabled, strategy, autoSwitchThreshold, stickyLimit, `inert` |

Anchors: `src/codex/auth-api.ts`:2465 and :2478; `src/server/management/oauth-account-routes.ts`:354
and :379; `src/oauth/pool-settings-capability.ts`:57.

Three consequences, all observable today. The Codex kind is the only one that cannot be READ
through a pool route at all — the CLI reads `/api/codex-auth/active` instead
(`src/cli/account-extended.ts`:854-887 already documents the asymmetry as a table, which is the
tell). Every kind re-parses `strategy` and `stickyLimit` with its own copy of the same bounds.
And a field that exists for one kind is absent rather than declared-unsupported for the others,
so a dashboard cannot tell "this pool has no quotaWindow" from "this pool forgot to send it".

## The unit

**One DTO, one validator, one route. The three existing paths stay as aliases.**

NEW `src/server/management/pool-settings-contract.ts` — a single `PoolSettingsDto` with every
field the union needs and an explicit `supported` set per kind, plus one validator that owns the
strategy names, the 1..100 sticky bound and the 0..100 threshold bound. The three kinds keep
their own STORAGE; only the shape and the validation are shared.

NEW route `GET\|PUT /api/pool/settings?provider=<name>` in
`src/server/management/oauth-account-routes.ts`, registered in `route-registry.ts`, serving all
three kinds through `poolSettingsCapability`.

The three existing paths keep working, unchanged, delegating to the same module. This is
additive on purpose: the management API is a public contract with CLI and GUI clients, and a
breaking change is not what "consolidate" has to mean. The registry marks the old paths
superseded so the next reader knows which one is canonical.

MODIFY `src/cli/account-extended.ts` — the transport table at :854-887 exists precisely because
the two contracts disagree. It collapses to one path, and the comment explaining the asymmetry
goes with it.

## Out of scope, and why

**The GUI half is its own work-phase (wp5b).** `gui/src/codex-auto-switch.ts` and
`gui/src/components/provider-workspace/AnthropicAccountPoolSettings.tsx` are two separate pool
surfaces, and merging them is a visual change. This repository's `enforce-target` gate requires
a screenshot in the description of any PR whose title or description mentions `gui`, which means
building and running the dashboard to capture one. That is a real deliverable, not a formality,
and bolting it onto a server-side PR would either skip the evidence or stall the server work
behind it.

## Acceptance

- One module owns strategy/sticky/threshold validation; a bad value is rejected identically on
  every kind, proven by a table-driven test across all three.
- `GET /api/pool/settings?provider=` answers for Codex, Anthropic and a generic provider, and
  each response declares which fields that kind supports rather than omitting them.
- The three legacy paths return byte-identical bodies to today, proven by tests that predate this
  change and must not be edited.
- Red control: each new shared-validator case must fail if the shared bound is loosened.

