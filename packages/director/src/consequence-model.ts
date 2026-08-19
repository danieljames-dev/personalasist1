/**
 * What would this actually *do*? — asked target-first, so an unfamiliar verb cannot make it routine.
 *
 * This module has now failed two independent hostile reviews, and the second failure is the reason it
 * looks the way it does. The first version was a phrase list. The second version produced a
 * structured result — and still consulted the verb first:
 *
 *     unknown verb → no action family selected → targets never examined → routine
 *
 * So "Push this update live.", "Ship this to the customer.", "Wire in my Google login." and "Fund the
 * API." all inherited authority under valid lineage. The output type was structured; the *decision*
 * was still a synonym lookup, and 22 of 37 consequential requests walked through it.
 *
 * ## Target-first
 *
 * Targets are classified **independently of verbs**, and a consequential target is decisive:
 *
 *   1. **Pass A — targets.** What is being acted on? Classified with no reference to the action.
 *   2. **Pass B — actions.** Routine, consequential, or *unknown*. Unknown stays unknown.
 *   3. **Pass C — declared evidence.** Effect class, sensitivity, spend, providers from the milestone.
 *   4. **Pass D — conservative composition.** Most restrictive interpretation wins.
 *
 * The composition rule that matters:
 *
 *   **A consequential target gates unless the action is proven routine *and* the target is not
 *   consequential.** A verb nobody recognised near the word "backups" is not a safe request; it is an
 *   unread one.
 *
 * ## Two ways to be wrong, and which one this file chooses
 *
 * Over-gating costs an Owner decision on work that was safe. Under-gating deletes backups. "Fix the
 * customer list rendering bug" mentions a customer and will gate — that is a real false positive and
 * it is the price. It is stated here rather than hidden, because the temptation to trim these lists
 * for convenience is exactly how the previous two versions failed.
 *
 * Adding synonyms does not fix this class of bug. Unseen wording has to fail closed *structurally*,
 * which is why the action tables below are the least important thing in the file.
 */

/** One reason a consequence was concluded, kept so a gate can be read rather than guessed at. */
export interface ConsequenceEvidenceV1 {
  readonly consequence: string;
  readonly action: string;
  readonly target: string;
  readonly detail: string;
}

export interface RequestedConsequenceV1 {
  readonly externalSend: boolean;
  readonly externalPublish: boolean;
  readonly externalContact: boolean;
  readonly destructiveImportantData: boolean;
  readonly credentialAccess: boolean;
  readonly accountAccess: boolean;
  readonly oauthConsent: boolean;
  readonly sensitiveDataExpansion: boolean;
  readonly paidResource: boolean;
  readonly spendIncrease: boolean;
  readonly newFinancialObligation: boolean;
  readonly productionMutation: boolean;
  readonly securityConfigurationChange: boolean;
  readonly irreversibleExternalEffect: boolean;
  readonly authorityExpansion: boolean;
  /** The request could not be proven routine. Gates, and no envelope setting covers it. */
  readonly uncertainConsequence: boolean;
  readonly evidence: readonly ConsequenceEvidenceV1[];
}

type ConsequenceKey = Exclude<keyof RequestedConsequenceV1, "evidence">;

/* -------------------------------------------------------------------------- */
/* Pass A — targets, classified without reference to any verb                  */
/* -------------------------------------------------------------------------- */

interface TargetClassV1 {
  readonly target: string;
  readonly words: readonly string[];
  /** What touching this target implies, whatever the action turns out to be. */
  readonly implies: readonly ConsequenceKey[];
  /** True when this target is safe to act on with an unrecognised verb. */
  readonly routine: boolean;
}

