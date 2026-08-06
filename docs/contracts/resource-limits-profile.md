# AION Resource Limits Profile — `aion-resource-limits-1`

Status: **Proposed** normative contract  
Profile identifier: `aion-resource-limits-1`  
Profile version: 1  
Supersedes identifier: `arlp-1` (Sprint 2.8 draft; renamed for stability — see §11)  
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

Replaces the Sprint 2.8 floor-to-ceiling band, which readiness finding B-1 showed contradicts
ACJ-1 §Conformance and §34.

| Category | Meaning | Who sets it | What it is **not** |
|---|---|---|---|
| **A. Encoding capacity** | The mathematical capacity of a representation field | Mathematics | **Not an acceptance limit.** A `u32` can express 4 GiB; that is not permission to parse 4 GiB |
| **B. Normative profile limit** | The **one deterministic maximum accepted** by this named profile | This profile | Not a range. Exactly one number per surface |
| **C. Deployment admission limit** | A local operational control, may be stricter than B | The deployment or owner | **Not a contract verdict.** See §1.1 |
| **D. Separately named reduced profile** | A low-resource conformance tier | A future, separately identified and versioned profile | **Not a deployment setting.** See §1.2 |

### The determinism rule

For the same **contract value or raw input**, **schema version**, **canonicalization profile**,
**resource-limits profile**, and **processing stage**, every conforming implementation MUST
reach the same contract-level accept or reject outcome.

