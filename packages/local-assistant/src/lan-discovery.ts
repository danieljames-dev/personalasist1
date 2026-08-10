/**
 * Live private LAN IPv4 discovery for phone access.
 *
 * Uses only Node's os.networkInterfaces() — no scanning, no router changes.
 * Prefer active physical private LAN; ignore loopback, APIPA, and common virtual adapters.
 */

import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";

export interface DiscoveredLanAddressV1 {
  address: string;
  netmask: string;
  internal: boolean;
  interfaceName: string;
  /** Higher is better. */
  score: number;
  reason: string;
}

export interface LanDiscoveryResultV1 {
  /** Best address to bind for phone access, or null if none. */
  preferred: DiscoveredLanAddressV1 | null;
  candidates: DiscoveredLanAddressV1[];
  phoneUrlPath: string;
}

const VIRTUAL_IFACE_RE =
  /^(vEthernet|veth|docker|br-|vmware|virtualbox|vbox|hyper-v|WSL|Loopback|Teredo|isatap|Bluetooth|Local Area Connection\*)/i;
const VIRTUAL_IFACE_CONTAINS_RE = /WSL|Hyper-V|Virtual|VMware|VirtualBox|Docker|vEthernet|Tailscale|WireGuard|NordLynx|ZeroTier|Hamachi/i;

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts as [number, number, number, number];
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  // CGNAT / Tailscale range is private overlay — allow but score lower than physical LAN
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isApipa(address: string): boolean {
  return address.startsWith("169.254.");
}

function isLoopback(address: string): boolean {
  return address === "127.0.0.1" || address.startsWith("127.");
}

function scoreInterface(name: string, info: NetworkInterfaceInfo): { score: number; reason: string } | null {
  // Node historically used number 4; modern typings use "IPv4"
  const family = String(info.family);
  if (family !== "IPv4" && family !== "4") return null;
  const address = info.address;
  if (!address || info.internal) return null;
  if (isLoopback(address)) return null;
  if (isApipa(address)) return null;
  if (!isPrivateIpv4(address)) return null;

  let score = 50;
  const reasons: string[] = ["private-ipv4"];

  const virtual = VIRTUAL_IFACE_RE.test(name) || VIRTUAL_IFACE_CONTAINS_RE.test(name);
  if (virtual) {
    score -= 40;
    reasons.push("virtual-adapter");
  } else {
    score += 30;
    reasons.push("likely-physical");
  }

  // Prefer classic home/office LAN over CGNAT overlay and WSL bridge ranges
  if (address.startsWith("192.168.")) {
    score += 25;
    reasons.push("rfc1918-192.168");
  } else if (address.startsWith("10.")) {
    score += 15;
    reasons.push("rfc1918-10");
  } else if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(address)) {
    // Often Hyper-V/WSL default switch — demote unless non-virtual name
    score += virtual ? -10 : 10;
    reasons.push("rfc1918-172");
  } else if (address.startsWith("100.")) {
    score += 5;
    reasons.push("cgnat-overlay");
  }

  // Prefer Ethernet / Wi-Fi naming
  if (/ethernet|eth\d|en\d|wi-?fi|wlan|wl/i.test(name) && !virtual) {
    score += 15;
    reasons.push("ethernet-or-wifi-name");
  }

  return { score, reason: reasons.join(", ") };
}

/**
 * Discover usable private IPv4 addresses from active interfaces.
 */
export function discoverPrivateLanAddresses(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): LanDiscoveryResultV1 {
  const candidates: DiscoveredLanAddressV1[] = [];

  for (const [name, list] of Object.entries(interfaces)) {
    if (!list) continue;
    for (const info of list) {
      const scored = scoreInterface(name, info);
      if (!scored) continue;
      candidates.push({
        address: info.address,
        netmask: info.netmask,
        internal: info.internal,
        interfaceName: name,
        score: scored.score,
        reason: scored.reason,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.address.localeCompare(b.address));
  const preferred = candidates[0] ?? null;

  return {
    preferred,
    candidates,
    phoneUrlPath: "/phone",
  };
}

/** Build phone URL for a host:port. */
export function buildPhoneUrl(address: string, port: number, path = "/phone"): string {
  const host = address.includes(":") && !address.startsWith("[") ? `[${address}]` : address;
  return `http://${host}:${port}${path.startsWith("/") ? path : `/${path}`}`;
}
