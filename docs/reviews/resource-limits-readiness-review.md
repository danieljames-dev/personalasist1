# Resource Limits Readiness Review

Review subject: `arlp-1` limit profile and ADR-010  
Reviewer role: Principal Architect / CTO design authority  
Date: 2026-08-06  
Decision scope: Architecture readiness only. **ADR-010 remains Proposed. DG-4 remains open.**

Posture: this review attempts to **reject** the profile.

## Method

Three independent hostile reviewers — an architect, a security reviewer, and an implementer who
would have to build a conforming canonicalizer in two languages — reviewed the profile against
the twenty required questions and the captured benchmark evidence.

**Two returned REJECT. One returned APPROVE WITH CHANGES.**

Their most damaging findings were verified by execution before being accepted, and three of them
were correct and material enough to change the profile mid-sprint.

## Findings verified and acted on during the sprint

### The memory metric did not measure memory

The architect's leading finding. The harness sampled `heapUsed` only *after* the probe returned —
by which point the value under test was unreachable garbage — and excluded `external` and
`arrayBuffers`, so Buffers were invisible.

Verified: `hex.encode` over 16 MiB, which produces a 33.5 MB output string, reported a
**2,120-byte** peak heap delta and an amplification factor of **0**. Physically impossible.

Corrected: collect before each iteration, sample **while the produced value is retained**, total
`heapUsed + external + arrayBuffers`. The corrected harness self-checks: hex now reports exactly
**2.00×** (hex doubles its input), `Buffer.concat` **2.00×** (it copies), and a digest **~0**
(32 bytes regardless of input).

### The member-limit derivation was an artifact

The profile justified 4,096 members by an "amplification plateau at 49×". Verified: the residual
ratio difference tracks **key-name digit length** — `"m0"` versus `"m4095"` — not member count.
Per-member heap is **72.4 / 72.1 / 72.0 bytes** at 1,024 / 4,096 / 65,536, a 0.47% spread. The
amplification ratio 56.425 ÷ 49.294 = 1.1447 is the inverse of the input-bytes-per-member ratio
1.1500.

**Derivation withdrawn.** L-05 now records that it *ratifies* the ACJ-1 §31 provisional value
because the sweep found no reason to move it. The knee lies between 4,096 and 65,536 and was
never located — 4,096 measured *faster* than 4,095, which is noise.

### L-09 was mathematically dead

Verified by arithmetic: UTF-8 encodes every scalar in at least one byte, so
`scalarCount ≤ byteCount` always. With L-08 = 1,048,576 bytes and L-09 = 1,048,576 scalars, L-09
could never fire independently. The evidence cited in its favour — a measured ~3× byte/scalar
divergence — actually proves the value must be set *below* L-08 to bind at all.

**L-09 withdrawn.**

## The twenty questions

| # | Question | Verdict |
|---:|---|---|
| 1 | Are universal ceilings necessary? | **Yes.** `JSON.parse` bounded nothing to 1,000,000 depth. No runtime will do this for us |
| 2 | Profile or deployment policy? | **Both, and the split is right.** Ceilings bound hostile input universally; policy tightens locally. The implementer review called this split the strongest part of the design |
| 3 | Is capacity confused with authorization? | **No.** Category A exists precisely to prevent it, and the 2^53 evidence demonstrates why |
| 4 | Are floors too demanding for low-resource runtimes? | **Unknown — and that is a finding.** No low-resource target is defined. Floors were set for portability by judgment, not measurement |
| 5 | Are ceilings too permissive for hostile input? | **Possibly.** A 16 MiB document costs ~100 ms here; ~1 s on a 10× slower device, with no time budget and no concurrency bound |
| 6 | Are current-machine results over-generalized? | **Partly, and it is disclosed.** The depth margin was originally stated as a single "125×" figure derived from V8's stack; it is now stated per runtime |
| 7 | Do probes approximate the future implementation poorly? | **Yes, and it is stated.** `JSON.parse` is C++, iterative, and checks no AION rule. Every latency number has *less* headroom than it appears |
| 8 | Do depth and node limits overlap coherently? | **Yes.** L-07 exists because L-04/L-05/L-06 are individually satisfiable and jointly bypassable — `deepAndWide` and `manySmallContainers` prove it |
| 9 | Are byte and scalar limits both necessary? | **The quantities diverge ~3×, but the proposed scalar limit was dead.** Withdrawn |
| 10 | Are array and member limits bypassable? | **Individually yes; L-07 closes it** |
| 11 | Do framing limits align with canonical payload limits? | **Yes**, and L-03 is derived from L-02 rather than stated independently, so they cannot drift |
| 12 | Do limits permit streaming? | **Bounded-buffer only**, which ACJ-1 §32 already concedes. L-02 and L-04 are exactly the buffer and stack bounds an implementation needs |
| 13 | Is cancellation testable without implementation? | **No, correctly deferred** — but the cancellation *invariants* are specifiable today and only one is stated |
| 14 | Do stable outcomes reveal sensitive information? | **L-16 weakens an existing rule.** ACJ-1 §33 forbids echoing offending content absolutely; a 4 KiB budget implicitly licenses 4 KiB of reflection |
| 15 | Do deployment overrides remain discoverable? | **No mechanism exists.** Category D says "must be discoverable" and nothing implements the word |
| 16 | Can migration preserve immutable records? | **For digests yes, for revalidation no.** Limits sit outside ACJ-1 §24's change trigger, so `arlp-1` versions independently — but tightening a limit could fail revalidation of a retained Object |
| 17 | Can fixture boundary cases now be defined? | **Partially.** Rejection-side yes; anything in the floor/ceiling band no; anything counted in nodes no |
| 18 | Can DG-4 truthfully close? | **No** |
| 19 | Does any number lack evidence? | **Yes** — L-11, L-16, and five of eight floor values have no probe at all |
| 20 | Maintainable for ten years? | **Not as drafted**, but the structural fixes are cheap now |

