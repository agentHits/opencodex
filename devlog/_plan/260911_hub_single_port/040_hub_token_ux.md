# 040 — PR4: data-plane token provisioning, `ocx hub invite`, the status hub block

Unit: `devlog/_plan/260911_hub_single_port`. Stack position 4 of 5 as actually built (PR1 launchd
repair, PR2 same-port loopback companion, PR3 Claude/local-client destinations — written
concurrently by another agent — this one, then the docs/skill PR). Branch
`codex/260911-l4-hub-token-ux`, rebased onto `codex/260911-l4-hub-loopback-companion` =
`0aca6afe4` (`fix(codex): report the hub gate only when the toggle is on, and refuse every
wildcard spelling`) after that branch grew a commit mid-work; every count below is from the
rebased tree, and the rebase was clean (no shared files). Issue: lidge-jun/opencodex#4236.

**Base discrepancy, recorded because it affects review.** The assignment described the base as
"dev + PR1 launchd fix + PR2 loopback companion". `git log babb76449..HEAD` on that branch shows
only the six PR2 commits; `src/service.ts` is untouched by it, and no
`devlog/_plan/260911_hub_single_port/010_launchd_repair.md` exists. So PR1 is **not** in this
branch's ancestry, and everything below was written and verified against dev + PR2 only. The
`src/service.ts` hunks here are all inside `assertNotAdminToken` /
`assertServiceAuthEnvironment` / `writeServiceApiTokenFile`, which the PR1 description (macOS
repair and status) does not name, so a later stack reorder should merge cleanly — but it has not
been proven against PR1's diff.

## The incident this closes

On the maintainer's hub the operator exported the **admin** token as
`OPENCODEX_API_AUTH_TOKEN`, because `ocx service install` refused to proceed without *a* token
and that was the token at hand. `assertNotAdminToken` then crash-looped the hub, and
`ocx service repair` demanded the same environment variable again — so the only remembered way
to make the command proceed was the exact thing that had broken it.

The refusal was right. The demand was the defect: `assertServiceAuthEnvironment` threw for any
non-loopback hostname with no env token, **even when `~/.opencodex/service-api-token` already
held a perfectly good one**. Nobody should have to export a token by hand to run a hub.

## What shipped

### 1. The service provisions its own data-plane token (`src/service.ts`)

`writeServiceApiTokenFile()` — still the single chokepoint every backend funnels through
(launchd, systemd, the Windows scheduler wrapper, WinSW native) — now resolves a token by
precedence instead of only copying the environment:

1. `OPENCODEX_API_AUTH_TOKEN` from the installing shell. Still refused outright when it is an
   admin token; an operator who deliberately exports a key keeps full control of it.
2. An existing owner-only `service-api-token`. **Reusing it is what makes `repair`, a reinstall
   and a restart idempotent** — regenerating would silently invalidate every client key exchange
   already performed against the old value.
3. 32 fresh random bytes, hex, written 0600 through the existing hardened writer
   (`recordOwnedConfigPath` → `mkdir 0700` → `writeFileSync mode 0600` → `chmod` →
   `hardenSecretPath` on Windows). This is the branch that removes the manual step.

It returns `{ path, origin: "env" | "file" | "generated" }` and logs the **path**, never the
value. A loopback install with no env token still gets nothing: admission is not required there,
and on a machine connected to a hub that same file holds the hub's issued client key, which a
local install must not invent or clobber.

`assertServiceAuthEnvironment` keeps exactly two refusals — the admin-token collision (checked
before the loopback short-circuit, unchanged) and a token file that exists but is `unsafe`, which
is reported here where the operator can still act rather than failing mid-install. The
"OPENCODEX_API_AUTH_TOKEN is required before installing…" throw is gone.

The admin-token message now says what to do: `` Run `unset OPENCODEX_API_AUTH_TOKEN` and rerun:
nothing needs to be exported by hand, because the service provisions its own owner-only
data-plane token at <path>. `` The old text offered "or set it to a distinct data-plane key",
which is how the operator got there.

