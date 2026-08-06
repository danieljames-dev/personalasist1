# Sprint 2.9 Resource-Limit Correction Risks

Status: **Proposed** architecture challenge record
Implementation: **Frozen**

Carries forward the Sprint 2.8 register. Entries resolved by the B-1 to B-4 corrections are updated
in place; the rest remain open.

| ID | Risk | Severity | Disposition |
|---|---|---:|---|
| RL-004 | Floor/ceiling band breaks conformance | Critical → **Resolved** | Band removed; one deterministic value per surface; determinism rule stated over the five-tuple |
| RL-005 | Enforcement stage unspecified | Critical → **Resolved** | Pre-parse structural scan mandated. CPython's fixed guard **measured directly**: 2,990 ok, 3,000 `RecursionError`, `setrecursionlimit(20000)` does not move it |
| RL-006 | "Total value node" undefined | High → **Resolved** | Normative definition, worked examples, iterative counting, boundary triple verified by execution |
| RL-007 | DG-4 closed on partial evidence | Critical → **Open** | Canonicalization evidence supplied; Object business limits and six workload families **not**. DG-4 stays open; RC-1 recommends splitting the gate |
| RL-011 | Cross-runtime sort divergence | Critical → **Confirmed and specified** | Reproduced with exact code points in both runtimes. ACJ-1 §2 clarified with an explicit-comparator requirement and worked example. **A fixture is still required and unauthorized** |
| RL-010 | Sorting never measured | High → **Partially closed** | `f3.sort.utf16` and `f3.serializeProxy.sortAndEmit` now measure it. The member-count knee is still not located, so L-05 remains provisional |
| RL-008 | One machine generalized | High → **Reduced** | Second runtime measured; three values lowered on portability grounds. **Still not physically tested on a low-resource device** |
| RL-013 | Error budget licenses reflection | Medium → **Resolved** | L-16 lowered 4 KiB → 512 B; ACJ-1 §33's absolute no-echo rule restated |
| RL-014 | Limits applied to retained records | High → **Resolved** | §11 states limits are an ingress control and must not apply when verifying a retained digest or decoding a retained frame |
| RL-001 | Benchmark metric measures nothing | Critical → **Resolved in 2.8, guarded in 2.9** | Harness now self-checks for impossible measurements and exits non-zero on failure |
| RL-002 | Derivation is a generator artifact | Critical → **Resolved** | L-05 restated as ratification; per-unit cost used instead of amplification ratio |
| RL-003 | A limit is mathematically dead | High → **Resolved** | L-09 withdrawn |
| RL-009 | Probes do not resemble the implementation | High → **Open** | Both runtimes use built-in parsers enforcing no AION rule. Every latency number has *less* headroom than it appears |
| RL-012 | Late rejection amplification | High → **Quantified, unmitigated** | Ratio scales with input: 1.4× at 64 KiB, 8.9× at 1 MiB, **35× at 4 MiB**. No normative cheapest-first check order specified |
| RL-015 | No limits-profile identifier in records | High → **Open** | §1.3 places it in fixture and conformance metadata, but neither the ACJ-1 §38 digest descriptor nor AFX-1 §4 `subjectBinding` carries it yet |
| RL-016 | Number duplication drift | Medium → **Open** | 4 MiB and 1,024 each appear in more than one document. One normative table with anchor references still needed |
| RL-017 | Ceiling too permissive on low-resource devices | High → **Reduced** | Values lowered; no time budget or concurrency bound exists, so the residual is real |
| RL-018 | Deferred surfaces never return | Medium → **Open** | Six surfaces deferred, each with a review trigger |
| RL-019 | Per-container cost difference | Medium → **Open** | Members ~9× elements in memory and ~8× in time; an undifferentiated node budget under-protects object-dense documents |
| **RL-020** | **Reduced profile is defined but never exercised** | Medium | §1.2 defines the mechanism; no reduced profile exists, so the migration path is stated but never walked. If physical low-resource testing later forces one, it is a new profile with its own fixtures |
| **RL-021** | **Python is lossless where Node is lossy** | High | All four literals above 2^53−1 parsed exactly in CPython and inexactly in Node. A conformant implementation must **reject** out-of-range integers rather than trusting its parser — in Python the value survives and looks correct. Needs an explicit note in ACJ-1 §7 and a fixture |
| **RL-022** | **Entry-V limits are verified, not prevented** | Medium | Structured-value input is already materialized when limits are checked, so the two entry paths have different allocation exposure. A fixture pair proving byte-scan and tree-walk counts agree is required before the corpus can assert node limits |

## Architecture recommendation

The corrections are real and the design is materially better than Sprint 2.8's. One deterministic
value per surface removes a contradiction with an Accepted contract; the pre-parse scan converts a
runtime-dependent rejection stage into a specified one; the node definition is exact and
execution-verified; the evidence is self-checking and cross-runtime.

**DG-4 still cannot close.** The canonicalization half is evidenced; the Object business half is not
and cannot be until an Object implementation exists. The honest options are to split the gate or to
leave canonicalization limits blocked behind evidence that is years away.
