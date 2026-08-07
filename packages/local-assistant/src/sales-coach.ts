import type { ContactChannelV1, CustomerV1, IsoTimestamp } from "./contracts.js";
import { lastInteraction, queryCustomers } from "./sales.js";

/**
 * Deterministic sales assistance.
 *
 * Every function here is a pure template over what the owner already recorded. Nothing calls a
 * model, so the whole surface is testable offline and identical inputs always produce identical
 * output. A conversational provider may later improve the wording, but it stays advisory.
 *
 * The hard rule is that AION never invents a fact it was not told. It knows nothing about
 * vehicles, inventory, pricing, incentives, financing, or any dealership's policies, so wherever a
 * current fact would be needed the template emits an explicit CONFIRM marker instead of a number.
 */

/** Emitted wherever the answer depends on information AION does not and should not hold. */
export const CONFIRM = (what: string) => `[confirm ${what} from your current authorised source — AION does not know this]`;

export interface CoachOutputV1 {
  kind: string;
  title: string;
  /** Ordered, owner-readable lines. Never a message that has been or will be sent. */
  lines: string[];
  /** True when the output is a draft for the owner to review, copy, and send themselves. */
  draft: boolean;
}

function describe(customer: CustomerV1): string[] {
  const lines: string[] = [`Relationship: ${customer.displayName} (${customer.reference})`, `State: ${customer.lifecycle}${customer.archived ? " · archived" : ""}`];
  if (customer.source) lines.push(`Source: ${customer.source}`);
  if (customer.communicationPreference !== "unknown") lines.push(`Prefers: ${customer.communicationPreference}`);
  if (customer.interests.length) lines.push(`Interests: ${customer.interests.map((entry) => `${entry.kind} — ${entry.description}`).join("; ")}`);
  if (customer.objections.length) lines.push(`Open objections: ${customer.objections.join("; ")}`);
  if (customer.preferences.length) lines.push(`Preferences: ${customer.preferences.join("; ")}`);
  lines.push(customer.lastContactAt ? `Last contact: ${customer.lastContactAt}` : "Last contact: none recorded");
  const last = lastInteraction(customer);
  if (last) lines.push(`Last interaction: ${last.kind} — ${last.summary}`);
  if (customer.nextAction) lines.push(`Next action: ${customer.nextAction}${customer.nextActionAt ? ` (due ${customer.nextActionAt})` : ""}`);
  return lines;
}

export function callPreparation(customer: CustomerV1): CoachOutputV1 {
  const lines = ["Before you dial:", ...describe(customer), "", "Suggested opening: reference the last thing they told you, not a pitch.",
    ...(customer.objections.length ? [`Be ready for: ${customer.objections[0]}`] : ["No objection has been recorded yet — ask what would stop them going ahead."]),
    `Availability, pricing, or incentives: ${CONFIRM("current figures")}`,
    "Close the call by agreeing one specific next step and a time."];
  return { kind: "call-preparation", title: `Call prep — ${customer.displayName}`, lines, draft: false };
}

export function appointmentPreparation(customer: CustomerV1, at?: IsoTimestamp): CoachOutputV1 {
  const appointment = customer.appointments.find((entry) => (at ? entry.at === at : ["scheduled", "confirmed"].includes(entry.status)));
  const lines = ["Before they arrive:", ...describe(customer),
    appointment ? `Appointment: ${appointment.kind} at ${appointment.at}${appointment.location ? ` · ${appointment.location}` : ""} (${appointment.status})` : "No scheduled appointment is recorded.",
    appointment?.notes ? `Appointment notes: ${appointment.notes}` : "",
    "", `Have ready: ${CONFIRM("what is actually available today")}.`,
    "Confirm who is coming with them and how much time they have.",
    "Agree the next step before they leave, and record the outcome afterwards."].filter(Boolean);
  return { kind: "appointment-preparation", title: `Appointment prep — ${customer.displayName}`, lines, draft: false };
}

/**
 * A draft the owner reads, edits, and sends themselves. AION does not send anything, and the
 * output says so, so a draft can never be mistaken for a delivered message.
 */