## Blocking findings

**B-1 — The floor/ceiling band contradicts an Accepted contract.** ACJ-1 §Conformance requires
byte-identical output *and* rejection of every out-of-domain value with the specified
deterministic error; §34 requires agreement "including every rejection case". A floor
implementation at depth 32 rejects what a ceiling implementation at depth 64 accepts, and both
are "conforming". AFX-1 §6 defines a boundary fixture as behaviour "immediately either side of a
declared limit" — singular. A band is not a boundary.
**Required:** exactly one normative enforcement value per limit, or a separately identified
reduced profile carried wherever `acj-1` is carried.

**B-2 — The enforcement stage is unspecified.** Review reports CPython's `json.loads` raising
`RecursionError` near depth 2,999 as a fixed C-level guard. The same input would reject at S0 in
Python and S2 in TypeScript, which AFX-1 §11 item 6 counts as a conformance failure between two
*correct* implementations. **Required:** mandate a pre-parse structural scan for byte-entry input
so limit rejections are deterministically staged. The CPython figure is a review claim this
sprint did not independently measure and must be confirmed.

**B-3 — "Total value node" is undefined.** L-07 gives a number with no counting rule. Whether
member names, scalar values, empty containers, and the root count is unstated, so two
implementations count differently and the boundary is untestable.
**Required:** a normative counting rule with a worked example, and a fixture pair proving a
byte-scan count and a tree-walk count agree.

**B-4 — DG-4 cannot close on this evidence.** Its required evidence names maximum metadata,
label count, provenance, extension, relationship page, and event sizes, plus benchmarked
high-churn, high-degree, large-artifact, migration, export, and restore workloads. None was
supplied; storage I/O was deliberately not measured. Separately, ACJ-1 §29–§31 distinguishes
canonicalizer safety limits from "the business limits owned by DG-4" and requires DG-4 limits ≤
those — setting them equal collapses a distinction the Accepted contract drew.
**Required:** keep DG-4 open. Consider splitting canonicalization limits from Object business
limits so the former can close on its own evidence.

## Non-blocking findings

| ID | Finding |
|---|---|
| NB-1 | L-12 and L-13 name the same object — Context *is* one of the six textual fields |
| NB-2 | Category A lists ACJ-1's integer domain alongside frame field widths; that is a value-domain rule, not an encoding capacity of the frame |
| NB-3 | L-16's 4 KiB budget weakens ACJ-1 §33's absolute no-echo rule. A conforming error is a category plus a location |
| NB-4 | Object members cost ~9× array elements in memory and ~8× in time; a single undifferentiated node limit under-protects object-dense documents |
| NB-5 | **Sorting was never measured**, despite ACJ-1 §30 justifying the member limit as bounding sort cost. Review further reports Python `sorted()` ordering astral-plane keys opposite to JavaScript `.sort()` — a cross-runtime divergence that would produce different canonical bytes. An astral-plane member-ordering fixture needs no limits decision and may be the highest-value fixture available |
| NB-6 | Five of eight floor values have no probe; L-11 (identifier 1,024 B) has neither probe nor plausible domain need — a UUID is 36 bytes |
| NB-7 | The profile never states its own worst-case memory requirement, which is the number an implementer most needs |
| NB-8 | Category D's "must be discoverable" has no mechanism; no descriptor or `subjectBinding` carries a limits profile |
| NB-9 | 16 MiB is stated in three places and 1,024 in three; publish one normative table and reference it |
| NB-10 | No normative check order is specified, despite late rejection costing ~100× early rejection |

## Recommendation

# APPROVE WITH CHANGES

The **taxonomy** is right and should be preserved. Separating encoding capacity from safety
ceiling from conformance floor from deployment policy is the distinction that keeps limits
portable, and the depth/width/node layering is arithmetically coherent — each limit binds on
input the others do not. The implementer reviewer, who would have to build against it twice,
called that split the cleanest thing in the proposal, and I agree.

The **numbers are not ready**, and this sprint proved it rather than concealing it. One
derivation was void, one limit was dead, and the metric carrying two derivations did not measure
memory. Those were caught, verified by execution, and corrected — but they were caught by
adversarial review, not by the original analysis, which is itself a finding.

Four blocking changes are required before ADR-010 could be accepted: resolve the floor/ceiling
conformance contradiction (B-1); specify the enforcement stage (B-2); define node counting (B-3);
and keep DG-4 open pending its actual evidence requirements (B-4).

**What this does not establish.** No limit is enforced anywhere. No canonicalizer, validator,
fixture, or harness exists. All evidence is from one machine, one runtime, one OS, with a probe
that is faster than the real implementation will be. Cross-runtime agreement has never been
demonstrated.

**ADR-010 remains Proposed. DG-4 remains open.** DG-1 and DG-3 remain open. ADR-007, ADR-008, and
ADR-009 remain Accepted. The Universal Object Contract remains **pre-stable**. The implementation
freeze remains in effect.

This review authorizes nothing.
