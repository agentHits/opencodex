import { afterEach, expect, test } from "bun:test";
import { fetchDashboardOverview } from "../src/pages/dashboard-core-poll";

const originalFetch = globalThis.fetch;
const health = { status: "ok", version: "1.0.0", uptime: 10 };
const providers = [{ name: "fixture", adapter: "openai-chat", baseUrl: "https://fixture.example.test", hasApiKey: false }];
afterEach(() => { globalThis.fetch = originalFetch; });

test.each([[401, "auth"], [403, "denied"], [500, "request"]] as const)("HTTP %i has its own dashboard failure meaning", async (status, failure) => {
  globalThis.fetch = (async () => new Response(null, { status })) as typeof fetch;
  expect(await fetchDashboardOverview("", new AbortController().signal)).toMatchObject({ error: true, failure });
});

test.each([{}, { ...health, uptime: "ten" }, { ...health, uptime: -1 }])("malformed health JSON is not treated as a stopped proxy", async invalid => {
  globalThis.fetch = (async input => Response.json(String(input).endsWith("/api/providers") ? providers : invalid)) as typeof fetch;
  expect(await fetchDashboardOverview("", new AbortController().signal)).toMatchObject({ failure: "invalid" });
});

test.each([{}, [null], [{ name: "fixture" }]])("malformed providers are rejected before caching", async invalid => {
  globalThis.fetch = (async input => Response.json(String(input).endsWith("/api/providers") ? invalid : health)) as typeof fetch;
  expect(await fetchDashboardOverview("", new AbortController().signal)).toMatchObject({ failure: "invalid" });
});

test("valid dashboard response retains the existing success shape", async () => {
  globalThis.fetch = (async input => Response.json(String(input).endsWith("/api/providers") ? providers : health)) as typeof fetch;
  expect(await fetchDashboardOverview("", new AbortController().signal)).toEqual({ health, providers, error: false });
});

test("transport failure is distinct from cancelled polling", async () => {
  globalThis.fetch = (async () => { throw new TypeError("network unavailable"); }) as typeof fetch;
  expect(await fetchDashboardOverview("", new AbortController().signal)).toMatchObject({ failure: "unavailable" });
  const controller = new AbortController(); controller.abort();
  await expect(fetchDashboardOverview("", controller.signal)).rejects.toThrow();
});
