/**
 * Where business evidence lives, and the wall between one business and the next.
 *
 * Isolation is by directory, not by filter. Every read takes a `workspaceId` and looks only inside
 * that workspace's folder, so a caller cannot see another business's evidence by forgetting a
 * `where` clause — the mistake that leaks data in every system that stores everything in one table
 * and trusts the query. Compassionate Choice will eventually hold client information; that is the
 * reason this is structural.
 *
 * Import is a two-step: **plan** reads and decides, **commit** writes. Dry-run is simply the plan
 * without the commit, which is why it cannot mutate anything — there is no code path from planning
 * to disk. Re-import is idempotent because evidence identity is workspace + subject + claim + source,
 * so the same source asserting the same claim twice is one record. A *changed* source becomes a new
 * version and the previous version stays.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { writeAtomic } from "./atomic-write.js";
import {
  BUSINESS_EVIDENCE_SCHEMA_V1,
  BUSINESS_SOURCE_SCHEMA_V1,
  OWNER_QUESTION_SCHEMA_V1,
  classifySensitivity,
  digestOf,
  entitledState,
  evidenceIdFor,
  judgeConflict,
  sensitiveFieldsIn,
  sourceIdFor,
  type BusinessEvidenceV1,
  type BusinessSourceV1,
  type EpistemicStateV1,
  type SensitivityV1,
  type SourceClassV1,
} from "./business-evidence.js";

export class BusinessEvidenceIntegrityError extends Error {
  constructor(readonly path: string, detail: string) {
    super(`business evidence integrity: ${path}: ${detail}`);
    this.name = "BusinessEvidenceIntegrityError";
  }
}

/* -------------------------------------------------------------------------- */
/* Owner questions                                                             */
/* -------------------------------------------------------------------------- */

export interface OwnerQuestionV1 {
  readonly schema: typeof OWNER_QUESTION_SCHEMA_V1;
  readonly questionId: string;
  readonly workspaceId: string;
  readonly missingFact: string;
  readonly whyItMatters: string;
  readonly blocking: boolean;
  readonly evidenceNeeded: string;
  readonly createdAtUtc: string;
  /** Empty while open. A resolved question stays resolved across restart. */
  readonly resolvedAtUtc: string;
  readonly resolutionEvidenceId: string;
}

export function questionIdFor(workspaceId: string, missingFact: string): string {
  return digestOf(`${workspaceId}|${missingFact}`);
}

/* -------------------------------------------------------------------------- */
/* Import planning                                                             */
/* -------------------------------------------------------------------------- */

/** One claim a caller proposes. The caller may assert a state; the store decides what it gets. */
export interface ProposedClaimV1 {
  readonly subject: string;
  readonly claim: string;
  readonly value: string;
  readonly asserted: EpistemicStateV1;
  readonly effectiveFromUtc?: string;
  readonly effectiveToUtc?: string;
  readonly sensitivity?: SensitivityV1;
  readonly note?: string;
}

export interface ProposedSourceV1 {
  readonly sourceClass: SourceClassV1;
  readonly reference: string;
  readonly readable: boolean;
  /** Raw content when readable, used only for the digest. Never stored. */
  readonly content: string;
  readonly observedAtUtc: string;
  readonly sensitivity?: SensitivityV1;
  readonly unreadableReason?: string;
  readonly claims: readonly ProposedClaimV1[];
}

export interface ImportPlanEntryV1 {
  readonly evidenceId: string;
  readonly subject: string;
  readonly claim: string;
  readonly value: string;
  readonly state: EpistemicStateV1;
  readonly stateReason: string;
  readonly action: "CREATE" | "UNCHANGED" | "NEW_VERSION" | "SUPERSEDES" | "CONFLICTS" | "QUARANTINED";
  readonly detail: string;
  readonly sensitiveFields: readonly string[];
}

