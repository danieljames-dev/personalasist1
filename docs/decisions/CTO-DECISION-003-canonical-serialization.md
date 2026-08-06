# CTO-DECISION-003: Canonical serialization approval

- Status: Recorded
- Date: 2026-08-06
- Decision authority: Founder / CTO
- Subject: ADR-008 and the ACJ-1 canonical serialization contract
- Supersedes: Nothing
- Related: [CTO-DECISION-002](CTO-DECISION-002-sprint-2.5-approval.md),
  [ADR-007](ADR-007-universal-object-model.md),
  [ADR-008](ADR-008-canonical-serialization.md)

# Decision

Approve ADR-008 after resolving B-1, B-2, and B-3.

The
[Canonical Serialization Readiness Review](../reviews/canonical-serialization-readiness-review.md)
returned APPROVE WITH CHANGES with three blocking findings. All three corrections have been
applied and the design re-reviewed against fifteen dimensions; the review now returns
APPROVE.

On that basis:

- **ADR-008 status: Accepted**, dated 2026-08-06.
- **ACJ-1 is the approved canonicalization profile.**
- **DG-2 is closed.**
- **DG-3 is unblocked for design and fixture authoring only.** Implementation remains
  unauthorized and no fixture has been produced.
- **DG-1 and DG-4 remain open.**
- **The Universal Object Contract remains pre-stable.**
- **The implementation freeze remains in effect.**

# Binary Floating-Point Decision

IEEE 754 binary floating-point values are **prohibited in canonical contract positions**.

This is a deliberate architectural constraint, not an incidental consequence of selecting a
JSON-based format. The same constraint would apply to any format chosen for integrity
purposes.

## Rationale

1. Binary floating-point representations can produce cross-runtime differences.
2. JSON number parsing can silently lose precision.
3. Integrity, hashing, signing, fixture comparison, and conformance require exact,
   reproducible values.
4. Silent precision loss inside an integrity mechanism is unacceptable.

## Scope — four value contexts

| Context | Binary floats |
|---|---|
| **Domain value** — how the owning domain conceptually models a quantity | Permitted. A probability *is* continuous |
| **Transport value** — a representation in transit | Unconstrained |
| **Storage value** — a representation at rest | Unconstrained |
| **Canonical integrity value** — what enters canonicalization, hashing, signing, fixtures, or export verification | **Prohibited** |

Continuous quantities remain expressible in AION. Their **canonical contract
representation** must be exact and explicitly versioned. Binary floats may exist freely
inside local implementation calculations; they must not cross a canonical contract boundary
without conversion to an approved exact representation, and that conversion — including its
rounding rule — belongs to the schema, not to an implementation.

## Exact-representation strategies

Permitted, selected per field by the owning schema:

- a bounded canonical decimal string;
- a scaled integer with an explicit declared unit and scale;
- a future versioned exact-decimal contract type, once one exists.

**No universal decimal representation is selected.** Sufficient domain evidence does not
exist — no domain schema has been written — and choosing now would be guessing. The choice
is deferred to the review trigger below.

## Mandatory review trigger

When the first production or candidate domain schema models a continuous quantity —
including money, probability, measurement, score, geographic coordinate, scientific value,
or statistical output — the schema owner must supply, **before that schema is approved**:

1. required precision;
2. required scale;
3. permitted range;
4. rounding rule;
5. unit semantics;
6. overflow behaviour;
7. comparison semantics;
8. conversion evidence from the domain representation;
9. cross-runtime fixtures.

That review determines whether the current exact representations remain adequate. It is the
designated moment at which this constraint is tested against reality rather than argument.

The Universal Object Model is **not** modified to accommodate a numeric encoding.

# Validation Boundary Decision

`CanonicalContractValidatorV1` is established as an explicit pre-canonicalization
validation boundary.

## Sole responsibility

Determine whether a contract value satisfies its versioned schema, its canonicalization
profile, Unicode requirements, numeric constraints, member and key constraints, the depth
and size constraints assigned to the profile, identifier and timestamp normalization rules,
duplicate-member prohibitions, forbidden value classes, and applicable contract invariants.

## Requirements

1. Runs before canonicalization.
2. Fails closed.
3. Returns stable, non-enumerating error codes.
4. Never silently rewrites invalid values.
5. Never normalizes an invalid value and then treats the normalized result as equivalent
   without explicitly defined contract semantics.
6. Remains separate from authentication, authorization, persistence, transport, and
   business validation.
7. Replaceable and language-neutral at the contract level.

## Exclusions

The canonicalizer accepts only values already validated against a named schema and
canonicalization profile. It must not repair Unicode, remove duplicate keys, coerce
numbers, infer timestamps, fill absent members, remove unknown members, reorder
semantically ordered arrays, reinterpret identifiers, or silently upgrade contract versions.

Each of these is a *repair*, and a repairing canonicalizer maps two distinct inputs to one
output — hiding a producer bug and defeating the digest.

## Unicode

