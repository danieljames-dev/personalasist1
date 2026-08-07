import type {
  ContactChannelV1, ContactMethodV1, CustomerAppointmentV1, CustomerFollowUpV1, CustomerInterestV1,
  CustomerInteractionV1, CustomerLifecycleV1, CustomerQueryV1, CustomerV1, DataOriginV1, IsoTimestamp,
} from "./contracts.js";
import { CONTACT_CHANNELS, CUSTOMER_LIFECYCLES, DATA_ORIGINS } from "./contracts.js";

/**
 * Work-scoped relationship records.
 *
 * Nothing here is automotive-specific. A vehicle is one kind of interest and a dealership is a
 * label the owner types; no state, rule, or query depends on a manufacturer, an employer, or a
 * particular CRM. The shape is meant to survive being promoted into a broader relationship system.
 */

function fail(message: string): never { throw new Error(message); }

/**
 * Structured fields AION refuses to accept at all.
 *
 * These are not merely unused: a customer record belongs to the owner's employer and their
 * customer, and AION is not the right place for identity or financing material. Refusing the field
 * by name makes the boundary visible rather than leaving it to habit.
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
      fail(`${where} must not carry "${key}". AION does not store identity, credit, banking, or financing material about a customer.`);
    }
  }
}

/** Free text is accepted, but not text that looks like identity or payment material. */
export function assertNoSensitiveValue(value: string, where: string): string {
  for (const { pattern, label } of SENSITIVE_VALUE_PATTERNS) {
    if (pattern.test(value)) fail(`${where} looks like it contains ${label}. AION does not store identity, credit, banking, or financing material about a customer.`);
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

export function interests(value: unknown, now: IsoTimestamp): CustomerInterestV1[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 40) fail("Interests are invalid.");
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail("An interest is invalid.");
    const record = entry as Record<string, unknown>;
    assertNoProhibitedField(record, "An interest");
    return {
      kind: oneOf(record.kind, ["vehicle", "trade", "other"] as const, "Interest kind", "vehicle"),
      description: text(record.description, "Interest description", 2000),
      notedAt: isoOrNull(record.notedAt, "Interest timestamp") ?? now,
    };
  });
}

