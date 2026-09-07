import { describe, expect, spyOn, test } from "bun:test";
import { anthropicToResponsesBody, anthropicToResponsesTranslation } from "../../src/claude/inbound";
import { decodeReasoningEnvelope, encodeReasoningEnvelope, OCX_REASONING_PREFIX, type ReasoningEnvelope } from "../../src/responses/reasoning-envelope";
import { responsesJsonToAnthropicMessage } from "../../src/claude/outbound";
import { createTranslatorBudget, TranslatorBudgetExceededError, translatorObservedBufferSnapshot } from "../../src/lib/translator-budget";
import { jsonUtf8Bytes } from "../../src/lib/json-byte-size";
import * as budgets from "../../src/lib/translator-budget";

describe("reasoning and tool/result envelopes", () => {
  test("preserves ordered thinking blocks and genuine signatures", () => {
    const body = anthropicToResponsesBody({
      model: "m", messages: [{ role: "assistant", content: [
        { type: "thinking", thinking: "first", signature: "sig-first" },
        { type: "tool_use", id: "call-1", name: "Read", input: {} },
        { type: "thinking", thinking: "second", signature: "sig-second" },
      ] }],
    }) as any;
    expect(body.input.map((item: any) => item.type)).toEqual(["reasoning", "function_call", "reasoning"]);
    expect(body.input[0].encrypted_content).toBe(encodeReasoningEnvelope({ sig: "sig-first" }));
    expect(body.input[2].encrypted_content).toBe(encodeReasoningEnvelope({ sig: "sig-second" }));
  });

  test("rejects malformed or nested OpenCodex signatures", () => {
    for (const signature of [
      "ocxr1:not-base64!!!",
      encodeReasoningEnvelope({ sig: "nested" }),
      encodeReasoningEnvelope({ sig: "", txt: "nested-empty-signature" }),
    ]) {
      expect(() => anthropicToResponsesBody({
        model: "m", messages: [{ role: "assistant", content: [{ type: "thinking", thinking: "x", signature }] }],
      })).toThrow();
    }
  });

  test("round-trips redacted thinking without exposing it as a genuine signature", () => {
    const encoded = encodeReasoningEnvelope({ sig: "sig", red: ["red-a", "red-b"] });
    const message = responsesJsonToAnthropicMessage({
      output: [{ type: "reasoning", summary: [{ type: "summary_text", text: "visible" }], encrypted_content: encoded }],
    }, "m") as any;
    expect(message.content[2]).toMatchObject({ type: "thinking", signature: "sig" });
    expect(message.content.slice(0, 2)).toEqual([
      { type: "redacted_thinking", data: "red-a" },
      { type: "redacted_thinking", data: "red-b" },
    ]);
  });

  test("owned fallback is bounded and decodable", () => {
    const message = responsesJsonToAnthropicMessage({
      output: [{ type: "reasoning", summary: [{ type: "summary_text", text: "think" }] }],
    }, "m") as any;
    const signature = message.content[0].signature as string;
    expect(signature.startsWith("ocxr1:")).toBe(true);
    expect(decodeReasoningEnvelope(signature)).toEqual({ txt: "think" });
  });

  test("preserves an explicitly empty fallback text", () => {
    expect(decodeReasoningEnvelope(encodeReasoningEnvelope({ txt: "" }))).toEqual({ txt: "" });
  });

  test("inbound preserves redacted-only reasoning when visible text is empty", () => {
    const body = anthropicToResponsesBody({
      model: "m", messages: [{ role: "assistant", content: [{ type: "redacted_thinking", data: "opaque" }] }],
    }) as any;
    expect(body.input).toHaveLength(1);
    expect(body.input[0].type).toBe("reasoning");
    expect(decodeReasoningEnvelope(body.input[0].encrypted_content)?.red).toEqual(["opaque"]);
  });

  test("drops an empty unsigned thinking block", () => {
    const body = anthropicToResponsesBody({
      model: "m", messages: [{ role: "assistant", content: [{ type: "thinking", thinking: "", signature: "" }] }],
    }) as any;
    expect(body.input).toEqual([]);
  });

  test("preserves signature-only reasoning in JSON output", () => {
    const message = responsesJsonToAnthropicMessage({
      output: [{ type: "reasoning", summary: [], encrypted_content: encodeReasoningEnvelope({ sig: "sig-only" }) }],
    }, "m") as any;
    expect(message.content).toEqual([{ type: "thinking", thinking: "", signature: "sig-only" }]);
  });
});

