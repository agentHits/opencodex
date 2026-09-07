# 020 — wp2: post-hoc annotation of host failures on exec results

Depends on 010 (the pre-call sentence names the same rules this half explains after the fact; the
two must share wording, which is why both live in one module). Class C2.

## MODIFY `src/adapters/exec-tool-result-normalize.ts`

Append after `CODE_MODE_HOST_CONTRACT_SENTENCE`:

```ts
/**
 * Post-hoc half of the host contract: the four host strings a routed model reads inside a
 * non-error exec result, each paired with the rule it broke. Markers are compared
 * case-insensitively because the host writes "Unsupported import in exec: <spec>" while
 * earlier Cursor guidance matched the lowercase form; one table, one owner, so the
 * recovery text can never drift from the pre-call sentence above.
 */
export const CODE_MODE_HOST_FAILURE_GUIDANCE: ReadonlyArray<{ marker: string; guidance: string }> = [
  {
    marker: "expects a string input",
    guidance: "tools.apply_patch takes exactly one string argument; pass the patch text itself, not an object such as {input: ...}.",
  },
  {
    marker: "the first line of the patch must be",
    guidance: "The patch string must begin at `*** Begin Patch` with no leading newline, indentation, or extra asterisks; start the literal on the marker line.",
  },
  {
    marker: "the last line of the patch must be",
    guidance: "The patch string must end with `*** End Patch` as its final line, with no trailing text or extra asterisks.",
  },
  {
    marker: "unsupported import in exec",
    guidance: "Imports are not available in this exec context; use the injected globals (tools, text, notify, store, load, ALL_TOOLS) instead.",
  },
];

const HOST_FAILURE_RECOVERY_PREFIX = "[recovery: ";

/**
 * Append a one-line recovery hint when an exec-bridge result carries a known host failure string.
 * Returns undefined when the result is not an exec-bridge tool, no marker matches, or a recovery
 * line is already present, so callers keep their own fallback and never double-annotate.
 */
export function annotateCodeModeHostFailure(
  text: string,
  options: { toolName?: string; toolNamespace?: string } = {},
): string | undefined {
  if (!isCodexExecBridgeTool(options.toolName, options.toolNamespace)) return undefined;
  if (text.includes(HOST_FAILURE_RECOVERY_PREFIX)) return undefined;
  const lower = text.toLowerCase();
  const hit = CODE_MODE_HOST_FAILURE_GUIDANCE.find(({ marker }) => lower.includes(marker));
  return hit ? `${text}\n${HOST_FAILURE_RECOVERY_PREFIX}${hit.guidance}]` : undefined;
}
```

The Cursor guidance string for the import row is kept byte-identical to today's
(`"Imports are not available in this exec context; use the injected globals instead."` extended with
the global list) so `cursor-toolresult-normalize.test.ts:101` (`"injected globals"`) still matches.

## MODIFY `src/adapters/responses-code-mode.ts`

Line 55 BEFORE:

```ts
const normalized = text === undefined ? undefined : normalizeEmptyExecToolResultText(text, { toolName: "exec" });
```

AFTER:

```ts
const normalized = text === undefined
  ? undefined
  : normalizeEmptyExecToolResultText(text, { toolName: "exec" })
    ?? annotateCodeModeHostFailure(text, { toolName: "exec" });
```

Import `annotateCodeModeHostFailure` on line 3. Empty-wrapper first: an empty result can never
carry a marker, so the order is only for clarity. Activation: paired `custom_tool_call_output`
whose text contains e.g. `\`apply_patch\` expects a string input`; observable effect: output ends
with `[recovery: tools.apply_patch takes exactly one string argument…]`, and `input[0]` (the
program) is the same object reference as before.

## MODIFY `src/adapters/kiro.ts`

Line 47 import: add `annotateCodeModeHostFailure`.

Lines 758-762 BEFORE:

```ts
const normalizedExecText = normalizeEmptyExecToolResultText(text, {
  toolName: tr.toolName,
  toolNamespace: tr.toolNamespace,
});
const resultText = normalizedExecText ?? (text.trim() ? text : KIRO_EMPTY_TOOL_RESULT_MESSAGE);
```

AFTER:

```ts
const execOptions = { toolName: tr.toolName, toolNamespace: tr.toolNamespace };
const normalizedExecText = normalizeEmptyExecToolResultText(text, execOptions)
  ?? annotateCodeModeHostFailure(text, execOptions);
const resultText = normalizedExecText ?? (text.trim() ? text : KIRO_EMPTY_TOOL_RESULT_MESSAGE);
```

`rawGroupText` (line 774) already keeps `text` whenever `normalizedExecText !== EMPTY_EXEC_OUTPUT_MESSAGE`,
so the adjacent-result grouping path carries the RAW failure text; the annotated text is what the
single-result path emits. Line 774 is changed so a grouped result carries the annotated text too:

BEFORE: `? text : undefined;`  AFTER: `? (normalizedExecText ?? text) : undefined;`

(For the empty-wrapper case `normalizedExecText === EMPTY_EXEC_OUTPUT_MESSAGE` short-circuits the
outer condition first, so that branch is unchanged.)

