# Resource Limits Final Readiness Review

Review subject: `aion-resource-limits-1` profile and ADR-010, after Sprint 2.9 corrections  
Reviewer role: Principal Architect / CTO design authority  
Date: 2026-08-06  
Decision scope: Architecture readiness only. **ADR-010 remains Proposed. DG-4 remains open.**

Posture: this review attempts to **reject** the corrected design.

## Disposition of the four blocking findings

### B-1 — Floor/ceiling band contradicted deterministic conformance

**Original finding.** ACJ-1 §Conformance requires byte-identical output *and* rejection of every
out-of-domain value with the specified deterministic error; §34 requires agreement "including every
rejection case." A floor implementation at depth 32 rejects what a ceiling implementation at 64
accepts, leaving both "conforming" and disagreeing. AFX-1 §6 defines a boundary fixture as
behaviour "immediately either side of a declared limit" — singular. A band is not a boundary.

**Correction applied.** Band removed. One deterministic value per surface. Four categories:
encoding capacity (not an acceptance limit), normative profile limit, deployment admission limit,
separately named reduced profile. Determinism rule stated explicitly over the five-tuple of value,
schema version, canonicalization profile, limits profile, and stage. `conformance-floor-unmet`
removed as meaningless without floors.

**Sections changed.** `contracts/resource-limits-profile.md` §1 (rewritten), §1.1 admission
separation, §1.2 reduced profiles, §1.3 identifier placement, §3 (all tables), §8 outcomes,
§7 invariants 11–12, 16. `decisions/CTO-DECISION-007` §B-1.

**Remaining risk.** Every limit now has one value, so a low-resource implementation that genuinely
cannot meet it has no conformant option short of a separately named profile — which does not yet
exist. §10.1 mitigates by lowering the values rather than by adding a tier, but if physical testing
on a 4 GB device later shows the values are still too high, a reduced profile becomes necessary and
that is a new profile with its own fixtures.

**No longer blocking.** The contradiction with an Accepted contract is removed.

### B-2 — Enforcement stages unspecified

**Original finding.** Rejection stage was undefined, and independent review reported CPython
guarding recursion at a fixed depth — meaning the same input rejects at different stages in two
runtimes, which AFX-1 §11 item 6 counts as a conformance failure.

**Correction applied.** Every limit assigned to an exact stage. A **pre-parse structural scan** is
mandated for byte-entry input, enforcing raw size, depth, members, elements and nodes in one
O(1)-memory pass before any value tree exists. Earliest enforceable stage stated per entry path,
with the Entry-V asymmetry and its residual risk recorded. Implementation strategy specified:
single-pass, iterative, overflow-safe.

**The CPython claim was verified by execution rather than accepted:** `json.loads` succeeded at
depth 2,990 and raised `RecursionError` at 3,000, and `sys.setrecursionlimit(20000)` did **not**
move it — a fixed C-level guard. Node parsed 1,000,000 without error.

**Sections changed.** `resource-limits-profile.md` §3 (stage sections), §4 (new). `CTO-DECISION-007`
§B-2. `benchmarks/resource-limits-evidence.md`.

**Remaining risk.** The Entry-V path enforces at S1, not S0, so an oversized structured value was
already materialized by the caller. This is bounded — the caller built the value it is submitting —
but it means the two entry paths have genuinely different allocation exposure, and a fixture pair
proving both count identically is required before the corpus can assert node limits.

**No longer blocking.** Rejection stage is now deterministic and independent of host-parser
behaviour.

### B-3 — "Total value node" undefined

**Original finding.** L-07 stated a number with no counting rule. Two implementations would count
differently and the boundary would be untestable.

**Correction applied.** Normative definition with an inclusion list, an exclusion list, four worked
examples, and counting requirements. Iterative counting mandated with measured justification.
Boundary behaviour **verified by execution**: at limit−1 / limit / limit+1 the *exceeded* flag was
`false / false / true`.

**Sections changed.** `resource-limits-profile.md` §4.1 (new). `CTO-DECISION-007` §B-3.
`tools/benchmarks/resource-limits/workloads.mjs` implements and self-checks the counter.

**Remaining risk.** The definition is verified in one implementation. A second implementation
counting the same shapes is required, and the Entry-B byte-scan count must be proven identical to
the Entry-V tree-walk count.

**No longer blocking.** The rule is exact, exemplified, and runtime-independent by construction.

### B-4 — Workload evidence not supplied

**Original finding.** DG-4's required evidence named six size classes and six workload families;
none was supplied.

**Correction applied.** 31 Node probes across six size classes and six workload families, plus 16
CPython probes as a second runtime. 10 of 10 harness self-checks passed. Every candidate number
classified by evidence category. Boundary triples generated where practical.

**Sections changed.** `benchmarks/resource-limits-evidence.md`, `resource-limits-methodology.md`,
new `resource-limits-workloads.json` and `resource-limits-python.json`, new `workloads.mjs` and
`probe_python.py`.

**Remaining risk — and this is why B-4 does not fully close.** The evidence covers
**canonicalization and framing**. DG-4's requirement also names metadata, label count, provenance,
extension, relationship page and event sizes, plus high-churn, high-degree, large-artifact,
migration, export and restore workloads. **None of those was supplied**, because they are Object
business limits requiring an Object implementation that does not exist.

**Partially resolved.** The canonicalization half is evidenced. The Object half is not, and DG-4
requires both.

## Attempting to reject the corrected design

