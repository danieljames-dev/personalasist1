import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type {
  AssistantStateV1, DeviceSessionV1, IsoTimestamp, PairedDeviceV1, PairingTokenV1, RateLimitBucketV1,
} from "./contracts.js";

/**
 * Phone access control.
 *
 * Two independent things must both be true before a request from anything other than loopback is
 * served: the owner must have turned private access on, and the request must carry a session
 * issued by a pairing the owner performed at the console. Network reachability is never treated as
 * authentication -- a VPN decides which machines can open a socket, not who is holding the phone.
 *
 * Nothing secret is persisted. A pairing code and a session token are returned exactly once, in a
 * response body; AION keeps only their SHA-256 digests, so the state file grants no access even if
 * it is read. Comparisons are constant-time.
 */

function fail(message: string): never { throw new Error(message); }
export function digestSecret(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function sameDigest(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex"); const right = Buffer.from(b, "hex");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}
/** URL-safe, high-entropy, and never placed in a URL regardless. */
function secret(bytes = 32): string { return randomBytes(bytes).toString("base64url"); }
/** A pairing code the owner can read off a screen and type on a phone. */
export function newPairingCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1: they are misread when typed
  const raw = randomBytes(12);
  return [...raw].slice(0, 10).map((byte) => alphabet[byte % alphabet.length]).join("").replace(/(.{5})(.{5})/u, "$1-$2");
}
export function newSessionToken(): string { return secret(32); }

export const PAIRING_TTL_MINUTES = 10;
export const RATE_WINDOW_MINUTES = 15;
export const RATE_MAX_ATTEMPTS = 8;
export const RATE_BLOCK_MINUTES = 15;

const minutes = (n: number) => n * 60_000;

/**
 * A fixed-window failed-attempt counter. Only failures count, so a phone in normal use is never
 * throttled, and a guessing attempt is blocked after a handful of tries.
 */
export function checkRateLimit(state: AssistantStateV1, key: string, now: IsoTimestamp): { allowed: boolean; retryAfterSeconds: number } {
  const bucket = state.rateLimits.find((entry) => entry.key === key);
  if (!bucket) return { allowed: true, retryAfterSeconds: 0 };
  const at = Date.parse(now);
  if (bucket.blockedUntil && Date.parse(bucket.blockedUntil) > at) {
    return { allowed: false, retryAfterSeconds: Math.ceil((Date.parse(bucket.blockedUntil) - at) / 1000) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}
export function recordFailure(state: AssistantStateV1, key: string, now: IsoTimestamp): void {
  const at = Date.parse(now);
  let bucket = state.rateLimits.find((entry) => entry.key === key);
  if (!bucket || Date.parse(bucket.windowStartedAt) + minutes(RATE_WINDOW_MINUTES) <= at) {
    bucket = { key, windowStartedAt: now, attempts: 0, blockedUntil: null };
    state.rateLimits = [...state.rateLimits.filter((entry) => entry.key !== key), bucket];
  }
  bucket.attempts += 1;
  if (bucket.attempts >= RATE_MAX_ATTEMPTS) bucket.blockedUntil = new Date(at + minutes(RATE_BLOCK_MINUTES)).toISOString();
  if (state.rateLimits.length > 200) state.rateLimits = state.rateLimits.slice(-200);
}
export function clearRateLimit(state: AssistantStateV1, key: string): void {
  state.rateLimits = state.rateLimits.filter((entry) => entry.key !== key);
}

/** Issues a one-time pairing code. Only its digest is kept; the code is returned exactly once. */
export function issuePairingToken(state: AssistantStateV1, label: string, id: string, now: IsoTimestamp): { token: PairingTokenV1; code: string } {
  const trimmed = label.trim();
  if (!trimmed || trimmed.length > 80) fail("A device label is required so you can tell paired phones apart.");
  const code = newPairingCode();
  const token: PairingTokenV1 = {
    id, codeHash: digestSecret(code), label: trimmed, createdAt: now,
    expiresAt: new Date(Date.parse(now) + minutes(PAIRING_TTL_MINUTES)).toISOString(), consumedAt: null,
  };
  // Only one outstanding code at a time: an unused older code stops working the moment a new one
  // is issued, so a code left on screen cannot be used later.
  for (const existing of state.pairingTokens) if (!existing.consumedAt) existing.consumedAt = now;
  state.pairingTokens = [token, ...state.pairingTokens].slice(0, 20);
  return { token, code };
}

/**
 * Redeems a pairing code for a device session. Single use, short-lived, constant-time compared.
 * The returned token is the only time the secret exists outside the phone.
 */
export function redeemPairingCode(
  state: AssistantStateV1, code: string, ids: { deviceId: string; sessionId: string }, now: IsoTimestamp, sessionDays: number,
): { device: PairedDeviceV1; session: DeviceSessionV1; token: string } {
  const candidate = digestSecret(String(code ?? "").trim().toUpperCase());
  const at = Date.parse(now);
  const match = state.pairingTokens.find((entry) => !entry.consumedAt && Date.parse(entry.expiresAt) > at && sameDigest(entry.codeHash, candidate));
  if (!match) fail("That pairing code is not valid. Codes are single-use and expire quickly; generate a new one in Settings.");
  match.consumedAt = now;
  const device: PairedDeviceV1 = { id: ids.deviceId, label: match.label, createdAt: now, lastSeenAt: now, revokedAt: null };
  const token = newSessionToken();
  const session: DeviceSessionV1 = {
    id: ids.sessionId, deviceId: device.id, tokenHash: digestSecret(token), createdAt: now,
    expiresAt: new Date(at + sessionDays * 86_400_000).toISOString(), lastSeenAt: now, revokedAt: null,
  };
  state.devices = [device, ...state.devices];
  state.sessions = [session, ...state.sessions];
  return { device, session, token };
}

export interface AuthenticatedDeviceV1 { device: PairedDeviceV1; session: DeviceSessionV1; }

/**
 * Resolves a bearer token to a live session. Everything fails closed: an unknown, expired,
 * revoked, or orphaned token, or a revoked device, is simply not authenticated.
 */
export function authenticate(state: AssistantStateV1, token: string, now: IsoTimestamp): AuthenticatedDeviceV1 | null {
  if (typeof token !== "string" || token.length < 20 || token.length > 512) return null;
  const candidate = digestSecret(token);
  const at = Date.parse(now);
  const session = state.sessions.find((entry) => sameDigest(entry.tokenHash, candidate));
  if (!session || session.revokedAt || Date.parse(session.expiresAt) <= at) return null;
  const device = state.devices.find((entry) => entry.id === session.deviceId);
  if (!device || device.revokedAt) return null;
  return { device, session };
}

/** Revoking a device ends its sessions and nothing else. No owner record is touched. */
export function revokeDevice(state: AssistantStateV1, deviceId: string, now: IsoTimestamp): number {
  const device = state.devices.find((entry) => entry.id === deviceId);
  if (!device) fail("That device is not paired.");
  device.revokedAt = device.revokedAt ?? now;
  let ended = 0;
  for (const session of state.sessions) if (session.deviceId === deviceId && !session.revokedAt) { session.revokedAt = now; ended += 1; }
  return ended;
}

/** Ends every session on every device and invalidates any outstanding pairing code. */
export function revokeAllDevices(state: AssistantStateV1, now: IsoTimestamp): { devices: number; sessions: number } {
  let devices = 0; let sessions = 0;
  for (const device of state.devices) if (!device.revokedAt) { device.revokedAt = now; devices += 1; }
  for (const session of state.sessions) if (!session.revokedAt) { session.revokedAt = now; sessions += 1; }
  for (const token of state.pairingTokens) if (!token.consumedAt) token.consumedAt = now;
  return { devices, sessions };
}

/** Drops expired sessions and stale pairing codes. Called on every write, like other pruning. */
export function pruneAccess(state: AssistantStateV1, now: IsoTimestamp): void {
  const at = Date.parse(now);
  for (const session of state.sessions) if (!session.revokedAt && Date.parse(session.expiresAt) <= at) session.revokedAt = new Date(at).toISOString();
  state.sessions = state.sessions.filter((entry) => !entry.revokedAt || Date.parse(entry.revokedAt) > at - 30 * 86_400_000).slice(0, 200);
  state.pairingTokens = state.pairingTokens.filter((entry) => !entry.consumedAt && Date.parse(entry.expiresAt) > at).slice(0, 20);
  state.rateLimits = state.rateLimits.filter((entry) => (entry.blockedUntil && Date.parse(entry.blockedUntil) > at) || Date.parse(entry.windowStartedAt) + minutes(RATE_WINDOW_MINUTES) > at);
}

/** A bind address AION will accept. Never a wildcard, never a routable public address. */
export function validateBindAddress(value: string): string {
  const address = String(value ?? "").trim();
  if (!address) fail("A bind address is required.");
  if (["0.0.0.0", "::", "*", "::0"].includes(address)) fail("AION never binds a wildcard address. Name the exact private interface instead.");
  if (address === "127.0.0.1" || address === "::1") return address;
  const parts = address.split(".");
  const octets = parts.length === 4 ? parts.map((part) => Number(part)) : null;
  const privateIpv4 = octets !== null && octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
    && (octets[0] === 10 || (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31) || (octets[0] === 192 && octets[1] === 168)
      || (octets[0] === 100 && octets[1]! >= 64 && octets[1]! <= 127) || (octets[0] === 169 && octets[1] === 254));
  const privateIpv6 = /^(?:fd|fe80)/iu.test(address);
  if (!privateIpv4 && !privateIpv6) fail("Only a loopback or private-network address may be bound. AION never exposes itself to the public internet.");
  return address;
}
