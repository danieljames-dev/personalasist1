/**
 * Dashboard / mission presentation. Do not collapse everything to "waiting."
 */
export const PRESENTATION = Object.freeze({
  WORKING: "WORKING",
  WAITING_ON_OWNER_DEPENDENCY: "WAITING_ON_OWNER_DEPENDENCY",
  BLOCKED: "BLOCKED",
  WAITING_FOR_CAPACITY: "WAITING_FOR_CAPACITY",
  REVIEWING: "REVIEWING",
  READY: "READY",
  DEPLOYMENT_BLOCKED: "DEPLOYMENT_BLOCKED",
  PAUSED: "PAUSED",
});

export function openGateTypes(gates = []) {
  return gates.filter((g) => (g.status || "OPEN") === "OPEN").map((g) => g.type);
}

export function itemBlockedByGates(item, openTypes) {
  return (item.dependsOnGates || []).some((g) => openTypes.includes(g));
}

export function independentActive(items, openTypes) {
  return items.some((item) => {
    if (item.status === "DONE") return false;
    if (itemBlockedByGates(item, openTypes) || item.status === "BLOCKED_ON_OWNER") return false;
    return item.status === "READY" || item.status === "RUNNING";
  });
}

export function presentMission(input) {
  const items = input.workItems || [];
  const open = openGateTypes(input.gates);
  if (input.paused) {
    return {
      presentation: PRESENTATION.PAUSED,
      ownerActionRequired: open.length > 0,
      globallyWaitingForOwner: false,
    };
  }
  if (items.some((i) => i.status === "BLOCKED" || i.kind === "ENGINEER")) {
    return {
      presentation: PRESENTATION.BLOCKED,
      ownerActionRequired: open.length > 0,
      globallyWaitingForOwner: false,
    };
  }
  if (items.some((i) => i.status === "WAITING_FOR_CAPACITY")) {
    return {
      presentation: PRESENTATION.WAITING_FOR_CAPACITY,
      ownerActionRequired: open.length > 0,
      globallyWaitingForOwner: false,
    };
  }
  if (items.some((i) => i.status !== "DONE" && (i.status === "REVIEWING" || i.kind === "INDEPENDENT_REVIEW"))) {
    if (independentActive(items.filter((i) => i.kind !== "INDEPENDENT_REVIEW"), open)
      || items.some((i) => i.status === "RUNNING" && i.kind !== "INDEPENDENT_REVIEW")) {
      return { presentation: PRESENTATION.WORKING, ownerActionRequired: open.length > 0, globallyWaitingForOwner: false };
    }
    return { presentation: PRESENTATION.REVIEWING, ownerActionRequired: open.length > 0, globallyWaitingForOwner: false };
  }

  const deployBlocked = items.some((i) =>
    (i.kind === "PRODUCTION_DEPLOY" || i.id === "production-deploy")
    && (itemBlockedByGates(i, open) || i.status === "BLOCKED_ON_OWNER"));
  const active = independentActive(items, open);

  if (active) {
    return {
      presentation: PRESENTATION.WORKING,
      ownerActionRequired: open.length > 0,
      globallyWaitingForOwner: false,
      deploymentBlocked: deployBlocked,
    };
  }

  if (open.length && items.some((i) => i.status !== "DONE" && (itemBlockedByGates(i, open) || i.status === "BLOCKED_ON_OWNER"))) {
    const onlyDeployLeft = items.every((i) => {
      if (i.status === "DONE") return true;
      return i.kind === "PRODUCTION_DEPLOY"
        || i.kind === "POST_DEPLOY_VERIFY"
        || i.kind === "PHYSICAL_DEVICE_TEST"
        || i.id === "production-deploy";
    });
    return {
      presentation: onlyDeployLeft ? PRESENTATION.DEPLOYMENT_BLOCKED : PRESENTATION.WAITING_ON_OWNER_DEPENDENCY,
      ownerActionRequired: true,
      globallyWaitingForOwner: true,
      deploymentBlocked: deployBlocked,
    };
  }

  if (items.some((i) => i.status === "READY")) {
    return { presentation: PRESENTATION.READY, ownerActionRequired: false, globallyWaitingForOwner: false };
  }
  return { presentation: PRESENTATION.READY, ownerActionRequired: false, globallyWaitingForOwner: false };
}

export function globalWaitingLegal(input) {
  const open = openGateTypes(input.gates);
  const active = independentActive(input.workItems || [], open);
  return open.length > 0 && !active;
}

export function loadDashboardSnapshot(durable) {
  if (!durable) return { ok: false, reason: "missing-durable-dashboard" };
  return { ok: true, snapshot: { ...durable } };
}
