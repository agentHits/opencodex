# 060 — PR6: a connected client reports the hub's state, not its own

Unit: `devlog/_plan/260911_hub_single_port`. Stack position 6, branch
`codex/260911-l4-client-hub-state`, based on `codex/260911-l4-hub-token-ux` = `8c277294c`
(`test(service): drop the installLaunchd import the restack left unused`), so PR1 launchd repair,
PR2 loopback companion, PR3 hub local clients and PR4 hub token UX are all in ancestry. Sibling of
the docs PR 5 on the same base. Issue: lidge-jun/opencodex#4236.

## The incident this closes

Verbatim from the operator: an agent running on a connected **client** machine read that
machine's local `~/.opencodex/config.json` and `ocx status`, saw `xai ✗ not logged in`, no grok
provider and only five delegable models, and concluded **the hub could not serve grok** — while
the hub has xAI logged in and serves grok.

Nothing malfunctioned. Every number the agent read was correct *about the client*, and a client
stores no provider credentials and no featured roster by design. The defect is attribution: three
surfaces reported local facts in the voice of the system.

1. **`ocx status`.** `collectStatus` read only `readConfigDiagnostics()` plus local probes, and
   the human renderer printed `OAuth logins:` from `oauthLoginSummary()` — this machine's
   credential store, empty on a client. The only hub-aware output was one buried
   `Remote hub: connected (<url>)` line.
2. **The Claude Code spawn surface.** `cmdClaude` gated the roster writer on
   `typeof route === "number"`, false on a connected client (`route` is a `ClaudeRoutingTarget`),
   so `~/.claude/agents/ocx-*.md` was whatever a previous standalone run had left — and when it
   did run it built from local `config.subagentModels`, capped at five. That is the "only 5
   delegable models" the operator saw.
3. **`ocx config show`.** `runtimeRole: "client"` and the `client` block were printed but
   unlabelled, and `client.priorCatalog` — a base64 catalog snapshot up to 64 MB — sat in the
   middle of the document burying them.

## What shipped

### 1. `GET|HEAD /v1/hub-state` on the hub's data plane

`src/remote/hub-state.ts` (contract + caps + `parseHubStateBody`), `src/server/hub-state.ts`
(`buildHubState`, pure), the route in `src/server/index.ts` immediately after `/v1/catalog`, and
one `AUTH_MATRIX` row.

