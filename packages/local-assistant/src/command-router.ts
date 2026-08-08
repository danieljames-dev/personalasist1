/**
 * The bounded natural-language command router.
 *
 * V1 made the owner type `propose:` or `developer:` to reach anything. That is a fine safety
 * property and a poor way to use a product, so this turns ordinary sentences into *typed
 * proposals* — never into commands.
 *
 * The distinction is the whole design. This module reads a sentence and decides which of a fixed
 * set of intents it names; the payload it emits is a structured record whose free-text fields are
 * only ever titles, descriptions, and questions. There is no field anywhere here that becomes an
 * argument, a path, a URL, or a shell fragment, so there is nothing for a sentence to be injected
 * into. A verification request produces an operation *identifier* chosen from AION's own list; it
 * cannot produce a command, because the type has nowhere to put one.
 *
 * It is deterministic and uses no model. That matters for three reasons: the same sentence always
 * resolves the same way, the tests do not depend on a provider, and a model cannot influence what
 * its own output is interpreted as.
 *
 * When a sentence is ambiguous or names something consequential, the router asks rather than
 * guesses. Guessing is how "clear the list" turns into a deletion nobody authorised.
 */

import type { AutonomyLevelV1 } from "./autonomy.js";
import type { VerificationOperationIdV1 } from "./contracts.js";

export type CommandIntentV1 =
  | "verification"
  | "developer-task"
  | "task.create"
  | "routine.propose"
  | "memory.propose"
  | "plan.request"
  | "relationship.action"
  | "follow-up.draft"
  | "research.propose"
  | "opportunity.create"
  | "opportunity.link"
  | "workspace.switch"
  | "chat";

export const COMMAND_INTENTS: readonly CommandIntentV1[] = [
  "verification", "developer-task", "task.create", "routine.propose", "memory.propose",
  "plan.request", "relationship.action", "follow-up.draft", "research.propose",
  "opportunity.create", "opportunity.link", "workspace.switch", "chat",
];

/**
 * One typed proposal. `payload` is a plain record of already-validated primitives; the domain
 * operation it names will validate it again on the way in, so nothing here is trusted downstream.
 */
export interface RoutedProposalV1 {
  intent: CommandIntentV1;
  /** The AION action this becomes. Chosen from a fixed set, never assembled from the sentence. */
  action: string;
  payload: Record<string, unknown>;
  autonomyLevel: AutonomyLevelV1;
  requiresApproval: boolean;
  /** What AION understood, in a sentence the owner can check before approving. */
  summary: string;
}

export interface RoutingResultV1 {
  /** The sentence as typed, kept so the owner can see what was interpreted. Never re-parsed later. */
  input: string;
  proposals: RoutedProposalV1[];
  /** Set when AION will not guess. Nothing is proposed while a question is outstanding. */
  clarification: { question: string; options: string[] } | null;
  /** Every intent considered, with why it did or did not match. Nothing is discarded silently. */
  considered: Array<{ intent: CommandIntentV1; score: number; why: string }>;
}

interface IntentRuleV1 {
  intent: CommandIntentV1;
  /** Phrases that indicate this intent. Matched literally against the lower-cased sentence. */
  triggers: readonly string[];
  /** Phrases that rule it out despite a trigger, so "task" in "no tasks please" does not match. */
  blockers?: readonly string[];
  autonomyLevel: AutonomyLevelV1;
  requiresApproval: boolean;
  action: string;
}

/**
 * The rule table.
 *
 * Deliberately readable rather than clever. Every intent AION supports is one row, and adding an
 * intent means adding a row plus a payload builder — not teaching a classifier. A reviewer can see
 * the entire vocabulary of the router in one place, which is the property that makes it auditable.
 */