There is **no range** in which one conforming implementation may accept and another may reject
while both claim full conformance to the same profile. This is what ACJ-1 §Conformance
("byte-identical output … reject every value outside the domain with the specified deterministic
error") and §34 ("agree byte-for-byte on the full fixture set, including every rejection case")
already require, and the band violated.

### 1.1 Deployment admission is not contract rejection

A deployment admission rejection:

- occurs **before or outside** the normative contract-conformance verdict;
- returns the distinct operational outcome `policy-limit-exceeded`;
- is **observable** to the caller and to the owner;
- **does not claim that the contract profile rejected the value**;
- must not be confused with schema, canonical-validation, or framing rejection.

An input rejected by deployment admission is not evidence that the value is non-conformant.
Another deployment running the same profile may accept it, and both are conformant, because
admission ran outside the verdict.

### 1.2 Reduced profiles

A low-resource conformance tier may exist **only** as a separately identified and versioned
resource-limits profile with its own deterministic limits — never as a deployment configuration
of this one.

**No reduced profile is created by this sprint.** §10's portability analysis found no
contradiction requiring one; the normative limits were instead set conservatively enough to hold
on the documented lower-resource target.

**Never conflate** representation capacity, normative profile limit, deployment admission quota,
commercial plan limit, owner preference, storage quota, or network transport limit. These are
seven distinct concepts and this profile governs the first two plus the admission boundary.

### 1.3 Profile identity

The profile identifier `aion-resource-limits-1` is part of **conformance and fixture metadata**.
It MUST appear in AFX-1 `subjectBinding` for any fixture asserting a limit, and in conformance
evidence.

It is **not** added to the Universal Object envelope. ADR-007's admission test requires a
universal field to be meaningful for every Object profile, bounded, and stable; a limits
identifier is a processing concern, not a property of the record, and adding it for convenience
is exactly the God-Object accretion that test exists to prevent.

## 2. Encoding capacity (category A — mathematical, no authorization)

| Field | Capacity | Source |
|---|---:|---|
| AION Frame `u32` textual length | 4,294,967,295 | ACJ-1 §23 rule 1 |
| AION Frame `u64` payload length | 18,446,744,073,709,551,615 | ACJ-1 §23 rule 1 |
| ACJ-1 integer domain | ±9,007,199,254,740,991 | ACJ-1 §7 |

**Evidence that capacity is not permission:** four literals above 2^53−1 parsed to different
values silently, 4 of 4. The encoding could carry them. The contract must not.

## 3. Limit surfaces — one deterministic value each

`Stage` sections below assign the exact processing stage that owns enforcement (B-2). `Ev` is the
evidence classification: **M** mathematically derived, **E** encoding-derived, **B**
benchmark-supported, **S** security-conservative, **W** workload-required, **P** provisional,
**D** deferred.

Inclusivity for every row: **accepted below, accepted at, rejected above.**

### S0 — Raw input bytes

| ID | Surface | Limit | Unit | Outcome | Deployment override | Ev |
|---|---|---:|---|---|---|---|
| L-01 | Maximum raw input bytes | **4 MiB** | bytes | `limit-exceeded` | Stricter only | **B,S** |
| L-04 | Nesting depth (pre-parse scan) | **64** | levels | `limit-exceeded` | Stricter only | **B,S** |
| L-05 | Object members per object | **4,096** | members | `limit-exceeded` | Stricter only | **P** |
| L-06 | Array elements per array | **65,536** | elements | `limit-exceeded` | Stricter only | **B** |
| L-07 | Total value nodes per document | **262,144** | nodes | `limit-exceeded` | Stricter only | **B,S** |
| — | Permitted input encoding | UTF-8, no BOM | — | `invalid-string` | No | **M** |
| — | Trailing raw content | none permitted | — | parse rejection | No | **M** |
| L-24 | Parser token count | — | tokens | — | — | **D** — parser-specific; would couple the contract to a parser model |

Depth, member, element, and node limits are enforced by a **pre-parse structural scan** (§4), so
their rejection stage is S0 for byte-entry input regardless of runtime.

### S1 — Parsed contract value, schema and profile resolution

| Surface | Rule | Outcome | Ev |
|---|---|---|---|
| Unknown schema or profile | fail closed | `unsupported-*` | **M** |
| Structural shape discovery | re-verifies L-04–L-07 | `limit-exceeded` | **M** |

S1 re-verifies rather than re-measures. For structured-value (Entry-V) input there was no byte
stream to scan, so S1 is the **earliest enforceable stage** on that path. This asymmetry between
the two entry paths is deliberate and is analysed in §4.

### S2 — Canonical contract validation

| ID | Surface | Limit | Unit | Outcome | Ev |
|---|---|---:|---|---|---|
| L-08 | String UTF-8 byte length | **1 MiB** | bytes | `limit-exceeded` | **B** |
| L-09 | String Unicode scalar count | — | scalars | — | **D** — withdrawn, see §5 |
| L-10 | Member-name length | **1,024** | bytes | `limit-exceeded` | **S** |
| L-11 | Identifier length | **256** | bytes | `invalid-identifier` | **S** |
| L-16 | Validation error-detail size | **512** | bytes | — | **S** |
| L-25 | Normalization expansion budget | **4×** | ratio | `limit-exceeded` | **P** |
| — | Numeric range | ±(2^53−1) | — | `integer-out-of-range` | **M** — ACJ-1 §7 |
| — | Prohibited binary-float positions | none permitted | — | `unsupported-value-kind` | **M** — ACJ-1 §8 |
| — | Timestamp constraints | exactly 3 fractional digits, `Z` | — | `invalid-timestamp` | **M** — ACJ-1 §14 |
| — | Unicode constraints | NFC required | — | `invalid-string` | **M** — ACJ-1 §4 |

### S3 — Canonical serialization

| ID | Surface | Limit | Unit | Outcome | Ev |
|---|---|---:|---|---|---|
| L-02 | Maximum canonical output bytes | **4 MiB** | bytes | `limit-exceeded` | **B,S** |
| — | Deterministic member ordering | UTF-16 code units | — | non-conformance | **M,B** — ACJ-1 §2 |
| — | Canonical serialization expansion | bounded by L-02 | — | `limit-exceeded` | **M** |

### S4 — AION Frame v1 construction

| ID | Surface | Limit | Unit | Outcome | Ev |
|---|---|---:|---|---|---|
| L-12 | Frame textual field length | **1,024** | bytes | `frame-length-overflow` | **M** — ACJ-1 §23 rule 3 |
| L-13 | Framing context length | **1,024** (0 permitted) | bytes | `frame-length-overflow` | **M** — same field class as L-12 |
| L-03 | Framed input total length | **L-02 + 32 + field bytes** | bytes | `frame-length-overflow` | **M** |
| — | Overflow-safe length arithmetic | non-wrapping width | — | `frame-length-overflow` | **M** |
| — | Truncation / trailing bytes | rejected | — | `frame-truncated` / `frame-trailing-bytes` | **M** |

L-13 is not an independent limit. It is L-12 applied to the `Context` field, which is one of the
six textual fields, and carries the same number by construction. It is listed separately only for
navigability — resolving readiness finding NB-1.

### S5 — Digest calculation

| Surface | Rule | Ev |
|---|---|---|
| Registered digest algorithm | registry-resolved, unknown fails closed | **M** — ACJ-1 §37 |
| Digest input size | inherited from the valid frame | **M** |

S5 introduces **no independent size limit**. A frame that passed S4 is already bounded, and a
second number could drift out of agreement with L-03.

### Deployment or workflow policy — category C, not this profile

Batch item count; simultaneous in-flight operations; per-request time budgets; queue limits;
service quotas; owner-selected stricter admission limits.

Deliberately given no numbers here. Forcing them into the canonical profile would turn a local
operational choice into a contract verdict.

### Other subsystems — assigned, not absorbed

| ID | Surface | Owner | Status |
|---|---|---|---|
| L-17 | Provenance field length | Universal Object Contract | **D** |
| L-18 | Relationship endpoint count | Relationship descriptors | **D** |
| L-19 | Aggregate relationship count | Object Contract | **D** — needs workload evidence |
| L-20 | History retrieval page size | Query layer | **D** |
| L-21 | Inline hex evidence size | AFX-1 §1 | 4,096 bytes decoded — already stated there |
| L-22 | Corpus record size | AFX-1 | **D** |
| L-23 | Corpus release size | AFX-1 | **D** |

## 4. Enforcement stages and pre-allocation feasibility

### The pre-parse structural scan

Byte-entry (S0) input MUST be structurally scanned **before a value tree is constructed**,
enforcing L-01, L-04, L-05, L-06 and L-07 in a single pass with O(1) memory.

This exists because of a **measured** cross-runtime hazard. Node's `JSON.parse` is iterative and
bounded nothing — it parsed 1,000,000 levels of nesting without error. CPython 3.13.7's
`json.loads` is recursive and raised `RecursionError` at depth **3,000**, having succeeded at
**2,990** — and that guard is **not tunable**: `sys.setrecursionlimit(20000)` did not move it, so
it is a fixed C-level limit.

Without a pre-parse scan, a document at depth 3,000 rejects at **S0 in Python** and reaches
**S1/S2 in Node**. AFX-1 §11 item 6 requires matching rejection stage, so two *correct*
implementations would fail conformance against each other. The scan makes the stage deterministic
rather than a property of the host parser.

### Earliest enforceable stage, per entry path

| Entry path | L-01, L-04–L-07 enforced at | Residual risk |
|---|---|---|
| **Entry-B** (raw bytes authoritative) | **S0**, by the pre-parse scan | None known. The scan sees bytes before any allocation |
| **Entry-V** (structured value authoritative) | **S1** | The value already exists, so limits are *verified*, not *prevented*. The caller materialized it — outside AION's allocation path, and outside this threat model because the caller constructed the value it is submitting |

### Required implementation strategy

- The scan is **single-pass and iterative**. A recursive scan would overflow on exactly the shapes
  the depth limit exists to reject — measured: a recursive walker failed at depth 8,000 while an
  iterative one handled 200,000.
- Counters are **overflow-safe**, in a width that cannot wrap.
- Streaming is **not required** for the scan and **not achievable** for canonicalization: ACJ-1
  §32 already concedes member sorting needs every member before any byte is emitted. The scan is
  streaming-compatible; canonicalization is bounded-buffer, and L-02 is that buffer's bound.
- Because the scan is deterministic and runs before allocation, the limit stays deterministic
  regardless of the host parser's own behaviour.

## 4.1 Total value node — normative definition

Resolves readiness finding B-3.

A **value node** is one complete value in the language-neutral contract value tree.

**Count:** the root value as one node; every scalar value; every object value; every array value;
every object-member value recursively; every array-element value recursively.

**Do not count:** object member names; punctuation; whitespace; parser tokens; raw bytes;
canonical output bytes; AION frame fields; provenance records not present in the value being
counted.

| Value | Nodes |
|---|---:|
| `null` | 1 |
| `{"a": 1}` | 2 — object root 1 + numeric value 1 |
| `[1, 2]` | 3 — array root 1 + two numeric values |
| `{"a": [true, null]}` | 4 — object root 1 + array value 1 + boolean 1 + null 1 |

Object-member count (L-05), member-name length (L-10) and array-element count (L-06) remain
**separate** limits. Total node count (L-07) exists to prevent bypass through combinations of many
nested containers, small objects and small arrays — a shape that satisfies every per-container
limit while accumulating unbounded total cost.

### Counting requirements

- **Iterative, never recursive.** Verified: a recursive counter failed at depth 8,000; the
  iterative counter handled 200,000.
- **Overflow-safe counters.**
- On exceeding the limit, counting **stops at the crossing node** and returns `limit-exceeded`.
- The crossing node **is** materialized on the Entry-V path — it already existed. On the Entry-B
  path the scan counts structure without materializing values at all.
- Cancellation is checked between nodes. Latency is **unavailable** — no cancellable
  implementation exists.
- **Boundary behaviour** at limit−1, limit and limit+1 was verified by execution:
  `false / false / true` for *exceeded*, confirming accepted-below, accepted-at, rejected-above.
- The count **must not differ across runtimes.** The definition is arithmetic over the value tree
  and is runtime-independent by construction.

Measured counting cost: **~10–13 ns and ~22–29 bytes per node**. At L-07 = 262,144 nodes that is
**2.557 ms and roughly 6.4 MB** on the benchmark machine.

## 5. Values that remain provisional or deferred

### Provisional — a number is stated but the evidence does not select it

| ID | Value | What is missing |
|---|---|---|
| L-05 members | 4,096 | The cost knee was **never located**. Per-member cost is flat at 164–168 ns from 1,024 through 4,096 and rises to 288 ns only at 65,536; the octaves between were not measured. 4,096 measured *faster* than 4,095 — noise, not a discontinuity. This ratifies the ACJ-1 §31 value; it does not derive it |
| L-25 expansion | 4× | Derived from a single NFKD expansion sequence measuring 1.5×. Unicode contains worse cases that were not enumerated, and `acj-1` performs no normalization — only verification — so the operation being bounded is normalize-and-compare, not normalization |

### Withdrawn

**L-09 string Unicode scalar count.** An earlier draft set it to 1,048,576 — equal to L-08 — and
cited the measured ~3× byte/scalar divergence as justification. That was wrong: UTF-8 encodes every
scalar in at least one byte, so `scalarCount ≤ byteCount` **always**, and a scalar limit equal to
the byte limit can never fire independently. It was mathematically dead.

If a scalar limit is wanted it must be set **strictly below** L-08, sized from the measured
divergence and the per-scalar NFC-verification rate, with a cross-limit invariant `L-09 < L-08`
stated. **No value is proposed.**

### Deferred — no number, and why

| ID | Surface | Why |
|---|---|---|
| L-24 | Parser token count | Token count is parser-specific; a limit would couple the contract to a parser model |
| L-26 | Processing time budget | Meaningless without an implementation. A budget measured against `JSON.parse` would be a lower bound presented as a ceiling |
| L-27, L-29 | Batch count, in-flight operations | No batching path, no server, no scheduler exists |
| L-28 | Memory-amplification cap | Amplification is allocator- and GC-dependent and ranged 1.16×–14.6× across shapes. A single cap would be either trivially loose or untested against the shape that breaks it |
| L-30 | Cancellation responsiveness | No cancellable implementation exists to measure |
| L-17–L-20, L-22, L-23 | Object and corpus surfaces | Owned by other subsystems; assigned rather than absorbed |

**Every value in this profile is Proposed.** ADR-010 is Proposed and DG-4 is open.

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
11. A deployment admission limit (C) may be **lower** than the normative profile limit (B), **never higher**.
12. A stricter deployment admission limit **must be discoverable**, and an operation rejected by
    admission must be distinguishable from one rejected by the contract — hence the distinct
    `policy-limit-exceeded` outcome. Discovery is to the authenticated owner, **not** in the
    rejection returned to an untrusted caller, which would be reconnaissance.
13. **Error messages must not reproduce oversized attacker-controlled input** (L-16).
14. **Rejection must not emit canonical bytes, frames, or digests.** Consistent with AFX-1's
    rejection-fixture rule.
15. **Boundary behaviour is defined at *N*−1, *N*, and *N*+1** (§6).
16. **Limit-profile versions are explicit.** `aion-resource-limits-1` advances on any change to a
    stated value.
17. A profile migration **cannot silently reinterpret an immutable object**. A Version or Event
    Object canonicalized under `aion-resource-limits-1` retains its recorded profile; raising a limit later
    does not retroactively change what was valid.
18. **Limits are not credentials, permissions, or authorization policy.** Being under a limit
    grants nothing.
19. **Resource exhaustion must not be reported as not-found or as validation success.** It has
    its own outcome.
20. **Cancellation remains responsive** during adversarial input processing — specified, and
    currently unmeasurable.

## 8. Stable outcomes

| Outcome | Category | Meaning |
|---|---|---|
| `limit-exceeded` | B | The normative profile limit was exceeded. **This is the contract verdict.** Already an ACJ-1 §33 category |
| `policy-limit-exceeded` | C | A deployment admission limit stricter than the profile was exceeded. **Distinct from `limit-exceeded`**, occurs before or outside the conformance verdict, and does **not** assert that the profile rejected the value |

`conformance-floor-unmet` is **removed**. It existed only to describe an implementation rejecting
below a conformance floor, and floors no longer exist — there is one deterministic value per
surface, so an implementation either matches it or is non-conformant.

Outcomes carry the limit **identifier** and the **category**, never the offending value. Error
detail is bounded by L-16 at 512 bytes.

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

ACJ-1 §29–§31 states depth 64, 4,096 members, 65,536 array elements, 1 MiB string and 16 MiB
total, all marked **provisional**.

This profile keeps depth, members, elements and string byte length at those values, and sets raw
input and canonical output **lower** — 4 MiB rather than 16 MiB — on portability grounds (§10.1).
It adds what was missing: a single deterministic value per surface, a total-node bound, exact
inclusivity, stage ownership, and stated derivations.

The [ADR-008](../decisions/ADR-008-canonical-serialization.md) invariant that DG-4 limits must be
**less than or equal to** the canonicalizer's holds: every value here equals or is below the ACJ-1
number. **ACJ-1 §29–§31 is not amended while ADR-010 is Proposed.**

## 10.1 Low-resource portability

The documented lower-resource evaluation target, **not physically tested**:

- 4 GB memory class
- two logical cores
- interpreted or otherwise slower runtime
- no GPU, no database, local-only processing

Assessment does **not** scale benchmark-machine performance linearly. Where a limit could not be
justified on that target, the value was **lowered** rather than kept.

| Limit | Benchmark machine | Assessment on the 4 GB / 2-core target |
|---|---|---|
| L-01/L-02 **4 MiB** | 16 MiB cost 5.2 ms frame + 5.2 ms digest + 16.3 ms hex | **Lowered from 16 MiB.** A 16 MiB document implies a ≥32 MiB canonical buffer plus a ≥32 MiB frame buffer; with two cores and no concurrency bound that is an unreasonable single-request footprint on a 4 GB device. 4 MiB is the largest value defensible without a time budget |
| L-04 **64** | recursive walk failed at 8,000 | **Holds with wide margin.** CPython's fixed guard is 2,990 — a 46× margin before AION's own traversal frames. A slower runtime does not reduce a depth margin |
| L-05 **4,096** | 0.685 ms (Node), 0.502 ms (Python) | **Holds.** Python was *faster* than Node at this size. Remains provisional for the reason in §5, not for portability |
| L-06 **65,536** | 1.0 ms (Node), 3.77 ms (Python) | **Holds.** Python 3.8× slower but still low single-digit milliseconds |
| L-07 **262,144** | 2.557 ms, ~6.4 MB | **Lowered from 1,048,576.** The higher value costs 13.3 ms and ~22.8 MB per document on the benchmark machine; on a slower interpreted runtime with two cores that is a plausible stall, and with no in-flight bound (L-29 deferred) it multiplies |
| L-08 **1 MiB** | 0.555 ms parse | **Holds** |
| L-10 **1,024**, L-11 **256** | not directly measured | **Security-conservative.** L-11 lowered from 1,024: a UUID is 36 bytes and a namespaced type identifier is far under 256, so 1,024 had no domain justification |
| L-16 **512** | not measured | **Lowered from 4 KiB.** ACJ-1 §33 forbids echoing offending content absolutely; a conforming error is a category plus a location, which is tens of bytes. A 4 KiB budget implicitly licensed 4 KiB of reflected input — resolving readiness finding NB-3 |

**Cross-runtime timing was comparable**, not catastrophically divergent: Python ranged from 0.7×
to 1.4× Node at equal member counts. The portability risk is **not** raw speed — it is memory
footprint on a 4 GB device and the absence of any concurrency or time bound.

**No reduced profile was required.** No contradiction was found that lowering the normative values
did not resolve. A future reduced tier remains possible as a separately named profile (§1.2).

## 11. Profile identifier, versioning and migration

The identifier is `aion-resource-limits-1`. The Sprint 2.8 draft used `arlp-1`; the longer form is
adopted because a three-letter contraction is easy to confuse with `acj-1` in prose and in
metadata, and the two are versioned independently.

- The identifier is part of **conformance and fixture metadata**, not the Object envelope (§1.3).
- The profile advances to `aion-resource-limits-2` on **any** change to a stated value.
- Limits sit **outside** ACJ-1 §24's change trigger (§§1–20, §23), so this profile versions
  independently and a limits revision **does not invalidate a single retained digest**. This is
  the property that makes future revisions survivable and it is stated rather than inferred.
- **Raising** a limit is backward-compatible for stored data and forward-incompatible for older
  readers. **Lowering** a limit invalidates previously valid data and requires a new profile
  version, coexistence and an explicit migration.
- Limits are an **ingress control**. They MUST NOT be applied when verifying a retained digest or
  decoding a retained frame; frame decode bounds a declared length against the profile that
  produced it, never against a local deployment admission limit. Without this rule, tightening a
  limit would make an archived Object fail revalidation while its digest still verifies.

## 12. DG-4 status

**DG-4 is OPEN.** This profile does not close it.

DG-4's required evidence names maximum metadata, label count, provenance, extension, relationship
page and event sizes, plus benchmarked high-churn, high-degree, large-artifact, migration, export
and restore workloads. This sprint supplied canonicalization and framing limits with workload
evidence across six size classes and six workload families. It supplied **none** of the six Object
business-size classes and **none** of the six Object workload families — those are owned by the
Universal Object Contract and require an Object implementation that does not exist.