Canonical strings must satisfy NFC. The validation boundary verifies it. Invalid non-NFC
input fails with a stable outcome. Canonicalization does not silently normalize it unless a
future profile explicitly defines normalization as a contract transformation; `acj-1` does
not.

The threat model now describes NFC as a **specified control dependent on the validator
boundary**, not as an implemented runtime control.

## Processing sequence

```text
Contract Value
    -> Schema and Profile Resolution
    -> CanonicalContractValidatorV1
    -> Validated Canonical-Domain Value
    -> Canonical Serializer
    -> Canonical Bytes
    -> Domain-Separated Digest or Signature Input
```

This sequence is normative and **is not implemented**.

# Domain-Separation Framing Decision

Delimiter-only framing is replaced by **AION Frame v1**, an injective length-prefixed
framing contract.

The previous design relied on the assertion that a `0x00` separator would never occur
inside a label. That assertion rests on a grammar that can later be widened, and it fails
silently when it is. Injectivity must not depend on a byte being absent.

## Structure

```text
u32(len(FrameVersion))     || FrameVersion
u32(len(Purpose))          || Purpose
u32(len(ProfileId))        || ProfileId
u32(len(ContractFamily))   || ContractFamily
u32(len(ContractVersion))  || ContractVersion
u32(len(Context))          || Context
u64(len(CanonicalPayload)) || CanonicalPayload
```

## Resolved specification items

| # | Item | Decision |
|---:|---|---|
| 1 | Length integer encoding | Fixed-width unsigned; `u32` textual fields, `u64` payload. Not varint — non-minimal encodings would break injectivity |
| 2 | Byte order | Big-endian |
| 3 | Maximum field length | 1024 bytes textual; 16 MiB payload |
| 4 | Zero-length fields | Permitted only for `Context` |
| 5 | Text encoding | UTF-8, no BOM, NFC |
| 6 | Identifier grammar | `[A-Za-z0-9][A-Za-z0-9._:+-]*`, ASCII only — homoglyphs cannot enter a security label |
| 7 | Duplicate or omitted fields | Impossible by construction; fixed seven-field sequence |
| 8 | Unknown frame version | Fail closed |
| 9 | Truncation | `frame-truncated` |
| 10 | Overflow | `frame-length-overflow`; non-wrapping length arithmetic |
| 11 | Payload boundary | Exactly the declared length; trailing bytes rejected |
| 12 | Total-length prefix | Not required. Redundant, and would introduce a disagreement case with no correct resolution |
| 13 | Registered purposes | `aion.object.integrity`, `aion.event.integrity`, `aion.export.integrity`, `aion.fixture.digest`, `aion.release.artifact`, `aion.signature` (reserved) |

## Injectivity requirement

Two distinct field sequences must never produce the same framed byte sequence.

Decoding is a deterministic left inverse of encoding: a parser reads a fixed-width length,
then exactly that many bytes, seven times, with no search and no lookahead, recovering
exactly the tuple encoded. A function with a left inverse is injective.

The argument depends on **no property of field contents** — not on a byte being absent, not
on a grammar, not on an encoding. Adversarial cases are enumerated in the contract:
boundary shifting, NUL bytes, delimiter-like text, Unicode payloads, empty strings,
embedded profile names, and version-looking strings.

No hashing or signing is implemented.

# Rationale

## Why exact integrity representations outweigh unconstrained JSON numbers

Unconstrained JSON numbers are convenient: they map directly onto the number type of every
mainstream language, need no schema annotation, and survive a round trip through most
tooling without thought. That convenience is why RFC 8785 accepts them.

It is the wrong trade here, for one reason: **the convenience is paid for in silence.**

An integer above 2^53 passed through IEEE 754 does not error. It returns a different
integer. `0.1 + 0.2` does not error. It returns a value that is not `0.3`. In ordinary
application code these are familiar, bounded annoyances. Inside an integrity mechanism they
are something else: two runtimes computing different digests for content they both believe
is identical, or one runtime computing a stable digest over a value that is already wrong.

An integrity mechanism has exactly one job — to detect that content differs from what was
recorded. A mechanism whose own representation layer can alter content while reporting
success does not do that job. It produces confident, verifiable, incorrect answers, which
is worse than no mechanism at all, because it will be trusted.

The cost is real and is not minimised: every schema author modelling money, probability,
measurement, or score must now declare precision, scale, range, and rounding. That is more
work. It is also work that a correct system requires regardless — a monetary field with an
undeclared rounding rule is a defect whether or not it is canonicalized — so the constraint
mostly forces a decision that was always owed, at the point where it is cheapest to make.

The constraint is scoped as narrowly as possible: canonical integrity positions only.
Domains still model continuous quantities. Transports and storage engines remain free. Only
the bytes that get hashed are constrained, and only because those are the bytes where being
approximately right is indistinguishable from being wrong.

## Why the validation boundary had to be named

The prior design required NFC but delegated enforcement to a "validation boundary" that no
document defined. Two threat-model controls listed it as their defence. A control assigned
to nothing is not a control; it is a hope with a citation.

