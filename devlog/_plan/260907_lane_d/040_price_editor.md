# 040 Manual price editor
MODIFY src/usage/cost.ts userOverlayMatch: valid operator all-zero row returns user
price, while generated catalog zeros keep unknown/fallback semantics.
MODIFY src/server/management/model-routes.ts: exact-provider model-costs GET/PUT,
validate four finite nonnegative bounded rates or null reset, preserve siblings,
rollback on persist failure, no routing/catalog mutation required for price-only edits.
MODIFY src/cli/models-runtime.ts, models-runtime-subcommands.ts and capabilities.ts:
models set-price provider/model --input N --output N [--cache-read N --cache-write N]
or --auto. GET for show and PUT for set/reset through existing management client.
ADD gui/src/components/ModelPriceDialog.tsx; MODIFY Models.tsx and models-shared.ts
only as needed: edit action, load exact saved override, inputs 4 rates USD/1M,
save/reset and manual indicator. Reuse dialog/fetch/i18n patterns. All locale keys
append-only pricing.override.*. Add endpoint, CLI, estimator and GUI regressions;
register new test files in both append-only layout manifests. Public docs and generated
CLI surface map mirror actual capability entries; source-generation commands NOT RUN
locally so map is updated by its source contract without claiming verification.

Verification: NOT RUN locally by user instruction; focused tests execute in final top-head Cross-platform CI.

A fold-back: add GET/PUT entries in src/server/management/route-registry.ts.
Reuse providerModelCostsConfigError. GET returns sanitized per-provider modelCosts map;
Models owns a typed map loaded with catalog or dedicated GET, so manual badges survive
reload. CLI omitted cache-read/cache-write rates default to zero, explicitly documented.
