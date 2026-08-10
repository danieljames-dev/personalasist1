import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import { NETWORK_BOUNDARY, classifyBindAddress, discoverPrivateLanAddresses, buildPhoneUrl } from "../../packages/local-assistant/dist/index.js";

/**
 * Private-network detection.
 *
 * This only answers one question: is a documented private-network CLI installed on this computer?
 * It checks a short fixed list of documented install locations with one stat each and asks the
 * resolved program for its version. It never scans the machine, never reads a tailnet's state,
 * never logs in, never brings an interface up, and never changes any external configuration.
 *
 * AION does not need this to work. Private access is an owner setting with an explicit bind
 * address; the detection exists so Settings can say something true instead of guessing, and so the
 * owner is not told a capability exists when it does not.
 */

const PROBE_TIMEOUT_MS = 10_000;

/** Documented Tailscale install locations. A short list, never a search. */
export function tailscaleCandidates(env = process.env, platform = process.platform) {
  const candidates = [];
  const override = env.AION_TAILSCALE_PATH?.trim();
  if (override && isAbsolute(override) && resolve(override) === override) candidates.push(override);
  if (platform === "win32") {
    for (const base of [env.ProgramFiles, env["ProgramFiles(x86)"]].filter(Boolean)) candidates.push(join(base, "Tailscale", "tailscale.exe"));
  } else if (platform === "darwin") {
    candidates.push("/Applications/Tailscale.app/Contents/MacOS/Tailscale", "/usr/local/bin/tailscale", "/opt/homebrew/bin/tailscale");
  } else {
    candidates.push("/usr/bin/tailscale", "/usr/local/bin/tailscale");
  }
  return candidates.filter((candidate) => !/\.(?:cmd|ps1|bat|sh)$/u.test(candidate));
}

/**
 * Documented WireGuard install locations. Same rule: a fixed list, one stat each, no search.
 *
 * Supporting a second overlay is the point rather than a convenience. AION should not have a
 * favourite piece of network software any more than it should have a favourite model vendor.
 */
export function wireguardCandidates(env = process.env, platform = process.platform) {
  const candidates = [];
  const override = env.AION_WIREGUARD_PATH?.trim();
  if (override && isAbsolute(override) && resolve(override) === override) candidates.push(override);
  if (platform === "win32") {
    for (const base of [env.ProgramFiles, env["ProgramFiles(x86)"]].filter(Boolean)) candidates.push(join(base, "WireGuard", "wg.exe"));
  } else if (platform === "darwin") {
    candidates.push("/usr/local/bin/wg", "/opt/homebrew/bin/wg");
  } else {
    candidates.push("/usr/bin/wg", "/usr/local/bin/wg");
  }
  return candidates.filter((candidate) => !/\.(?:cmd|ps1|bat|sh)$/u.test(candidate));
}

function probe(file, args) {
  return new Promise((resolveResult) => {
    const child = execFile(file, args, { timeout: PROBE_TIMEOUT_MS, windowsHide: true, shell: false, maxBuffer: 256 * 1024 },
      (error, stdout) => resolveResult(error ? null : String(stdout).split(/\r?\n/u).map((line) => line.trim()).find(Boolean) ?? ""));
    child.once("error", () => resolveResult(null));
  });
}

/**
 * Reports what is actually installed. When nothing supported is present the status says so
 * plainly rather than implying AION could reach the phone if only it tried harder.
 */
export async function detectPrivateNetwork(env = process.env, platform = process.platform) {
  const tools = [
    { tool: "tailscale", candidates: tailscaleCandidates(env, platform), args: ["version"], label: "A Tailscale CLI" },
    { tool: "wireguard", candidates: wireguardCandidates(env, platform), args: ["--version"], label: "A WireGuard CLI" },
  ];
  for (const entry of tools) {
    for (const candidate of entry.candidates) {
      try {
        if (!(await stat(candidate)).isFile()) continue;
      } catch { continue; }
      const version = await probe(candidate, entry.args);
      if (version === null) continue;
      return {
        tool: entry.tool,
        available: true,
        // Executable name only: a full path would carry the owner's user name to the browser.
        executable: basename(candidate),
        version: version.slice(0, 80),
        detail: `${entry.label} is installed. AION has not read its configuration, signed in, brought an interface up, or changed any network setting, and it will not. To use it, turn on private phone access and enter the private address you want AION to bind.`,
      };
    }
  }
  return {
    tool: "none",
    available: false,
    executable: null,
    version: null,
    detail: "No supported private-network tool was found. AION checked only documented Tailscale and WireGuard install locations and does not search your computer. Private phone access still works over a network you already control -- enter that private address yourself -- and AION will never create a tunnel or change your router.",
  };
}

