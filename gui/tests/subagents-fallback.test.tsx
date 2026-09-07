import { afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { clearClientResourceStoresForTests } from "../src/client-resource";
import { en } from "../src/i18n/en";
import { LanguageProvider } from "../src/i18n/provider";
import Subagents from "../src/pages/Subagents";
import { readSessionListCache } from "../src/session-list-cache";

const CACHE_KEY = "ocx.subagents.v1:";
const FALLBACK_PATH = "/api/subagent-model-fallback";
const ROSTER_PATH = "/api/subagent-models";
const UNAVAILABLE_MODEL = "retired-provider/configured-model";
const globals = [
  "document", "window", "navigator", "localStorage", "sessionStorage", "fetch", "IS_REACT_ACT_ENVIRONMENT",
] as const;

type CachedSubagents = { available: string[]; chosen: string[]; fallback: string[]; pollMs: number };
type FallbackSettings = { models: string[]; pollMs: number };
type SentRequest = { path: string; method: string; init?: RequestInit };
type V2Settings = {
  enabled: boolean;
  multiAgentMode: "v1" | "default" | "v2";
  multiAgentModeHintText: string | null;
  keepNativeChatGptOnV1: boolean;
};

let previousGlobals: Record<(typeof globals)[number], PropertyDescriptor | undefined>;
let testWindow: Window;
let container: HTMLElement;
let root: Root | null = null;
let requests: SentRequest[];
let available: string[];
let chosen: string[];
let fallbackSettings: FallbackSettings;
let failFallbackPut: boolean;
let v2Settings: V2Settings;
let preferredModel: string | null;
let fallbackGetGate: Promise<void> | null;

beforeEach(() => {
  clearClientResourceStoresForTests();
  previousGlobals = Object.fromEntries(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)])) as typeof previousGlobals;
  testWindow = new Window({ url: "http://localhost/" });
  Object.defineProperty(testWindow.navigator, "language", { configurable: true, value: "en-US" });
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: testWindow.document },
    window: { configurable: true, value: testWindow },
    navigator: { configurable: true, value: testWindow.navigator },
    localStorage: { configurable: true, value: testWindow.localStorage },
    sessionStorage: { configurable: true, value: testWindow.sessionStorage },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  });

  requests = [];
  available = ["a-1", "a-2", "a-3"];
  chosen = ["a-1"];
  fallbackSettings = { models: ["a-2"], pollMs: 45_000 };
  failFallbackPut = false;
  v2Settings = { enabled: true, multiAgentMode: "v2", multiAgentModeHintText: null, keepNativeChatGptOnV1: false };
  preferredModel = null;
  fallbackGetGate = null;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost/").pathname;
      const method = init?.method ?? "GET";
      requests.push({ path, method, init });
      // Match agent-settings-routes: fallback uses models, roster uses chosen/applied.
      if (path === FALLBACK_PATH && method === "GET") {
        if (fallbackGetGate) await fallbackGetGate;
        return Response.json({ ...fallbackSettings, available });
      }
      if (path === FALLBACK_PATH && method === "PUT") {
        if (failFallbackPut) return Response.json({ error: "Fallback settings could not be persisted" }, { status: 500 });
        fallbackSettings = JSON.parse(String(init?.body)) as FallbackSettings;
        return Response.json({ ok: true, ...fallbackSettings });
      }
      if (path === ROSTER_PATH && method === "GET") return Response.json({ available, chosen });
      if (path === ROSTER_PATH && method === "PUT") {
        chosen = (JSON.parse(String(init?.body)) as { models: string[] }).models;
        return Response.json({ applied: chosen });
      }
      if (path === "/api/v2" && method === "GET") {
        return Response.json(v2Settings);
      }
      if (path === "/api/injection-model" && method === "GET") {
        return Response.json({
          model: preferredModel,
          effort: null,
          available: [
            { provider: "openai", model: "gpt-5.4", namespaced: "gpt-5.4" },
            { provider: "anthropic", model: "claude-sonnet-4-6", namespaced: "anthropic/claude-sonnet-4-6" },
          ],
          efforts: [],
        });
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    },
  });
  container = testWindow.document.createElement("div") as unknown as HTMLElement;
  testWindow.document.body.appendChild(container);
});

