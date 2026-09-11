# Phase 4 — API keys gain proactive selection

Base: dev directly. This layer is NOT in the chain: key-failover shares no module
with the OAuth kernel, and an API key is a different identity from an OAuth
account set. The A-phase audit reparented it here.

## Thesis

API-key pools get a proactive strategy before the first attempt, while keeping
the existing reactive 429 and 401 rotation as the fallback.

## Current behaviour (verified on dd9a2906b)

src/providers/key-failover.ts is reactive only. hasKeyPoolFailover (:98-101)
requires authMode not oauth or forward and apiKeyPool length at least 2.
Selection is a circular index walk in rotateKeyAfterFailure (:220-233) starting
from the failed entry, skipping cooled keys. Cooldown state is a local map
(:19-53) keyed by provider and key id. Wrappers: rotateKeyOn429 (:269-278),
rotateKeyOn401 (:288-296), rotateProviderTransportOn429 (:322-338).

src/providers/api-keys.ts listProviderApiKeys (:62-80) returns the pool and an
activeId with no strategy. src/types/provider.ts:384-389 defines apiKeyPool as
id, key, label and addedAt only.

The pre-dispatch hook points are in src/server/responses/core.ts: :4188-4190
(refreshDispatchAdapter calling resolveCurrentProviderApiKeyTransport) and
:4437-4444 (resolveProviderTransport after OAuth resolution). The OAuth side has
preferredInitialAccount at :4335-4340 with the comment that it prefers a known
headroom account before the first attempt; API keys have no analogue.

## Change surface

MODIFY src/types/provider.ts - add an optional per-provider key-pool strategy
field. Do not reuse the OAuth account-pool field names; these are different
identities and phase 5 owns the operator surface.

MODIFY src/providers/key-failover.ts - add a proactive selector invoked from the
pre-dispatch sites, supporting round-robin and a rate-limit-aware order. Keep
:220-233 exactly as the 429 and 401 fallback.

MODIFY src/server/responses/core.ts at :4188 and :4437 to consult the selector
before the first attempt. The mid-retry resolveProviderTransport calls at :4119,
:5399, :5503 and :7346 stay recovery paths and are not touched.

## Policy difference from OAuth pools, stated deliberately

Key rotation is a rate-limit scheduling problem: keys usually share an account or
organization, so moving key costs little cache. Subscription accounts lose their
prompt cache on every move. That is why phase 3 puts affinity ahead of quota for
accounts and this phase does not for keys.

## Security

key-failover already logs failedId and candidateId. The new selector must not
inherit that shape, and must log no key identity. privacy:scan stays green.

## Tests

A configured round-robin strategy changes the first-attempt key; the reactive 429
and 401 walk still works when the strategy is unset; a cooled key is skipped by
both paths; a single-key pool is a no-op.

## Out of scope

No operator-visible surface. Phase 5 owns the management route and GUI; adding
fields there from this layer would collide with it.

## wp4b wiring plan (re-verified against `codex/generic-pool-kernel`)

#4277 shipped `selectProactiveApiKey` (`src/providers/key-failover.ts`:128) and deliberately
stopped there: the picker exists, is unit-tested, and is called from nowhere in production. So
does `forgetApiKeyRotationCursor` (:112). This unit connects both, and nothing else.

| Symbol | File | Line |
|---|---|---|
| `selectProactiveApiKey` | `src/providers/key-failover.ts` | 128 |
| `forgetApiKeyRotationCursor` | `src/providers/key-failover.ts` | 112 |
| OAuth-only branch, skipped by key-auth | `src/server/responses/core.ts` | 4322 |
| transport pin, last `route.provider` write before the first send | `src/server/responses/core.ts` | 4450 |
| `activeProvider` bind | `src/server/chat-native.ts` | 238 |
| `PUT /api/providers/keys/active` | `src/server/management/oauth-account-routes.ts` | 674 |

### Where the call goes, and why there

`route.provider` is final for a key-auth request at the transport pin on `core.ts`:4450, and all
four first-send consumers read that same object — the image/video bridge (:6570), web search
(:6653), `runTurn` (:6739) and the generic HTTP path (:7174). One call placed after the OAuth
block and before the pin therefore serves every one of them, with no per-path duplication. That
is the exact position the OAuth side already occupies: "prefer the account with known headroom
BEFORE the first attempt" at :4344.

`chat-native.ts` is a separate entry path and needs its own call, immediately before
`activeProvider` is bound at :238.

Nothing competes with it. `resolveProviderTransport` never swaps keys, and
`applyCodexAuthContextToProvider` is a no-op outside `authMode: "forward"`. The one pre-send
`apiKey` rewrite that does exist (`core.ts`:4196) re-reads an already committed selection and
does not run on a current first attempt.

