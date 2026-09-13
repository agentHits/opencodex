import { afterEach, describe, expect, test } from "bun:test";
import {
  handleResponses,
  hasUnreadableEncryptedAgentTask,
} from "../../src/server/responses";
import type { OcxConfig } from "../../src/types";
import { fakeChatGptJwt } from "../helpers/fake-chatgpt-jwt";

const originalFetch = globalThis.fetch;

/**
 * Structurally faithful Fernet fixture: version + timestamp + IV + one AES-CBC
 * block + HMAC. Bytes are synthetic, so this validates wire shape without
 * publishing a real captured task or claiming the HMAC is authentic.
 */
function fernetFixture(ciphertextBytes = 16, version = 0x80): string {
  const raw = Buffer.alloc(57 + ciphertextBytes, 0x5a);
  raw[0] = version;
  raw.writeBigUInt64BE(1_720_000_000n, 1);
  const unpadded = raw.toString("base64url");
  return `${unpadded}${"=".repeat((4 - (unpadded.length % 4)) % 4)}`;
}

const FERNET_TASK = fernetFixture();
const TOO_SHORT_FERNET = `gAAAA${"A".repeat(60)}`;
const INVALID_BLOCK_FERNET = fernetFixture(17);
const INVALID_VERSION_FERNET = fernetFixture(16, 0x81);
const ROUTING_ENVELOPE = [
  "Message Type: NEW_TASK",
  "Task name: /root/worker",
  "Sender: /root",
  "Payload:",
  "",
].join("\n");

// The same envelope a delegated agent uses to REPLY, as opposed to being spawned.
// #3021 saw one of these reach the parent conversation as raw `gAAAA...` text.
const MESSAGE_ROUTING_ENVELOPE = ROUTING_ENVELOPE.replace("NEW_TASK", "MESSAGE");

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function agentMessage(content: Array<Record<string, unknown>>): unknown[] {
  return [{
    type: "agent_message",
    author: "/root",
    recipient: "/root/worker",
    content,
  }];
}

function routedConfig(): OcxConfig {
  return {
    port: 0,
    defaultProvider: "xai",
    providers: {
      xai: {
        adapter: "openai-chat",
        baseUrl: "https://api.x.ai/v1",
        authMode: "key",
        apiKey: "test-xai-key",
      },
    },
  } as OcxConfig;
}

function nativeConfig(): OcxConfig {
  return {
    port: 0,
    defaultProvider: "openai",
    providers: {
      openai: {
        adapter: "openai-responses",
        baseUrl: "https://chatgpt.com/backend-api/codex",
        authMode: "forward",
        codexAccountMode: "direct",
      },
    },
  } as OcxConfig;
}

function mixedComboConfig(): OcxConfig {
  return {
    port: 0,
    defaultProvider: "xai",
    providers: {
      xai: {
        adapter: "openai-chat",
        baseUrl: "https://api.x.ai/v1",
        authMode: "key",
        apiKey: "test-xai-key",
      },
      openai: {
        adapter: "openai-responses",
        baseUrl: "https://chatgpt.com/backend-api/codex",
        authMode: "forward",
        codexAccountMode: "direct",
      },
    },
    combos: {
      mixed: {
        strategy: "failover",
        targets: [
          { provider: "xai", model: "grok-4.5" },
          { provider: "openai", model: "gpt-5.5" },
        ],
      },
    },
  } as OcxConfig;
}

async function post(
  config: OcxConfig,
  model: string,
  input: unknown[],
  headers: HeadersInit = {},
): Promise<Response> {
  return handleResponses(new Request("http://localhost/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...Object.fromEntries(new Headers(headers)),
    },
    body: JSON.stringify({ model, input, stream: false }),
  }), config, { model: "", provider: "" });
}

