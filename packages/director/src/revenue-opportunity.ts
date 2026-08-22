/**
 * Revenue candidates, and the type that stops a guess from looking like a fact.
 *
 * The failure this module is designed against is specific and common: someone multiplies a made-up
 * price by a made-up demand, gets a large number, and that number then travels through every
 * downstream decision with its origins forgotten. So there is no way to put a bare number into a
 * candidate. `MoneyV1` and `QuantityV1` require an evidence state and a source, and a figure whose
 * state is `HYPOTHESIS` cannot be silently promoted by being copied into a summary.
 *
 * The second protection is `evidenceQuality`, which is deliberately *not* the same thing as
 * `confidence`. Confidence is how sure the estimate is; evidence quality is how much of it rests on
 * anything real. A candidate can be highly confident and evidentially empty — that is exactly what a
 * plausible story is — and the scorer needs to see both to refuse it.
 */

export const REVENUE_OPPORTUNITY_SCHEMA_V1 = "aion.director.revenueOpportunity.v1" as const;

/** The four states any figure may be in. Ordered strongest to weakest. */
export const FIGURE_STATES_V1 = ["KNOWN", "ESTIMATE", "HYPOTHESIS", "UNKNOWN"] as const;
export type FigureStateV1 = (typeof FIGURE_STATES_V1)[number];

/**
 * A number that has to say where it came from.
 *
 * `low` and `high` rather than a point value, because a single number implies a precision the
 * evidence rarely supports. When something really is known exactly, low and high are equal and the
 * state says `KNOWN`.
 */
export interface MoneyV1 {
  readonly low: number | null;
  readonly high: number | null;
  readonly currency: "USD";
  readonly state: FigureStateV1;
  /** Evidence id, research item id, or a sentence naming where this came from. Never empty. */
  readonly basis: string;
}

export interface QuantityV1 {
  readonly low: number | null;
  readonly high: number | null;
  readonly unit: string;
  readonly state: FigureStateV1;
  readonly basis: string;
}

/** Throws rather than storing a figure that cannot say where it came from. */
/*
 * The bounds contract, shared by both figure types.
 *
 * It lives in one function because it was written twice and the two copies disagreed: quantities
 * could be ESTIMATE with no value at all, which is exactly the bare number the type exists to make
 * unrepresentable. A rule enforced in one place cannot drift out of agreement with itself.
 */
function checkBounds(kind: string, low: number | null, high: number | null, state: FigureStateV1): void {
  /*
   * A missing bound is not a null bound, and both are absent.
   *
   * The checks compared against `null`, so a figure that simply had no `low` or `high` at all —
   * which is what arrives when a record is serialised and read back — passed as though both bounds
   * were present. `{ state: "KNOWN", basis: "because I said so" }` was a valid price. Requiring an
   * actual number closes the difference between "absent" and "explicitly nothing", and NaN with it.
   */
  const missing = (value: number | null) => typeof value !== "number" || Number.isNaN(value);
  if (!FIGURE_STATES_V1.includes(state)) throw new Error(`unknown figure state "${state}"`);
  if (state === "UNKNOWN") {
    if (low !== null || high !== null) throw new Error(`an UNKNOWN ${kind} must not carry a value`);
    return;
  }
  if (missing(low) || missing(high)) {
    throw new Error(`a ${state} ${kind} must carry both bounds; a half-open range hides which end is missing`);
  }
  if (low! > high!) throw new Error(`a ${kind} range must not run backwards`);
}

export function money(input: Omit<MoneyV1, "currency">): MoneyV1 {
  if (input.basis.trim() === "") throw new Error("a financial figure must name its basis");
  checkBounds("figure", input.low, input.high, input.state);
  return { ...input, currency: "USD" };
}

export function quantity(input: QuantityV1): QuantityV1 {
  if (input.basis.trim() === "") throw new Error("a quantity must name its basis");
  checkBounds("quantity", input.low, input.high, input.state);
  /* A copy, as `money` returns: a validator that hands back the caller's object validates a moment. */
  return { ...input };
}

