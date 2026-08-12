/**
 * Owner-facing answers about a customer.
 *
 * These are the read models the conversation layer exists to serve: what someone wants, what changed,
 * which cars fit, who might want a car, what was promised, and what to know before picking up the
 * phone. Everything is composed from stored evidence — nothing here reaches a network or invents a
 * fact about a vehicle or a person.
 *
 * Answers are written as prose rather than record dumps. `MODEL=CAMRY CONFIDENCE=0.83` is the shape
 * of a diagnostic, not an answer, and a salesperson reading it before a call has to translate it
 * back into English themselves.
 */
import type { RelationshipV1 } from "./contracts.js";
import type { VehicleRecordV1 } from "./vehicle-inventory.js";
import type { CommitmentCandidateV1 } from "./conversation-event.js";
import type { CrmActionProposalV1 } from "./crm-action-proposal.js";
import type { CustomerNeedV1 } from "./customer-needs.js";
import { currentNeeds, describeNeedChange, formatNeedChanges, isCurrentNeed, needChanges } from "./customer-needs.js";
import { formatFitAnswer, formatReverseMatchAnswer, matchNeedsToInventory, matchVehicleToCustomers } from "./customer-inventory-match.js";

/** Sub-mode detection for the fit question — "why doesn't this fit?" wants the conflicts, not a list. */
const ASKS_WHY_NOT = /\b(?:why (?:doesn'?t|does not|isn'?t|is not|wouldn'?t))\b/i;

export interface CustomerAnswerV1 {
  reply: string;
  action: string;
  data: unknown;
  sources: Array<{ type: string; id: string; label: string }>;
}

function displayName(r: RelationshipV1): string {
  return String(r.displayName ?? "this customer");
}

/**
 * Describe one need the way a person would say it.
 *
 * The strength is carried in the sentence rather than as a label, because "AWD is a requirement" and
 * "dark blue is only a preference" is what the Owner needs to hear — the distinction matters at the
 * moment they decide which car to walk someone to.
 */
function phraseNeeds(needs: readonly CustomerNeedV1[]): {
  requirements: string[];
  exclusions: string[];
  preferences: string[];
} {
  const say = (n: CustomerNeedV1): string => {
    if (n.attribute === "max-price" && n.numericValue != null) {
      return `stay under $${n.numericValue.toLocaleString("en-US")}`;
    }
    if (n.attribute === "payment-target" && n.numericValue != null) {
      return `a payment around $${n.numericValue.toLocaleString("en-US")} a month`;
    }
    if (n.attribute === "model" || n.attribute === "make") return `a ${n.value}`;
    if (n.attribute === "trim") return `${n.value.toUpperCase()} trim`;
    if (n.attribute === "color") return `${n.value} paint`;
    if (n.attribute === "powertrain") return `${n.value}`;
    if (n.attribute === "condition") return `something ${n.value}`;
    // Equipment reads as a verb phrase in the requirements sentence ("needs to ... have AWD"), but
    // as a bare noun everywhere else, so "ruled out" does not become "ruled out have AWD".
    if (n.attribute === "must-have") {
      return n.strength === "HARD_REQUIREMENT" ? `have ${n.value.toUpperCase()}` : n.value.toUpperCase();
    }
    if (n.attribute === "nice-to-have" || n.attribute === "must-not-have") return n.value.toUpperCase();
    return n.value;
  };
  return {
    requirements: needs.filter((n) => n.strength === "HARD_REQUIREMENT").map(say),
    exclusions: needs.filter((n) => n.strength === "EXCLUSION").map(say),
    preferences: needs.filter((n) => n.strength === "PREFERENCE").map(say),
  };
}

/** "What does Sarah want?" */
export function answerCustomerNeeds(input: {
  customer: RelationshipV1;
  needs: readonly CustomerNeedV1[];
}): CustomerAnswerV1 {
  const name = displayName(input.customer);
  const current = currentNeeds(input.needs, input.customer.id);
  if (!current.length) {
    return {
      reply: `I don't have anything recorded about what ${name} is looking for. `
        + `If you've talked to them, send me the call or tell me what they said and I'll keep it.`,
      action: "customer.needs",
      data: { needs: [] },
      sources: [{ type: "relationship", id: input.customer.id, label: name }],
    };
  }

  const { requirements, exclusions, preferences } = phraseNeeds(current);
  const parts: string[] = [];
  if (requirements.length) parts.push(`${name} needs to ${requirements.join(", and ")}`);
  else if (preferences.length) parts.push(`${name} is looking at ${preferences.slice(0, 2).join(" and ")}`);
  if (exclusions.length) parts.push(`They've ruled out ${exclusions.join(" and ")}`);
  if (preferences.length && requirements.length) {
    parts.push(`${preferences.join(", ")} ${preferences.length === 1 ? "is" : "are"} a preference rather than a requirement`);
  }

  return {
    // Each clause becomes its own sentence, so the second one does not start mid-word in lower case.
    reply: parts.map(startSentence).join(". ") + ".",
    action: "customer.needs",
    data: { needs: current },
    sources: [{ type: "relationship", id: input.customer.id, label: name }],
  };
}

function startSentence(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** "What changed in Sarah's needs?" */
export function answerNeedsHistory(input: {
  customer: RelationshipV1;
  needs: readonly CustomerNeedV1[];
}): CustomerAnswerV1 {
  const name = displayName(input.customer);
  const changes = needChanges(input.needs, input.customer.id);
  return {
    reply: formatNeedChanges(changes, name),
    action: "customer.needs.history",
    data: { changes },
    sources: [{ type: "relationship", id: input.customer.id, label: name }],
  };
}

/** "Which vehicles fit Sarah?" / "Why doesn't this fit Sarah?" */
export function answerCustomerFit(input: {
  customer: RelationshipV1;
  needs: readonly CustomerNeedV1[];
  vehicles: readonly VehicleRecordV1[];
  question: string;
}): CustomerAnswerV1 {
  const name = displayName(input.customer);
  const current = currentNeeds(input.needs, input.customer.id);
  if (!current.length) {
    return {
      reply: `I can't match inventory for ${name} yet — I don't have anything recorded about what they want.`,
      action: "customer.fit",
      data: { fits: [] },
      sources: [{ type: "relationship", id: input.customer.id, label: name }],
    };
  }
  const fits = matchNeedsToInventory({ needs: current, vehicles: input.vehicles, limit: 5 });

  // "Why doesn't it fit?" is a different question from "what fits?" — it wants the conflicts.
  if (ASKS_WHY_NOT.test(input.question)) {
    const { requirements, exclusions } = phraseNeeds(current);
    const bars = [...requirements, ...exclusions.map((e) => `no ${e}`)];
    return {
      reply: bars.length
        ? `For it to work for ${name} it would have to ${bars.join(", and ")}. `
          + `Anything that misses one of those is out, not just ranked lower.`
        : `${name} hasn't given me a hard requirement yet, so nothing is strictly disqualified.`,
      action: "customer.fit.explain",
      data: { requirements, exclusions },
      sources: [{ type: "relationship", id: input.customer.id, label: name }],
    };
  }

  return {
    reply: formatFitAnswer(fits, name),
    action: "customer.fit",
    data: { fits },
    sources: [
      { type: "relationship", id: input.customer.id, label: name },
      ...fits.slice(0, 3).map((f) => ({ type: "vehicle", id: f.vehicleId, label: f.label })),
    ],
  };
}

/** "Who might want this vehicle?" */
export function answerVehicleCustomerMatch(input: {
  vehicle: VehicleRecordV1;
  needsByCustomer: ReadonlyMap<string, { name: string; needs: readonly CustomerNeedV1[] }>;
  now: string;
}): CustomerAnswerV1 {
  const label = [input.vehicle.year, input.vehicle.make, input.vehicle.model, input.vehicle.trim]
    .filter(Boolean).join(" ") || input.vehicle.vin || "this vehicle";
  const matches = matchVehicleToCustomers({
    vehicle: input.vehicle, needsByCustomer: input.needsByCustomer, now: input.now, limit: 5,
  });
  return {
    reply: formatReverseMatchAnswer(matches, label),
    action: "vehicle.customer.match",
    data: { matches },
    sources: matches.map((m) => ({ type: "relationship", id: m.relationshipRef, label: m.customerName })),
  };
}

/** "What did I promise Sarah?" / "What did Sarah promise me?" */
export function answerCommitments(input: {
  customer: RelationshipV1;
  candidates: readonly CommitmentCandidateV1[];
  question: string;
}): CustomerAnswerV1 {
  const name = displayName(input.customer);
  const wantsTheirs = /\b(?:promise(?:d)? me|they promise|owe me)\b/i.test(input.question);
  const party = wantsTheirs ? "CUSTOMER_PROMISED" : "OWNER_PROMISED";
  const mine = input.candidates.filter((c) => c.party === party);
  const unattributed = input.candidates.filter((c) => c.party === "UNCERTAIN");

  const lines: string[] = [];
  if (mine.length) {
    lines.push(wantsTheirs ? `${name} said they would:` : `You told ${name} you would:`);
    for (const c of mine) lines.push(`· ${c.statement}${c.timeHint ? ` — ${c.timeHint}` : ""}`);
  } else {
    lines.push(wantsTheirs
      ? `I don't have anything recorded that ${name} promised you.`
      : `I don't have anything recorded that you promised ${name}.`);
  }
  if (unattributed.length) {
    lines.push("");
    lines.push(`There ${unattributed.length === 1 ? "is" : "are"} ${unattributed.length} promise${unattributed.length === 1 ? "" : "s"} `
      + `in the call I couldn't attribute, because I couldn't tell who was speaking.`);
  }
  return {
    reply: lines.join("\n"),
    action: "customer.commitments",
    data: { commitments: mine, unattributed },
    sources: [{ type: "relationship", id: input.customer.id, label: name }],
  };
}

/**
 * "What should I know before I call Sarah?"
 *
 * The unknowns are as important as the knowns — they are what the Owner should ask about on the
 * call, which makes them the most actionable part of the brief.
 */
export function answerPrecallBrief(input: {
  customer: RelationshipV1;
  needs: readonly CustomerNeedV1[];
  candidates: readonly CommitmentCandidateV1[];
  vehicles: readonly VehicleRecordV1[];
}): CustomerAnswerV1 {
  const name = displayName(input.customer);
  const current = currentNeeds(input.needs, input.customer.id);
  const changes = needChanges(input.needs, input.customer.id);
  const owed = input.candidates.filter((c) => c.party === "OWNER_PROMISED");
  const theirs = input.candidates.filter((c) => c.party === "CUSTOMER_PROMISED");
  const fits = current.length ? matchNeedsToInventory({ needs: current, vehicles: input.vehicles, limit: 3 }) : [];

  const lines: string[] = [];
  if (!current.length) {
    lines.push(`I don't have anything recorded about what ${name} wants yet.`);
  } else {
    const { requirements, exclusions, preferences } = phraseNeeds(current);
    const bits: string[] = [];
    if (requirements.length) bits.push(`needs to ${requirements.join(", and ")}`);
    if (exclusions.length) bits.push(`has ruled out ${exclusions.join(" and ")}`);
    if (preferences.length) bits.push(`would prefer ${preferences.join(", ")}`);
    lines.push(`${name} ${bits.join("; ")}.`);
    if (preferences.length && requirements.length) {
      lines.push(`Treat the preferences as flexible — only the requirements rule a car out.`);
    }
  }

  if (changes.length) {
    lines.push("");
    lines.push(`Worth knowing: ${changes.slice(0, 2).map(describeNeedChange).join("; ")}.`);
  }
  if (owed.length) {
    lines.push("");
    lines.push(`You owe them: ${owed.map((c) => c.statement).join("; ")}.`);
  }
  if (theirs.length) {
    lines.push(`They said they would: ${theirs.map((c) => c.statement).join("; ")}.`);
  }
  if (fits.length) {
    lines.push("");
    lines.push(`${fits.length} current ${fits.length === 1 ? "vehicle fits" : "vehicles fit"} what they've told you: `
      + fits.map((f) => f.label).join(", ") + ".");
    const unknowns = [...new Set(fits.flatMap((f) => f.unknowns.map((u) => u.attribute)))];
    if (unknowns.length) {
      lines.push(`The listings don't state ${unknowns.join(" or ")} — worth confirming before you promise anything.`);
    }
  } else if (current.length) {
    lines.push("");
    lines.push(`Nothing in current inventory matches all of that.`);
  }

  return {
    reply: lines.join("\n"),
    action: "customer.precall",
    data: { needs: current, changes, owed, theirs, fits },
    sources: [{ type: "relationship", id: input.customer.id, label: name }],
  };
}

/**
 * "What follow-up should I prepare?"
 *
 * Reports what AION has already drafted from processed calls and is holding for approval. The
 * closing sentence is not decoration: a list of actions that reads like a list of completed actions
 * is how an Owner comes to believe a note was filed that never was.
 */
export function answerPreparedActions(input: {
  proposals: readonly CrmActionProposalV1[];
  customer?: RelationshipV1 | null;
  nameFor?: (customerRef: string) => string;
}): CustomerAnswerV1 {
  const who = input.customer ? ` for ${displayName(input.customer)}` : "";
  if (!input.proposals.length) {
    return {
      reply: `I haven't prepared anything${who} yet. Send me a call recording and I'll draft the note and the follow-up from it.`,
      action: "customer.prepared",
      data: { proposals: [] },
      sources: input.customer ? [{ type: "relationship", id: input.customer.id, label: displayName(input.customer) }] : [],
    };
  }

  const label = (action: string): string =>
    action === "PREPARE_CALL_NOTE" ? "a call note"
    : action === "PREPARE_FOLLOWUP" ? "a follow-up"
    : action === "PREPARE_PREFERENCE_UPDATE" ? "an update to their recorded preferences"
    : action.replace(/_/g, " ").toLowerCase();

  const lines: string[] = [`I've got ${input.proposals.length} thing${input.proposals.length === 1 ? "" : "s"} ready${who}:`];
  for (const p of input.proposals) {
    const name = input.nameFor ? input.nameFor(p.customerRef) : null;
    lines.push(`· ${label(p.action)}${name && !input.customer ? ` for ${name}` : ""} — ${p.note}`);
  }
  lines.push("");
  lines.push("None of it has been written anywhere. Tell me which ones you want and I'll take them further.");

  return {
    reply: lines.join("\n"),
    action: "customer.prepared",
    data: { proposals: input.proposals },
    sources: input.proposals.slice(0, 5).map((p) => ({
      type: "relationship",
      id: p.customerRef,
      label: input.nameFor ? input.nameFor(p.customerRef) : p.customerRef,
    })),
  };
}

/** Needs grouped by customer, for reverse matching. Superseded observations never participate. */
export function needsByCustomer(
  needs: readonly CustomerNeedV1[],
  relationships: readonly RelationshipV1[],
  workspace: string,
): Map<string, { name: string; needs: CustomerNeedV1[] }> {
  const out = new Map<string, { name: string; needs: CustomerNeedV1[] }>();
  for (const r of relationships) {
    // Workspace is checked here as well as upstream: reverse matching produces a prompt to phone
    // someone, and a care-business contact must never surface as a dealership prospect.
    if (r.archived || r.workspace !== workspace) continue;
    const mine = needs.filter((n) => n.relationshipRef === r.id && isCurrentNeed(n));
    if (mine.length) out.set(r.id, { name: displayName(r), needs: mine });
  }
  return out;
}
