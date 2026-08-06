# AION Resource Limits Profile 1 — `arlp-1`

Status: **Proposed** normative contract  
Profile identifier: `arlp-1`  
Profile version: 1  
Authority: [ADR-010](../decisions/ADR-010-measurable-resource-limits.md) (**Proposed**)  
Evidence: [resource-limits-evidence.md](../benchmarks/resource-limits-evidence.md)  
Implementation: **Not authorized.** No canonicalizer, validator, or enforcement code exists.

> **DG-4 is OPEN.** This profile contains numbers. A table containing numbers is not a closed
> gate. Values marked Proposed or Deferred are not accepted architecture.

## Responsibility

Define measurable, enforceable resource and complexity limits for AION canonical contract
processing **without binding the architecture to one machine, runtime, storage engine, or
deployment**.

Not a quota system, not a commercial plan, not authorization policy, not a storage budget, and
not a network transport limit.

## 1. Four categories — never conflated

| Category | Meaning | Who sets it | What it is **not** |
|---|---|---|---|
| **A. Encoding capacity** | The theoretical capacity of a representation field | Mathematics | **Not an authorization to accept values near it.** A `u32` can express 4 GiB; that is not permission to parse 4 GiB |
| **B. Universal safety ceiling** | A versioned hard maximum no conforming implementation may exceed for a named profile | This profile | Not a target. Its purpose is deterministic rejection and denial-of-service protection |
| **C. Required conformance floor** | The minimum capacity an implementation must support to claim conformance | This profile | Not a recommendation. An implementation rejecting below the floor **is not conformant** |
| **D. Deployment or owner policy limit** | A configurable limit, possibly stricter than B | The deployment or owner | Not a contract redefinition. Must be declared and observable |

A conforming implementation accepts everything up to **C**, may accept up to **B**, must reject
above **B**, and may be configured to reject above a **D** value that lies between C and B.

**Never conflate** representation capacity, safety ceiling, minimum supported capacity,
deployment quota, commercial plan limit, owner preference, storage quota, or network transport
limit. These are six different concepts and this profile governs only the first four.

## 2. Encoding capacity (category A — mathematical, no authorization)

| Field | Capacity | Source |
|---|---:|---|
| AION Frame `u32` textual length | 4,294,967,295 | ACJ-1 §23 rule 1 |
| AION Frame `u64` payload length | 18,446,744,073,709,551,615 | ACJ-1 §23 rule 1 |
| ACJ-1 integer domain | ±9,007,199,254,740,991 | ACJ-1 §7 |

**Evidence that capacity is not permission:** four literals above 2^53−1 parsed to different
values silently, 4 of 4. The encoding could carry them. The contract must not.

## 3. Limit surfaces, owners, and values

`Cat` = category. Owner is the **narrowest** subsystem that owns the limit — surfaces are not
forced into the universal Object contract.

### Canonical serialization — owned by ACJ-1

| ID | Surface | Cat | Floor (C) | Ceiling (B) | Unit | Stage | Status |
|---|---|---|---:|---:|---|---|---|
| L-01 | Raw input bytes | B,C,D | 4 MiB | 16 MiB | bytes | S0 | **Proposed** |
| L-02 | Canonical output bytes | B,C,D | 4 MiB | 16 MiB | bytes | S3 | **Proposed** |
| L-04 | Nesting depth | B,C,D | 32 | 64 | levels | S0–S2 | **Proposed** |
| L-05 | Object members per object | B,C,D | 1,024 | 4,096 | members | S0–S2 | **Proposed** |
| L-06 | Array elements per array | B,C,D | 16,384 | 65,536 | elements | S0–S2 | **Proposed** |
| L-07 | Total value nodes per document | B,C,D | 262,144 | 1,048,576 | nodes | S0–S2 | **Proposed** |
| L-08 | String UTF-8 byte length | B,C,D | 256 KiB | 1 MiB | bytes | S1–S2 | **Proposed** |
| L-09 | String Unicode scalar count | — | — | — | scalars | S1–S2 | **WITHDRAWN** — see §4 |
| L-10 | Member-name length | B,C,D | 256 | 1,024 | bytes | S1–S2 | **Proposed** |
| L-11 | Identifier length | B,C,D | 256 | 1,024 | bytes | S1–S2 | **Proposed** |
| L-24 | Parser token count | B,D | — | 4,194,304 | tokens | S0 | **Deferred** — not measured |
| L-25 | Normalization expansion budget | B,C | 2× | 4× | ratio | S2 | **Proposed** |

