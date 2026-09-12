# L1: content-free Codex WS upstream stage instrumentation (#4191)

Class C2. Stack bottom, base `dev`. Branch
`codex/260912-ws-stage-instrumentation`. Diagnosis instrumentation only:
no behavior change to success paths, no retry/fallback change.

## Problem

#4191 fails as WS 1006 or "response prelude timed out" only through the
proxy. The content-free stage record already exists as
`CodexWsFailureStage` (src/server/responses/codex-ws-wire.ts:100-144) and
`failureStage()` (src/server/responses/codex-ws-exchange.ts:148-159), but
it is only interpolated into failure message strings. Durable logs keep
neither the message nor a typed code: the eager relay collapses stream
errors to `upstream_reset` + `streamAborted`
(codex-ws-wire.ts:225-228; src/server/relay.ts; src/server/request-log.ts).
Operators therefore cannot distinguish create-frame size, send failure,
prelude stall, and upstream close from each other after the fact.

## Contract (from #4191 + maintainer bounds)

Record, per upstream exchange: create-frame bytes, send completion,
close code (numeric only), elapsed ms and first-frame ms, frame counters
(upstream/control/relayed, pings/pongs), pool reuse boolean, OCX version,
Bun runtime version, originator only when already present. Never record
conversation text, headers, close-reason text, or account identifiers.
No `responseCommitted === false` auto-retransmit fallback.

## Changes

MODIFY `src/server/responses/codex-ws-wire.ts`
- Extend `CodexWsFailureStage` with `closeCode: number | null` and
  `reused: boolean`; extend the privacy comment to state the new record
  is numeric/boolean only and close-reason text stays out of durable logs.
- No renderer change required beyond carrying the new fields.

MODIFY `src/server/responses/codex-ws-exchange.ts`
- Snapshot `failureStage()` once at each settle site — `armSilence`
  (206), connect-deadline `cancelExchange` (246-256), `onClose`
  (415-426), `onError` (429-437) — and hand the snapshot plus
  `closeCode`/`reused` to the request-log context through a new
  `recordCodexWsStage` sink on the log context (below).
- On the happy path record the same snapshot once at `commitResponse`
  (160-170) so successful exchanges also carry first-frame timing.
- `sent` keeps its current meaning ("send returned"); the record must not
  claim kernel flush. No control-flow change at any site.

MODIFY `src/server/request-log.ts`
- Add optional `codexWsStage` to `RequestLogContext` (56) holding the
  snapshot fields above plus `ocxVersion` and `bunVersion`; expose
  `recordCodexWsStage(stage)` next to `recordFirstOutput` (470-481).
- Include the field in the serialized attempt/log payload so `/api/logs`
  keeps it. Content-free fields only; the payload gains no strings beyond
  semver/version values.

MODIFY `src/server/relay.ts`
- Where stream errors collapse to `upstream_reset`, preserve
  `codexWsStage` on the attempt record (the collapse stays; the typed
  stage rides alongside).

MODIFY `src/server/responses/codex-ws-session.ts` (only if needed)
- Expose `reused` for the stage snapshot (already on the session, 21);
  no pooling change.

Versions: OCX `VERSION` is imported the same way
src/server/management-api.ts:87-93 does; Bun version via
`currentBunRuntimeIdentity()` (src/server/responses/ws-upstream.ts:26).
Client CLI version is not on the handshake (`user-agent` is not in
FORWARD_HEADERS, src/adapters/openai-responses.ts:43-61) — record
`originator` only when already present, and document the limitation in
the PR.

## Tests (red-first)

MODIFY `tests/responses/ws-failure-stage.test.ts`
- Stage record carries closeCode/reused/versions; reason text never
  appears in the durable record.
MODIFY `tests/responses/ws-upstream.test.ts`
- 1006 path and prelude-timeout path persist `codexWsStage` on the log
  attempt; happy path records once at commit.
MODIFY or NEW `tests/server/request-log*.test.ts` (per layout.json domain
for request-log; add layout.json explicit + expected-fixture entries if
NEW)
- Serialization keeps the stage; payload stays free of reason/body/header
  strings.

## Out of scope

Any WS behavior fix, SSE-fallback policy change, prelude-timeout tuning
(#3976/#4083), pool policy, inbound client-socket metrics
(codexWebSocketAdmissionMetrics is the client side — do not touch).