const TARGET_CLASSES: readonly TargetClassV1[] = [
  {
    target: "an external party",
    words: ["customer", "client", "buyer", "seller", "lead", "leads", "prospect", "subscriber", "recipient", "recruiter", "applicant", "candidate", "vendor", "supplier", "audience", "everyone", "the list", "mailing list", "our contacts", "the team at"],
    implies: ["externalSend", "externalContact", "irreversibleExternalEffect"],
    routine: false,
  },
  {
    target: "the public",
    words: ["publicly", "public", "website", "web site", "the site", "online", "live", "the internet", "social", "blog", "twitter", "linkedin", "facebook", "instagram", "press release", "announcement", "the notice", "channel"],
    implies: ["externalPublish", "externalContact", "irreversibleExternalEffect"],
    routine: false,
  },
  {
    target: "an account or credential",
    words: ["gmail", "outlook", "office 365", "inbox", "mailbox", "my mail", "my email", "email account", "google account", "google login", "my google", "portal", "my account", "login", "log-in", "sign-in", "credential", "password", "api key", "access token", "oauth", "authenticate", "authentication", "my calendar", "my drive"],
    implies: ["accountAccess", "oauthConsent", "credentialAccess"],
    routine: false,
  },
  {
    target: "money",
    words: ["paid", "paid tier", "paid model", "paid plan", "billing", "invoice", "subscription", "subscribe", "api access", "money", "budget", "purchase", "payment", "spend", "credits", "price", "pricing", "costs money", "cost money", "premium tier", "license fee"],
    implies: ["paidResource", "spendIncrease", "newFinancialObligation"],
    routine: false,
  },
  {
    target: "important or recoverable data",
    words: ["backup", "backups", "back up", "back-up", "snapshot", "snapshots", "restore file", "restore point", "restore copies", "recovery cop", "recovery file", "recovery snapshot", "archive", "archives", "archived", "dump", "dumps", "database", "production data", "shadow copy", "audit log", "the ledger", "the handoff", "certification"],
    implies: ["destructiveImportantData"],
    routine: false,
  },
  {
    target: "a security control",
    words: ["firewall", "windows security", "windows protection", "security policy", "security setting", "protection", "protections", "defender", "antivirus", "bitlocker", "secure boot", "uac", "group policy", "encryption", "open a port", "port forward", "os security", "safeguard"],
    implies: ["securityConfigurationChange"],
    routine: false,
  },
  {
    target: "production",
    words: ["production", "prod ", "prod.", "live site", "live environment", "customer-facing", "the writer"],
    implies: ["productionMutation"],
    routine: false,
  },
  {
    target: "sensitive personal data",
    words: ["my messages", "my texts", "my calls", "call transcript", "my photos", "my bank", "financial record", "medical", "ssn", "social security", "tax return", "personal context", "browsing history", "my documents", "my history"],
    implies: ["sensitiveDataExpansion"],
    routine: false,
  },
  {
    target: "AION's own authority",
    words: ["approval", "approve", "preapprove", "pre-approve", "preapproved", "pre-approved", "prompting", "prompt me", "asking me", "ask me", "checking with me", "check with me", "permission", "permissions", "authorization", "authorize yourself", "autonomy", "going forward", "from now on", "next time", "without checking", "without asking", "automatically", "on your own"],
    implies: ["authorityExpansion"],
    routine: false,
  },
  {
    target: "an external system of record",
    words: ["tekion", "informativ", "metricool", "salesforce", "hubspot", "quickbooks", "job board", "job listing", "public listings", "indeed"],
    implies: ["externalContact", "sensitiveDataExpansion"],
    routine: false,
  },
  {
    target: "a code artifact",
    words: ["class", "function", "method", "variable", "import", "test", "tests", "spec", "fixture", "mock", "component", "module", "file", "helper", "comment", "docstring", "type", "interface", "css", "style", "lint", "dead code", "unused", "duplicate", "stub", "todo", "warning", "parser", "renderer", "serializer", "validator", "schema", "config", "script", "package", "dependency", "build", "pipeline", "commit", "branch", "readme", "documentation", "docs", "help copy", "copy text"],
    implies: [],
    routine: true,
  },
  {
    target: "an internal technical object",
    words: ["internal", "internally", "locally", "local", "endpoint", "queue", "adapter", "handler", "route", "api call", "request", "payload", "socket", "buffer", "cache", "the panel", "the page", "the button", "the indicator", "the ui", "the view", "the port", "process", "node", "nodes", "rendering", "status"],
    implies: [],
    routine: true,
  },
];

export interface TargetEvidenceV1 {
  readonly consequential: readonly string[];
  readonly routine: readonly string[];
  readonly implied: readonly ConsequenceKey[];
  readonly matched: readonly (readonly [string, string])[];
}

