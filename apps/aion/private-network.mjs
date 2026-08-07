import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";

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
  for (const candidate of tailscaleCandidates(env, platform)) {
    try {
      if (!(await stat(candidate)).isFile()) continue;
    } catch { continue; }
    const version = await probe(candidate, ["version"]);
    if (version === null) continue;
    return {
      tool: "tailscale",
      available: true,
      // Executable name only: a full path would carry the owner's user name to the browser.
      executable: basename(candidate),
      version: version.slice(0, 80),
      detail: "A Tailscale CLI is installed. AION has not read your tailnet, signed in, or changed any network setting, and it will not. To use it, turn on private phone access and enter the private address you want AION to bind.",
    };
  }
  return {
    tool: "none",
    available: false,
    executable: null,
    version: null,
    detail: "No supported private-network tool was found. AION checked only documented Tailscale install locations and does not search your computer. Private phone access still works over a network you already control -- enter that private address yourself -- and AION will never create a tunnel or change your router.",
  };
}

/** The truthful summary Settings shows, combining the owner's setting with what is installed. */
export async function remoteAccessStatus(settings, boundAddress, env = process.env, platform = process.platform) {
  const network = await detectPrivateNetwork(env, platform);
  const enabled = settings.remoteAccess?.enabled === true;
  return {
    enabled,
    bindAddress: settings.remoteAccess?.bindAddress ?? "127.0.0.1",
    boundAddress,
    sessionDays: settings.remoteAccess?.sessionDays ?? 30,
    loopbackOnly: !enabled || boundAddress === "127.0.0.1",
    privateNetwork: network,
    summary: enabled
      ? `Private phone access is on. AION is reachable at ${boundAddress} on this machine and on any private network you already control. A paired device is still required; network reachability alone grants nothing.`
      : "Private phone access is off. AION is reachable only from this computer.",
    publiclyExposed: false,
  };
}
