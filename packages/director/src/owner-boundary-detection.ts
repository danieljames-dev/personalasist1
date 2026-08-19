/**
 * Read the dangerous parts of an Owner sentence before anything decides it is routine.
 *
 * This module exists because of a real failure. The first version of goal intake let the planner
 * choose a milestone's risk classes, and the planner's defaults were `riskClasses: []`,
 * `REPOSITORY_REVERSIBLE`, `spendCapUsd: 0`. An independent review then drove these through the
 * production path and every one came back as covered, automatic work:
 *
 *   "Enable OAuth for Gmail so I can read my mail."
 *   "Delete the production backups without asking."
 *   "Add a paid Claude provider and raise the spend ceiling."
 *   "Change Windows firewall security settings."
 *
 * Nothing lied. The milestone genuinely declared no risk — because the thing that filled in the risk
 * had no idea what the sentence said. Defaults erased the danger before authority ever looked.
 *
 * So boundaries are read from the Owner's own words, deterministically, and they only ever *raise*
 * consequence. There is no path here that lowers a risk class, and no phrasing that clears one:
 * "without asking", "no need to confirm" and "just do it" are not permissions, and a sentence that
 * contains them is more suspicious, not less.
 *
 * ## This is a detector, not a classifier of intent
 *
 * It answers "does this text touch a boundary the Owner must decide?" and errs toward yes. A false
 * positive costs one Owner decision on work that was safe. A false negative is how a chat box
 * deletes backups. Those are not comparable, and the asymmetry is deliberate throughout.
 */

import type { ExternalEffectClassV1, ReversibilityClassV1, RiskClassV1 } from "./roadmap-contracts.js";

/** A boundary that always requires a fresh Owner decision, whatever else is true. */
export interface OwnerBoundaryV1 {
  readonly boundary: string;
  readonly matched: string;
  readonly riskClasses: readonly RiskClassV1[];
  readonly externalEffectClass: ExternalEffectClassV1 | null;
  readonly reversibilityClass: ReversibilityClassV1 | null;
}

interface BoundaryRuleV1 {
  readonly boundary: string;
  readonly phrases: readonly string[];
  readonly riskClasses: readonly RiskClassV1[];
  readonly externalEffectClass?: ExternalEffectClassV1;
  readonly reversibilityClass?: ReversibilityClassV1;
}

/**
 * The boundaries, and the words that reach them.
 *
 * Phrases are matched as substrings of lowercased text. Blunt, and blunt is right: a regex clever
 * enough to avoid matching "backup" inside "backups" is also clever enough to miss "back-ups", and
 * the cost of the extra match is a question rather than a deletion.
 */
const RULES: readonly BoundaryRuleV1[] = [
  {
    boundary: "new OAuth or account consent",
    phrases: ["oauth", "o auth", "account consent", "sign in to my", "sign into my", "log in to my", "login to my", "connect my account", "link my account", "authorize access to my", "google account", "gmail", "outlook account", "connect gmail"],
    riskClasses: ["SECURITY_OR_PRIVACY", "SENSITIVE_DATA"],
    externalEffectClass: "IDEMPOTENT_EXTERNAL",
  },
  {
    boundary: "new or materially expanded credential access",
    phrases: ["credential", "password", "api key", "api token", "access token", "secret key", "private key", "client secret", ".env file", "keychain"],
    riskClasses: ["SECURITY_OR_PRIVACY", "SENSITIVE_DATA"],
  },
  {
    boundary: "destructive action on important data",
    phrases: ["delete", "erase", "wipe", "destroy", "drop the database", "drop table", "purge", "remove all", "format the", "rm -rf", "truncate"],
    riskClasses: ["SECURITY_OR_PRIVACY", "PERSISTENCE_OR_RECOVERY"],
    reversibilityClass: "IRREVERSIBLE",
  },
  {
    boundary: "backup destruction",
    phrases: ["backup", "back up", "back-up", "snapshot", "restore point", "shadow copy"],
    riskClasses: ["PERSISTENCE_OR_RECOVERY"],
    reversibilityClass: "IRREVERSIBLE",
  },
  {
    boundary: "production activation or change",
    phrases: ["production", "go live", "deploy to prod", "prod environment", "live site", "activate the writer", "production writer"],
    riskClasses: ["PRODUCTION_OR_EXTERNAL"],
    externalEffectClass: "IDEMPOTENT_EXTERNAL",
  },
  {
    boundary: "new paid resource or subscription",
    phrases: ["paid provider", "paid api", "paid plan", "subscription", "subscribe", "purchase", "buy ", "billing", "credit card", "rent compute", "gpu instance", "cloud provider"],
    riskClasses: ["MONEY"],
  },
  {
    boundary: "spend beyond the approved ceiling",
    phrases: ["spend", "budget", "raise the ceiling", "raise the spend", "increase the limit", "increase the budget", "cost cap", "pay for"],
    riskClasses: ["MONEY"],
  },
  {
    boundary: "sensitive or restricted data expansion",
    phrases: ["my email", "read my mail", "my messages", "my texts", "my calls", "call transcript", "my photos", "my bank", "financial records", "medical", "ssn", "social security", "tax return", "personal context", "my history", "browsing history"],
    riskClasses: ["SENSITIVE_DATA"],
  },
  {
    boundary: "new external publication, send or contact",
    phrases: ["publish", "post to", "send an email", "send email", "email them", "send it to", "contact them", "reach out to", "message them", "tweet", "post on", "share externally", "apply to", "submit an application", "announcement externally"],
    riskClasses: ["PRODUCTION_OR_EXTERNAL"],
    externalEffectClass: "IRREVERSIBLE_EXTERNAL",
    reversibilityClass: "IRREVERSIBLE",
  },
  {
    boundary: "major Windows or security configuration change",
    phrases: ["firewall", "windows security", "defender", "bitlocker", "secure boot", "registry", "group policy", "uac", "antivirus", "open a port", "port forward", "router setting"],
    riskClasses: ["SECURITY_OR_PRIVACY"],
  },
  {
    boundary: "job discovery or applications",
    phrases: ["job discovery", "job listing", "job board", "public listings", "apply for a job", "job application", "recruiter", "indeed", "linkedin"],
    riskClasses: ["PRODUCTION_OR_EXTERNAL", "SENSITIVE_DATA"],
    externalEffectClass: "IDEMPOTENT_EXTERNAL",
  },
  {
    boundary: "authority envelope expansion",
    phrases: ["authorize yourself", "self-authorize", "grant yourself", "widen the envelope", "expand the envelope", "raise the ceiling", "give yourself permission", "skip the gate", "bypass the gate", "without asking", "don't ask me", "stop asking"],
    riskClasses: ["AUTHORITY_OR_GOVERNANCE"],
  },
  {
    boundary: "external system of record",
    phrases: ["tekion", "informativ", "metricool", "salesforce", "hubspot", "quickbooks"],
    riskClasses: ["PRODUCTION_OR_EXTERNAL", "SENSITIVE_DATA"],
    externalEffectClass: "IDEMPOTENT_EXTERNAL",
  },
];