/**
 * The truthful summary Settings shows.
 *
 * This describes the listeners AION *actually has*, not the configuration it was asked for. Those
 * are different things, and conflating them is exactly what made a saved private address look
 * like working phone access when nothing was listening on it.
 */
export async function remoteAccessStatus(settings, listeners = [], env = process.env, platform = process.platform) {
  const network = await detectPrivateNetwork(env, platform);
  const enabled = settings.remoteAccess?.enabled === true;
  const configured = settings.remoteAccess?.bindAddress ?? "127.0.0.1";
  // What kind of network the configured address actually is, so "will this work from the car park"
  // has an answer before the owner drives to the car park to find out.
  let classification = null;
  try { classification = classifyBindAddress(configured); } catch { classification = null; }
  const live = listeners.filter((entry) => entry.state === "listening");
  const privateLive = live.filter((entry) => entry.scope === "private");
  const problem = listeners.find((entry) => entry.state === "failed" || entry.state === "refused" || entry.state === "loopback-only");
  const port = live[0]?.port ?? null;

  const summary = (() => {
    if (!enabled) return "Private phone access is off. AION is reachable only from this computer.";
    if (privateLive.length) {
      const reach = classification?.worksAwayFromHome
        ? `That address is on ${classification.likelyProvider}, so a paired phone can reach AION from anywhere that overlay reaches.`
        : "That address only works while your phone is on the same network; to reach AION away from home, run a private overlay network you control and bind the address it gives this computer.";
      return `Private phone access is on and AION is listening on ${privateLive.map((entry) => `${entry.address}:${entry.port}`).join(" and ")} as well as loopback. ${reach} A paired device is still required; being on the network grants nothing by itself.`;
    }
    if (problem) return `Private phone access is on but NOT working: ${problem.detail} AION is still reachable from this computer.`;
    return "Private phone access is on but no private listener is active. Restart AION so the setting takes effect.";
  })();

  const lan = discoverPrivateLanAddresses();
  const phoneListener = privateLive[0] ?? null;
  const phoneUrl = phoneListener && port
    ? buildPhoneUrl(phoneListener.address, port, "/phone")
    : lan.preferred && port
      ? buildPhoneUrl(lan.preferred.address, port, "/phone")
      : null;

  return {
    enabled,
    /** What the owner asked for. */
    bindAddress: configured,
    /** What kind of network that address is, and whether it reaches beyond this building. */
    addressScope: classification,
    boundary: NETWORK_BOUNDARY,
    /** What AION actually bound. Empty means nothing but loopback. */
    listeners: listeners.map((entry) => ({ ...entry })),
    boundAddress: live.map((entry) => entry.address).join(", ") || "none",
    port,
    sessionDays: settings.remoteAccess?.sessionDays ?? 30,
    loopbackOnly: privateLive.length === 0,
    /** True when the owner asked for private access but AION does not actually have it. */
    configurationApplied: !enabled || privateLive.length > 0,
    privateNetwork: network,
    /** Live private LAN discovery (physical preferred; virtual adapters demoted). */
    lanDiscovery: {
      preferred: lan.preferred,
      candidates: lan.candidates.slice(0, 8),
      suggestedBind: lan.preferred?.address ?? null,
    },
    /** Exact URL a phone on the same LAN should open. */
    phoneUrl,
    summary,
    publiclyExposed: live.some((entry) => ["0.0.0.0", "::", "*"].includes(entry.address)),
  };
}
