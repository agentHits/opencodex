import { durableBunRuntime } from "../lib/bun-runtime";
import { codexAutoStartEnabled, getConfigPath, readConfigDiagnostics } from "../config";
import { getPidPath, readPid, readRuntimePort, type RuntimePortState } from "../config/process-state";
import { diagnoseCodexBundledPlugins, type CodexPluginsDiagnostic } from "../codex/plugins-doctor";
import { findLiveProxy, probeHostname } from "../server/proxy-liveness";
import type { OcxConfig } from "../types";
import { diagnoseService, serviceLogPath } from "../service";
import { collectStartupHealth, type StartupHealth } from "../codex/autostart-health";
import { getCodexRoutingKind } from "../codex/inject";
import { diagnoseCodexShim } from "../codex/shim";
import { displayCodexRuntimePath, effortClampAppliesToRuntime, loadLastEffortClamp, resolveCodexRuntime } from "../codex/runtime";
import { packageVersion } from "./help";
import { computeVersionSkew, type VersionSkew } from "./version-skew";
import { redactSecretString, redactUserPath } from "../lib/redact";
import { collectOrcaCodexHomeDiagnostic, type OrcaCodexHomeDiagnostic } from "../codex/home";
import { grokFenceEndpointDrift, readGrokStatus } from "../grok/status";
import { effectiveLoopbackListenerPort } from "../codex/loopback-target";
import { claudeDesktopIntegrationEnabled } from "../codex/desired-state";
import { claudeDesktopPolicyHealth, probeClaudeDesktopPolicy, type ClaudeDesktopPolicyHealth } from "../claude/desktop-policy";
import { collectClientConnectionStatus } from "./connect";
import { readServiceApiTokenState, serviceApiTokenFilePath } from "../lib/service-secrets";
import { tokenCollidesWithAdmin } from "../lib/admin-secrets";
export { proxyHealthFailureReason, isConnectionRefused, isUncleanExitEvidence, probeUncleanExitState } from "./status-probes";
export type { ListenTarget } from "./status-probes";
import { checkProxyHealth, probeUncleanExitState, type ListenTarget } from "./status-probes";

/**
 * The state of the data-plane admission secret the SERVICE will use. State only -- never the value.
 *
 * Always about the file, because the file is what the service reads: the launchd plist and the
 * systemd unit `cat` it into `OPENCODEX_API_AUTH_TOKEN` before exec, so a token in the CLI's own
 * shell says nothing about the running hub. `present (env)` used to be reported here and was
 * simply wrong about whose environment it meant (see `dataTokenEnvInShell`).
 *
 * `admin-collision (file)` is the #4236 incident shape: the file holds the MANAGEMENT token, so
 * the server fences the whole management plane closed at boot and the hub crash-loops. It used
 * to report `present (file)`, which is how the cause stayed invisible.
 */
export type HubDataTokenState =
  | "present (file)"
  | "unsafe (file)"
  | "admin-collision (file)"
  | "missing";

export type HubStatus = {
  /** Advertised data origin: hub.dataPublicOrigin, else derived from the bind address. */
  dataOrigin: string;
  /** True when dataOrigin came from config rather than being derived from the bind. */
  dataOriginConfigured: boolean;
  /**
   * The unauthenticated loopback listener, in PR2's two forms: `companion` shares the public
   * port (the one-port hub), `ported` binds its own. `off` means the hub does not serve its
   * own local clients at all.
   */
  loopbackListener: { state: "off" | "companion" | "ported"; port: number | null };
  managementIngress: { enabled: boolean; port: number | null };
  managementPublicOrigin: string | null;
  dataToken: HubDataTokenState;
  dataTokenPath: string;
  /**
   * `OPENCODEX_API_AUTH_TOKEN` is set in the shell that ran `ocx status` — which is NOT the
   * environment the installed service runs in. Reported separately, and honestly, because it
   * does decide what a FOREGROUND `ocx start` in this same shell would admit.
   */
  dataTokenEnvInShell: boolean;
};