afterEach(async () => {
  try {
    if (root) {
      const current = root;
      await act(async () => { current.unmount(); });
      root = null;
    }
  } finally {
    clearClientResourceStoresForTests();
    testWindow.close();
    for (const key of globals) {
      const descriptor = previousGlobals[key];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

async function mount() {
  // Match sibling input tests: initialize ReactDOM's event support after installing the DOM.
  const { createRoot } = await import("react-dom/client");
  await act(async () => {
    root = createRoot(container);
    root.render(<LanguageProvider><Subagents apiBase="" /></LanguageProvider>);
  });
  expect(requests.some(request => request.path === FALLBACK_PATH && request.method === "GET")).toBe(true);
  expect(editor()).toBeTruthy();
}

function editor(): HTMLElement {
  const element = container.querySelector<HTMLElement>(".swi-fallback-editor");
  if (!element) throw new Error("Fallback editor not found");
  return element;
}

function rows(): HTMLElement[] {
  return Array.from(editor().querySelectorAll<HTMLElement>(".swi-fallback-row"));
}

function expectOrder(models: string[]) {
  expect(rows()).toHaveLength(models.length);
  models.forEach((model, index) => {
    // The model span can also contain the unavailable-model warning.
    expect(rows()[index]?.querySelector("span")?.textContent?.trim().startsWith(`${index + 1}. ${model}`)).toBe(true);
    expect(rowButton(index, "sub.removeAria", model)).toBeTruthy();
  });
}

function labelledButton(scope: ParentNode, label: string): HTMLButtonElement {
  const button = Array.from(scope.querySelectorAll<HTMLButtonElement>("button"))
    .find(candidate => candidate.getAttribute("aria-label") === label);
  if (!button) throw new Error(`Button not found: ${label}`);
  return button;
}

function rowButton(index: number, key: "sub.moveUp" | "sub.moveDown" | "sub.removeAria", model: string) {
  const row = rows()[index];
  if (!row) throw new Error(`Fallback row not found: ${index}`);
  return labelledButton(row, en[key].replace("{m}", model));
}

function saveButton(scope: ParentNode = editor()): HTMLButtonElement {
  const button = Array.from(scope.querySelectorAll<HTMLButtonElement>("button"))
    .find(candidate => candidate.textContent?.trim() === en["common.save"]);
  if (!button) throw new Error("Save button not found");
  return button;
}

async function click(button: HTMLButtonElement) {
  expect(button.disabled).toBe(false);
  await act(async () => { button.click(); });
}

async function addFallback(model: string) {
  const trigger = labelledButton(editor(), en["sub.fallbackAdd"]);
  expect(trigger.getAttribute("role")).toBe("combobox");
  await click(trigger);
  // Select portals its listbox into document.body, outside the page container.
  const listbox = testWindow.document.getElementById(trigger.getAttribute("aria-controls") ?? "");
  if (!listbox) throw new Error("Fallback model listbox not found");
  const option = Array.from(listbox.querySelectorAll('[role="option"]'))
    .find(candidate => candidate.textContent?.trim() === model);
  if (!option) throw new Error(`Fallback option not found: ${model}`);
  await click(option as unknown as HTMLButtonElement);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
}

function pollInput(): HTMLInputElement {
  const input = editor().querySelector<HTMLInputElement>('input[type="number"]');
  if (!input) throw new Error("Fallback polling interval input not found");
  return input;
}

async function changePollMs(value: number) {
  await act(async () => {
    const input = pollInput();
    Object.getOwnPropertyDescriptor(testWindow.HTMLInputElement.prototype, "value")!.set!.call(input, String(value));
    input.dispatchEvent(new testWindow.Event("input", { bubbles: true }));
    input.dispatchEvent(new testWindow.Event("change", { bubbles: true }));
  });
}

function putBodies(path = FALLBACK_PATH): unknown[] {
  return requests.filter(request => request.path === path && request.method === "PUT")
    .map(request => JSON.parse(String(request.init?.body)) as unknown);
}

function cached(): CachedSubagents | null {
  return readSessionListCache<CachedSubagents>(CACHE_KEY);
}

test("preserves an unavailable configured fallback ID on load and save", async () => {
  fallbackSettings = { models: [UNAVAILABLE_MODEL, "a-2"], pollMs: 45_000 };
  expect(available).not.toContain(UNAVAILABLE_MODEL);
  await mount();

  expectOrder([UNAVAILABLE_MODEL, "a-2"]);
  expect(rows()[0]?.textContent).toContain(en["sub.fallbackUnavailable"]);
  expect(rows()[1]?.textContent).not.toContain(en["sub.fallbackUnavailable"]);
  expect(cached()?.fallback).toEqual([UNAVAILABLE_MODEL, "a-2"]);
  await click(saveButton());
  expect(putBodies()).toEqual([{ models: [UNAVAILABLE_MODEL, "a-2"], pollMs: 45_000 }]);
  expectOrder([UNAVAILABLE_MODEL, "a-2"]);
  expect(container.textContent).toContain(en["sub.fallbackSaved"]);
});

test("adds, reorders in both directions, and removes fallback models before saving their exact order", async () => {
  await mount();
  await addFallback("a-3");
  expectOrder(["a-2", "a-3"]);
  expect(rowButton(0, "sub.moveUp", "a-2").disabled).toBe(true);
  expect(rowButton(1, "sub.moveDown", "a-3").disabled).toBe(true);

  await click(rowButton(1, "sub.moveUp", "a-3"));
  expectOrder(["a-3", "a-2"]);
  await click(rowButton(0, "sub.moveDown", "a-3"));
  expectOrder(["a-2", "a-3"]);
  await addFallback("a-1");
  await click(rowButton(0, "sub.removeAria", "a-2"));
  expectOrder(["a-3", "a-1"]);
  expect(putBodies()).toEqual([]);

  await click(saveButton());
  expect(putBodies()).toEqual([{ models: ["a-3", "a-1"], pollMs: 45_000 }]);
  expect(putBodies(ROSTER_PATH)).toEqual([]);
});

test("removes only the selected duplicate fallback occurrence by index", async () => {
  fallbackSettings.models = ["a-2", "a-1", "a-2", "a-3"];
  await mount();
  expectOrder(["a-2", "a-1", "a-2", "a-3"]);

  await click(rowButton(2, "sub.removeAria", "a-2"));
  expectOrder(["a-2", "a-1", "a-3"]);
  await click(saveButton());
  expect(putBodies()).toEqual([{ models: ["a-2", "a-1", "a-3"], pollMs: 45_000 }]);
});

test("a failed fallback PUT retains the editable draft and leaves the committed cache unchanged", async () => {
  await mount();
  const committed = cached();
  expect(committed).toEqual({ available, chosen: ["a-1"], fallback: ["a-2"], pollMs: 45_000 });
  await addFallback("a-3");
  await changePollMs(90_000);
  failFallbackPut = true;
  await click(saveButton());

  expect(putBodies()).toEqual([{ models: ["a-2", "a-3"], pollMs: 90_000 }]);
  expectOrder(["a-2", "a-3"]);
  expect(pollInput().value).toBe("90000");
  expect(container.textContent).toContain("Fallback settings could not be persisted");
  expect(container.textContent).not.toContain(en["sub.fallbackSaved"]);
  expect(saveButton().disabled).toBe(false);
  expect(cached()).toEqual(committed);

  failFallbackPut = false;
  await click(saveButton());
  expect(putBodies()).toEqual([
    { models: ["a-2", "a-3"], pollMs: 90_000 },
    { models: ["a-2", "a-3"], pollMs: 90_000 },
  ]);
  expect(cached()?.fallback).toEqual(["a-2", "a-3"]);
  expect(cached()?.pollMs).toBe(90_000);
});

test("a successful fallback save updates committed session data without committing a roster draft", async () => {
  await mount();
  await click(labelledButton(container, en["sub.workspace.addToFeatured"].replace("{m}", "a-3")));
  await addFallback("a-3");
  await changePollMs(120_000);
  await click(saveButton());

  expect(putBodies()).toEqual([{ models: ["a-2", "a-3"], pollMs: 120_000 }]);
  expect(putBodies(ROSTER_PATH)).toEqual([]);
  expect(cached()).toEqual({ available, chosen: ["a-1"], fallback: ["a-2", "a-3"], pollMs: 120_000 });
  expectOrder(["a-2", "a-3"]);
  expect(container.querySelectorAll(".swi-featured-row").length).toBe(2);
});

test("independent roster Save never caches an unsaved fallback draft", async () => {
  await mount();
  await addFallback("a-3");
  await changePollMs(90_000);
  await click(labelledButton(container, en["sub.workspace.addToFeatured"].replace("{m}", "a-3")));
  const rosterSaveRow = container.querySelector(".swi-save-row");
  if (!rosterSaveRow) throw new Error("Roster Save row not found");
  await click(saveButton(rosterSaveRow));

  expect(putBodies(ROSTER_PATH)).toEqual([{ models: ["a-1", "a-3"] }]);
  expect(putBodies()).toEqual([]);
  expect(cached()).toEqual({ available, chosen: ["a-1", "a-3"], fallback: ["a-2"], pollMs: 45_000 });
  expectOrder(["a-2", "a-3"]);
  expect(pollInput().value).toBe("90000");

  // Saving the fallback afterward must retain the already committed roster.
  await click(saveButton());
  expect(putBodies()).toEqual([{ models: ["a-2", "a-3"], pollMs: 90_000 }]);
  expect(cached()).toEqual({ available, chosen: ["a-1", "a-3"], fallback: ["a-2", "a-3"], pollMs: 90_000 });
});

test("remount shows the committed fallback and roster while a fresh fallback GET is pending", async () => {
  await mount();
  await addFallback("a-3");
  await changePollMs(120_000);
  await click(saveButton());

  // A later roster save must not commit these newer fallback edits.
  await click(rowButton(0, "sub.removeAria", "a-2"));
  await changePollMs(90_000);
  await click(labelledButton(container, en["sub.workspace.addToFeatured"].replace("{m}", "a-3")));
  const rosterSaveRow = container.querySelector(".swi-save-row");
  if (!rosterSaveRow) throw new Error("Roster Save row not found");
  await click(saveButton(rosterSaveRow));
  expectOrder(["a-3"]);
  expect(pollInput().value).toBe("90000");

  const current = root!;
  await act(async () => { current.unmount(); });
  root = null;
  // Keep sessionStorage, but discard the resource store so it cannot mask a stale session seed.
  clearClientResourceStoresForTests();
  const getsBefore = requests.filter(request => request.path === FALLBACK_PATH && request.method === "GET").length;
  let releaseGet!: () => void;
  fallbackGetGate = new Promise<void>(resolve => { releaseGet = resolve; });
  try {
    await mount();
    expect(requests.filter(request => request.path === FALLBACK_PATH && request.method === "GET")).toHaveLength(getsBefore + 1);
    // These assertions run before the fresh GET can return any data.
    expectOrder(["a-2", "a-3"]);
    expect(pollInput().value).toBe("120000");
    expect(Array.from(container.querySelectorAll(".swi-featured-name"), node => node.textContent?.trim()))
      .toEqual(["a-1", "a-3"]);
    expect(cached()).toEqual({ available, chosen: ["a-1", "a-3"], fallback: ["a-2", "a-3"], pollMs: 120_000 });
  } finally {
    await act(async () => { releaseGet(); });
    fallbackGetGate = null;
  }
  expectOrder(["a-2", "a-3"]);
  expect(pollInput().value).toBe("120000");
});

test("invalid polling intervals disable Save without a PUT or cache mutation, and a valid interval recovers", async () => {
  await mount();
  const committed = cached();
  for (const interval of [0, 4_999, 600_001, 5_000.5]) {
    await changePollMs(interval);
    expect(pollInput().getAttribute("aria-invalid")).toBe("true");
    expect(editor().querySelector('[role="alert"]')?.textContent).toContain(en["sub.fallbackPollInvalid"]);
    expect(saveButton().disabled).toBe(true);
    await act(async () => { saveButton().click(); });
    expect(putBodies()).toEqual([]);
    expect(cached()).toEqual(committed);
  }

  await changePollMs(5_000);
  expect(pollInput().getAttribute("aria-invalid")).toBe("false");
  expect(editor().querySelector('[role="alert"]')).toBeNull();
  await click(saveButton());
  expect(putBodies()).toEqual([{ models: ["a-2"], pollMs: 5_000 }]);
  expect(cached()?.pollMs).toBe(5_000);
});

const compatibilityCases: Array<{
  name: string;
  model: string;
  enabled: boolean;
  mode: V2Settings["multiAgentMode"];
  keepNative: boolean;
  warning: boolean;
}> = [
  { name: "native preferred model", model: "gpt-5.4", enabled: true, mode: "v2", keepNative: false, warning: false },
  { name: "routed preferred model on the default surface", model: "anthropic/claude-sonnet-4-6", enabled: false, mode: "default", keepNative: false, warning: true },
  { name: "routed preferred model on V1", model: "anthropic/claude-sonnet-4-6", enabled: false, mode: "v1", keepNative: false, warning: false },
  { name: "forced V2 preserving native V1 with global V2 disabled", model: "anthropic/claude-sonnet-4-6", enabled: false, mode: "v2", keepNative: true, warning: false },
  { name: "global V2 enabled despite native V1 preservation", model: "anthropic/claude-sonnet-4-6", enabled: true, mode: "v2", keepNative: true, warning: true },
];

test.each(compatibilityCases)("V2 compatibility guidance: $name", async ({ model, enabled, mode, keepNative, warning }) => {
  preferredModel = model;
  v2Settings = { enabled, multiAgentMode: mode, multiAgentModeHintText: null, keepNativeChatGptOnV1: keepNative };
  await mount();

  const note = container.querySelector('.swi-v2-compatibility[role="note"]');
  if (warning) {
    expect(note).toBeTruthy();
    expect(note?.textContent).toContain(en["sub.v2Compatibility.title"]);
    expect(note?.textContent).toContain(en["sub.v2Compatibility.risk"]);
    // The response exposes no recovery state: guidance must explicitly say it is unknown.
    expect(note?.textContent).toContain(en["sub.v2Compatibility.recoveryUnknown"]);
    expect(note?.querySelector("a")?.getAttribute("href")).toBe("https://github.com/lidge-jun/opencodex/issues/92");
    expect(note?.querySelector('[role="switch"], [aria-pressed], input[type="checkbox"]')).toBeNull();
  } else {
    expect(note).toBeNull();
    expect(container.textContent).not.toContain(en["sub.v2Compatibility.recoveryUnknown"]);
  }
  expect(requests.filter(request => request.method !== "GET")).toEqual([]);
});