Naming `CanonicalContractValidatorV1` does not implement it, and the threat model now says
so explicitly. But it converts an unowned assumption into an assigned, specified
responsibility with enumerated requirements — and it makes the gap visible rather than
disguised.

## Why framing could not stay delimiter-based

The `0x00`-separated design was sound *given* its assumption. The problem was the
assumption's fragility: it held only while every field's grammar excluded one byte, and no
grammar had been written. A future registry entry, a UTF-8 label, or a widened context
field would have broken it silently, with no failing test, because the collision only
appears for specific adversarial inputs.

Length-prefixed framing removes the assumption entirely. It costs 28 bytes.

# Authorization Boundary

## Authorized by this decision

- canonical serialization architecture;
- language-neutral contract definitions;
- canonicalization profile registration rules;
- future representative fixtures;
- future conformance tests;
- future reference test adapters;
- subordinate design ADRs.

## Not authorized by this decision

- production implementation of any kind;
- a canonicalizer, parser, encoder, or validator implementation;
- generating fixtures;
- Identity, Object, Memory, Planner, Event Bus, Knowledge Graph, Capability Registry,
  Workflow Engine, plugin, agent, persistence, or UI implementation;
- storage, transport, compression, or encryption selection;
- signing or key-management infrastructure;
- designating the Universal Object Contract stable v1.

The implementation freeze remains in effect. No artifact produced under this decision lifts
it; only a separate recorded CTO decision can.

# Remaining Deferred Decisions

None are closed by this decision.

| # | Decision | Blocks |
|---:|---|---|
| 1 | **Exact decimal representation** — scaled integer, bounded decimal string, or a versioned exact-decimal contract type | Approval of the first continuous-quantity domain schema |
| 2 | **Registered digest-algorithm process** — the initial set, and how one is added or retired | Any second algorithm; any retirement |
| 3 | **Signature and trust architecture** — key identity, trust root, validity, revocation, rotation against retained digests | All authenticity claims. Constrained in advance: a signature covers the AION Frame, never raw bytes |
| 4 | **Algorithm retirement over immutable records** — Version and Event Objects cannot be re-digested without violating an ADR-007 invariant; Destroyed content cannot be re-digested at all | Retirement of any algorithm protecting immutable records |
| 5 | **Canonicalization limits versus DG-4** — the invariant is that DG-4 limits must be ≤ the §29–§31 canonicalizer limits; current values are provisional pending measurement | DG-4 closure; production adapters |
| 6 | **Constant-time comparison boundaries** — mandatory everywhere, or only where an untrusted party influences input and observes the outcome | Any digest comparison exposed to an untrusted party |

# Verification Evidence

Recorded from actual command output. No evidence below is inferred.

```
$ npm run verify
> aion-platform@0.2.0 verify
> npm run typecheck && npm test

> @aion/kernel@0.1.0 typecheck
> tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json --noEmit

> @aion/kernel@0.1.0 test
> npm run build && npm run build:test
>   && node --test "dist-test/test/**/*.test.js" "test/**/*.test.mjs"

# tests 11
# suites 1
# pass 11
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

| Check | Result |
|---|---|
| TypeScript production typecheck | Clean, 0 diagnostics |
| TypeScript test typecheck | Clean, 0 diagnostics |
| `AionKernelV1` unit tests | 9 of 9 pass |
| Architecture boundary test | Pass |
| Package-consumer test | Pass |
| `npm run verify` | **Pass — 11 of 11, 0 failures** |
| Production source modified | **None** |
| Dependencies changed | **None** |
| Implementation generated | **None** |
| Fixtures generated | **None** |
| Secrets or machine-specific paths | **None detected** |

## What this evidence does not establish

The passing suite covers the Kernel only. **No test exercises canonical serialization**,
because no canonicalizer, validator, or fixture exists and none is authorized. Cross-runtime
byte agreement — the property that would actually validate ACJ-1 — has never been
demonstrated and cannot be until DG-3 fixtures and two implementations exist.

The repository has no linter, formatter, or documentation link checker, so no configured
check inspects the Markdown changed by this decision. Consistency was verified by review.

# Review Triggers

- **The first production or candidate domain schema modelling a continuous quantity.** The
  schema owner supplies the nine evidence items above before approval; that review re-tests
  the float constraint against a real schema.
- **Measured need for a binary or streaming format.** If payload size or streaming cost
  becomes a measured constraint, deterministic CBOR is the better trade and ACJ-1 must
  migrate. Reconsider on evidence, not preference.
- A JCS implementation divergence that the ACJ-1 subset does not exclude.
- A registered digest algorithm is weakened or withdrawn.
- Cross-runtime fixtures fail to agree byte-for-byte.
- A proposal to widen the framing identifier grammar beyond ASCII.
- Any request to lift the implementation freeze, designate the Object Contract stable v1, or
  record DG-1, DG-3, or DG-4 as met.