/**
 * Classify what a request acts on, with no reference to how.
 *
 * This is Pass A and it runs first for a reason: the previous version reached its target table only
 * after an action pattern matched, so an unrecognised verb meant the targets were never read at all.
 */
export function classifyTargets(text: string): TargetEvidenceV1 {
  const lower = typeof text === "string" ? text.toLowerCase() : "";
  const consequential: string[] = [];
  const routine: string[] = [];
  const implied: ConsequenceKey[] = [];
  const matched: [string, string][] = [];

  for (const row of TARGET_CLASSES) {
    const word = row.words.find((candidate) => lower.includes(candidate));
    if (word === undefined) continue;
    matched.push([row.target, word]);
    if (row.routine) {
      routine.push(row.target);
      continue;
    }
    consequential.push(row.target);
    for (const consequence of row.implies) {
      if (!implied.includes(consequence)) implied.push(consequence);
    }
  }

  return { consequential, routine, implied, matched };
}

/* -------------------------------------------------------------------------- */
/* Pass B — actions. Unknown stays unknown.                                    */
/* -------------------------------------------------------------------------- */

export type ActionKindV1 = "ROUTINE" | "CONSEQUENTIAL" | "UNKNOWN";

/**
 * Verbs that do not mutate anything outside the repository, whatever they are pointed at.
 *
 * This list is a *permission to proceed on an unresolved target*, so it stays small and boring. It is
 * not a synonym list for safety — a routine verb aimed at a consequential target still gates.
 */
const ROUTINE_ACTIONS: readonly string[] = [
  "polish", "tidy", "simplify", "refactor", "rename", "reformat", "format", "document", "annotate",
  "comment", "clarify", "improve", "adjust", "tweak", "reorganize", "reorder", "extract", "inline",
  "describe", "explain", "review", "read", "inspect", "check", "measure", "profile", "log",
  "test", "lint", "typecheck", "build", "compile", "verify", "fix", "add", "update", "write",
];

/** Verbs whose effect is consequential *when* they reach a consequential or unresolved target. */
const CONSEQUENTIAL_ACTIONS: readonly string[] = [
  "send", "email", "mail", "message", "text", "dm", "forward", "notify", "share", "deliver",
  "circulate", "distribute", "publish", "post", "announce", "broadcast", "tweet", "release",
  "roll out", "ship", "push", "upload", "put", "make", "go live",
  "delete", "remove", "clear", "clean", "erase", "wipe", "purge", "destroy", "drop", "discard",
  "prune", "trash", "nuke", "get rid of",
  "connect", "hook", "wire", "link", "tie", "sign", "log in", "authenticate", "grant", "give",
  "let", "allow", "enable", "use",
  "buy", "purchase", "pay", "fund", "spend", "subscribe", "upgrade",
  "disable", "turn off", "loosen", "relax", "ease", "weaken", "bypass", "open", "unblock", "lower",
  "stop", "skip", "assume", "preapprove", "pre-approve", "handle", "treat", "deploy", "activate",
  "promote", "cut over",
];

