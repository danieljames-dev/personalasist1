# CTO-DECISION-005: Fixture corpus architecture

- Status: Recorded
- Date: 2026-08-06
- Decision authority: Founder / CTO
- Subject: ADR-009 and the AFX-1 contract fixture corpus
- Related: [ADR-007](ADR-007-universal-object-model.md),
  [ADR-008](ADR-008-canonical-serialization.md),
  [ADR-009](ADR-009-contract-fixture-corpus.md),
  [CTO-DECISION-004](CTO-DECISION-004-sprint-2.7-authorization.md)

# Decision

Approve ADR-009 after resolving B-1, B-2, and B-3.

All three corrections are applied and the design re-reviewed across twenty dimensions; the
readiness review now returns APPROVE. On that basis:

- **ADR-009 status: Accepted**, dated 2026-08-06.
- **AFX-1 is the approved fixture corpus profile.**
- **Normative fixtures remain UNAUTHORIZED**, governed by a separate seven-condition gate.
- **DG-3 remains open.** DG-1 and DG-4 remain open.
- **The Universal Object Contract remains pre-stable.**
- **The implementation freeze remains in effect.**

# Parser-Stage Conformance Decision

**S0 requires matching rejection and stage, not matching parser-specific diagnostic
categories.**

Required cross-runtime agreement at S0 is limited to: the input is rejected; rejection occurs
at S0; parsing produces no usable contract value; no canonical bytes are produced; no AION
Frame is produced; no digest is produced.

Implementations are **not** required to emit an identical parser-specific error category at
S0. Standards-compliant parsers legitimately use different diagnostic taxonomies for
malformed UTF-8, duplicate members, malformed escapes, malformed numbers, and trailing
content. Requiring identical diagnostics would couple the corpus to particular parser
libraries and runtime languages.

A fixture may record `expectedStage: S0` and `expectedOutcome: reject`, and may carry a
**non-normative** `diagnosticHint` for human review. That hint never participates in a
conformance verdict; a harness failing a run on hint mismatch is non-conforming.

**At S1**, only error categories explicitly owned by an accepted AION schema-resolution or
profile-resolution contract are normative. **At S2 and later**, stable AION contract error
codes are fully normative, because `CanonicalContractValidatorV1` applies AION-defined
validation semantics.

Stable parser error codes MUST NOT be invented merely to make implementations appear uniform.

# Normative Fixture Authorization Boundary

**ADR-009 acceptance does not authorize creation of normative fixtures.**

Authorization for the first normative corpus remains blocked until all seven are satisfied:

1. DG-4 measurable limits are accepted where required by fixture boundaries.
2. The expected-value derivation and verification process is approved.
3. A normative fixture cannot become the sole oracle for its own correctness.
4. Digest-bearing fixtures have independently checkable canonical bytes, frame bytes, and
   framed digest input.
5. The initial corpus plan distinguishes candidate fixtures from normative released fixtures.
6. The applicable decimal or exact continuous-quantity decision exists before fixtures
   covering that value class are made normative.
7. Cross-runtime confirmation requirements are defined before a corpus release is labelled
   conformant.

The absence of a second runtime does not prevent **drafting** a future candidate fixture. It
does prevent **promoting** that fixture into a normative conformance release when the expected
result has not been independently reproduced.

**During Sprint 2.8** the following are prohibited: authoring candidate fixtures; authoring
normative fixtures; creating a fixtures directory; implementing a fixture loader; implementing
a conformance harness.

# Digest Evidence Decision

**Every digest-bearing fixture must contain enough evidence to audit the digest derivation
independently.** It must include or reference all eleven:

source contract value or authoritative source bytes; expected canonical bytes; expected AION
Frame v1 bytes; **expected complete framed digest input bytes**; digest algorithm identifier;
expected digest bytes; applicable canonicalization profile; contract family and version;
frame version; domain-separation purpose; optional domain context where applicable.

**The expected framed digest input is mandatory.** A final digest without the input that
produced it is insufficient, because it cannot reveal incorrect field ordering, incorrect
length prefixes, missing domain-separation fields, a wrong purpose, a wrong profile,
payload-boundary mistakes, or accidental hashing of canonical bytes without framing. Each of
those produces a well-formed digest of the wrong input.

The fixture schema **structurally prohibits** a digest-bearing acceptance fixture from
omitting its framed digest input: `expectedDigest` is representable only alongside
`expectedDigestInput`.

Five artifacts carry five distinct names and are never interchanged: **canonical bytes**,
**frame bytes**, **framed digest input**, **digest output**, and **corpus checksum**. An
ordinary corpus-file checksum is never called a contract digest.

**Normative clarification recorded during this decision:** under ACJ-1 §23 the framed digest
input *is* the AION Frame v1 byte sequence, so for `acj-1` and `FrameVersion` 1 the two fields
carry identical bytes. Both are required regardless, and a conforming loader must verify they
are byte-identical. Recording them separately makes the identity checkable rather than
assumed, and leaves room for a future frame version where a digest covers something other than
the bare frame.

