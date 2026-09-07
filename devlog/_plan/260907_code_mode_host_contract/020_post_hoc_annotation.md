# 020 — wp2: post-hoc annotation of host failures on exec results

Depends on 010 (same module, same wording). Class C2. Anchors verified against ec799db26 plus
the wp1 delta. Ends with an authorized push; the draft PR from wp1 picks up the new head.

## MODIFY `src/adapters/exec-tool-result-normalize.ts`

Insert after `CODE_MODE_HOST_CONTRACT_SENTENCE` (added in wp1):

```ts

/**
 * Post-hoc half of the host contract: the four host strings a routed model reads inside a
 * non-error exec result, each paired with the rule it broke. Matched case-insensitively because
 * the host writes "Unsupported import in exec: <spec>" while Cursor's earlier marker was
 * lowercase; one table, one owner, so this text and the pre-call sentence cannot drift.
 */
export const CODE_MODE_HOST_FAILURE_GUIDANCE: ReadonlyArray<{ marker: string; guidance: string }> = [
  {
    marker: "expects a string input",
    guidance: "tools.apply_patch takes exactly one string argument; pass the patch text itself, not an object such as {input: ...}.",
  },
  {
    marker: "the first line of the patch must be",
    guidance: "The patch string's first line must be the bare marker `*** Begin Patch` with no code fence, prose, or extra asterisks around it.",
  },
  {
    marker: "the last line of the patch must be",
    guidance: "The patch string's last line must be the bare marker `*** End Patch` with no trailing text or extra asterisks.",
  },
  {
    marker: "unsupported import in exec",
    guidance: "Imports are not available in this exec context; use the injected globals (tools, text, notify, store, load, ALL_TOOLS) instead.",
  },
];

const HOST_FAILURE_RECOVERY_PREFIX = "[recovery: ";

/**
 * Append a one-line recovery hint when an exec-bridge result carries a known host failure string.
 * Returns undefined when the tool is not an exec bridge, no marker matches, or a recovery line is
 * already present (a replayed annotated result must not grow a second one). Never touches error
 * status: the host already decided whether the call failed.
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

## MODIFY `src/adapters/responses-code-mode.ts`

Line 3 import gains `annotateCodeModeHostFailure`.

Line 55 BEFORE (6-space indent):
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
Activation: paired `custom_tool_call_output` whose text contains `\`apply_patch\` expects a string input`;
observable: output ends with the recovery line, `input[0]` is the same object reference.

## MODIFY `src/adapters/kiro.ts`

Line 47 BEFORE:
```ts
import { EMPTY_EXEC_OUTPUT_MESSAGE, normalizeEmptyExecToolResultText } from "./exec-tool-result-normalize";
```
AFTER:
```ts
import { EMPTY_EXEC_OUTPUT_MESSAGE, annotateCodeModeHostFailure, normalizeEmptyExecToolResultText } from "./exec-tool-result-normalize";
```

