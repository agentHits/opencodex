import { describe, expect, test } from "bun:test";
import type { AdapterEvent } from "../../src/types";
import { guardQoderScaffolding } from "../../src/adapters/qoder/adapter";
import {
  QoderScaffoldFilter,
  QODER_SCAFFOLD_ERROR_CODE,
} from "../../src/adapters/qoder/scaffold-guard";

/**
 * #4190: the qoder route is documented as a text and reasoning surface with the vendor CLI's
 * own tools and MCP servers disabled, yet an MCP lazy-loading reminder listing the operator's
 * configured servers, and vendor tool-call markup with a mismatched closer, reached the
 * client as assistant text.
 */

const REMINDER = "<system-reminder>MCP lazy-loading is active.\n## Connected MCP servers\n"
  + "- internal-notes\n- deploy-keys\nUse mcp_list / mcp_get / mcp_call.</system-reminder>";

const TOOL_MARKUP = "<functions.exec>\n<parameter name=\"cmd\">cd /srv/private && git status</parameter>\n</invoke>";

function collect(): { events: AdapterEvent[]; emit: (event: AdapterEvent) => void } {
  const events: AdapterEvent[] = [];
  return { events, emit: event => { events.push(event); } };
}

function textOf(events: AdapterEvent[]): string {
  return events.map(event => (event.type === "text_delta" ? event.text : "")).join("");
}

describe("QoderScaffoldFilter", () => {
  test("removes a complete reminder block and keeps the answer around it", () => {
    const filter = new QoderScaffoldFilter();
    const first = filter.push(`Before.${REMINDER}After.`);
    expect(first.fail).toBeNull();
    expect(first.text + filter.flush().text).toBe("Before.After.");
  });

  test("catches a marker split across deltas", () => {
    const filter = new QoderScaffoldFilter();
    // The opening tag arrives in three pieces; a per-delta scan would miss it entirely.
    const parts = ["Answer. <system", "-remin", "der>secret server list</system-reminder> Done."];
    const out = parts.map(part => filter.push(part));
    expect(out.every(result => result.fail === null)).toBe(true);
    expect(out.map(result => result.text).join("") + filter.flush().text).toBe("Answer.  Done.");
    expect(out.map(result => result.text).join("")).not.toContain("secret server list");
  });

  test("releases a held tail that never became a marker", () => {
    const filter = new QoderScaffoldFilter();
    // "<" is a live marker prefix, so it cannot be forwarded until the stream ends.
    const pushed = filter.push("compare a < b and a <s");
    expect(pushed.text).toBe("compare a < b and a ");
    expect(filter.flush().text).toBe("<s");
  });

  test("fails closed on vendor tool-call markup, keeping the text that preceded it", () => {
    const filter = new QoderScaffoldFilter();
    const result = filter.push(`Checking the repositories.\n${TOOL_MARKUP}`);
    expect(result.text).toBe("Checking the repositories.\n");
    expect(result.fail).toContain("<functions.");
    // The refusal names the marker class only; the command never travels with it.
    expect(result.fail).not.toContain("git status");
  });

  test("fails closed on a closer with no opener", () => {
    // The block it belonged to was already partly forwarded, or never existed.
    expect(new QoderScaffoldFilter().push("tail</system-reminder>").fail).toContain("</system-reminder>");
  });

  test("does not forward the region between a suppressed block and a refusal", () => {
    // The text before the FIRST marker is the model's answer and is kept. The text after a
    // block this filter already swallowed is the vendor's own narration, and in the reported
    // leak that region is the MCP server list itself.
    const filter = new QoderScaffoldFilter();
    const result = filter.push(
      `<system-reminder>a</system-reminder>\n## Connected MCP servers\n- deploy-keys</system-reminder>`,
    );
    expect(result.text).toBe("");
    expect(result.text).not.toContain("deploy-keys");
    expect(result.fail).toContain("</system-reminder>");
  });

  test("does not forward vendor narration that sits between a reminder and tool markup", () => {
    const filter = new QoderScaffoldFilter();
    const result = filter.push(`Status.${REMINDER}\n- deploy-keys\n${TOOL_MARKUP}`);
    expect(result.text).toBe("Status.");
    expect(result.text).not.toContain("deploy-keys");
    expect(result.fail).toContain("<functions.");
  });

  test("fails closed when a reminder is never terminated", () => {
    const filter = new QoderScaffoldFilter();
    expect(filter.push("ok <system-reminder>listing servers").fail).toBeNull();
    expect(filter.flush().fail).toContain("unterminated");
  });

  test("latches: nothing more escapes after the guard trips", () => {
    const filter = new QoderScaffoldFilter();
    expect(filter.push(TOOL_MARKUP).fail).not.toBeNull();
    expect(filter.push("more vendor narration")).toEqual({ text: "", fail: null });
    expect(filter.flush()).toEqual({ text: "", fail: null });
  });
});

