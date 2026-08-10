import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import {
  NETWORK_BOUNDARY, classifyBindAddress, discoverPrivateLanAddresses, discoverAccessEndpoints,
  buildPhoneUrl, buildAppUrl,
} from "../../packages/local-assistant/dist/index.js";

/**
 * Private-network detection + mobile remote access status.
 *
 * Detection only answers: is a documented private-network CLI installed?
 * AION never creates tunnels, never opens router ports, never signs the Owner in.
 * When Tailscale (or another overlay) is already up, AION discovers its address and binds it.
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
      (error, stdout) => resolveResult(error ? null : String(stdout ?? "").trim()));
    child.once("error", () => resolveResult(null));
  });
}

/**
 * Best-effort Tailscale runtime facts when the CLI is installed.
 * Never signs in, never brings the interface up — read-only status only.
 */
export async function queryTailscaleRuntime(env = process.env, platform = process.platform) {
  const empty = {
    installed: false,
    executable: null,
    version: null,
    loggedIn: false,
    backendState: null,
    ipv4: null,
    dnsName: null,
    detail: "Tailscale CLI not found at documented install locations.",
  };
  for (const candidate of tailscaleCandidates(env, platform)) {
    try {
      if (!(await stat(candidate)).isFile()) continue;
    } catch { continue; }
    const version = await probe(candidate, ["version"]);
    if (version === null) continue;
    const versionLine = version.split(/\r?\n/u).map((l) => l.trim()).find(Boolean) ?? version.slice(0, 80);
    const ipOut = await probe(candidate, ["ip", "-4"]);
    const ipv4 = ipOut && /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(ipOut.split(/\r?\n/u)[0]?.trim() ?? "")
      ? ipOut.split(/\r?\n/u)[0].trim()
      : null;
    const statusJson = await probe(candidate, ["status", "--json"]);
    let loggedIn = false;
    let backendState = null;
    let dnsName = null;
    if (statusJson) {
      try {
        const parsed = JSON.parse(statusJson);
        backendState = parsed.BackendState || parsed.Self?.Online === true ? (parsed.BackendState || "Running") : (parsed.BackendState || null);
        loggedIn = Boolean(parsed.Self?.HostName || parsed.Self?.DNSName || backendState === "Running");
        dnsName = (parsed.Self?.DNSName || parsed.Self?.HostName || "").replace(/\.$/, "") || null;
        if (!ipv4 && parsed.Self?.TailscaleIPs) {
          const v4 = (parsed.Self.TailscaleIPs || []).find((ip) => /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(String(ip)));
          if (v4) return {
            installed: true, executable: basename(candidate), version: versionLine.slice(0, 80),
            loggedIn: true, backendState: backendState || "Running", ipv4: String(v4), dnsName,
            detail: `Tailscale is installed and reported IPv4 ${v4}. AION did not sign in or change its configuration.`,
          };
        }
      } catch {
        // status --json may fail when logged out; still report installed
      }
    }
    return {
      installed: true,
      executable: basename(candidate),
      version: versionLine.slice(0, 80),
      loggedIn: loggedIn || Boolean(ipv4),
      backendState,
      ipv4,
      dnsName,
      detail: ipv4
        ? `Tailscale is installed and has IPv4 ${ipv4}. AION did not sign in or change its configuration.`
        : "Tailscale is installed but no overlay IPv4 is available yet. Sign in on this computer (and install Tailscale on the phone) so AION can bind the overlay address automatically.",
    };
  }
  return empty;
}

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
        executable: basename(candidate),
        version: String(version).split(/\r?\n/u).map((l) => l.trim()).find(Boolean)?.slice(0, 80) ?? "",
        detail: `${entry.label} is installed. AION has not signed in, brought an interface up, or changed any network setting. Enable private phone access with bind address "auto" to bind discovered LAN and overlay addresses.`,
      };
    }
  }
  return {
    tool: "none",
    available: false,
    executable: null,
    version: null,
    detail: "No supported private-network tool was found. AION checked only documented Tailscale and WireGuard install locations and does not search your computer. Install Tailscale on this desktop and the phone for away-from-home access. Private phone access still works over home LAN when enabled. AION will never create a tunnel or change your router.",
  };
}

/**
 * Truthful remote-access + mobile dashboard fields.
 */