const RULES: readonly IntentRuleV1[] = [
  {
    intent: "verification", action: "action.propose",
    triggers: ["run the verification", "run verification", "verification suite", "run the tests", "run tests", "npm run verify", "check the build", "run the suite", "audit dependencies", "run the demo", "career demo", "aion demo", "git status", "working tree", "uncommitted"],
    autonomyLevel: 1, requiresApproval: true,
  },
  {
    intent: "developer-task", action: "action.propose",
    triggers: ["developer agent", "have claude", "ask claude", "have codex", "ask codex", "analyse the result", "analyze the result", "explain what is failing", "explain the failure", "review the repository", "review the code"],
    autonomyLevel: 1, requiresApproval: true,
  },
  {
    intent: "research.propose", action: "research.propose",
    triggers: ["research ", "look into", "find out about", "investigate ", "what do we know about"],
    blockers: ["research job about my"],
    autonomyLevel: 3, requiresApproval: true,
  },
  {
    intent: "opportunity.create", action: "opportunity.create",
    triggers: ["product idea", "new opportunity", "opportunity for", "i have an idea for", "start an opportunity"],
    autonomyLevel: 1, requiresApproval: false,
  },
  {
    intent: "opportunity.link", action: "opportunity.task.link",
    triggers: ["link the task", "link this task", "link a task", "attach the task", "link the plan", "link this plan", "link a plan", "attach the plan", "tie this to the opportunity"],
    autonomyLevel: 2, requiresApproval: true,
  },
  {
    intent: "follow-up.draft", action: "coach",
    triggers: ["draft a follow-up", "draft a follow up", "write a follow-up", "follow-up message", "draft a message to", "draft a reply"],
    autonomyLevel: 1, requiresApproval: false,
  },
  {
    intent: "relationship.action", action: "relationship.create",
    triggers: ["add a prospect", "new prospect", "add a contact", "new contact", "add a customer", "new customer", "add a vendor", "add a lead", "log a call with", "note about"],
    autonomyLevel: 1, requiresApproval: false,
  },
  {
    intent: "routine.propose", action: "routine.create",
    triggers: ["every morning", "every day", "every week", "each morning", "remind me every", "set up a routine", "recurring"],
    autonomyLevel: 1, requiresApproval: false,
  },
  {
    intent: "plan.request", action: "plan.create",
    triggers: ["make a plan", "plan for", "plan out", "break this down", "steps to"],
    autonomyLevel: 1, requiresApproval: false,
  },
  {
    intent: "memory.propose", action: "memory.create",
    triggers: ["remember that", "remember:", "note that i", "keep in mind that", "don't forget that"],
    autonomyLevel: 1, requiresApproval: false,
  },
  {
    intent: "task.create", action: "task.create",
    triggers: ["add a task", "new task", "todo:", "to-do:", "i need to", "make sure i", "remind me to"],
    blockers: ["remind me every"],
    autonomyLevel: 1, requiresApproval: false,
  },
  {
    intent: "workspace.switch", action: "settings.update",
    triggers: ["switch to", "go to my", "open my", "switch workspace"],
    autonomyLevel: 0, requiresApproval: false,
  },
];

/** The verification operations a sentence may select, by identifier. Never by command text. */
const VERIFICATION_KEYWORDS: ReadonlyArray<{ id: VerificationOperationIdV1; words: readonly string[] }> = [
  { id: "npm.verify", words: ["verification suite", "verify", "run the tests", "run tests", "the suite", "the build"] },
  { id: "npm.audit", words: ["audit", "dependencies", "vulnerab"] },
  { id: "npm.aion.demo", words: ["aion demo", "the demo"] },
  { id: "npm.career.demo", words: ["career demo"] },
  { id: "git.status", words: ["git status", "working tree", "uncommitted"] },
  { id: "git.diff.check", words: ["whitespace", "diff check"] },
];

