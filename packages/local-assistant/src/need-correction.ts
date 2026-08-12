/**
 * The Owner correcting what AION heard — at the level of a single want.
 *
 * Identity correction already existed: "that wasn't Sarah, that was Sarah Whitmore". This is the
 * narrower and more common case, where the customer is right but the meaning is wrong. AION heard
 * "I don't want a hybrid" and recorded an exclusion; the Owner, who was on the call, says she was
 * asking *about* hybrids, not refusing them.
 *
 * The correction is not an edit. Overwriting the original observation would destroy the only record
 * of why AION believed the wrong thing, and a mis-hearing that keeps recurring is exactly the thing
 * an Owner should be able to notice. So the original stays, marked superseded, and the corrected
 * value is written as a new need carrying stronger authority and a link back to what it replaced.
 *
 * Two things this deliberately does not do. It does not touch the transcript — the recording said
 * what it said, and rewriting evidence to match a conclusion is how a system stops being auditable.
 * And it does not infer anything beyond the correction: told that Sarah prefers a hybrid, it records
 * that she prefers a hybrid, and nothing about her budget, her timing, or what else she might like.
 */
import type { CustomerNeedV1, NeedAttributeV1, NeedStrengthV1 } from "./customer-needs.js";
import { isCurrentNeed, recordNeed } from "./customer-needs.js";
import type { ExtractedNeedV1 } from "./need-extraction.js";
import { extractNeedsFromSentence } from "./need-extraction.js";

export interface NeedCorrectionRequestV1 {
  /** All stored needs. Only this customer's are considered. */
  needs: readonly CustomerNeedV1[];
  relationshipRef: string;
  workspace: string;
  attribute: NeedAttributeV1;
  value: string;
  strength: NeedStrengthV1;
  numericValue?: number | null;
  /** The specific observation being corrected. When absent, the current one for this attribute. */
  targetNeedId?: string | null;
  correctionId: string;
  at: string;
  /** The Owner's own words, kept as the evidence for the correction. */
  note: string;
}

export interface NeedCorrectionResultV1 {
  needs: CustomerNeedV1[];
  /** The original observation, now superseded. Null when there was nothing on file to correct. */
  corrected: CustomerNeedV1 | null;
  created: CustomerNeedV1;
  message: string;
}

export interface NeedCorrectionRefusalV1 {
  refused: true;
  reason: string;
}

/**
 * Apply one correction.
 *
 * The corrected need cites `owner-correction:<id>` rather than the transcript segment, because the
 * segment does not say what the corrected need says — the Owner does. The original evidence stays
 * reachable through `correctsNeedId`, so the chain from the new value back to the words that caused
 * the mistake is intact without pretending the recording supports the new reading.
 */
