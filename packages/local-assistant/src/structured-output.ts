/**
 * Canonical structured-output / control-protocol parser.
 *
 * Production Chat and the evaluation harness must agree on what is accepted. A form that only
 * one of them understands is how a model can "pass" structured-output while Chat would refuse
 * the same bytes, or worse, how control payload can leak into visible text after a partial parse.
 *
 * Accepted action/memory proposal form (production and evaluation):
 *
 *   - Exactly one proposal per line.
 *   - Line starts with the protocol prefix (AION-PROPOSE-ACTION or AION-PROPOSE-MEMORY).
 *   - After the prefix: a single-line compact JSON object (no markdown fences, no pretty-print
 *     multiline objects on following lines).
 *   - Action objects require string capabilityId; input must be a plain object when present.
 *   - Memory objects require string content; category is optional string.
 *
 * Rejected (no authority, no partial leak into the visible body as control text):
 *
 *   - Fenced blocks (``` ... ```) containing the prefix or control JSON.
 *   - Multiline/pretty-printed JSON after the prefix.
 *   - Prefix appearing inside reasoning/thinking channels (handled by the caller: never pass
 *     reasoning text to this parser).
 *   - Malformed JSON or wrong root type.
 *
 * Rejected control syntax never creates an action. The prefix line is stripped from the visible
 * body either way so a half-parsed payload cannot sit in conversation history as authority.
 */

import { PROPOSE_ACTION_PREFIX, PROPOSE_MEMORY_PREFIX } from "./contracts.js";

export interface StructuredActionProposalV1 {
  capabilityId: unknown;
  input: unknown;
}

export interface StructuredMemoryProposalV1 {
  content: unknown;
  category: unknown;
}

export interface StructuredSplitV1 {
  /** Visible answer channel only. Control lines are removed; malformed control does not leak payload. */
  body: string;
  actions: StructuredActionProposalV1[];
  memories: StructuredMemoryProposalV1[];
  malformed: number;
  /** Human-readable notes for activity / evaluation detail. */
  rejections: string[];
}

const FENCE_RE = /```[\s\S]*?```/gu;

/**
 * True when the text is a single compact JSON object production would accept as a control payload.
 * Used by the evaluator so structured-output credit is not granted to forms Chat rejects.
 */
export function isAcceptedControlJson(payload: string): boolean {
  const trimmed = payload.trim();
  if (!trimmed || trimmed.includes("\n") || trimmed.includes("\r")) return false;
  if (trimmed.startsWith("```") || trimmed.includes("```")) return false;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return Boolean(parsed) && typeof parsed === "object" && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

/**
 * True when the full response is accepted as structured JSON *for evaluation of structured-output
 * cases* — bare object only, no fence, no prose wrapper. Matches production Chat expectations for
 * parseable JSON replies (isJsonObject / jsonHasKeys fixtures).
 */
export function isAcceptedStructuredJsonAnswer(response: string): boolean {
  const text = response.replace(/\r\n/gu, "\n").trim();
  if (!text || text.includes("```")) return false;
  try {
    const parsed: unknown = JSON.parse(text);
    return Boolean(parsed) && typeof parsed === "object" && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

/**
 * Splits visible answer text into the message body and revalidated proposals.
 *
 * Reasoning/thinking text must never be passed here — the caller isolates channels first.
 * Fenced regions are stripped from the body without granting control authority, so a model that
 * wraps AION-PROPOSE-ACTION in a fence cannot create an approval and cannot leave the control
 * payload visible as ordinary prose.
 */
export function splitStructuredProposals(response: string): StructuredSplitV1 {
  const rejections: string[] = [];
  let working = response.replace(/\r\n/gu, "\n");

  // Fenced regions never carry control authority. Remove them from the body without parsing.
  working = working.replace(FENCE_RE, (block) => {
    if (block.includes(PROPOSE_ACTION_PREFIX) || block.includes(PROPOSE_MEMORY_PREFIX)) {
      rejections.push("fenced control payload rejected");
    }
    return "";
  });

  const kept: string[] = [];
  const actions: StructuredActionProposalV1[] = [];
  const memories: StructuredMemoryProposalV1[] = [];
  let malformed = 0;

  for (const line of working.split("\n")) {
    const isAction = line.startsWith(PROPOSE_ACTION_PREFIX);
    const isMemory = line.startsWith(PROPOSE_MEMORY_PREFIX);
    if (!isAction && !isMemory) {
      kept.push(line);
      continue;
    }
    const payload = line.slice((isAction ? PROPOSE_ACTION_PREFIX : PROPOSE_MEMORY_PREFIX).length).trim();
    if (!isAcceptedControlJson(payload)) {
      malformed += 1;
      rejections.push(isAction ? "malformed or non-compact action proposal" : "malformed or non-compact memory proposal");
      // Do not push the raw line into the body: partial control payload must not leak as visible text.
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      malformed += 1;
      rejections.push("control JSON parse failure");
      continue;
    }
    const record = parsed as Record<string, unknown>;
    if (isAction) {
      if (typeof record.capabilityId !== "string" || !record.capabilityId.trim()) {
        malformed += 1;
        rejections.push("action proposal missing capabilityId");
        continue;
      }
      if (record.input !== undefined && (record.input === null || typeof record.input !== "object" || Array.isArray(record.input))) {
        malformed += 1;
        rejections.push("action proposal input must be a plain object");
        continue;
      }
      actions.push({ capabilityId: record.capabilityId, input: record.input ?? {} });
    } else {
      if (typeof record.content !== "string" || !record.content.trim()) {
        malformed += 1;
        rejections.push("memory proposal missing content");
        continue;
      }
      memories.push({ content: record.content, category: record.category });
    }
  }

  return {
    body: kept.join("\n").trim(),
    actions,
    memories,
    malformed,
    rejections,
  };
}
