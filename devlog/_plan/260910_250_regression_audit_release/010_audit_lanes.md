# Audit lanes

Five read-only lanes, each dispatched to an independent `xai/grok-4.6` subagent with a
forked-context-free packet. Read scopes are stated per lane so a finding can be traced to
one owner; the lanes never write, and the main session de-duplicates the returns.

Every lane compares `2f3f73629...origin/dev` and must return exact `path:line` anchors.
A lane that finds nothing returns "no blocker" with the files it actually read.

## L1 — Responses and request pipeline

`src/server/responses/{core,compact,context-overflow,policy-fallback,codex-ws-wire}.ts`,
`src/server/{chat-completions,chat-native,claude-messages,images,search,request-decompress,request-log}.ts`,
`src/claude/inbound.ts`, `src/web-search/{passthrough-bridge,ollama-executor}.ts`.

Highest-risk lane: it owns the new hosted web-search bridge (+657 test lines), the
non-streaming context-overflow classification, agent-task recovery on mid-thread model
switches, and the configurable inbound body admission limit.

## L2 — Codex accounts, quota, OAuth

`src/codex/{account-runtime-state,account-store,account-usability,auth-api,auth-context,inject,quota,quota-auto-refresh}.ts`,
`src/oauth/{health,index,token-guardian}.ts`, `src/cli/{account,account-api,account-auth,account-extended}.ts`.

Carries deferred validation, revoked pool grants, reauth-state clearing, the new account
plan field, and the token guardian.

## L3 — Catalog, providers, combos, config

`src/codex/catalog/{parsing,provider-fetch,sync}.ts`, `src/providers/{registry,quota,google-ai-studio-model-discovery,opencode-zen-rate-limit}.ts`,
`src/combos/{index,resolve}.ts`, `src/config.ts`, `src/types.ts`, `src/types/{accounts,config,provider}.ts`,
`src/clients/config-export/zcode.ts`, `src/lib/errors.ts`.

Carries free-model pricing classification and filtering, quota-exhausted inactive marking,
AI Studio discovery restoration, and cross-provider blocked-model redirects.

## L4 — Management API, service, GUI

`src/server/management/*`, `src/server/{management-api,auth-cors,index}.ts`, `src/service.ts`,
`gui/src/**`, `gui/tests/**`.

Carries the routed-account log label, the decode-rate column, management auth, the stale
launchd bootout recovery, and nine i18n locale files that must not contradict `en`.

## L5 — Security, privacy, release surface

Cross-cutting read of `src/lib/privacy.ts`, the body-size admission path, OrcaRouter
key-exchange bounds, web-search bridge egress, `package.json`, `scripts/test-layout/layout.json`,
and the repository invariants in `AGENTS.md` (Lab/core import boundary, no tracked gitlink,
no request-body or credential logging).

The email-masking opt-out is the specific item to scrutinize: it deliberately weakens a
privacy default, so it must be off by default and covered by `bun run privacy:scan`.

## Blocker definition

A finding blocks the release when it is a behavior regression against 2.49.0, a crash or
hang on a default path, a security or privacy weakening, or a broken release/packaging
surface. Style, missing coverage for unchanged code, and pre-existing defects do not block.
