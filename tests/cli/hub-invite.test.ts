import { describe, expect, spyOn, test } from "bun:test";
import {
  derivedHubDataOrigin,
  hubInviteCommand,
  pairingOriginUsable,
  parseHubInviteArgs,
  parseInviteClients,
  runHubCommand,
  selectInviteBrowserOrigin,
} from "../../src/cli/hub";
import type { GuiPairRequestResult } from "../../src/cli/gui-pair-client";
import type { LiveProxy } from "../../src/server/proxy-liveness";
import type { OcxConfig } from "../../src/types";

/**
 * `ocx hub invite` (#4236).
 *
 * The command's whole value is that the line it prints can be pasted on the other machine and
 * work, so these tests pin the two things that decide that: WHICH origins end up in the command,
 * and WHICH configurations are refused before a single-use code is burned on a request the hub
 * would have rejected anyway.
 *
 * The mint itself is not re-tested here -- it is the existing attested `ocx gui pair` route, and
 * `requestPairingGrant` is injected so no proxy, no socket and no real grant is involved.
 */
const GRANT = `ocx_pair_${"A".repeat(43)}`;
const EXPIRES_AT = 1_767_225_600_000;

const LIVE: LiveProxy = { pid: 4242, port: 10100, hostname: "100.64.0.10", source: "runtime" };

function hubConfig(overrides: Partial<OcxConfig> = {}): OcxConfig {
  return {
    port: 10100,
    hostname: "100.64.0.10",
    runtimeRole: "hub",
    corsAllowOrigins: ["http://localhost:10100"],
    hub: { managementPublicOrigin: "https://hub.tailnet.ts.net" },
    ...overrides,
  } as OcxConfig;
}

async function invite(
  args: string[],
  config: OcxConfig,
  options: { live?: LiveProxy | null; result?: GuiPairRequestResult } = {},
): Promise<{ code: number; out: string[]; err: string[]; boundOrigin: string | null }> {
  const out: string[] = [];
  const err: string[] = [];
  const log = spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    out.push(parts.map(String).join(" "));
  });
  const error = spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
    err.push(parts.map(String).join(" "));
  });
  let boundOrigin: string | null = null;
  try {
    const code = await runHubCommand(args, {
      loadConfig: () => config,
      findLiveProxy: async () => (options.live === undefined ? LIVE : options.live),
      requestPairingGrant: async (_target, browserOrigin) => {
        boundOrigin = browserOrigin;
        return options.result ?? {
          kind: "created",
          grant: GRANT,
          browserOrigin,
          serverOrigin: "https://hub.tailnet.ts.net",
          expiresAt: EXPIRES_AT,
        };
      },
    });
    return { code, out, err, boundOrigin };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}

describe("hub invite argument and origin helpers", () => {
  test("parses the documented flags and rejects anything else", () => {
    expect(parseHubInviteArgs([])).toEqual({ json: false });
    expect(parseHubInviteArgs(["--json"])).toEqual({ json: true });
    expect(parseHubInviteArgs(["--data-url", "https://a.test:8443", "--clients", "codex"]))
      .toEqual({ json: false, dataUrl: "https://a.test:8443", clients: "codex" });
    // A repeated flag, a missing value, and an unknown token are all usage errors rather than
    // a silently-dropped argument: the printed command is what the operator will run.
    expect(parseHubInviteArgs(["--json", "--json"])).toBeNull();
    expect(parseHubInviteArgs(["--data-url"])).toBeNull();
    expect(parseHubInviteArgs(["--data-url", "--json"])).toBeNull();
    expect(parseHubInviteArgs(["--origin", "x"])).toBeNull();
  });

  test("clients accepts codex and claude only, and omission means 'do not pass --clients'", () => {
    expect(parseInviteClients(undefined)).toEqual([]);
    expect(parseInviteClients("codex,claude")).toEqual(["codex", "claude"]);
    expect(parseInviteClients("claude")).toEqual(["claude"]);
    expect(parseInviteClients("cursor")).toBeNull();
    expect(parseInviteClients("")).toBeNull();
  });

  test("the transport rule matches the hub's: loopback or HTTPS, nothing else", () => {
    expect(pairingOriginUsable("https://hub.tailnet.ts.net")).toBe(true);
    expect(pairingOriginUsable("http://127.0.0.1:10101")).toBe(true);
    expect(pairingOriginUsable("http://localhost:10101")).toBe(true);
    expect(pairingOriginUsable("http://100.64.0.10:10101")).toBe(false);
  });

  test("the derived data origin is the bind address, with loopback spelled as localhost", () => {
    expect(derivedHubDataOrigin("100.64.0.10", 10100)).toBe("http://100.64.0.10:10100");
    expect(derivedHubDataOrigin("0.0.0.0", 10100)).toBe("http://localhost:10100");
    expect(derivedHubDataOrigin("fd7a::1", 8443)).toBe("http://[fd7a::1]:8443");
  });

  test("the grant binds to the connecting machine's loopback origin, not the hub's", () => {
    // `ocx connect` sends Origin: http://localhost:<its own port> (client/connect.ts
    // localGuiOrigin), so only a loopback entry in the hub's allow-list can ever match.
    expect(selectInviteBrowserOrigin(hubConfig())).toBe("http://localhost:10100");
    expect(selectInviteBrowserOrigin(hubConfig({ corsAllowOrigins: ["http://localhost:9999"] })))
      .toBe("http://localhost:9999");
    expect(selectInviteBrowserOrigin(hubConfig({ corsAllowOrigins: ["https://elsewhere.test"] })))
      .toBeNull();
  });

  test("the printed command carries --clients only when the operator asked for it", () => {
    expect(hubInviteCommand(GRANT, "https://d.test:8443", "https://m.test", []))
      .toBe(`echo '${GRANT}' | ocx connect https://d.test:8443 --management-url https://m.test --pairing-code-stdin`);
    expect(hubInviteCommand(GRANT, "https://d.test:8443", "https://m.test", ["codex"]))
      .toContain("--clients codex --pairing-code-stdin");
  });
});