function firstWordOf(text: string): string {
  const lead = ["just", "please", "also", "now", "then", "quickly", "simply", "actually", "really", "kindly", "maybe", "perhaps", "don't", "do not", "never", "always"];
  let head = text.trim().toLowerCase();
  for (;;) {
    const adverb = lead.find((word) => head.startsWith(`${word} `));
    if (adverb === undefined) break;
    head = head.slice(adverb.length + 1);
  }
  return head.split(/[^a-z'-]+/).filter(Boolean)[0] ?? "";
}

/**
 * Match a verb as a whole word, never as a substring.
 *
 * Found while writing the tests: "Zorble my Gmail inbox." matched the verb `mail` inside the noun
 * `Gmail` and was classified as a known action. It still gated — the account target caught it — but a
 * verb matcher that fires on fragments of unrelated nouns produces both false alarms and, worse,
 * false confidence that the action was understood.
 */
function containsWord(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(String.raw`(^|[^a-z])${escaped}([^a-z]|$)`).test(text);
}

/** Classify the action, returning `UNKNOWN` rather than guessing. */
export function classifyAction(text: string): { kind: ActionKindV1; matched: string } {
  const lower = typeof text === "string" ? text.toLowerCase() : "";
  const head = firstWordOf(lower);

  const consequential = CONSEQUENTIAL_ACTIONS.find((verb) => head === verb || containsWord(lower, verb));
  if (consequential !== undefined) return { kind: "CONSEQUENTIAL", matched: consequential };

  const routine = ROUTINE_ACTIONS.find((verb) => head === verb || containsWord(lower, verb));
  if (routine !== undefined) return { kind: "ROUTINE", matched: routine };

  return { kind: "UNKNOWN", matched: head };
}

/* -------------------------------------------------------------------------- */
/* Pass C — evidence the milestone declares about itself                       */
/* -------------------------------------------------------------------------- */

export interface DeclaredEffectEvidenceV1 {
  readonly externalEffectClass?: string;
  readonly reversibilityClass?: string;
  readonly sensitivityClass?: string;
  readonly spendCapUsd?: number;
  readonly riskClasses?: readonly string[];
}

/** Consequences the milestone's own declared fields imply. These may only add. */
export function consequencesFromDeclaredFields(declared: DeclaredEffectEvidenceV1): readonly ConsequenceKey[] {
  const found: ConsequenceKey[] = [];
  const risks = new Set(declared.riskClasses ?? []);
  if (declared.externalEffectClass === "IRREVERSIBLE_EXTERNAL") found.push("irreversibleExternalEffect");
  if (declared.externalEffectClass === "IDEMPOTENT_EXTERNAL") found.push("externalContact");
  // Deliberately no `IRREVERSIBLE → destructiveImportantData` mapping. Emailing a customer is
  // irreversible and destroys nothing; inferring destruction from reversibility meant an envelope
  // that explicitly granted irreversible external effects still could not send anything. The
  // resolver checks irreversibility separately, against either covering permission.
  if (declared.sensitivityClass === "CONFIDENTIAL" || declared.sensitivityClass === "RESTRICTED") {
    found.push("sensitiveDataExpansion");
  }
  if ((declared.spendCapUsd ?? 0) > 0) found.push("paidResource", "spendIncrease");
  if (risks.has("PRODUCTION_OR_EXTERNAL")) found.push("productionMutation");
  if (risks.has("SECURITY_OR_PRIVACY")) found.push("securityConfigurationChange");
  if (risks.has("PERSISTENCE_OR_RECOVERY")) found.push("destructiveImportantData");
  if (risks.has("MONEY")) found.push("paidResource");
  if (risks.has("SENSITIVE_DATA")) found.push("sensitiveDataExpansion");
  if (risks.has("AUTHORITY_OR_GOVERNANCE")) found.push("authorityExpansion");
  return found;
}

/* -------------------------------------------------------------------------- */
/* Pass D — conservative composition                                           */
/* -------------------------------------------------------------------------- */

const EMPTY_FLAGS: Record<ConsequenceKey, boolean> = {
  externalSend: false, externalPublish: false, externalContact: false,
  destructiveImportantData: false, credentialAccess: false, accountAccess: false, oauthConsent: false,
  sensitiveDataExpansion: false, paidResource: false, spendIncrease: false, newFinancialObligation: false,
  productionMutation: false, securityConfigurationChange: false, irreversibleExternalEffect: false,
  authorityExpansion: false, uncertainConsequence: false,
};

/**
 * Read the consequences a request would have.
 *
 * The composition below is the security boundary. Everything above it is evidence, and no single
 * source of evidence is trusted to say "routine" on its own.
 */
export function detectRequestedConsequences(
  text: string,
  declared: DeclaredEffectEvidenceV1 = {},
): RequestedConsequenceV1 {
  const flags: Record<ConsequenceKey, boolean> = { ...EMPTY_FLAGS };
  const evidence: ConsequenceEvidenceV1[] = [];
  const raise = (consequence: ConsequenceKey, action: string, target: string, detail: string): void => {
    if (flags[consequence]) return;
    flags[consequence] = true;
    evidence.push({ consequence, action, target, detail });
  };

  const lower = typeof text === "string" ? text.toLowerCase() : "";
  if (lower.trim() === "") {
    return { ...flags, evidence };
  }

  const targets = classifyTargets(lower);
  const action = classifyAction(lower);

  // Pass C first, so a milestone that already declares an effect can never be talked out of it.
  for (const consequence of consequencesFromDeclaredFields(declared)) {
    raise(consequence, "declared", "milestone fields", `the milestone declares ${consequence}`);
  }

  /*
   * A consequential target is decisive.
   *
   * Not "a consequential target plus a recognised verb" — that conjunction is exactly what failed.
   * "Push this update live", "Fund the API" and "Wire in my Google login" all name a consequential
   * target, and whether the verb happens to be in a list below changes nothing about what they ask
   * for.
   */
  if (targets.consequential.length > 0) {
    for (const consequence of targets.implied) {
      const source = targets.matched.find(([name]) => TARGET_CLASSES.find((row) => row.target === name)?.implies.includes(consequence));
      raise(consequence, action.matched || "unresolved", source?.[0] ?? "consequential target", `"${source?.[1] ?? ""}" names ${source?.[0] ?? "a consequential target"}`);
    }
    if (action.kind === "UNKNOWN") {
      raise("uncertainConsequence", "unresolved", targets.consequential.join(", "),
        `the action "${action.matched}" was not recognised and the request names ${targets.consequential.join(", ")}`);
    }
    return { ...flags, evidence };
  }

  /*
   * No consequential target. Now the action decides whether the *absence* of one is safe.
   *
   * A consequential verb with nothing recognisable to act on is unread, not harmless: "Send it." and
   * "Remove that permanently." are ordinary sentences that cannot be classified without knowing what
   * "it" is. A routine target rescues them; nothing else does.
   */
  if (action.kind === "CONSEQUENTIAL") {
    if (targets.routine.length > 0) return { ...flags, evidence };
    raise("uncertainConsequence", action.matched, "unresolved",
      `"${action.matched}" was requested but nothing identifiable was named as its target`);
    return { ...flags, evidence };
  }

  if (action.kind === "UNKNOWN") {
    if (targets.routine.length > 0) return { ...flags, evidence };
    raise("uncertainConsequence", action.matched || "unresolved", "unresolved",
      "neither the action nor its target could be identified");
    return { ...flags, evidence };
  }

  // Routine action, no consequential target. The one path that concludes "routine".
  return { ...flags, evidence };
}

/** True when anything at all was detected. */
export function hasAnyConsequence(consequences: RequestedConsequenceV1): boolean {
  for (const key of Object.keys(EMPTY_FLAGS) as ConsequenceKey[]) {
    if (consequences[key]) return true;
  }
  return false;
}

/** The permission an envelope must carry for each consequence, or `never` where none suffices. */
export interface ConsequencePermissionV1 {
  readonly consequence: ConsequenceKey;
  readonly requires: "destructive" | "oauth" | "security" | "production" | "sensitive" | "spend" | "irreversibleExternal" | "never";
}

export const CONSEQUENCE_PERMISSIONS_V1: readonly ConsequencePermissionV1[] = [
  { consequence: "authorityExpansion", requires: "never" },
  { consequence: "uncertainConsequence", requires: "never" },
  { consequence: "destructiveImportantData", requires: "destructive" },
  { consequence: "accountAccess", requires: "oauth" },
  { consequence: "oauthConsent", requires: "oauth" },
  { consequence: "credentialAccess", requires: "oauth" },
  { consequence: "securityConfigurationChange", requires: "security" },
  { consequence: "productionMutation", requires: "production" },
  { consequence: "sensitiveDataExpansion", requires: "sensitive" },
  { consequence: "paidResource", requires: "spend" },
  { consequence: "spendIncrease", requires: "spend" },
  { consequence: "newFinancialObligation", requires: "spend" },
  { consequence: "externalSend", requires: "irreversibleExternal" },
  { consequence: "externalPublish", requires: "irreversibleExternal" },
  { consequence: "externalContact", requires: "irreversibleExternal" },
  { consequence: "irreversibleExternalEffect", requires: "irreversibleExternal" },
];

/** A readable one-liner naming what was detected and why. */
export function describeConsequences(consequences: RequestedConsequenceV1): string {
  if (consequences.evidence.length === 0) return "no consequence beyond repository-local work was detected";
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const row of consequences.evidence) {
    if (seen.has(row.consequence)) continue;
    seen.add(row.consequence);
    parts.push(`${row.consequence} (${row.detail})`);
  }
  return parts.join("; ");
}