export interface ImportPlanV1 {
  readonly workspaceId: string;
  readonly sourceId: string;
  readonly sourceVersion: number;
  readonly sourceReadable: boolean;
  readonly entries: readonly ImportPlanEntryV1[];
  readonly quarantined: readonly string[];
  /** Nothing on disk changed to produce this. */
  readonly mutated: false;
}

export interface BusinessEvidenceStoreV1 {
  readonly planImport: (workspaceId: string, source: ProposedSourceV1, now: string) => ImportPlanV1;
  readonly commitImport: (workspaceId: string, source: ProposedSourceV1, now: string) => ImportPlanV1;
  readonly evidence: (workspaceId: string) => readonly BusinessEvidenceV1[];
  readonly sources: (workspaceId: string) => readonly BusinessSourceV1[];
  readonly saveQuestion: (question: OwnerQuestionV1) => void;
  readonly questions: (workspaceId: string) => readonly OwnerQuestionV1[];
}

function safeSegment(value: string, field: string): string {
  if (!/^[A-Za-z0-9._-]+$/u.test(value)) throw new Error(`${field} is not a safe path segment: ${value}`);
  return value;
}

function readJsonDir<T>(dir: string, schema: string, label: string): T[] {
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  return names.sort().map((name) => {
    const path = join(dir, name);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      throw new BusinessEvidenceIntegrityError(path, `${label} is not valid JSON`);
    }
    if ((parsed as { schema?: string }).schema !== schema) {
      throw new BusinessEvidenceIntegrityError(path, `${label} has the wrong schema`);
    }
    return parsed as T;
  });
}