/*
 * The honest default, built through the validators rather than beside them.
 *
 * Constructing the record directly would be shorter and would quietly create a second path into the
 * type — one that does not check the basis. There is one way to make a figure, and it always asks
 * where the figure came from.
 */
export function unknownMoney(basis: string): MoneyV1 {
  return money({ low: null, high: null, state: "UNKNOWN", basis });
}
export function unknownQuantity(unit: string, basis: string): QuantityV1 {
  return quantity({ low: null, high: null, unit, state: "UNKNOWN", basis });
}

/**
 * How much of a candidate rests on something real.
 *
 * `NONE` is a legitimate and, right now, the common answer. A candidate built entirely from
 * plausible reasoning has no market evidence, and saying so is the point.
 */
export const EVIDENCE_QUALITY_V1 = ["STRONG", "MODERATE", "WEAK", "NONE"] as const;
export type EvidenceQualityV1 = (typeof EVIDENCE_QUALITY_V1)[number];

export const EXPERIMENT_READINESS_V1 = [
  "READY_FOR_SHADOW_VALIDATION",
  "READY_FOR_SUPERVISED_OUTWARD_VALIDATION",
  "NEEDS_MORE_RESEARCH",
  "NEEDS_OWNER_INFORMATION",
  "BLOCKED_BY_CAPABILITY",
  "BLOCKED_BY_COMPLIANCE",
] as const;
export type ExperimentReadinessV1 = (typeof EXPERIMENT_READINESS_V1)[number];

export interface ValidationExperimentV1 {
  readonly title: string;
  /** The one uncertainty this actually tests. If it tests three things it tests none. */
  readonly testsUncertainty: string;
  /** What result would kill the candidate. A test that cannot fail is not a test. */
  readonly falsifiedBy: string;
  readonly outwardEffectRequired: boolean;
  readonly ownerTimeMinutes: number;
  readonly readiness: ExperimentReadinessV1;
}

