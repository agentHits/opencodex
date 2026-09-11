import type { OcxConfig, OcxConnectedClientId } from "../types";
import { canonicalGuiBrowserOrigin } from "../lib/gui-pair-capability";
import { findLiveProxy, probeHostname, type LiveProxy } from "../server/proxy-liveness";
import {
  requestBoundGuiPairingGrant,
  type GuiPairClientDeps,
  type GuiPairRequestResult,
} from "./gui-pair-client";
import type { RuntimeApiDeps } from "./runtime-api";

export const HUB_USAGE =
  "ocx hub invite [--json] [--data-url <origin>] [--management-url <origin>] [--clients codex,claude]";

const PAIRING_WARNING = "Pairing codes are secret, single-use, and expire quickly. Do not save them.";

/**
 * The default browser origin a connecting machine presents.
 *
 * `ocx connect --pairing-code-stdin` exchanges the code with `Origin:` set by `localGuiOrigin()`
 * in `src/client/connect.ts` — `http://localhost:<that machine's configured port>`, which on a
 * fresh client is the default 10100. The hub cannot observe the other machine's port, so the
 * grant is bound to this origin unless `corsAllowOrigins` names a different loopback one.
 */
const DEFAULT_CLIENT_BROWSER_ORIGIN = "http://localhost:10100";

export interface HubCommandDeps extends RuntimeApiDeps {
  loadConfig: () => OcxConfig;
  findLiveProxy?: () => Promise<LiveProxy | null>;
  requestPairingGrant?: (
    target: LiveProxy,
    browserOrigin: string,
    deps?: GuiPairClientDeps,
  ) => Promise<GuiPairRequestResult>;
}

export interface HubInviteOptions {
  json: boolean;
  dataUrl?: string;
  managementUrl?: string;
  clients?: string;
}

export interface HubInvitePayload {
  code: string;
  expiresAt: string;
  dataUrl: string;
  managementUrl: string;
  command: string;
}

function canonicalOrigin(value: string | undefined): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    if (parsed.pathname !== "" && parsed.pathname !== "/") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

/** Loopback or HTTPS, the rule `consumeGuiPairingGrant` enforces on the hub side. */
export function pairingOriginUsable(origin: string): boolean {
  try {
    return new URL(origin).protocol === "https:" || isLoopbackOrigin(origin);
  } catch {
    return false;
  }
}

export function parseHubInviteArgs(args: string[]): HubInviteOptions | null {
  const options: HubInviteOptions = { json: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--json" && !options.json) {
      options.json = true;
      continue;
    }
    if (arg === "--data-url" || arg === "--management-url" || arg === "--clients") {
      const value = args[++index];
      if (!value || value.startsWith("--")) return null;
      const key = arg === "--data-url" ? "dataUrl" : arg === "--management-url" ? "managementUrl" : "clients";
      if (options[key] !== undefined) return null;
      options[key] = value;
      continue;
    }
    return null;
  }
  return options;
}

export function parseInviteClients(raw: string | undefined): OcxConnectedClientId[] | null {
  if (raw === undefined) return [];
  const values = raw.split(",").map(value => value.trim()).filter(Boolean);
  if (values.length < 1 || values.some(value => value !== "codex" && value !== "claude")) return null;
  return values as OcxConnectedClientId[];
}

/**
 * The browser origin the grant is bound to, or null when the hub admits none.
 *
 * `createGuiPairingGrant` accepts only `hub.managementPublicOrigin` itself or an entry of
 * `corsAllowOrigins`, so this picks from exactly that set rather than guessing: the default
 * client origin when it is admitted, otherwise the first admitted loopback origin. A hub whose
 * allow-list names no loopback origin cannot pair a remote `ocx connect` at all, and saying so
 * here is better than minting a code the exchange will reject.
 */
export function selectInviteBrowserOrigin(config: OcxConfig): string | null {
  const allowed = [
    canonicalGuiBrowserOrigin(config.hub?.managementPublicOrigin ?? ""),
    ...(config.corsAllowOrigins ?? []).map(value => canonicalGuiBrowserOrigin(value)),
  ].filter((value): value is string => Boolean(value));
  if (allowed.includes(DEFAULT_CLIENT_BROWSER_ORIGIN)) return DEFAULT_CLIENT_BROWSER_ORIGIN;
  return allowed.find(origin => isLoopbackOrigin(origin)) ?? null;
}

/** `http://<bind address>:<port>` — right for a plain tailnet/LAN bind with no TLS frontend. */
export function derivedHubDataOrigin(hostname: string | undefined, port: number): string {
  const host = probeHostname(hostname);
  return `http://${host === "127.0.0.1" ? "localhost" : host}:${port}`;
}