# Rationale

## Why fixture architecture can be accepted before expected values are trusted

These are separable questions, and conflating them would stall the programme for the wrong
reason.

The architecture question is: *can a fixture express what it needs to express, without being
able to express a contradiction?* That is answerable now. The record is a closed discriminated
union; a rejection fixture cannot carry bytes it never produces; a digest cannot be recorded
without its input; duplicate members route to byte-authoritative fixtures because a parsed
value has already destroyed the fact under test. None of that depends on any fixture existing.

The trust question is: *is this particular expected digest correct?* That is not answerable
now, and will not be until a second independent implementation reproduces it. No amount of
schema design substitutes for that.

Accepting the architecture while blocking normative fixtures resolves the tension honestly.
It lets DG-4 and the expected-value process proceed against a settled target instead of
re-litigating the fixture shape, and it prevents the failure the readiness review identified:
ten hand-derived fixtures authored today, treated as the definition of correctness, and
discovered to be wrong by the first genuinely independent implementation.

B-3 sharpens the boundary further. Requiring the framed digest input converts "trust this
digest" into "recompute it yourself" — auditable by one reviewer with a hash function, with no
second implementation needed. That does not make the value *right*, but it catches the
specific error class the contract most fears, which is why B-3 closes now rather than waiting.

## Why parser diagnostics were the wrong thing to standardize

The original evidence contract required matching stable error categories wherever ACJ-1 §33
requires one. §33 was written for `CanonicalContractValidatorV1` — an S2 component operating
on an already-parsed value under AION-defined semantics. At S0 the actor is a JSON parser, and
AION owns none of its taxonomy.

Two correct implementations would fail conformance for a difference that is not a defect: one
reporting a lone surrogate as an encoding error, the other as a string error. Both reject.
Both reject at S0. Both are right.

Standardizing there would have produced fictional uniformity satisfiable by a mapping table,
and would have coupled AION conformance to specific parser libraries — the opposite of the
language neutrality the whole contract family exists to preserve.

# Authorization Boundary

## Authorized by this decision

The fixture corpus architecture and record schema; corpus organization, identifier, and
versioning rules; the subordinate decisions in ADR-009; future candidate-fixture work when
separately directed.

## Not authorized by this decision

Any normative fixture; any candidate fixture during Sprint 2.8; a fixtures directory; a
fixture loader; a conformance harness; any canonicalizer, validator, or digest implementation;
Identity, Object, Memory, Planner, Event Bus, Knowledge Graph, Capability Registry, Workflow
Engine, plugin, agent, persistence, or UI implementation; personal-data ingestion, job search,
or job applications; storage, database, transport, or second-runtime selection; closure of
DG-3.

The implementation freeze remains in effect. Only a separate recorded CTO decision lifts it.

# Remaining Gates

| Gate | Status |
|---|---|
| **DG-4 measurable limits** | Open. Sprint 2.8 addresses it; ADR-010 remains Proposed |
| **Expected-value derivation process** | Not defined. Blocks normative fixtures (gate condition 2) |
| **Independent reproduction** | Impossible today — no second runtime. Blocks promotion (condition 3, 7) |
| **Exact-decimal decision** | Open, carried from CTO-DECISION-003. Blocks fixtures covering that value class (condition 6) |
| **Cross-runtime release evidence** | Requirements defined in the fixture contract §11; not met |
| **Fixture-loader and harness design** | Not started, not authorized |
| DG-1 Identity bootstrap | Open, untouched |
| DG-3 Representative fixtures | **Open** |

# Verification Evidence

Recorded from actual command output.

```
$ npm run verify
# tests 11
# suites 1
# pass 11
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Production typecheck clean; test typecheck clean. No production source, dependency, manifest,
lockfile, or tooling changed. **No fixture, loader, or harness exists.** No fixtures directory
exists. No secrets, personal data, or machine-specific absolute paths in changed files.

## What this evidence does not establish

The passing suite covers the Kernel only. No test exercises any fixture, because none exists
and none is authorized. Cross-runtime agreement — the only thing that would make the corpus
evidence rather than intention — has never been demonstrated.

# Review Triggers

- **Parser-library changes** in either runtime, which could alter S0 rejection behaviour even
  though categories are non-normative.
- **Framing-version changes**, which would break the `expectedFrameBytes` /
  `expectedDigestInput` identity clarification and require re-examining §4.1.
- **Profile migrations** (`acj-1` → `acj-2`), which require paired fixtures for every existing
  acceptance fixture.
- **The first normative corpus release**, which must satisfy all seven gate conditions.
- A second runtime being selected, activating independent reproduction.
- Any proposal to author a fixture before its gate conditions are met.
