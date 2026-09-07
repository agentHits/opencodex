# 010 — wp1: pre-call host contract sentence and its three injection sites

Depends on 000_plan.md. Class C2 (conventional slice across an existing shared module and its
three known consumers; no new abstraction, no new seam). Loop archetype satisfy-spec.

## MODIFY `src/adapters/exec-tool-result-normalize.ts`

Append after `CODE_MODE_RESULT_ECHO_SENTENCE` (line ~117):

```ts
/**
 * The host rules a routed model most often breaks on its first code-mode edit or wait, stated
 * BEFORE the call. Wording tracks the Codex host (0.153.2): `apply_patch` rejects a non-string
 * argument with "expects a string input" and a body whose first line is not the marker with
 * "The first line of the patch must be '*** Begin Patch'"; the isolate rejects ES imports with
 * "Unsupported import in exec"; a long command yields a session_id for write_stdin polling.
 * Live 2026-09-07: xai/grok-4.6 hit the first two, abandoned apply_patch for heredoc writes,
 * blocked a turn in a shell sleep loop, and died once on an import. None of that is a model
 * defect the proxy can repair (see devlog/_plan/260905_apply_patch_envelope_gap/010 MODE B);
 * it is a contract the proxy had not stated.
 */
export const CODE_MODE_HOST_CONTRACT_SENTENCE =
  "Host contract for the nested helpers: `tools.apply_patch(patch)` takes exactly one string, never an object such as `{input: ...}`; the string's first line must be exactly `*** Begin Patch` and its last line `*** End Patch` with no leading newline, indentation, or extra asterisks, so start the literal at the marker. The isolate has no `import`, `require`, or module loader — use only the `tools`, `text`, `notify`, `store`/`load`, and `ALL_TOOLS` globals. For a command that may outlive `yield_time_ms`, let `tools.exec_command` return a `session_id` and poll it with `tools.write_stdin({session_id, chars: \"\"})` on later calls instead of blocking a shell in a sleep loop.";
```

## MODIFY `src/adapters/tool-catalog-nudge.ts`

Line 7 import: `import { CODE_MODE_HOST_CONTRACT_SENTENCE, CODE_MODE_RESULT_ECHO_SENTENCE } from "./exec-tool-result-normalize";`

Line 124 code-mode branch. BEFORE (tail of the string):

```
... + CODE_MODE_RESULT_ECHO_SENTENCE + " Nested `tools.apply_patch(input)` is host-executed: ... rejected by Codex before the file is touched."
```

AFTER:

```
... + CODE_MODE_RESULT_ECHO_SENTENCE + " Nested `tools.apply_patch(input)` is host-executed: ... rejected by Codex before the file is touched. " + CODE_MODE_HOST_CONTRACT_SENTENCE
```

The flat-catalog branch (`If a listed tool exposes nested helpers…`) is unchanged: a shell bridge
echoes stdout and has no isolate, so the sentence would be false there.

## MODIFY `src/adapters/cursor/tool-guidance.ts`

Line 2 import: add `CODE_MODE_HOST_CONTRACT_SENTENCE`.

Line 190 (`codeMode ? CODE_MODE_RESULT_ECHO_SENTENCE + " There is no \`require\`, …"`). BEFORE:

```ts
codeMode
  ? CODE_MODE_RESULT_ECHO_SENTENCE + " There is no `require`, no `module`, and no filesystem or network globals; reach the host only through the nested helpers."
  : undefined,
```

AFTER:

```ts
codeMode
  ? CODE_MODE_RESULT_ECHO_SENTENCE + " There is no `require`, no `module`, and no filesystem or network globals; reach the host only through the nested helpers. " + CODE_MODE_HOST_CONTRACT_SENTENCE
  : undefined,
```

## MODIFY `src/adapters/responses-code-mode.ts`

Line 3 import: add `CODE_MODE_HOST_CONTRACT_SENTENCE`.

Instructions (line ~46). BEFORE:

```ts
instructions: instructions.includes(CODE_MODE_RESULT_ECHO_SENTENCE)
  ? instructions : [instructions, CODE_MODE_RESULT_ECHO_SENTENCE].filter(Boolean).join("\n\n"),
```

AFTER (idempotent per sentence, so a replayed body that already carries the echo sentence but
not the contract gains only the missing one):

```ts
instructions: appendMissing(instructions, [CODE_MODE_RESULT_ECHO_SENTENCE, CODE_MODE_HOST_CONTRACT_SENTENCE]),
```

with a module-local helper:

```ts
function appendMissing(instructions: string, sentences: readonly string[]): string {
  return sentences.reduce(
    (acc, sentence) => acc.includes(sentence) ? acc : [acc, sentence].filter(Boolean).join("\n\n"),
    instructions,
  );
}
```

The exec `input` parameter description (line 27) keeps only the echo sentence: it is a schema
string, and Kiro-style description limiters bound injected instructions, not parameter text, but
the contract is long and belongs in `instructions` where the existing test already asserts.

Activation scenario: any routed native Responses request whose visible catalog has a bare freeform
`exec` and no bare shell bridge, to a non-OpenAI destination, not a compaction request — the
exact gate at `responses-code-mode.ts:35-37`. Observable effect: `wire.instructions` ends with the
contract sentence.

## TESTS (updated in place; no new file in wp1)

`tests/adapters/tool-catalog-nudge.test.ts`
- In `"defines nested helper names as non-callable unless separately listed"` add:
  `expect(note).toContain(CODE_MODE_HOST_CONTRACT_SENTENCE);` and
  `expect(note).toContain("write_stdin({session_id, chars: \"\"})");`.
- In `"keeps the generic nested-helper parent-tool rule when exec is not listed"` add
  `expect(note).not.toContain("Host contract for the nested helpers");`.
- Import the new constant on line 7.

`tests/providers/cursor/cursor-tool-definitions.test.ts`
- In `"teaches the nested-helper contract instead of a top-level shell bridge"` (line ~754) add
  `expect(note).toContain("takes exactly one string");` and
  `expect(note).toContain("write_stdin");`.
- In `"keeps flat-catalog shell-bridge guidance when a bare bridge is advertised"` add
  `expect(note).not.toContain("Host contract for the nested helpers");`.

`tests/responses/openai-responses-passthrough.test.ts`
- `"first native request carries the echo rule…"` line 54 BEFORE:
  `expect(wire.instructions).toBe(\`Keep this instruction.\n\n${CODE_MODE_RESULT_ECHO_SENTENCE}\`);`
  AFTER:
  `expect(wire.instructions).toBe(\`Keep this instruction.\n\n${CODE_MODE_RESULT_ECHO_SENTENCE}\n\n${CODE_MODE_HOST_CONTRACT_SENTENCE}\`);`
- `"does not duplicate instructions…"` already asserts idempotence; add a case where the body's
  instructions already contain the echo sentence and assert exactly one contract sentence is appended.
- `"official OpenAI and non-code-mode catalogs remain untouched"`: add
  `expect(JSON.stringify(wire)).not.toContain("Host contract for the nested helpers")` inside the native loop.

`tests/providers/kiro/kiro-adapter.test.ts`
- In `"names ALL_TOOLS when a freeform exec is advertised…"` (line ~1817) add
  `expect(content).toContain("Host contract for the nested helpers");` — proves the sentence
  survives Kiro's `boundedInjectedInstruction` (16 384 chars) on the real wire prompt.

## Verification (C, hosted only)

NOT RUN locally by instruction. Hosted CI shards run the four files above; `gates` runs typecheck
and privacy scan. Evidence: `gh run list --branch codex/code-mode-host-contract` + `gh run view <id> --exit-status`.

