# 030 — PR3: the hub's own local clients, two destination contracts

Unit: `devlog/_plan/260911_hub_single_port`. Stack position 3 of 4. Branch
`codex/260911-l4-hub-local-clients`, based on `codex/260911-l4-hub-loopback-companion`
(= `dev` + PR1 launchd repair + PR2 loopback companion). That base gained a review fix
(`0aca6afe4`, hub-gate conjunction + every all-zero hostname spelling) while this unit was being
written, so the branch was rebased onto it; there were no conflicts and every count below is from
the rebased tree. Issue:
lidge-jun/opencodex#4236 — the local-client follow-up table (eight hardcoded
`127.0.0.1:<public port>` sites) and the reviewer comment that they are **two** contracts.

PR2 closed the "Codex works but nothing else does" symptom for the *companion* form by moving the
socket instead of the call sites, and recorded the rest as open work: on a **ported** listener
(`{enabled:true, port:10104}`) the hardcoded callers still dialed the public port, and
`/v1/messages` plus `/api/claude-code` were not served on the listener at all. This unit closes
both halves — separately, because they are not the same surface.

## The two contracts

1. **Inference** — `localInferenceOrigin(config, publicPort)`: `http://127.0.0.1:<effective
   loopback port>` when `unauthenticatedLoopbackListener` is enabled, otherwise
   `http://127.0.0.1:<public port>`. That listener admits local callers with no credential, so
   nothing has to export one.
2. **Management** — `localManagementOrigin(config, publicPort)`: `http://127.0.0.1:<hub
   .managementIngress.port>` on a hub with the ingress enabled, otherwise
   `http://<probeHostname(hostname)>:<public port>`. The caller still sends the admin token;
   management authentication has no loopback bypass (`structure/05`), and the unauthenticated
   listener serves no `/api/*` — by design, not by omission.

Both live in `src/lib/local-destinations.ts`, one small module whose header states the split, next
to the existing `local-management-*` helpers. It reuses PR2's `effectiveLoopbackListenerPort` and
`probeHostname`; no call site repeats `?? port`.

## What shipped

### 1. Two inference wires on the unauthenticated loopback listener

`loopbackRouteAllowed` (`src/server/index.ts`) now admits `POST /v1/messages` (Anthropic wire:
`ocx claude`, Claude Desktop, the `system-env` injection) and `POST /v1/chat/completions` (OpenAI
chat wire: Cursor Private Inference, the routed vision helper, aside/opencode). Both handlers
already resolve admission from the RECEIVING listener's `RequestPolicyView` — the same resolver
and the same loopback short-circuit `/v1/responses` uses — so this adds a wire, not a trust level.
The allowlist comment says why, in the shape the existing entries use.

Nothing else was added: `/api/*`, `/healthz`, `/readyz`, the GUI and
`POST /v1/messages/count_tokens` all still 404 there.

One consistency fix rode along: the chat-completions branch finished its CORS with `config`
instead of the request's `policy`. On the public listener those are the same object, so this is a
no-op there; on the loopback listener it is the difference between CORS headers that match the
admission decision and headers derived from a bind address that did not receive the request.

### 2. Eight call sites, one resolver each way

| Site | Before | After |
| --- | --- | --- |
| `buildClaudeEnv` (`src/cli/claude.ts`) | `http://127.0.0.1:${publicPort}` | `localInferenceOrigin` |
| `fetchClaudeCodeState` | `http://127.0.0.1:${publicPort}/api/claude-code` | `localManagementOrigin` + admin token |
| `writeDesktop3pConfig` → `generateDesktop3pConfig` | public port | `localInferencePort(latest.config, port)` |
| `refreshGatewayModelCacheFromProxy` | public port | `localInferenceOrigin(options.admissionConfig, port)` |
| `injectSystemEnv` / `writeShellEnvFile` | public port | `localInferencePort` / `localInferenceOrigin` |
| Cursor gateway card | `http://127.0.0.1:${port}/v1` | `localInferencePort` |
| `resolveApiAccessBaseUrl` (final loopback fallback only) | `http://127.0.0.1:${port}/v1` | `localInferenceOrigin` |
| `routedDescribeBaseUrl` | public port | `localInferenceOrigin` |

Three consequences worth naming:

- **`targetsLocalClaudeProxy` takes a SET of ports.** The public port and the listener's port are
  both ours. Treating the one this launch did not pick as a foreign proxy would strip our own
  admission token out of the environment and silently downgrade the launch; the stale-replacement
  branch and `buildNativeClaudeEnv`'s shedding branch both use the set.
- **The gateway-model cache had to move with `buildClaudeEnv`.** Claude Code honors that file only
  while its `baseUrl` equals `ANTHROPIC_BASE_URL`; moving one without the other would have left
  the picker on a stale list.
- **`system-env` tracking now records two ports.** `port` stays the owning proxy's identity and
  its `/healthz` address; new optional `clientPort` records what was injected. Ownership on revert
  is proven against `clientPort ?? port`, liveness is still probed on `port` — the listener serves
  no `/healthz`, so probing the injected port would declare a live proxy stale and revert its
  environment. Records written before this field are unchanged, and no `clientPort` is written
  when the two ports are equal.

`resolveApiAccessBaseUrl` was touched ONLY in its last-resort loopback branch. Every branch above
it describes the address the *client* reached, and a remote caller must never be handed a port
that exists only on the hub's own 127.0.0.1.

### 3. Vision plan narrowing

`planVisionSidecar` hands `describeImageRouted` a narrowed config (`port`, `apiKeys`). The
listener field had to join it, or the resolver would have had nothing to resolve and the
self-fetch would have silently gone back to the closed port. A test pins the narrowing itself.