export type CliStatusJson = {
  schemaVersion: 1;
  proxy: {
    running: boolean;
    pid: number | null;
    /** Persisted owner records outlived their process: the last proxy did not exit cleanly. */
    staleProcessState: boolean;
    health: {
      ok: boolean;
      url: string;
      message: string;
    };
  };
  dashboard: { url: string };
  listen: {
    port: number;
    hostname: string | null;
    source: "runtime" | "config";
  };
  paths: {
    config: string;
    pid: string;
    runtime: string;
  };
  runtime: {
    source: string;
    overrideEnv?: string;
  };
  codexAutostart: boolean;
  startup: StartupHealth;
  defaultProvider: string | null;
  config: {
    source: "default" | "file" | "fallback";
    error: string | null;
  };
  connection: {
    state: "disconnected" | "connected" | "invalid" | "mismatched";
    reason?: string;
    serverUrl?: string;
    managementUrl?: string;
    protocolVersion?: number;
    apiKeyId?: string;
    selectedClients?: string[];
    catalog?: "present" | "missing" | "unsafe";
    catalogAgeSeconds?: number;
    credentialFile: "owned" | "missing" | "changed" | "unsafe";
  };
  service: { summary: string };
  codexShim: { summary: string };
  codexPlugins: CodexPluginsDiagnostic;
  codexRuntime: {
    path: string;
    version: string | null;
    source: string;
    newerAvailable: { path: string; version: string | null } | null;
    warning: string | null;
    catalogClamp: {
      active: boolean;
      removedEfforts: string[];
      runtimeVersion: string | null;
    };
  };
  codexHome: OrcaCodexHomeDiagnostic;
  claudeDesktop: {
    desiredEnabled: boolean;
    policy: ClaudeDesktopPolicyHealth;
  };
  /**
   * The hub-only facts an operator needs in one place, or null on a standalone/client machine.
   *
   * Scattered across the report they were unusable: the public data origin came from `listen`,
   * the management origin was folded into `dashboard.url`, the loopback companion appeared
   * nowhere, and the data-plane token appeared nowhere at all -- so the one question a hub
   * operator actually asks ("is this reachable, and can another machine join?") took four other
   * commands to answer. Additive and nullable, so `schemaVersion` stays 1.
   *
   * Never carries a token value; only which source holds one.
   */
  hub: HubStatus | null;
  /**
   * This CLI's version against the running proxy's (#2701).
   *
   * Additive and optional-by-value, so `schemaVersion` stays 1: an existing consumer that
   * ignores the key is unaffected, and `proxyVersion` is null when nothing is live.
   */
  versionSkew: VersionSkew;
};

export type CliStatusView = {
  json: CliStatusJson;
  proxyLabel: string;
  healthLabel: string;
};


type StatusListenConfig = Pick<OcxConfig, "port" | "hostname" | "runtimeRole" | "hub">;

function statusDashboardUrl(config: StatusListenConfig, hostname: string | undefined, port: number): string {
  const managementOrigin = config.runtimeRole === "hub" ? config.hub?.managementPublicOrigin : undefined;
  if (managementOrigin) return managementOrigin.endsWith("/") ? managementOrigin : `${managementOrigin}/`;

  const reachableHostname = probeHostname(hostname);
  const dashboardHostname = reachableHostname === "127.0.0.1"
    || reachableHostname === "[::1]"
    || reachableHostname.toLowerCase() === "localhost"
    ? "localhost"
    : reachableHostname;
  return `http://${dashboardHostname}:${port}/`;
}

/**
 * The hub block, or null when this machine is not a hub.
 *
 * The token line is about the FILE, not this shell. `ocx status` used to print `present (env)`
 * whenever the calling shell happened to export `OPENCODEX_API_AUTH_TOKEN`, but the service
 * wrapper overwrites that variable from the token file before exec — so the label described the
 * operator's terminal and not the hub. The shell's variable is reported as its own flag instead.
 *
 * The token VALUE is never read into the report. `readServiceApiTokenState` returns it; the only
 * things derived from it are `kind` and the admin-token comparison, neither of which can carry
 * bytes of the secret.
 */
export function collectHubStatus(
  config: Pick<OcxConfig, "runtimeRole" | "hostname" | "port" | "hub" | "unauthenticatedLoopbackListener">,
  listen: { port: number; hostname?: string | null },
  env: NodeJS.ProcessEnv = process.env,
): HubStatus | null {
  if (config.runtimeRole !== "hub") return null;
  const listener = config.unauthenticatedLoopbackListener;
  const loopbackPort = effectiveLoopbackListenerPort(config, listen.port);
  const ingress = config.hub?.managementIngress;
  const configuredDataOrigin = config.hub?.dataPublicOrigin;
  const host = probeHostname(listen.hostname ?? config.hostname);
  const tokenState = ((): HubDataTokenState => {
    const state = readServiceApiTokenState();
    if (state.kind === "unsafe") return "unsafe (file)";
    if (state.kind !== "present") return "missing";
    return tokenCollidesWithAdmin(state.token, env) ? "admin-collision (file)" : "present (file)";
  })();
  return {
    dataOrigin: configuredDataOrigin
      ?? `http://${host === "127.0.0.1" ? "localhost" : host}:${listen.port}`,
    dataOriginConfigured: Boolean(configuredDataOrigin),
    loopbackListener: loopbackPort === null
      ? { state: "off", port: null }
      : { state: listener?.enabled && listener.port === undefined ? "companion" : "ported", port: loopbackPort },
    managementIngress: {
      enabled: ingress?.enabled === true,
      port: ingress?.enabled === true ? ingress.port : null,
    },
    managementPublicOrigin: config.hub?.managementPublicOrigin ?? null,
    dataToken: tokenState,
    dataTokenPath: serviceApiTokenFilePath(),
    dataTokenEnvInShell: Boolean(env.OPENCODEX_API_AUTH_TOKEN?.trim()),
  };
}

