# Sprint 2.8 Resource Limits Risks

Status: **Proposed** architecture challenge record  
Implementation: **Frozen**

## Risk register

| ID | Risk | Severity | Failure scenario | Disposition |
|---|---|---:|---|---|
| RL-001 | Benchmark metric measures nothing | **Critical** | The first harness sampled heap *after* the value became garbage and excluded external memory, reporting a 2,120-byte peak delta for a 33.5 MB output. Its numbers were used to derive a limit | **Occurred and corrected mid-sprint.** Harness now samples while the value is retained, totals `heapUsed + external + arrayBuffers`, and collects between runs. The void derivation is withdrawn, not quietly replaced |
| RL-002 | A derivation is an artifact of the generator | **Critical** | The "amplification plateau at 4,096 members" tracked key-name digit length (`"m0"` vs `"m4095"`), not member count. Per-member heap differs by 0.47% across the sweep | **Occurred and corrected.** L-05 now records ratification of the ACJ-1 §31 value, not derivation |
| RL-003 | A limit is mathematically dead | High | L-09 set the scalar limit equal to the byte limit; UTF-8 guarantees `scalars ≤ bytes`, so it could never fire independently | **Occurred and corrected.** L-09 **withdrawn** |
| RL-004 | Floor/ceiling band breaks conformance | **Critical** | ACJ-1 §Conformance and §34 require identical output *and* identical rejection between conforming implementations. A floor implementation rejecting at depth 40 what a ceiling implementation accepts leaves both "conforming" and disagreeing — and leaves every boundary fixture with no single declared limit | **OPEN — blocking.** One normative value per limit, or a separately identified reduced profile |
| RL-005 | Enforcement stage unspecified | **Critical** | Review reports CPython's `json.loads` guarding recursion near depth 2,999 as a fixed C-level limit. The same input would reject at S0 in Python and S2 in TypeScript, which AFX-1 §11 counts as a conformance failure | **OPEN — blocking.** Mandate a pre-parse structural scan for byte-entry input, and confirm the CPython figure independently |
| RL-006 | "Total value node" undefined | High | L-07 states a number with no counting rule. Are member names nodes? Empty containers? The root? Two implementations count differently and the boundary is untestable | **OPEN — blocking.** Publish a counting rule with a worked example |
| RL-007 | DG-4 declared closed on partial evidence | **Critical** | DG-4's required evidence names metadata, label count, provenance, extension, relationship-page and event sizes plus six benchmarked workloads. None was supplied | **OPEN — blocking.** DG-4 stays open. Consider splitting canonicalization limits from Object business limits |
| RL-008 | One machine generalized to universal architecture | High | All evidence from one x86-64 laptop, one runtime, Defender active, battery present, 15.7 GB RAM | Floors set for portability rather than from this machine's headroom; margins now stated per runtime. **A low-resource target is still undefined** |
| RL-009 | Probes do not resemble the future implementation | High | `JSON.parse` is C++, iterative, and enforces no AION rule. A real canonicalizer will be slower because it checks more | Every latency-derived number therefore has **less** headroom than it appears. Stated in the methodology |
| RL-010 | Sorting was never measured | High | ACJ-1 §30 justifies the member limit as bounding sort cost, and no probe measures sorting, UTF-16 comparison, escaping, NFC checking of member names, or canonical emission | **OPEN.** The member limit's stated purpose is unmeasured |
| RL-011 | Cross-runtime sort divergence | **Critical** | Review reports Python `sorted()` on astral-plane keys returning the opposite order to JavaScript `.sort()`. ACJ-1 §2 mandates UTF-16 code-unit order, so a naive Python canonicalizer would produce different canonical bytes and a different digest | **OPEN.** Needs an astral-plane member-ordering fixture — authorable with no limits decision, and arguably the highest-value fixture in the whole corpus |
| RL-012 | Late rejection as an amplification vector | High | Late failure costs ~100× early failure (0.523 ms vs 0.005 ms) | Invariant 1 requires checking before unbounded allocation. A normative cheapest-first check order is **not** yet specified |
| RL-013 | Error-detail budget licenses reflection | Medium | A 4 KiB budget implicitly permits echoing up to 4 KiB of attacker input, weakening ACJ-1 §33's absolute no-echo rule | **OPEN.** A conforming error is a category plus a location — tens of bytes |
| RL-014 | Limits applied to retained records | High | Tightening a deployment or profile limit could make an archived Object fail revalidation, or a retained frame fail to decode, while its digest still verifies | **OPEN.** State that limits are an ingress control and must not apply when verifying a retained digest or decoding a retained frame |
| RL-015 | No limits-profile identifier anywhere | High | Neither the ACJ-1 §38 digest descriptor nor AFX-1 §4 `subjectBinding` carries a limits profile, so no retained record shows which limits applied and no peer can query them | **OPEN.** Category D's "must be discoverable" has no mechanism |
| RL-016 | Number duplication drift | Medium | 16 MiB appears in ACJ-1 §23 rule 3, §29–§31, and arlp-1 L-01/L-02/L-03; 1,024 appears in §23 rule 3, L-12, and L-13 | **OPEN.** Publish one normative table; make other locations anchor references |
| RL-017 | Ceiling too permissive on low-resource devices | High | A 16 MiB document costing ~100 ms here could cost ~1 s on a 10× slower device, with no time budget and no concurrency bound anywhere | **Deferred** limits are the gap. Default deployment limits should sit far below the ceiling |
| RL-018 | Deferred surfaces never return | Medium | Seven surfaces deferred; deferral quietly becomes permanent | Each carries a review trigger, and DG-4 cannot close while they are open |
| RL-019 | Per-container cost difference under-protects | Medium | Object members cost ~72 B and 164–288 ns; array elements ~8 B and 20–30 ns. A single undifferentiated node limit under-protects object-dense documents by roughly 9× | **OPEN.** Consider a weighted node budget or a separate total-member limit |

## Architecture recommendation

The **taxonomy is sound and should be kept.** The independent implementer review called the
capacity/ceiling/policy split "the cleanest thing in the proposal", and the depth/width/node
layering is arithmetically coherent — each of L-04 through L-07 binds on some real input that
the others do not.

The **numbers are not ready.** One derivation was void, one limit was mathematically dead, the
metric carrying two derivations did not measure memory until it was fixed mid-sprint, and four
blocking findings stand. **DG-4 cannot close on this evidence**, and this register does not claim
otherwise.

The most valuable output of the sprint is not a limit. It is three measured facts: the runtime
does not bound depth but recursion does; integers above 2^53−1 are silently corrupted; and
duplicate members are destroyed by parsing. Each independently justifies a rule that was
previously asserted.
