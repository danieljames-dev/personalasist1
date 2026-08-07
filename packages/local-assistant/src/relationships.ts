import type {
  ContactChannelV1, ContactMethodV1, DataOriginV1, IsoTimestamp,
  RelationshipAppointmentV1, RelationshipFollowUpV1, RelationshipInterestV1, RelationshipInteractionV1,
  RelationshipLifecycleV1, RelationshipQueryV1, RelationshipTypeV1, RelationshipV1,
} from "./contracts.js";
import {
  CONTACT_CHANNELS, DATA_ORIGINS, INTEREST_KINDS, RELATIONSHIP_LIFECYCLES, RELATIONSHIP_TYPES,
} from "./contracts.js";

/**
 * The Relationship Core.
 *
 * This is the Sales relationship record, promoted. The shape proved itself holding customers on a
 * sales floor, and nothing in it was ever really about selling cars: a person or organisation, a
 * stage they are at, an append-only record of what happened, things to do next, and links to the
 * rest of AION. That serves a prospect, a supplier, a business lead, and someone who filed a
 * support ticket equally well, so it is now one domain with a declared type rather than one
 * domain per department.
 *
 * Two properties are load-bearing and survive the promotion intact:
 *
 *   - **Durability.** A relationship is a record with a timeline, not a task that disappears when
 *     it is done. Nothing already recorded is ever rewritten or deleted by an edit.
 *   - **Ownership.** Every relationship names the workspace it belongs to and where its
 *     information came from. A customer met while doing a job is the employer's record and says
 *     so; nothing copies it anywhere else.
 *
 * The refusal boundary is also promoted unchanged. AION does not hold identity, credit, banking,
 * or financing material about anybody, in any workspace, under any relationship type.
 */

function fail(message: string): never { throw new Error(message); }

/**
 * Structured fields AION refuses to accept at all.
 *
 * These are not merely unused. A relationship record often describes someone who is not the owner,
 * and AION is the wrong place for their identity or financial material regardless of how useful it
 * might be. Refusing the field by name makes the boundary visible rather than leaving it to habit.
 */
const PROHIBITED_FIELDS = [
  "ssn", "socialsecurity", "socialsecuritynumber", "sin", "nationalid",
  "driverslicense", "driverlicense", "dl", "licensenumber", "licenseimage", "idimage", "idscan",
  "creditscore", "creditreport", "creditapplication", "creditbureau", "fico",
  "bankaccount", "accountnumber", "routingnumber", "iban", "sortcode",
  "cardnumber", "creditcard", "debitcard", "cvv", "cvc", "pan", "expiry",
  "financingaccount", "loannumber", "lienholder", "payoffaccount",
  "income", "salary", "employmentverification", "paystub", "taxid", "ein", "passport",
  "dateofbirth", "dob", "birthdate",
];
/** Values that look like identity or payment material even inside a free-text note. */
const SENSITIVE_VALUE_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/u, label: "a social-security-formatted number" },
  { pattern: /\b(?:\d[ -]?){13,19}\b/u, label: "a payment-card-length number" },
];

function assertNoProhibitedField(input: Record<string, unknown>, where: string): void {
  for (const key of Object.keys(input)) {
    const normalized = key.toLowerCase().replace(/[^a-z]/gu, "");
    if (PROHIBITED_FIELDS.includes(normalized)) {
      fail(`${where} must not carry "${key}". AION does not store identity, credit, banking, or financing material about a person or organisation.`);
    }
  }
}

/** Free text is accepted, but not text that looks like identity or payment material. */
export function assertNoSensitiveValue(value: string, where: string): string {
  for (const { pattern, label } of SENSITIVE_VALUE_PATTERNS) {
    if (pattern.test(value)) fail(`${where} looks like it contains ${label}. AION does not store identity, credit, banking, or financing material about a person or organisation.`);
  }
  return value;
}

