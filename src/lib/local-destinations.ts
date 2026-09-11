/**
 * Where a process running ON THE HUB ITSELF dials the hub (#4236).
 *
 * There are TWO destinations here, not one base URL substituted everywhere, and conflating
 * them is what broke every local integration on a tailnet-bound hub:
 *
 * 1. `localManagementOrigin` — authenticated management discovery/state (`/api/*`). It is
 *    served by the public listener and, on a hub, additionally by the loopback-only
 *    `hub.managementIngress`. Callers must still send a management credential: management
 *    authentication has no loopback bypass (structure/05), and the unauthenticated loopback
 *    listener deliberately does not serve `/api/*` at all.
 * 2. `localInferenceOrigin` — the data plane a client wire actually speaks. When
 *    `unauthenticatedLoopbackListener` is enabled this is the listener's effective port, which
 *    admits local callers with no credential, so nothing has to export one.
 *
 * A hub whose public listener binds a tailnet address has no `127.0.0.1:<public port>` socket,
 * which is why eight call sites hardcoding that origin all failed while Codex (which already
 * honored the listener) worked. They route through here instead of repeating `?? port`: the day
 * the resolution changes, a forgotten site points a client config at a closed socket.
 */
import { effectiveLoopbackListenerPort } from "../codex/loopback-target";
import { probeHostname } from "../server/proxy-liveness";
import type { OcxConfig } from "../types";

export type LocalInferenceConfig = Pick<OcxConfig, "unauthenticatedLoopbackListener">;
export type LocalManagementConfig = Pick<OcxConfig, "hostname" | "runtimeRole" | "hub">;

/**
 * The port a local client dials for inference: the unauthenticated loopback listener's
 * effective port when it is enabled, otherwise the public port (unchanged behaviour for a
 * loopback or standalone install).
 */
export function localInferencePort(
  config: LocalInferenceConfig | undefined,
  publicPort: number,
): number {
  return effectiveLoopbackListenerPort(config, publicPort) ?? publicPort;
}

/** `http://127.0.0.1:<inference port>` — the origin every local client wire writes. */
export function localInferenceOrigin(
  config: LocalInferenceConfig | undefined,
  publicPort: number,
): string {
  return `http://127.0.0.1:${localInferencePort(config, publicPort)}`;
}

/**
 * The origin a local CLI dials for `/api/*`.
 *
 * A hub's management ingress is loopback-only and exists precisely so the operator's own
 * machine has a management address when the proxy listener is bound elsewhere. Everything else
 * keeps dialing the public listener on the bind address it can actually reach — `probeHostname`
 * turns a wildcard bind into 127.0.0.1 and brackets a bare IPv6 literal.
 *
 * The caller still supplies the management credential. Never write that credential into an
 * exported client configuration.
 */
export function localManagementOrigin(
  config: LocalManagementConfig | undefined,
  publicPort: number,
): string {
  const ingress = config?.runtimeRole === "hub" ? config.hub?.managementIngress : undefined;
  if (ingress?.enabled) return `http://127.0.0.1:${ingress.port}`;
  return `http://${probeHostname(config?.hostname)}:${publicPort}`;
}
