# wp2: xAI string child-result continuation

Depends on wp1 current outbound placement and full-history regression controls. C3. Issue #3907 posts string `agent_message.content`; #3942 already implements arrays for all non-forward destinations. Scope is the string residual only.

## File changes

- MODIFY `src/adapters/routed-agent-messages.ts`: extend `normalizeRoutedAgentMessages` with optional `{ allowStringContent?: boolean }`, default false. If enabled and content is a nonblank string, create one input_text part containing the exact original string. Existing attribution and array handling continue. Whitespace-only, unknown, malformed and ciphertext shapes remain unchanged; never trim the forwarded text or mutate the input.
- MODIFY `src/adapters/openai-responses.ts`: reuse `isXaiResponsesDestination` from `src/providers/xai-transport.ts`, pass its result as allowStringContent inside the existing `!forward` call. Existing array behavior stays available for other non-forward destinations. No custom-forward exception.
- MODIFY `tests/adapters/routed-agent-messages.test.ts`: exercise both exact xAI hosts, API-key and OAuth, exact text/newlines, attribution, missing transport item ID and input immutability. String controls: native/custom forward, other providers, lookalike hosts and blank content stay unchanged; existing all-parts array/ciphertext tests remain.
- MODIFY `tests/server/server-xai-responses-streaming.test.ts`: extend the synthetic server fixture with parent request, child request, then parent continuation containing string child result plus genuine paired tool history. Upstream stub rejects surviving private agent_message with 422; assert user-message child text, ordinary response completion, paired calls preserved and no repeated incompatible dispatch. This exercises the wire boundary, not the actual Codex scheduler.
- MODIFY `docs-site/src/content/docs/reference/adapters.md`, `docs-site/src/content/docs/reference/configuration/providers.md`, and the contradicting Russian adapters paragraph: describe existing non-forward array conversion and xAI string extension, preserving forward/encrypted exclusions. Sync `structure/04_transports-and-sidecars.md` without broadening the passive manifest claims.

## Before / after

Before the raw-body outbound normalizer requires array content and leaves the issue's string item on the strict xAI wire. After it produces `{type: message, role: user, content: [{type: input_text, text: originalText}]}` through the existing attribution rules, only for an approved non-forward xAI destination. No tool result is synthesized and no encrypted message is partially discarded.

## Verification

Pin parent/child fixtures to synthetic input. The strict upstream stub must reject the pre-fix request shape and accept the normalized one; destination-negative controls prove the guard is active. Hosted PR CI and final full dispatch execute adapter/server regressions. Local tests/install/typecheck/build remain NOT RUN. Source audit checks raw-body call placement and all consumers of the added option. There is no serialized configuration field or migration: option creation and consumption are both in-memory adapter calls.
