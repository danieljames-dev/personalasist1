/**
 * Live hardening pass: encrypted backup → review compress → brand seed → quality.
 */
import { createAionServer } from "../../apps/aion/server.mjs";

const app = await createAionServer({});
const service = app.service;

const backup = await service.preImportPrivateStateBackup();
console.log(
  "BACKUP",
  JSON.stringify({
    ok: backup.ok,
    encrypted: backup.encrypted,
    encryptedPathSet: Boolean(backup.encryptedPath),
    revision: backup.revision,
  }),
);

const before = (await service.listImportReviewQueue()).filter((r) => r.status === "needs-review").length;
const compress = await service.compressImportReviewQueue();
console.log("REVIEW", compress.reply);

const brand = await service.seedCompassionateChoiceBrandFromEvidence();
console.log("BRAND", brand.reply);

const career = await service.seedCareerKnowledgeFromResumeEvidence();
console.log("CAREER", career.reply?.slice?.(0, 200) || career);

await service.separateSyntheticPeopleFromOwnerView();
await service.separateTestWorkspacesFromOwnerView();

const complete = await service.ownerDataCompletenessReport();
console.log(complete.reply);

const cap = await service.capabilityStatusCenter();
console.log(cap.reply);

const gmail = await service.gmailConsentStatus();
console.log(
  "GMAIL",
  JSON.stringify({
    code: gmail.code,
    clientIdConfigured: gmail.clientIdConfigured,
    ownerAction: gmail.ownerAction,
    ownerSteps: gmail.ownerSteps,
  }),
);

const metricool = await service.metricoolReadinessStatus();
console.log("METRICOOL", metricool.code, metricool.message?.slice?.(0, 120));

const board = await service.attentionBoard();
console.log("BOARD", { owner: board.ownerMustDo.length, aion: board.aionCanDo.length });

const after = (await service.listImportReviewQueue()).filter((r) => r.status === "needs-review").length;
console.log(
  JSON.stringify({
    REVIEW_QUEUE_BEFORE: before,
    REVIEW_QUEUE_AFTER: after,
    COMPRESS_STATS: {
      autoRejected: compress.autoRejected,
      autoAccepted: compress.autoAccepted,
      kept: compress.kept,
    },
  }),
);

await app.close?.();
process.exit(0);