Lines 758-771 BEFORE (6-space indent):
```ts
      const normalizedExecText = normalizeEmptyExecToolResultText(text, {
        toolName: tr.toolName,
        toolNamespace: tr.toolNamespace,
      });
      const resultText = normalizedExecText ?? (text.trim() ? text : KIRO_EMPTY_TOOL_RESULT_MESSAGE);
      const images = extractKiroImages(tr.content);
      const toolUseId = normalizeToolId(tr.toolCallId);
      const call = priorCalls.get(toolUseId);
      if (!call || call.rawId !== tr.toolCallId) {
        throw new Error(`Kiro history contains an orphaned tool result for call ${JSON.stringify(tr.toolCallId)}`);
      }
      // Keep real whitespace and failed wrappers, but no empty-success wrapper boilerplate.
      const rawGroupText = text.length > 0 && (!text.trim() || normalizedExecText !== EMPTY_EXEC_OUTPUT_MESSAGE)
        ? text : undefined;
```
AFTER:
```ts
      const execOptions = { toolName: tr.toolName, toolNamespace: tr.toolNamespace };
      const normalizedExecText = normalizeEmptyExecToolResultText(text, execOptions);
      // A host failure string inside a non-empty exec result gets the rule it broke appended. This
      // is the only substitution the grouping path below also carries: whitespace and empty/failed
      // wrappers keep their existing raw policy.
      const annotatedExecText = normalizedExecText === undefined ? annotateCodeModeHostFailure(text, execOptions) : undefined;
      const resultText = normalizedExecText ?? annotatedExecText ?? (text.trim() ? text : KIRO_EMPTY_TOOL_RESULT_MESSAGE);
      const images = extractKiroImages(tr.content);
      const toolUseId = normalizeToolId(tr.toolCallId);
      const call = priorCalls.get(toolUseId);
      if (!call || call.rawId !== tr.toolCallId) {
        throw new Error(`Kiro history contains an orphaned tool result for call ${JSON.stringify(tr.toolCallId)}`);
      }
      // Keep real whitespace and failed wrappers, but no empty-success wrapper boilerplate.
      const rawGroupText = text.length > 0 && (!text.trim() || normalizedExecText !== EMPTY_EXEC_OUTPUT_MESSAGE)
        ? (annotatedExecText ?? text) : undefined;
```
`annotatedExecText` is defined only when `normalizedExecText` is undefined, i.e. the text is neither an
empty-success nor a failed-empty wrapper, so every existing grouping expectation
(`kiro-adapter.test.ts:1209` whitespace, `1252` raw failed wrapper) is unchanged by construction.

## MODIFY `src/adapters/cursor/tool-result-normalize.ts`

Imports (lines 12-18) gain `annotateCodeModeHostFailure`. `RUNTIME_FAILURE_GUIDANCE` (lines 50-67) and its
loop (lines 107-113) stay byte-identical: Cursor's marker semantics, case sensitivity and
`isError:true` policy are its own.

Lines 96-105 BEFORE (2-space indent):
```ts
  if (isCodexExecBridgeTool(options.toolName, options.toolNamespace) && isEmptyOrFailedExecWrapper(text.trim())) {
    return {
      // A `Script failed` wrapper is empty but NOT a success: reporting it as an empty success
      // would erase the only failure signal. Text classification stays separate from Cursor's
      // isError policy, which the Computer Use branch above owns.
      text: isFailedEmptyExecWrapper(text.trim()) ? FAILED_EXEC_OUTPUT_MESSAGE : EMPTY_EXEC_OUTPUT_MESSAGE,
      isError: false,
      changed: true,
    };
  }
```
AFTER (append one branch directly after that block):
```ts
  if (isCodexExecBridgeTool(options.toolName, options.toolNamespace) && isEmptyOrFailedExecWrapper(text.trim())) {
    return {
      // A `Script failed` wrapper is empty but NOT a success: reporting it as an empty success
      // would erase the only failure signal. Text classification stays separate from Cursor's
      // isError policy, which the Computer Use branch above owns.
      text: isFailedEmptyExecWrapper(text.trim()) ? FAILED_EXEC_OUTPUT_MESSAGE : EMPTY_EXEC_OUTPUT_MESSAGE,
      isError: false,
      changed: true,
    };
  }
  // A host failure string inside an exec-bridge result gets the rule it broke appended. The
  // helper is exec-gated and refuses already-annotated text, so a replayed result does not grow
  // a second line; Cursor's isError decision is left exactly as the caller passed it.
  const hostFailure = annotateCodeModeHostFailure(text, options);
  if (hostFailure !== undefined) return { text: hostFailure, isError, changed: true };
```
The existing `unsupported import in exec` row in `RUNTIME_FAILURE_GUIDANCE` still serves node_repl /
Computer Use tools; for exec-bridge tools the new branch runs first and carries the shared hint.

## NEW `tests/adapters/exec-tool-result-normalize.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import {
  CODE_MODE_HOST_CONTRACT_SENTENCE,
  CODE_MODE_HOST_FAILURE_GUIDANCE,
  annotateCodeModeHostFailure,
} from "../../src/adapters/exec-tool-result-normalize";

