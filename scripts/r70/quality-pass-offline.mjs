/**
 * Offline Owner quality pass (no HTTP): synthetic purge, career seed, completeness.
 */
import { createAionServer } from "../../apps/aion/server.mjs";

const app = await createAionServer({});
const service = app.service;

const sep = await service.separateSyntheticPeopleFromOwnerView();
console.log(
  "SYNTH",
  JSON.stringify({
    rel: sep.relationshipsArchived.length,
    sample: sep.relationshipsArchived.slice(0, 12),
    opp: sep.opportunitiesDisabled,
    noise: sep.noiseFactsDisabled,
  }),
);

await service.separateTestWorkspacesFromOwnerView();
const seed = await service.seedCareerKnowledgeFromResumeEvidence();
console.log("SEED", seed.reply);

const dedupe = await service.dedupeOwnerKnowledgeFacts();
console.log("DEDUPE", JSON.stringify(dedupe));

const comp = await service.ownerDataCompletenessReport();
console.log(comp.reply);

const cap = await service.capabilityStatusCenter();
console.log(cap.reply);

const board = await service.attentionBoard();
console.log("BOARD owner", board.ownerMustDo.length, "aion", board.aionCanDo.length);
for (const i of board.ownerMustDo.slice(0, 10)) console.log("  MUST", i.title);
for (const i of board.aionCanDo.slice(0, 8)) console.log("  AION", i.title);

const cycle = await service.runExecutiveCycle({ dryRun: false });
console.log(
  "CYCLE",
  JSON.stringify({
    ownerMustDo: (cycle.ownerMustDo || []).slice(0, 10),
    aionCompleted: (cycle.aionCompleted || []).slice(0, 8),
    unauthorized: cycle.unauthorizedExternalAttempts,
    jobsCompleted: cycle.jobsCompleted,
    jobsFailed: cycle.jobsFailed,
  }),
);

const gmail = await service.gmailConsentStatus();
const metricool = await service.metricoolReadinessStatus();
console.log("GMAIL", gmail.code, String(gmail.message || "").slice(0, 160));
console.log("METRICOOL", metricool.code, String(metricool.message || "").slice(0, 160));

const snap = await service.snapshot();
const liveRels = (snap.relationships || []).filter((r) => !r.archived);
const facts = (snap.ownerKnowledge?.facts || []).filter((f) => f.enabled !== false);
console.log(
  "STATE",
  JSON.stringify({
    rev: snap.revision,
    docs: snap.crmDocuments?.length,
    facts: facts.length,
    liveRels: liveRels.length,
    profile: snap.ownerKnowledge?.profile?.displayName,
    roots: (snap.settings?.importRoots || []).length,
  }),
);

await app.close?.();
process.exit(0);
