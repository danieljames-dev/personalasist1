# Personal Sales Presence — Design (AION)

**Status:** FOUNDATION — domain contracts and logic implemented with tests; nothing wired to the
runtime, nothing deployed, nothing connected
**Author executor:** CLAUDE
**Branch:** `executor/claude-sales-presence-foundation`
**Base main:** `0caed89e1df518c98f60cb806482f5d0ef35d4ef`

## What this is not

- Not a deployed website. No hosting, no domain, no build output.
- Not a social integration. No Metricool call, no OAuth, no scheduled post.
- Not wired into Chat. The Owner command vocabulary is defined and tested but is not routed in
  `service.ts` — see *Deferred wiring*.
- Not a second inventory store. Every vehicle fact is read from the existing inventory record.

## The problem this vertical actually solves

A salesperson's online presence fails in one of two ways. Either it goes quiet, or it fills up with
posts that exist because a calendar said so. The second failure is the expensive one: an audience
that learns the posts are not about anything stops reading the post that *is* about something, and
the Owner's credibility is the entire product being sold.

So the system is built around opportunities rather than slots. Something happened — a car arrived, a
price moved, three people asked the same question — and that is what produces content. When nothing
happened, `buildContentPlan` returns `noPostRecommended: true` and says why. That is a feature, and
it is the feature most content tools cannot offer because their business model is volume.

## Module map

| Module | Responsibility |
|---|---|
| `sales-brand.ts` | Who the Owner is professionally. Refuses unverifiable self-description. Bridges from `BrandDnaV1`. |
| `content-opportunity.ts` | Grounded signals become ranked opportunities. Enforces the demand-aggregation floor. |
| `content-draft.ts` | Price truth, freshness, privacy and claim scanners, and the generators. |
| `content-plan.ts` | Daily/weekly/monthly plan, the Owner's daily brief, and the command vocabulary. |
| `sales-website.ts` | Information architecture, vehicle page projection, lead capture contract. |
| `sales-presence-proposal.ts` | `PREPARE_ONLY` social and website proposals, plus the analytics model. |

## Three decisions worth defending

### 1. One facts object, many renderings

`VehicleContentFactsV1` is assembled once from the inventory record. A Facebook post, a Reel script,
a website feature and a message the Owner texts a customer all read from it, and a format decides
tone and length but never decides what is true.

The alternative — a generator per surface, each reading the vehicle itself — produces drift. The
price in the post and the price on the site disagree, and the customer who noticed is standing in
front of the Owner asking which one is right.

### 2. Price is three facts, never one

A window-sticker MSRP is a manufacturer's figure. A website-advertised price is what the store is
publicly offering. An in-store observation is neither. The failure mode is specific and was the
motivating example: `$53,378` read off a Monroney label becoming *"Now only $53,378"* in a post — an
advertisement the dealership never authorised, made in the Owner's name.

So `PriceFactV1` carries its kind and its source; only `WEBSITE_ADVERTISED` is quotable as *the*
price; and `priceSentence` has no branch that can produce sale framing. An unknown price produces an
invitation to ask, never a number.

A wording detail is load-bearing and was found by a test: the MSRP disclaimer must not contain the
phrase "sale price". The claim scanner rejects that phrase, so an MSRP-only vehicle would have
refused to draft at all — and a caption truncated mid-sentence would have displayed the phrase
without the negation in front of it.

### 3. Customer demand is aggregate or it is nothing

One person wanting an AWD RAV4 is that person's business. In a single-store territory, a post
prompted by it is traceable back to them by anyone who was on the floor that week — and the Owner is
the person who would be asked about it.

`MIN_AGGREGATE_DEMAND_CUSTOMERS = 3` is enforced in `contentOpportunityFromSignal`, before any text
exists. Enforcing it at the drafting layer would be too late: by then the identity has already
reached the string. Drafts are additionally scanned for phone shapes, address shapes, internal record
references, and the specific names of customers the content derived from.

## Temporal invalidation

Freshness is **re-derived** from the live vehicle record, never stored and trusted. A stored
`freshness: "CURRENT"` is only as true as the last time somebody remembered to update it, and nobody
remembers. `reviewDraftFreshness` returns `STALE` when the vehicle is delisted or gone, and
`NEEDS_REVERIFY` when the price moved, the price kind changed, or the observation aged out.

The asymmetry in `buildWebsiteChangeProposal` is deliberate: staleness blocks *adding* a vehicle but
never blocks *removing* one. Refusing to remove a sold car because the evidence is stale would leave
it advertised forever.

## Deferred wiring

The Owner command vocabulary (`routeSalesPresenceCommand`) is implemented and tested but not spliced
into `service.ts`. Grok is working in that file on the lot-walk vertical, and a routing splice from
this branch would collide for no benefit — routing is roughly one line per intent at integration
time, while deciding what each request *means* is the part worth settling now.

## Open questions — do not invent answers

1. Where would the site be hosted, and does the dealership have a policy on a salesperson's personal
   site using store inventory?
2. Is Metricool the scheduling provider, or does the Owner already use something else?
3. What does the dealership permit regarding advertised pricing on a personal site?
4. Whose photographs may be used — dealer listing photos, or only the Owner's own lot-walk images?
5. Retention for lead-capture submissions, and who else can see them.

## Test gate covered by `sales-presence.test.ts`

Brand refusals, pillar gating, opportunity ranking, demand aggregation, private-data scanning, price
kinds, invented-claim scanning, freshness transitions, plan behaviour including the empty day,
command routing and non-capture of existing traffic, website architecture, vehicle page projection
and VIN policy, lead-capture refusals, both proposal types staying `PREPARE_ONLY`, analytics
small-sample refusal, and a full fixture end-to-end asserting one facts object reused across five
surfaces with provenance intact.