// Live host strings (Codex 0.153.2, probed 2026-09-07) and the rule each one names. The pre-call
// sentence and these rows are one contract in one module; a model must never be told one thing
// before the call and another after.
describe("code-mode host failure annotation", () => {
  test.each(CODE_MODE_HOST_FAILURE_GUIDANCE.map(row => [row.marker, row.guidance] as const))(
    "annotates an exec result carrying %p regardless of case",
    (marker, guidance) => {
      const text = `Script failed\nWall time 0.1 seconds\nOutput:\nError: ${marker.toUpperCase()}`;
      expect(annotateCodeModeHostFailure(text, { toolName: "exec" })).toBe(`${text}\n[recovery: ${guidance}]`);
    },
  );

  test("matches the host's real capitalisation and argument text", () => {
    expect(annotateCodeModeHostFailure("Unsupported import in exec: node:fs", { toolName: "exec" })).toContain("injected globals");
    expect(annotateCodeModeHostFailure("Script error:\ntool `apply_patch` expects a string input", { toolName: "exec" })).toContain("exactly one string");
    expect(annotateCodeModeHostFailure(
      "apply_patch verification failed: invalid patch: The first line of the patch must be '*** Begin Patch'",
      { toolName: "exec_command" },
    )).toContain("bare marker `*** Begin Patch`");
  });

  test("leaves non-exec tools, non-matching text and already-annotated text byte-identical", () => {
    expect(annotateCodeModeHostFailure("expects a string input", { toolName: "read_file" })).toBeUndefined();
    expect(annotateCodeModeHostFailure("expects a string input", { toolName: "exec_command", toolNamespace: "mcp__docker" })).toBeUndefined();
    expect(annotateCodeModeHostFailure("all good", { toolName: "exec" })).toBeUndefined();
    const once = annotateCodeModeHostFailure("expects a string input", { toolName: "exec" });
    if (!once) throw new Error("expected one annotation");
    expect(annotateCodeModeHostFailure(once, { toolName: "exec" })).toBeUndefined();
  });

  test("every failure row is a rule the pre-call sentence already states", () => {
    expect(CODE_MODE_HOST_CONTRACT_SENTENCE).toContain("takes exactly one string");
    expect(CODE_MODE_HOST_CONTRACT_SENTENCE).toContain("`*** Begin Patch`");
    expect(CODE_MODE_HOST_CONTRACT_SENTENCE).toContain("`*** End Patch`");
    expect(CODE_MODE_HOST_CONTRACT_SENTENCE).toContain("no `import`");
    expect(CODE_MODE_HOST_CONTRACT_SENTENCE).toContain("write_stdin");
    // Never shows the decorated marker as a copyable literal (same rule as the nudge tests).
    expect(CODE_MODE_HOST_CONTRACT_SENTENCE).not.toContain("*** Begin Patch ***");
  });
});
```

Register in `scripts/test-layout/layout.json` `explicit` between
`"empty-tool-output-annotation.test.ts": "adapters",` (line 620) and its successor:
`"exec-tool-result-normalize.test.ts": "adapters",`; same key/value in
`tests/fixtures/test-layout-expected.json` in alphabetical position. The name matches no regex seed
(`"adapters"` seed is `^(?:bridge\.test\.ts|buffered|identity|run|tool|translator)-`), so the explicit
entry is required and `tests/test-layout-tooling.test.ts` names it if missing.

## Updated tests

`tests/responses/openai-responses-passthrough.test.ts` — add inside the code-mode describe:
```ts
  test("annotates a paired exec result that carries a host failure string without touching the program", () => {
    const failure = "Script failed\nWall time 0.1 seconds\nOutput:\nScript error:\ntool `apply_patch` expects a string input";
    const body = raw(failure);
    const wire = JSON.parse(createResponsesPassthroughAdapter(routed).buildRequest(parseRequest(body)).body);
    expect(wire.input[1].output).toBe(`${failure}\n[recovery: tools.apply_patch takes exactly one string argument; pass the patch text itself, not an object such as {input: ...}.]`);
    expect(JSON.parse(wire.input[0].arguments).input).toBe(body.input[0].input);
    // Replayed history already carrying the hint is not annotated twice.
    const replayed = raw(wire.input[1].output);
    expect(normalizeResponsesCodeMode(replayed, parseRequest(replayed), routed)).toBe(replayed);
  });