### 2. A foreground `ocx start` accepts the file-backed token (`src/lib/service-secrets.ts`)

`assertServerAuthConfig` reads `configuredApiAuthToken`, which reads the environment — and under
a service the environment always has the token, because the launchd plist and the systemd unit
`cat` the file into it before exec. A foreground `ocx start` had neither, so it refused to bind a
non-loopback hostname the installed service on the same machine was serving happily.

New `startupDataPlaneToken(env, { authRequired })` applies the wrappers' own precedence in one
place: env wins, then `OCX_API_TOKEN_FILE` (WinSW native mode, the existing
`loadServiceTokenFromFile`), then the installed `service-api-token`. `handleStart` calls it with
`isApiAuthRequired(loadConfig())`.

`authRequired` is passed in rather than recomputed, for two reasons: this module must not load
config, and the installed file is deliberately **not** consulted on a loopback bind — the
connected-client case again. `assertServerAuthConfig` itself is unchanged, so no security-boundary
file moved: the fix is at the env-hydration layer the wrappers already occupy.

### 3. `ocx hub invite` (`src/cli/hub.ts`, new)

```
ocx hub invite [--json] [--data-url <origin>] [--management-url <origin>] [--clients codex,claude]
```

Prints the line to run on the other machine:

```
# Run on the other machine:
echo '<code>' | ocx connect <data-origin> --management-url <management-origin> --pairing-code-stdin
```

**No new management route was needed, and none was added.** The "connect pairing code" is exactly
a GUI pairing grant: `ocx connect --pairing-code-stdin` exchanges it at `POST /opencodex-session`
(`exchangeConnectPairingGrant`), and the mint is `POST /api/gui/pairing-grants` — the attested
local route `ocx gui pair` already drives, authorized by an HMAC over the running proxy's own
attestation secret from the owner-only runtime state file. So `invite` reuses
`requestBoundGuiPairingGrant` verbatim and needs **no admin token and nothing exported in the
shell**, which is strictly better than the admin-token path the plan sketched. `src/server/*` is
untouched by this PR.

Origins:

- data: `--data-url` → `hub.dataPublicOrigin` (new optional config) → `http://<bind>:<port>`.
- management: `hub.managementPublicOrigin`, and that is not negotiable — `createGuiPairingGrant`
  records it as the grant's `serverOrigin` and the exchange compares the request's management
  origin against it. `--management-url` is therefore accepted only when it *equals* the
  configured origin; a differing value is refused with both origins named, because printing it
  would hand out a code the hub then rejects.

