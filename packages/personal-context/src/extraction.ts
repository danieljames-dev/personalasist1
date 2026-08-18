/**
 * Turning approved bytes into facts, without ever turning approved bytes into guesses.
 *
 * Extraction here is **declaration-driven**: a file yields facts only when it is a structured
 * context declaration that states, in its own words, what the claim is and when it was true. Free
 * prose is read and produces nothing.
 *
 * That is a deliberate refusal, not a gap waiting to be filled. A resume parser that infers "current
 * employer" from the topmost dated block is right most of the time and confidently wrong the rest,
 * and this system's entire purpose is to stop a confident wrong answer reaching a recommender. A
 * file the extractor cannot support is reported as `UNSUPPORTED_CONTENT` in the sync receipt, which
 * is a visible gap the Owner can close by supplying a declaration — rather than an invisible
 * fabrication nobody audits.
 *
 * The document supplies the claim and its dates. This module supplies provenance, sensitivity
 * bounds, provider eligibility, freshness, and identity — the parts a document must not be trusted
 * to assert about itself.
 */

import type { ProviderIdV1, SensitivityClassV1 } from "@aion/director";

import {
  claimKeyOf,
  CONFIDENCE_LEVELS_V1,
  CONTEXT_CATEGORIES_V1,
  ELIGIBLE_USES_V1,
  PERSONAL_CONTEXT_DECLARATION_SCHEMA_V1,
  PERSONAL_CONTEXT_SCHEMA_V1,
  sensitivityRank,
  TEMPORAL_STATES_V1,
  validatePersonalContextFact,
  type ConfidenceLevelV1,
  type ContextCategoryV1,
  type ContextSourceV1,
  type EligibleUseV1,
  type PersonalContextFactV1,
  type TemporalStateV1,
} from "./contracts.js";
import { providersEligibleForSensitivity } from "./disclosure.js";
import { assessFreshness } from "./freshness.js";
import { digestOf, sha256Hex } from "./hash.js";

export interface DeclaredFactV1 {
  readonly category: string;
  readonly predicate: string;
  readonly value: string;
  readonly normalizedValue?: string;
  readonly evidenceReference?: string;
  readonly observedAt?: string | null;
  readonly lastConfirmedAt?: string | null;
  readonly confidence?: string;
  readonly sensitivity?: string;
  readonly temporalState?: string;
  readonly validFrom?: string | null;
  readonly validTo?: string | null;
  readonly eligibleUses?: readonly string[];
}

export interface ContextDeclarationV1 {
  readonly schema: typeof PERSONAL_CONTEXT_DECLARATION_SCHEMA_V1;
  readonly subject: string;
  readonly documentId: string;
  readonly facts: readonly DeclaredFactV1[];
}

export type SkipReasonV1 =
  | "UNSUPPORTED_CONTENT"
  | "MALFORMED_DECLARATION"
  | "SENSITIVITY_ABOVE_SOURCE"
  | "CATEGORY_NOT_SUPPORTED"
  | "FACT_REJECTED"
  | "CREDENTIAL_MATERIAL";

export interface ExtractionSkipV1 {
  readonly sourceReference: string;
  readonly reason: SkipReasonV1;
  readonly detail: string;
}