export function applyOwnerNeedCorrection(
  input: NeedCorrectionRequestV1,
): NeedCorrectionResultV1 | NeedCorrectionRefusalV1 {
  const value = String(input.value ?? "").trim();
  if (!value) {
    return { refused: true, reason: "a correction has to say what the customer actually wants" };
  }
  if (input.strength === "UNKNOWN") {
    return {
      refused: true,
      reason: "a correction has to be definite — an uncertain correction leaves the wrong value current",
    };
  }

  const mine = input.needs.filter((n) => n.relationshipRef === input.relationshipRef);

  // Prefer the exact observation named, then the same attribute *and* value (which is what a
  // strength correction like "she didn't rule hybrids out" is about), then the attribute alone.
  const target =
    (input.targetNeedId ? mine.find((n) => n.id === input.targetNeedId) : null)
    ?? mine.find((n) => isCurrentNeed(n) && n.attribute === input.attribute && n.value === value)
    ?? mine.find((n) => isCurrentNeed(n) && n.attribute === input.attribute)
    ?? null;

  const created: CustomerNeedV1 = {
    id: input.correctionId,
    workspace: input.workspace,
    relationshipRef: input.relationshipRef,
    attribute: input.attribute,
    value,
    numericValue: input.numericValue ?? null,
    strength: input.strength,
    // The Owner was in the room. This outranks anything the microphone produced.
    confidence: 100,
    sourceRef: `owner-correction:${input.correctionId}`,
    observedAt: input.at,
    supersededAt: null,
    supersededBy: null,
    invalidatedAt: null,
    invalidationReason: null,
    authority: "OWNER_CORRECTION",
    correctsNeedId: target ? target.id : null,
  };

  // recordNeed handles ordinary same-attribute supersession; the explicit pass afterwards covers
  // list-like attributes, where a differing value would otherwise leave the wrong need current.
  let needs = recordNeed(mine, created);
  if (target) {
    needs = needs.map((n) =>
      n.id === target.id && !n.supersededAt && !n.invalidatedAt
        ? { ...n, supersededAt: input.at, supersededBy: created.id }
        : n,
    );
  }

  const message = target
    ? `Corrected: I had ${target.attribute} "${target.value}" as ${readableStrength(target.strength)}. `
      + `It is now "${value}" as ${readableStrength(input.strength)}. `
      + `I've kept the original and what it came from, so you can see why I got it wrong.`
    : `Recorded: ${input.attribute} "${value}" as ${readableStrength(input.strength)}. `
      + `I had nothing on file for that, so there was nothing to supersede.`;

  return { needs, corrected: target, created, message };
}

function readableStrength(strength: NeedStrengthV1): string {
  return strength === "HARD_REQUIREMENT" ? "a requirement"
    : strength === "EXCLUSION" ? "ruled out"
    : strength === "PREFERENCE" ? "a preference"
    : "unclear";
}

// ---------------------------------------------------------------------------
// Recognising a correction in what the Owner typed
// ---------------------------------------------------------------------------

/**
 * Phrases that mean "you got that wrong", as opposed to new information.
 *
 * The distinction matters: "Sarah wants a hybrid" is a fresh observation and should be recorded as
 * one, while "that's not what Sarah meant, she prefers a hybrid" is a statement about an existing
 * record and must supersede it with Owner authority. Treating the first as a correction would give
 * ordinary notes the power to overrule the recording.
 */
const CORRECTION_CUE =
  /\b(?:that(?:'|)s not what|that(?:'|)s wrong|i misheard|you misheard|you got that wrong|didn(?:'|)t rule|did not rule|never (?:said|ruled)|to be clear|actually,? (?:she|he|they))\b/i;

export interface ParsedNeedCorrectionV1 {
  /** The corrective values, read with the same extractor used on transcripts. */
  corrections: ExtractedNeedV1[];
  /** The Owner's words, kept verbatim as the reason. */
  note: string;
}

/**
 * Read a typed correction.
 *
 * Deliberately reuses `extractNeedsFromSentence` rather than adding a second way of understanding
 * vehicle language. A separate parser here would drift from the transcript one, and the two would
 * eventually disagree about what "hybrid" means in a sentence containing a negation.
 *
 * Clauses that only *deny* an exclusion ("she didn't rule hybrids out") contribute no value on their
 * own; the affirmative clause beside them is what carries the corrected want.
 */
export function parseNeedCorrection(text: string): ParsedNeedCorrectionV1 | null {
  const raw = String(text ?? "").trim();
  if (!raw || !CORRECTION_CUE.test(raw)) return null;

  const clauses = raw.split(/(?<=[.!?;])\s+/).map((s) => s.trim()).filter(Boolean);
  const corrections: ExtractedNeedV1[] = [];
  for (const clause of clauses) {
    // A clause whose only content is the denial of a past exclusion states no new want.
    if (/\b(?:didn(?:'|)t rule|did not rule|never ruled|never said)\b/i.test(clause)) continue;
    for (const found of extractNeedsFromSentence({ text: clause, sourceRef: "owner-correction" })) {
      if (found.strength === "UNKNOWN") continue;
      corrections.push(found);
    }
  }
  if (!corrections.length) return null;
  return { corrections, note: raw.slice(0, 500) };
}