Everything that cannot work is refused **before** a single-use code is minted: a non-hub
`runtimeRole`, a missing `hub.managementPublicOrigin`, a non-loopback plaintext management origin
(the hub's own `isPairingTransportPermitted` rule), a malformed `--data-url`, no running attested
proxy, and — the non-obvious one — a hub whose allow-list admits no loopback browser origin.
`ocx connect` sends `Origin: http://localhost:<its own port>` (`localGuiOrigin` in
`src/client/connect.ts`), so only `hub.managementPublicOrigin` itself or a loopback entry of
`corsAllowOrigins` can ever match the grant. `selectInviteBrowserOrigin` picks from exactly that
set — `http://localhost:10100` when admitted, else the first admitted loopback origin — and
otherwise says which `ocx config set corsAllowOrigins` line to run.

`--json` emits `{ code, expiresAt, dataUrl, managementUrl, command }` with `expiresAt` as ISO
8601. The code goes to stdout; the "secret, single-use" warning goes to stderr, matching
`ocx gui pair`.

### 4. New optional config `hub.dataPublicOrigin`

Same canonical-origin transform as `managementPublicOrigin` (http(s), no credentials, path, query
or fragment) and deliberately **not** `.catch`ed: silently dropping a typo would make `invite`
fall back to `http://<hostname>:<port>`, which is the value the field exists to replace. It is
advisory — the origin the hub advertises, never a bind address. It is its own field rather than a
derivation because on a real deployment the two are different sockets: management is a
loopback-only ingress published by Tailscale Serve on 443, data is the tailnet bind fronted on
its own port (`https://hub.tailnet.ts.net:8443`).

### 5. The `ocx status` hub block (`src/cli/status.ts`)

`collectHubStatus(config, listen, env)` adds a nullable `hub` field to `CliStatusJson`
(`schemaVersion` stays 1) and `hubStatusLines(hub)` renders it, so the sentences are testable
without spawning the CLI. On the maintainer's live hub:

```
   Hub:
     Data origin: http://localhost:10100 (derived from the bind address)
     Loopback listener: ported on http://127.0.0.1:10104 — a second port local clients must be pointed at
     Management ingress: http://127.0.0.1:10102
     Management origin: https://macmini.tail19a2d7.ts.net
     Data token: present (file) at <home>/.opencodex/service-api-token
     Invite a machine: ocx hub invite
```

The listener line distinguishes PR2's two forms through `effectiveLoopbackListenerPort` plus the
presence of an explicit `port`: `companion` ("same port as the public listener, no credential
needed locally"), `ported`, and `off`. The token line reports the SOURCE only —
`present (env)` / `present (file)` / `unsafe (file)` / `missing` — with `env` winning, because
that is the service's own precedence: the wrapper exports the file only when the environment has
nothing, so naming the file first would name a source the running process is not using. A test
asserts no token value appears in either the JSON or the lines.

### 6. Help, registry, capabilities, skill surface

`ocx hub` is a registry entry with a runner in `DISPATCH_COMMANDS`, two banner lines in
`printUsage`, and an `ocx help hub` topology paragraph (one port; companion listener; the token
file and that it is never copied; how invites work; `--json`). `ocx service` details gained five
lines on token auto-provisioning and the admin-token refusal. `ocx hub invite` is a declared
capability and `bun run skill:surface` regenerated
`skills/ocx/references/01_management_surface.md` (38 → 39 capabilities, 17 → 18 state-changing).

## Decisions

- **No new management route, and `src/server/index.ts` untouched.** See above: the route already
  exists and its authorization (process attestation) is better suited to a local CLI than the
  admin token. This also kept the PR entirely out of the other agent's files.
- **The `hub invite` capability declares `routes: []`.** It really does drive
  `POST /api/gui/pairing-grants`, but that route is answered in the composition root ahead of
  `handleManagementAPI`, so it is absent from `MANAGEMENT_ROUTES` and
  `tests/cli/cli-capabilities.test.ts` would fail the declaration. The omission is explained in a
  comment at the declaration rather than papered over; widening the registry's scanned scope to
  `src/server/index.ts` is its own change. `ocx gui pair`, which drives the same route, has no
  capability entry at all today.
- **`--management-url` is a confirmation, not an override.** The grant is bound to
  `hub.managementPublicOrigin`; an override that differs cannot work, so it is refused with both
  values named instead of printed.
- **`assertServerAuthConfig` was not touched.** The fix belongs where the wrappers already put
  the token (env hydration before bind), not in a per-request admission helper that would then
  read a file on every request.
- **An existing token is reused, never regenerated.** Rotation is `ocx connect rotate`'s job;
  an install that silently minted a new hub secret would break every connected client.
- **`writeServiceApiTokenFile` kept its name and became exported**, so the provisioning
  precedence is covered by behaviour tests rather than a source-oracle. The same identifier
  exists in `src/lib/service-secrets.ts` with a different signature; they are in different
  modules and a future collision inside `src/service.ts` would be a compile error, which is the
  desired failure mode.
- The `ocx hub invite` pairing code is printed to stdout, exactly as `ocx gui pair` prints its
  grant. `bun run privacy:scan` is green; no token value is logged anywhere this PR adds.

## Verification (exact commands, this branch)

```
bun x tsc --noEmit                                                 # clean
bun run privacy:scan                                               # Privacy scan passed
bun run skill:surface                                              # regenerated, then:
bun test tests/ci-workflows/skill-ocx.test.ts tests/cli/cli-registry.test.ts \
  tests/cli/cli-capabilities.test.ts                               # 45 pass
bun test tests/service/service.test.ts                             # 212 pass
bun test tests/service/service-secrets.test.ts                     # 10 pass
bun test tests/cli/hub-invite.test.ts                              # 16 pass
bun test tests/cli/cli-status-json.test.ts                         # 53 pass
bun test tests/server/config.test.ts                               # 196 pass
bun test tests/cli/cli-dispatch.test.ts tests/cli/cli-help.test.ts # 56 pass
bun test tests/cli/cli-transport-honesty.test.ts                   # 22 pass
bun test tests/cli/cli-json-contract.test.ts                       # 8 pass
bun test tests/cli/cli-start-journal-order.test.ts                 # 3 pass
bun test tests/config/config-user-edits.test.ts                    # 46 pass
bun test tests/providers/opencode-cli.test.ts                      # 51 pass
bun test tests/service/winsw.test.ts                               # 25 pass
bun test tests/test-layout.test.ts tests/test-layout-tooling.test.ts  # 17 pass
```

`bun test tests/server/server-auth.test.ts` is 111 pass / 1 fail on this branch **and on the
base with the working tree stashed** — `native passthrough upstream reset still logs 502 and
penalizes the pool` is a pre-existing failure, not a regression.

Run the service and winsw files one at a time. Passing
`tests/service/winsw.test.ts` in the same `bun test` invocation as
`tests/cli/cli-transport-honesty.test.ts` trips the real-home guard through cross-file
`OPENCODEX_HOME` leakage; that is true on the base too.

New test file registered in `scripts/test-layout/layout.json` and
`tests/fixtures/test-layout-expected.json`: `tests/cli/hub-invite.test.ts`. The hub status block,
the startup token precedence and the `hub.dataPublicOrigin` schema went into the existing
`tests/cli/cli-status-json.test.ts`, `tests/service/service-secrets.test.ts` and
`tests/server/config.test.ts`.

No repository-wide suite (operator instruction); hosted CI at exact head is the proof.

### Read-only checks against the live hub

`ocx service …`, `ocx start`, `ocx ensure` and `ocx sync` were not run, and the live config was
not modified. Two read-only commands were:

- `bun run src/cli/index.ts status` — rendered the hub block quoted above.
- `bun run src/cli/index.ts hub invite --json` — exited 1 with
  `No loopback browser origin is admitted for pairing. Add the connecting machine's local origin:
  ocx config set corsAllowOrigins '["http://localhost:10100"]'`, minting nothing. That hub has
  `hostname: 127.0.0.1` and no `corsAllowOrigins`, so the refusal is correct; the successful
  output was produced against an injected config and an injected mint.

## Left for the rest of the stack

- Docs PR: `guides/remote-hub.md` en + ko still tells the operator to
  `export OPENCODEX_API_AUTH_TOKEN="$(openssl rand -hex 32)"` before `ocx service install`. That
  step is now optional, and the guide should lead with `ocx hub invite` plus the new
  `hub.dataPublicOrigin` field in `reference/configuration/server.md`.
- A hub bound to a non-loopback address needs `corsAllowOrigins` to name the connecting machine's
  `http://localhost:<port>` before `invite` can mint. That is an existing property of
  `createGuiPairingGrant`, surfaced rather than changed here; whether a loopback client origin
  should be admitted implicitly is a pairing-policy question for its own change.
- `ocx hub` has exactly one subcommand. Further hub-side verbs (listing or revoking issued client
  keys from the CLI rather than the dashboard's **Integrations → API Keys**) are not in this PR.