| # | Question | Verdict |
|---:|---|---|
| 1 | Deterministic accept/reject | **Yes.** One value per surface; the five-tuple determinism rule is explicit |
| 2 | Profile identifier completeness | **Yes.** `aion-resource-limits-1`, versioned independently of `acj-1`, in fixture and conformance metadata, correctly kept out of the Object envelope |
| 3 | Deployment-policy separation | **Yes.** Distinct `policy-limit-exceeded`, occurs outside the verdict, must not claim contract rejection |
| 4 | Reduced-profile migration path | **Defined but untested.** §1.2 requires a separately named profile; none exists, so the path is stated, not walked |
| 5 | Enforcement-stage ownership | **Yes**, and the pre-parse scan makes the stage runtime-independent |
| 6 | Pre-allocation feasibility | **Yes for Entry-B, no for Entry-V** — stated honestly rather than glossed |
| 7 | Total-node definition | **Yes.** Exact, exemplified, execution-verified |
| 8 | Depth and node interaction | **Coherent.** `combined.deepAndWide` stays inside every per-container limit while accumulating nodes — the bypass L-07 closes |
| 9 | Width and byte interaction | **Coherent.** Members ~72 B / 164–288 ns; elements ~8 B / 20–30 ns; limits differ 16× accordingly |
| 10 | Unicode byte versus scalar | **Resolved by withdrawal.** L-09 was mathematically dead; no replacement proposed |
| 11 | UTF-16 member ordering | **Clarified and measured.** Node conformant by default, Python not; divergence reproduced with exact code points |
| 12 | Low-resource portability | **Assessed, not tested.** Three values lowered on portability grounds. Not physically validated |
| 13 | Evidence quality | **Much improved.** Self-checking harness; the Sprint 2.8 memory-metric defect is corrected and its history preserved |
| 14 | Proxy-versus-production risk | **Disclosed.** `JSON.parse` is C++, iterative, enforces no AION rule; every latency number has *less* headroom than it appears |
| 15 | Cancellation evidence | **None.** Correctly marked unavailable — no cancellable implementation exists |
| 16 | Memory-amplification evidence | **Now sound but not a derivation input.** Ranged 1.16×–14.6×; no cap proposed |
| 17 | Cross-runtime behaviour | **Measured.** Python 0.7×–1.4× Node on timing; depth guard 2,990 vs unbounded; lossless integers vs lossy |
| 18 | Fixture-boundary determinism | **Yes for canonicalization limits.** One value per surface makes every boundary a triple |
| 19 | Ten-year migration | **Good.** Limits sit outside ACJ-1 §24's trigger, so a limits revision invalidates no retained digest — now stated, not inferred |
| 20 | Can DG-4 truthfully close? | **No** |

## New finding

**NF-1 — Python is lossless where Node is lossy, and that is a cross-runtime hazard in its own
right.** All four literals above 2^53−1 parsed to *different* values in Node and to *exact* values
in CPython, which returns arbitrary-precision `int`. The same document therefore yields different
numeric values in the two runtimes.

This strengthens rather than weakens ACJ-1 §7: the cap exists precisely because the parser cannot
be relied on. But it also means a conformant implementation must **reject** out-of-range integers
rather than trusting its parser to have preserved them — in Python the value survives and looks
fine. Worth an explicit note in ACJ-1 §7 and a required fixture.

## Remaining non-blocking findings

Carried forward and still open: sorting cost measured but the member-count knee still not located
(L-05 provisional); L-25 rests on one expansion sequence; no limits-profile identifier in the
digest descriptor or AFX-1 `subjectBinding`; number duplication between ACJ-1 §23, §29–§31 and this
profile; no normative cheapest-first check order despite late rejection scaling to 35× at 4 MiB;
per-container cost differs ~9× so an undifferentiated node budget under-protects object-dense
documents.

## Recommendation

# APPROVE WITH CHANGES

All four blocking findings are addressed, three of them fully. The design is materially better than
Sprint 2.8's: one deterministic value per surface removes a contradiction with an Accepted
contract; the pre-parse scan converts a runtime-dependent rejection stage into a specified one; the
node definition is exact and execution-verified; and the evidence is now self-checking, cross-runtime,
and honest about a defect it found in itself.

**One change remains required before ADR-010 could be accepted.**

**RC-1 — B-4 is only half met, and DG-4's scope should be split.** The canonicalization and framing
limits are evidenced. The Object business limits — metadata, label count, provenance, extension,
relationship page, event sizes — and the six Object workload families are not, and cannot be until
an Object implementation exists. Leaving DG-4 as one gate means canonicalization limits stay blocked
behind evidence that is years away. Recommend splitting: **DG-4a** canonicalization and framing
limits, closable on this evidence once RC-1 is recorded; **DG-4b** Object business limits and
workloads, remaining open and continuing to block production adapters and untrusted ingestion.

That is a scope decision for the Founder/CTO, not something a review may take.

**What this does not establish.** No limit is enforced anywhere. No canonicalizer, validator,
fixture, or harness exists. The lower-resource target was reasoned about, **not physically tested**.
The probes are proxies and are faster than the real implementation will be. Two runtimes were
measured; a third would likely surface more divergence, as the second did.

**ADR-010 remains Proposed. DG-4 remains open.** DG-1 and DG-3 remain open. ADR-007, ADR-008 and
ADR-009 remain Accepted. The Universal Object Contract remains **pre-stable**. The implementation
freeze remains in effect.

This review authorizes nothing.

## Subsequent decision — 2026-08-06

The Founder/CTO accepted the review's RC-1 in
[CTO-DECISION-008](../decisions/CTO-DECISION-008-resource-limits-and-vertical-slice.md), splitting
the historical DG-4 into DG-4a and DG-4b. ADR-010 was then Accepted for DG-4a only; DG-4a closed
and DG-4b remained Open. The review above remains historical evidence and its statements about
the absence of implemented production protection remain current.