export function createFileBusinessEvidenceStore(root: string): BusinessEvidenceStoreV1 {
  /* One directory per workspace. Reads cannot cross it because they never look above it. */
  const workspaceRoot = (workspaceId: string) => join(root, safeSegment(workspaceId, "workspaceId"));
  const evidenceDir = (workspaceId: string) => join(workspaceRoot(workspaceId), "evidence");
  const sourceDir = (workspaceId: string) => join(workspaceRoot(workspaceId), "sources");
  const questionDir = (workspaceId: string) => join(workspaceRoot(workspaceId), "questions");

  const readEvidence = (workspaceId: string) =>
    readJsonDir<BusinessEvidenceV1>(evidenceDir(workspaceId), BUSINESS_EVIDENCE_SCHEMA_V1, "evidence");
  const readSources = (workspaceId: string) =>
    readJsonDir<BusinessSourceV1>(sourceDir(workspaceId), BUSINESS_SOURCE_SCHEMA_V1, "source");

  /**
   * Decide everything, write nothing.
   *
   * `commitImport` calls this and then persists the result, so a dry-run is the same decision the
   * real import will make — not a second implementation that might disagree with it.
   */
  function plan(workspaceId: string, source: ProposedSourceV1, now: string) {
    const sourceId = sourceIdFor(workspaceId, source.reference);
    const contentDigest = digestOf(source.content);
    const existingSources = readSources(workspaceId).filter((row) => row.sourceId === sourceId);
    const latest = existingSources[existingSources.length - 1] ?? null;

    const unchangedSource = latest !== null && latest.contentDigest === contentDigest;
    const version = latest === null ? 1 : unchangedSource ? latest.version : latest.version + 1;

    const existingEvidence = readEvidence(workspaceId);
    const entries: ImportPlanEntryV1[] = [];
    const quarantined: string[] = [];
    const writes: BusinessEvidenceV1[] = [];
    const supersessions: { id: string; by: string }[] = [];
    const contradictions: { left: string; right: string }[] = [];

    for (const claim of source.claims) {
      if (claim.subject.trim() === "" || claim.claim.trim() === "" ) {
        quarantined.push(`a claim with no subject or category was rejected`);
        entries.push({
          evidenceId: "", subject: claim.subject, claim: claim.claim, value: claim.value,
          state: "UNKNOWN", stateReason: "rejected", action: "QUARANTINED",
          detail: "a claim needs a subject and a category", sensitiveFields: [],
        });
        continue;
      }

      const state = entitledState({
        sourceClass: source.sourceClass,
        readable: source.readable,
        asserted: claim.asserted,
      });
      const evidenceId = evidenceIdFor({ workspaceId, subject: claim.subject, claim: claim.claim, sourceId });
      const sensitiveFields = sensitiveFieldsIn(claim.value);
      const sensitivity = classifySensitivity(claim.value, claim.sensitivity ?? "INTERNAL");

      const record: BusinessEvidenceV1 = {
        schema: BUSINESS_EVIDENCE_SCHEMA_V1,
        evidenceId,
        workspaceId,
        subject: claim.subject,
        claim: claim.claim,
        value: claim.value,
        state: state.state,
        sourceId,
        sourceClass: source.sourceClass,
        observedAtUtc: source.observedAtUtc,
        effectiveFromUtc: claim.effectiveFromUtc ?? "",
        effectiveToUtc: claim.effectiveToUtc ?? "",
        ingestedAtUtc: now,
        sensitivity,
        contradicts: [],
        supersededBy: "",
        note: claim.note ?? "",
      };

      const same = existingEvidence.find((row) => row.evidenceId === evidenceId);
      if (same !== undefined) {
        /*
         * Only the **value** decides whether this source is saying something new.
         *
         * State is not compared, and that is the whole point. A record's state is set by its
         * relationships — the May profile's status became SUPERSEDED when the certificate arrived —
         * so comparing state would make every re-import look like a change and rewrite the record
         * back to what this source alone implies. The first version of this did exactly that, and
         * quietly resurrected superseded history on the second start.
         */
        if (same.value === record.value) {
          entries.push({
            evidenceId, subject: claim.subject, claim: claim.claim, value: claim.value,
            state: same.state, stateReason: "unchanged; state belongs to this record's relationships",
            action: "UNCHANGED",
            detail: "this source already asserts this claim with this value", sensitiveFields,
          });
          continue;
        }
        /* A genuinely changed value is re-judged, but the history it already carries is kept. */
        entries.push({
          evidenceId, subject: claim.subject, claim: claim.claim, value: claim.value,
          state: state.state, stateReason: state.reason, action: "NEW_VERSION",
          detail: `source version ${version}: value changed from "${same.value}"`, sensitiveFields,
        });
        writes.push({ ...record, contradicts: same.contradicts, supersededBy: same.supersededBy });
        continue;
      }

      /*
       * A different source making the same claim: compare, never merge.
       *
       * `UNREAD_SOURCE` records are excluded, and that is not a shortcut. Such a record marks that a
       * document exists which AION could not read — it asserts no value, so there is nothing to
       * disagree with. Letting one participate made the located-but-unreadable certificate "conflict"
       * with the Owner's account of that same certificate, which left the registration status with no
       * governing record at all. You cannot contradict a claim nobody has read.
       */
      const rivals = existingEvidence.filter(
        (row) => row.subject === record.subject && row.claim === record.claim
          && row.sourceId !== sourceId && row.supersededBy === "" && row.state !== "UNREAD_SOURCE",
      );
      if (record.state === "UNREAD_SOURCE") {
        entries.push({
          evidenceId, subject: claim.subject, claim: claim.claim, value: claim.value,
          state: "UNREAD_SOURCE", stateReason: state.reason, action: "CREATE",
          detail: "source located but unreadable; recorded as a gap, not as a claim", sensitiveFields,
        });
        writes.push(record);
        continue;
      }
      let action: ImportPlanEntryV1["action"] = "CREATE";
      let detail = "first record of this claim from this source";
      let recorded = record;

      for (const rival of rivals) {
        const judged = judgeConflict(rival, record);
        if (judged.conflicting) {
          action = "CONFLICTS";
          detail = judged.reason;
          recorded = { ...recorded, state: "CONFLICTED", contradicts: [...recorded.contradicts, rival.evidenceId] };
          contradictions.push({ left: rival.evidenceId, right: evidenceId });
          continue;
        }
        if (judged.superseded?.evidenceId === rival.evidenceId) {
          action = "SUPERSEDES";
          detail = judged.reason;
          supersessions.push({ id: rival.evidenceId, by: evidenceId });
          continue;
        }
        if (judged.superseded?.evidenceId === evidenceId) {
          // The incoming claim is the weaker, older one: it is recorded as history immediately.
          action = "SUPERSEDES";
          detail = judged.reason;
          recorded = { ...recorded, state: "SUPERSEDED", supersededBy: rival.evidenceId };
        }
      }

      entries.push({
        evidenceId, subject: claim.subject, claim: claim.claim, value: claim.value,
        state: recorded.state, stateReason: state.reason, action, detail, sensitiveFields,
      });
      writes.push(recorded);
    }

    const sourceRecord: BusinessSourceV1 = {
      schema: BUSINESS_SOURCE_SCHEMA_V1,
      sourceId,
      workspaceId,
      sourceClass: source.sourceClass,
      reference: source.reference,
      readable: source.readable,
      contentDigest,
      version,
      observedAtUtc: source.observedAtUtc,
      ingestedAtUtc: now,
      sensitivity: source.sensitivity ?? "INTERNAL",
      unreadableReason: source.readable ? "" : (source.unreadableReason ?? "unspecified"),
    };

    const planResult: ImportPlanV1 = {
      workspaceId,
      sourceId,
      sourceVersion: version,
      sourceReadable: source.readable,
      entries,
      quarantined,
      mutated: false,
    };
    return { planResult, writes, sourceRecord, unchangedSource, supersessions, contradictions };
  }

  return {
    planImport(workspaceId, source, now) {
      return plan(workspaceId, source, now).planResult;
    },

    commitImport(workspaceId, source, now) {
      const { planResult, writes, sourceRecord, unchangedSource, supersessions, contradictions } =
        plan(workspaceId, source, now);

      /* Source versions accumulate; a changed source never overwrites the version before it. */
      if (!unchangedSource) {
        writeAtomic(
          join(sourceDir(workspaceId), `${sourceRecord.sourceId}.v${sourceRecord.version}.json`),
          `${JSON.stringify(sourceRecord, null, 2)}\n`,
        );
      }

      const byId = new Map(readEvidence(workspaceId).map((row) => [row.evidenceId, row]));
      for (const record of writes) byId.set(record.evidenceId, record);

      for (const { id, by } of supersessions) {
        const row = byId.get(id);
        // Already superseded stays attributed to whatever overtook it first.
        if (row !== undefined && row.supersededBy === "") {
          byId.set(id, { ...row, state: "SUPERSEDED", supersededBy: by });
        }
      }
      for (const { left, right } of contradictions) {
        for (const [a, b] of [[left, right], [right, left]] as const) {
          const row = byId.get(a);
          if (row !== undefined && !row.contradicts.includes(b)) {
            byId.set(a, { ...row, state: "CONFLICTED", contradicts: [...row.contradicts, b] });
          }
        }
      }

      for (const record of byId.values()) {
        writeAtomic(
          join(evidenceDir(workspaceId), `${record.evidenceId}.json`),
          `${JSON.stringify(record, null, 2)}\n`,
        );
      }
      return planResult;
    },

    evidence: (workspaceId) => readEvidence(workspaceId),
    sources: (workspaceId) => readSources(workspaceId),

    saveQuestion(question) {
      writeAtomic(
        join(questionDir(question.workspaceId), `${safeSegment(question.questionId, "questionId")}.json`),
        `${JSON.stringify(question, null, 2)}\n`,
      );
    },
    questions: (workspaceId) =>
      readJsonDir<OwnerQuestionV1>(questionDir(workspaceId), OWNER_QUESTION_SCHEMA_V1, "question"),
  };
}
