/**
 * Unit economics for a visit-based service, and why the schedule can matter more than the rate.
 *
 * The thing worth getting right here is not the arithmetic. It is that **five scattered one-hour
 * visits and one five-hour block are different businesses at the same headline rate.** A caregiver
 * paid for travel between five houses, or unpaid for it and therefore unlikely to stay, produces a
 * contribution margin that has almost nothing to do with the hourly price on the website. An
 * operator that ranks candidates on price alone will pick the wrong one confidently.
 *
 * Everything is a range. A point value implies a precision the evidence does not support, and this
 * business currently has **no** wage data, **no** competitor pricing and **no** utilisation history —
 * so most inputs arrive `UNKNOWN` and the outputs say so rather than defaulting to a plausible
 * number. `computeUnitEconomics` returns `null` margins when an input it needs is missing. That is
 * the honest answer and it is what stops a table full of zeros reading as a table full of results.
 */

import { type FigureStateV1, type MoneyV1, type QuantityV1 } from "./revenue-opportunity.js";

export const UNIT_ECONOMICS_SCHEMA_V1 = "aion.director.unitEconomics.v1" as const;

export interface ScheduleShapeV1 {
  /** How the same weekly hours are distributed. This is the variable that surprises people. */
  readonly label: string;
  readonly visitsPerWeek: number;
  readonly hoursPerVisit: number;
  /** Unpaid or paid travel minutes per visit, one way counted once per visit. */
  readonly travelMinutesPerVisit: number;
  /** Whether the employer pays for that travel. Under a W-2 model this is usually yes. */
  readonly travelPaid: boolean;
  /** Minutes of scheduling and admin attributable to each visit. */
  readonly adminMinutesPerVisit: number;
}

export interface EconomicsInputsV1 {
  readonly billRatePerHour: MoneyV1;
  readonly wagePerHour: MoneyV1;
  /**
   * Payroll tax, insurance and other burden as a **percentage** of wage: `18` means 18%.
   *
   * The doc comment used to say "fraction", which is what a caller reads, while the arithmetic
   * divides by 100. A caller who followed the contract would have passed `0.18` and produced a
   * burden of two-hundredths of a percent — flattering labour cost, contribution, margin and
   * break-even at once, silently and in the same direction.
   */
  readonly payrollBurdenPct: QuantityV1;
  /** Scheduled visits lost to cancellation, as a **percentage**: `5` means 5%. */
  readonly cancellationRatePct: QuantityV1;
  readonly schedule: ScheduleShapeV1;
}

export interface RangeV1 {
  readonly low: number | null;
  readonly high: number | null;
  readonly state: FigureStateV1;
  readonly basis: string;
}

export interface UnitEconomicsV1 {
  readonly schema: typeof UNIT_ECONOMICS_SCHEMA_V1;
  readonly scheduleLabel: string;
  readonly billableHoursPerWeek: number;
  /** Hours the employer pays for, including travel when paid. The number that decides margin. */
  readonly paidHoursPerWeek: RangeV1;
  readonly caregiverUtilisationPct: RangeV1;
  readonly revenuePerWeek: RangeV1;
  readonly labourCostPerWeek: RangeV1;
  readonly contributionPerBillableHour: RangeV1;
  readonly contributionPerVisit: RangeV1;
  readonly grossMarginPct: RangeV1;
  /** Utilisation at which contribution reaches zero, where it can be computed. */
  readonly breakEvenUtilisationPct: RangeV1;
  /** Inputs that were missing, named. An empty list is what a complete model looks like. */
  readonly missingInputs: readonly string[];
  readonly note: string;
}

/** The weakest state among the inputs a figure depends on: an output is never surer than its worst input. */
function weakest(states: readonly FigureStateV1[]): FigureStateV1 {
  const order: FigureStateV1[] = ["KNOWN", "ESTIMATE", "HYPOTHESIS", "UNKNOWN"];
  return order[Math.max(...states.map((state) => order.indexOf(state)))]!;
}

function unknownRange(basis: string): RangeV1 {
  return { low: null, high: null, state: "UNKNOWN", basis };
}

/**
 * Compute what can be computed, and say what could not.
 *
 * Ranges combine worst-with-worst and best-with-best, which widens the output rather than
 * narrowing it. That is deliberate: an interval arithmetic that flattered the result would defeat
 * the purpose of using intervals.
 */