**No new import edge on the core path.** `core.ts` already imports `hasKeyPoolFailover` from
`../../providers/key-failover` at :269, so the picker joins an existing import — which matters
because `core.ts` is one of the three files that must never reach `src/lab`.

### Cursor invalidation

`forgetApiKeyRotationCursor` has no production caller, so the round-robin cursor currently
outlives the pool it describes. It joins `clearKeyCooldowns(name)` at the three management
routes that already reset key state: the manual active-key PUT at :674, and the add/remove key
routes at :641 and :714. An operator who just chose a key should not be second-guessed by a
cursor that predates the choice — the same rule wp1b and wp2b applied to the account pools.

### Scope boundary

No change to `selectProactiveApiKey` itself, to the reactive 429/401 rotation, or to the
strategy semantics. The picker already refuses to override a healthy committed key and already
returns null when no strategy is configured, so an install that never set `apiKeyPoolStrategy`
executes one predicate and nothing else.

### Acceptance

Criterion c-5 is already met by #4277 for the selection logic; this unit adds the evidence that
it reaches a real dispatch.

- `tests/server/server-key-failover-e2e.test.ts` is the only suite that drives a real
  first-attempt key-auth dispatch with an `apiKeyPool`, so it takes the new case: a two-key pool
  whose committed key is cooled, with `apiKeyPoolStrategy` set, must send the FIRST request on
  the other key. Red control: without the wiring the first attempt goes out on the cooled key and
  earns the 429 the runtime could already predict.
- A second case pins the no-op: with no `apiKeyPoolStrategy`, the committed key is used
  unchanged even when cooled, because rotation stays reactive-only for that install.
- A cursor case: a manual key selection through `PUT /api/providers/keys/active` clears the
  rotation cursor.

### Plan audit — FAIL, folded

**Blocker 1 — the picker does not mutate the route.** `selectProactiveApiKey` writes
`config.providers[name]` and RETURNS a clone; it never touches `route.provider`. The plan said
"wire the call" without saying what to do with the return, which is not implementable: a literal
reading leaves the live route on the cooled key and the whole unit is a no-op that still writes
config. The call site is:

```
const picked = selectProactiveApiKey(config, route.providerName, now);
if (picked) route.provider = picked;
```

**Blocker 2 — the assignment must land before the copies, not merely before the send.**
"One call serves all four consumers" is true only because nothing reassigns `route.provider`
between the pin and each consumer — but they do not all read it late. `adapterProvider` is
copied at `core.ts`:4458 and the adapter is bound at :4477, and the HTTP path captures
`builtInitialRequest` at :7139. So the assignment goes BEFORE :4450, ahead of every copy. The
audit also showed why this cannot be left to self-healing: the HTTP and `runTurn` paths can
re-read a stale selection through `refreshDispatchAdapter` (:4197), but the image bridge
(:6570) and web search (:6655) call `providerFetch(route.provider)` directly and have no such
second chance. Ordering is the entire correctness argument here.

**Major 1 accepted, with the reason recorded.** Putting the picker on the first-attempt path
means an ordinary request can now perform a persisted config write. It is bounded: the picker
returns null unless a strategy is configured AND the committed key is already cooled, so a
healthy install does one predicate and stops. The write goes through the same
`commitProviderApiKeySelection` / `mutatePersistedConfig` lock the reactive rotation uses, and a
later same-request 429 rotation serializes behind that lock rather than racing it. The cost is
paid exactly once per cooldown, replacing a request that was otherwise spent earning a 429 the
runtime could already predict.

**Major 2 — two first-send paths this unit does NOT cover, named rather than silently dropped.**
Native compact for `openai-apikey` (`src/server/responses/compact.ts`:669, dispatch at :745-883)
never enters `core.ts`, and the keyed `/v1/images` path (`src/server/images.ts`:701) reads
`candidates.keyed.apiKey` directly rather than a provider object. Each has a different
provider-resolution shape and needs its own dispatch harness, so they become their own
work-phase instead of riding along untested here. `collaboration.ts` and
`encrypted-payload.ts` are NOT affected: they import `rotateProviderTransportOn429` and
dispatch no first attempt.

**Minors folded.** The web-search fetch is `core.ts`:6655, not :6653 (that line is a comment).
The stale-selection re-read is :4197, not :4196. `src/server/management/provider-routes.ts`:832
and :931 also `clearKeyCooldowns` on key replace and delete, so the cursor reset belongs there
too — five routes, not three.
