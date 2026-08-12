/**
 * Who a conversation was with.
 *
 * This is the most consequential decision in the conversation layer, and the failure is asymmetric.
 * An unattached conversation costs the Owner one question; a wrongly attached one silently writes a
 * stranger's budget, objections and promises into a real customer's record — and the Owner may then
 * act on it out loud, in front of that customer.
 *
 * So resolution is conservative by construction: only evidence that identifies exactly one person
 * links anything. First names do not, shared vehicle interest does not, and the same city certainly
 * does not. Two Sarahs is not a hypothetical in a dealership.
 *
 * The shape deliberately mirrors `photo-vehicle-match.ts`, which solved the same problem for
 * vehicles: explicit states, auto-link only on unique strong evidence, candidates offered rather
 * than chosen, and Owner correction that preserves what was originally decided.
 */
import type { IsoTimestamp, OpaqueId, RelationshipV1 } from "./contracts.js";

export type IdentityStateV1 =
  | "RESOLVED"
  | "AMBIGUOUS"
  | "UNRESOLVED"
  | "CONFLICTING_SIGNALS";

export type IdentityMethodV1 =
  | "EXTERNAL_ID"
  | "EXACT_PHONE"
  | "EXACT_EMAIL"
  | "OWNER_ASSERTION"
  | "BOUND_CONVERSATION"
  | "NONE";

export interface IdentityCandidateV1 {
  relationshipRef: OpaqueId;
  label: string;
  /** Why this record is a candidate, in Owner-readable terms. */
  why: string;
}

export interface CustomerIdentityResolutionV1 {
  state: IdentityStateV1;
  /** Set only when linking is safe. Never set for AMBIGUOUS, UNRESOLVED or CONFLICTING_SIGNALS. */
  relationshipRef: OpaqueId | null;
  method: IdentityMethodV1;
  confidence: number;
  workspace: string | null;
  candidates: IdentityCandidateV1[];
  evidence: string[];
  /** Owner-facing sentence. Always inside what the evidence supports. */
  message: string;
}

export interface IdentitySignalsV1 {
  workspace: string;
  phone?: string | null;
  email?: string | null;
  externalId?: { system: string; id: string } | null;
  /** A name heard in conversation. A weak signal — never sufficient on its own. */
  spokenName?: string | null;
  /** A relationship the Owner already bound this conversation to. */
  boundRelationshipRef?: OpaqueId | null;
  /** Explicit Owner assertion, e.g. "this is Sarah Whitmore". */
  ownerAssertedRef?: OpaqueId | null;
}

