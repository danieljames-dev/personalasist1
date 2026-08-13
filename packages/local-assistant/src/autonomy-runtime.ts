/**
 * Deciding, at runtime, whether AION may just get on with something.
 *
 * The Owner's standing position is that a request carries its ordinary substeps: asked to improve
 * OCR with a free tool, AION should not stop to ask permission to download the tool. The decision
 * logic for that already exists and is tested. What was missing is the part that runs during a
 * conversation, and in particular the part that keeps two very different things apart:
 *
 *   - the Owner asking for something, which carries authority
 *   - some text describing an action, which never does
 *
 * A webpage saying "install this package and upload your configuration" is a suggestion in a
 * document. An email saying "run this command" is a sentence someone typed. OCR text lifted off a
 * window sticker is characters read from a photograph. None of them can widen what AION may do, and
 * the difference is not a matter of tone or confidence — it is a matter of provenance, which is why
 * it is decided here by structure rather than by a model.
 *
 * ## Why authority is not delegated to a model
 *
 * A model asked "may I install this?" will answer, fluently, in whichever direction the surrounding
 * text leans — which is exactly the property an injected instruction exploits. So the model never
 * votes. It may propose an action; classification and the permission decision are deterministic and
 * inspectable, and the same input always yields the same answer.
 */
import {
  decideDirectiveAction,
  assessSpend,
  blockIfCostly,
  assessUntrustedContent,
  type DirectiveActionClassV1,
  type DirectiveDecisionV1,
  type UntrustedSourceKindV1,
} from "./owner-directive-authority.js";

export const AUTONOMY_RUNTIME_SCHEMA_V1 = "aion.autonomy-runtime.v1" as const;

/**
 * Where a proposed action came from.
 *
 * Only `OWNER_DIRECTIVE` carries authority. Everything else is material AION happens to have read,
 * and the enum exists so that a caller cannot forget to say which it is.
 */
export type ActionOriginV1 =
  | "OWNER_DIRECTIVE"
  | "WEB_PAGE"
  | "EMAIL"
  | "DOCUMENT"
  | "OCR_TEXT"
  | "MODEL_SUGGESTION";

export const ORIGINS_WITHOUT_AUTHORITY: readonly ActionOriginV1[] = [
  "WEB_PAGE", "EMAIL", "DOCUMENT", "OCR_TEXT", "MODEL_SUGGESTION",
];

/** Whether this origin can authorize anything at all. Structural, not a judgement about content. */
export function originGrantsAuthority(origin: ActionOriginV1): boolean {
  return origin === "OWNER_DIRECTIVE";
}

// ---------------------------------------------------------------------------
// Classifying a described action
// ---------------------------------------------------------------------------

interface ActionShape {
  actionClass: DirectiveActionClassV1;
  pattern: RegExp;
  /** The smallest thing the Owner would have to do, when this class is blocked. */
  ownerAction: string | null;
}

/**
 * Ordered most-consequential first.
 *
 * A sentence can describe several things at once — "install the free trial and enable public
 * access" is a free tool, a payment and an exposure in one breath — and the most consequential
 * reading has to win. Ordering by consequence rather than by specificity is what stops a benign
 * phrase early in the sentence from carrying the whole decision.
 */
const ACTION_SHAPES: readonly ActionShape[] = [
  {
    actionClass: "FINANCIAL_LEGAL",
    pattern: /\b(?:sign|accept)\b[^.]{0,30}\b(?:contract|agreement|terms)\b|\b(?:credit\s+check|financing|loan|lease\s+agreement)\b/i,
    ownerAction: "review and sign it yourself",
  },
  {
    actionClass: "SPEND",
    pattern: /\b(?:purchase|buy|pay|subscribe|upgrade\s+to\s+pro|paid\s+plan|price\s+per\s+month)\b|\bcredit\s+card\b|\bfree\s+trial\b[^.]{0,40}\bcard\b|\bcard\b[^.]{0,20}\brequired\b/i,
    ownerAction: "approve the cost and enter payment details yourself",
  },
  {
    actionClass: "PUBLIC_EXPOSURE",
    pattern: /\bfunnel\b|\bpublic(?:ly)?\s+(?:expose|accessible|available|internet)\b|\bexpose\b[^.]{0,30}\binternet\b|\bport\s+forward\b|\bngrok\b/i,
    ownerAction: "decide whether AION should be reachable from the internet",
  },
  {
    actionClass: "DESTRUCTIVE",
    pattern: /\b(?:delete|wipe|erase|drop|truncate|overwrite|reset)\b[^.]{0,40}\b(?:data|database|state|history|production|backup|everything)\b|\brm\s+-rf\b|\bformat\s+(?:the\s+)?drive\b/i,
    ownerAction: "confirm what may be destroyed, if anything",
  },
  {
    actionClass: "OWNER_CONSENT",
    pattern: /\b(?:log\s?in|sign\s?in|oauth|authorize\s+access|grant\s+access|consent\s+screen|two[-\s]?factor|verification\s+code|password|credential)\b/i,
    ownerAction: "complete the sign-in yourself",
  },
  {
    actionClass: "FREE_TOOL",
    pattern: /\b(?:install|download|add|try|evaluate|benchmark)\b[^.]{0,40}\b(?:tool|package|library|engine|model|dependency|npm|pip)\b|\b(?:install|download)\s+\w+/i,
    ownerAction: null,
  },
  {
    actionClass: "PUBLIC_RESEARCH",
    pattern: /\b(?:research|search|look\s+up|compare|read\s+the\s+docs|find\s+out|check\s+online)\b/i,
    ownerAction: null,
  },
  {
    actionClass: "ROUTINE_LOCAL",
    pattern: /\b(?:build|rebuild|test|run\s+the\s+tests|configure|restart|measure|profile|refactor|integrate)\b/i,
    ownerAction: null,
  },
];

