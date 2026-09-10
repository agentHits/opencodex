# Lane partition — measured file collisions

Method: `gh pr view <n> --json files` over 27 open PRs on 2026-09-11, `devlog/` paths dropped, then
grouped by path. Territories were rewritten after audit round 1 (`030_audit_round1.md`): they are
explicit file lists, because the first version used globs and two lanes silently shared
`src/server/responses/`.

## Contended files

| Count | Path | Open PRs |
|---|---|---|
| 4 | `src/server/responses/core.ts` | #4050, #4118, #4181, #4184 |
| 4 | `src/providers/quota.ts` | #4090, #4105, #4174, #4210 |
| 4 | `tests/providers/provider-quota.test.ts` | #4090, #4105, #4174, #4210 |
| 3 | `gui/src/i18n/{de,en,fr,ja,ko,ru,tr,zh,zh-TW}.ts` | #4111, #4183, #4193 |
| 3 | `scripts/test-layout/layout.json` | #4119, #4193, #4203 |
| 3 | `tests/fixtures/test-layout-expected.json` | #4119, #4193, #4203 |
| 2 | `src/server/claude-messages.ts` | #4050, #4184 |
| 2 | `src/server/chat-completions.ts` | #4118, #4184 |
| 2 | `src/types/tools.ts` | #4171, #4181 |
| 2 | `src/combos/resolve.ts` | #4090, #4105 |
| 2 | `src/config.ts` | #4100, #4183 |
| 2 | `src/update/job.ts` | #4185, #4203 |

Collision-free PRs, touching no file any other open PR touches: #4062, #4104, #4119, #4124, #4130,
#4139, #4159, #4177, #4178, #4187, #4188, #4199.

## Lanes

| Lane | Branch | Owned files | Stack order |
|---|---|---|---|
| L1 | `codex/260911-l1-responses-core` | `src/server/responses/core.ts`, `compact.ts`, `policy-fallback.ts`, `src/server/chat-completions.ts`, `src/server/claude-messages.ts`, `src/server/request-log-conversation.ts`, `src/server/responses-undeclared-tool-guard.ts`, `src/providers/opencode-go-transport.ts`, `src/types/tools.ts` | #4172 → #4176 |
| L2 | `codex/260911-l2-catalog-provider` | `src/providers/quota*.ts`, BigModel preset definitions, `src/codex/catalog/*` except `effort.ts` | #4201 |
| L3 | `codex/260911-l3-account-pool` | `src/codex/account-*.ts`, `plan.ts`, `plan-from-token.ts`, `warmup.ts`, `model-entitlements.ts`, `src/server/responses/codex-auth-error.ts`, the one key in `src/config.ts` | #4126 → #4212 → #4211 |
| L4 | `codex/260911-l4-service-cli` | `src/update/*`, `src/service*.ts`, `src/cli/*`, `src/client/*`, `src/lib/process-control.ts`, `src/codex/catalog/effort.ts`, `src/codex/cli-install-provenance.ts` | #4202 → #4169 → #4204 → #4207 |
| L5 | `codex/260911-l5-integrations-io` | `src/config/atomic-write.ts`, `src/integrations/*` | #4197 → #4214 |
| L6 | `codex/260911-l6-streaming-tools` | `src/server/responses/codex-ws-exchange.ts`, `codex-ws-wire.ts`, `src/adapters/qoder/*` | #4191 → #4190 |
| L7 | `codex/260911-l7-docs` | `docs-site/**/guides/providers.md`, `docs-site/**/guides/remote-hub.md` | #4215 → #4200 |

## Custody of shared assets

- `scripts/test-layout/layout.json` and `tests/fixtures/test-layout-expected.json`: every lane
  registers its own new test files in both maps, as `AGENTS.md` requires. These are append-only
  lists, so the conflicts are mechanical; the orchestrator resolves them during the serialized
  merges. Audit round 1 rejected the earlier rule that told lanes to avoid the maps by naming
  convention, because the regex seeds are a placement fallback and not a substitute for the entry.
- `gui/src/i18n/*`: no lane in this round adds a locale key. A lane that needs one stops and reports
  instead of editing nine files.
- `src/config.ts`: only L3 may add a field, and only `codexPool.excludedPlans`.
- Documentation: L7 owns the two guide pages it is fixing. Any other lane may update the page that
  documents its own change, including the pages a carried PR already touches.