/** Digits only, last 10 — enough to compare US numbers written any number of ways. */
export function normalizePhone(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/\D+/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  const value = String(raw ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}

function label(r: RelationshipV1): string {
  const org = String(r.organisation ?? "").trim();
  return org ? `${r.displayName} (${org})` : r.displayName;
}

function channelValues(r: RelationshipV1, channel: "phone" | "email"): string[] {
  return (r.contactMethods ?? [])
    .filter((m) => (channel === "phone" ? m.channel === "phone" || m.channel === "text" : m.channel === "email"))
    .map((m) => String(m.value ?? ""));
}

/**
 * Resolve a conversation to a customer.
 *
 * Pure: no state access, no clock, no network. The decision rules are the thing worth testing, and
 * they should be testable without constructing a world.
 */
export function resolveCustomerIdentity(input: {
  signals: IdentitySignalsV1;
  relationships: readonly RelationshipV1[];
}): CustomerIdentityResolutionV1 {
  const { signals } = input;
  // Workspace is a boundary, not a filter applied afterwards: a dealership call must never resolve
  // to a Compassionate Choice contact, however well the phone number matches.
  const pool = input.relationships.filter((r) => !r.archived && r.workspace === signals.workspace);

  const unresolved = (message: string, evidence: string[], candidates: IdentityCandidateV1[] = []): CustomerIdentityResolutionV1 => ({
    state: candidates.length > 1 ? "AMBIGUOUS" : "UNRESOLVED",
    relationshipRef: null,
    method: "NONE",
    confidence: 0,
    workspace: signals.workspace,
    candidates,
    evidence,
    message,
  });

  // 1. Owner assertion outranks everything. The Owner knows who they spoke to.
  if (signals.ownerAssertedRef) {
    const match = pool.find((r) => r.id === signals.ownerAssertedRef);
    if (match) {
      return {
        state: "RESOLVED",
        relationshipRef: match.id,
        method: "OWNER_ASSERTION",
        confidence: 100,
        workspace: signals.workspace,
        candidates: [],
        evidence: [`Owner identified this conversation as ${label(match)}`],
        message: `${label(match)} — you told me who this was.`,
      };
    }
  }

  // 2. A conversation the Owner already bound stays bound.
  if (signals.boundRelationshipRef) {
    const match = pool.find((r) => r.id === signals.boundRelationshipRef);
    if (match) {
      return {
        state: "RESOLVED",
        relationshipRef: match.id,
        method: "BOUND_CONVERSATION",
        confidence: 95,
        workspace: signals.workspace,
        candidates: [],
        evidence: [`Continuing an existing conversation with ${label(match)}`],
        message: `${label(match)} — continuing the same conversation.`,
      };
    }
  }

  // 3. Strong unique signals. Each must identify exactly one record.
  const strong: Array<{ method: IdentityMethodV1; matches: RelationshipV1[]; evidence: string }> = [];

  if (signals.externalId?.id) {
    const wanted = `${signals.externalId.system}:${signals.externalId.id}`.toLowerCase();
    const matches = pool.filter((r) =>
      ((r as { externalRefs?: Array<{ system: string; id: string }> }).externalRefs ?? [])
        .some((x) => `${x.system}:${x.id}`.toLowerCase() === wanted),
    );
    if (matches.length) strong.push({ method: "EXTERNAL_ID", matches, evidence: `External ID ${wanted}` });
  }

  const phone = normalizePhone(signals.phone);
  if (phone) {
    const matches = pool.filter((r) => channelValues(r, "phone").some((v) => normalizePhone(v) === phone));
    if (matches.length) strong.push({ method: "EXACT_PHONE", matches, evidence: `Exact phone match` });
  }

  const email = normalizeEmail(signals.email);
  if (email) {
    const matches = pool.filter((r) => channelValues(r, "email").some((v) => normalizeEmail(v) === email));
    if (matches.length) strong.push({ method: "EXACT_EMAIL", matches, evidence: `Exact email match ${email}` });
  }

  if (strong.length) {
    const distinct = new Set(strong.flatMap((s) => s.matches.map((m) => m.id)));

    // Different strong signals pointing at different people is the one case that must never be
    // resolved by precedence. Preferring phone over email here would be inventing a rule that the
    // evidence does not support, and the Owner is the only one who can settle it.
    if (distinct.size > 1) {
      const candidates = [...distinct].map((id) => {
        const r = pool.find((x) => x.id === id)!;
        const via = strong.filter((s) => s.matches.some((m) => m.id === id)).map((s) => s.method).join(", ");
        return { relationshipRef: id, label: label(r), why: `matched by ${via}` };
      });
      return {
        state: "CONFLICTING_SIGNALS",
        relationshipRef: null,
        method: "NONE",
        confidence: 0,
        workspace: signals.workspace,
        candidates,
        evidence: strong.map((s) => s.evidence),
        message: `Different details point at different people (${candidates.map((c) => c.label).join(" / ")}). Which one is this?`,
      };
    }

    // One strong signal matching several records is still not an identification.
    const best = strong[0]!;
    if (best.matches.length > 1) {
      return {
        state: "AMBIGUOUS",
        relationshipRef: null,
        method: "NONE",
        confidence: 0,
        workspace: signals.workspace,
        candidates: best.matches.map((m) => ({ relationshipRef: m.id, label: label(m), why: best.evidence })),
        evidence: [best.evidence],
        message: `More than one record shares that detail. Which one is this?`,
      };
    }

    const match = best.matches[0]!;
    return {
      state: "RESOLVED",
      relationshipRef: match.id,
      method: best.method,
      confidence: best.method === "EXTERNAL_ID" ? 99 : 95,
      workspace: signals.workspace,
      candidates: [],
      evidence: strong.map((s) => s.evidence),
      message: `${label(match)} — matched on ${best.method === "EXACT_PHONE" ? "phone number" : best.method === "EXACT_EMAIL" ? "email address" : "customer ID"}.`,
    };
  }

  // 4. Weak signals may rank candidates. They never link.
  const spoken = String(signals.spokenName ?? "").trim().toLowerCase();
  if (spoken.length >= 2) {
    const nameMatches = pool.filter((r) => {
      const name = String(r.displayName ?? "").toLowerCase();
      return name === spoken || name.split(/\s+/).some((part) => part === spoken);
    });
    if (nameMatches.length) {
      return unresolved(
        nameMatches.length > 1
          ? `${nameMatches.length} people are called "${signals.spokenName}". Which one is this?`
          : `This might be ${label(nameMatches[0]!)}, but a first name alone isn't enough for me to attach a conversation. Confirm and I'll link it.`,
        [`Weak signal: spoken name "${signals.spokenName}"`],
        nameMatches.map((m) => ({ relationshipRef: m.id, label: label(m), why: "name mentioned in conversation" })),
      );
    }
  }

  return unresolved(
    "I couldn't tell who this conversation was with. It's saved — tell me who it was and I'll attach it.",
    signals.spokenName ? [`Weak signal: spoken name "${signals.spokenName}"`] : ["No identifying details"],
  );
}

/** True when this resolution is strong enough to derive durable facts or propose an external write. */
export function isSafeToAttribute(resolution: CustomerIdentityResolutionV1): boolean {
  return resolution.state === "RESOLVED" && resolution.relationshipRef !== null;
}

/**
 * Re-point an identity after the Owner corrects it.
 *
 * The previous resolution is retained rather than replaced. A recurring mis-identification is
 * something the Owner should be able to see, and it disappears if each correction quietly overwrites
 * the last one.
 */
export interface IdentityCorrectionV1 {
  resolution: CustomerIdentityResolutionV1;
  previous: CustomerIdentityResolutionV1;
  correctedAt: IsoTimestamp;
  note: string;
  /** Facts and commitments created under the old link that must be revisited. */
  requiresReattribution: boolean;
}

export function applyOwnerIdentityCorrection(input: {
  previous: CustomerIdentityResolutionV1;
  relationshipRef: OpaqueId | null;
  relationships: readonly RelationshipV1[];
  at: IsoTimestamp;
  note: string;
}): IdentityCorrectionV1 {
  const match = input.relationshipRef
    ? input.relationships.find((r) => r.id === input.relationshipRef) ?? null
    : null;
  const resolution: CustomerIdentityResolutionV1 = match
    ? {
        state: "RESOLVED",
        relationshipRef: match.id,
        method: "OWNER_ASSERTION",
        confidence: 100,
        workspace: match.workspace,
        candidates: [],
        evidence: [`Owner correction: ${input.note}`.slice(0, 300)],
        message: `${label(match)} — corrected by you.`,
      }
    : {
        state: "UNRESOLVED",
        relationshipRef: null,
        method: "NONE",
        confidence: 0,
        workspace: input.previous.workspace,
        candidates: [],
        evidence: [`Owner correction: ${input.note}`.slice(0, 300)],
        message: "Unlinked from that customer. Tell me who it was and I'll attach it.",
      };
  return {
    resolution,
    previous: input.previous,
    correctedAt: input.at,
    note: input.note.slice(0, 500),
    // Anything derived under the previous link is now suspect. Treating identity correction as a
    // single-field edit is how one customer's needs end up living in another customer's record.
    requiresReattribution: input.previous.relationshipRef !== null
      && input.previous.relationshipRef !== resolution.relationshipRef,
  };
}
