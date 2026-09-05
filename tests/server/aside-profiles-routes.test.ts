import { loadConfig } from "../../src/config";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleManagementAPI } from "../../src/server/management-api";
import { setIntegrationMutationFlightTestHooks, setIntegrationPathTestHooks } from "../../src/server/management/integration-routes";
import { createIntegrationStateStore, type IntegrationStateStore } from "../../src/integrations/store";
import { applyIntegration } from "../../src/integrations/writer";
import { refreshOwnedCatalogIntegrations } from "../../src/integrations/catalog-refresh";
import type { OcxConfig } from "../../src/types";
import { catalogConvergenceFactory } from "../helpers/catalog-convergence";
import { installIsolatedCodexHome, type IsolatedCodexHome } from "../helpers/isolated-codex-home";
import { removeTreeWithRetry } from "../helpers/remove-tree";

let root: string;
let home: string;
let store: IntegrationStateStore;
let config: OcxConfig;
let isolation: IsolatedCodexHome;
let priorOcxHome: string | undefined;
let saved: OcxConfig | undefined;
const env: NodeJS.ProcessEnv = {};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ocx-aside-profile-routes-"));
  home = join(root, "home");
  priorOcxHome = process.env.OPENCODEX_HOME;
  process.env.OPENCODEX_HOME = join(root, "config");
  isolation = installIsolatedCodexHome("ocx-aside-profile-codex-");
  store = createIntegrationStateStore(join(root, "store"));
  mkdirSync(join(home, ".aside"), { recursive: true });
  writeFileSync(join(home, ".aside", "accounts.json"), JSON.stringify({
    currentAccountId: 0, accounts: [{ id: 0, name: "Primary" }, { id: 1, name: "Local one" }, { id: 2, name: "Local two" }],
    sessions: { private: { accessToken: "do-not-project" } },
  }));
  for (const id of [0,1,2]) {
    mkdirSync(join(home, ".aside", "u", String(id)), { recursive: true });
    writeFileSync(path(id), JSON.stringify({ theme: "keep", providers: { personal: { models: [] } } }));
  }
  config = { port: 10100, hostname: "127.0.0.1", defaultProvider: "fixture", fastRows: false, providers: {
    fixture: { adapter: "openai-chat", baseUrl: "https://fixture.invalid/v1", liveModels: false, models: ["one","two"] },
  } } as OcxConfig;
  saved = undefined;
  setIntegrationPathTestHooks({ home, env });
  setIntegrationMutationFlightTestHooks({ store });
});

afterEach(() => {
  setIntegrationPathTestHooks(null);
  setIntegrationMutationFlightTestHooks(null);
  isolation.restore();
  if (priorOcxHome === undefined) delete process.env.OPENCODEX_HOME;
  else process.env.OPENCODEX_HOME = priorOcxHome;
  removeTreeWithRetry(root);
});

function path(id: number): string { return join(home, ".aside", "u", String(id), "models.json"); }
function document(id: number) { return JSON.parse(readFileSync(path(id), "utf8")); }
async function api(pathname: string, method = "GET", body?: unknown) {
  const url = new URL(`http://127.0.0.1:10100${pathname}`);
  const response = await handleManagementAPI(new Request(url, {
    method, headers: { Host: url.host, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), url, config, {
    saveConfigPreservingClaudeCode: value => { saved = structuredClone(value); },
    createManagementConvergeCodex: catalogConvergenceFactory(),
    refreshOwnedCatalogIntegrations: input => refreshOwnedCatalogIntegrations({ ...input, store, env, home }),
  });
  if (!response) throw new Error("route missing");
  return response;
}

test("legacy connection refreshes all profiles, and an individual off survives selection refresh and reload", async () => {
  expect(applyIntegration({ clientId: "aside", config, port: 10100, store, env, home,
    models: [{ provider: "fixture", id: "one", namespaced: "fixture/one" }] }).ok).toBe(true);
  const initial = await (await api("/api/client-integrations/aside/profiles")).json();
  expect(initial.profiles).toHaveLength(3);
  expect(JSON.stringify(initial)).not.toContain("do-not-project");
  expect((await api("/api/selected-models", "PUT", { provider: "fixture", models: ["one"] })).status).toBe(200);
  for (const id of [0,1,2]) {
    expect(document(id).providers.opencodex.models.filter((m: { id: string }) => m.id.startsWith("fixture/")).map((m: { id: string }) => m.id)).toEqual(["fixture/one"]);
    expect(document(id).theme).toBe("keep");
    expect(document(id).providers.personal).toEqual({ models: [] });
  }
  expect((await api("/api/client-integrations/aside?profile=1", "PUT", { enabled: false })).status).toBe(200);
  config = structuredClone(saved!);
  expect((await api("/api/selected-models", "PUT", { provider: "fixture", models: ["two"] })).status).toBe(200);
  expect(document(1).providers.opencodex).toBeUndefined();
  for (const id of [0,2]) expect(document(id).providers.opencodex.models.some((m: { id: string }) => m.id === "fixture/two")).toBe(true);
  const state = await (await api("/api/client-integrations/aside?profile=1")).json();
  expect(state).toMatchObject({ profileId: 1, enabled: false, state: "absent" });
});

test("profile history and Undo cannot recreate an undone enable on the next sync", async () => {
  const enabled = await (await api("/api/client-integrations/aside?profile=2", "PUT", { enabled: true })).json();
  expect(enabled.ok).toBe(true);
  const journal = await (await api("/api/client-integrations/journal?client=aside&profile=2")).json();
  expect(journal.operations[0]).toMatchObject({ profileId: 2, opId: enabled.opId, undoable: true });
  expect((await api("/api/client-integrations/restore?client=aside&profile=2", "POST", { opId: enabled.opId })).status).toBe(200);
  config = structuredClone(saved!);
  await api("/api/selected-models", "PUT", { provider: "fixture", models: ["one"] });
  expect(document(2).providers.opencodex).toBeUndefined();
  expect(document(0).providers.opencodex).toBeUndefined();
});

test.each(["../0", "01", "-1", "9007199254740992"])("rejects invalid profile %s before file mutation", async id => {
  const before = [0,1,2].map(i => readFileSync(path(i), "utf8"));
  const response = await api(`/api/client-integrations/aside?profile=${encodeURIComponent(id)}`, "PUT", { enabled: true });
  expect(response.status).toBe(400);
  expect([0,1,2].map(i => readFileSync(path(i), "utf8"))).toEqual(before);
  expect(saved).toBeUndefined();
});

test("a non-Aside client cannot silently consume a profile selector", async () => {
  expect((await api("/api/client-integrations/pi?profile=0", "PUT", { enabled: true })).status).toBe(400);
  expect(saved).toBeUndefined();
});


test("invalid persisted profile policy fails closed without resetting the surrounding config", () => {
  const configRoot = process.env.OPENCODEX_HOME!;
  mkdirSync(configRoot, { recursive: true });
  writeFileSync(join(configRoot, "config.json"), JSON.stringify({ ...config, asideProfileSync: { allProfiles: true, profiles: { "1": "off" } } }));
  const loaded = loadConfig();
  expect(loaded.asideProfileSync).toEqual({ allProfiles: false });
  expect(loaded.port).toBe(10100);
  expect(loaded.providers.fixture).toBeDefined();
});
