/**
 * What would this actually *do*? — asked structurally, so paraphrase does not defeat it.
 *
 * The previous safety boundary was a list of phrases. An independent review took a fixture with
 * perfectly valid lineage and a valid active envelope and walked 18 of 31 high-consequence requests
 * straight through it:
 *
 *   "Send this to the customer."          "Push this announcement live."
 *   "Give AION access to my inbox."       "Turn on the paid model."
 *   "Relax the security policy."          "Treat these as pre-approved."
 *
 * None of those contained a listed phrase. A phrase list cannot be a security boundary, because the
 * space of ways to say "email the customer" is unbounded and the list is not.
 *
 * ## The model
 *
 * Consequence is read as **action × target**, not as vocabulary:
 *
 *   - an ACTION family (send, publish, destroy, connect, spend, weaken-security, expand-authority)
 *   - a TARGET class (external party, the public, important data, an account, money, a security
 *     control, a code artifact, an internal technical object)
 *
 * "Remove the unused CSS class" and "Remove the production archives" share a verb and are not the
 * same request. The target decides. That is what generalises past wording.
 *
 * ## Uncertainty is a consequence
 *
 * The rule that makes this safe is not the coverage of the tables below — it is the fallback. A
 * consequential action whose target cannot be resolved sets `uncertainConsequence`, which gates.
 * "Send it." is not routine because nothing matched; it is unresolved, and unresolved means ask.
 *
 * So a gap in these tables costs an unnecessary Owner decision. A gap in a phrase list cost an
 * unauthorized action. Those are the two failure modes available, and this file is arranged so the
 * cheap one is the one that happens.
 *
 * Nothing here lowers a consequence. Every layer may only add.
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
  /** A consequential action was recognised but its target was not. Gates. */
  readonly uncertainConsequence: boolean;
  readonly evidence: readonly ConsequenceEvidenceV1[];
}

/* -------------------------------------------------------------------------- */
/* Targets                                                                     */
/* -------------------------------------------------------------------------- */

const TARGETS: readonly (readonly [string, readonly string[]])[] = [
  ["external party", ["customer", "client", "lead", "prospect", "subscriber", "recipient", "recruiter", "everyone", "the list", "mailing list", "contacts", "the team at", "them", "him", "her", "buyer", "seller", "applicant", "candidate", "vendor", "supplier"]],
  ["the public", ["publicly", "public", "online", "live", "the internet", "social", "website", "web site", "blog", "twitter", "linkedin", "facebook", "instagram", "press", "announcement"]],
  ["important data", ["backup", "back up", "back-up", "snapshot", "restore file", "restore point", "recovery cop", "recovery file", "archive", "database", "production data", "records", "history", "shadow copy", "the store", "audit log", "ledger", "handoff", "certification"]],
  ["an account", ["inbox", "mailbox", "my mail", "my email", "email account", "gmail", "google", "outlook", "office 365", "portal", "my account", "account", "login", "log-in", "sign-in", "credential", "password", "api key", "token", "oauth", "calendar", "drive"]],
  ["money", ["money", "cost", "costs", "budget", "paid", "pay", "billing", "invoice", "subscription", "api access", "credit", "spend", "price", "plan", "ceiling", "limit", "quota"]],
  ["a security control", ["firewall", "security", "protection", "defender", "antivirus", "bitlocker", "secure boot", "uac", "policy", "permission", "port", "encryption", "guard", "safeguard", "control"]],
  ["production", ["production", "prod", "live site", "live environment", "the writer", "customer-facing"]],
  ["sensitive personal data", ["my messages", "my texts", "my calls", "call transcript", "my photos", "my bank", "financial record", "medical", "ssn", "social security", "tax return", "personal context", "browsing history", "my documents"]],
  ["a code artifact", ["class", "function", "method", "variable", "import", "test", "spec", "component", "module", "file", "helper", "comment", "type", "interface", "css", "style", "lint", "dead code", "unused", "duplicate", "stub", "todo", "warning", "field on", "column in the schema"]],
  ["an internal technical object", ["port", "endpoint", "queue", "adapter", "handler", "route", "api call", "request", "payload", "socket", "buffer", "cache", "the panel", "the page", "the button", "the indicator", "the ui", "the view"]],
];

