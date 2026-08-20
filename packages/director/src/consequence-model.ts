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
    /*
     * Deliberately **not** including "file" or "files".
     *
     * An independent review found "Shred those files.", "Nuke the files." and "Get rid of the files."
     * inheriting authority, because `file` was listed here and rescued them. "The files" names
     * nothing — it could be source, backups, or the Owner's documents — so treating it as a code
     * artifact turned the most generic noun in the language into a blanket permission.
     *
     * Everything below names a *specific* engineering object. That is what "affirmatively routine"
     * has to mean; a word that could refer to anything is an unresolved target, not a safe one.
     */
    target: "a code artifact",
    words: ["class", "function", "method", "variable", "import", "test", "tests", "spec", "fixture", "mock", "component", "module", "helper", "comment", "docstring", "type", "interface", "css", "style", "lint", "dead code", "unused", "duplicate", "stub", "todo", "warning", "parser", "renderer", "serializer", "validator", "schema", "config", "configuration", "script", "package", "dependency", "build", "pipeline", "commit", "branch", "readme", "documentation", "docs", "help copy", "copy text",
      /*
       * Ordinary nouns of the trade, named so that engineering compounds have a recognised middle
       * once class identity stopped excusing one. These name *objects*; they grant nothing about
       * what may be done to them, and an unrecognised verb aimed at any of them still gates.
       */
      "regression", "integration", "cleanup", "error", "bug", "bugs", "code"],
    implies: [],
    routine: true,
  },
  {
    target: "an internal technical object",
    words: ["internal", "internally", "locally", "local", "endpoint", "queue", "adapter", "handler", "route", "api call", "request", "response", "payload", "socket", "buffer", "cache", "panel", "page", "button", "indicator", "ui", "view", "port", "process", "node", "nodes", "rendering", "status", "roadmap", "dashboard", "screen", "layout", "label", "state", "states", "form", "input", "output", "banner", "tooltip", "column", "row", "table", "chart", "log", "logs", "log line", "wording", "copy", "name", "names", "title", "heading", "phrase", "phrases"],
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
    // Whole-word for single tokens, substring for phrases. Matching "live" inside "delivery" or
    // "port" inside "important" produced both false gates and false confidence.
    const word = row.words.find((candidate) =>
      candidate.includes(" ") ? lower.includes(candidate) : containsWord(lower, candidate),
    );
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
  // "handle" is an ordinary engineering verb ("handle the response"). The dangerous sense of it —
  // "handle these without checking" — is carried by the authority *target* words, which win.
  "handle", "render", "parse", "validate", "wire",
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
  "stop", "skip", "assume", "preapprove", "pre-approve", "treat", "deploy", "activate",
  "promote", "cut over",
];

/**
 * What a consequential verb does *by itself*, regardless of what it is pointed at.
 *
 * The composition table used to read "consequential action + routine target -> allow", so a routine
 * target neutralised the action outright:
 *
 *     "Send the log."  "Nuke the parser."  "Email the cache."  "Grant the helper."
 *
 * all inherited standing authority, because `log`, `parser`, `cache` and `helper` are ordinary
 * engineering objects. That is backwards. Sending is an irreversible external effect whatever is in
 * the envelope; nuking destroys whatever it names; granting confers authority. The object bounds the
 * *blast radius*, never the *kind* of effect.
 *
 * Split by where the danger lives:
 *
 *   - here, because the *doing* is dangerous — the consequence is raised whatever the target;
 *   - not here, because only the *object* is dangerous — `delete`, `remove`, `clear`, `push`, `use`,
 *     `open`, `make` are the verbs of ordinary repository work, and "Remove the unused CSS class."
 *     must stay usable. Those still gate through the target ("Delete the backups.").
 *
 * Every verb below was already in `CONSEQUENTIAL_ACTIONS`. Nothing was added: this makes the list the
 * model already had actually restrict, instead of being cancelled by the noun next to it. The raised
 * consequence is permission-checked like any other, so an envelope that grants external send can
 * still send.
 */
