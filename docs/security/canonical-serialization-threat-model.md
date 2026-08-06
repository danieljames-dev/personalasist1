# Canonical Serialization Threat Model

Status: **Proposed**  
Scope: ACJ-1 profile and digest construction only  
Authority: [ADR-008](../decisions/ADR-008-canonical-serialization.md) (Proposed)  
Implementation: Not authorized; freeze in effect

## What canonical serialization does not provide

Stated first, because most failures in this area come from assuming otherwise.

ACJ-1 provides **integrity evidence**: it detects that content differs from content whose
digest was recorded, by a party who could not also rewrite the digest.

It provides **no authenticity** — a digest names no producer. **No confidentiality** — the
canonical form is plaintext. **No trust** — a valid digest says nothing about whether the
content should be believed. **No authorization** — possessing or recomputing a digest
grants nothing. **No freshness** — a digest cannot distinguish current content from a
correctly-digested replay of old content.

An attacker who can modify stored content can usually recompute the stored digest. Digests
are only meaningful where the digest is protected by something the content is not:
transport, storage separation, signing, or an append-only witness.

## Assets

Canonical byte sequences; digest values and descriptors; domain labels; the profile and
algorithm registries; fixtures and their expected outputs; the validation boundary that
enforces NFC and the value domain.

## Trust boundaries

| Boundary | Rule |
|---|---|
| Producer to canonicalizer | Input is untrusted. Validation precedes canonicalization and rejects rather than repairs |
| Canonicalizer to digest | Bytes are trusted only within one profile. Cross-profile comparison is a violation |
| Digest to verifier | A matching digest proves byte equality and nothing more |
| Fixture to implementation | Fixtures are supply-chain input; a malicious fixture can certify a broken implementation |
| Profile/algorithm registry | Registry entries are security-relevant configuration, not data |

## Threats and required controls

| # | Threat | Attack or failure | Required control |
|---:|---|---|---|
| 1 | **Parser differential** | Validator and consumer parse the same bytes differently; one sees safe content, the other acts on different content | Single strict value domain (§1); reject rather than repair; identical rejection behaviour is part of conformance and is fixture-tested |
| 2 | **Duplicate keys** | `{"owner":"a","owner":"b"}` — one parser takes first, another takes last; validation and action disagree | Duplicate members rejected outright (§19). Never last-wins, never merged |
| 3 | **Unicode confusables** | Visually identical type names, keys, or identifiers using different scripts (Cyrillic `а` for Latin `a`) pass human review as equal | Canonicalization cannot solve this — it is a *naming* control. Identifier grammars restrict permitted scripts; namespace registration is the real defence. Explicitly out of ACJ-1's power and must not be assumed handled |
| 4 | **Normalization mismatch** | NFC and NFD forms of one string hash differently while rendering identically | NFC required at the validation boundary (§4); non-NFC rejected. Canonicalizer never normalizes, so the rule cannot be bypassed by calling the canonicalizer directly |
| 5 | **Numeric ambiguity** | `1.0` vs `1`, `1e2` vs `100`, precision loss above 2^53, `-0` vs `0` | Integers only in a range exactly representable as doubles (§6–§7); floats, exponents, and `-0` rejected (§8, §10); decimals as declared-scale integers or strings (§9) |
| 6 | **Hash confusion** | A digest computed for one purpose is accepted for another — an event digest passed as an Object digest | Mandatory domain separation with unambiguous `0x00` framing (§23). Digesting bare canonical bytes is a contract violation |
| 7 | **Cross-protocol attack** | Content valid in two contexts produces one digest that both accept | Domain label encodes purpose, contract family, and schema version (§21–§23) |
| 8 | **Domain-label omission** | Implementation "optimises" by hashing content directly, silently reopening #6 and #7 | `missing-domain-label` is a named rejection category (§33) and a required rejection fixture. Omission is a conformance failure, not a performance choice |
| 9 | **Algorithm downgrade** | Attacker presents a descriptor naming a weak or withdrawn algorithm and the verifier complies | Algorithm resolved through a registry; unknown or retired identifiers fail closed (§37). A verifier never infers `sha-256` from an absent or unrecognised field |
| 10 | **Signature wrapping** | Signature covers a subset or a re-serialization of what the verifier interprets | Signatures cover the §23 digest input, not raw bytes and not a parsed object (§39). Full signature design is deferred, and this constraint is recorded so it cannot be designed away later |
| 11 | **Canonicalization denial of service** | Adversarial input forces pathological sorting, allocation, or recursion | Hard limits on depth, member count, array length, string size, total size (§29–§31); deterministic rejection, never truncation |
| 12 | **Excessive nesting** | Deeply nested structure exhausts the stack during recursive descent | Depth limit 64, enforced during parse rather than after |
| 13 | **Oversized values** | Multi-gigabyte string or document exhausts memory, worsened by bounded-buffer sorting | String and total-size limits; large content excluded from envelopes via content-addressed references (§17) |
| 14 | **Malicious fixtures** | A crafted fixture certifies a non-conforming implementation as conforming, or a fixture's "expected" digest encodes a weakness | Fixtures are reviewed artifacts under change control, cross-checked against an independent JCS implementation, and must include rejection cases. A fixture set that only tests acceptance cannot detect an over-permissive implementation |
| 15 | **Ambiguous timestamp interpretation** | `…:19Z`, `…:19.0Z`, `…:19.000Z` denote one instant, three digests; local offsets or leap seconds admit more | Exactly three fractional digits, mandatory `Z`, UTC only, leap seconds rejected (§14–§15) |
| 16 | **Schema substitution** | Identical bytes reinterpreted under a different schema; digest still matches | Schema identity and version bound into the domain label (§21–§23) |
| 17 | **Version confusion** | Digest produced under `acj-1` compared against one produced under `acj-2` | Profile identifier in every descriptor; cross-profile comparison prohibited; unknown profile fails closed (§35) |
| 18 | **Digest comparison timing** | Byte-by-byte early-exit comparison leaks a prefix, enabling incremental forgery where an attacker can submit candidates and observe outcomes | Constant-time comparison for any digest an untrusted party can influence and whose result they can observe. For purely local integrity checks the risk is low, but the requirement is stated so implementations do not have to rediscover it |