## MODIFY `src/adapters/cursor/tool-result-normalize.ts`

Import `CODE_MODE_HOST_FAILURE_GUIDANCE` from `../exec-tool-result-normalize`.

`RUNTIME_FAILURE_GUIDANCE` (lines 50-67): DELETE the `unsupported import in exec` entry and spread
the shared table instead:

```ts
const RUNTIME_FAILURE_GUIDANCE: ReadonlyArray<{ marker: string; guidance: string }> = [
  { marker: "SkyComputerUseError", guidance: "…" },
  { marker: "sky is not defined", guidance: "…" },
  { marker: "has already been declared", guidance: "…" },
  ...CODE_MODE_HOST_FAILURE_GUIDANCE,
];
```

Loop at line 109 BEFORE: `if (text.includes(marker))` AFTER: compare against `text.toLowerCase()`
for the shared rows only — simplest correct form is to lowercase both sides for every row, since the
three Cursor markers contain no case-sensitive collisions (`SkyComputerUseError` lowercased still
matches only itself). Cursor policy (`isError: true` on a match) is unchanged; the shared helper is
not used here because Cursor owns its `isError` decision.

## NEW `tests/adapters/exec-tool-result-normalize.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import {
  CODE_MODE_HOST_CONTRACT_SENTENCE,
  CODE_MODE_HOST_FAILURE_GUIDANCE,
  annotateCodeModeHostFailure,
} from "../../src/adapters/exec-tool-result-normalize";

describe("code-mode host failure annotation", () => {
  test.each(CODE_MODE_HOST_FAILURE_GUIDANCE.map(row => [row.marker, row.guidance]))(
    "annotates an exec result carrying %p", (marker, guidance) => {
      const text = `Script failed\nOutput:\nError: ${marker.toUpperCase()}`;
      const out = annotateCodeModeHostFailure(text, { toolName: "exec" });
      expect(out).toBe(`${text}\n[recovery: ${guidance}]`);
    });

  test("matches the host's real capitalisation for imports", () => {
    const out = annotateCodeModeHostFailure("Unsupported import in exec: node:fs", { toolName: "exec" });
    expect(out).toContain("injected globals");
  });

  test("leaves non-exec tools, non-matching text and already-annotated text alone", () => {
    expect(annotateCodeModeHostFailure("expects a string input", { toolName: "read_file" })).toBeUndefined();
    expect(annotateCodeModeHostFailure("all good", { toolName: "exec" })).toBeUndefined();
    const once = annotateCodeModeHostFailure("expects a string input", { toolName: "exec" })!;
    expect(annotateCodeModeHostFailure(once, { toolName: "exec" })).toBeUndefined();
  });

  test("every failure row is a rule the pre-call sentence already states", () => {
    // One owner, two halves: a model must never be told one thing before the call and another after.
    expect(CODE_MODE_HOST_CONTRACT_SENTENCE).toContain("exactly one string");
    expect(CODE_MODE_HOST_CONTRACT_SENTENCE).toContain("*** Begin Patch");
    expect(CODE_MODE_HOST_CONTRACT_SENTENCE).toContain("*** End Patch");
    expect(CODE_MODE_HOST_CONTRACT_SENTENCE).toContain("no `import`");
  });
});
```

Register: `scripts/test-layout/layout.json` → `explicit`: `"exec-tool-result-normalize.test.ts": "adapters"`
(alphabetical, after `"exec-…"` neighbours or before `"identity-…"`); same key in
`tests/fixtures/test-layout-expected.json`. `tests/test-layout-tooling.test.ts` names a missing one.

## Updated tests

`tests/responses/openai-responses-passthrough.test.ts` — add to the code-mode describe:

```ts
test("annotates a paired exec result that carries a host failure string", () => {
  const failure = "Script failed\nWall time 0.1 seconds\nOutput:\nError: `apply_patch` expects a string input";
  const body = raw(failure);
  const wire = JSON.parse(createResponsesPassthroughAdapter(routed).buildRequest(parseRequest(body)).body);
  expect(wire.input[1].output).toBe(`${failure}\n[recovery: tools.apply_patch takes exactly one string argument; pass the patch text itself, not an object such as {input: ...}.]`);
  expect(JSON.parse(wire.input[0].arguments).input).toBe(body.input[0].input);
});
```

`tests/providers/kiro/kiro-adapter.test.ts` — beside the `EMPTY_EXEC_OUTPUT_MESSAGE` case at
line ~336, add one toolResult with `toolName: "exec"` and content
`"The first line of the patch must be '*** Begin Patch'"`; assert the emitted Kiro tool-result
text ends with `[recovery: The patch string must begin at …]`.

`tests/providers/cursor/cursor-toolresult-normalize.test.ts` — line 101 row stays; add
`["Unsupported import in exec: node:fs", "injected globals"]` and
`["\`apply_patch\` expects a string input", "exactly one string"]` to the `test.each` table.

## Verification (C, hosted only)

NOT RUN locally. Hosted shards run the new and updated files; `tests/test-layout-tooling.test.ts`
proves registration. Activation for each conditional row is the marker-specific test above.

