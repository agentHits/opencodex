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
      { toolName: "exec" },
    )).toContain("bare marker line `*** Begin Patch`");
  });

  test("leaves non-exec tools, shell bridges, foreign namespaces, non-matching text and already-annotated text alone", () => {
    expect(annotateCodeModeHostFailure("expects a string input", { toolName: "read_file" })).toBeUndefined();
    // Flat shell bridges never run the isolate, so the four strings cannot be theirs.
    expect(annotateCodeModeHostFailure("expects a string input", { toolName: "exec_command" })).toBeUndefined();
    // A foreign MCP server's own exec is not Codex's, even when its output quotes the phrase, and a
    // namespace that merely CONTAINS the provider name is still foreign.
    expect(annotateCodeModeHostFailure("expects a string input", { toolName: "exec", toolNamespace: "mcp__docker" })).toBeUndefined();
    expect(annotateCodeModeHostFailure("expects a string input", { toolName: "exec", toolNamespace: "mcp__foreign-opencodex-responses" })).toBeUndefined();
    // Codex's own display namespaces and flattened aliases for the same code-mode tool still count.
    for (const options of [
      { toolName: "exec", toolNamespace: "opencodex-responses" },
      { toolName: "exec", toolNamespace: "mcp__opencodex-responses" },
      { toolName: "mcp__opencodex-responses__exec" },
      { toolName: "mcp_opencodex-responses_exec" },
    ]) {
      expect(annotateCodeModeHostFailure("expects a string input", options)).toContain("[recovery:");
    }
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

