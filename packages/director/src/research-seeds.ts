/**
 * Public pages known in advance to bear on each kind of research question.
 *
 * These exist because live probing found the two halves of this capability are not equally reliable.
 * Direct fetch is completely dependable — a statute at a stable URL comes back every time. Search is
 * not: the zero-cost provider serves an anti-bot challenge after a few automated queries, and a
 * capability whose only route to evidence is an unreliable one would spend most of its runs reporting
 * that it learned nothing.
 *
 * A seed is a **location, never a fact**. Nothing here asserts what any of these pages says. Each one
 * is fetched, digested, dated and recorded exactly like a page found by searching. That is what keeps
 * this list from being a way to smuggle in conclusions: the URLs are chosen, the contents are not.
 *
 * A seed that has moved or 404s produces **no record at all** — `fetchPublicDocument` throws on a
 * non-OK status, so the failure is reported as a refusal on the mission rather than stored as
 * evidence of an error page. An earlier version of this comment claimed the opposite, which was
 * simply untrue of the code beneath it.
 *
 * They are also the *better* route for official material. AION needs §400.509 itself, and arriving at
 * it by searching would be a worse way to reach a document whose address is already known.
 */

import type { EvidenceKindV1 } from "./revenue-opportunity.js";

/**
 * Seeds by the kind of evidence the question is after.
 *
 * Keyed on `evidenceKind` rather than on the question text so a reworded question keeps its sources,
 * and so a new question of an existing kind inherits them without anyone maintaining a second list.
 * Kinds with no defensible public starting point — `DEMAND` above all — have none, deliberately:
 * there is no public page that establishes that somebody wants to buy this, and pretending otherwise
 * is exactly the substitution Revenue Discovery refuses.
 */
/**
 * A seed and the area it actually describes.
 *
 * The scope is declared here because nothing downstream can infer it. An earlier version stamped
 * every retrieval with the workspace's authorized counties, which made the out-of-area filter
 * vacuous: the writer set the field the reader checked. A national wage table fetched by a Polk
 * County mission is a national wage table, and saying otherwise is exactly the "do not represent as
 * local" failure this project keeps closing.
 *
 * `NATIONAL` is not a rejection. National data is real evidence about a national market, and it is
 * often the only rate evidence that exists. It simply must not be filed as evidence about five
 * Florida counties.
 */
export interface ResearchSeedV1 {
  readonly url: string;
  /** The areas this source is evidence about. `["NATIONAL"]` when it describes no particular place. */
  readonly scope: readonly string[];
}

export const RESEARCH_SEED_SOURCES_V1: Readonly<Partial<Record<EvidenceKindV1, readonly ResearchSeedV1[]>>> =
  Object.freeze({
    /* What the law permits, and what comparable providers publish about their rates. */
    PRICE: Object.freeze([
      /* Florida statute: it governs the five counties because it governs the whole state. */
      Object.freeze({
        url: "https://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0400-0499/0400/Sections/0400.509.html",
        scope: Object.freeze(["Hardee", "Highlands", "Hillsborough", "Manatee", "Polk"]),
      }),
      /* A national rate article. Useful, and not about Polk County. */
      Object.freeze({
        url: "https://www.care.com/c/what-companion-caregiving-pays/",
        scope: Object.freeze(["NATIONAL"]),
      }),
    ]),
    /* What the work costs to staff, from the federal wage tables. */
    COST: Object.freeze([
      Object.freeze({ url: "https://www.bls.gov/oes/current/oes311120.htm", scope: Object.freeze(["NATIONAL"]) }),
    ]),
    /* What a sourcing channel actually offers a business, as that channel describes it publicly. */
    CAPABILITY: Object.freeze([
      Object.freeze({ url: "https://www.care.com/business/", scope: Object.freeze(["NATIONAL"]) }),
    ]),
  });
