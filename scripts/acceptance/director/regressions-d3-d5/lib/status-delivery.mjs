/**
 * v0.1 status delivery: polling vs SSE.
 * Prefer the simpler design that still survives restart and bounds resources.
 */
export const STATUS_DELIVERY = Object.freeze({
  recommended: "POLLING",
  intervalMs: 2000,
  timeoutMs: 3000,
  staleIfRevisionUnchangedSeconds: 120,
  carryRevision: true,
});

export function evaluateDelivery(kind, scenario) {
  if (kind === "POLLING") {
    if (scenario === "restart") return { ok: true, how: "next poll reads durable snapshot" };
    if (scenario === "stale") return { ok: true, how: "compare revision/updatedAt; ignore older" };
    if (scenario === "disconnect") return { ok: true, how: "client stops; no server push buffer" };
    if (scenario === "bounded") return { ok: true, how: "one in-flight GET /status" };
  }
  if (kind === "SSE") {
    if (scenario === "restart") return { ok: true, how: "reconnect + replay; more state" };
    if (scenario === "stale") return { ok: true, how: "event ids; easier to get wrong" };
    if (scenario === "disconnect") return { ok: true, how: "must detect half-open Tailscale" };
    if (scenario === "bounded") return { ok: false, how: "long-lived connection per phone" };
  }
  return { ok: false, how: "unknown" };
}

export function recommendStatusDelivery() {
  const polls = ["restart", "stale", "disconnect", "bounded"].map((s) => evaluateDelivery("POLLING", s));
  return {
    recommendation: "POLLING",
    intervalMs: STATUS_DELIVERY.intervalMs,
    why: "Restart recovery is a durable GET. Stale handling is revision compare. Disconnect costs nothing. One in-flight request bounds the phone. SSE can work later; v0.1 should not take a long-lived push path.",
    pollingSatisfies: polls.every((p) => p.ok),
  };
}
