import {
  type AuthorizationLifecycleV1,
  AUTHORIZATION_LIFECYCLES_V1,
  DelegatedOperatorError,
} from "./contracts.js";

const ALLOWED_EDGES: ReadonlyMap<AuthorizationLifecycleV1, readonly AuthorizationLifecycleV1[]> = new Map([
  ["PENDING_OWNER_AUTHORIZATION", ["AUTHORIZED", "DENIED", "SUPERSEDED", "EXPIRED"]],
  ["AUTHORIZED", ["RUNNING", "SUPERSEDED", "EXPIRED", "BLOCKED", "FAILED"]],
  ["RUNNING", ["REBOOT_PENDING", "AWAITING_REVIEW", "BLOCKED", "FAILED", "SUPERSEDED", "EXPIRED"]],
  ["REBOOT_PENDING", ["RUNNING", "BLOCKED", "FAILED", "SUPERSEDED", "EXPIRED"]],
  ["AWAITING_REVIEW", ["SUPERSEDED"]],
  ["BLOCKED", ["SUPERSEDED"]],
  ["FAILED", ["SUPERSEDED"]],
  ["DENIED", ["SUPERSEDED"]],
  ["EXPIRED", ["SUPERSEDED"]],
  ["SUPERSEDED", []],
]);

export function isLifecycleV1(value: unknown): value is AuthorizationLifecycleV1 {
  return typeof value === "string" && (AUTHORIZATION_LIFECYCLES_V1 as readonly string[]).includes(value);
}

export function canTransitionLifecycle(
  from: AuthorizationLifecycleV1,
  to: AuthorizationLifecycleV1,
): boolean {
  const next = ALLOWED_EDGES.get(from);
  return next !== undefined && next.includes(to);
}

export function transitionLifecycle(
  from: AuthorizationLifecycleV1,
  to: AuthorizationLifecycleV1,
): AuthorizationLifecycleV1 {
  if (!canTransitionLifecycle(from, to)) {
    throw new DelegatedOperatorError(
      "lifecycle-forbidden",
      `Lifecycle transition ${from} -> ${to} is not permitted.`,
    );
  }
  return to;
}

/** Agent (non-Founder) may only move these edges once proof already exists. */
export function agentMayTransition(from: AuthorizationLifecycleV1, to: AuthorizationLifecycleV1): boolean {
  if (from === "PENDING_OWNER_AUTHORIZATION" && to === "AUTHORIZED") return false;
  if (to === "AUTHORIZED") return false;
  return canTransitionLifecycle(from, to);
}