describe("reasoning allocation admission", () => {
  test.each(["ascii", "\"\\\n\u0000", "한글😀", "\ud800", "\udc00", ""])('sizes JSON strings exactly: %j', value => {
    const data = { sig: value, red: [value, ""], txt: value, krc: value, omitted: undefined };
    const expected = Buffer.byteLength(JSON.stringify(data));
    expect(jsonUtf8Bytes(data, expected)).toBe(expected);
    expect(() => jsonUtf8Bytes(data, expected - 1)).toThrow(TranslatorBudgetExceededError);
  });

  test("sizes the translated plain-JSON vocabulary", () => {
    const data = { arr: [undefined, null, true, false, 0, -0, 1e30, NaN, Infinity, { text: "x" }], absent: undefined };
    expect(jsonUtf8Bytes(data)).toBe(Buffer.byteLength(JSON.stringify(data)));
  });

  test.each<ReasoningEnvelope>([{ sig: "opaque" }, { red: ["one", "two"] }, { txt: "hidden" }, { krc: "opaque" }, { sig: "s", red: ["r"], txt: "t", krc: "k" }])(
    "rejects before JSON/Buffer materialization and admits the exact projected boundary: %j", envelope => {
      const json = JSON.stringify(envelope);
      const size = Buffer.byteLength(json);
      const base64Bytes = 4 * Math.ceil(size / 3);
      const limit = Math.max(3 * size + 4 * base64Bytes + 2 * OCX_REASONING_PREFIX.length, 8 * (OCX_REASONING_PREFIX.length + base64Bytes));
      const budget = createTranslatorBudget({ maxTurnBytes: limit - 1 });
      const stringify = spyOn(JSON, "stringify");
      const from = spyOn(Buffer, "from");
      let error: unknown;
      let serializations = 0;
      let allocations = 0;
      try { encodeReasoningEnvelope(envelope, budget); } catch (caught) { error = caught; }
      finally {
        serializations = stringify.mock.calls.length;
        allocations = from.mock.calls.length;
        stringify.mockRestore(); from.mockRestore();
      }
      expect(error).toBeInstanceOf(TranslatorBudgetExceededError);
      expect(serializations).toBe(0);
      expect(allocations).toBe(0);
      expect(budget.snapshot().currentBytes).toBe(0);
      budget.dispose();
      const exact = createTranslatorBudget({ maxTurnBytes: limit });
      try {
        const encoded = encodeReasoningEnvelope(envelope, exact);
        expect(encoded).toBe(OCX_REASONING_PREFIX + Buffer.from(json).toString("base64"));
        expect(decodeReasoningEnvelope(encoded, exact)).toEqual(envelope);
        expect(exact.snapshot().currentBytes).toBe(0);
      } finally { exact.dispose(); }
    },
  );

  test("bounds preencoded replay before decoding and preserves native blobs", () => {
    const encoded = encodeReasoningEnvelope({ txt: "" });
    const budget = createTranslatorBudget({ maxTurnBytes: encoded.length * 8 - 1 });
    const from = spyOn(Buffer, "from");
    let error: unknown;
    let allocations = 0;
    try { decodeReasoningEnvelope(encoded, budget); } catch (caught) { error = caught; }
    finally { allocations = from.mock.calls.length; from.mockRestore(); }
    expect(error).toBeInstanceOf(TranslatorBudgetExceededError);
    expect(allocations).toBe(0);
    expect(decodeReasoningEnvelope("native-opaque", budget)).toBeNull();
    expect(budget.snapshot().currentBytes).toBe(0);
    budget.dispose();
    const exact = createTranslatorBudget({ maxTurnBytes: encoded.length * 8 });
    try { expect(decodeReasoningEnvelope(encoded, exact)).toEqual({ txt: "" }); }
    finally { exact.dispose(); }
  });

  test.each(["thinking", "redacted_thinking", "owned"])('accounts cumulatively for %s blocks across messages', type => {
    const before = translatorObservedBufferSnapshot().currentBytes;
    const block = type === "redacted_thinking" ? { type, data: "r" }
      : { type: "thinking", thinking: "", signature: type === "owned" ? encodeReasoningEnvelope({ txt: "t" }) : "s" };
    const budget = createTranslatorBudget({ maxTurnBytes: 256 });
    try {
      expect(() => anthropicToResponsesTranslation({ model: "m", messages: Array.from({ length: 8 }, () => ({ role: "assistant", content: [block] })) }, undefined, budget))
        .toThrow(TranslatorBudgetExceededError);
      expect(budget.snapshot().highWaterBytes).toBeLessThanOrEqual(256);
    } finally { budget.dispose(); }
    expect(translatorObservedBufferSnapshot().currentBytes).toBe(before);
  });

  test.each(["thinking", "redacted_thinking", "owned"])("handler maps %s admission failure to 413 without dispatch and disposes its budget", async type => {
    const { handleClaudeMessages } = await import("../../src/server/claude-messages");
    const payload = "fixture".repeat(128);
    const signature = type === "owned" ? encodeReasoningEnvelope({ txt: payload }) : payload;
    const content = type === "redacted_thinking" ? { type, data: payload }
      : { type: "thinking", thinking: "", signature };
    const request = new Request("http://localhost/v1/messages", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "fixture/model", messages: [{ role: "assistant", content: [content] }] }),
    });
    const beforeBytes = budgets.translatorObservedBufferSnapshot().currentBytes;
    const beforeCount = budgets.translatorLiveBudgetCountForTests();
    const create = budgets.createTranslatorBudget;
    const budget = create({ maxTurnBytes: 4096 });
    const reserve = spyOn(budget, "reserveTransient");
    const charge = spyOn(budget, "chargeRetained");
    const factory = spyOn(budgets, "createTranslatorBudget").mockReturnValue(budget);
    const upstream = spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("unexpected upstream dispatch"); });
    try {
      const response = await handleClaudeMessages(request, { port: 0, providers: {} }, { model: "", provider: "" });
      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({ type: "error", error: { type: "request_too_large", code: "translation_buffer_limit" } });
      expect(upstream).not.toHaveBeenCalled();
      expect(reserve.mock.calls.some(([, scope]) => scope.kind === "reasoning")).toBe(true);
      expect(charge.mock.calls.filter(([, scope]) => scope.kind === "request_copies")).toHaveLength(0);
      expect(budgets.translatorObservedBufferSnapshot().currentBytes).toBe(beforeBytes);
      expect(budgets.translatorLiveBudgetCountForTests()).toBe(beforeCount);
    } finally { factory.mockRestore(); upstream.mockRestore(); reserve.mockRestore(); charge.mockRestore(); budget.dispose(); }
  });
  test("final request-copy admission returns 413 before serialization and disposes the budget", async () => {
    const { handleClaudeMessages } = await import("../../src/server/claude-messages");
    const request = new Request("http://localhost/v1/messages", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "fixture/model", messages: [{ role: "user", content: "x".repeat(200) }] }),
    });
    const beforeBytes = budgets.translatorObservedBufferSnapshot().currentBytes;
    const beforeCount = budgets.translatorLiveBudgetCountForTests();
    const budget = budgets.createTranslatorBudget({ maxTurnBytes: 512 });
    const reserve = spyOn(budget, "reserveTransient");
    const charge = spyOn(budget, "chargeRetained");
    const factory = spyOn(budgets, "createTranslatorBudget").mockReturnValue(budget);
    const stringify = spyOn(JSON, "stringify");
    const upstream = spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("unexpected upstream dispatch"); });
    try {
      const response = await handleClaudeMessages(request, { port: 0, providers: {} }, { model: "", provider: "" });
      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({ type: "error", error: { type: "request_too_large", code: "translation_buffer_limit" } });
      expect(charge.mock.calls.filter(([, scope]) => scope.kind === "request_copies")).toHaveLength(1);
      expect(reserve.mock.calls.filter(([, scope]) => scope.kind === "request_copies")).toHaveLength(1);
      expect(stringify.mock.calls.some(([value]) => value && typeof value === "object" && "input" in value)).toBe(false);
      expect(upstream).not.toHaveBeenCalled();
      expect(budgets.translatorObservedBufferSnapshot().currentBytes).toBe(beforeBytes);
      expect(budgets.translatorLiveBudgetCountForTests()).toBe(beforeCount);
    } finally {
      factory.mockRestore(); stringify.mockRestore(); upstream.mockRestore();
      reserve.mockRestore(); charge.mockRestore(); budget.dispose();
    }
  });

});
