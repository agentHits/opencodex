# Adjacent Kiro result coalescing

Depends on task-input; class C3. Fix #3734 from recorded Codex code-mode output shape, never by spending live Kiro quota.

## Diff-level change map
- MODIFY src/adapters/kiro.ts pushUser/turn-construction helper: when adding results in immediately adjacent parsed messages, tracked separately from collapsed user turns, combine only adjacent results with identical normalized toolUseId. Append content in exact input order and propagate error if any constituent is error. Preserve images via the adapter's supported representation; ensure no image is dropped or reordered relative to supported content semantics.
- Preserve the pendingToolUses.delete validation: call-a, call-b, call-a remains invalid. Do not globally deduplicate by id or merge across assistant/tool boundaries, intervening ordinary input, or unrelated result.
- MODIFY tests/providers/kiro/kiro-adapter.test.ts and relevant kiro-images.test.ts fixtures for three adjacent results, error later in group, different ids and nonadjacent repeats, text+image preservation. No new fixture uses real call ids or messages.
- MODIFY docs-site/src/content/docs/reference/adapters.md and structure/04_transports-and-sidecars.md with narrow multi-output contract.

Before: pushUser appends each result, wire validation consumes the first matching toolUseId and rejects the next duplicate. After: consecutive same-call outputs become one ordered result before validation. Opaque encrypted output rejection remains unchanged.

## Activation / verifier
CI tests feed one assistant exec call followed by notify/notify/final results; assert one toolResult and ordered content. Mixed error/success reduces to error; unrelated result boundaries cannot be crossed. Same-id nonadjacent repeat still throws matching error. Exercise retained images using existing adapter representation; enforce maximum/shape constraints already owned by Kiro wire. Run existing Kiro adapter/image suites through ci.yml, plus full typecheck/privacy. Saved local log shape is supporting evidence only; live Kiro correctness remains untested and explicitly reported.

## Non-goals
No Kiro account/OAuth/quota changes, no aggressive malformed-history healing, no parser changes beyond prior layer, no global result deduplication.


## Source follow-up folded at roadmap lock
Track adjacency in original message iteration; reset on every non-toolResult message including user/developer/assistant, even if pushUser collapses it into one user turn. Retain Kiro images on the current user image list as the existing wire format requires; do not promise unsupported text/image interleaving in the wire. Preserve Co-authored-by: Yrlan <71253160+yrlan-montagnier@users.noreply.github.com>. Local log metadata contains old Kiro activity and is not a current live reproduction.

## Kiro-cycle P refresh on parent b24ed35a
Parent #3743 is verified and ready, still open as this branch base; fixture prerequisite #3745 is merged. Issue #3734 remains open without an author PR. kiroPayloadMessages currently returns parsed.context.messages unchanged, so tracking adjacency at the top of its loop observes original Ocx message barriers even when a reasoning-only assistant is later skipped or user/developer turns collapse.

Concrete source edits in src/adapters/kiro.ts only: priorCalls values retain rawId alongside wireName; validate each result against that exact raw id after normalizing for wire lookup. This rejects different raw ids sharing a replacement/truncation result without banning legitimate paired non-wire ids. Track adjacentRawToolResultId, reset it for every non-toolResult before any early continue; for matching adjacent raw id and last user turn/last wire result, append text content and images, set status error if any constituent isError. Otherwise retain pushUser and final conversation validation. No global dedup, cross-turn merge or normalizer change.

MODIFY tests/providers/kiro/kiro-adapter.test.ts only for regressions: parse a real Codex custom_call plus three adjacent custom outputs (optionally preceded by the parent external task input), assert one ordered result; error remains sticky and images survive including image-only later output; single-result control; A/B/A and user/developer/assistant/reasoning-only barriers reject. Raw-id controls cover pipe/underscore, whitespace, truncation and case mismatches; exact raw pairs still normalize and merge. Keep every orphan/encrypted and catalog test. No new test/layout files.

MODIFY docs-site/src/content/docs/reference/adapters.md Kiro section and structure/04_transports-and-sidecars.md with this bounded contract. Preserve Co-authored-by: Yrlan <71253160+yrlan-montagnier@users.noreply.github.com>. Resolve roadmap review thread PRRT_kwDOS-0Gi86fozIF only after the raw identity fix is verified.

Local evidence limit: saved Kiro conversation data and OCX diagnostic artifacts were inspected for field shapes only; no current Codex multi-output Kiro trace was available. No raw message, id or credential was emitted, and no live Kiro request was made. Synthetic CI fixtures are protocol regression evidence, not a field-success claim.

Dispatch: main owns adapter/docs; bounded worker owns only kiro-adapter.test.ts. Independent A/C reviewers inspect raw identity, original-message adjacency, error/image propagation and unchanged encrypted rejection. Full runtime CI is remote only, including existing Kiro image/adapter tests; live Kiro is forbidden.