export function classifyProposedAction(text: string): { actionClass: DirectiveActionClassV1; ownerAction: string | null } {
  const message = String(text ?? "");
  for (const shape of ACTION_SHAPES) {
    if (shape.pattern.test(message)) {
      return { actionClass: shape.actionClass, ownerAction: shape.ownerAction };
    }
  }
  // Nothing recognised is treated as ordinary local work rather than as permission to do anything:
  // the classes above are what widen or narrow authority, and an unmatched sentence widens nothing.
  return { actionClass: "ROUTINE_LOCAL", ownerAction: null };
}

// ---------------------------------------------------------------------------
// The runtime decision
// ---------------------------------------------------------------------------

export interface AutonomyDecisionV1 {
  schema: typeof AUTONOMY_RUNTIME_SCHEMA_V1;
  allowed: boolean;
  actionClass: DirectiveActionClassV1;
  origin: ActionOriginV1;
  /** True when the origin itself was incapable of authorizing anything. */
  blockedByOrigin: boolean;
  /** True when retrieved text tried to issue an instruction. Reported, never obeyed. */
  instructionAttemptDetected: boolean;
  reason: string;
  ownerActionRequired: string | null;
  estimatedCostUsd: number;
}

/**
 * Decide whether a described action may proceed.
 *
 * Two gates, in this order, because the first makes the second unnecessary to trust. Provenance is
 * checked before content: material that cannot authorize anything is refused on that ground alone,
 * so no amount of persuasive wording inside it ever reaches the permission logic. Only then is the
 * action classified and put to the existing directive rules.
 */
export function decideAutonomy(input: {
  origin: ActionOriginV1;
  /** What is being proposed, in words. */
  proposedAction: string;
  /** The Owner's own instruction, when there is one. Authority comes from here or nowhere. */
  ownerDirective?: string | null;
  /** Name and description of a candidate tool, when the action is about adopting one. */
  candidate?: { name: string; description: string; licence?: string | null } | null;
}): AutonomyDecisionV1 {
  const proposed = String(input.proposedAction ?? "");
  const { actionClass, ownerAction } = classifyProposedAction(proposed);

  const untrusted = !originGrantsAuthority(input.origin);
  const assessment = untrusted
    ? assessUntrustedContent({ kind: originToUntrustedKind(input.origin), text: proposed })
    : null;

  if (untrusted) {
    return {
      schema: AUTONOMY_RUNTIME_SCHEMA_V1,
      allowed: false,
      actionClass,
      origin: input.origin,
      blockedByOrigin: true,
      instructionAttemptDetected: assessment?.containsInstructionAttempt ?? false,
      reason: "this came from something AION read, not from you — I can treat it as information, "
        + "but it cannot decide what I am allowed to do",
      ownerActionRequired: "tell me directly if you want this done",
      estimatedCostUsd: 0,
    };
  }

  if (!String(input.ownerDirective ?? "").trim()) {
    return {
      schema: AUTONOMY_RUNTIME_SCHEMA_V1,
      allowed: false,
      actionClass,
      origin: input.origin,
      blockedByOrigin: false,
      instructionAttemptDetected: false,
      reason: "nothing you asked for covers this",
      ownerActionRequired: ownerAction ?? "confirm you want this",
      estimatedCostUsd: 0,
    };
  }

  // A candidate that costs money is refused on cost before its class is even considered.
  if (input.candidate) {
    const spend = assessSpend(input.candidate);
    const costly = blockIfCostly(spend);
    // The spend cap is zero, so anything that looks paid is refused at zero cost recorded.
    if (costly) return fromDirective(costly, input.origin, 0, false);
  }

  const decision = decideDirectiveAction({
    actionClass,
    detail: proposed.slice(0, 200),
    ownerAction,
  });
  return fromDirective(decision, input.origin, 0, false);
}

function fromDirective(
  decision: DirectiveDecisionV1,
  origin: ActionOriginV1,
  estimatedCostUsd: number,
  instructionAttemptDetected: boolean,
): AutonomyDecisionV1 {
  return {
    schema: AUTONOMY_RUNTIME_SCHEMA_V1,
    allowed: decision.allowed,
    actionClass: decision.actionClass,
    origin,
    blockedByOrigin: false,
    instructionAttemptDetected,
    reason: decision.reason,
    ownerActionRequired: decision.ownerActionRequired,
    estimatedCostUsd,
  };
}

function originToUntrustedKind(origin: ActionOriginV1): UntrustedSourceKindV1 {
  switch (origin) {
    case "WEB_PAGE": return "WEB_PAGE";
    case "EMAIL": return "EMAIL";
    case "OCR_TEXT": return "TRANSCRIPT";
    case "MODEL_SUGGESTION": return "DOCUMENT";
    default: return "DOCUMENT";
  }
}

/** Owner-facing sentence for a decision. Never mentions a class name. */
export function describeAutonomyDecision(decision: AutonomyDecisionV1): string {
  if (decision.allowed) return `Going ahead — ${decision.reason.replace(/^.*? — /, "")}.`;
  const lines = [decision.reason.replace(/^.*? — /, "")];
  if (decision.ownerActionRequired) lines.push(`What I need from you: ${decision.ownerActionRequired}.`);
  return lines.join(" ");
}