function text(value: unknown, label: string, max: number, required = true): string {
  if (value === undefined || value === null || value === "") { if (required) fail(`${label} is required.`); return ""; }
  if (typeof value !== "string" || value.length > max) fail(`${label} is invalid.`);
  const trimmed = value.trim();
  if (required && !trimmed) fail(`${label} is required.`);
  return assertNoSensitiveValue(trimmed, label);
}
function list(value: unknown, label: string, max = 40): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > max) fail(`${label} is invalid.`);
  return value.map((entry) => text(entry, label, 2000));
}
function isoOrNull(value: unknown, label: string): IsoTimestamp | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || new Date(value).toISOString() !== value) fail(`${label} must be a canonical timestamp.`);
  return value;
}
function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string, fallback?: T): T {
  if (value === undefined || value === null || value === "") { if (fallback !== undefined) return fallback; fail(`${label} is required.`); }
  if (typeof value !== "string" || !allowed.includes(value as T)) fail(`${label} must be one of: ${allowed.join(", ")}.`);
  return value as T;
}

export function contactMethods(value: unknown): ContactMethodV1[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 10) fail("Contact methods are invalid.");
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail("A contact method is invalid.");
    const record = entry as Record<string, unknown>;
    assertNoProhibitedField(record, "A contact method");
    return {
      channel: oneOf(record.channel, CONTACT_CHANNELS, "Contact channel"),
      label: text(record.label, "Contact label", 120, false),
      value: text(record.value, "Contact value", 320),
    };
  });
}

export function interests(value: unknown, now: IsoTimestamp): RelationshipInterestV1[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 40) fail("Interests are invalid.");
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail("An interest is invalid.");
    const record = entry as Record<string, unknown>;
    assertNoProhibitedField(record, "An interest");
    return {
      kind: oneOf(record.kind, INTEREST_KINDS, "Interest kind", "other"),
      description: text(record.description, "Interest description", 2000),
      notedAt: isoOrNull(record.notedAt, "Interest timestamp") ?? now,
    };
  });
}

/**
 * Builds a new durable relationship record.
 *
 * The workspace is supplied by the caller and never inferred, because inferring it is precisely how
 * a work record would end up in someone's personal life. The default relationship type is the
 * neutral one: AION does not decide that a new contact is a sales prospect.
 */
