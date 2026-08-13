/**
 * D3 Director HTTP + Command Center bridge policy.
 * Correct machine vs defective alternatives used only to prove tests bite.
 */
export const DIRECTOR_BIND_HOST = "127.0.0.1";
export const DIRECTOR_BIND_PORT = 31417;
export const MAX_REQUEST_BYTES = 64 * 1024;
export const DIRECTOR_TIMEOUT_MS = 3_000;

export const ALLOWED_DIRECTOR_PATHS = Object.freeze([
  "GET /status",
  "GET /mission",
  "GET /gates",
  "GET /events",
  "POST /gates/resolve",
  "POST /pause",
  "POST /resume",
  "POST /emergency-stop",
]);

export const FORBIDDEN_GENERIC_MUTATIONS = Object.freeze([
  "POST /state",
  "POST /gates/clear",
  "POST /deploymentTruth",
  "POST /leases/release",
  "POST /review/pass",
  "POST /authorizeProduction",
  "POST /mission/complete",
]);

export function bindHostAllowed(host) {
  return host === DIRECTOR_BIND_HOST;
}

export function classifyDirectorRoute(method, pathname) {
  const key = `${String(method || "GET").toUpperCase()} ${normalizePath(pathname)}`;
  if (ALLOWED_DIRECTOR_PATHS.includes(key)) return { allowed: true, key };
  if (FORBIDDEN_GENERIC_MUTATIONS.includes(key)) {
    return { allowed: false, key, reason: "generic-mutation-forbidden" };
  }
  return { allowed: false, key, reason: "unknown-route" };
}

export function normalizePath(pathname) {
  const raw = String(pathname || "/");
  const noQuery = raw.split("?")[0];
  const trimmed = noQuery.replace(/\/+$/, "") || "/";
  return trimmed;
}

export function bridgeTargetAllowed(input) {
  const reasons = [];
  if (input.unpaired) reasons.push("unpaired");
  if (input.forgedOrigin) reasons.push("forged-origin");
  if (input.absoluteUrl) reasons.push("absolute-url-ssrf");
  if (input.hostOverride) reasons.push("host-override-ssrf");
  if (input.portOverride && input.portOverride !== DIRECTOR_BIND_PORT) reasons.push("port-override-ssrf");
  if (input.pathTraversal) reasons.push("path-traversal");
  const route = classifyDirectorRoute(input.method, input.pathname);
  if (!route.allowed) reasons.push(route.reason);
  if (typeof input.bytes === "number" && input.bytes > MAX_REQUEST_BYTES) reasons.push("oversized");
  return { ok: reasons.length === 0, reasons, route: route.key };
}

export function mapDirectorFailure(kind) {
  if (kind === "down" || kind === "econnrefused") {
    return { status: 503, code: "DIRECTOR_UNAVAILABLE" };
  }
  if (kind === "timeout") return { status: 504, code: "DIRECTOR_TIMEOUT" };
  if (kind === "malformed") return { status: 502, code: "DIRECTOR_MALFORMED" };
  if (kind === "oversized") return { status: 413, code: "REQUEST_TOO_LARGE" };
  return { status: 500, code: "DIRECTOR_ERROR" };
}

export function authorityFrom(origin) {
  return origin === "OWNER_DIRECTIVE";
}

export function applyOwnerAction(ctx, action) {
  if (!authorityFrom(action.origin)) {
    return { ok: false, ctx, reason: "forged-authority" };
  }
  if (action.type === "RESOLVE_GATE" && action.gateId && ctx.gates?.[action.gateId]?.status === "OPEN") {
    const gates = { ...ctx.gates, [action.gateId]: { ...ctx.gates[action.gateId], status: "APPROVED" } };
    return { ok: true, ctx: { ...ctx, gates }, reason: "owner-resolved-gate" };
  }
  return { ok: false, ctx, reason: "unsupported-owner-action" };
}

/** Defective: any POST body can write mission fields. */
export function defectiveGenericMutation(ctx, body = {}) {
  return { ok: true, ctx: { ...ctx, ...body }, reason: "defective-merge" };
}

/** Defective: bridge fetches whatever URL the client names. */
export function defectiveBridgeTarget(input) {
  return { ok: true, url: input.url || input.pathname, reason: "defective-open-proxy" };
}