export function hubInviteCommand(
  code: string,
  dataUrl: string,
  managementUrl: string,
  clients: OcxConnectedClientId[],
): string {
  const clientsFlag = clients.length > 0 ? ` --clients ${clients.join(",")}` : "";
  return `echo '${code}' | ocx connect ${dataUrl} --management-url ${managementUrl}${clientsFlag} --pairing-code-stdin`;
}

async function runInvite(args: string[], deps: HubCommandDeps): Promise<number> {
  const options = parseHubInviteArgs(args);
  if (!options) {
    console.error(`Usage: ${HUB_USAGE}`);
    return 1;
  }
  const clients = parseInviteClients(options.clients);
  if (!clients) {
    console.error("--clients must contain codex and/or claude.");
    return 1;
  }
  const config = deps.loadConfig();
  if (config.runtimeRole !== "hub") {
    console.error(
      `ocx hub invite runs on a hub; this machine's runtimeRole is "${config.runtimeRole ?? "standalone"}". `
        + "A client machine runs 'ocx connect' with the code its hub printed.",
    );
    return 1;
  }
  // The grant's server origin IS hub.managementPublicOrigin (createGuiPairingGrant reads it,
  // and the exchange compares the request's management origin against it), so an invite that
  // advertised anything else would hand out a code the hub then refuses.
  const managementPublic = canonicalOrigin(config.hub?.managementPublicOrigin);
  if (!managementPublic) {
    console.error(
      "hub.managementPublicOrigin is not set, so there is no origin to pair against. Set the exact "
        + "browser-visible HTTPS origin: ocx config set hub.managementPublicOrigin '\"https://hub.tailnet.ts.net\"'",
    );
    return 1;
  }
  const managementOverride = options.managementUrl === undefined ? null : canonicalOrigin(options.managementUrl);
  if (options.managementUrl !== undefined && !managementOverride) {
    console.error("--management-url must be a bare http(s) origin with no path, query, or credentials.");
    return 1;
  }
  if (managementOverride && managementOverride !== managementPublic) {
    console.error(
      `--management-url ${managementOverride} does not match hub.managementPublicOrigin ${managementPublic}. `
        + "The pairing code is bound to the configured origin, so the other machine would be refused.",
    );
    return 1;
  }
  if (!pairingOriginUsable(managementPublic)) {
    console.error(
      `hub.managementPublicOrigin ${managementPublic} is non-loopback plain HTTP, which cannot carry a `
        + "pairing code. Put management behind an HTTPS frontend (Tailscale Serve) and set that origin.",
    );
    return 1;
  }
  const dataOverride = options.dataUrl === undefined ? null : canonicalOrigin(options.dataUrl);
  if (options.dataUrl !== undefined && !dataOverride) {
    console.error("--data-url must be a bare http(s) origin with no path, query, or credentials.");
    return 1;
  }
  const browserOrigin = selectInviteBrowserOrigin(config);
  if (!browserOrigin) {
    console.error(
      "No loopback browser origin is admitted for pairing. Add the connecting machine's local origin: "
        + `ocx config set corsAllowOrigins '["${DEFAULT_CLIENT_BROWSER_ORIGIN}"]'`,
    );
    return 1;
  }
  const target = await (deps.findLiveProxy ?? findLiveProxy)();
  if (!target) {
    console.error("No running attested OpenCodex hub was found. Check 'ocx service status', then 'ocx service repair'.");
    return 1;
  }
  const dataUrl = dataOverride
    ?? canonicalOrigin(config.hub?.dataPublicOrigin)
    ?? derivedHubDataOrigin(target.hostname ?? config.hostname, target.port);
  const result = await (deps.requestPairingGrant ?? requestBoundGuiPairingGrant)(target, browserOrigin, {
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });
  if (result.kind !== "created") {
    console.error(`Minting a pairing code failed (${result.reason}).`);
    return 1;
  }
  const payload: HubInvitePayload = {
    code: result.grant,
    expiresAt: new Date(result.expiresAt).toISOString(),
    dataUrl,
    managementUrl: managementPublic,
    command: hubInviteCommand(result.grant, dataUrl, managementPublic, clients),
  };
  if (options.json) {
    console.log(JSON.stringify(payload));
    console.error(PAIRING_WARNING);
    return 0;
  }
  // Remaining time, not the constant TTL: the number an operator reads has to be the one
  // they actually have left by the time the line is printed.
  const ttlSeconds = Math.max(0, Math.round((result.expiresAt - Date.now()) / 1000));
  console.log(`Pairing code for one machine — single-use, expires in ${ttlSeconds}s (${payload.expiresAt}).`);
  console.log("");
  console.log("# Run on the other machine:");
  console.log(payload.command);
  console.error(PAIRING_WARNING);
  return 0;
}

export async function runHubCommand(args: string[], deps: HubCommandDeps): Promise<number> {
  if (args[0] !== "invite") {
    console.error(`Usage: ${HUB_USAGE}`);
    return 1;
  }
  return runInvite(args.slice(1), deps);
}