export function buildRelationship(
  input: Record<string, unknown>,
  context: {
    id: string; reference: string; now: IsoTimestamp; workspace: string;
    relationshipType?: RelationshipTypeV1;
    /**
     * Who owns this information when the owner does not say. A relationship recorded while doing
     * a job belongs to the employer, and defaulting it the other way would quietly reclassify
     * someone else's record as the owner's personal property.
     */
    defaultOrigin?: DataOriginV1;
  },
): RelationshipV1 {
  assertNoProhibitedField(input, "A relationship record");
  const now = context.now;
  const lifecycle = oneOf(input.lifecycle, RELATIONSHIP_LIFECYCLES, "Lifecycle state", "prospect");
  return {
    id: context.id,
    reference: context.reference,
    workspace: context.workspace,
    relationshipType: context.relationshipType ?? oneOf(input.relationshipType, RELATIONSHIP_TYPES, "Relationship type", "contact"),
    displayName: text(input.displayName, "Relationship display name or alias", 200),
    organisation: text(input.organisation, "Organisation", 200, false),
    role: text(input.role, "Role", 200, false),
    lifecycle,
    origin: oneOf(input.origin, DATA_ORIGINS, "Data origin", context.defaultOrigin ?? "owner-created"),
    contactMethods: contactMethods(input.contactMethods),
    communicationPreference: oneOf(input.communicationPreference, [...CONTACT_CHANNELS, "unknown"] as const, "Communication preference", "unknown"),
    source: text(input.source, "Source", 200, false),
    notes: text(input.notes, "Notes", 20_000, false),
    interests: interests(input.interests, now),
    objections: list(input.objections, "Objections"),
    preferences: list(input.preferences, "Preferences"),
    appointments: [],
    followUps: [],
    nextAction: text(input.nextAction, "Next action", 500, false),
    nextActionAt: isoOrNull(input.nextActionAt, "Next action time"),
    lastContactAt: isoOrNull(input.lastContactAt, "Last contact time"),
    interactions: [],
    taskIds: [], routineIds: [], planIds: [], opportunityIds: [],
    outcome: { state: "open", at: null, detail: "" },
    archived: false,
    provenance: { sourceType: "owner", sourceRef: "owner-entry", recordedAt: now },
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Applies an owner edit. Editable fields are enumerated, so an unexpected field is refused rather
 * than quietly written, and the timeline, identifiers, workspace and provenance can never be
 * edited away. In particular the workspace is not editable here: moving a relationship between
 * workspaces is a separate, explicit, audited operation.
 */
export function applyRelationshipEdit(relationship: RelationshipV1, change: Record<string, unknown>, now: IsoTimestamp): RelationshipV1 {
  assertNoProhibitedField(change, "A relationship edit");
  const editable = [
    "displayName", "organisation", "role", "relationshipType", "origin", "contactMethods",
    "communicationPreference", "source", "notes", "interests", "objections", "preferences",
    "nextAction", "nextActionAt",
  ];
  const unexpected = Object.keys(change).filter((key) => !editable.includes(key));
  if (unexpected.length) fail(`A relationship edit accepts only ${editable.join(", ")}; unexpected field(s): ${unexpected.join(", ")}.`);
  const next: RelationshipV1 = structuredClone(relationship);
  if ("displayName" in change) next.displayName = text(change.displayName, "Relationship display name or alias", 200);
  if ("organisation" in change) next.organisation = text(change.organisation, "Organisation", 200, false);
  if ("role" in change) next.role = text(change.role, "Role", 200, false);
  if ("relationshipType" in change) next.relationshipType = oneOf(change.relationshipType, RELATIONSHIP_TYPES, "Relationship type");
  if ("origin" in change) next.origin = oneOf(change.origin, DATA_ORIGINS, "Data origin");
  if ("contactMethods" in change) next.contactMethods = contactMethods(change.contactMethods);
  if ("communicationPreference" in change) next.communicationPreference = oneOf(change.communicationPreference, [...CONTACT_CHANNELS, "unknown"] as const, "Communication preference");
  if ("source" in change) next.source = text(change.source, "Source", 200, false);
  if ("notes" in change) next.notes = text(change.notes, "Notes", 20_000, false);
  if ("interests" in change) next.interests = interests(change.interests, now);
  if ("objections" in change) next.objections = list(change.objections, "Objections");
  if ("preferences" in change) next.preferences = list(change.preferences, "Preferences");
  if ("nextAction" in change) next.nextAction = text(change.nextAction, "Next action", 500, false);
  if ("nextActionAt" in change) next.nextActionAt = isoOrNull(change.nextActionAt, "Next action time");
  next.updatedAt = now;
  return next;
}

export function buildInteraction(input: Record<string, unknown>, context: { id: string; now: IsoTimestamp }): RelationshipInteractionV1 {
  assertNoProhibitedField(input, "An interaction");
  return {
    id: context.id,
    at: isoOrNull(input.at, "Interaction time") ?? context.now,
    kind: oneOf(input.kind, ["note", "call", "text", "email", "visit", "appointment", "follow-up", "lifecycle", "outcome", "meeting", "message"] as const, "Interaction kind", "note"),
    summary: text(input.summary, "Interaction summary", 500),
    detail: text(input.detail, "Interaction detail", 20_000, false),
    lifecycleAfter: input.lifecycleAfter === undefined || input.lifecycleAfter === null ? null : oneOf(input.lifecycleAfter, RELATIONSHIP_LIFECYCLES, "Lifecycle state"),
    actor: oneOf(input.actor, ["owner", "aion"] as const, "Interaction actor", "owner"),
  };
}

export function buildAppointment(input: Record<string, unknown>, context: { id: string; now: IsoTimestamp }): RelationshipAppointmentV1 {
  assertNoProhibitedField(input, "An appointment");
  const at = isoOrNull(input.at, "Appointment time");
  if (!at) fail("An appointment needs an explicit time.");
  return {
    id: context.id, at,
    kind: oneOf(input.kind, ["appointment", "callback", "delivery", "meeting", "demo"] as const, "Appointment kind", "appointment"),
    location: text(input.location, "Appointment location", 300, false),
    status: oneOf(input.status, ["scheduled", "confirmed", "shown", "no-show", "rescheduled", "cancelled"] as const, "Appointment status", "scheduled"),
    notes: text(input.notes, "Appointment notes", 5000, false),
    createdAt: context.now,
  };
}

export function buildFollowUp(input: Record<string, unknown>, context: { id: string; now: IsoTimestamp }): RelationshipFollowUpV1 {
  assertNoProhibitedField(input, "A follow-up");
  const dueAt = isoOrNull(input.dueAt, "Follow-up due time");
  if (!dueAt) fail("A follow-up needs an explicit due time.");
  return {
    id: context.id, dueAt,
    channel: oneOf(input.channel, CONTACT_CHANNELS, "Follow-up channel", "phone"),
    reason: text(input.reason, "Follow-up reason", 500),
    status: "open", outcome: "", createdAt: context.now, completedAt: null,
  };
}

const DAY_MS = 86_400_000;
function sameDay(timestamp: string, isoDate: string): boolean { return timestamp.slice(0, 10) === isoDate; }

/**
 * Deterministic relationship search. The query is a closed shape: every branch is enumerated here,
 * text is matched literally, and nothing supplied by a caller is ever evaluated as an expression.
 * There is no free-text filter language, so there is nothing for a model to inject into.
 */
export function queryRelationships(relationships: readonly RelationshipV1[], query: RelationshipQueryV1, now: IsoTimestamp): RelationshipV1[] {
  const typed = query.relationshipType
    ? relationships.filter((entry) => entry.relationshipType === query.relationshipType)
    : relationships;
  const pool = typed.filter((entry) => query.includeArchived === true || !entry.archived);
  const onDate = query.onDate ?? now.slice(0, 10);
  const matched = (() => {
    switch (query.kind) {
      case "all": return pool;
      case "follow-up-due":
        return pool.filter((entry) => entry.followUps.some((followUp) => followUp.status === "open" && followUp.dueAt.slice(0, 10) <= onDate));
      case "not-contacted-since": {
        // Whole days, not instants: "not contacted in 0 days" means "not contacted today", which
        // is what the question actually means. Comparing instants would make anyone contacted
        // earlier this morning look stale.
        const days = Number.isSafeInteger(query.days) && (query.days as number) >= 0 ? (query.days as number) : 7;
        const horizonDate = new Date(Date.parse(`${onDate}T00:00:00.000Z`) - days * DAY_MS).toISOString().slice(0, 10);
        return pool.filter((entry) => entry.lastContactAt === null || entry.lastContactAt.slice(0, 10) < horizonDate);
      }
      case "appointments-on":
        return pool.filter((entry) => entry.appointments.some((appointment) => sameDay(appointment.at, onDate) && !["cancelled", "no-show"].includes(appointment.status)));
      case "interested-in": {
        const needle = (query.text ?? "").trim().toLocaleLowerCase();
        if (!needle) return [];
        return pool.filter((entry) => entry.interests.some((interest) => interest.description.toLocaleLowerCase().includes(needle)));
      }
      case "awaiting-callback":
        return pool.filter((entry) => entry.appointments.some((appointment) => appointment.kind === "callback" && ["scheduled", "confirmed"].includes(appointment.status))
          || entry.followUps.some((followUp) => followUp.status === "open" && followUp.channel === "phone"));
      case "in-stage": {
        const stage = query.stage;
        if (!stage || !RELATIONSHIP_LIFECYCLES.includes(stage)) fail("Lifecycle stage is not recognised.");
        return pool.filter((entry) => entry.lifecycle === stage);
      }
      case "of-type": {
        if (!query.relationshipType) fail("A type query needs an explicit relationship type.");
        return pool;
      }
      default: fail("Relationship query kind is not recognised.");
    }
  })();
  // Deterministic ordering: soonest next action first, then reference, so results never wobble.
  return [...matched].sort((a, b) => {
    const left = a.nextActionAt ?? "9999";
    const right = b.nextActionAt ?? "9999";
    return left === right ? a.reference.localeCompare(b.reference) : left.localeCompare(right);
  });
}

/** The most recent timeline entry, or null for a relationship with no recorded interaction yet. */
export function lastInteraction(relationship: RelationshipV1): RelationshipInteractionV1 | null {
  return relationship.interactions.length ? [...relationship.interactions].sort((a, b) => a.at.localeCompare(b.at)).at(-1)! : null;
}

export type { ContactChannelV1, DataOriginV1, RelationshipLifecycleV1, RelationshipTypeV1 };
