/**
 * The two destination contracts a process on the hub's own machine has (#4236).
 *
 * The defect this closes: eight local integrations hardcoded `http://127.0.0.1:<public port>`,
 * an address that does not exist on a hub whose listener binds a tailnet IP. The fix is NOT one
 * base URL substituted everywhere (maintainer review on #4236) — management discovery and
 * inference are different surfaces with different admission rules, so they get one resolver
 * each and these tests hold them apart.
 */
import { describe, expect, test } from "bun:test";
import {
  localInferenceOrigin,
  localInferencePort,
  localManagementOrigin,
} from "../../src/lib/local-destinations";
import type { OcxConfig } from "../../src/types";

const TAILNET = "100.76.170.81";
const PUBLIC_PORT = 10_100;

function hub(extra: Partial<OcxConfig> = {}): OcxConfig {
  return {
    port: PUBLIC_PORT,
    hostname: TAILNET,
    runtimeRole: "hub",
    defaultProvider: "openai",
    providers: { openai: { adapter: "openai-responses", baseUrl: "https://chatgpt.com/backend-api/codex" } },
    ...extra,
  } as unknown as OcxConfig;
}

describe("localInferencePort / localInferenceOrigin", () => {
  test("a ported listener is the destination; a companion listener is the public port", () => {
    expect(localInferencePort(hub({ unauthenticatedLoopbackListener: { enabled: true, port: 10_104 } }), PUBLIC_PORT))
      .toBe(10_104);
    expect(localInferencePort(hub({ unauthenticatedLoopbackListener: { enabled: true } }), PUBLIC_PORT))
      .toBe(PUBLIC_PORT);
  });

  test("no listener, a disabled listener, and no config all keep the public port", () => {
    // This is the "nothing changes on a plain loopback or standalone install" guarantee: every
    // call site that used to spell `http://127.0.0.1:${port}` gets that exact string back.
    expect(localInferencePort(hub(), PUBLIC_PORT)).toBe(PUBLIC_PORT);
    expect(localInferencePort(hub({ unauthenticatedLoopbackListener: { enabled: false } }), PUBLIC_PORT))
      .toBe(PUBLIC_PORT);
    expect(localInferencePort(undefined, PUBLIC_PORT)).toBe(PUBLIC_PORT);
    expect(localInferencePort({}, PUBLIC_PORT)).toBe(PUBLIC_PORT);
  });

  test("the origin is always loopback, never the bind address", () => {
    // A tailnet or LAN address in a local client's base URL is the #4236 defect in reverse:
    // the client would then need an admission credential it has no way to obtain.
    for (const listener of [
      undefined,
      { enabled: false } as const,
      { enabled: true } as const,
      { enabled: true, port: 10_104 } as const,
    ]) {
      const origin = localInferenceOrigin(
        hub(listener === undefined ? {} : { unauthenticatedLoopbackListener: listener }),
        PUBLIC_PORT,
      );
      expect({ listener, host: new URL(origin).hostname }).toEqual({ listener, host: "127.0.0.1" });
      expect({ listener, protocol: new URL(origin).protocol }).toEqual({ listener, protocol: "http:" });
    }
    expect(localInferenceOrigin(hub({ unauthenticatedLoopbackListener: { enabled: true, port: 10_104 } }), PUBLIC_PORT))
      .toBe("http://127.0.0.1:10104");
  });
});

describe("localManagementOrigin", () => {
  test("a hub with an enabled ingress is asked on the ingress port", () => {
    expect(localManagementOrigin(
      hub({ hub: { managementIngress: { enabled: true, port: 10_102 } } }),
      PUBLIC_PORT,
    )).toBe("http://127.0.0.1:10102");
  });

  test("the loopback listener never answers management, so it is never used here", () => {
    // `/api/*` is deliberately absent from that listener's allowlist. Resolving management to
    // it would 404 every discovery call while looking like a reachable local port.
    const origin = localManagementOrigin(
      hub({
        hub: { managementIngress: { enabled: true, port: 10_102 } },
        unauthenticatedLoopbackListener: { enabled: true, port: 10_104 },
      }),
      PUBLIC_PORT,
    );
    expect(origin).toBe("http://127.0.0.1:10102");
    expect(origin).not.toContain("10104");
  });

  test("a disabled or absent ingress falls back to the bind address and public port", () => {
    expect(localManagementOrigin(hub(), PUBLIC_PORT)).toBe(`http://${TAILNET}:10100`);
    expect(localManagementOrigin(hub({ hub: { managementIngress: { enabled: false } } }), PUBLIC_PORT))
      .toBe(`http://${TAILNET}:10100`);
  });

  test("an ingress only counts on a hub, because only a hub binds one", () => {
    for (const runtimeRole of [undefined, "standalone", "client"] as const) {
      const origin = localManagementOrigin(
        hub({ runtimeRole, hostname: "127.0.0.1", hub: { managementIngress: { enabled: true, port: 10_102 } } }),
        PUBLIC_PORT,
      );
      expect({ runtimeRole, origin }).toEqual({ runtimeRole, origin: "http://127.0.0.1:10100" });
    }
  });

  test("loopback and wildcard binds resolve exactly as the old hardcoded string did", () => {
    const cases: Array<[string | undefined, string]> = [
      [undefined, "http://127.0.0.1:10100"],
      ["127.0.0.1", "http://127.0.0.1:10100"],
      ["0.0.0.0", "http://127.0.0.1:10100"],
      ["::", "http://127.0.0.1:10100"],
      // A bare IPv6 literal has to be bracketed or the URL is unparseable.
      ["fd7a:115c:a1e0::1", "http://[fd7a:115c:a1e0::1]:10100"],
      ["localhost", "http://localhost:10100"],
    ];
    for (const [hostname, expected] of cases) {
      const config = hub({ runtimeRole: "standalone", ...(hostname === undefined ? {} : { hostname }) });
      if (hostname === undefined) delete (config as { hostname?: string }).hostname;
      expect({ hostname, origin: localManagementOrigin(config, PUBLIC_PORT) }).toEqual({ hostname, origin: expected });
    }
  });
});