### Framing — owned by ACJ-1 §23

| ID | Surface | Cat | Floor (C) | Ceiling (B) | Unit | Stage | Status |
|---|---|---|---:|---:|---|---|---|
| L-03 | Framed digest input bytes | B,C | L-02 floor + 32 + fields | L-02 ceiling + 32 + fields | bytes | S4 | **Proposed** |
| L-12 | Frame textual field length | B | 1,024 | 1,024 | bytes | S4 | **Accepted** — already ACJ-1 §23 rule 3 |
| L-13 | Frame context length | B | 0 | 1,024 | bytes | S4 | **Accepted** — already ACJ-1 §23 rule 3 |
| L-15 | Profile identifier length | B | — | 1,024 | bytes | S4 | Subsumed by L-12 |
| L-13a | Contract-family identifier length | B | — | 1,024 | bytes | S4 | Subsumed by L-12 |
| L-14a | Contract-version identifier length | B | — | 1,024 | bytes | S4 | Subsumed by L-12 |

L-03 is derived, not independent: the frame is the payload plus 32 bytes of length prefixes
plus the six textual fields. Stating it separately would create a second number that could
drift out of agreement with L-02.

### Object model — owned by the Universal Object Contract

| ID | Surface | Cat | Value | Status |
|---|---|---|---|---|
| L-17 | Provenance field length | B,C,D | — | **Deferred** — Object contract has no provenance size rule yet |
| L-18 | Relationship endpoint count | B,D | — | **Deferred** — relationship cardinality is descriptor-owned |
| L-19 | Aggregate relationship count | B,D | — | **Deferred** — requires workload evidence that does not exist |
| L-20 | History retrieval page size | D | — | **Deferred** — a query concern, not a canonicalization one |

These are listed to record that they were considered and **assigned to their owner rather than
absorbed into this profile**. Forcing them here would put query and cardinality concerns inside
the serialization contract.

### Fixture corpus — owned by AFX-1

| ID | Surface | Cat | Value | Status |
|---|---|---|---|---|
| L-21 | Inline hex evidence size | B | 4,096 bytes decoded | **Proposed** — already AFX-1 §1 literal cap |
| L-22 | Corpus record size | B | — | **Deferred** |
| L-23 | Corpus release size | D | — | **Deferred** |

### Runtime and deployment — owned by a future host

| ID | Surface | Cat | Value | Status |
|---|---|---|---|---|
| L-16 | Error-detail size | B | 4 KiB | **Proposed** |
| L-26 | Processing time budget | D | — | **Deferred** — unmeasurable without an implementation |
| L-27 | Batch item count | D | — | **Deferred** |
| L-28 | Memory-amplification factor cap | B | — | **Deferred** — see §5 |
| L-29 | Simultaneous in-flight operations | D | — | **Deferred** — no server exists |
| L-30 | Cancellation responsiveness | B | — | **Deferred** — no cancellable implementation exists |

## 4. Derivations

Every Proposed number below states its basis. Numbers without one are Deferred.

**L-04 nesting depth — floor 32, ceiling 64.** A recursive traversal failed at **8,000** with
`RangeError` and survived at 4,000; `JSON.parse` bounded nothing up to 1,000,000. The binding
constraint is *traversal*, not parsing, and the runtime provides no protection — this is the
single most useful measurement in the sprint.

**The margin must be stated per runtime, not as one number.** 64 leaves ~125× headroom against
V8's stack on this machine. That multiple does **not** transfer: it is a property of V8's stack
size and this probe's frame size. A conforming implementation must declare its frames-per-level
or use an explicit stack rather than recursion. Independent review measured CPython 3.13.7
raising `RecursionError` at depth 2,999 for `json.loads`, unchanged by `sys.setrecursionlimit`
— a fixed C-level guard. That is **not** a measurement this sprint performed and is recorded as
a review finding requiring confirmation, but if correct it reduces the margin to ~46× before any
AION traversal frames are added.