const ACTION_CONSEQUENCE: readonly (readonly [string, ConsequenceKey])[] = [
  ["send", "externalSend"], ["email", "externalSend"], ["mail", "externalSend"],
  ["message", "externalSend"], ["text", "externalSend"], ["dm", "externalSend"],
  ["forward", "externalSend"], ["notify", "externalSend"], ["circulate", "externalSend"],
  ["distribute", "externalSend"], ["deliver", "externalSend"],
  ["publish", "externalPublish"], ["announce", "externalPublish"], ["broadcast", "externalPublish"],
  ["tweet", "externalPublish"], ["upload", "externalPublish"], ["go live", "externalPublish"],
  ["roll out", "externalPublish"],
  ["nuke", "destructiveImportantData"], ["destroy", "destructiveImportantData"],
  ["wipe", "destructiveImportantData"], ["purge", "destructiveImportantData"],
  ["erase", "destructiveImportantData"], ["trash", "destructiveImportantData"],
  ["grant", "securityConfigurationChange"], ["disable", "securityConfigurationChange"],
  ["turn off", "securityConfigurationChange"], ["weaken", "securityConfigurationChange"],
  ["bypass", "securityConfigurationChange"], ["unblock", "securityConfigurationChange"],
  ["loosen", "securityConfigurationChange"], ["preapprove", "securityConfigurationChange"],
  ["pre-approve", "securityConfigurationChange"],
  // `fund` is deliberately absent: what it costs is entirely a property of what is funded, so it
  // belongs with `push` and `remove` among the verbs whose danger is only ever in their object.
  ["buy", "spendIncrease"], ["purchase", "spendIncrease"], ["pay", "spendIncrease"],
  ["subscribe", "spendIncrease"],
  ["deploy", "productionMutation"], ["activate", "productionMutation"],
  ["promote", "productionMutation"], ["cut over", "productionMutation"],
  ["authenticate", "accountAccess"], ["log in", "accountAccess"],
];

/** The consequence a verb carries on its own, or `undefined` when its danger is only in its object. */
function consequenceOfAction(verb: string): ConsequenceKey | undefined {
  return ACTION_CONSEQUENCE.find(([name]) => name === verb)?.[1];
}

/**
 * Politeness and auxiliary wrappers that sit in front of the actual predicate.
 *
 * Stripped so "Could you update the parser?" finds `update` rather than `could`. This only changes
 * *which word is treated as the head* — routine recognition remains head-only, so no noun elsewhere
 * in the sentence gains verb status from it.
 */
const INSTRUCTION_WRAPPERS: readonly string[] = [
  "could you please", "can you please", "would you please", "could you", "can you", "would you",
  "will you", "i need you to", "i want you to", "i would like you to", "i need to", "i want to",
  "we need to", "we should", "you should", "you could", "you can", "we could", "try to",
  "go ahead and", "please go ahead and", "make sure you", "make sure to", "help me",
];

const LEADING_ADVERBS: readonly string[] = [
  "just", "please", "also", "now", "then", "quickly", "simply", "actually", "really", "kindly",
  "maybe", "perhaps", "never", "always", "first", "finally", "next",
];

/**
 * Remove a leading politeness or auxiliary wrapper from the whole request.
 *
 * Done before decomposition rather than after: "Go ahead and update the parser." splits on " and "
 * into "go ahead" and "update the parser", and the first half then gates as an unknown effect. A
 * wrapper is not an effect and must not become one.
 */
export function stripInstructionWrappers(text: string): string {
  let out = text.trim();
  for (;;) {
    const wrapper = INSTRUCTION_WRAPPERS.find((phrase) => out.toLowerCase().startsWith(phrase + " "));
    if (wrapper === undefined) break;
    out = out.slice(wrapper.length + 1).trim();
  }
  return out;
}