export function computeUnitEconomics(inputs: EconomicsInputsV1): UnitEconomicsV1 {
  const { schedule } = inputs;
  const missing: string[] = [];

  const billableHoursPerWeek = schedule.visitsPerWeek * schedule.hoursPerVisit;
  const overheadHoursPerVisit =
    (schedule.travelPaid ? schedule.travelMinutesPerVisit : 0) / 60 + schedule.adminMinutesPerVisit / 60;
  const paidHours = billableHoursPerWeek + schedule.visitsPerWeek * overheadHoursPerVisit;

  const utilisation = paidHours === 0 ? 0 : (billableHoursPerWeek / paidHours) * 100;

  /*
   * Paid hours are HYPOTHESIS, not ESTIMATE.
   *
   * They were labelled ESTIMATE beside a note reading "Nothing was assumed", which was simply false:
   * every one of them is computed from travel and admin minutes nobody has measured. The arithmetic
   * is sound; the inputs are assumed, and the state has to say which.
   */
  const scheduleBasis = `derived from the schedule shape, assuming ${assumptionsFor([schedule]).join("; ")}`;

  const rate = inputs.billRatePerHour;
  const wage = inputs.wagePerHour;
  const burden = inputs.payrollBurdenPct;

  /* `=== null` treated an absent bound as present, the same confusion `checkBounds` had. */
  const absent = (value: number | null | undefined) => typeof value !== "number" || Number.isNaN(value);
  if (rate.state === "UNKNOWN" || absent(rate.low)) missing.push("bill rate per hour");
  if (wage.state === "UNKNOWN" || absent(wage.low)) missing.push("caregiver wage per hour");
  if (burden.state === "UNKNOWN" || absent(burden.low)) missing.push("payroll burden percentage");
  /*
   * The percentage contract is enforced, not merely documented.
   *
   * A doc comment is what a caller reads and nothing checks; the unit is on the figure already and
   * was never looked at. Reading it turns "this is a percentage" from a note into a rule, which is
   * the difference between a contract and a hope.
   */
  for (const [name, figure] of [
    ["payroll burden", inputs.payrollBurdenPct],
    ["cancellation rate", inputs.cancellationRatePct],
  ] as const) {
    if (figure.state !== "UNKNOWN" && !/^(%|percent)$/iu.test(figure.unit.trim())) {
      throw new Error(`${name} must be a percentage — got unit "${figure.unit}"; 18 means 18%, not 0.18`);
    }
  }

  const cancel = inputs.cancellationRatePct;
  if (cancel.state === "UNKNOWN" || absent(cancel.low) || absent(cancel.high)) missing.push("cancellation rate");

  const canCompute = missing.length === 0
    && ![rate.low, rate.high, wage.low, wage.high, burden.low, burden.high, cancel.low, cancel.high]
      .some((bound) => absent(bound));

  const derivedState = weakest([
    rate.state, wage.state, burden.state, inputs.cancellationRatePct.state,
  ]);

  /*
   * Anything computed from paid hours inherits the schedule's HYPOTHESIS.
   *
   * `derivedState` covers the money inputs and stops there, so with KNOWN rates the contribution came
   * out KNOWN while still resting on 25 assumed travel minutes and 6 assumed admin minutes. That is a
   * hypothesis wearing a fact's label, and it is the exact failure `weakest` was written to prevent —
   * the rule was right and the call site simply left out the worst input. Revenue is exempt: it is
   * billable hours times a rate, and billable hours are exact.
   */
  const paidHoursState: FigureStateV1 = "HYPOTHESIS";
  const overheadDerivedState = weakest([derivedState, paidHoursState]);

  if (!canCompute) {
    const basis = `cannot compute: missing ${missing.join(", ")}`;
    return {
      schema: UNIT_ECONOMICS_SCHEMA_V1,
      scheduleLabel: schedule.label,
      billableHoursPerWeek,
      paidHoursPerWeek: { low: paidHours, high: paidHours, state: "HYPOTHESIS", basis: scheduleBasis },
      caregiverUtilisationPct: { low: utilisation, high: utilisation, state: "HYPOTHESIS", basis: scheduleBasis },
      revenuePerWeek: unknownRange(basis),
      labourCostPerWeek: unknownRange(basis),
      contributionPerBillableHour: unknownRange(basis),
      contributionPerVisit: unknownRange(basis),
      grossMarginPct: unknownRange(basis),
      breakEvenUtilisationPct: unknownRange(basis),
      missingInputs: missing,
      note: "Schedule structure is computable without market data; money is not."
        + ` These hours are not assumption-free: ${assumptionsFor([schedule]).join("; ")}.`,
    };
  }

  /*
   * Cancellations reduce revenue and do not reduce paid hours.
   *
   * This was previously demanded as an input and then never read, which computed every figure as
   * though cancellation were zero — a hidden default wearing a required field's clothes. Whether a
   * caregiver is paid for a cancelled visit is UNKNOWN, so the pessimistic reading is taken: the
   * hour is lost from revenue and kept in cost.
   */
  const cancelLow = cancel.low!;
  const cancelHigh = cancel.high!;
  const revenueLow = billableHoursPerWeek * rate.low! * (1 - cancelHigh / 100);
  const revenueHigh = billableHoursPerWeek * rate.high! * (1 - cancelLow / 100);
  const costLow = paidHours * wage.low! * (1 + burden.low! / 100);
  const costHigh = paidHours * wage.high! * (1 + burden.high! / 100);

  /* Worst case pairs low revenue with high cost. Flattering it would defeat the point of a range. */
  const contribLow = revenueLow - costHigh;
  const contribHigh = revenueHigh - costLow;
  const basis = `derived from ${derivedState.toLowerCase()} inputs over the "${schedule.label}" schedule`;

  /*
   * A downgraded state needs a basis that says why it was downgraded.
   *
   * Correcting the state alone left these figures reading HYPOTHESIS beside "derived from known
   * inputs" — a number whose written reason names only the inputs that were solid and omits the
   * assumption that made it a hypothesis. The state and the basis have to tell the same story, or
   * the basis is worse than none: it explains the figure away.
   */
  const overheadBasis = `${basis}, whose paid hours assume ${assumptionsFor([schedule]).join("; ")}`;

  return {
    schema: UNIT_ECONOMICS_SCHEMA_V1,
    scheduleLabel: schedule.label,
    billableHoursPerWeek,
    paidHoursPerWeek: { low: paidHours, high: paidHours, state: "HYPOTHESIS", basis: scheduleBasis },
    caregiverUtilisationPct: { low: utilisation, high: utilisation, state: "HYPOTHESIS", basis: scheduleBasis },
    revenuePerWeek: { low: revenueLow, high: revenueHigh, state: derivedState, basis },
    labourCostPerWeek: { low: costLow, high: costHigh, state: overheadDerivedState, basis: overheadBasis },
    contributionPerBillableHour: {
      low: contribLow / billableHoursPerWeek,
      high: contribHigh / billableHoursPerWeek,
      state: overheadDerivedState,
      basis: overheadBasis,
    },
    contributionPerVisit: {
      low: contribLow / schedule.visitsPerWeek,
      high: contribHigh / schedule.visitsPerWeek,
      state: overheadDerivedState,
      basis: overheadBasis,
    },
    grossMarginPct: {
      /*
       * Each end divides the contribution by the revenue that produced it.
       *
       * Dividing the worst contribution by the *best* revenue — and the best by the worst — mixed two
       * ends that cannot occur together, and the optimistic result could exceed 100%: a margin higher
       * than the revenue it came from, which is not a possible state of the world. The pessimistic
       * pairing already lives in `contribLow`; re-pairing it here flattered the range in the one
       * direction this module is written not to flatter.
       */
      low: revenueLow === 0 ? null : (contribLow / revenueLow) * 100,
      high: revenueHigh === 0 ? null : (contribHigh / revenueHigh) * 100,
      state: overheadDerivedState,
      basis: overheadBasis,
    },
    breakEvenUtilisationPct: {
      /*
       * The utilisation at which revenue covers the paid hours, at the worst credible rate pair.
       * Cancellations belong here too: an hour that is billed and then cancelled earns nothing while
       * still being staffed, so it raises the utilisation needed to break even. Omitting it made this
       * figure quietly assume a cancellation rate of zero while every neighbouring figure did not.
       *
       * This one keeps the plain state and basis. Travel and admin minutes cancel out of the
       * identity — it is wage, burden, rate and cancellation and nothing else — so labelling it a
       * HYPOTHESIS "whose paid hours assume …" would attach an assumption it does not carry. The
       * rule cuts both ways: a figure must not claim more certainty than its inputs, and must not
       * claim less.
       */
      low: rate.high! === 0 || cancelLow >= 100
        ? null
        : (wage.low! * (1 + burden.low! / 100) / (rate.high! * (1 - cancelLow / 100))) * 100,
      high: rate.low! === 0 || cancelHigh >= 100
        ? null
        : (wage.high! * (1 + burden.high! / 100) / (rate.low! * (1 - cancelHigh / 100))) * 100,
      state: derivedState,
      basis,
    },
    missingInputs: [],
    note: "",
  };
}