/** Builds a new durable relationship record. Refuses anything the boundary does not allow. */
export function buildCustomer(input: Record<string, unknown>, context: { id: string; reference: string; now: IsoTimestamp; workspace: CustomerV1["workspace"] }): CustomerV1 {
  assertNoProhibitedField(input, "A customer record");
  const now = context.now;
  const lifecycle = oneOf(input.lifecycle, CUSTOMER_LIFECYCLES, "Lifecycle state", "prospect");
  return {
    id: context.id,
    reference: context.reference,
    workspace: context.workspace,
    displayName: text(input.displayName, "Customer display name or alias", 200),
    lifecycle,
    origin: oneOf(input.origin, DATA_ORIGINS, "Data origin", "employer-work"),
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
    taskIds: [], routineIds: [], planIds: [],
    outcome: { state: "open", at: null, detail: "" },
    archived: false,
    provenance: { sourceType: "owner", sourceRef: "owner-entry", recordedAt: now },
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Applies an owner edit. Editable fields are enumerated, so an unexpected field is refused rather
 * than quietly written, and the timeline, identifiers and provenance can never be edited away.
 */
export function applyCustomerEdit(customer: CustomerV1, change: Record<string, unknown>, now: IsoTimestamp): CustomerV1 {
  assertNoProhibitedField(change, "A customer edit");
  const editable = ["displayName", "origin", "contactMethods", "communicationPreference", "source", "notes", "interests", "objections", "preferences", "nextAction", "nextActionAt"];
  const unexpected = Object.keys(change).filter((key) => !editable.includes(key));
  if (unexpected.length) fail(`A customer edit accepts only ${editable.join(", ")}; unexpected field(s): ${unexpected.join(", ")}.`);
  const next: CustomerV1 = structuredClone(customer);
  if ("displayName" in change) next.displayName = text(change.displayName, "Customer display name or alias", 200);
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

export function buildInteraction(input: Record<string, unknown>, context: { id: string; now: IsoTimestamp }): CustomerInteractionV1 {
  assertNoProhibitedField(input, "An interaction");
  return {
    id: context.id,
    at: isoOrNull(input.at, "Interaction time") ?? context.now,
    kind: oneOf(input.kind, ["note", "call", "text", "email", "visit", "appointment", "follow-up", "lifecycle", "outcome"] as const, "Interaction kind", "note"),
    summary: text(input.summary, "Interaction summary", 500),
    detail: text(input.detail, "Interaction detail", 20_000, false),
    lifecycleAfter: input.lifecycleAfter === undefined || input.lifecycleAfter === null ? null : oneOf(input.lifecycleAfter, CUSTOMER_LIFECYCLES, "Lifecycle state"),
    actor: oneOf(input.actor, ["owner", "aion"] as const, "Interaction actor", "owner"),
  };
}

export function buildAppointment(input: Record<string, unknown>, context: { id: string; now: IsoTimestamp }): CustomerAppointmentV1 {
  assertNoProhibitedField(input, "An appointment");
  const at = isoOrNull(input.at, "Appointment time");
  if (!at) fail("An appointment needs an explicit time.");
  return {
    id: context.id, at,
    kind: oneOf(input.kind, ["appointment", "callback", "delivery"] as const, "Appointment kind", "appointment"),
    location: text(input.location, "Appointment location", 300, false),
    status: oneOf(input.status, ["scheduled", "confirmed", "shown", "no-show", "rescheduled", "cancelled"] as const, "Appointment status", "scheduled"),
    notes: text(input.notes, "Appointment notes", 5000, false),
    createdAt: context.now,
  };
}

export function buildFollowUp(input: Record<string, unknown>, context: { id: string; now: IsoTimestamp }): CustomerFollowUpV1 {
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
 */
export function queryCustomers(customers: readonly CustomerV1[], query: CustomerQueryV1, now: IsoTimestamp): CustomerV1[] {
  const pool = customers.filter((customer) => query.includeArchived === true || !customer.archived);
  const onDate = query.onDate ?? now.slice(0, 10);
  const matched = (() => {
    switch (query.kind) {
      case "all": return pool;
      case "follow-up-due":
        return pool.filter((customer) => customer.followUps.some((entry) => entry.status === "open" && entry.dueAt.slice(0, 10) <= onDate));
      case "not-contacted-since": {
        // Whole days, not instants: "not contacted in 0 days" means "not contacted today", which
        // is what the question actually means. Comparing instants would make anyone contacted
        // earlier this morning look stale.
        const days = Number.isSafeInteger(query.days) && (query.days as number) >= 0 ? (query.days as number) : 7;
        const horizonDate = new Date(Date.parse(`${onDate}T00:00:00.000Z`) - days * DAY_MS).toISOString().slice(0, 10);
        return pool.filter((customer) => customer.lastContactAt === null || customer.lastContactAt.slice(0, 10) < horizonDate);
      }
      case "appointments-on":
        return pool.filter((customer) => customer.appointments.some((entry) => sameDay(entry.at, onDate) && !["cancelled", "no-show"].includes(entry.status)));
      case "interested-in": {
        const needle = (query.text ?? "").trim().toLocaleLowerCase();
        if (!needle) return [];
        return pool.filter((customer) => customer.interests.some((entry) => entry.description.toLocaleLowerCase().includes(needle)));
      }
      case "awaiting-callback":
        return pool.filter((customer) => customer.appointments.some((entry) => entry.kind === "callback" && ["scheduled", "confirmed"].includes(entry.status))
          || customer.followUps.some((entry) => entry.status === "open" && entry.channel === "phone"));
      case "in-stage": {
        const stage = query.stage;
        if (!stage || !CUSTOMER_LIFECYCLES.includes(stage)) fail("Lifecycle stage is not recognised.");
        return pool.filter((customer) => customer.lifecycle === stage);
      }
      default: fail("Customer query kind is not recognised.");
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
export function lastInteraction(customer: CustomerV1): CustomerInteractionV1 | null {
  return customer.interactions.length ? [...customer.interactions].sort((a, b) => a.at.localeCompare(b.at)).at(-1)! : null;
}

export type { ContactChannelV1, CustomerLifecycleV1, DataOriginV1 };