export interface RevenueOpportunityV1 {
  readonly schema: typeof REVENUE_OPPORTUNITY_SCHEMA_V1;
  readonly opportunityId: string;
  readonly workspaceId: string;
  readonly objectiveId: string;
  readonly title: string;
  readonly revenueMechanism: string;
  readonly targetBuyerHypothesis: string;
  readonly serviceHypothesis: string;
  /** Counties this candidate is for. Validated against current authority, never assumed. */
  readonly geography: readonly string[];
  /** Business-evidence ids this rests on. Empty means it rests on reasoning alone. */
  readonly evidenceRefs: readonly string[];
  readonly demandEvidence: readonly string[];
  readonly deliveryCapabilityEvidence: readonly string[];
  readonly complianceConstraints: readonly string[];
  readonly estimatedPrice: MoneyV1;
  readonly estimatedDirectCost: MoneyV1;
  readonly estimatedGrossMarginPct: QuantityV1;
  readonly estimatedOwnerTime: QuantityV1;
  readonly estimatedWorkerHours: QuantityV1;
  readonly estimatedCapitalRequired: MoneyV1;
  readonly estimatedTimeToFirstRevenue: QuantityV1;
  readonly recurringPotential: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  readonly repeatability: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  readonly automationPotential: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  readonly reversibility: "REVERSIBLE" | "PARTIALLY_REVERSIBLE" | "IRREVERSIBLE";
  /** 0..1. How sure the estimate is, which is not how well evidenced it is. */
  readonly confidence: number;
  readonly evidenceQuality: EvidenceQualityV1;
  readonly criticalUnknowns: readonly string[];
  readonly nextValidationStep: ValidationExperimentV1;
  readonly readiness: ExperimentReadinessV1;
  readonly status: "CANDIDATE" | "DOWN_RANKED" | "REJECTED";
  readonly rejectionReason: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Every figure on a candidate, so a caller can check them all rather than the ones it remembered.
 *
 * Used by the test that asserts no bare number exists, and by the scorer, which needs to know how
 * much of a candidate is evidence and how much is narrative.
 */
/** Every figure on a candidate, each attached to the name that says what evidence could support it. */
export function namedFiguresOf(
  candidate: RevenueOpportunityV1,
): readonly { name: string; figure: MoneyV1 | QuantityV1 }[] {
  return [
    { name: "estimatedPrice", figure: candidate.estimatedPrice },
    { name: "estimatedDirectCost", figure: candidate.estimatedDirectCost },
    { name: "estimatedGrossMarginPct", figure: candidate.estimatedGrossMarginPct },
    { name: "estimatedOwnerTime", figure: candidate.estimatedOwnerTime },
    { name: "estimatedWorkerHours", figure: candidate.estimatedWorkerHours },
    { name: "estimatedCapitalRequired", figure: candidate.estimatedCapitalRequired },
    { name: "estimatedTimeToFirstRevenue", figure: candidate.estimatedTimeToFirstRevenue },
  ];
}

/**
 * Whether the candidate knows what anyone pays.
 *
 * This gate has been drawn too wide three times, and each time the same substitution walked through
 * it: first any of seven figures, then any money figure — which let an evidenced *wage* or an
 * evidenced *margin percentage* entitle a $900–$5000 price that was pure invention. A wage is a cost
 * and a margin is a ratio; neither is a price, and a revenue candidate is a claim about a price.
 * So the gate is the price, exactly, and nothing adjacent to it.
 */
/**
 * What a reference is evidence *of*.
 *
 * Knowing an id exists turned out not to be enough. A registration certificate and a service-area
 * record are real, store-known ids, and copying one into `demandEvidence` and into the price's basis
 * made an invented $900–$5000 look evidenced — absent payment evidence compensating for itself by
 * self-classification. A capability record cannot become demand evidence by being listed under a
 * different heading, so the kind travels with the reference and the gates ask for the kind they need.
 */
/*
 * `OPERATIONAL` was a bucket, and a bucket is a substitution waiting to happen.
 *
 * Owner minutes, caregiver hours and days-to-first-revenue are three different questions with three
 * different sources, and one `OPERATIONAL` id grounded all three — so a single Care.com page cited
 * three times would have evidenced how long the Owner spends, how many hours the work takes, and how
 * soon money arrives. Same shape as wage-grounds-price and listing-grounds-capital, one kind over.
 */
export type EvidenceKindV1 =
  | "CAPABILITY"
  | "DEMAND"
  | "PRICE"
  | "COST"
  | "CAPITAL"
  | "OWNER_TIME"
  | "WORKER_HOURS"
  | "TIME_TO_REVENUE";

/** Reference id to what it is evidence of. Anything absent is not evidence at all. */
export type KnownRefsV1 = ReadonlyMap<string, EvidenceKindV1>;

/**
 * References that exist, as opposed to references the candidate's author wrote down.
 *
 * `knownRefs` holds the ids the evidence and research stores actually contain. Passing it is what
 * makes a citation checkable: the previous version compared the price's basis against the candidate's
 * *own* `evidenceRefs`, so `basis: "bogus"` with `evidenceRefs: ["bogus"]` cited itself into being
 * evidenced. Self-consistency is not traceability — two invented fields agreeing prove nothing.
 *
 * The default is an empty set, so a caller who does not supply the store gets NONE rather than a
 * generous guess. Fail-closed is the only safe default for a function whose job is refusing.
 */
function citedRefs(
  candidate: RevenueOpportunityV1,
  knownRefs: KnownRefsV1,
  kinds?: readonly EvidenceKindV1[],
): readonly string[] {
  return [...candidate.evidenceRefs, ...candidate.demandEvidence]
    .map((ref) => ref.trim())
    .filter((ref) => {
      const kind = knownRefs.get(ref);
      if (kind === undefined) return false;
      return kinds === undefined || kinds.includes(kind);
    });
}

/**
 * Whether a figure rests on something other than its own label.
 *
 * The price was made to cite a reference and the other figures were not, so the same relabelling —
 * "ESTIMATE, basis: imagined" — went on earning full component credit for an invented one-day
 * time-to-revenue and an invented zero capital requirement. One rule for every figure: a state is a
 * claim, and a claim needs a source.
 */
export function isGroundedFigure(
  figure: { state: FigureStateV1; basis: string },
  candidate: RevenueOpportunityV1,
  knownRefs: KnownRefsV1,
  kinds: readonly EvidenceKindV1[],
): boolean {
  if (figure.state !== "KNOWN" && figure.state !== "ESTIMATE") return false;
  /*
   * The reference has to be evidence of *this* figure.
   *
   * Kind-checking the price and then grounding every other figure on "an id that exists" left the
   * substitution running one field over: a certificate cited in `estimatedCapitalRequired.basis`
   * grounded a $0 capital claim, and a caregiver-wage posting grounded a price. Token identity is
   * not evidence of the figure — a rate listing says nothing about capital, and a wage is not a
   * price. Each figure names the kinds that could actually support it.
   */
  /*
   * Every kind the figure needs, not any one of them.
   *
   * A gross margin is price divided by cost, so it needs both — and `some` let a single competitor
   * rate listing ground it. That listing was then counted twice: once for the price it really is
   * evidence of, and once for a margin it says nothing about. Four of seven figures "grounded" from
   * three sources is what tipped the share test and unlocked the STRONG multiplier. It is the same
   * double count already closed for demand references, and it belongs closed here too.
   */
  if (kinds.length === 0) return false;
  return kinds.every((kind) =>
    citedRefs(candidate, knownRefs, [kind]).some((ref) => basisCites(figure.basis, ref)));
}

/**
 * Which kinds of evidence could support each figure.
 *
 * Written out rather than inferred, because the mapping is a judgement and judgements belong where
 * they can be argued with. `CAPABILITY` appears nowhere: a registration certificate supports no
 * financial figure at all, which is the whole reason it kept being used to support them.
 */
export const FIGURE_EVIDENCE_KINDS_V1: Readonly<Record<string, readonly EvidenceKindV1[]>> = Object.freeze({
  estimatedPrice: ["PRICE"],
  estimatedDirectCost: ["COST"],
  /* Both, because a margin is one divided by the other. Neither alone is evidence of it. */
  estimatedGrossMarginPct: ["PRICE", "COST"],
  estimatedOwnerTime: ["OWNER_TIME"],
  estimatedWorkerHours: ["WORKER_HOURS"],
  /*
   * `CAPITAL`, not `COST`.
   *
   * A caregiver-wage posting is COST evidence and was therefore accepted as evidence that a plan
   * needs no money to start — the same substitution as the certificate, moved one kind over. What a
   * shift costs to run and what a business costs to begin are different questions with different
   * sources, and nothing AION currently holds answers the second one.
   */
  estimatedCapitalRequired: ["CAPITAL"],
  estimatedTimeToFirstRevenue: ["TIME_TO_REVENUE"],
});

/** Whether `basis` cites `ref` as a whole token rather than as an accidental substring. */
function basisCites(basis: string, ref: string): boolean {
  return basis.split(/[^A-Za-z0-9_-]+/u).includes(ref);
}

export function hasEvidencedPrice(
  candidate: RevenueOpportunityV1,
  knownRefs: KnownRefsV1 = new Map(),
): boolean {
  const price = candidate.estimatedPrice;
  if (price.state !== "KNOWN" && price.state !== "ESTIMATE") return false;
  /*
   * Whole-token matching, not `includes`.
   *
   * A substring test let a one-character ref like "e" match the word "imagined", so a basis could
   * cite a reference by containing one of its letters. The ref has to appear as its own token.
   */
  /* A price must cite PRICE evidence. A certificate is not a price, however real its id is. */
  return citedRefs(candidate, knownRefs, ["PRICE"]).some((ref) => basisCites(price.basis, ref));
}

/** The share of a candidate's figures that rest on evidence rather than on reasoning. */
export function evidencedFigureShare(
  candidate: RevenueOpportunityV1,
  knownRefs: KnownRefsV1 = new Map(),
): number {
  const figures = namedFiguresOf(candidate);
  const grounded = figures.filter((entry) => {
    const groundedFigure = isGroundedFigure(
      entry.figure, candidate, knownRefs, FIGURE_EVIDENCE_KINDS_V1[entry.name] ?? [],
    );
    return groundedFigure;
  });
  return figures.length === 0 ? 0 : grounded.length / figures.length;
}

/**
 * Whether a candidate is entitled to the evidence quality it claims.
 *
 * A candidate claiming `STRONG` with no evidence references is downgraded to `NONE`. Same principle
 * as the value-class downgrade in the scheduler: an adjective is not evidence, and the model should
 * make the claim collapse rather than trusting whoever wrote it.
 */
export function entitledEvidenceQuality(
  candidate: RevenueOpportunityV1,
  knownRefs: KnownRefsV1 = new Map(),
): {
  readonly quality: EvidenceQualityV1;
  readonly downgraded: boolean;
  readonly reason: string;
} {
  if (candidate.evidenceQuality === "NONE") {
    return { quality: "NONE", downgraded: false, reason: "as claimed" };
  }
  if (citedRefs(candidate, knownRefs).length === 0) {
    return {
      quality: "NONE",
      downgraded: true,
      reason: candidate.evidenceRefs.length + candidate.demandEvidence.length === 0
        ? `claimed ${candidate.evidenceQuality} with no evidence references; reasoning is not evidence`
        : `claimed ${candidate.evidenceQuality} citing references that do not exist in the evidence store`,
    };
  }
  /*
   * Capability evidence is not revenue evidence.
   *
   * A registration certificate and a service area prove the business *may* do the thing. They say
   * nothing whatever about whether anyone will pay for it, and a revenue candidate resting on them
   * alone is the exact substitution this module exists to prevent — it would let a candidate be
   * ranked on the strength of facts that are not about revenue. Every production candidate today
   * carries capability refs and no demand evidence, so this is the case that actually occurs.
   */
  /* Demand evidence must be evidence of demand, not a capability record filed under that heading. */
  if (candidate.demandEvidence.filter((ref) => knownRefs.get(ref.trim()) === "DEMAND").length === 0) {
    return {
      quality: "NONE",
      downgraded: true,
      reason: "only capability evidence; nothing here is evidence that anyone will pay for it",
    };
  }
  /*
   * Demand evidence alone does not entitle a revenue claim either.
   *
   * A reference is a string, and a string is cheap. Attaching one to a candidate whose every money
   * figure is a HYPOTHESIS was enough to unlock the full score, which put the invariant back in the
   * hands of whoever wrote the candidate. Demand evidence says somebody is interested; it says
   * nothing about the price at which they are interested. So the claimed quality is capped by what
   * the candidate's own numbers are actually grounded in: no evidenced figure, no ranking.
   */
  if (!hasEvidencedPrice(candidate, knownRefs)) {
    return {
      quality: "NONE",
      downgraded: true,
      reason: "demand evidence but no evidenced price; interest at an unknown price does not rank",
    };
  }
  /*
   * The quality is derived from what is cited, and the claim can only ever lower it.
   *
   * Passing the citation gate used to hand back the *claimed* adjective unchanged, so
   * `evidenceQuality: "STRONG"` on a $900–$5000 price that token-cites a real $28–$32 listing scored
   * with a 1.0 multiplier and beat the honest candidate citing the same listing as WEAK. The
   * citation proved a source existed; it never proved the numbers came from it. An adjective a
   * candidate awards itself cannot be the thing that decides ranking, so the label is now a ceiling
   * on a derived value rather than an input to it.
   */
  const derived = derivedEvidenceQuality(candidate, knownRefs);
  const quality = WEAKER_OF_V1[candidate.evidenceQuality][derived.quality];
  return {
    quality,
    downgraded: quality !== candidate.evidenceQuality,
    reason: quality === candidate.evidenceQuality
      ? `as claimed, and ${derived.reason}`
      : `claimed ${candidate.evidenceQuality}, but ${derived.reason}`,
  };
}

/** Whichever of two qualities is weaker. A claim may lower a derived quality; it may never raise it. */
const QUALITY_ORDER_V1: readonly EvidenceQualityV1[] = ["NONE", "WEAK", "MODERATE", "STRONG"];
const WEAKER_OF_V1: Readonly<Record<EvidenceQualityV1, Readonly<Record<EvidenceQualityV1, EvidenceQualityV1>>>> =
  Object.freeze(Object.fromEntries(QUALITY_ORDER_V1.map((left) => [
    left,
    Object.fromEntries(QUALITY_ORDER_V1.map((right) => [
      right,
      QUALITY_ORDER_V1[Math.min(QUALITY_ORDER_V1.indexOf(left), QUALITY_ORDER_V1.indexOf(right))]!,
    ])),
  ]))) as Readonly<Record<EvidenceQualityV1, Readonly<Record<EvidenceQualityV1, EvidenceQualityV1>>>>;

/**
 * What the citations actually support, ignoring what the candidate says about itself.
 *
 * Deliberately conservative and deliberately blunt: a price and one enquiry is WEAK, adding grounded
 * cost evidence makes it MODERATE, and STRONG needs more than one independent demand reference *and*
 * most of the candidate's figures grounded. Nothing AION currently holds reaches even WEAK, which is
 * the honest state of things rather than a defect in the scale.
 */
export function derivedEvidenceQuality(
  candidate: RevenueOpportunityV1,
  knownRefs: KnownRefsV1,
): { readonly quality: EvidenceQualityV1; readonly reason: string } {
  /*
   * Distinct sources, not mentions.
   *
   * `.length` counted `["an enquiry", "an enquiry"]` as two independent demand references, so
   * listing the same enquiry twice reached STRONG and a 1.0 multiplier. One source repeated is one
   * source.
   */
  const demand = new Set(
    candidate.demandEvidence.map((ref) => ref.trim()).filter((ref) => knownRefs.get(ref) === "DEMAND"),
  ).size;
  const groundedCost = isGroundedFigure(
    candidate.estimatedDirectCost, candidate, knownRefs, FIGURE_EVIDENCE_KINDS_V1["estimatedDirectCost"]!,
  );
  const share = evidencedFigureShare(candidate, knownRefs);

  /*
   * Fail-closed on its own terms.
   *
   * The earlier version leaned on `entitledEvidenceQuality` having checked price and demand first
   * and returned WEAK or MODERATE without testing either — so its reasons asserted "an evidenced
   * price and some demand" whether or not there was any. A function that is the authority on
   * quality has to be able to answer alone, because sooner or later something will call it alone.
   */
  const price = hasEvidencedPrice(candidate, knownRefs);
  if (!price || demand === 0) {
    return {
      quality: "NONE",
      reason: !price && demand === 0
        ? "neither an evidenced price nor any demand evidence"
        : (price ? "an evidenced price but no demand evidence" : "demand evidence but no evidenced price"),
    };
  }
  if (demand >= 2 && groundedCost && share >= 0.5) {
    return {
      quality: "STRONG",
      reason: `${demand} independent demand sources, grounded cost, and ${Math.round(share * 100)}% of figures grounded`,
    };
  }
  if (groundedCost) {
    return {
      quality: "MODERATE",
      reason: demand >= 2
        ? `an evidenced price and cost with ${demand} demand sources, but only ${Math.round(share * 100)}% of figures grounded`
        : "an evidenced price and an evidenced cost, but demand seen from only one source",
    };
  }
  return { quality: "WEAK", reason: "an evidenced price and some demand, but nothing evidencing what it costs" };
}