describe("hub invite output", () => {
  test("prints a runnable connect line and keeps the code off stderr", async () => {
    const { code, out, err, boundOrigin } = await invite(["invite"], hubConfig());
    expect(code).toBe(0);
    expect(boundOrigin).toBe("http://localhost:10100");
    expect(out.join("\n")).toContain("# Run on the other machine:");
    expect(out.join("\n")).toContain(
      `echo '${GRANT}' | ocx connect http://100.64.0.10:10100 --management-url https://hub.tailnet.ts.net --pairing-code-stdin`,
    );
    // The warning is advice, not output a script should capture.
    expect(err.join("\n")).toContain("single-use");
    expect(err.join("\n")).not.toContain(GRANT);
  });

  test("hub.dataPublicOrigin replaces the derived origin, and --data-url replaces both", async () => {
    const configured = hubConfig({
      hub: { managementPublicOrigin: "https://hub.tailnet.ts.net", dataPublicOrigin: "https://hub.tailnet.ts.net:8443" },
    });
    const fromConfig = await invite(["invite"], configured);
    expect(fromConfig.out.join("\n")).toContain("ocx connect https://hub.tailnet.ts.net:8443 ");

    const overridden = await invite(["invite", "--data-url", "https://front.test"], configured);
    expect(overridden.out.join("\n")).toContain("ocx connect https://front.test ");
  });

  test("--json emits exactly the documented envelope", async () => {
    const { code, out } = await invite(["invite", "--json", "--clients", "codex,claude"], hubConfig());
    expect(code).toBe(0);
    expect(JSON.parse(out[0]!)).toEqual({
      code: GRANT,
      expiresAt: new Date(EXPIRES_AT).toISOString(),
      dataUrl: "http://100.64.0.10:10100",
      managementUrl: "https://hub.tailnet.ts.net",
      command: `echo '${GRANT}' | ocx connect http://100.64.0.10:10100 --management-url https://hub.tailnet.ts.net --clients codex,claude --pairing-code-stdin`,
    });
  });
});

describe("hub invite refuses before burning a code", () => {
  test("a non-hub gets one line naming its own role and the command it should run", async () => {
    for (const role of [undefined, "standalone", "client"] as const) {
      const { code, err } = await invite(["invite"], hubConfig({ runtimeRole: role } as Partial<OcxConfig>));
      expect(code).toBe(1);
      expect(err.join(" ")).toContain("runs on a hub");
      expect(err.join(" ")).toContain("ocx connect");
    }
  });

  test("a hub with no management origin is told which field to set", async () => {
    const { code, err } = await invite(["invite"], hubConfig({ hub: {} }));
    expect(code).toBe(1);
    expect(err.join(" ")).toContain("hub.managementPublicOrigin");
  });

  test("a --management-url that differs from the configured origin is refused, not printed", async () => {
    // The grant's server origin IS hub.managementPublicOrigin, so advertising anything else
    // hands out a code the hub then refuses. Saying so beats printing a dud command.
    const { code, err } = await invite(["invite", "--management-url", "https://other.test"], hubConfig());
    expect(code).toBe(1);
    expect(err.join(" ")).toContain("does not match hub.managementPublicOrigin");

    const matching = await invite(["invite", "--management-url", "https://hub.tailnet.ts.net"], hubConfig());
    expect(matching.code).toBe(0);
  });

  test("a non-loopback plaintext management origin cannot carry a code", async () => {
    const { code, err } = await invite(["invite"], hubConfig({
      hub: { managementPublicOrigin: "http://100.64.0.10:10101" },
    }));
    expect(code).toBe(1);
    expect(err.join(" ")).toContain("plain HTTP");
  });

  test("a hub whose allow-list names no loopback origin is told exactly what to add", async () => {
    const { code, err } = await invite(["invite"], hubConfig({ corsAllowOrigins: [] }));
    expect(code).toBe(1);
    expect(err.join(" ")).toContain("corsAllowOrigins");
    expect(err.join(" ")).toContain("http://localhost:10100");
  });

  test("no running hub, a malformed origin, and a refused mint each exit 1 with a reason", async () => {
    const down = await invite(["invite"], hubConfig(), { live: null });
    expect(down.code).toBe(1);
    expect(down.err.join(" ")).toContain("No running attested OpenCodex hub");

    const bad = await invite(["invite", "--data-url", "https://front.test/path"], hubConfig());
    expect(bad.code).toBe(1);
    expect(bad.err.join(" ")).toContain("--data-url must be a bare http(s) origin");

    const refused = await invite(["invite"], hubConfig(), {
      result: { kind: "unavailable", reason: "attestation" },
    });
    expect(refused.code).toBe(1);
    expect(refused.err.join(" ")).toContain("(attestation)");
  });

  test("an unknown subcommand prints usage rather than guessing invite", async () => {
    for (const args of [[], ["status"], ["invite-machine"]]) {
      const { code, err } = await invite(args, hubConfig());
      expect(code).toBe(1);
      expect(err.join(" ")).toContain("ocx hub invite");
    }
  });
});