describe("V2 routed agent-message ciphertext guard", () => {
  test("blocks a pure Fernet-only agent task", () => {
    expect(hasUnreadableEncryptedAgentTask(agentMessage([
      { type: "encrypted_content", encrypted_content: FERNET_TASK },
    ]))).toBe(true);
  });

  test("blocks a routing envelope followed only by a Fernet task", () => {
    expect(hasUnreadableEncryptedAgentTask(agentMessage([
      { type: "input_text", text: ROUTING_ENVELOPE },
      { type: "encrypted_content", encrypted_content: FERNET_TASK },
    ]))).toBe(true);
  });

  /**
   * #3021: a delegated subagent's MESSAGE reply reached the parent conversation as
   * raw `gAAAA...` ciphertext after an `adapter_eof`.
   *
   * The detector decides "unreadable" by stripping the routing envelope and asking
   * whether any plaintext survives, so an envelope shape it does not recognise counts
   * as surviving text. The envelope pattern matched only NEW_TASK, so a MESSAGE whose
   * entire body was one Fernet token measured as READABLE and was forwarded verbatim.
   *
   * This is the detection half only. Recovery stays NEW_TASK-only on purpose:
   * decrypting a MESSAGE on the parent's behalf would build a plaintext oracle out of
   * a payload the parent's session may not be entitled to read.
   */
  test("blocks a MESSAGE reply envelope followed only by a Fernet payload", () => {
    expect(hasUnreadableEncryptedAgentTask(agentMessage([
      { type: "input_text", text: MESSAGE_ROUTING_ENVELOPE },
      { type: "encrypted_content", encrypted_content: FERNET_TASK },
    ]))).toBe(true);
  });

  test("blocks a MESSAGE envelope carried inside the encrypted slot itself", () => {
    // The shape the report describes: header and ciphertext arrive as one
    // encrypted_content string rather than as separate parts.
    expect(hasUnreadableEncryptedAgentTask(agentMessage([
      {
        type: "encrypted_content",
        encrypted_content: `${MESSAGE_ROUTING_ENVELOPE}${FERNET_TASK}`,
      },
    ]))).toBe(true);
  });

  test("a MESSAGE reply that carries real text stays readable", () => {
    // The control. Widening the envelope must not turn every agent reply into a
    // blocked one -- only the ones with nothing left after the header comes off.
    expect(hasUnreadableEncryptedAgentTask(agentMessage([
      { type: "input_text", text: `${MESSAGE_ROUTING_ENVELOPE}the worker finished the migration` },
      { type: "encrypted_content", encrypted_content: FERNET_TASK },
    ]))).toBe(false);
  });

  test("blocks a control preamble mixed into the Fernet slot before sanitization", async () => {
    const input = agentMessage([
      { type: "input_text", text: ROUTING_ENVELOPE },
      {
        type: "encrypted_content",
        encrypted_content: `[CXC-LEAF-GUARD] follow the worker boundary.\n\n${FERNET_TASK}`,
      },
    ]);
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("provider dispatch must not happen");
    }) as typeof fetch;

    const response = await post(routedConfig(), "xai/grok-4.5", input);
    const raw = await response.text();
    const json = JSON.parse(raw) as {
      error?: { type?: string; code?: string; message?: string };
    };

    expect(response.status).toBe(400);
    expect(json.error).toMatchObject({
      type: "invalid_request_error",
      code: "unreadable_encrypted_agent_task",
    });
    expect(json.error?.message).toContain("encrypted");
    expect(fetchCalls).toBe(0);
    expect(raw).not.toContain(FERNET_TASK);
    expect(raw).not.toContain("gAAAA");
  });

  test("filters a combo to a decrypt-capable native target before dispatch", async () => {
    const fetchedUrls: string[] = [];
    const nativeToken = fakeChatGptJwt({ chatgpt_account_id: "native-combo-caller" });
    const forwardedAuth: Array<{ authorization: string | null; account: string | null }> = [];
    let forwardedBody = "";
    globalThis.fetch = (async (input, init) => {
      fetchedUrls.push(String(input));
      const headers = new Headers(init?.headers);
      forwardedAuth.push({ authorization: headers.get("authorization"), account: headers.get("chatgpt-account-id") });
      forwardedBody = typeof init?.body === "string" ? init.body : "";
      return Response.json({
        id: "resp_combo_native",
        object: "response",
        status: "completed",
        model: "gpt-5.5",
        output: [],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      });
    }) as typeof fetch;

    const response = await post(
      mixedComboConfig(),
      "combo/mixed",
      agentMessage([
        { type: "input_text", text: ROUTING_ENVELOPE },
        { type: "encrypted_content", encrypted_content: FERNET_TASK },
      ]),
      { authorization: `Bearer ${nativeToken}`, "chatgpt-account-id": "native-combo-caller" },
    );

    expect(response.status).toBe(200);
    expect(fetchedUrls).toHaveLength(1);
    expect(fetchedUrls[0]).toContain("chatgpt.com/backend-api/codex");
    expect(fetchedUrls[0]).not.toContain("api.x.ai");
    expect(forwardedAuth).toEqual([{ authorization: `Bearer ${nativeToken}`, account: "native-combo-caller" }]);
    expect(forwardedBody).toContain(FERNET_TASK);
  });

  test("returns the machine-readable guard error when a combo has no native target", async () => {
    const config = mixedComboConfig();
    config.combos!.mixed!.targets = [{ provider: "xai", model: "grok-4.5" }];
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("provider dispatch must not happen");
    }) as typeof fetch;

    const response = await post(config, "combo/mixed", agentMessage([
      { type: "input_text", text: ROUTING_ENVELOPE },
      { type: "encrypted_content", encrypted_content: FERNET_TASK },
    ]));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        type: "invalid_request_error",
        code: "unreadable_encrypted_agent_task",
      },
    });
    expect(fetchCalls).toBe(0);
  });

  test("keeps encrypted combo failover on native targets after a native failure", async () => {
    const config = mixedComboConfig();
    config.providers["openai-backup"] = {
      adapter: "openai-responses",
      baseUrl: "https://chatgpt.com/backend-api/codex",
      authMode: "forward",
      codexAccountMode: "direct",
    };
    config.combos!.mixed!.targets = [
      { provider: "xai", model: "grok-primary" },
      { provider: "openai", model: "gpt-native-primary" },
      { provider: "xai", model: "grok-secondary" },
      { provider: "openai-backup", model: "gpt-native-backup" },
    ];
    const forwardedModels: string[] = [];
    const forwardedBodies: string[] = [];
    const nativeToken = fakeChatGptJwt({ chatgpt_account_id: "native-combo-caller" });
    const forwardedAuth: Array<{ authorization: string | null; account: string | null }> = [];
    globalThis.fetch = (async (_input, init) => {
      const headers = new Headers(init?.headers);
      forwardedAuth.push({ authorization: headers.get("authorization"), account: headers.get("chatgpt-account-id") });
      const raw = typeof init?.body === "string" ? init.body : "";
      forwardedBodies.push(raw);
      const parsed = JSON.parse(raw) as { model?: string };
      forwardedModels.push(parsed.model ?? "");
      if (forwardedModels.length === 1) {
        return Response.json({ error: { message: "native target rejected this request" } }, { status: 403 });
      }
      return Response.json({
        id: "resp_combo_native_backup",
        object: "response",
        status: "completed",
        model: "gpt-native-backup",
        output: [],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      });
    }) as typeof fetch;

    const response = await post(
      config,
      "combo/mixed",
      agentMessage([
        { type: "input_text", text: ROUTING_ENVELOPE },
        { type: "encrypted_content", encrypted_content: FERNET_TASK },
      ]),
      { authorization: `Bearer ${nativeToken}`, "chatgpt-account-id": "native-combo-caller" },
    );

    expect(response.status).toBe(200);
    expect(forwardedModels).toEqual(["gpt-native-primary", "gpt-native-backup"]);
    expect(forwardedBodies).toHaveLength(2);
    expect(forwardedAuth).toEqual(Array(2).fill({ authorization: `Bearer ${nativeToken}`, account: "native-combo-caller" }));
    expect(forwardedBodies.every(body => body.includes(FERNET_TASK))).toBe(true);
  });

  test("blocks an exact routing envelope and Fernet task inside one mixed slot", () => {
    expect(hasUnreadableEncryptedAgentTask(agentMessage([{
      type: "encrypted_content",
      encrypted_content: `${ROUTING_ENVELOPE.trimEnd()}${FERNET_TASK}`,
    }]))).toBe(true);
  });

  test("blocks repeated and future CXC control paragraphs", () => {
    for (const preamble of [
      "[CXC-LEAF-GUARD] stay in scope.\n\n[CXC-SKILL-AFFORDANCE] use only declared tools.",
      "[CXC-RATE-GUARD] provider compatibility metadata.",
    ]) {
      expect(hasUnreadableEncryptedAgentTask(agentMessage([
        { type: "input_text", text: ROUTING_ENVELOPE },
        {
          type: "encrypted_content",
          encrypted_content: `${preamble}\n\n${FERNET_TASK}`,
        },
      ]))).toBe(true);
    }
  });

  test("allows genuine task text after a CXC control paragraph", () => {
    expect(hasUnreadableEncryptedAgentTask(agentMessage([
      {
        type: "encrypted_content",
        encrypted_content: `[CXC-LEAF-GUARD] follow the worker boundary.\n\n${FERNET_TASK}`,
      },
      { type: "input_text", text: "Implement the focused regression test." },
    ]))).toBe(false);
  });

  test("allows a readable payload after CXC metadata and the routing envelope", () => {
    expect(hasUnreadableEncryptedAgentTask(agentMessage([
      {
        type: "encrypted_content",
        encrypted_content: `[CXC-LEAF-GUARD] follow the worker boundary.\n${ROUTING_ENVELOPE}Implement the focused regression test.\n${FERNET_TASK}`,
      },
    ]))).toBe(false);
  });

  test("allows genuine readable task text after the envelope", () => {
    expect(hasUnreadableEncryptedAgentTask(agentMessage([
      {
        type: "input_text",
        text: `${ROUTING_ENVELOPE}Implement the focused regression test.`,
      },
      { type: "encrypted_content", encrypted_content: FERNET_TASK },
    ]))).toBe(false);
  });

  test("ignores encrypted reasoning and compaction items", () => {
    expect(hasUnreadableEncryptedAgentTask([
      { type: "reasoning", encrypted_content: FERNET_TASK, summary: [] },
      { type: "compaction", encrypted_content: FERNET_TASK },
    ])).toBe(false);
  });

  test("allows meaningful plaintext before the exact codex-rs routing envelope", () => {
    expect(hasUnreadableEncryptedAgentTask(agentMessage([
      {
        type: "input_text",
        text: `Implement the requested fix.\n${ROUTING_ENVELOPE}`,
      },
      { type: "encrypted_content", encrypted_content: FERNET_TASK },
    ]))).toBe(false);
  });

  test("allows a readable payload on the same line as the marker", () => {
    const sameLinePayload = ROUTING_ENVELOPE.replace(
      "Payload:\n",
      "Payload: Implement the focused regression test.\n",
    );
    expect(hasUnreadableEncryptedAgentTask(agentMessage([
      { type: "input_text", text: sameLinePayload },
      { type: "encrypted_content", encrypted_content: FERNET_TASK },
    ]))).toBe(false);
  });

  test("does not mistake structurally impossible Fernet-like runs for backend tasks", () => {
    for (const invalid of [
      TOO_SHORT_FERNET,
      INVALID_BLOCK_FERNET,
      INVALID_VERSION_FERNET,
      FERNET_TASK.slice(0, -1),
      FERNET_TASK.replace(/=+$/, ""),
      `x${FERNET_TASK}`,
    ]) {
      expect(hasUnreadableEncryptedAgentTask(agentMessage([
        { type: "input_text", text: ROUTING_ENVELOPE },
        { type: "encrypted_content", encrypted_content: invalid },
      ]))).toBe(false);
    }
  });

  test("does not count output-only text that the routed input parser drops", () => {
    expect(hasUnreadableEncryptedAgentTask(agentMessage([
      { type: "output_text", text: "not provider-readable on an input item" },
      { type: "encrypted_content", encrypted_content: FERNET_TASK },
    ]))).toBe(true);
  });

  test("classifies only trailing current agent messages, not encrypted history", () => {
    const encryptedHistory = agentMessage([
      { type: "input_text", text: ROUTING_ENVELOPE },
      { type: "encrypted_content", encrypted_content: FERNET_TASK },
    ])[0];
    const readableCurrent = agentMessage([
      { type: "input_text", text: "Current readable task." },
    ])[0];

    expect(hasUnreadableEncryptedAgentTask([
      encryptedHistory,
      readableCurrent,
    ])).toBe(false);
    expect(hasUnreadableEncryptedAgentTask([
      encryptedHistory,
      { type: "message", role: "assistant", content: "history boundary" },
      readableCurrent,
    ])).toBe(false);
    expect(hasUnreadableEncryptedAgentTask([
      encryptedHistory,
      { type: "message", role: "user", content: "Current readable turn." },
    ])).toBe(false);
  });

  test("still blocks an unreadable current task after readable history", () => {
    const unreadableCurrent = agentMessage([
      { type: "input_text", text: ROUTING_ENVELOPE },
      { type: "encrypted_content", encrypted_content: FERNET_TASK },
    ])[0];
    for (const trailingMetadata of [
      { type: "compaction_trigger" },
      { type: "additional_tools", tools: [] },
    ]) {
      expect(hasUnreadableEncryptedAgentTask([
        { type: "message", role: "user", content: "old readable turn" },
        unreadableCurrent,
        trailingMetadata,
      ])).toBe(true);
    }
  });

  test("treats string content as plaintext, not as an encrypted-content slot", () => {
    // codex-rs AgentMessageInputContent is an array union. A loose string shape is
    // accepted by the proxy parser as readable text, so it must not trigger this guard.
    expect(hasUnreadableEncryptedAgentTask([{
      type: "agent_message",
      content: FERNET_TASK,
    }])).toBe(false);
  });

  test("allows the canonical ChatGPT route to forward the encrypted task", async () => {
    let forwardedBody = "";
    globalThis.fetch = (async (_input, init) => {
      forwardedBody = typeof init?.body === "string" ? init.body : "";
      return Response.json({
        id: "resp_native",
        object: "response",
        status: "completed",
        model: "gpt-5.5",
        output: [],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      });
    }) as typeof fetch;

    const input = agentMessage([
      { type: "input_text", text: ROUTING_ENVELOPE },
      { type: "encrypted_content", encrypted_content: FERNET_TASK },
    ]);
    const response = await post(nativeConfig(), "gpt-5.5", input, {
      authorization: "Bearer caller-codex-token",
    });

    expect(response.status).toBe(200);
    expect(forwardedBody).toContain(FERNET_TASK);
  });
});