/* -------------------------------------------------------------------------- */
/* Schedule comparison                                                         */
/* -------------------------------------------------------------------------- */

export interface ScheduleComparisonV1 {
  readonly shapes: readonly { label: string; utilisationPct: number; paidHoursPerWeek: number }[];
  /**
   * The unevidenced inputs these numbers rest on, stated rather than buried.
   *
   * Travel and admin minutes are not observations of this business — nobody has measured them. The
   * *direction* of the fragmentation penalty survives any plausible value, but the specific
   * percentages do not, and a reader who cannot see the assumptions cannot tell the two apart.
   */
  readonly assumptions: readonly string[];
  /**
   * True when the utilisation spread from structure alone is at least ten points.
   *
   * This is a statement about the calendar and nothing else. It was named and documented as
   * "structure outweighs a plausible rate difference", which is a claim about the market that no
   * evidence here supports — the prose was corrected and this field went on asserting it in JSON.
   * Whether the spread outweighs a rate difference is UNKNOWN and stays UNKNOWN until rates are known.
   */
  readonly structuralSpreadIsLarge: boolean;
  readonly reason: string;
}

/**
 * Compare schedule shapes with identical billable hours.
 *
 * This works with **no market data at all**, which is why it is the most useful thing the operator
 * can currently say about Compassionate Choice: the fragmentation penalty is arithmetic about the
 * calendar, not a claim about the market.
 */