function targetsIn(text: string): readonly string[] {
  const found: string[] = [];
  for (const [name, words] of TARGETS) {
    if (words.some((word) => text.includes(word))) found.push(name);
  }
  return found;
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                     */
/* -------------------------------------------------------------------------- */

interface ActionFamilyV1 {
  readonly action: string;
  readonly patterns: readonly string[];
  /** Targets that make this action consequential, mapped to the consequence it implies. */
  readonly consequential: readonly (readonly [string, keyof RequestedConsequenceV1])[];
  /** Targets that make this action routine. Presence of one of these clears the uncertainty. */
  readonly benign: readonly string[];
  /** Consequences that hold regardless of target, because the action itself is the boundary. */
  readonly unconditional?: readonly (keyof RequestedConsequenceV1)[];
}

const ACTIONS: readonly ActionFamilyV1[] = [
  {
    action: "send",
    patterns: ["send", "email", "e-mail", "mail ", "message", "text ", "dm ", "forward", "notify", "reply to", "respond to", "share this with", "share it with", "share with", "deliver", "contact", "reach out", "follow up with", "cc ", "bcc "],
    consequential: [
      ["external party", "externalSend"],
      ["the public", "externalPublish"],
      ["sensitive personal data", "sensitiveDataExpansion"],
    ],
    benign: ["an internal technical object", "a code artifact"],
  },
  {
    action: "publish",
    patterns: ["publish", "post ", "post the", "post this", "announce", "broadcast", "tweet", "go live", "put this online", "put it online", "put the announcement online", "push it live", "push this live", "push the announcement live", "make it public", "make this public", "release publicly", "upload to"],
    consequential: [["the public", "externalPublish"], ["external party", "externalSend"]],
    benign: ["an internal technical object", "a code artifact"],
    // Publishing is outward-facing by definition; only an explicitly internal target rescues it.
    unconditional: ["externalPublish"],
  },
  {
    action: "destroy",
    patterns: ["delete", "remove", "clear out", "clear the", "clean up", "clean out", "clean this up", "clean that up", "clean it up", "clean them up", "tidy up", "get rid of", "purge", "wipe", "erase", "destroy", "drop the", "discard", "prune", "throw away", "trash", "nuke", "reset the"],
    consequential: [
      ["important data", "destructiveImportantData"],
      ["production", "destructiveImportantData"],
      ["sensitive personal data", "destructiveImportantData"],
    ],
    benign: ["a code artifact", "an internal technical object"],
  },
  {
    action: "connect an account",
    patterns: ["connect", "hook up", "hook this up", "link my", "sign in", "sign into", "log in", "log into", "authenticate", "authorize access", "give aion access", "give access", "grant access", "use my login", "integrate with", "oauth"],
    consequential: [
      ["an account", "accountAccess"],
      ["sensitive personal data", "sensitiveDataExpansion"],
    ],
    benign: ["an internal technical object", "a code artifact"],
  },
  {
    action: "spend",
    patterns: ["buy", "purchase", "pay for", "pay ", "subscribe", "spend", "costs money", "cost money", "even if it costs", "paid model", "paid provider", "paid plan", "paid api", "raise the budget", "increase the budget", "raise the ceiling", "raise the limit", "increase the limit", "turn on the paid", "enable the paid", "upgrade to"],
    consequential: [["money", "paidResource"]],
    benign: [],
    unconditional: ["paidResource", "newFinancialObligation"],
  },
  {
    action: "weaken a security control",
    patterns: ["disable", "turn off", "loosen", "relax", "weaken", "bypass", "open up", "open whatever", "allow through", "make an exception", "lower the", "soften", "unblock"],
    consequential: [
      ["a security control", "securityConfigurationChange"],
      ["production", "productionMutation"],
    ],
    benign: ["a code artifact", "an internal technical object"],
  },
  {
    action: "expand authority",
    patterns: ["without checking with me", "without asking", "without confirming", "don't ask me", "do not ask me", "stop asking", "no need to ask", "from now on", "going forward", "pre-approved", "preapproved", "pre approved", "automatically from", "make this automatic", "make these automatic", "give yourself permission", "authorize yourself", "self-authorize", "skip the gate", "skip approval", "skip future approval", "no approval needed", "just handle these", "handle these", "treat these as", "this kind of thing", "these kinds of", "this category"],
    consequential: [],
    benign: [],
    unconditional: ["authorityExpansion"],
  },
  {
    action: "change production",
    patterns: ["deploy", "activate", "go to prod", "promote to", "release to", "cut over", "switch production"],
    consequential: [["production", "productionMutation"]],
    benign: ["a code artifact", "an internal technical object"],
  },
  {
    action: "read sensitive data",
    patterns: ["read my", "look at my", "go through my", "scan my", "search my", "index my", "access my"],
    consequential: [
      ["sensitive personal data", "sensitiveDataExpansion"],
      ["an account", "accountAccess"],
    ],
    benign: ["a code artifact", "an internal technical object"],
  },
];

/* -------------------------------------------------------------------------- */
/* Detection                                                                   */
/* -------------------------------------------------------------------------- */

const EMPTY: RequestedConsequenceV1 = {
  externalSend: false,
  externalPublish: false,
  externalContact: false,
  destructiveImportantData: false,
  credentialAccess: false,
  accountAccess: false,
  oauthConsent: false,
  sensitiveDataExpansion: false,
  paidResource: false,
  spendIncrease: false,
  newFinancialObligation: false,
  productionMutation: false,
  securityConfigurationChange: false,
  irreversibleExternalEffect: false,
  authorityExpansion: false,
  uncertainConsequence: false,
  evidence: [],
};

/**
 * Read the consequences a request would have.
 *
 * Layer 1 is lexical and contributes evidence; it is not the boundary. The boundary is the
 * combination rule and the uncertainty fallback below it.
 */
export function detectRequestedConsequences(text: string): RequestedConsequenceV1 {
  const lower = typeof text === "string" ? text.toLowerCase() : "";
  if (lower.trim() === "") return EMPTY;

  const found = new Set<keyof RequestedConsequenceV1>();
  const evidence: ConsequenceEvidenceV1[] = [];
  const targets = targetsIn(lower);
  let uncertain = false;

  for (const family of ACTIONS) {
    const matched = family.patterns.find((pattern) => lower.includes(pattern));
    if (matched === undefined) continue;

    const benignTarget = family.benign.find((name) => targets.includes(name));
    const consequential = family.consequential.filter(([name]) => targets.includes(name));

    for (const [name, consequence] of consequential) {
      found.add(consequence);
      evidence.push({ consequence, action: family.action, target: name, detail: `"${matched}" applied to ${name}` });
    }

    for (const consequence of family.unconditional ?? []) {
      // An unconditional consequence is cleared only by an explicitly internal target — "post to the
      // endpoint" is an HTTP call, "post this publicly" is not.
      if (benignTarget !== undefined && consequential.length === 0) continue;
      found.add(consequence);
      evidence.push({ consequence, action: family.action, target: benignTarget ?? "any", detail: `"${matched}" is outward-facing by itself` });
    }

    /*
     * The rule that makes a gap in these tables cheap.
     *
     * A consequential action with no resolvable target is not routine — it is unread. "Send it." and
     * "Clean that up." are both perfectly ordinary sentences and neither can be classified without
     * knowing what "it" is, so they gate rather than proceed.
     */
    if (consequential.length === 0 && benignTarget === undefined && (family.unconditional ?? []).length === 0) {
      uncertain = true;
      evidence.push({
        consequence: "uncertainConsequence",
        action: family.action,
        target: "unresolved",
        detail: `"${matched}" was requested but its target could not be determined`,
      });
    }
  }

  // Second-order implications, applied after the primary pass so they cannot be missed by ordering.
  if (found.has("accountAccess")) {
    found.add("oauthConsent");
    found.add("credentialAccess");
  }
  if (found.has("paidResource")) found.add("spendIncrease");
  if (found.has("externalPublish") || found.has("externalSend")) {
    found.add("externalContact");
    found.add("irreversibleExternalEffect");
  }
  // Deliberately *not* implied by destruction. Deleting a local backup is irreversible and is not an
  // external effect, and conflating them meant an envelope that explicitly granted destructive action
  // still could not exercise it — which would make the permission field decorative in the other
  // direction. Destruction has its own permission; it does not need to borrow this one.

  return {
    externalSend: found.has("externalSend"),
    externalPublish: found.has("externalPublish"),
    externalContact: found.has("externalContact"),
    destructiveImportantData: found.has("destructiveImportantData"),
    credentialAccess: found.has("credentialAccess"),
    accountAccess: found.has("accountAccess"),
    oauthConsent: found.has("oauthConsent"),
    sensitiveDataExpansion: found.has("sensitiveDataExpansion"),
    paidResource: found.has("paidResource"),
    spendIncrease: found.has("spendIncrease"),
    newFinancialObligation: found.has("newFinancialObligation"),
    productionMutation: found.has("productionMutation"),
    securityConfigurationChange: found.has("securityConfigurationChange"),
    irreversibleExternalEffect: found.has("irreversibleExternalEffect"),
    authorityExpansion: found.has("authorityExpansion"),
    uncertainConsequence: uncertain,
    evidence,
  };
}

/** True when anything at all was detected. */
export function hasAnyConsequence(consequences: RequestedConsequenceV1): boolean {
  return (
    consequences.externalSend || consequences.externalPublish || consequences.externalContact
    || consequences.destructiveImportantData || consequences.credentialAccess || consequences.accountAccess
    || consequences.oauthConsent || consequences.sensitiveDataExpansion || consequences.paidResource
    || consequences.spendIncrease || consequences.newFinancialObligation || consequences.productionMutation
    || consequences.securityConfigurationChange || consequences.irreversibleExternalEffect
    || consequences.authorityExpansion || consequences.uncertainConsequence
  );
}

/** The permission an envelope must carry for each consequence, or `null` where none ever suffices. */
export interface ConsequencePermissionV1 {
  readonly consequence: keyof RequestedConsequenceV1;
  /** Envelope field that must be `YES`, a positive spend ceiling, or an allowed effect class. */
  readonly requires: "destructive" | "oauth" | "security" | "production" | "sensitive" | "spend" | "irreversibleExternal" | "never";
}

/**
 * Consequence → the permission that could cover it.
 *
 * `never` means no envelope covers it at any setting. Authority expansion is on that list because an
 * envelope granting its own widening is the one thing that would make every other entry decorative;
 * uncertainty is there because "we could not tell" is not a permission anyone can grant in advance.
 */
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
    const key = `${row.consequence}:${row.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(`${row.consequence} (${row.detail})`);
  }
  return parts.join("; ");
}
