import { afterEach, describe, expect, test } from "bun:test";
import { createOpenAIChatAdapter } from "../src/adapters/openai-chat";
import { bridgeToResponsesSSE, buildResponseJSON } from "../src/bridge";
import {
  ChatCompletionsStreamError,
  collectChatCompletion,
  responsesSseToChatCompletionsSse,
} from "../src/chat/outbound";
import { setToolArgumentLimitsForTests } from "../src/lib/tool-argument-bounds";
import type { AdapterEvent } from "../src/types";

const encoder = new TextEncoder();

function byteStream(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function* replay(events: AdapterEvent[]): AsyncGenerator<AdapterEvent> {
  for (const event of events) yield event;
}

async function streamText(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

function responseSse(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`;
}

afterEach(() => setToolArgumentLimitsForTests(null));

describe("streamed tool argument memory bounds", () => {
  test("openai-chat rejects one oversized buffered call without flushing it as complete", async () => {
    setToolArgumentLimitsForTests({ perCallBytes: 16, perTurnBytes: 32 });
    const body = [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "shell", arguments: "{\"value\":\"" } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "1234567890\"}" } }] }, finish_reason: "tool_calls" }] },
    ].map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
    const events: AdapterEvent[] = [];

    for await (const event of createOpenAIChatAdapter({
      adapter: "openai-chat",
      baseUrl: "https://example.test/v1",
      apiKey: "key",
    }).parseStream(new Response(body))) events.push(event);

    expect(events.map(event => event.type)).toEqual(["error"]);
    expect(events[0]).toMatchObject({ status: 502, errorType: "upstream_error" });
  });

  test("Responses streaming bridge fails the turn instead of completing an oversized call", async () => {
    setToolArgumentLimitsForTests({ perCallBytes: 16, perTurnBytes: 32 });
    const text = await streamText(bridgeToResponsesSSE(replay([
      { type: "tool_call_start", id: "call_1", name: "shell" },
      { type: "tool_call_delta", arguments: "{\"value\":\"" },
      { type: "tool_call_delta", arguments: "1234567890\"}" },
      { type: "tool_call_end" },
      { type: "done" },
    ]), "routed/model"));

    expect(text).toContain("response.failed");
    expect(text).toContain("configured byte limit");
    expect(text).not.toContain("response.function_call_arguments.done");
    expect(text).not.toContain("response.completed");
  });

  test("batch bridge enforces the aggregate retained budget across completed calls", () => {
    setToolArgumentLimitsForTests({ perCallBytes: 16, perTurnBytes: 20 });
    const response = buildResponseJSON([
      { type: "tool_call_start", id: "call_1", name: "first" },
      { type: "tool_call_delta", arguments: "{\"a\":\"123\"}" },
      { type: "tool_call_end" },
      { type: "tool_call_start", id: "call_2", name: "second" },
      { type: "tool_call_delta", arguments: "{\"b\":\"456\"}" },
      { type: "tool_call_end" },
      { type: "done" },
    ], "routed/model");

    expect(response.status).toBe("failed");
    expect((response.error as { message?: string }).message).toContain("configured byte limit");
    const output = response.output as Array<{ call_id?: string; status?: string; arguments?: string }>;
    expect(output).toContainEqual(expect.objectContaining({ call_id: "call_1", status: "completed" }));
    expect(output).toContainEqual(expect.objectContaining({ call_id: "call_2", status: "incomplete", arguments: "{}" }));
  });

  test("Responses-to-Chat streaming closes with an error and no DONE on overflow", async () => {
    setToolArgumentLimitsForTests({ perCallBytes: 16, perTurnBytes: 32 });
    const upstream = byteStream([
      responseSse("response.output_item.added", {
        item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "shell", arguments: "" },
      }),
      responseSse("response.function_call_arguments.delta", {
        item_id: "fc_1",
        delta: "{\"value\":\"1234567890\"}",
      }),
      responseSse("response.completed", { response: { status: "completed" } }),
    ]);
    const text = await streamText(responsesSseToChatCompletionsSse(upstream, "routed/model"));

    expect(text).toContain('"error"');
    expect(text).toContain("configured byte limit");
    expect(text).not.toContain("data: [DONE]");
    expect(text).not.toContain('"finish_reason":"tool_calls"');
  });

  test("non-stream Chat collector rejects oversized tool arguments with a typed error", async () => {
    setToolArgumentLimitsForTests({ perCallBytes: 16, perTurnBytes: 32 });
    const chatFrame = {
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: "call_1",
            type: "function",
            function: { name: "shell", arguments: "{\"value\":\"1234567890\"}" },
          }],
        },
        finish_reason: null,
      }],
    };
    const completion = collectChatCompletion(
      byteStream([`data: ${JSON.stringify(chatFrame)}\n\ndata: [DONE]\n\n`]),
      "routed/model",
    );

    await expect(completion).rejects.toBeInstanceOf(ChatCompletionsStreamError);
    await expect(completion).rejects.toMatchObject({ status: 502, type: "upstream_error" });
  });
});