export function assumptionsFor(shapes: readonly ScheduleShapeV1[]): readonly string[] {
  const travel = [...new Set(shapes.map((shape) => shape.travelMinutesPerVisit))].join("/");
  const admin = [...new Set(shapes.map((shape) => shape.adminMinutesPerVisit))].join("/");
  /*
   * Read `travelPaid` rather than asserting it.
   *
   * This line always claimed travel was paid, so an unpaid shape was computed one way and described
   * the other — a written reason that contradicts the number it explains is worse than no reason,
   * because it is believed.
   */
  const paid = [...new Set(shapes.map((shape) => shape.travelPaid))];
  const travelPolicy = paid.length === 1
    ? (paid[0] === true
      ? "travel treated as paid time, which is a policy choice rather than an observation"
      : "travel treated as unpaid, which is a policy choice rather than an observation")
    : "travel paid on some shapes and not others, which is a policy choice rather than an observation";
  return [
    `travel of ${travel} minutes per visit, ASSUMED and not measured for this business`,
    `admin of ${admin} minutes per visit, ASSUMED and not measured for this business`,
    travelPolicy,
  ];
}

export function compareScheduleShapes(shapes: readonly ScheduleShapeV1[]): ScheduleComparisonV1 {
  const rows = shapes.map((shape) => {
    const billable = shape.visitsPerWeek * shape.hoursPerVisit;
    const overhead = shape.visitsPerWeek
      * ((shape.travelPaid ? shape.travelMinutesPerVisit : 0) + shape.adminMinutesPerVisit) / 60;
    const paid = billable + overhead;
    return {
      label: shape.label,
      utilisationPct: paid === 0 ? 0 : Number(((billable / paid) * 100).toFixed(1)),
      paidHoursPerWeek: Number(paid.toFixed(2)),
    };
  });

  const assumptions = assumptionsFor(shapes);
  const best = Math.max(...rows.map((row) => row.utilisationPct));
  const worst = Math.min(...rows.map((row) => row.utilisationPct));
  const spread = best - worst;

  return {
    shapes: rows,
    structuralSpreadIsLarge: spread >= 10,
    assumptions,
    reason: spread >= 10
      ? `under the stated assumptions (${assumptions.join("; ")}), utilisation ranges ${worst}% to ${best}% across the same billable hours`
        + ` — a ${spread.toFixed(1)}-point spread from structure alone.`
        + ` Whether that outweighs a rate difference is UNKNOWN: it needs rate evidence AION does not have`
      : `utilisation varies only ${spread.toFixed(1)} points; schedule shape is not the deciding factor here`,
  };
}