## Residual risks accepted

- **Unicode confusables (#3) are not solved here.** ACJ-1 makes two different strings hash
  differently, which is correct, but it cannot make a human notice that two strings are
  different. Identifier grammar and namespace ownership carry that load.
- **A digest without a signature proves nothing about origin.** Until the signature
  decision exists, integrity is only as strong as the protection around the stored digest.
- **Bounded-buffer canonicalization** means a conforming implementation must hold a whole
  document in memory. The limits bound it; they do not eliminate it.
- **The float prohibition shifts risk to schema authors.** A schema that models a
  fractional quantity incorrectly — wrong scale, ambiguous rounding — produces wrong data
  that canonicalizes perfectly. ACJ-1 removes encoding ambiguity, not modelling error.

## Verification requirements before release

- Byte-for-byte agreement between at least two independent implementations across the full
  fixture set, including every rejection case.
- Cross-check of accepted values against an unmodified third-party JCS implementation, to
  confirm the subset relationship actually holds.
- Property tests over key ordering with characters outside the Basic Multilingual Plane,
  which is where code-unit versus code-point sorting diverges.
- Fuzzing for depth, size, duplicate keys, invalid UTF-8, lone surrogates, and non-NFC
  input, asserting deterministic rejection rather than crash or acceptance.
- Proof that no rejection message echoes input content.
- Proof that digest verification never falls back to a default algorithm or profile.

No test implementation is authorized by this threat model.

## Residual decisions blocking DG-2 closure

1. Registered digest algorithm set and the add/retire process.
2. Signature and trust design, including key rotation against retained digests.
3. NFC enforcement point and rejection behaviour in the validation contract.
4. Decimal representation choice, decided against real Memory and Invoice data.
5. Boundary between canonicalizer limits and DG-4 business limits.
6. Whether constant-time comparison is mandatory everywhere or only where an untrusted
   party can observe the outcome.

DG-2 remains open until ADR-008 is accepted and these are resolved or explicitly bounded.