export function followUpDraft(customer: CustomerV1, channel: ContactChannelV1 = "text"): CoachOutputV1 {
  const name = customer.displayName.split("(")[0]!.trim();
  const interest = customer.interests[0]?.description;
  const body = channel === "email"
    ? [`Subject: Following up`, "", `Hello ${name},`, "",
       interest ? `Thanks for your time talking about the ${interest}.` : "Thanks for your time the other day.",
       `I wanted to check where you had got to, and answer anything still open${customer.objections.length ? ` — particularly ${customer.objections[0]}` : ""}.`,
       `If it helps, I can put current details in writing: ${CONFIRM("availability and figures")}.`, "",
       "When would suit you for a short call?", "", "[your name]"]
    : [`Hello ${name} — following up on ${interest ?? "our conversation"}.`,
       customer.objections.length ? `I have not forgotten ${customer.objections[0]}.` : "Is there anything still open for you?",
       `Happy to confirm current details: ${CONFIRM("availability and figures")}.`,
       "Would a short call today or tomorrow suit?"];
  return {
    kind: "follow-up-draft", title: `Draft ${channel} — ${customer.displayName}`, draft: true,
    lines: ["DRAFT ONLY — AION does not send messages. Review, edit, and send it yourself.", "", ...body],
  };
}

export function objectionPrompts(objection: string): CoachOutputV1 {
  const subject = objection.trim() || "an unstated concern";
  return {
    kind: "objection-prompts", title: `Working through: ${subject}`, draft: false,
    lines: [`Objection: ${subject}`, "",
      "Acknowledge it in their words before answering.",
      `Ask what specifically about "${subject}" matters most to them.`,
      "Ask what would need to be true for it to stop being a problem.",
      "Separate the stated objection from the real one: is it timing, money, trust, or someone else's decision?",
      `Answer only with facts you can evidence: ${CONFIRM("anything about price, availability, or terms")}.`,
      "Confirm you have addressed it before moving on, and record the outcome on the relationship."],
  };
}

export function discoveryQuestions(customer: CustomerV1): CoachOutputV1 {
  return {
    kind: "discovery-questions", title: `Discovery — ${customer.displayName}`, draft: false,
    lines: ["Open questions to understand the need, not to pitch:",
      "What prompted you to start looking now?",
      "What are you driving or using today, and what works about it?",
      "What has to be true for this to be the right choice?",
      "Who else is involved in the decision?",
      "What is your timeframe?",
      "What would make you walk away?",
      customer.interests.length ? `They already mentioned: ${customer.interests.map((entry) => entry.description).join("; ")} — ask what matters about that.` : "Nothing is recorded about their interest yet — start there."],
  };
}

/** Purely a function of the record: the same relationship always yields the same suggestion. */
export function nextActionSuggestion(customer: CustomerV1): CoachOutputV1 {
  const openFollowUp = customer.followUps.find((entry) => entry.status === "open");
  const upcoming = customer.appointments.find((entry) => ["scheduled", "confirmed"].includes(entry.status));
  const suggestion = (() => {
    if (customer.archived) return "This relationship is archived. Reactivate it before working it.";
    if (upcoming) return `Confirm the ${upcoming.kind} at ${upcoming.at}.`;
    if (openFollowUp) return `Complete the follow-up due ${openFollowUp.dueAt}: ${openFollowUp.reason}.`;
    if (customer.lifecycle === "prospect") return "Make first contact and record what they tell you.";
    if (customer.lifecycle === "sold") return "Schedule a post-delivery check-in.";
    if (customer.lifecycle === "lost") return "Nothing is due. Consider a long-dated check-in.";
    if (!customer.lastContactAt) return "No contact is recorded yet — reach out and log it.";
    return "Agree a specific next step and put a date on it.";
  })();
  return {
    kind: "next-action", title: `Next action — ${customer.displayName}`, draft: false,
    lines: [suggestion, customer.nextAction ? `Recorded next action: ${customer.nextAction}` : "No next action is recorded yet."],
  };
}

export function followUpQueue(customers: readonly CustomerV1[], onDate: string, now: IsoTimestamp): CoachOutputV1 {
  const due = queryCustomers(customers, { kind: "follow-up-due", onDate }, now);
  return {
    kind: "follow-up-queue", title: `Follow-up queue — ${onDate}`, draft: false,
    lines: due.length
      ? due.map((customer) => {
        const entry = customer.followUps.filter((item) => item.status === "open").sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0]!;
        return `${entry.dueAt} · ${customer.displayName} · ${entry.channel} · ${entry.reason}`;
      })
      : ["Nothing is due. Consider who has not been contacted recently."],
  };
}