describe("guardQoderScaffolding", () => {
  test("strips the reminder and still completes the turn", () => {
    const { events, emit } = collect();
    const guarded = guardQoderScaffolding(emit);
    guarded({ type: "text_delta", text: `Here is the status.${REMINDER}` });
    guarded({ type: "done", stopReason: "stop" });
    expect(textOf(events)).toBe("Here is the status.");
    expect(textOf(events)).not.toContain("mcp_call");
    expect(events[events.length - 1]!.type).toBe("done");
  });

  test("flushes the held tail before the terminal event", () => {
    const { events, emit } = collect();
    const guarded = guardQoderScaffolding(emit);
    // Without the flush this answer would arrive truncated, and an answer that is entirely
    // held back would reach the empty-completion guard as a successful but empty turn.
    guarded({ type: "text_delta", text: "1 < 2" });
    guarded({ type: "done", stopReason: "stop" });
    expect(textOf(events)).toBe("1 < 2");
    expect(events[events.length - 1]!.type).toBe("done");
  });

  test("refuses the turn when tool-call markup leaks, and swallows the vendor's success", () => {
    const { events, emit } = collect();
    const guarded = guardQoderScaffolding(emit);
    guarded({ type: "text_delta", text: `Checking.\n${TOOL_MARKUP}` });
    guarded({ type: "done", stopReason: "stop" });
    expect(textOf(events)).toBe("Checking.\n");
    const terminal = events[events.length - 1]!;
    expect(terminal.type).toBe("error");
    if (terminal.type !== "error") throw new Error("expected an error terminal");
    expect(terminal.code).toBe(QODER_SCAFFOLD_ERROR_CODE);
    expect(terminal.status).toBe(502);
    expect(terminal.retryable).toBe(false);
    expect(terminal.message).not.toContain("git status");
    expect(terminal.message).not.toContain("mcp_call");
    expect(events.filter(event => event.type === "done")).toHaveLength(0);
  });

  test("guards the reasoning channel independently of the text channel", () => {
    const { events, emit } = collect();
    const guarded = guardQoderScaffolding(emit);
    guarded({ type: "thinking_delta", thinking: `Planning.${REMINDER}Continue.` });
    guarded({ type: "text_delta", text: "Answer." });
    guarded({ type: "done", stopReason: "stop" });
    const thinking = events.filter(event => event.type === "thinking_delta")
      .map(event => event.type === "thinking_delta" ? event.thinking : "").join("");
    expect(thinking).toBe("Planning.Continue.");
    expect(textOf(events)).toBe("Answer.");
  });

  test("forwards the vendor's own error rather than replacing it", () => {
    const { events, emit } = collect();
    const guarded = guardQoderScaffolding(emit);
    guarded({ type: "text_delta", text: "partial <system-reminder>never closed" });
    guarded({ type: "error", message: "Qoder CLI exited with code 118", status: 429 });
    const terminal = events[events.length - 1]!;
    expect(terminal.type).toBe("error");
    if (terminal.type !== "error") throw new Error("expected an error terminal");
    // The vendor said why the turn ended; the guard's job here was only to drop the block.
    expect(terminal.message).toBe("Qoder CLI exited with code 118");
    expect(textOf(events)).toBe("partial ");
  });

  test("passes unrelated events through untouched", () => {
    const { events, emit } = collect();
    const guarded = guardQoderScaffolding(emit);
    guarded({ type: "tool_call_start", id: "call_1", name: "exec" });
    guarded({ type: "done", stopReason: "stop" });
    expect(events.map(event => event.type)).toEqual(["tool_call_start", "done"]);
  });
});