/**
 * #4454. The guard above asks whether the CURRENT worker task is readable, and reads only the
 * tail item. The adapter asks whether EVERY part can be lowered onto a public message. An item
 * that mixes readable text with ciphertext answers "readable" to the first and "not lowerable"
 * to the second, so it passed the guard, kept its private `agent_message` type through the raw
 * Responses passthrough, and reached xAI as `422 unknown item type "agent_message"` -- with the
 * ciphertext already sent. Position is incidental: a replayed child result simply tends to sit
 * mid-history, where the tail-only scan could never have seen it.
 */
describe("routed Responses agent-message ciphertext egress", () => {
  function routedResponsesConfig(): OcxConfig {
    return {
      port: 0,
      defaultProvider: "relay",
      providers: {
        relay: {
          adapter: "openai-responses",
          baseUrl: "https://relay.example/v1",
          authMode: "key",
          apiKey: "test-relay-key",
        },
      },
    } as OcxConfig;
  }

  function mixedChildResult(): Record<string, unknown> {
    return {
      type: "agent_message",
      author: "/root/child",
      recipient: "/root",
      content: [
        { type: "input_text", text: "the child finished the migration" },
        { type: "encrypted_content", encrypted_content: FERNET_TASK },
      ],
    };
  }

  const userTurn = { type: "message", role: "user", content: [{ type: "input_text", text: "continue" }] };

  function refuseDispatch(): () => number {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      throw new Error("provider dispatch must not happen");
    }) as typeof fetch;
    return () => calls;
  }

  test("blocks a mixed child result replayed behind a later user turn", async () => {
    const dispatches = refuseDispatch();

    const response = await post(routedResponsesConfig(), "relay/child-model", [mixedChildResult(), userTurn]);
    const raw = await response.text();

    expect(response.status).toBe(400);
    expect(JSON.parse(raw)).toMatchObject({
      error: {
        type: "invalid_request_error",
        code: "unforwardable_encrypted_agent_message",
        item_index: 0,
      },
    });
    expect(dispatches()).toBe(0);
    expect(raw).not.toContain(FERNET_TASK);
    expect(raw).not.toContain("gAAAA");
  });

  test("blocks the same shape at the tail, where the readability guard reports readable", async () => {
    const input = [mixedChildResult()];
    // The gap itself: this is the guard that was supposed to be the fail-closed boundary.
    expect(hasUnreadableEncryptedAgentTask(input)).toBe(false);
    const dispatches = refuseDispatch();

    const response = await post(routedResponsesConfig(), "relay/child-model", input);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "unforwardable_encrypted_agent_message", item_index: 0 },
    });
    expect(dispatches()).toBe(0);
  });

  test("blocks ciphertext that arrives as text rather than in an encrypted slot", async () => {
    // #3021 saw a delegated reply reach the parent as raw `gAAAA...` text. The adapter lowers a
    // readable-looking item like this one onto a public message, which would put the ciphertext
    // on the wire as prose. The readability guard is unchanged and still reports it readable.
    const input = [{ type: "agent_message", author: "/root/child", recipient: "/root", content: FERNET_TASK }];
    expect(hasUnreadableEncryptedAgentTask(input)).toBe(false);
    const dispatches = refuseDispatch();

    const response = await post(routedResponsesConfig(), "relay/child-model", input);
    const raw = await response.text();

    expect(response.status).toBe(400);
    expect(JSON.parse(raw)).toMatchObject({ error: { code: "unforwardable_encrypted_agent_message" } });
    expect(dispatches()).toBe(0);
    expect(raw).not.toContain(FERNET_TASK);
  });

  test("blocks the reported xAI destination, whose Responses wire comes from a model default", async () => {
    // #4454 as filed: the provider-wide adapter is the Chat wire, and the registry moves
    // grok-4.6 onto the raw Responses passthrough for an OAuth caller speaking Responses.
    // Reading `route.provider.adapter` would miss exactly this case, so the gate resolves the
    // same wire override the adapter is built from.
    const config = {
      port: 0,
      defaultProvider: "xai",
      providers: {
        xai: { adapter: "openai-chat", baseUrl: "https://api.x.ai/v1", authMode: "oauth" },
      },
    } as OcxConfig;
    const dispatches = refuseDispatch();

    const response = await post(config, "xai/grok-4.6", [mixedChildResult(), userTurn]);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "unforwardable_encrypted_agent_message", item_index: 0 },
    });
    expect(dispatches()).toBe(0);
  });

  test("still lowers a fully readable child result onto a public message", async () => {
    let forwardedBody = "";
    globalThis.fetch = (async (_input, init) => {
      forwardedBody = typeof init?.body === "string" ? init.body : "";
      return Response.json({
        id: "resp_routed",
        object: "response",
        status: "completed",
        model: "grok-4.6",
        output: [],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      });
    }) as typeof fetch;

    const response = await post(routedResponsesConfig(), "relay/child-model", [{
      type: "agent_message",
      author: "/root/child",
      recipient: "/root",
      content: [{ type: "input_text", text: "the child finished the migration" }],
    }, userTurn]);

    expect(response.status).toBe(200);
    expect(forwardedBody).toContain("the child finished the migration");
    expect(forwardedBody).not.toContain("agent_message");
  });

  test("leaves a translated Chat destination on its existing path", async () => {
    // The private item never reaches that wire: the parser rebuilds the body from messages and
    // drops an encrypted part outright. Failing this request closed would break a thread that
    // works today, so the gate is scoped to the raw Responses passthrough.
    let forwardedBody = "";
    globalThis.fetch = (async (_input, init) => {
      forwardedBody = typeof init?.body === "string" ? init.body : "";
      return Response.json({
        id: "chatcmpl_routed",
        object: "chat.completion",
        model: "grok-4.5",
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    }) as typeof fetch;

    const response = await post(routedConfig(), "xai/grok-4.5", [mixedChildResult(), userTurn]);

    expect(response.status).toBe(200);
    expect(forwardedBody).toContain("the child finished the migration");
    expect(forwardedBody).not.toContain(FERNET_TASK);
    expect(forwardedBody).not.toContain("agent_message");
  });

  test("leaves a forward destination's private-item ownership untouched", async () => {
    let forwardedBody = "";
    globalThis.fetch = (async (_input, init) => {
      forwardedBody = typeof init?.body === "string" ? init.body : "";
      return Response.json({
        id: "resp_native_mixed",
        object: "response",
        status: "completed",
        model: "gpt-5.5",
        output: [],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      });
    }) as typeof fetch;

    const response = await post(nativeConfig(), "gpt-5.5", [mixedChildResult(), userTurn], {
      authorization: "Bearer caller-codex-token",
    });

    expect(response.status).toBe(200);
    expect(forwardedBody).toContain(FERNET_TASK);
    expect(forwardedBody).toContain("agent_message");
  });
});
