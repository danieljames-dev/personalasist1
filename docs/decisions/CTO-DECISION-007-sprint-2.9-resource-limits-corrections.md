# CTO-DECISION-007: Sprint 2.9 resource-limit corrections

- Status: Recorded
- Date: 2026-08-06
- Decision authority: Founder / CTO
- Subject: Resolution of ADR-010 readiness findings B-1 through B-4, and the member-ordering
  clarification
- Related: [ADR-008](ADR-008-canonical-serialization.md), [ADR-009](ADR-009-contract-fixture-corpus.md),
  [ADR-010](ADR-010-measurable-resource-limits.md) (**Proposed**),
  [CTO-DECISION-006](CTO-DECISION-006-sprint-2.8-authorization.md)

# Decision

Resolve B-1 through B-4 and clarify member ordering. **ADR-010 remains Proposed. DG-4 remains
open.** This directive authorizes documentation and non-production benchmark evidence only.

# B-1 — One deterministic limit per profile

The floor-to-ceiling band is **removed**. A named AION Resource Limits Profile defines **one**
deterministic normative accept/reject boundary for every limit it owns.

For the same contract value or raw input, schema version, canonicalization profile,
resource-limits profile, and processing stage, all conforming implementations MUST reach the same
contract-level accept or reject outcome. There is no range in which one conforming implementation
may accept and another reject while both claim full conformance to the same profile.

Four categories replace the band:

| | Category | Nature |
|---|---|---|
| **A** | Encoding capacity | Mathematical. **Not an acceptance limit** |
| **B** | Normative profile limit | The one deterministic maximum accepted by the named profile |
| **C** | Deployment admission limit | Local operational control; may be stricter than B |
| **D** | Separately named reduced profile | A future, separately identified and versioned profile |

**Deployment admission rejection** occurs before or outside the conformance verdict, returns the
distinct outcome `policy-limit-exceeded`, is observable, does not claim the contract profile
rejected the value, and must not be confused with schema, canonical-validation, or framing
rejection.

`conformance-floor-unmet` is removed — it described an implementation rejecting below a floor, and
floors no longer exist.

**Profile identifier: `aion-resource-limits-1`.** The Sprint 2.8 draft `arlp-1` is renamed: a
three-letter contraction is easily confused with `acj-1` in prose and metadata, and the two version
independently. The identifier is part of conformance and fixture metadata, and is deliberately
**not** added to the Universal Object envelope — ADR-007's admission test requires a universal
field to be meaningful for every Object profile, and a limits identifier is a processing concern,
not a property of the record.

**No reduced profile is created.** §10.1's portability analysis found no contradiction that
lowering the normative values did not resolve.

# B-2 — Enforcement stages assigned

Every normative limit is assigned to an exact stage and owning subsystem: S0 raw input bytes,
depth, member, element and node counts; S1 schema and profile resolution; S2 identifier, string,
Unicode, timestamp, numeric and error-detail limits; S3 canonical output bytes and member ordering;
S4 frame field, context, payload and total lengths with overflow-safe arithmetic; S5 registered
algorithm and inherited digest input size. Batch count, in-flight operations, time budgets, queue
limits and quotas belong to deployment policy and are **not** forced into the canonical profile.

## The pre-parse structural scan

Byte-entry input MUST be structurally scanned **before a value tree is constructed**, enforcing
raw size, depth, members, elements and nodes in a single O(1)-memory pass.

This is required by a **measured** cross-runtime hazard. Node's `JSON.parse` is iterative and
bounded nothing — 1,000,000 levels parsed without error. CPython 3.13.7's `json.loads` is recursive
and raised `RecursionError` at depth **3,000** after succeeding at **2,990**, and that guard is
**not tunable**: `sys.setrecursionlimit(20000)` did not move it. Without the scan, a document at
depth 3,000 rejects at S0 in Python and reaches S1/S2 in Node, and AFX-1 §11 item 6 counts a
rejection-stage mismatch as a conformance failure between two *correct* implementations.

**Earliest enforceable stage:** S0 for Entry-B (bytes authoritative). **S1 for Entry-V** (structured
value authoritative) — there was no byte stream to scan, so limits are *verified* rather than
*prevented*. The residual risk is bounded: the caller materialized the value it is submitting, so
the allocation happened outside AION's path.

**Implementation strategy:** single-pass, iterative, overflow-safe counters. A recursive scan
overflows on exactly the shapes the depth limit exists to reject — measured: recursive failed at
8,000, iterative handled 200,000. Streaming is not required for the scan and not achievable for
canonicalization, which ACJ-1 §32 already concedes; the limit remains deterministic because the
scan runs before allocation regardless of host-parser behaviour.

# B-3 — Total value node defined

A **value node** is one complete value in the language-neutral contract value tree.