## Decisions

- **The reviewer's constraint is the design, not a caveat.** One base URL substituted everywhere
  would have meant either `/api/*` on the unauthenticated listener or an admin token in exported
  client configuration. Neither happens: the management resolver never returns the listener's
  port, and no exported configuration gained a credential.
- **`count_tokens` is NOT admitted.** Scope said the two wires and nothing else, so
  `POST /v1/messages/count_tokens` still 404s on the listener. Claude Code degrades to local
  estimation when that route is unavailable, so this is a cosmetic loss rather than a broken
  launch — but it is the one obvious follow-up candidate, and a test now pins the current answer
  so widening it is a deliberate act.
- **Desktop/Cursor/system-env resolve where the config is, not in the generator.**
  `generateDesktop3pConfig` stays a pure generator taking "the local port to dial";
  `writeDesktop3pConfig` resolves from the config it already re-reads under the mutation lock, so
  every caller gets the same answer and no caller has to be taught about listeners.
- **Cursor's `apiKeyMode` was left alone.** It still describes the public bind's admission rule.
  Pasting a credential into the unauthenticated listener is harmless; omitting one on a bind that
  demands it is not. Changing that copy is a GUI decision, not part of this fix.
- **A restart is required for the ported form.** Verified against the live hub: the running
  pre-PR3 proxy answers `404` for `POST /v1/messages` on `127.0.0.1:10104` while
  `GET /v1/models` is `200`. After this PR the same request is served, so operators on the ported
  form must restart (macOS: `launchctl kickstart -k gui/$uid/com.opencodex.proxy`) before
  `ocx claude` can use the listener. Noted for the PR4 docs unit.

## Verification (exact commands, this branch)

```
bun run typecheck                                                   # clean
bun run privacy:scan                                                # Privacy scan passed
bun test tests/server/loopback-listener-admission.test.ts            # 31 pass
bun test tests/server/loopback-listener-integration.test.ts          # 35 pass
bun test tests/lib/local-destinations.test.ts                        # 8 pass
bun test tests/server/loopback-companion-client-targets.test.ts \
  tests/claude-integration/claude-cli.test.ts \
  tests/claude-integration/claude-gateway-cache.test.ts \
  tests/clients/desktop-3p.test.ts                                   # 88 pass
bun test tests/server/system-env.test.ts \
  tests/server/api-access-endpoints.test.ts \
  tests/providers/cursor/cursor-integration-status.test.ts \
  tests/vision/vision-routed.test.ts \
  tests/claude-integration/claude-system-env-auto.test.ts            # 61 pass
bun test tests/claude-integration/claude-auth-detect.test.ts \
  tests/claude-integration/claude-auth-mode.test.ts \
  tests/claude-integration/claude-management-api.test.ts \
  tests/claude-integration/claude-shell-hook.test.ts \
  tests/cli/cli-management-auth.test.ts                              # 110 pass (with the one above)
bun test tests/clients/desktop-3p-guard.test.ts \
  tests/clients/desktop-remote-store.test.ts \
  tests/clients/sync-client-integrations.test.ts \
  tests/codex-integration/model-visibility-management-api.test.ts \
  tests/codex-integration/native-claude-desktop-toggle.test.ts       # 92 pass
bun test tests/providers/cursor/cursor-effort-rows.test.ts \
  tests/providers/xai/grok-lifecycle.test.ts \
  tests/server/api-keys-routes.test.ts                               # 85 pass
bun test tests/test-layout.test.ts tests/test-layout-tooling.test.ts # 17 pass
bun test tests/ci-workflows/docs-remote-hub-claims.test.ts           # 7 pass
```

New test file registered in `scripts/test-layout/layout.json` and
`tests/fixtures/test-layout-expected.json`: `tests/lib/local-destinations.test.ts` → `lib`.

Updated PR2's witness case in `tests/server/loopback-companion-client-targets.test.ts`: the
"ported form still splits the two" assertion was the record of the gap this unit closes, and now
asserts the agreement instead.

No repository-wide suite (operator instruction); hosted CI at exact head is the proof.

### Live acceptance (read-only, this machine)

`~/.opencodex/config.json`: `runtimeRole: hub`, `hostname: 127.0.0.1`, `port: 10100`,
`unauthenticatedLoopbackListener: {enabled:true, port:10104}`,
`hub.managementIngress: {enabled:true, port:10102}`. A read-only script (scratchpad, not
committed) loaded that config, probed liveness, and resolved both destinations — no config write,
no restart, no `repair`/`ensure`/`sync`:

```
live proxy port: 10100 | source: runtime
resolved management origin: http://127.0.0.1:10102
resolved inference origin:  http://127.0.0.1:10104
fetchClaudeCodeState enabled: true | windows: 264
ANTHROPIC_BASE_URL origin: http://127.0.0.1:10104
```

`enabled: true` is the acceptance case: before this unit that call dialed
`127.0.0.1:10100/api/claude-code` — which happens to answer on THIS host because the bind is
loopback, but returns nothing on a tailnet-bound hub, and `ocx claude` then launches native.

## Left for the rest of the stack

- PR4 (token UX + `ocx hub invite` + `ocx status` hub block) and the docs/skill unit own the
  operator-facing copy. The docs note that matters: restart after changing
  `unauthenticatedLoopbackListener`, and the ko copies of
  `reference/configuration/server.md` still describe only the ported form (PR2's note).
- `POST /v1/messages/count_tokens` on the listener: decide whether the Anthropic wire should be
  complete there. Currently pinned as 404.
- Cursor's `apiKeyMode` wording when the resolved base URL is the unauthenticated listener.