/** The predicate head of an instruction, after politeness and auxiliary wrappers. */
function firstWordOf(text: string): string {
  let head = text.trim().toLowerCase();
  for (;;) {
    const wrapper = INSTRUCTION_WRAPPERS.find((phrase) => head.startsWith(phrase + " "));
    if (wrapper !== undefined) { head = head.slice(wrapper.length + 1); continue; }
    const adverb = LEADING_ADVERBS.find((word) => head.startsWith(word + " "));
    if (adverb !== undefined) { head = head.slice(adverb.length + 1); continue; }
    break;
  }
  return head.split(/[^a-z'-]+/).filter(Boolean)[0] ?? "";
}

/**
 * Every inflected form of a verb worth matching, generated rather than listed.
 *
 * `nuke` did not match `nuking` and `shred` did not match `shredding`, so an inflection missing from
 * a table read as an unrecognised action. Generating the forms removes that whole category of
 * near-miss without anyone maintaining a list, and it is applied only to the *consequential* side,
 * where a match restricts.
 */
function inflectionsOf(verb: string): readonly string[] {
  if (verb.includes(" ")) return [verb];
  const forms = new Set<string>([verb, verb + "s", verb + "d", verb + "ed", verb + "ing"]);
  if (verb.endsWith("e")) {
    const stem = verb.slice(0, -1);
    forms.add(stem + "ing");
    forms.add(stem + "ed");
  }
  const last = verb.slice(-1);
  const prior = verb.slice(-2, -1);
  if (/[bdgklmnprt]/.test(last) && /[aeiou]/.test(prior) && verb.length <= 5) {
    forms.add(verb + last + "ing");
    forms.add(verb + last + "ed");
  }
  return [...forms];
}

/**
 * The noun forms of the verbs this model already reads as routine, generated rather than listed.
 *
 * Engineering compounds are built out of them — "the request *validation* helper", "the parser error
 * *handling* test", "the status *rendering* panel" — and once the same-class compound shortcut was
 * removed those middles had nothing affirmative behind them. Deriving the nominal of a verb already
 * known to be routine supplies that evidence without widening what counts as safe: the source verb
 * had to be routine first, so nothing enters here that could not already head a routine request.
 *
 * Consequential verbs are deliberately excluded. "Update the parser *sending* tests." must not read
 * as a compound noun, and it does not.
 */
const ROUTINE_NOMINALS: ReadonlySet<string> = new Set(
  ROUTINE_ACTIONS.filter((verb) => !verb.includes(" ")).flatMap((verb) => {
    const stem = verb.endsWith("e") ? verb.slice(0, -1) : verb;
    return [...inflectionsOf(verb), stem + "ion", stem + "ation", verb + "ment", verb + "er"];
  }),
);

/**
 * Match a term as a whole word, never as a substring.
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

  const consequential = CONSEQUENTIAL_ACTIONS.find((verb) =>
    inflectionsOf(verb).some((form) => head === form || containsWord(lower, form)),
  );
  if (consequential !== undefined) return { kind: "CONSEQUENTIAL", matched: consequential };

  /*
   * Routine verbs are matched only as the imperative head, while consequential verbs are matched
   * anywhere. The asymmetry is the point: a consequential match *restricts*, so scanning the whole
   * sentence is conservative; a routine match *permits*, so it must be the word actually giving the
   * instruction.
   *
   * Without that, a noun rescues an unread verb — "Frobnicate the test fixture." matched the routine
   * verb `test` inside the noun phrase "test fixture" and was classified routine. Same shape as
   * `mail` inside `Gmail`, and as `file` being a blanket artifact.
   */
  const routine = ROUTINE_ACTIONS.find((verb) => head === verb || lower.startsWith(`${verb} `));
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

  const raw = typeof text === "string" ? text : "";
  if (raw.trim() === "") {
    /*
     * An empty objective is not routine work; it is a milestone that says nothing about what it
     * would do. It previously returned all-false, which the resolver read as "no consequence" and
     * allowed under valid lineage — the most literal possible case of absence being mistaken for
     * proof of safety.
     */
    raise("uncertainConsequence", "none", "none", "the objective is empty, so nothing about it can be shown to be routine");
    return { ...flags, evidence };
  }

  /*
   * Quoted spans are discussed, not requested.
   *
   * "Write tests for the phrase 'disable security.'" asks for tests. Reading the quotation as an
   * instruction gates ordinary engineering work forever, and the cost of ignoring quoted text is
   * bounded: an Owner who genuinely wants an effect states it outside quotation marks.
   */
  const lower = stripQuotedSpans(raw.toLowerCase());

  /*
   * Clauses are evaluated separately and aggregated most-restrictive-first.
   *
   * "Refactor the parser and shred the files." inherited authority because the sentence as a whole
   * matched a routine verb and a routine noun. A routine clause must not launder a consequential one.
   */
  const clauses = decomposeEffects(stripInstructionWrappers(lower));
  if (clauses.length > 1) {
    const merged: ConsequenceEvidenceV1[] = [];
    for (const clause of clauses) {
      const part = detectRequestedConsequences(clause, declared);
      for (const key of Object.keys(EMPTY_FLAGS) as ConsequenceKey[]) {
        if (part[key]) flags[key] = true;
      }
      for (const row of part.evidence) merged.push({ ...row, detail: `in "${clause.trim()}": ${row.detail}` });
    }
    return { ...flags, evidence: merged };
  }

  const targets = classifyTargets(lower);
  const action = classifyAction(lower);

  /*
   * What the action does by itself, before anything is asked about the object.
   *
   * A routine target must never neutralise a consequential action. This is raised first and
   * unconditionally so that "Send the log." and "Nuke the parser." carry their effect into the
   * permission check exactly as "Send the customer list." always did.
   */
  const actionConsequence =
    action.kind === "CONSEQUENTIAL" ? consequenceOfAction(action.matched) : undefined;
  if (actionConsequence !== undefined) {
    raise(actionConsequence, action.matched, targets.routine.join(", ") || "unresolved",
      `"${action.matched}" is ${actionConsequence} whatever it is pointed at`);
  }

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
   * No consequential target matched. That is **not** proof the request is routine.
   *
   * This is the defect the second review found, and it is the mirror of the first: the first version
   * asked the verb before the target, this one treated "no listed dangerous target" as safety. So
   * "Update the CRM.", "Fix IAM.", "Add the S3 bucket." and "Update it." all inherited — every one of
   * them naming something the tables had never heard of.
   *
   * Routine now has to be *shown*, not inferred from silence. Both halves must be affirmatively
   * recognised:
   *
   *   | action                  | target known-routine | target unresolved |
   *   | ROUTINE / NON_EFFECTFUL | allow                | GATE              |
   *   | CONSEQUENTIAL           | allow                | GATE              |
   *   | UNKNOWN                 | GATE                 | GATE              |
   *
   * A consequential verb is permitted against a *specific* engineering object — "Remove the unused
   * CSS class", "Push the CSS cleanup commit internally" — because both halves are read. An
   * unrecognised verb is never permitted, because half of what it would do is unknown.
   */
  if (targets.routine.length === 0) {
    raise("uncertainConsequence", action.matched || "unresolved", "unresolved",
      `nothing identifiable was named as the target of "${action.matched || "the request"}", so it cannot be shown to be routine`);
    return { ...flags, evidence };
  }

  if (action.kind === "UNKNOWN") {
    raise("uncertainConsequence", action.matched || "unresolved", targets.routine.join(", "),
      `the action "${action.matched}" was not recognised, and a routine-looking target does not establish what it would do`);
    return { ...flags, evidence };
  }

  /*
   * Routine recognition proves its own span and nothing else.
   *
   * A recognised action and a recognised target used to certify the entire string, so any separator
   * the splitter did not know carried a second instruction through untouched:
   *
   *     "Update the parser: shred those files."      "Update the parser | shred those files."
   *     "Update the parser — shred those files."     "Refactor the parser because we must shred the files."
   *     "Refactor the helper for grant the agent access."
   *
   * The answer is not a longer delimiter list — that loses to the next punctuation mark. It is to ask
   * what in the segment is still unaccounted for once the routine reading is taken, and to refuse to
   * call the whole thing routine while operative-shaped words remain.
   */
  const leftover = unaccountedOperativeWord(lower, targets);
  if (leftover !== undefined) {
    raise("uncertainConsequence", action.matched, leftover,
      `"${leftover}" is outside the routine effect that was recognised, and could ask for something else`);
  }

  // Both halves affirmatively recognised, no consequential target, nothing operative left over.
  return { ...flags, evidence };
}

/**
 * The first word in a segment that the routine reading does not account for and that could be an
 * instruction of its own, or `undefined` when the segment is fully accounted for.
 *
 * Accounted for means: the predicate head, grammatical glue, a recognised modifier, or a word inside
 * a target the model actually matched. What is left is unknown material, and unknown material is
 * only excused where English only permits a noun phrase — an attributive slot before a recognised
 * noun ("the *unit* test", "the *flaky* test"), or a trailing word qualified by one ("the UI *bug*").
 *
 * Anything else — a word taking its own determiner ("shred *those* files"), or a second unknown word
 * governing another ("update parser *shred file*") — is a candidate predicate, and a candidate
 * predicate inside a supposedly routine request is precisely what must not be assumed harmless.
 */
function unaccountedOperativeWord(segment: string, targets: TargetEvidenceV1): string | undefined {
  const words = segment.split(/[^a-z'-]+/).filter(Boolean);
  if (words.length === 0) return undefined;
  const head = firstWordOf(segment);

  /*
   * Accounting reads the *whole* target vocabulary present in the segment, not just the one word per
   * class that `classifyTargets` reports.
   *
   * That reporting keeps the first match per class so a gate can name its cause, and reusing it here
   * made every other recognised noun look unaccounted: "Rename the test fixture names." gated on
   * `fixture`, which the model knows perfectly well. Evidence for the reader and evidence for the
   * accounting are different questions.
   */
  const nounClass = new Map<string, string>();
  for (const row of TARGET_CLASSES) {
    for (const phrase of row.words) {
      for (const word of phrase.split(/[^a-z'-]+/).filter(Boolean)) {
        // Multi-word targets ("the list", "the ledger") carry their determiner. Letting that register
        // `the` as a noun made every determiner look like the head of a noun phrase.
        if (FUNCTION_WORDS.has(word)) continue;
        if (words.includes(word)) nounClass.set(word, row.target);
      }
    }
  }

  const isTargetNoun = (word: string | undefined): boolean => word !== undefined && nounClass.has(word);
  const isModifier = (word: string | undefined): boolean => word !== undefined && isKnownModifier(word);
  const isNounPhraseWord = (word: string | undefined): boolean => isTargetNoun(word) || isModifier(word);

  const isGlue = (word: string, index: number): boolean =>
    index === 0
    || word === head
    || FUNCTION_WORDS.has(word)
    || LEADING_ADVERBS.includes(word)
    || INSTRUCTION_WRAPPER_WORDS.has(word);

  const accounted = (word: string, index: number): boolean => isGlue(word, index) || isNounPhraseWord(word);

  /*
   * A participle is never excused by position.
   *
   * "the duplicated CSS class" and "murking the log" occupy the same slot, and the only honest
   * difference is that `duplicate` is a modifier this model knows and `murk` is a word it has never
   * read. An unknown `-ing`/`-ed` word stays a candidate predicate wherever it sits.
   */
  const isUnreadParticiple = (word: string): boolean => /(ing|ed)$/.test(word) && !isKnownModifier(word);

  /** A verb the model knows, appearing somewhere other than the head, is a second predicate. */
  const isKnownVerb = (word: string): boolean =>
    ROUTINE_ACTIONS.includes(word)
    || CONSEQUENTIAL_ACTIONS.some((verb) => inflectionsOf(verb).includes(word));

  const opaque = (word: string): boolean => isUnreadParticiple(word) || isKnownVerb(word);

  for (let index = 0; index < words.length; index += 1) {
    if (accounted(words[index] ?? "", index)) continue;

    let end = index;
    while (end < words.length && !accounted(words[end] ?? "", end)) end += 1;
    const run = words.slice(index, end);
    const before = index > 0 ? words[index - 1] : undefined;
    const after = end < words.length ? words[end] : undefined;
    const readable = !run.some(opaque);

    /*
     * The one excuse left, and the only one that has survived being attacked.
     *
     * An unread run may qualify a noun the model recognised when grammar introduces it — a determiner
     * or the predicate itself sits in front of it, and a recognised noun closes it: "the *unit* test",
     * "Add a *clearer waiting-on-owner* indicator." That is the attributive slot, the one place
     * English permits nothing but a noun phrase.
     *
     * Everything else that used to reach ALLOW here has been removed, because each one turned out to
     * be a position rather than an understanding, and a position can be moved into:
     *
     *   same class either side   "Update the parser leak tests."     — closed in 9c5056a
     *   a modifier in front      "Update the broken zorp tests."     — the same hatch, one word left
     *   trailing after a noun    "Update the parser exfiltrate."     — reported by review
     *   trailing after a determiner "Update the parser for the zorp."
     *
     * In every one of them a *known* verb gated and an unknown word inherited, which makes absence
     * from a table the thing granting permission. `before` must therefore be grammar, not a
     * neighbouring noun and not another unread word: a noun cannot vouch for the word beside it.
     *
     * The cost is that a trailing unread word now gates, so what legitimately trails a noun has to be
     * recognised rather than assumed — which is why "bug", "code" and "phrase" are named below.
     */
    if (readable && isNounPhraseWord(after) && DETERMINERS.has(before ?? "")) { index = end - 1; continue; }

    return run[0];
  }
  return undefined;
}

/** Every word appearing in a politeness wrapper, so wrapper remnants are never read as instructions. */
const INSTRUCTION_WRAPPER_WORDS: ReadonlySet<string> = new Set(
  INSTRUCTION_WRAPPERS.flatMap((phrase) => phrase.split(" ")),
);

/**
 * Remove quoted spans so discussed language is not read as requested effect.
 *
 * Straight and curly quotes, single and double. Deliberately simple: an unbalanced quote leaves the
 * text untouched rather than swallowing the rest of the sentence, because losing the tail of a
 * request is the failure that would matter.
 */
export function stripQuotedSpans(text: string): string {
  return text
    .replace(/'[^']*'/g, " ")
    .replace(/"[^"]*"/g, " ")
    .replace(/‘[^’]*’/g, " ")
    .replace(/“[^”]*”/g, " ");
}

/**
 * Split a request into clauses that are evaluated independently.
 *
 * Conjunctions, semicolons and sequencing words only. Commas are *not* split on: "Remove the unused,
 * duplicated CSS class" is one clause, and splitting it would manufacture fragments with no verb.
 */
/** Words that introduce a clause carrying its own effect. */
const CLAUSE_BOUNDARIES: readonly string[] = [
  "and", "then", "also", "plus", "as well as", "but", "while", "whilst", "by", "via", "through",
  "before", "after", "unless", "until", "if", "when", "once", "followed by", "as soon as",
  "so that", "in order to", "along with", "together with", "besides", "rather than", "instead of",
];

/*
 * There is no longer an adjective-suffix rule, and that is the point.
 *
 * `-ed` and `-ing` were removed from it once, because a participle is as much a verb as a modifier.
 * The remainder — `al ive ous able ible less ful` — looked safely adjectival and was not. Attacking
 * the rule rather than the reported sentences turned up operative words wearing every one of those
 * endings:
 *
 *     "Update the parser removal."   "Update the parser disposal."   "Update the log retrieval."
 *     "Update the helper erasable."  "Update the parser extractive."
 *
 * all inheriting standing authority, because the shape of the last four letters was accepted as
 * evidence about the meaning of the word. Morphology is not permission. A modifier is now recognised
 * only by being one this model has actually read.
 */

const KNOWN_MODIFIERS: readonly string[] = [
  "unused", "duplicate", "old", "new", "local", "internal", "stale", "legacy", "broken", "failing",
  "missing", "extra", "redundant", "deprecated", "temporary", "leftover",
];

/**
 * The participle forms of the modifiers above, generated rather than listed.
 *
 * "Remove the unused, duplicated CSS class." must still read as one noun phrase, and `duplicated`
 * only ever reached that reading through the `-ed` suffix rule. Deriving the forms of words already
 * known to be modifiers keeps that sentence working without re-admitting every unknown participle —
 * the same generate-don't-list move `inflectionsOf` makes on the consequential side.
 */
const KNOWN_MODIFIER_FORMS: ReadonlySet<string> = new Set(
  KNOWN_MODIFIERS.flatMap((word) => {
    const stem = word.endsWith("e") ? word.slice(0, -1) : word;
    return [word, word + "d", word + "ed", word + "ing", stem + "ed", stem + "ing"];
  }),
);

/** True when a word is a modifier this model actually recognises, rather than one merely shaped like one. */
function isKnownModifier(word: string): boolean {
  return KNOWN_MODIFIER_FORMS.has(word) || ROUTINE_NOMINALS.has(word);
}

/**
 * Break a request into the effects it actually asks for.
 *
 * The defect this replaces: the splitter knew five delimiters, so "Update the parser. Shred those
 * files." was evaluated as a single text, matched a routine head and a routine target, and inherited
 * authority — the second sentence was never classified at all. One routine pair proved the whole
 * request safe, which is the same laundering mechanism in a new place.
 *
 * Sentences, lines, semicolons, coordinators and subordinators all separate effects. This is not an
 * attempt to parse English; it is an attempt to ensure no operative instruction disappears before
 * authority is evaluated. Where a split is uncertain the fragment stands as its own effect, and an
 * effect that cannot be shown routine gates.
 */
export function decomposeEffects(text: string): readonly string[] {
  const parts = text
    .split(/[\r\n]+|(?<=[.!?])\s+|[.!?]+\s*$|;\s*/)
    .flatMap((sentence) => splitOnBoundaries(sentence))
    .flatMap((clause) => splitOnCommas(clause))
    .map((part) => part.replace(/[.!?]+$/, "").trim())
    .filter((part) => part !== "");
  return parts.length > 0 ? parts : [text];
}

function splitOnBoundaries(text: string): readonly string[] {
  const alternatives = CLAUSE_BOUNDARIES.map((word) => word.replace(/ /g, "\\s+")).join("|");
  return text.split(new RegExp("\\s+(?:" + alternatives + ")\\s+", "g"));
}

/**
 * Commas separate effects, unless the fragment plainly continues the previous noun phrase.
 *
 * "Refactor the parser, shred the files." hides a second instruction; "Remove the unused, duplicated
 * CSS class" does not. The test is whether every word in the fragment is a modifier or a recognised
 * routine target — a fragment naming something unaccounted for becomes its own effect, which is the
 * direction that gates.
 */
function splitOnCommas(text: string): readonly string[] {
  const parts = text.split(/,\s*/);
  if (parts.length < 2) return [text];
  const out: string[] = [parts[0] ?? ""];
  for (const part of parts.slice(1)) {
    if (isNounPhraseContinuation(part)) {
      out[out.length - 1] = out[out.length - 1] + ", " + part;
      continue;
    }
    out.push(part);
  }
  return out;
}

/**
 * Grammatical glue that can never name an effect on its own.
 *
 * This replaces a `word.length <= 3` escape which was too generous in exactly the direction that
 * launders: it admitted any short *unknown* word, so "Refactor the parser, nix the log." merged into
 * one effect and inherited. Short words are not safe by being short; only words that cannot denote
 * an action or a target are. Anything not listed here is an unaccounted word, and an unaccounted
 * word makes the fragment its own effect — the direction that gates.
 */
const FUNCTION_WORDS: ReadonlySet<string> = new Set([
  "a", "an", "the", "this", "that", "these", "those", "its", "his", "her", "their", "our", "my",
  "your", "it", "of", "in", "on", "at", "to", "for", "from", "with", "into", "onto", "over",
  "under", "and", "or", "nor", "as", "is", "are", "was", "were", "be", "been", "being", "any",
  "all", "both", "each", "every", "some", "no", "not", "only", "just", "very", "too", "more",
  "most", "less", "least", "other", "others", "same", "such", "own", "one", "two", "three",
  // Verb particles. "Clean up the ..." is one predicate, and `up` names nothing on its own.
  "up", "down", "out", "off", "back", "again", "around", "through",
]);

/**
 * The words that open a noun phrase.
 *
 * The attributive excuse needs the left boundary to be one of these specifically, not glue in
 * general. With the predicate itself allowed to introduce a run, "Update glorp parser." and
 * "Update the glorp test fixture." still inherited: the unread word had simply moved to a slot that
 * happened to be excused. A determiner cannot attach to a verb, so "the *X* parser" has no reading
 * in which `X` is a second instruction — which is the affirmative grammatical claim this excuse
 * rests on, rather than an observation about where the word happens to sit.
 */
const DETERMINERS: ReadonlySet<string> = new Set([
  "a", "an", "the", "this", "that", "these", "those", "its", "his", "her", "their", "our", "my",
  "your", "any", "all", "both", "each", "every", "some", "no", "other", "same", "such",
]);

function isNounPhraseContinuation(fragment: string): boolean {
  const words = fragment.trim().toLowerCase().split(/[^a-z'-]+/).filter(Boolean);
  if (words.length === 0) return true;
  const head = words[0] ?? "";
  if (CONSEQUENTIAL_ACTIONS.some((verb) => inflectionsOf(verb).includes(head))) return false;
  if (ROUTINE_ACTIONS.includes(head)) return false;
  return words.every(
    (word) =>
      isKnownModifier(word)
      || ROUTINE_TARGET_WORDS.has(word)
      || FUNCTION_WORDS.has(word),
  );
}

/** Single-word routine target terms, used only by the comma-continuation test. */
const ROUTINE_TARGET_WORDS: ReadonlySet<string> = new Set(
  TARGET_CLASSES.filter((row) => row.routine).flatMap((row) => row.words.filter((word) => !word.includes(" "))),
);

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