/**
 * The human rendering of the hub block, owned here rather than in the `ocx status` printer so
 * the sentences are testable without spawning the CLI. Indentation is the caller's.
 */
export function hubStatusLines(hub: HubStatus): string[] {
  const listener = hub.loopbackListener.state === "off"
    ? "off — this hub does not route its own local Codex/Claude clients"
    : hub.loopbackListener.state === "companion"
      ? `companion on http://127.0.0.1:${hub.loopbackListener.port} — same port as the public listener, no credential needed locally`
      : `ported on http://127.0.0.1:${hub.loopbackListener.port} — a second port local clients must be pointed at`;
  const tokenLines = [`  Data token: ${hub.dataToken}${hub.dataToken === "missing" ? "" : ` at ${hub.dataTokenPath}`}`];
  if (hub.dataToken === "admin-collision (file)") {
    // Naming the consequence matters more than naming the state: this is what a crash-looping
    // hub looks like from `ocx status`, and nothing else in the report says so (#4236).
    tokenLines.push(
      "    that file holds the MANAGEMENT token, so the hub fences its management API closed at boot —",
      "    delete it and run 'ocx service repair' to generate a data-plane token",
    );
  }
  if (hub.dataTokenEnvInShell) {
    tokenLines.push("    OPENCODEX_API_AUTH_TOKEN is also set in this shell; the installed service reads the file, not this");
  }
  return [
    "Hub:",
    `  Data origin: ${hub.dataOrigin}${hub.dataOriginConfigured ? " (hub.dataPublicOrigin)" : " (derived from the bind address)"}`,
    `  Loopback listener: ${listener}`,
    `  Management ingress: ${hub.managementIngress.enabled ? `http://127.0.0.1:${hub.managementIngress.port}` : "disabled"}`,
    `  Management origin: ${hub.managementPublicOrigin ?? "unset — remote pairing and the remote dashboard need hub.managementPublicOrigin"}`,
    ...tokenLines,
    "  Invite a machine: ocx hub invite",
  ];
}

export function selectListenTarget(
  config: StatusListenConfig,
  pid: number | null,
  runtimePort: RuntimePortState | null,
): ListenTarget {
  const currentRuntimePort = pid && runtimePort?.pid === pid ? runtimePort : null;
  const port = currentRuntimePort ? currentRuntimePort.port : config.port ?? 10100;
  const hostname = currentRuntimePort?.hostname ?? config.hostname;
  return {
    port,
    hostname,
    source: currentRuntimePort ? "runtime" : "config",
    healthUrl: `http://${probeHostname(hostname)}:${port}/healthz`,
    dashboardUrl: statusDashboardUrl(config, hostname, port),
  };
}

/** Prefer live result (including authoritative null pid) over the on-disk pid file. */
export function resolveStatusPid(
  live: { pid: number | null } | null,
  pidFile: number | null,
): number | null {
  return live ? live.pid : pidFile;
}

/**
 * `ocx status` greens on process liveness alone, so a proxy that answers
 * /healthz reads healthy even when Codex is not pointed at it and every routed
 * request goes to OpenAI instead (#2411). The proxy line is not wrong — the
 * listener really is up — so it keeps its check, and this supplies the signal
 * that was missing rather than corrupting the one that was already honest.
 *
 * Only `native` warns. `custom-local` and `unknown` are also "this proxy is
 * unused", but startupHealthSummary already renders both as AT RISK with a
 * remedy command, and `custom-remote` is a deliberate operator choice. Warning
 * on all four would teach operators to skip the line that matters.
 */
export function unusedProxyWarningLines(input: {
  proxyUp: boolean;
  routingKind: StartupHealth["routingKind"];
}): string[] {
  if (!input.proxyUp || input.routingKind !== "native") return [];
  return [
    "⚠️  Codex routing is native — the running proxy is unused.",
    "   Codex requests go to OpenAI, not this proxy. Re-point with: ocx start",
  ];
}

