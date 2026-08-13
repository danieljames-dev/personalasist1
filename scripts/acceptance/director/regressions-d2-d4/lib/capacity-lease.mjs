/**
 * Capacity and lease are independent gates. Both must pass.
 * This oracle consumes typed resource keys; it does not invent path aliases.
 */
export const EXECUTOR_CAP = Object.freeze({
  claude: { maxConcurrent: 1 },
  grok: { maxConcurrent: 1 },
  local: { maxConcurrent: 2 },
});

export function canStart({
  executor,
  runningByExecutor = {},
  resourceKey,
  heldResourceKeys = [],
  capacity = EXECUTOR_CAP,
}) {
  const cap = capacity[executor];
  if (!cap) return { ok: false, reason: "unknown-executor" };
  const used = runningByExecutor[executor] || 0;
  if (used >= cap.maxConcurrent) return { ok: false, reason: "capacity-exhausted", executor };
  if (!resourceKey) return { ok: false, reason: "resource-key-required" };
  if (heldResourceKeys.includes(resourceKey)) return { ok: false, reason: "lease-held", resourceKey };
  return { ok: true };
}

/** Defective: capacity yes => start, ignore lease. */
export function defectiveCapacityBypassesLease(input) {
  const cap = (input.capacity || EXECUTOR_CAP)[input.executor];
  const used = input.runningByExecutor?.[input.executor] || 0;
  return { ok: Boolean(cap) && used < cap.maxConcurrent, reason: "defective-capacity-only" };
}

/** Defective: lease free => start, ignore capacity. */
export function defectiveLeaseBypassesCapacity(input) {
  return {
    ok: !input.heldResourceKeys?.includes(input.resourceKey),
    reason: "defective-lease-only",
  };
}