**L-05 members — floor 1,024, ceiling 4,096. RATIFIED, NOT DERIVED.** Per-member cost is flat
at **164–168 ns and ~72 bytes** from 1,024 through 4,096, rising to **288 ns** at 65,536. There
is no discontinuity at 4,096 — it measured *faster* than 4,095, which is noise. The knee lies
somewhere between 4,096 and 65,536 and **was not located**; the octaves in between were never
measured. This value is the ACJ-1 §31 provisional number, retained because the sweep found no
reason to move it, **not** because a cost transition selects it.

> An earlier draft justified 4,096 by an "amplification plateau at 49×". That was an artifact
> twice over: the memory metric was broken (see evidence §4), and the residual ratio difference
> tracked key-name digit length (`"m0"` vs `"m4095"`), not member count. Per-member heap differs
> by 0.47% across the sweep. The derivation was void and is withdrawn.

**L-06 array elements — floor 16,384, ceiling 65,536.** `largeArray(65536)` cost 1.040 ms at
12.4× amplification; 1,000,000 elements cost 21.994 ms. Arrays are markedly cheaper per element
than object members, which is why this ceiling is 16× L-05.

**L-07 total value nodes — floor 262,144, ceiling 1,048,576.** This limit exists because L-04,
L-05, and L-06 are **individually satisfiable and jointly bypassable**. `deepAndWide(6,6)` and
`manySmallContainers(100000)` both stay within every per-container limit while reaching 25×
amplification and multi-millisecond cost. Without a total-node bound the other three can be
combined without limit.

**L-08 string bytes — floor 256 KiB, ceiling 1 MiB.** Carried from ACJ-1 §31, provisional.

**L-09 string scalar count — WITHDRAWN.** An earlier draft set it to 1,048,576, equal to L-08,
and cited the measured ~3× byte/scalar divergence as justification. That was wrong: UTF-8
encodes every scalar in at least one byte, so `scalarCount ≤ byteCount` **always**, and a
scalar limit equal to the byte limit can never fire independently. It was mathematically dead.
If a scalar limit is wanted it must be set *strictly below* L-08, sized from the measured
divergence and from the per-scalar NFC-verification rate. **No value is proposed here**, and a
cross-limit invariant `L-09 < L-08` must be stated before one is.

**L-25 normalization expansion — floor 2×, ceiling 4×.** Observed NFKD expansion was **1.5×** on
a known expanding sequence. 4× is deliberate headroom over the single expansion factor measured,
because the probe tested one sequence and Unicode contains worse. This number is the weakest
Proposed value in the profile and is flagged accordingly.

**L-16 error-detail size — 4 KiB.** Not performance-derived. It exists so an oversized
attacker-controlled input cannot be reflected back through an error channel. 4 KiB is enough for
a category, a location, and a correlation identifier, and far too small to echo a 16 MiB payload.

**L-01 / L-02 raw and canonical bytes — floor 4 MiB, ceiling 16 MiB.** Carried from ACJ-1 §31,
where they were explicitly provisional. Measured cost at 16 MiB: frame build 6.271 ms, digest
4.445 ms, hex encode 16.874 ms. All are tolerable on this machine. **The floor of 4 MiB is the
portability-driven number**; the ceiling is inherited rather than independently derived, and is
the value most likely to change when a low-resource target is actually measured.

**No number in this profile was chosen because it is a power of two.** Several *are* powers of
two because they bound counts that are naturally binary and because round numbers are easier to
reason about at a boundary — but each has a stated basis above, and the basis is never "it looked
tidy."

## 5. Values that remain Proposed or Deferred, and why

| ID | Why not settled |
|---|---|
| L-01, L-02 | Ceiling inherited from ACJ-1 §31 provisional values; no low-resource target measured |
| L-24 parser token count | Not measured. Token count is parser-specific and would couple the contract to a parser model |
| L-25 | Derived from a single expansion sequence; Unicode contains worse cases not enumerated |
| L-26 time budget | Meaningless without an implementation; a budget measured against `JSON.parse` would be a lower bound masquerading as a ceiling |
| L-27, L-29 | No batching path, no server, no scheduler exists |
| L-28 amplification cap | Amplification is allocator- and GC-dependent and varied 2.3×–56.4× across shapes. A single cap would either be trivially loose or would fail on a shape it was never measured against |
| L-30 cancellation | No cancellable implementation exists to measure responsiveness against |
| L-17 – L-20, L-22, L-23 | Owned by other subsystems; assigned rather than absorbed |

