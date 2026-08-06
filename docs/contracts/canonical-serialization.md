# Canonical Serialization Contract — ACJ-1

Status: **Proposed** normative contract  
Profile identifier: `acj-1`  
Authority: [ADR-008](../decisions/ADR-008-canonical-serialization.md) (Proposed)  
Base: strict subset of [RFC 8785 JCS](https://www.rfc-editor.org/rfc/rfc8785)  
Implementation: Not authorized; freeze in effect

## Responsibility

Define a deterministic, language-neutral byte representation for AION contract values
where exact equality, hashing, signing, integrity verification, portable fixtures, export,
or cross-runtime conformance requires one.

Not a storage format, transport mandate, presentation format, compression format,
encryption format, object mapper, or replacement for versioned schemas.

## Conformance

An implementation conforms when, for every value in the ACJ-1 value domain, it produces
byte-identical output to every other conforming implementation, rejects every value
outside the domain with the specified deterministic error, and passes the published
fixture set.

**Subset guarantee:** every ACJ-1 output is valid RFC 8785 output. An implementation may
be a thin validating wrapper over a stock JCS library. It may not be a fork of the JCS
algorithm.

## 1. Value domain

Exactly six value kinds are canonicalizable. Anything else is rejected.

| Kind | Admitted | Notes |
|---|---|---|
| Null | `null` | Distinct from absent — see §12 |
| Boolean | `true`, `false` | §13 |
| Integer | JSON number, no fraction, no exponent | §6–§7 |
| String | JSON string | §4, §5 |
| Array | Ordered sequence | §3 |
| Object | Unordered member set | §2 |

Explicitly **not** in the domain: binary floating point, `NaN`, `±Infinity`, `-0`,
undefined, functions, dates as native types, binary as native type, comments, cyclic
references, and any host-language type not reduced to the six kinds above.

## 2. Object member ordering

Members are sorted by ascending **UTF-16 code unit** sequence of the member name, per
RFC 8785 §3.2.3. This is not lexicographic Unicode ordering and not locale collation;
implementations that sort by code point will diverge on characters outside the Basic
Multilingual Plane and are non-conforming.

## 3. Array ordering

Array order is **semantic and preserved exactly**. A canonicalizer never sorts, dedupes,
or reorders an array. Where a schema requires order-independence, the schema declares a
canonical sort key and the *producer* sorts before canonicalization; the canonicalizer
does not infer it.

## 4. Unicode normalization

All strings must be **NFC**-normalized before becoming contract values. Canonicalization
does not normalize — that would fork JCS — and does not verify normalization.

Non-NFC input is rejected at the **validation boundary**, before canonicalization, with a
deterministic error. This is a required companion rule: without it, `café` in NFC and NFD
are different contract values with different digests, and the difference is invisible on
screen.

Lone surrogates, unpaired surrogates, and code points that are not valid Unicode scalar
values are rejected.

## 5. String encoding and escaping

- Output encoding is **UTF-8**, no byte-order mark.
- Escaping follows RFC 8785 §3.2.2.2: only `"` `\` and control points below U+0020 are
  escaped; the short forms `\b \t \n \f \r \" \\` are used where defined; all other
  control points use lowercase `\u00xx`.
- No other character is ever escaped. `/` is not escaped. Non-ASCII is emitted literally
  as UTF-8, never as `\u` sequences.

## 6. Number representation

Integers only. Serialized as the shortest decimal form with no leading zeros, no `+`, no
exponent, no fractional part, and `-` only for negative values.

`0` is the only representation of zero. **`-0` is rejected**, not folded, because folding
would make two distinct inputs produce one output and hide a producer bug.

## 7. Integer range

The admitted range is **−(2^53 − 1) … 2^53 − 1** inclusive — the range in which every
integer is exactly representable as an IEEE 754 double, so a JCS implementation backed by
double arithmetic cannot lose precision.

Integers outside that range are represented as **strings** with a schema-declared radix
(decimal by default) and are validated against a declared minimum and maximum. The schema,
not the canonicalizer, gives them numeric meaning.

## 8. Floating point

**Prohibited in canonical positions.** No binary floating-point value may be a contract
value. A schema requiring a fractional quantity uses §9.

This is the sharpest constraint in ACJ-1 and its cost is real — see
[ADR-008 §Consequences](../decisions/ADR-008-canonical-serialization.md#costs) and
[the readiness review](../reviews/canonical-serialization-readiness-review.md).

## 9. Decimal representation

A fractional quantity is either:

- a **scaled integer** with a schema-declared scale — `confidence: 875` at scale 3 meaning
  0.875 — which keeps it in the integer domain and is preferred; or
- a **decimal string** matching `-?(0|[1-9][0-9]*)(\.[0-9]+)?` with schema-declared
  precision and scale, no exponent, no trailing zeros beyond the declared scale, and no
  leading `+`.

Exactly one form is permitted per field, fixed by the schema. A field must not accept both.

## 10. Negative zero

Rejected. See §6.

## 11. NaN and infinity

Rejected. They have no JSON representation, no total ordering, and no meaningful digest.
A value that could be non-finite must be modelled as an explicit union — for example
`{"kind":"unmeasured"}` versus `{"kind":"value","scaled":875}` — so the absence is data
rather than a sentinel.

## 12. Null versus absent

**Distinct, and both are canonicalizable.** An absent member is not emitted; a `null`
member is emitted as `null`. They produce different bytes and different digests.

Because two encodings must never represent one logical value, a schema declares, per
field, whether the field is required, optional-and-omitted-when-unset, or
optional-and-explicitly-null. A schema that permits both omission and `null` for the same
meaning is invalid.

## 13. Boolean

`true` and `false` literals. No numeric, string, or truthy coercion.

## 14. Timestamps

RFC 3339 UTC strings with a mandatory `Z` designator and **exactly three fractional
digits**, always present: `2026-08-06T05:20:19.000Z`.

Fixed precision is required because `…:19Z`, `…:19.0Z`, and `…:19.000Z` denote one instant
but produce three digests. Leap seconds are rejected. Year is exactly four digits.

## 15. Time zone

UTC only. `Z`, never `+00:00`, never a local offset. A producer holding a local time
converts before the value becomes a contract value; the original offset, if it carries
meaning, is a separate declared field.

## 16. Identifier normalization

- UUIDs: canonical lowercase hyphenated form, RFC 9562. Uppercase, braces, and URN prefix
  are rejected rather than folded.
- Namespaced type and relationship identifiers: NFC, case-sensitive, rejected if they do
  not match the declared grammar.
- No identifier is trimmed, lowercased, or otherwise repaired by the canonicalizer.
  Repair hides producer bugs and makes two inputs collide.

## 17. Binary data

**base64url without padding** (RFC 4648 §5), as a string, inside a declared wrapper so a
binary field is never confused with a text field:

```json
{"$b64u": "3q2-7w"}
```

Base64url encoding inflates size by about one third. Large artifacts must **not** be
embedded — they use content-addressed artifact references, and only the reference and its
digest enter the canonical envelope.

## 18. Map and dictionary keys

Keys are strings only. No integer, boolean, null, or composite keys. Keys must be NFC,
non-empty, and must not contain unpaired surrogates. A schema may further restrict a
key grammar; the canonicalizer enforces only the universal rules.

## 19. Duplicate members

**Rejected.** Not last-wins, not first-wins, not merged.

Duplicate-key handling is the classic parser-differential vulnerability: two parsers
disagree about which value survives, one validates and the other acts on different data.
Rejection is the only safe rule.

## 20. Unknown members

**Preserved and canonicalized.** Unknown members are content: ADR-007 requires unknown
valid extensions to survive round trips, and a digest that excluded them would not cover
the data actually stored.

Unknown members are never executed, interpreted, or given semantics. They must satisfy
every universal rule in this contract — a canonicalizer does not relax validation for data
it does not recognise.

## 21–22. Schema and contract-family inclusion

The digest input includes the contract family and the schema identity and version. This is
not decoration: without it, the same bytes under two different schemas produce the same
digest, and a schema-substitution attack becomes free. Inclusion is via the domain label
(§23), not by injecting fields into the value.

## 23. Domain separation

A digest is **never** computed over bare canonical bytes. The input is:

```
digest_input := domain_label ‖ 0x00 ‖ profile_id ‖ 0x00 ‖ canonical_bytes
```

`domain_label` is a registered ASCII string naming the exact purpose, contract family, and
schema version — for example `aion.object.integrity.v1:org.aion.task:3`. The `0x00`
separators cannot occur inside a label or profile identifier, so no two distinct
(label, profile, content) triples can produce the same input.

Omitting the domain label is a contract violation, not an optimisation. Its absence is
what makes cross-protocol digest reuse possible.

## 24. Content type and profile identifiers

- Profile: `acj-1`. Advances to `acj-2` on any change to §1–§20.
- Media type for a canonical document: `application/json` with parameter
  `profile="acj-1"`. The profile parameter is required wherever the bytes are transported
  or stored as a canonical form.

## 25–27. Whitespace, escaping, newlines

No whitespace anywhere: no indentation, no space after `:` or `,`, no leading or trailing
whitespace. No trailing newline — a canonical document is exactly its bytes, and a
trailing `\n` changes the digest.

Escaping is §5 and nothing more. Literal newlines inside strings are escaped as `\n`;
`\r\n` is **not** normalized to `\n` — that would silently alter content. A producer that
wants normalized line endings normalizes before the value becomes a contract value.

## 28. Canonical byte encoding

UTF-8, no BOM, no trailing newline. The canonical form is a byte string, not a text
string: comparison, hashing, and storage operate on bytes. An implementation that
round-trips through a host string type must guarantee the byte sequence is unchanged.

## 29–31. Canonicalizer limits

These are **safety limits on the canonicalizer**, distinct from the business limits owned
by DG-4. DG-4 limits must be less than or equal to these; a value the Object contract
permits must always be canonicalizable.

| Limit | Value | Purpose |
|---|---:|---|
| Maximum nesting depth | 64 | Bounds recursion and stack exhaustion |
| Maximum members per object | 4096 | Bounds sort cost |
| Maximum array elements | 65536 | Bounds traversal |
| Maximum string length | 1 MiB encoded | Bounds allocation |
| Maximum total canonical size | 16 MiB | Bounds whole-document cost |

Exceeding any limit is a deterministic rejection, never a truncation.

## 32. Streaming

Full streaming is **not** achievable: member sorting requires all members of an object to
be known before any is emitted. ACJ-1 is therefore bounded-buffer, not streaming, and the
§29–§31 limits exist partly to bound that buffer.

Digest computation over the produced bytes may stream. Large content stays outside the
envelope (§17), so the bounded-buffer property is not a practical constraint on artifact
size — only on envelope size.

## 33. Deterministic error behaviour

Rejection is part of the contract. Two conforming implementations reject the same input
for the same stated reason. Error categories:

| Category | Cause |
|---|---|
| `unsupported-value-kind` | Float, NaN, Infinity, `-0`, or a non-domain type |
| `integer-out-of-range` | Outside ±(2^53 − 1) |
| `invalid-string` | Non-NFC, lone surrogate, or invalid scalar value |
| `duplicate-member` | Repeated member name |
| `invalid-key` | Non-string, empty, or malformed key |
| `limit-exceeded` | §29–§31 |
| `invalid-timestamp` | Wrong precision, offset, or leap second |
| `invalid-identifier` | Identifier fails §16 |
| `missing-domain-label` | Digest attempted without domain separation |

Errors name the category and the location. They must not echo the offending content, which
would turn an error channel into a disclosure channel.

## 34. Cross-runtime reproducibility

Two implementations conform only when they agree byte-for-byte on the full fixture set,
including every rejection case. Agreement on accepted values alone is insufficient: an
implementation that accepts a float and produces plausible bytes is non-conforming even if
it never sees one in practice.

## 35. Forward and backward compatibility

- Adding a member changes the canonical bytes and therefore the digest. This is correct:
  the content changed.
- A reader encountering an unknown profile identifier **fails closed**. It never guesses.
- A digest is only ever compared against a digest computed under the same profile,
  algorithm, and domain label. Comparing across profiles is a contract violation.
- Retained digests remain valid indefinitely under the profile that produced them. A new
  profile never invalidates an old digest; it produces a different one.

## 36. Profile migration

Migrating from `acj-N` to `acj-N+1` re-canonicalizes and recomputes digests. Both
descriptors are retained during the migration window so historical verification remains
possible.

A profile migration **does not** change content, so it must not change any Object's
revision. It is recorded as a profile-migration event carrying old and new integrity
descriptors. Any implementation that cannot verify an old digest under the old profile
must retain an archival verifier rather than declaring old data unverifiable.

## 37. Algorithm agility

The digest algorithm is named in the descriptor and resolved through a registry. `sha-256`
is the initial registered algorithm and is **not** a contract constant.

Adding an algorithm is additive. Retiring one requires a deprecation window, re-digesting
of retained content where required, and an archival verifier for content that cannot be
re-digested. An unknown algorithm identifier fails closed — it is never treated as
"probably sha-256".

## 38. Digest descriptor

```json
{
  "canonicalizationProfile": "acj-1",
  "algorithm": "sha-256",
  "digest": "371654f3…",
  "contractFamily": "aion.object",
  "contractVersion": "1",
  "schemaId": "…",
  "schemaVersion": 3,
  "domainContext": "aion.object.integrity.v1:org.aion.task:3"
}
```

Every field is required except `domainContext`, which is required whenever the domain
label is not fully derivable from the other fields. `digest` is lowercase hex.

This descriptor replaces the fixed `{contentHash, algorithm: "sha-256"}` shape of the
superseded API contract.

## 39. Signature descriptor boundary

Out of scope. ACJ-1 defines only **what bytes a signature would cover**: the §23 digest
input, not the raw canonical bytes, so a signature inherits domain separation.

A signature descriptor — key identity, algorithm, trust root, validity, revocation — is a
separate future decision. Until it exists:

> A digest detects accidental or unauthorized modification by a party who cannot also
> rewrite the digest. It proves nothing about who produced the content. An attacker who
> can change stored content can normally recompute a stored digest.

## 40. Fixture requirements

Fixtures are the only proof of conformance. Each must carry the source contract value, the
expected canonical byte sequence, the expected digest under at least one registered
algorithm, the expected validation outcome, the applicable contract and profile version,
and a rationale for why the case exists.

Rejection fixtures are as important as acceptance fixtures — an implementation that
accepts what it must reject is non-conforming. The full plan is in the
[Sprint 2.6 specification](../sprints/sprint-2.6-canonical-serialization/specification.md).

Fixtures are **not** produced by this contract. DG-3 remains blocked until ADR-008 is
accepted.