Admission is `resolveApiAuth` + `isAllowedRequestOrigin`, identical to `/v1/catalog` (#809) and
for the same reason: nothing here forwards a caller credential upstream. No query parameters,
`Cache-Control: no-store`, no validator (so no 304 can cross identities), `content-length` set,
HEAD identical minus the body.

Body:

```json
{ "schemaVersion": 1, "runtimeRole": "hub", "hubVersion": "…", "origin": "…|null",
  "providers": [{ "name": "", "adapter": "", "authMode": "key|forward|oauth|local|null",
                  "hasCredential": false, "disabled": false }],
  "oauth": [{ "provider": "", "loggedIn": false }],
  "subagentModels": [], "claudeCode": { "enabled": true } }
```

`hasCredential` is the `!!p.apiKey` presence projection `GET /api/providers` already ships.
`loggedIn` is `oauthLoginSummary`'s boolean with the **email and account id dropped, not masked**.
`buildHubState` constructs every row field by field and never spreads a provider or a login
record, which is what makes "no keys, no emails, no account ids" checkable by reading one
function — a spread would silently begin exporting whatever field is added to those records next.

The role gate 404s with its own `hub_state_not_a_hub` code unless `runtimeRole === "hub"`, so a
standalone or client install gains no surface at all. It runs **after** admission on purpose:
answering an anonymous caller would turn the route into a free "is that host a hub?" probe. The
distinct code also keeps `tests/server/api-key-attribution.test.ts` honest — it is what tells
"this host is not a hub" apart from "this build has no such route", and the latter would let every
accepted admission cell pass vacuously.

Bounded by construction (≤200 providers, ≤200 oauth rows, ≤32 roster entries, ≤200 chars per
string) plus a 64 KB ceiling that returns 507 `hub_state_too_large`. Deliberately **not** on
`loopbackRouteAllowed`: the unauthenticated loopback listener exists for inference wires the hub's
own local clients speak, a hub's own `ocx status` reads its config directly, and Ingwannu's review
note on #4236 is explicit that local management discovery goes to the authenticated surface.

### 2. Client side: `fetchHubState` + `resolveHubState` + a 0600 cache

`src/client/hub-client.ts` gains `fetchHubState`, beside `downloadClientCatalog` because it is the
same kind of call: bounded, schema-validated, unconditional GET with the per-client data key. A
404 surfaces as `hub_state_unsupported` — the version-skew case, which the CLI renders as
"upgrade the hub" rather than a bare code that reads like a client bug.

`src/client/hub-state.ts` owns the resolution and the cache. Every failure path — 404, 401,
unreachable, non-JSON, malformed JSON, foreign schema, future schema, oversized — lands on
`stateSource: "cache"` or `"unavailable"` with an operator-facing reason, and **none of them
reaches back into local config**. That substitution is the defect, not a graceful degradation: a
locally sourced report is byte-indistinguishable from a hub-sourced one.

The last good response is cached at `<OPENCODEX_HOME>/hub-state.json` through `atomicWriteFile`
(0600), stamped with the `(serverUrl, apiKeyId, connectedAt)` triple and compared with
`sameClientConnectionOwner`. A stale cache is still the *hub's* state; an unstamped one would be a
*different* hub's after a disconnect and reconnect, which is not staleness but a lie. Symlinked or
oversized cache files are refused rather than followed.

### 3. `ocx status`

`CliStatusJson` gains `runtimeRole` and an always-present `remoteHub` block —
`{ connected, origin, stateSource, reason?, fetchedAt?, ageSeconds?, hubVersion, providers, oauth,
subagentModels, claudeCodeEnabled }`. `schemaVersion` stays 1 (additive, same rule as
`versionSkew`), and `connection` is untouched: it describes the **link**, `remoteHub` describes
what is on the other end of it.

Human output on a connected client:

```
🔗 State from hub https://hub…:8443: provider credentials, logins and delegable models below are the HUB's, not this machine's.
✅ Proxy: running (PID …) (local)
   …
   OAuth logins (hub https://hub…:8443):
     xai        ✓ logged in
   Providers (hub https://hub…:8443):
     xai        openai-chat — no API key (authMode oauth)
   Delegable models (hub https://hub…:8443): xai/grok-4.6, gpt-5.6-sol
   Hub version: 2.51.0
   Local-only (not used for routing while connected):
   OAuth logins (local):
     xai        ✗ not logged in
```

When the hub cannot be read the banner becomes
`⚠️  Hub <origin>: state unavailable (<reason>) — provider and login lines below are LOCAL and do
not describe the hub.` and the local heading becomes `Local-only credential state (this is NOT the
hub's…)`. A cached read is labelled `cached Ns ago` rather than presented as live.

The banner is the **first** line of the report, above the proxy line, because the failure mode is
a reader taking the provider/login lines in isolation. `(local)` tags go on proxy, health,
dashboard, config, PID file, runtime, runtime source, default provider, Codex autostart, restart
safety, routing detail, service, shim and Codex runtime/version/source/home — and only while
connected, because on a standalone install every line is local and tagging them all would train
the reader to skip the tag.

`remoteHubBannerLine` and `remoteHubStatusLines` live in `src/cli/status.ts` so the sentences are
testable without spawning the CLI, matching `hubStatusLines` from PR4.

### 4. The Claude Code spawn surface

The `typeof route === "number"` gate is gone. `buildClaudeAgentDefs` and `injectClaudeAgentDefs`
take an explicit `rosterOverride`, defaulting to today's behaviour including "unset means the
defaults, an explicit `[]` means none". On a connected client `cmdClaude` passes the hub's roster
through `resolveHubRosterForClaude`; an unreadable hub falls back to the local list **and prints
a warning**, because an unannounced fallback is exactly how this stayed invisible.

`entryParts` already kept the raw id when a provider is absent from local `config.providers`, so
`xai/grok-4.6` yields `ocx-grok-4-6.md` on a credential-less client instead of reaching
`decodeRoutedModelIdOrThrow` and aborting the whole sync. That was latent and untested; it now has
a test.

`syncClaudeAgentDefsAtProxyStartup` uses the same roster from the **cache only** — startup makes
no hub round trip, so an offline hub cannot stand between an operator and a local proxy start.

### 5. `ocx config show`

`_remoteHub` is the **first** key on a client:
`{ connected, origin, note: "provider credentials and model availability live on the hub; run ocx
status" }`. It must be read before the empty `providers` map, not after it. `client.priorCatalog`
prints as `<omitted: N bytes>`, mirroring `sanitizeModelCostsForDisplay`.

Both are display-only. `config export` emits the real config untouched, so round trips still
validate; a persisted `client.note` was rejected because `clientConnectionSchema` is `.strict()`
and persisted prose drifts.

## Decisions

- **One data-plane read, not a widened `/api/*`.** The client holds only the per-client data key.
  The relay (`/api/machine/hub-relay/*`) is browser-only — it needs a local gui-session and
  forwards whatever hub key the browser supplies — so it is not a CLI channel. Ingwannu's review
  note forbids adding `/api/*` to the unauthenticated listener or copying an admin credential into
  exported client configuration, and this does neither.
- **Booleans only, forever.** Provider *names* already leak through `/v1/catalog` slugs, so the
  delta this route adds is `hasCredential` and `loggedIn`. Emails, account ids, quotas and usage
  must never be added: a data key opens this.
- **`authMode` is included** even though it was not in the original sketch. Without it
  `hasCredential: false` on an OAuth provider reads as "not configured" — the precise inference
  that went wrong. It is shape, not secret.
- **The five-row roster cap stays.** It is a Claude Code picker constraint (the Agent tool's model
  argument is a 4-alias enum and the picker shows five rows), not the bug; sourcing the five from
  the wrong machine was. The operator's "only 5 delegable models" is fixed by making those five
  the hub's, and the hub can now change which five without touching the client.
- **`stateSource` is three-valued, and "unavailable" is a reportable outcome.** A two-valued
  ok/failed flag would have invited the same silent local fallback at the next call site.
- **An always-present `remoteHub` object** rather than `null` when disconnected, so a consumer
  never branches on the key existing; `connected: false` carries it.
- **The cache write is a side effect of `ocx status`.** Accepted deliberately: without it an
  offline hub leaves a client with no hub facts at all, and the alternative (fetch-on-demand only)
  makes `ocx claude` useless on a flaky link. The file is 0600, owner-stamped, and holds nothing
  secret.
- **No loopback-listener allowlist entry.** Default per the plan; a hub reads its own config
  directly and has no use for the route.
- **`src/server/management/route-registry.ts` untouched.** That registry declares `/api/*`
  management routes; `/v1/catalog` and `/v1/models` are not in it either. The `AUTH_MATRIX` row is
  the data-plane declaration, and it is driven against a real request by
  `tests/server/api-key-attribution.test.ts`.

## Verification (exact commands, this branch)

```
bun x tsc --noEmit                                                      # clean
bun run privacy:scan                                                    # Privacy scan passed
bun test tests/server/v1-hub-state.test.ts                              #  8 pass 0 fail
bun test tests/server/api-key-attribution.test.ts                       # 25 pass 0 fail
bun test tests/clients/client-hub-state.test.ts                         # 20 pass 0 fail
bun test tests/cli/cli-status-hub-state.test.ts                         # 12 pass 0 fail
bun test tests/cli/cli-status-json.test.ts                              # 53 pass 0 fail
bun test tests/cli/cli-config-show-client.test.ts                       #  6 pass 0 fail
bun test tests/cli/cli-config-command.test.ts                           #  2 pass 0 fail
bun test tests/cli/cli-transport-honesty.test.ts                        # 22 pass 0 fail
bun test tests/claude-integration/claude-agents-inject-client.test.ts   # 14 pass 0 fail
bun test tests/claude-integration/claude-agents-inject.test.ts          # 20 pass 0 fail
bun test tests/claude-integration/claude-agent-startup-sync.test.ts     #  9 pass 0 fail
bun test tests/claude-integration/claude-cli.test.ts                    # 51 pass 0 fail
bun test tests/server/management-route-registry.test.ts                 # 13 pass 0 fail
bun test tests/ci-workflows/docs-remote-hub-claims.test.ts              #  7 pass 0 fail
bun test tests/test-layout.test.ts tests/test-layout-tooling.test.ts    # 17 pass 0 fail
```

`bun test tests/server/server-auth.test.ts` is 111 pass / 1 fail — `native passthrough upstream
reset still logs 502 and penalizes the pool`, the same pre-existing failure PR4's devlog (040)
recorded on this exact base. Not a regression; this PR touches one declarative array in
`src/server/auth-cors.ts` and adds a route block to `src/server/index.ts`.

Four new test files, registered in `scripts/test-layout/layout.json` (`explicit`) and
`tests/fixtures/test-layout-expected.json`:

- `tests/server/v1-hub-state.test.ts` — 401 before the role is disclosed, 200 with the data key,
  HEAD, cross-origin 403, 404 on `standalone` and on an absent role, POST refused, and a
  **serialized-body secret scan** with a real-looking provider key and a real-looking OAuth
  credential (access, refresh, email) configured.
- `tests/clients/client-hub-state.test.ts` — every failure mode of the fetch, cache freshness and
  age, owner mismatch, rotated `apiKeyId`, malformed and symlinked cache files, and that a
  missing token never becomes a live read.
- `tests/cli/cli-status-hub-state.test.ts` — the banner and block sentences, plus three spawned
  `ocx status` runs: a live local fake hub (which asserts the client presents its own data key),
  an unreachable hub, and a standalone machine whose output gains no banner and no `(local)`.
- `tests/claude-integration/claude-agents-inject-client.test.ts` — the hub roster drives the defs,
  `xai/grok-4.6` with no local `xai` provider does not throw, the cap still applies, the
  `generated-by: opencodex` marker still protects a user-authored `ocx-*.md`, `injectAgents: false`
  still prunes, and the announced fallback is announced.

No repository-wide suite (operator instruction); hosted CI at the pushed head is the proof.

### Live-hub safety

This machine is a live OpenCodex hub. `ocx service …`, `ocx start/stop/ensure/sync/restore/connect/
disconnect` and `launchctl` were **not** run, and the real `~/.opencodex`, `~/.codex`,
`~/.claude/agents` and `~/Library/LaunchAgents` were not touched. Every test sets
`OPENCODEX_HOME` to a `mkdtemp` directory; `tests/preload.ts` arms `OCX_TEST_HOME_GUARD=1` for
every invocation including a bare `bun test <file>`.

## Left undone

- **ko docs.** The paragraph landed in `docs-site/src/content/docs/guides/remote-hub.md` (en)
  only, as scoped. The Korean copy still describes a client that reports its own state.
- **`GET /api/machine/hub-state` on the client's own listener**, so the local dashboard sees the
  same data without a hub gui-session. Sketched in the plan as optional; not built.
- **A `loggedIn: false` hub provider cannot be distinguished from one the hub has never
  configured** in the `oauth` array, because `oauthLoginSummary` enumerates every known OAuth
  provider. That matches what a hub operator sees locally, so it is consistent rather than wrong,
  but a `configured` boolean would be clearer.
- **Staleness policy.** A cached hub state has no expiry; it is reported with its age and the
  reader decides. A TTL that flipped `cache` to `unavailable` after N minutes would need a
  defensible N.
- **`ocx doctor`** still reports local provider/login state on a client. Same class of defect,
  separate surface.