export interface ExtractionResultV1 {
  readonly facts: readonly PersonalContextFactV1[];
  readonly skips: readonly ExtractionSkipV1[];
  /** True when the file was a declaration this extractor understands, whatever came of its rows. */
  readonly recognized: boolean;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function asNullableInstant(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** Whitespace-collapsed, case-folded — the spelling two sources are compared on. */
export function normalizeValue(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Read a declaration, or say precisely why the bytes are not one.
 *
 * A file that is simply not a declaration (a `package.json`, a README) is not an error: it comes back
 * `null` with no message, and the caller records `UNSUPPORTED_CONTENT`. A file that *claims* to be a
 * declaration and is malformed is an error, because silently ignoring it would hide a broken source.
 */
export function parseDeclaration(raw: string): { declaration: ContextDeclarationV1 | null; error: string | null } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { declaration: null, error: null };
  }
  if (parsed === null || typeof parsed !== "object") return { declaration: null, error: null };
  const candidate = parsed as Record<string, unknown>;
  if (candidate["schema"] !== PERSONAL_CONTEXT_DECLARATION_SCHEMA_V1) return { declaration: null, error: null };

  const subject = asString(candidate["subject"]);
  if (subject === null) return { declaration: null, error: "declaration subject is empty" };
  const documentId = asString(candidate["documentId"]);
  if (documentId === null) return { declaration: null, error: "declaration documentId is empty" };
  const facts = candidate["facts"];
  if (!Array.isArray(facts)) return { declaration: null, error: "declaration facts is not a list" };

  return {
    declaration: {
      schema: PERSONAL_CONTEXT_DECLARATION_SCHEMA_V1,
      subject,
      documentId,
      facts: facts as readonly DeclaredFactV1[],
    },
    error: null,
  };
}

export interface ExtractionInputV1 {
  readonly source: ContextSourceV1;
  readonly sourceReference: string;
  readonly contents: string;
  readonly sourceModifiedAt: string | null;
  readonly now: string;
}

/**
 * Extract every supportable fact from one approved file.
 *
 * Each produced fact is validated before it is returned. A row that fails validation is skipped and
 * reported rather than repaired — a fact the contract refuses is a fact this package does not know
 * how to be honest about.
 */
export function extractFactsFromFile(input: ExtractionInputV1): ExtractionResultV1 {
  const { source, sourceReference, contents, now } = input;
  const { declaration, error } = parseDeclaration(contents);

  if (error !== null) {
    return {
      facts: [],
      skips: [{ sourceReference, reason: "MALFORMED_DECLARATION", detail: error }],
      recognized: true,
    };
  }
  if (declaration === null) {
    return {
      facts: [],
      skips: [
        {
          sourceReference,
          reason: "UNSUPPORTED_CONTENT",
          detail: "The file is not a personal-context declaration; no facts were inferred from it.",
        },
      ],
      recognized: false,
    };
  }

  const facts: PersonalContextFactV1[] = [];
  const skips: ExtractionSkipV1[] = [];

  declaration.facts.forEach((row, index) => {
    const where = `${sourceReference}#facts[${index}]`;
    const category = asString(row.category);
    const predicate = asString(row.predicate);
    const value = asString(row.value);
    if (category === null || predicate === null || value === null) {
      skips.push({ sourceReference: where, reason: "FACT_REJECTED", detail: "category, predicate or value is empty" });
      return;
    }
    if (!CONTEXT_CATEGORIES_V1.includes(category as ContextCategoryV1)) {
      skips.push({ sourceReference: where, reason: "CATEGORY_NOT_SUPPORTED", detail: `unsupported category: ${category}` });
      return;
    }

    // A source classified `INTERNAL` cannot mint a `CONFIDENTIAL` fact by asserting one. The source's
    // enrolled class is the ceiling the Owner approved; a document inside it does not get to raise it.
    const declaredSensitivity = asString(row.sensitivity) ?? source.sensitivityClass;
    if (sensitivityRank(declaredSensitivity as SensitivityClassV1) === Number.POSITIVE_INFINITY) {
      skips.push({ sourceReference: where, reason: "FACT_REJECTED", detail: `unsupported sensitivity: ${declaredSensitivity}` });
      return;
    }
    if (sensitivityRank(declaredSensitivity as SensitivityClassV1) > sensitivityRank(source.sensitivityClass)) {
      skips.push({
        sourceReference: where,
        reason: "SENSITIVITY_ABOVE_SOURCE",
        detail: `declared ${declaredSensitivity} exceeds the source class ${source.sensitivityClass}`,
      });
      return;
    }
    const sensitivity = declaredSensitivity as SensitivityClassV1;

    const temporalRaw = asString(row.temporalState) ?? "UNKNOWN";
    const temporalState: TemporalStateV1 = TEMPORAL_STATES_V1.includes(temporalRaw as TemporalStateV1)
      ? (temporalRaw as TemporalStateV1)
      : "UNKNOWN";
    const confidenceRaw = asString(row.confidence) ?? "MEDIUM";
    const confidence: ConfidenceLevelV1 = CONFIDENCE_LEVELS_V1.includes(confidenceRaw as ConfidenceLevelV1)
      ? (confidenceRaw as ConfidenceLevelV1)
      : "MEDIUM";

    const declaredUses = Array.isArray(row.eligibleUses) ? row.eligibleUses : [];
    const eligibleUses = declaredUses.filter((use): use is EligibleUseV1 =>
      typeof use === "string" && ELIGIBLE_USES_V1.includes(use as EligibleUseV1),
    );
    if (eligibleUses.length === 0) {
      skips.push({
        sourceReference: where,
        reason: "FACT_REJECTED",
        detail: "no supported eligibleUses were declared; a fact with no approved use is not stored",
      });
      return;
    }

    const observedAt = asNullableInstant(row.observedAt);
    const lastConfirmedAt = asNullableInstant(row.lastConfirmedAt);
    const validFrom = asNullableInstant(row.validFrom);
    const validTo = asNullableInstant(row.validTo);

    const freshness = assessFreshness({
      observedAt,
      lastConfirmedAt,
      sourceModifiedAt: input.sourceModifiedAt,
      temporalState,
      validTo,
      now,
    });

    const normalizedValue = asString(row.normalizedValue) ?? normalizeValue(value);
    const claimKey = claimKeyOf(declaration.subject, category as ContextCategoryV1, predicate);

    // Provider eligibility is the intersection of what the bridge allows for this class and what the
    // Owner allowed for this source. Neither side can widen the other.
    const eligibleProviders: readonly ProviderIdV1[] = providersEligibleForSensitivity(sensitivity).filter((id) =>
      source.eligibleProviders.includes(id),
    );

    const contentFingerprint = sha256Hex(
      JSON.stringify([claimKey, value, normalizedValue, observedAt, lastConfirmedAt, validFrom, validTo, temporalState, sensitivity]),
    );

    const fact: PersonalContextFactV1 = {
      schema: PERSONAL_CONTEXT_SCHEMA_V1,
      factId: digestOf([source.sourceId, sourceReference, claimKey, normalizedValue]),
      claimKey,
      subject: declaration.subject,
      category: category as ContextCategoryV1,
      predicate,
      value,
      normalizedValue,
      sourceId: source.sourceId,
      sourceReference,
      evidenceReference: asString(row.evidenceReference) ?? `${declaration.documentId}#facts[${index}]`,
      observedAt,
      sourceModifiedAt: input.sourceModifiedAt,
      extractedAt: now,
      confidence,
      sensitivity,
      freshnessState: freshness.state,
      freshnessEvidence: freshness.evidence,
      temporalState,
      validFrom,
      validTo,
      conflictState: "NONE",
      conflictsWith: [],
      supersedes: [],
      supersededBy: null,
      eligibleUses,
      eligibleProviders,
      contentFingerprint,
      version: 1,
      lastConfirmedAt,
    };

    const problem = validatePersonalContextFact(fact);
    if (problem !== null) {
      skips.push({
        sourceReference: where,
        reason: problem.includes("credential") ? "CREDENTIAL_MATERIAL" : "FACT_REJECTED",
        detail: problem,
      });
      return;
    }
    facts.push(fact);
  });

  return { facts, skips, recognized: true };
}
