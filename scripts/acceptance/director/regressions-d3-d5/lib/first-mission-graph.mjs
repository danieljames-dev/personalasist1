/**
 * DAILY_INTELLIGENCE_FINALIZATION work graph.
 * Physical iPhone gate blocks deployment only.
 */
export const FIRST_MISSION_ID = "daily-intelligence-finalization";

export function firstMissionTemplate() {
  return {
    missionId: FIRST_MISSION_ID,
    gates: [
      { id: "g-physical", type: "PHYSICAL_IPHONE_TEST_REQUIRED", status: "OPEN" },
    ],
    workItems: [
      {
        id: "safe-finalization",
        kind: "ORDINARY",
        dependsOnGates: [],
        status: "READY",
        authorized: true,
      },
      {
        id: "independent-review",
        kind: "INDEPENDENT_REVIEW",
        dependsOnGates: [],
        status: "READY",
        authorized: true,
      },
      {
        id: "integration-safe",
        kind: "ORDINARY",
        dependsOnGates: [],
        status: "READY",
        authorized: true,
      },
      {
        id: "physical-iphone-retest",
        kind: "PHYSICAL_DEVICE_TEST",
        dependsOnGates: ["PHYSICAL_IPHONE_TEST_REQUIRED"],
        status: "BLOCKED_ON_OWNER",
        authorized: true,
      },
      {
        id: "production-deploy",
        kind: "PRODUCTION_DEPLOY",
        dependsOnGates: ["PHYSICAL_IPHONE_TEST_REQUIRED"],
        status: "BLOCKED_ON_OWNER",
        authorized: true,
      },
      {
        id: "post-deploy-verify",
        kind: "POST_DEPLOY_VERIFY",
        dependsOnGates: ["PHYSICAL_IPHONE_TEST_REQUIRED"],
        status: "BLOCKED_ON_OWNER",
        authorized: true,
      },
    ],
  };
}

export function mayLaunch(item, gates) {
  const open = (gates || []).filter((g) => g.status === "OPEN").map((g) => g.type);
  if (item.status === "DONE" || item.status === "RUNNING") return false;
  if ((item.dependsOnGates || []).some((g) => open.includes(g))) return false;
  if (item.status === "BLOCKED_ON_OWNER") return false;
  return item.status === "READY" && item.authorized === true;
}

export function resolveGate(mission, gateType, origin) {
  if (origin !== "OWNER_DIRECTIVE") {
    return { ok: false, mission, reason: "forged-authority" };
  }
  const gates = mission.gates.map((g) => (
    g.type === gateType && g.status === "OPEN" ? { ...g, status: "APPROVED" } : g
  ));
  const workItems = mission.workItems.map((item) => {
    const still = (item.dependsOnGates || []).some((g) =>
      gates.some((x) => x.type === g && x.status === "OPEN"));
    if (!still && item.status === "BLOCKED_ON_OWNER") return { ...item, status: "READY" };
    return item;
  });
  return { ok: true, mission: { ...mission, gates, workItems } };
}

export function launchableIds(mission) {
  return mission.workItems.filter((i) => mayLaunch(i, mission.gates)).map((i) => i.id);
}
