import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getConfigPath,
  getDefaultConfig,
  loadConfig,
  readConfigDiagnostics,
  saveConfig,
  validateConfigCandidate,
} from "../../src/config";
import { removeTreeWithRetry } from "../helpers/remove-tree";

let home = "";
let previousHome: string | undefined;

beforeEach(() => {
  previousHome = process.env.OPENCODEX_HOME;
  home = mkdtempSync(join(tmpdir(), "ocx-display-names-config-"));
  process.env.OPENCODEX_HOME = home;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.OPENCODEX_HOME;
  else process.env.OPENCODEX_HOME = previousHome;
  removeTreeWithRetry(home);
});

function candidate(modelDisplayNames: unknown) {
  const defaults = getDefaultConfig();
  return {
    ...defaults,
    defaultProvider: "xai",
    providers: {
      xai: {
        adapter: "openai-responses",
        baseUrl: "https://api.x.ai/v1",
        note: "keep me",
        modelDisplayNames,
      },
    },
  };
}

function writeCandidate(modelDisplayNames: unknown, provider = "xai"): void {
  const config = candidate(modelDisplayNames);
  config.defaultProvider = provider;
  config.providers = {
    [provider]: {
      ...config.providers.xai,
      modelDisplayNames,
    },
  };
  writeFileSync(getConfigPath(), JSON.stringify(config), "utf8");
}

test("config validation accepts only safe provider model display names", () => {
  const valid = validateConfigCandidate(candidate({
    "grok-4.6": "Grok 4.6",
    "models/grok-vision": "Grok Vision",
  }));
  expect(valid.ok).toBe(true);

  const invalid = validateConfigCandidate(candidate({ "grok-4.6": "Grok/4.6" }));
  expect(invalid.ok).toBe(false);
  if (!invalid.ok) expect(invalid.error).toContain("modelDisplayNames");
});

test("load keeps a provider and valid labels when one hand edited label is invalid", () => {
  writeCandidate({
    "grok-4.6": "  Grok 4.6  ",
    "future-model": "Future Model",
    unsafe: "Bad/Name",
  });

  const loaded = loadConfig();

  expect(loaded.providers.xai).toMatchObject({
    note: "keep me",
    modelDisplayNames: {
      "grok-4.6": "Grok 4.6",
      "future-model": "Future Model",
    },
  });
  expect(loaded.providers.xai.modelDisplayNames).not.toHaveProperty("unsafe");
});

test("load and save preserve a prototype shaped model id as data", () => {
  writeCandidate(JSON.parse('{"__proto__":"Prototype Model"}'));

  const loaded = loadConfig();

  expect(Object.hasOwn(loaded.providers.xai.modelDisplayNames ?? {}, "__proto__")).toBe(true);
  expect(loaded.providers.xai.modelDisplayNames?.["__proto__"]).toBe("Prototype Model");

  saveConfig(loaded);
  const reloaded = loadConfig();

  expect(Object.hasOwn(reloaded.providers.xai.modelDisplayNames ?? {}, "__proto__")).toBe(true);
  expect(reloaded.providers.xai.modelDisplayNames?.["__proto__"]).toBe("Prototype Model");
});

test("load drops only a malformed display name map", () => {
  writeCandidate("not-an-object");

  const loaded = loadConfig();

  expect(loaded.providers.xai).toMatchObject({ note: "keep me" });
  expect(loaded.providers.xai.modelDisplayNames).toBeUndefined();
});

test("load warnings never reveal display values or secret shaped provider names", () => {
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  try {
    const displaySecret = ["sk", "secret", "display", "value"].join("-");
    const providerSecret = ["sk", "secret", "provider", "name"].join("-");
    writeCandidate({ model: `${displaySecret}/unsafe` }, providerSecret);

    const loaded = loadConfig();

    expect(loaded.providers[providerSecret]).toBeDefined();
    const output = warn.mock.calls.map(call => call.join(" ")).join("\n");
    expect(output).not.toContain(displaySecret);
    expect(output).not.toContain(providerSecret);
    expect(output).toContain("[REDACTED]");
  } finally {
    warn.mockRestore();
  }
});