export async function remoteAccessStatus(settings, listeners = [], env = process.env, platform = process.platform, extras = {}) {
  const network = await detectPrivateNetwork(env, platform);
  const tailscale = await queryTailscaleRuntime(env, platform);
  const enabled = settings.remoteAccess?.enabled === true;
  const configured = settings.remoteAccess?.bindAddress ?? "auto";
  let classification = null;
  try { classification = classifyBindAddress(configured === "auto" ? "auto" : configured); }
  catch { classification = null; }
  const live = listeners.filter((entry) => entry.state === "listening");
  const privateLive = live.filter((entry) => entry.scope === "private");
  const problem = listeners.find((entry) => entry.state === "failed" || entry.state === "refused" || entry.state === "loopback-only");
  const port = live[0]?.port ?? extras.port ?? null;

  const access = discoverAccessEndpoints();
  const lan = discoverPrivateLanAddresses();

  // Prefer live bound private listeners for URLs; fall back to discovery.
  const overlayLive = privateLive.find((e) => {
    try { return classifyBindAddress(e.address).scope === "overlay"; } catch { return false; }
  });
  const physicalLive = privateLive.find((e) => {
    try { return classifyBindAddress(e.address).scope === "local-network"; } catch { return false; }
  });

  const remoteAddress = overlayLive?.address
    || tailscale.ipv4
    || access.overlay?.address
    || physicalLive?.address
    || access.physical?.address
    || null;
  const localLanAddress = physicalLive?.address || access.physical?.address || lan.preferred?.address || null;

  const remoteUrl = remoteAddress && port ? buildAppUrl(remoteAddress, port, "/") : null;
  const remotePhoneUrl = remoteAddress && port ? buildPhoneUrl(remoteAddress, port, "/phone") : null;
  const localPhoneUrl = localLanAddress && port ? buildPhoneUrl(localLanAddress, port, "/phone") : null;
  const localAppUrl = localLanAddress && port ? buildAppUrl(localLanAddress, port, "/") : null;

  const privateRemoteState = (() => {
    if (!enabled) return "OFF";
    if (overlayLive || (tailscale.ipv4 && privateLive.some((l) => l.address === tailscale.ipv4))) return "READY";
    if (access.overlay || tailscale.ipv4) return "READY"; // address exists; may need restart to bind
    if (!tailscale.installed) return "NEEDS_OWNER";
    if (!tailscale.loggedIn || !tailscale.ipv4) return "NEEDS_OWNER";
    if (problem && privateLive.length === 0) return "OFFLINE";
    if (privateLive.length > 0) return "READY"; // at least LAN private path
    return "OFFLINE";
  })();

  const summary = (() => {
    if (!enabled) return "Private phone access is off. AION is reachable only from this computer.";
    if (privateLive.length) {
      const away = privateLive.some((e) => {
        try { return classifyBindAddress(e.address).worksAwayFromHome; } catch { return false; }
      });
      const reach = away
        ? "At least one listener is on a private overlay (e.g. Tailscale), so a paired phone can reach AION from work cellular or work Wi-Fi while the overlay is up."
        : "Listeners are on the home/office LAN only. For away-from-home access, install Tailscale on this desktop and the phone, then restart AION with bind address auto.";
      return `Private phone access is on. Listening on ${privateLive.map((entry) => `${entry.address}:${entry.port}`).join(" and ")} plus loopback. ${reach} Pairing is still required.`;
    }
    if (problem) return `Private phone access is on but NOT fully working: ${problem.detail} AION is still reachable from this computer.`;
    return "Private phone access is on but no private listener is active yet. Restart AION after enabling access or after Tailscale comes online.";
  })();

  const devices = extras.devices ?? [];
  const activeDevices = devices.filter((d) => !d.revokedAt && (d.activeSessions ?? 0) > 0);
  const lastSeen = devices
    .filter((d) => d.lastSeenAt)
    .map((d) => d.lastSeenAt)
    .sort()
    .reverse()[0] ?? null;

  return {
    enabled,
    bindAddress: configured,
    addressScope: classification,
    boundary: NETWORK_BOUNDARY,
    listeners: listeners.map((entry) => ({ ...entry })),
    boundAddress: live.map((entry) => entry.address).join(", ") || "none",
    port,
    sessionDays: settings.remoteAccess?.sessionDays ?? 30,
    loopbackOnly: privateLive.length === 0,
    configurationApplied: !enabled || privateLive.length > 0,
    privateNetwork: network,
    tailscale: {
      installed: tailscale.installed,
      loggedIn: tailscale.loggedIn,
      ipv4: tailscale.ipv4,
      dnsName: tailscale.dnsName,
      version: tailscale.version,
      detail: tailscale.detail,
    },
    lanDiscovery: {
      preferred: access.physical ?? lan.preferred,
      overlay: access.overlay,
      preferredRemote: access.preferredRemote,
      candidates: access.candidates.slice(0, 12),
      suggestedBind: "auto",
    },
    /** Home LAN phone URL (same Wi-Fi). */
    phoneUrl: localPhoneUrl || remotePhoneUrl,
    localAppUrl,
    localPhoneUrl,
    /** Away-from-home private overlay / best remote URL. */
    remoteUrl,
    remotePhoneUrl,
    privateRemoteState,
    mobile: {
      desktopAion: "ONLINE",
      localAccessUrl: port ? `http://127.0.0.1:${port}/` : null,
      privateRemote: privateRemoteState,
      phonePaired: devices.some((d) => !d.revokedAt),
      phoneActiveSession: activeDevices.length > 0,
      remoteUrlOrName: remoteUrl || tailscale.dnsName || null,
      lastPhoneConnection: lastSeen,
      lastPhoneIntake: extras.lastPhoneIntake ?? null,
    },
    summary,
    publiclyExposed: live.some((entry) => ["0.0.0.0", "::", "*"].includes(entry.address)),
  };
}
