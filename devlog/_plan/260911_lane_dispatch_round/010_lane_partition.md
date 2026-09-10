# Lane partition — measured file collisions

Method: `gh pr view <n> --json files` over 27 open PRs on 2026-09-11, `devlog/` paths dropped, then
grouped by path. This is a snapshot; a lane that finds a new collision reports it rather than
working around it silently.

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

The two `test-layout` rows are the interesting ones. #4119, #4193, and #4203 have nothing to do with
each other and still collide, because every new test file has to be registered in both. The way out
is naming, not coordination: a test file named `tests/<domain>/<name>.test.ts` is placed by the regex
seeds in `layout.json` and needs no entry at all.

## Lanes

| Lane | Branch | File territory | Stack order |
|---|---|---|---|
| L1 | `codex/260911-l1-responses-core` | `src/server/responses/*`, `src/server/chat-completions.ts`, `src/server/claude-messages.ts`, `src/providers/opencode-go-transport.ts`, `src/types/tools.ts`, `src/responses/code-mode-helper-compat.ts` | #4172 → #4176 |
| L2 | `codex/260911-l2-catalog-provider` | `src/providers/quota*.ts`, `src/codex/catalog/*`, BigModel provider preset | #4201 → #4207 |
| L3 | `codex/260911-l3-account-pool` | `src/codex/account-*.ts`, `plan*.ts`, `warmup.ts`, `model-entitlements.ts` | #4126 → #4212 → #4211 |
| L4 | `codex/260911-l4-service-cli` | `src/update/*`, `src/service*.ts`, `src/cli/*`, stop/ownership refusal paths | #4202 → #4169 → #4204 |
| L5 | `codex/260911-l5-integrations-io` | `src/config/atomic-write.ts`, `src/integrations/*` | #4197 → #4214 |
| L6 | `codex/260911-l6-streaming-tools` | streaming/WebSocket prelude paths, vendor scaffolding filters | #4191 → #4190 |
| L7 | `codex/260911-l7-docs` | `docs-site/**` only | #4215 → #4200 |

## Custody of shared assets

Three assets are owned by nobody in this round and would otherwise collide across lanes.

- `scripts/test-layout/layout.json` and `tests/fixtures/test-layout-expected.json`: no lane edits
  them. Name new test files conventionally so the regex seeds place them.
- `gui/src/i18n/*`: no lane in this round adds a locale key. A lane that believes it needs one stops
  and reports it to the orchestrator instead of editing nine files.
- `src/config.ts`: only L3 may add a configuration field, and only the opt-in key named in #4211.