test("Fast rows default on for fresh and omitted config; explicit false and malformed values disable", () => {
  expect(getDefaultConfig().fastRows).toBe(true);
  for (const [value, expected] of [[undefined, true], [true, true], [false, false], ["invalid", false]] as const) {
    const config = { ...candidate({}), fastRows: value };
    writeFileSync(getConfigPath(), JSON.stringify(config), "utf8");
    const loaded = loadConfig();
    expect(loaded.fastRows).toBe(expected);
    expect(loaded.providers.xai.note).toBe("keep me");
  }
});


test.each([
  { enabled: "true" },
  { enabled: true, port: 70000 },
  "secret-shaped-malformed-listener-value",
])("malformed optional listeners warn without discarding unrelated settings: %j", listener => {
  const config = { ...candidate(undefined),
    apiKeys: [{ id: "preserved", name: "preserved", key: "fixture-key", createdAt: "2026-01-01" }],
    unauthenticatedLoopbackListener: listener,
    hub: { managementIngress: listener },
  };
  const bytes = JSON.stringify(config);
  writeFileSync(getConfigPath(), bytes);
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  try {
    const loaded = loadConfig();
    expect(loaded.providers.xai.note).toBe("keep me");
    expect(loaded.apiKeys?.[0]?.id).toBe("preserved");
    expect(loaded.unauthenticatedLoopbackListener).toBeUndefined();
    expect(loaded.hub?.managementIngress).toBeUndefined();
    const messages = warn.mock.calls.flat().join("\n");
    expect(messages).toContain("unauthenticatedLoopbackListener ignored");
    expect(messages).toContain("hub.managementIngress ignored");
    expect(messages).not.toContain("secret-shaped-malformed-listener-value");
    const diagnostics = readConfigDiagnostics();
    expect(diagnostics.warnings?.join("\n")).toContain("unauthenticatedLoopbackListener ignored");
    expect(diagnostics.warnings?.join("\n")).toContain("hub.managementIngress ignored");
    expect(readFileSync(getConfigPath(), "utf8")).toBe(bytes);
  } finally { warn.mockRestore(); }
});

test.each([undefined, { enabled: false }])("absent or disabled listeners do not produce degradation warnings: %j", listener => {
  writeFileSync(getConfigPath(), JSON.stringify({ ...candidate(undefined),
    unauthenticatedLoopbackListener: listener, hub: { managementIngress: listener },
  }));
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  try {
    loadConfig();
    const messages = warn.mock.calls.flat().join("\n");
    expect(messages).not.toContain("Listener ignored");
    expect(messages).not.toContain("managementIngress ignored");
  } finally { warn.mockRestore(); }
});

test("salvaged diagnostics retain listener warnings alongside the routing error", () => {
  const bytes = JSON.stringify({ ...candidate(undefined),
    routingProfiles: { bad: { candidates: [{ provider: "xai", model: "model" }] } },
    unauthenticatedLoopbackListener: { enabled: "true" },
    hub: { managementIngress: { enabled: true, port: 70000 } },
  });
  writeFileSync(getConfigPath(), bytes);
  const diagnostics = readConfigDiagnostics();
  expect(diagnostics.source).toBe("fallback");
  expect(diagnostics.error).toContain("routingProfiles");
  expect(diagnostics.config.providers.xai.note).toBe("keep me");
  expect(diagnostics.warnings?.join("\n")).toContain("unauthenticatedLoopbackListener ignored");
  expect(diagnostics.warnings?.join("\n")).toContain("hub.managementIngress ignored");
  expect(readFileSync(getConfigPath(), "utf8")).toBe(bytes);
});