**Every number above is Proposed. None is accepted architecture.** ADR-010 is Proposed and DG-4
is open.

## 6. Inclusivity — stated exactly

For every limit *N* in this profile:

- a value **strictly below** *N* is accepted;
- a value **exactly equal to** *N* is **accepted**;
- a value **strictly above** *N* is **rejected**.

The limit is the largest accepted value. Boundary fixtures must therefore cover *N*−1 (accept),
*N* (accept), and *N*+1 (reject).

No limit in this profile uses "approximately", "reasonable", "large", "sensible", or any other
unmeasurable term. Where a value is not known it is marked Deferred, not softened.

## 7. Invariants for limit handling

1. Limits are checked **before unbounded allocation** wherever practical. Evidence: late
   rejection cost ~100× early rejection (0.523 ms vs 0.005 ms).
2. Rejection is **deterministic** for the same profile and input.
3. Implementations **fail closed**.
4. Integer arithmetic in length calculations is **overflow-safe**; length arithmetic uses a width
   that cannot wrap.
5. Limits apply to **decoded values as well as encoded bytes** where both are meaningful.
6. **Compression cannot bypass decoded-size limits.** A decompressed-size bound is required
   before any compressed input path is admitted.
7. **Unicode byte and scalar limits remain distinct** (L-08, L-09) and neither implies the other.
8. **Nested structures cannot bypass total-node limits** (L-07).
9. **Many small members cannot bypass total-byte limits.**
10. **One large string cannot bypass member-count limits.**
11. A deployment limit (D) may be **lower** than a universal ceiling (B), **never higher**.
12. A stricter deployment limit **must be discoverable** — an operation rejected by policy must
    be distinguishable from one rejected by the contract.
13. **Error messages must not reproduce oversized attacker-controlled input** (L-16).
14. **Rejection must not emit canonical bytes, frames, or digests.** Consistent with AFX-1's
    rejection-fixture rule.
15. **Boundary behaviour is defined at *N*−1, *N*, and *N*+1** (§6).
16. **Limit-profile versions are explicit.** `arlp-1` advances on any change to a Proposed or
    Accepted value.
17. A profile migration **cannot silently reinterpret an immutable object**. A Version or Event
    Object canonicalized under `arlp-1` retains its recorded profile; raising a ceiling later
    does not retroactively change what was valid.
18. **Limits are not credentials, permissions, or authorization policy.** Being under a limit
    grants nothing.
19. **Resource exhaustion must not be reported as not-found or as validation success.** It has
    its own outcome.
20. **Cancellation remains responsive** during adversarial input processing — specified, and
    currently unmeasurable.

## 8. Stable outcomes

| Outcome | Meaning |
|---|---|
| `limit-exceeded` | A universal ceiling (B) was exceeded. Already an ACJ-1 §33 category |
| `policy-limit-exceeded` | A deployment limit (D) stricter than the ceiling was exceeded. **Distinct from `limit-exceeded`** so invariant 12 holds |
| `conformance-floor-unmet` | An implementation rejected below the required floor (C). A conformance failure of the implementation, not of the input |

Outcomes carry the limit **identifier** and the **category**, never the offending value.

## 9. Migration and review

Raising a ceiling is backward-compatible for stored data and forward-incompatible for older
readers. Lowering a ceiling **invalidates previously valid data** and requires the same
treatment as a breaking contract change: a new profile version, coexistence, and an explicit
migration.

Review triggers: a low-resource target being measured; a second runtime being measured; any
Deferred value acquiring evidence; a recursive-parser runtime failing the L-04 floor; a
production canonicalizer existing and being slower than the probes assumed; ACJ-1 §29–§31 being
updated to match this profile.

## 10. Relationship to ACJ-1 §29–§31

ACJ-1 §29–§31 currently states depth 64, 4,096 members, 65,536 array elements, 1 MiB string,
16 MiB total, marked **provisional**. This profile keeps those values as ceilings and adds what
was missing: a conformance floor, a total-node bound, a scalar-count limit distinct from bytes,
explicit inclusivity, ownership assignment, and derivations.

**ACJ-1 §29–§31 is not amended by this profile while ADR-010 is Proposed.** The invariant stated
in [ADR-008](../decisions/ADR-008-canonical-serialization.md) — that DG-4 limits must be less
than or equal to the canonicalizer's — holds: every ceiling here equals or is below the ACJ-1
value.