const RANK: Record<ReversibilityClassV1, number> = { REVERSIBLE: 0, PARTIALLY_REVERSIBLE: 1, IRREVERSIBLE: 2 };
const EFFECT_RANK: Record<ExternalEffectClassV1, number> = {
  NONE: 0,
  REPOSITORY_REVERSIBLE: 1,
  CONTROLLED_PUSH: 2,
  IDEMPOTENT_EXTERNAL: 3,
  IRREVERSIBLE_EXTERNAL: 4,
};

export interface BoundaryAssessmentV1 {
  /** Every boundary the text reaches. Empty means none were recognised — not that none exist. */
  readonly boundaries: readonly OwnerBoundaryV1[];
  readonly riskClasses: readonly RiskClassV1[];
  /** The most consequential effect class implied, or `null` when the text implies none. */
  readonly externalEffectClass: ExternalEffectClassV1 | null;
  readonly reversibilityClass: ReversibilityClassV1 | null;
  /** True when this text must not be executed under inherited authority. */
  readonly requiresFreshOwnerApproval: boolean;
}

/**
 * Assess one piece of Owner text for boundaries that need a fresh decision.
 *
 * Every rule that matches contributes; the assessment keeps the *highest* consequence found, never
 * an average and never the first match. A sentence that touches two boundaries is at least as
 * dangerous as either.
 */
export function assessOwnerBoundaries(text: string): BoundaryAssessmentV1 {
  const lower = typeof text === "string" ? text.toLowerCase() : "";
  const boundaries: OwnerBoundaryV1[] = [];
  const risks = new Set<RiskClassV1>();
  let effect: ExternalEffectClassV1 | null = null;
  let reversibility: ReversibilityClassV1 | null = null;

  for (const rule of RULES) {
    const matched = rule.phrases.find((phrase) => lower.includes(phrase));
    if (matched === undefined) continue;
    boundaries.push({
      boundary: rule.boundary,
      matched,
      riskClasses: rule.riskClasses,
      externalEffectClass: rule.externalEffectClass ?? null,
      reversibilityClass: rule.reversibilityClass ?? null,
    });
    for (const risk of rule.riskClasses) risks.add(risk);
    if (rule.externalEffectClass !== undefined) {
      if (effect === null || EFFECT_RANK[rule.externalEffectClass] > EFFECT_RANK[effect]) effect = rule.externalEffectClass;
    }
    if (rule.reversibilityClass !== undefined) {
      if (reversibility === null || RANK[rule.reversibilityClass] > RANK[reversibility]) reversibility = rule.reversibilityClass;
    }
  }

  return {
    boundaries,
    riskClasses: [...risks],
    externalEffectClass: effect,
    reversibilityClass: reversibility,
    requiresFreshOwnerApproval: boundaries.length > 0,
  };
}

/** A one-line reason naming what was found, for a gate the Owner has to read. */
export function describeBoundaries(assessment: BoundaryAssessmentV1): string {
  if (assessment.boundaries.length === 0) return "no always-gated boundary was recognised in the request";
  const named = assessment.boundaries.map((row) => `${row.boundary} ("${row.matched}")`);
  return `the request reaches ${named.length === 1 ? "a boundary" : "boundaries"} that always need an Owner decision: ${named.join("; ")}`;
}