export function morningPlan(customers: readonly CustomerV1[], onDate: string, now: IsoTimestamp): CoachOutputV1 {
  const appointments = queryCustomers(customers, { kind: "appointments-on", onDate }, now);
  const due = queryCustomers(customers, { kind: "follow-up-due", onDate }, now);
  const stale = queryCustomers(customers, { kind: "not-contacted-since", days: 7, onDate }, now);
  return {
    kind: "morning-plan", title: `Morning plan — ${onDate}`, draft: false,
    lines: [
      `Appointments today: ${appointments.length}`,
      ...appointments.map((customer) => `  ${customer.appointments.filter((a) => a.at.slice(0, 10) === onDate).map((a) => a.at).join(", ")} · ${customer.displayName}`),
      `Follow-ups due: ${due.length}`,
      ...due.slice(0, 10).map((customer) => `  ${customer.displayName} — ${customer.followUps.find((f) => f.status === "open")?.reason ?? ""}`),
      `Not contacted in 7 days: ${stale.length}`,
      ...stale.slice(0, 10).map((customer) => `  ${customer.displayName} (${customer.lifecycle})`),
      "",
      "Confirm appointments first, then work the follow-up queue, then the quiet list.",
    ],
  };
}

export function endOfDayRecap(customers: readonly CustomerV1[], onDate: string): CoachOutputV1 {
  const touched = customers.filter((customer) => customer.interactions.some((entry) => entry.at.slice(0, 10) === onDate));
  const shown = customers.filter((customer) => customer.appointments.some((entry) => entry.at.slice(0, 10) === onDate && entry.status === "shown"));
  const sold = customers.filter((customer) => customer.outcome.state === "sold" && customer.outcome.at?.slice(0, 10) === onDate);
  const closedFollowUps = customers.reduce((count, customer) => count + customer.followUps.filter((entry) => entry.completedAt?.slice(0, 10) === onDate).length, 0);
  const openTomorrow = customers.filter((customer) => customer.followUps.some((entry) => entry.status === "open"));
  return {
    kind: "end-of-day-recap", title: `End of day — ${onDate}`, draft: false,
    lines: [
      `Relationships worked: ${touched.length}`,
      `Appointments shown: ${shown.length}`,
      `Sales recorded: ${sold.length}`,
      `Follow-ups completed: ${closedFollowUps}`,
      `Still open: ${openTomorrow.length}`,
      "",
      ...touched.slice(0, 15).map((customer) => `  ${customer.displayName} — ${lastInteraction(customer)?.summary ?? ""}`),
      "",
      "These are AION's own records, not any dealership system's numbers.",
    ],
  };
}

export function rolePlay(customer: CustomerV1, scenario: string): CoachOutputV1 {
  const subject = scenario.trim() || "a general conversation";
  return {
    kind: "role-play", title: `Practice — ${subject}`, draft: false,
    lines: ["Practice scaffolding. You play yourself; read the prompts aloud and answer them.", "",
      `Scenario: ${subject}`,
      `Their situation as recorded: ${customer.interests.map((entry) => entry.description).join("; ") || "nothing recorded yet"}.`,
      customer.objections.length ? `They open with: "${customer.objections[0]}"` : `They open with: "I am just looking."`,
      "", "1. Acknowledge without defending.",
      "2. Ask one open question and stop talking.",
      "3. Reflect their answer back in their words.",
      "4. Offer one specific next step with a time.",
      "", `Do not rehearse figures: ${CONFIRM("anything about price, availability, or terms")}.`],
  };
}

/**
 * Routine templates the owner may choose to create. Returning definitions rather than creating
 * routines is deliberate: nothing schedules itself, and an unused template costs nothing.
 */
export interface SalesRoutineTemplateV1 { id: string; name: string; instructions: string; intervalMinutes: number; }
export const SALES_ROUTINE_TEMPLATES: readonly SalesRoutineTemplateV1[] = Object.freeze([
  { id: "morning-plan", name: "Morning Sales Plan", intervalMinutes: 1440, instructions: "Open the Sales dashboard. Confirm today's appointments, work the follow-up queue, then review anyone not contacted in seven days." },
  { id: "midday-follow-up", name: "Midday Follow-up Review", intervalMinutes: 1440, instructions: "Re-check the follow-up queue. Complete or reschedule anything still open, and record the outcome on each relationship." },
  { id: "appointment-confirmation", name: "Appointment Confirmation Review", intervalMinutes: 1440, instructions: "Confirm every appointment scheduled for today and tomorrow. Mark each one confirmed, rescheduled, or cancelled." },
  { id: "end-of-day-recap", name: "End-of-Day Recap", intervalMinutes: 1440, instructions: "Record today's outcomes, close completed follow-ups, set tomorrow's next actions, and enter today's metrics." },
]);