**Count** the root, every scalar, every object, every array, every object-member value recursively,
every array-element value recursively. **Do not count** member names, punctuation, whitespace,
parser tokens, raw bytes, canonical output bytes, frame fields, or provenance records not present
in the value.

`null` → 1 · `{"a": 1}` → 2 · `[1, 2]` → 3 · `{"a": [true, null]}` → 4

Member count, member-name length and element count remain separate limits. Total node count exists
to prevent bypass through combinations of many nested containers, small objects and small arrays.

Counting is **iterative, never recursive**, with overflow-safe counters. On exceeding, counting
stops at the crossing node and returns `limit-exceeded`; the crossing node is materialized only on
the Entry-V path, where it already existed. Boundary behaviour at limit−1 / limit / limit+1 was
**verified by execution**: `false / false / true`. The count must not differ across runtimes, and
the definition is arithmetic over the value tree, so it is runtime-independent by construction.

# B-4 — Workload evidence supplied

Six size classes (minimal, small, moderate, large, candidate-limit boundary, adversarial
over-limit) across six workload families (raw parsing, structural traversal and counting, canonical
member ordering and serialization proxy, frame construction, digest computation, early and late
rejection). 31 Node probes plus 16 CPython probes, 9 runs and 3 warm-up, with 10 of 10 harness
self-checks passing.

Every candidate number is classified as mathematically derived, encoding-derived,
benchmark-supported, security-conservative, workload-required, provisional, or deferred. A number
supported only by convenience, convention, or a power-of-two preference remains **provisional** —
L-05 and L-25 are so marked.

A **second-runtime probe** was authorized and run: CPython 3.13.7, standard library only, already
installed, no production dependency added. It is a proxy and is **not** described as proof of the
future production implementation.

# Member-ordering clarification

**This is a clarification, not a change of accepted semantics, and ADR-008 is therefore not
amended.**

ACJ-1 §2 as accepted already mandates UTF-16 code-unit ordering per RFC 8785 §3.2.3, already
states that implementations sorting by code point "will diverge on characters outside the Basic
Multilingual Plane and are non-conforming," and already excludes lexicographic Unicode ordering and
locale collation. The correction adds an explicit-comparator requirement and a worked example; it
narrows nothing and permits nothing new.

Added: member ordering is never host-default sort, code-point order, locale or culture-sensitive
collation, or UTF-8 byte order. A runtime whose native ordering is not UTF-16 code-unit order MUST
supply an explicit comparator; encoding to UTF-16 big-endian and comparing bytes is sufficient.

**Measured in both runtimes.** For keys `a` (U+0061), `` (U+E000), `￿` (U+FFFF) and `𐀀`
(U+10000, UTF-16 `D800 DC00`):

- Required UTF-16 order: `a`, `𐀀`, ``, `￿`
- Python default (code point): `a`, ``, `￿`, `𐀀` — **non-conformant**
- JavaScript default: matches the required order — **conformant by default**

Two implementations each sorting "correctly" by their own defaults would produce different
canonical bytes and different digests. The conformant Python comparator cost roughly 11× the
default sort. A normative fixture is **required** and recorded in the AFX-1 coverage matrix; none
is authored — normative fixtures remain unauthorized.

# Authorization Boundary

**Authorized:** documentation; non-production benchmark tooling under
`tools/benchmarks/resource-limits/`; benchmark execution and captured evidence; the readiness
review.

**Not authorized:** accepting ADR-010; closing DG-4; any fixture, normative or candidate; fixture
loader; conformance harness; production canonicalizer or validator; Identity, Object, or Memory
implementation; personal-data ingestion; job search or applications; database, storage, or
production dependency selection.

The implementation freeze remains active.

# Verification Evidence

```
$ npm run verify
# tests 12
# pass 12
# fail 0

$ node --expose-gc tools/benchmarks/resource-limits/workloads.mjs --out docs/benchmarks/resource-limits-workloads.json
Probes: 31  self-checks: 10/10 passed          exit 0

$ python tools/benchmarks/resource-limits/probe_python.py --out docs/benchmarks/resource-limits-python.json
Probes: 16  CPython 3.13.7  recursionlimit 1000  exit 0
```

Production typecheck clean; test typecheck clean. No production source, dependency, manifest, or
lockfile changed. No fixture exists. No fixtures directory exists.

# Gate status

| Gate | Status |
|---|---|
| DG-1 Identity bootstrap | **Open** |
| DG-2 Canonical serialization | **Closed** |
| DG-3 Representative fixtures | **Open.** Normative fixtures unauthorized |
| DG-4 Measurable limits | **Open.** ADR-010 Proposed |

The Universal Object Contract remains **pre-stable**.

# Review triggers

Physical testing on a lower-resource device; a third runtime; the member-count knee being located;
any deferred limit acquiring evidence; a production canonicalizer existing and proving slower than
the probes assumed; any request to close DG-4 or lift the freeze.