function normalise(value: string): string {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

/** A short, safe title taken from the sentence. Truncated on a word boundary, never re-parsed. */
function titleFrom(sentence: string, max = 120): string {
  const clean = normalise(sentence).replace(/^(?:please\s+|can you\s+|could you\s+)/iu, "");
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${space > 40 ? cut.slice(0, space) : cut}…`;
}

/**
 * Everything after the first matching trigger, which is usually the thing being talked about.
 * A leading connective is dropped so "add a task to call the supplier" yields "call the supplier"
 * rather than a title that starts mid-sentence.
 */
function subjectAfter(sentence: string, trigger: string): string {
  const index = sentence.toLocaleLowerCase().indexOf(trigger);
  if (index < 0) return "";
  return normalise(sentence.slice(index + trigger.length).replace(/^[\s:,-]+/u, "").replace(/^(?:to|that|about)\s+/iu, ""));
}

function verificationOperation(sentence: string): VerificationOperationIdV1 | null {
  const lower = sentence.toLocaleLowerCase();
  for (const entry of VERIFICATION_KEYWORDS) {
    if (entry.words.some((word) => lower.includes(word))) return entry.id;
  }
  return null;
}

function buildPayload(rule: IntentRuleV1, sentence: string, trigger: string, context: RouterContextV1): { payload: Record<string, unknown>; summary: string; action?: string } | null {
  const subject = subjectAfter(sentence, trigger);
  switch (rule.intent) {
    case "opportunity.link": {
      /*
       * The router proposes the *operation*, never the operands.
       *
       * Turning "link the task to the opportunity" into two identifiers would mean guessing which
       * task and which opportunity from prose, and a wrong guess here silently attaches work to
       * the wrong idea. So the proposal arrives with empty references and the owner picks both.
       * That is the whole reason the payload has named fields rather than a writable array.
       */
      const plan = trigger.includes("plan");
      return {
        action: plan ? "opportunity.plan.link" : "opportunity.task.link",
        payload: plan ? { id: "", planId: "" } : { id: "", taskId: "" },
        summary: `Link a ${plan ? "plan" : "task"} to an opportunity in ${context.workspaceLabel}. AION will not guess which two — choose them in Product Studio, and both must be in this workspace.`,
      };
    }
    case "verification": {
      const operationId = verificationOperation(sentence);
      if (!operationId) return null;
      return {
        payload: { capabilityId: "aion.verify.run.v1", input: { operationId } },
        summary: `Run the allowlisted verification "${operationId}". AION owns that command; nothing from your sentence became part of it.`,
      };
    }
    case "developer-task":
      return {
        // The sentence becomes the *instruction*, which travels on standard input and is never an
        // argument. The mode defaults to read-only, so a developer proposal always fails safe.
        payload: { capabilityId: "aion.developer.task.v1", input: { instruction: titleFrom(sentence, 2000), mode: "read-only" } },
        summary: "Prepare a read-only developer-agent task. The agent may read the repository and may not change it, and your words travel as data on standard input.",
      };
    case "research.propose":
      return {
        payload: { job: { question: titleFrom(subject || sentence, 400), scope: "local-only" } },
        summary: `Propose a research job about "${titleFrom(subject || sentence, 80)}". Scope starts at local-only and nothing runs until you approve it.`,
      };
    case "opportunity.create":
      return { payload: { opportunity: { title: titleFrom(subject || sentence, 120) } }, summary: `Open a Product Studio opportunity titled "${titleFrom(subject || sentence, 80)}". It scores zero until something is established about it.` };
    case "follow-up.draft":
      return { payload: { kind: "follow-up-draft", input: { customerId: "" } }, summary: "Draft a follow-up. AION prepares a draft and never sends anything; you will need to say who it is for." };
    case "relationship.action":
      return { payload: { relationship: { displayName: titleFrom(subject, 120) || "Unnamed", relationshipType: trigger.includes("vendor") ? "vendor" : trigger.includes("customer") ? "customer" : trigger.includes("lead") ? "lead" : trigger.includes("prospect") ? "prospect" : "contact" } }, summary: `Add a relationship record in ${context.workspaceLabel}${subject ? ` for "${titleFrom(subject, 60)}"` : ""}.` };
    case "routine.propose":
      return { payload: { routine: { name: titleFrom(sentence, 120), instructions: titleFrom(sentence, 2000), intervalMinutes: sentence.toLocaleLowerCase().includes("week") ? 10_080 : 1_440 } }, summary: "Propose a routine. Nothing is scheduled until you create and enable it, and routines run only while AION is open." };
    case "plan.request":
      return { payload: { goal: titleFrom(subject || sentence, 200), steps: [] }, summary: `Draft a plan for "${titleFrom(subject || sentence, 80)}". A plan is a reviewable proposal and carries no execution authority.` };
    case "memory.propose":
      return subject ? { payload: { memory: { content: titleFrom(subject, 2000), category: "semantic" } }, summary: `Record a memory in ${context.workspaceLabel}: "${titleFrom(subject, 80)}".` } : null;
    case "task.create":
      return { payload: { task: { title: titleFrom(subject || sentence, 200) } }, summary: `Create a task in ${context.workspaceLabel}: "${titleFrom(subject || sentence, 80)}".` };
    case "workspace.switch": {
      const wanted = normalise(subject).toLocaleLowerCase().replace(/\s+workspace$/u, "");
      const match = context.workspaces.find((entry) => entry.label.toLocaleLowerCase() === wanted || entry.id === wanted);
      if (!match) return null;
      return { payload: { settings: { activeWorkspace: match.id } }, summary: `Switch to ${match.label}. Records stay in the workspace they were created in.` };
    }
    default:
      return null;
  }
}

export interface RouterContextV1 {
  workspaceLabel: string;
  workspaces: ReadonlyArray<{ id: string; label: string }>;
}

/**
 * Resolves one sentence into typed proposals.
 *
 * A sentence may name more than one thing — "run the verification suite and have Claude analyse
 * the result" is two intents, in order — so the result is a list. Ambiguity between intents that
 * would do materially different things produces a question instead of a coin flip.
 */
export function routeCommand(sentence: string, context: RouterContextV1): RoutingResultV1 {
  const input = normalise(sentence);
  const lower = input.toLocaleLowerCase();
  const considered: RoutingResultV1["considered"] = [];
  const matches: Array<{ rule: IntentRuleV1; trigger: string; at: number; payload: Record<string, unknown>; summary: string; action?: string }> = [];

  for (const rule of RULES) {
    const blocked = rule.blockers?.find((phrase) => lower.includes(phrase));
    if (blocked) { considered.push({ intent: rule.intent, score: 0, why: `ruled out by "${blocked}"` }); continue; }
    const trigger = rule.triggers.find((phrase) => lower.includes(phrase));
    if (!trigger) { considered.push({ intent: rule.intent, score: 0, why: "no trigger phrase present" }); continue; }
    const built = buildPayload(rule, input, trigger, context);
    if (!built) { considered.push({ intent: rule.intent, score: 1, why: `"${trigger}" matched but AION could not tell what it referred to` }); continue; }
    considered.push({ intent: rule.intent, score: trigger.length, why: `matched "${trigger}"` });
    matches.push({ rule, trigger, at: lower.indexOf(trigger), ...built });
  }

  if (!matches.length) {
    // Not a failure: most sentences are conversation, and treating everything as a command would
    // be far worse than treating a command as conversation.
    return {
      input,
      proposals: [{ intent: "chat", action: "chat.send", payload: { content: input }, autonomyLevel: 0, requiresApproval: false, summary: "Send this as an ordinary message." }],
      clarification: null,
      considered,
    };
  }

  /*
   * Ambiguity is about words AION cannot assign.
   *
   * Two triggers that overlap, or that sit directly against each other with nothing between them,
   * are competing for the same words: "I need to research the market" is a task about research or
   * a research job, and picking one would be a guess. Triggers separated by actual content are a
   * compound request instead — "run the verification suite and have Claude analyse the result" is
   * two things the owner asked for, in order, and answering only one of them would be worse.
   */
  const sorted = [...matches].sort((a, b) => a.at - b.at || b.trigger.length - a.trigger.length);
  const competing = sorted.filter((match, index) => {
    const previous = sorted[index - 1];
    return previous !== undefined && match.at - (previous.at + previous.trigger.length) < 2;
  });
  if (competing.length) {
    const options = [...new Set(sorted.map((match) => match.rule.intent))];
    return {
      input, proposals: [], considered,
      clarification: {
        question: `That could mean more than one thing and AION will not guess. Did you mean to ${options.map((intent) => intent.replace(/[.-]/gu, " ")).join(", or to ")}?`,
        options,
      },
    };
  }

  const seen = new Set<CommandIntentV1>();
  const proposals: RoutedProposalV1[] = [];
  for (const match of sorted) {
    if (seen.has(match.rule.intent)) continue;
    seen.add(match.rule.intent);
    proposals.push({
      intent: match.rule.intent, action: match.action ?? match.rule.action, payload: match.payload,
      autonomyLevel: match.rule.autonomyLevel, requiresApproval: match.rule.requiresApproval,
      summary: match.summary,
    });
  }
  return { input, proposals, clarification: null, considered };
}

/**
 * The safety property, as an assertion rather than a promise.
 *
 * Every free-text value a routed payload carries is checked for the shapes that would only matter
 * if something downstream were going to execute it. Nothing downstream does — no capability
 * accepts a command, and the developer bridge takes its instruction on standard input — so this is
 * belt and braces. It is worth having anyway: if a future payload field ever did reach a process,
 * this test would fail before the exploit did.
 */
export function assertNoExecutableText(result: RoutingResultV1): void {
  const dangerous = /[;&|`$><]|\$\(|\|\||&&|\bsudo\b|\brm\s+-|\bcurl\b|\bwget\b|\bpowershell\b|\bcmd\.exe\b/iu;
  const walk = (value: unknown, path: string): void => {
    if (typeof value === "string") {
      if (dangerous.test(value)) throw new Error(`A routed payload carried shell-shaped text at ${path}. AION refuses to pass it on.`);
      return;
    }
    if (Array.isArray(value)) { value.forEach((entry, index) => walk(entry, `${path}[${index}]`)); return; }
    if (value && typeof value === "object") {
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) walk(inner, `${path}.${key}`);
    }
  };
  for (const [index, proposal] of result.proposals.entries()) walk(proposal.payload, `proposals[${index}].payload`);
}