export async function collectStatus(): Promise<CliStatusView> {
  const configDiagnostics = readConfigDiagnostics();
  const config = configDiagnostics.config;
  const claudeDesktop = {
    desiredEnabled: claudeDesktopIntegrationEnabled(config),
    policy: claudeDesktopPolicyHealth(probeClaudeDesktopPolicy()),
  };
  const clientConnection = collectClientConnectionStatus();
  // Prefer identity-verified liveness (runtime-port + /healthz) over ocx.pid alone (#618).
  // Pass the already-resolved diagnostics config so findLiveProxy does not re-load and
  // warn on malformed config.json (status --json must stay stderr-clean).
  const live = await findLiveProxy({
    configFn: () => ({ port: config.port, hostname: config.hostname }),
  });
  const pidFile = readPid();
  // Preserve an authoritative null from orphan/legacy liveness — do not restore pidFile.
  const pid = resolveStatusPid(live, pidFile);
  // No extra request: findLiveProxy's identity probe already parsed and validated the
  // healthz body, so the version came back with the liveness result.
  const versionSkew = computeVersionSkew(packageVersion(), live?.version);
  const listen = live
    ? {
      port: live.port,
      hostname: live.hostname,
      source: live.source,
      healthUrl: `http://${probeHostname(live.hostname)}:${live.port}/healthz`,
      dashboardUrl: statusDashboardUrl(config, live.hostname, live.port),
    }
    : selectListenTarget(config, pidFile, pidFile ? readRuntimePort(pidFile) : null);
  // findLiveProxy already identity-probed /healthz; avoid a second fetch that can race.
  const health = live
    ? {
      ok: true,
      url: listen.healthUrl,
      message: `ok (pid ${live.pid ?? "unknown"})`,
      label: `${listen.healthUrl} ok (live)`,
    }
    : await checkProxyHealth(listen);
  // Same gatherer `ocx doctor` uses, so the two commands cannot reach different verdicts
  // about the same on-disk state (review found them diverging on fallback ports).
  const staleProcessState = await probeUncleanExitState({
    live: Boolean(live),
    port: config.port,
    hostname: config.hostname,
  });
  const bunRuntime = durableBunRuntime();
  const service = diagnoseService();
  // A service can be registered and still not serve: the manager reports the job
  // either way. `live` was already identity-probed a few lines above, so cross-check
  // rather than print registration as if it were service.
  const serviceSummary = service.installed && !live
    ? `${service.summary} — registered but NOT serving; see ${serviceLogPath()} and re-run 'ocx service repair'`
    : service.summary;
  const codexShim = diagnoseCodexShim();
  const codexShimSummary = codexShim.summary;
  const startup = collectStartupHealth(config, {
    service,
    shim: codexShim,
    routingKind: getCodexRoutingKind(),
  });
  const codexPlugins = diagnoseCodexBundledPlugins();
  const resolvedRuntime = (() => {
    try {
      return resolveCodexRuntime();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const redacted = redactUserPath(redactSecretString(message)).slice(0, 160);
      return {
        runtime: { command: "codex", version: null, source: "fallback" as const },
        failures: [{
          command: "codex",
          source: "fallback" as const,
          reason: `resolve threw: ${redacted}`,
        }],
        replacedConfigured: undefined,
        newerAvailable: undefined,
      };
    }
  })();
  const lastClamp = loadLastEffortClamp();
  const clampActive = effortClampAppliesToRuntime(lastClamp, resolvedRuntime.runtime);
  const codexHome = collectOrcaCodexHomeDiagnostic();
  const warningParts: string[] = [];
  if (
    resolvedRuntime.replacedConfigured
    && resolvedRuntime.replacedConfigured.from.command !== resolvedRuntime.runtime.command
  ) {
    warningParts.push(
      `Preferred Codex runtime is unavailable; using ${displayCodexRuntimePath(resolvedRuntime.runtime.command)} instead. Run ocx doctor for diagnosis and recovery.`,
    );
  } else if (
    resolvedRuntime.runtime.source === "fallback"
    && resolvedRuntime.failures.length > 0
    && !resolvedRuntime.runtime.version
  ) {
    const detail = resolvedRuntime.failures[0]?.reason;
    warningParts.push(
      detail
        ? `No validated Codex runtime found (${detail}); falling back to \`codex\`. Run ocx doctor for diagnosis and recovery.`
        : "No validated Codex runtime found; falling back to `codex`. Run ocx doctor for diagnosis and recovery.",
    );
  }
  if (resolvedRuntime.newerAvailable) {
    warningParts.push("OpenCodex is using an older Codex binary. Run ocx doctor for diagnosis and recovery.");
  }
  if (clampActive) {
    warningParts.push(
      `Catalog clamp removed: ${lastClamp!.removedEfforts.join(", ")}. Run ocx doctor for diagnosis and recovery.`,
    );
  }
  // A Grok fence naming a port we are not listening on is invisible everywhere else:
  // grok retries the refused connection on its own side, so no request — and therefore
  // no log line — ever reaches us. Surface it here, where the live port is already known.
  const grokDrift = (() => {
    try {
      // Locally reachable is a set: the public port plus the unauthenticated loopback
      // listener's port. A fence naming either is correct; only a third port is drift (#4236).
      return grokFenceEndpointDrift(
        readGrokStatus(),
        health.ok ? listen.port : undefined,
        health.ok ? effectiveLoopbackListenerPort(config, listen.port) : null,
      );
    } catch {
      return null; // reading grok's config must never break `ocx status`
    }
  })();
  if (grokDrift) {
    warningParts.push(
      `Grok Build config points at port ${grokDrift.fencePort}, but the proxy is on `
      + `${grokDrift.livePort}; grok turns will retry against a closed port. Run 'ocx ensure' to repoint it.`,
    );
  }
  const codexRuntime = {
    path: displayCodexRuntimePath(resolvedRuntime.runtime.command),
    version: resolvedRuntime.runtime.version,
    source: resolvedRuntime.runtime.source,
    newerAvailable: resolvedRuntime.newerAvailable
      ? {
        path: displayCodexRuntimePath(resolvedRuntime.newerAvailable.command),
        version: resolvedRuntime.newerAvailable.version,
      }
      : null,
    warning: warningParts.length > 0 ? warningParts.join(" ") : null,
    catalogClamp: {
      active: clampActive,
      removedEfforts: clampActive ? (lastClamp?.removedEfforts ?? []) : [],
      runtimeVersion: clampActive ? (lastClamp?.runtimeVersion ?? null) : null,
    },
  };
  const proxyLabel = live
    ? `running (PID ${live.pid ?? pid ?? "unknown"})`
    : pid && health.ok
      ? `running (PID ${pid})`
      : pid
        ? `PID file points to PID ${pid}, but health check failed`
        : health.ok
          ? "reachable, but PID file is missing or stale"
          : "not running";

  return {
    proxyLabel,
    healthLabel: health.label,
    json: {
      schemaVersion: 1,
      proxy: {
        running: Boolean(live) || Boolean(pid && health.ok),
        pid: live?.pid ?? pid,
        staleProcessState,
        health: {
          ok: health.ok,
          url: health.url,
          message: health.message,
        },
      },
      dashboard: { url: listen.dashboardUrl },
      listen: {
        port: listen.port,
        hostname: listen.hostname ?? null,
        source: listen.source,
      },
      paths: {
        config: getConfigPath(),
        pid: getPidPath(),
        runtime: bunRuntime.path,
      },
      runtime: {
        source: bunRuntime.source,
        ...(bunRuntime.source === "override" ? { overrideEnv: bunRuntime.overrideEnv } : {}),
      },
      hub: collectHubStatus(config, listen),
      codexAutostart: codexAutoStartEnabled(config),
      startup,
      defaultProvider: typeof config.defaultProvider === "string" ? config.defaultProvider : null,
      config: {
        source: configDiagnostics.source,
        error: configDiagnostics.error,
      },
      connection: {
        state: clientConnection.state,
        ...(clientConnection.reason ? { reason: clientConnection.reason } : {}),
        ...(clientConnection.serverUrl ? { serverUrl: clientConnection.serverUrl } : {}),
        ...(clientConnection.managementUrl ? { managementUrl: clientConnection.managementUrl } : {}),
        ...(clientConnection.protocolVersion ? { protocolVersion: clientConnection.protocolVersion } : {}),
        ...(clientConnection.apiKeyId ? { apiKeyId: clientConnection.apiKeyId } : {}),
        ...(clientConnection.selectedClients ? { selectedClients: [...clientConnection.selectedClients] } : {}),
        catalog: clientConnection.catalog,
        ...(clientConnection.catalogAgeSeconds !== undefined ? { catalogAgeSeconds: clientConnection.catalogAgeSeconds } : {}),
        credentialFile: clientConnection.token,
      },
      service: { summary: serviceSummary },
      codexShim: { summary: codexShimSummary },
      codexPlugins,
      codexRuntime,
      codexHome,
      claudeDesktop,
      // Own field rather than a line in `codexRuntime.warning`: a stale ocx on PATH is a
      // fact about this install, not about the Codex runtime, and filing it there would
      // print it under the wrong heading (#2701).
      versionSkew,
    },
  };
}