```

`tests/providers/kiro/kiro-adapter.test.ts`
- After `"an empty code-mode exec result carries the actionable reason…"` (line 323) add:
```ts
  test("a code-mode exec result carrying a host failure string names the broken rule", async () => {
    const execTool = { name: "exec", description: "Run JavaScript", parameters: { type: "object" } };
    const failure = "apply_patch verification failed: invalid patch: The first line of the patch must be '*** Begin Patch'";
    const messages = [
      { role: "user", content: "run it" },
      { role: "assistant", content: [{ type: "toolCall", id: "call-x", name: "exec", arguments: {} }] },
      { role: "toolResult", toolCallId: "call-x", toolName: "exec", content: failure, isError: false },
    ];
    const { body } = await createKiroAdapter(provider).buildRequest(parsedWith(messages, [execTool]));
    const resultText = JSON.parse(body).conversationState.currentMessage.userInputMessage
      .userInputMessageContext.toolResults[0].content[0].text;
    expect(resultText).toBe(`${failure}\n[recovery: The patch string's first line must be the bare marker \`*** Begin Patch\` with no code fence, prose, or extra asterisks around it.]`);
  });
```
- In the grouped-result table (the `execResult` cases around lines 1195-1262) add one case:
```ts
      {
        name: "host failure chunk in a multi group carries its recovery line beside raw siblings",
        id: "call-host-failure-multi",
        results: [execResult("call-host-failure-multi", "  "), execResult("call-host-failure-multi", "tool `apply_patch` expects a string input"), execResult("call-host-failure-multi", failedExecWrapper)],
        content: [{ text: "  " }, { text: "tool `apply_patch` expects a string input\n[recovery: tools.apply_patch takes exactly one string argument; pass the patch text itself, not an object such as {input: ...}.]" }, { text: failedExecWrapper }],
        status: "success",
        forbidden: [EMPTY_EXEC_OUTPUT_MESSAGE, FAILED_EXEC_OUTPUT_MESSAGE, KIRO_EMPTY_TOOL_RESULT_MESSAGE],
      },
```
  This drives the grouping path with whitespace, an annotated chunk and a raw failed wrapper in one
  group — the exact combination blocker 1 said the single-result test could not exercise.

`tests/providers/cursor/cursor-toolresult-normalize.test.ts` — add after the `test.each` runtime-failure table:
```ts
  test("an exec-bridge result carrying a host failure string gains the shared hint and keeps its isError", () => {
    const out = normalizeCursorToolResultText("Unsupported import in exec: node:fs", { toolName: "exec" });
    expect(out.changed).toBe(true);
    expect(out.isError).toBe(false);
    expect(out.text).toContain("[recovery: Imports are not available in this exec context");
    // Replay of the annotated text with isError=false must not grow a second line.
    expect(normalizeCursorToolResultText(out.text, { toolName: "exec" }).changed).toBe(false);
  });

  test("a non-exec tool whose successful output merely mentions a host phrase stays byte-identical", () => {
    const doc = "The docs say apply_patch expects a string input.";
    const out = normalizeCursorToolResultText(doc, { toolName: "read_file" });
    expect(out.changed).toBe(false);
    expect(out.isError).toBe(false);
    expect(out.text).toBe(doc);
  });
```

## Delivery for this phase

Stage only the files above (`git diff --cached --stat` first); commit `--no-verify`; push `--no-verify`.

## Verification (C, hosted only)

NOT RUN locally. Exact-head Cross-platform CI on the wp2 head; receipt via
`cxc receipt test --session <id> --cwd <worktree> -- gh run view <id> --exit-status`.

