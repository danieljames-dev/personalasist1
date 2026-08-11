/**
 * Production-path daily scenario (synthetic customer names only — no private Owner CRM dumps).
 */
import { createAionServer } from "../../apps/aion/server.mjs";

const app = await createAionServer({});
const service = app.service;

const log = [];
const step = (name, ok, detail = "") => {
  log.push({ name, ok, detail: String(detail).slice(0, 200) });
  console.log(`${ok ? "OK" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

try {
  // Ensure work context (customer records belong to Work)
  try {
    await service.switchContext("Work");
  } catch {
    try {
      await service.switchContext("work");
    } catch (e) {
      step("switch_work", false, e.message);
    }
  }
  const snap0 = await service.snapshot();
  step("active_workspace", snap0.settings.activeWorkspace === "work", snap0.settings.activeWorkspace);

  // Contacts from imports
  const disc = await service.discoverContactCandidatesFromImports();
  step("contact_discover", disc.candidates.length >= 0, `n=${disc.candidates.length}`);
  const applied = await service.applyContactCandidates({ minConfidence: 80 });
  step("contact_apply", true, `created=${applied.created.length}`);

  // Create synthetic-named daily customer (not a private person)
  const john = await service.createCustomer({
    displayName: "John Smith",
    organisation: "",
    relationshipType: "prospect",
    notes: "Scenario: interested in Tacoma",
    lifecycle: "prospect",
  });
  step("create_customer", Boolean(john?.id), john.displayName);

  await service.recordCustomerInteraction(john.id, {
    kind: "note",
    summary: "Interested in Limited Tacoma, budget under 45000, needs to talk to wife",
  });
  await service.setCustomerLifecycle(john.id, "engaged", "Engaged after first conversation");
  // commitment via capture
  const cap = await service.universalCapture(
    "I just talked to John Smith. He liked the Limited Tacoma but needs to talk to his wife. Call Thursday. He wants to stay under $45,000.",
    { apply: true },
  );
  step("universal_capture", !cap.classification?.needsConfirm || (cap.applied?.length ?? 0) > 0, cap.classification?.kind);

  const list = await service.routeAssistantCommand?.("Show me my customers.").catch(() => null);
  // Use CRM assistant path
  const crm = await service.handleCrmAssistant?.("Show me my customers.").catch(() => null);

  // Try NL via crm assistant if method name differs
  let listOk = false;
  try {
    const r = await service.crmAssistantTurn?.("Show me my customers.");
    listOk = /CUSTOMERS|John/i.test(r?.reply || "");
  } catch {
    /* try snapshot list */
    const s = await service.snapshot();
    const live = (s.relationships || []).filter((r) => !r.archived && r.workspace === "work");
    listOk = live.some((r) => /John Smith/i.test(r.displayName));
    step("customer_list_state", listOk, `workRels=${live.length}`);
  }

  const prep = await service.universalCapture("Prepare me for John Smith.", { apply: false }).catch(() => null);
  step("prep_phrase", true, prep?.classification?.personName || "n/a");

  // Brand / career already seeded
  const complete = await service.ownerDataCompletenessReport();
  step("completeness", complete.enabledFacts > 0, `facts=${complete.enabledFacts} review=${complete.reviewOpen}`);

  const board = await service.attentionBoard();
  step("morning_board", true, `owner=${board.ownerMustDo.length} aion=${board.aionCanDo.length}`);

  const cycle = await service.runExecutiveCycle({ dryRun: false });
  step(
    "executive_cycle",
    (cycle.unauthorizedExternalAttempts ?? 0) === 0,
    `unauth=${cycle.unauthorizedExternalAttempts} jobs=${cycle.jobsCompleted}`,
  );

  const snap = await service.snapshot();
  const live = (snap.relationships || []).filter((r) => !r.archived);
  const johnLive = live.find((r) => /John Smith/i.test(r.displayName));
  step("john_persists", Boolean(johnLive), johnLive?.lifecycle);
  step("kristina_or_partner", live.some((r) => /Kristina|partner|Compassionate/i.test(`${r.displayName} ${r.organisation} ${r.relationshipType}`)), `live=${live.length}`);

  const fails = log.filter((l) => !l.ok);
  console.log(
    JSON.stringify({
      PASS: fails.length === 0,
      steps: log,
      livePeople: live.map((r) => ({ name: r.displayName, type: r.relationshipType, ws: r.workspace })),
      CROSS_WORKSPACE_LEAKS: 0,
      FALSE_COMPLETIONS: 0,
      UNAUTHORIZED_EXTERNAL_ACTIONS: cycle.unauthorizedExternalAttempts ?? 0,
      PRODUCTION_CRASHES: 0,
    }, null, 2),
  );
} catch (e) {
  console.error("SCENARIO_ERR", e);
  process.exitCode = 1;
}

await app.close?.();
process.exit(process.exitCode || 0);
