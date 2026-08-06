# Sprint 2.7 Contract Fixture Corpus Risks

Status: **Accepted** as the standing risk register, 2026-08-06  
Implementation: **Frozen**  
Normative fixtures: **Not authorized**

FX-002, FX-003, and FX-024 were changed by the B-1, B-2, and B-3 corrections and are updated
in place below. Every other entry remains open and unmitigated. ADR-009's acceptance did not
retire this register, and did not authorize a single fixture.

## Review posture

This register attempts to break AFX-1 before a single fixture is written. Severity reflects
effect on evidence integrity, owner data safety, replaceability, or ten-year survivability.
Likelihood stays qualitative until a corpus, a loader, and two implementations exist — none
of which do.

The register is unusually blunt about one thing: a fixture corpus is the artifact most
capable of producing **false confidence** in this entire programme. It is the gate that
converts "we believe the contract is implementable" into "we have proven it". Every entry
below that concerns a silent pass is more dangerous than an entry that concerns a loud
failure.

## Risk register

| ID | Risk | Severity | Failure scenario | Recommendation |
|---|---|---:|---|---|
| FX-001 | Vacuous pass | **Critical** | `node --test` with zero matching files exits 0. An empty corpus, an unresolvable manifest, or a filter matching nothing reports green and is indistinguishable from complete success — at the exact gate meant to prevent that | Executed-count must equal pinned manifest count and exceed zero; ratchet floors met; run fails loudly if it cannot establish them (contract §10) |
| FX-002 | Wrong expected value | **Critical → High** | A hand-computed digest is wrong. A correct implementation fails; a matching wrong implementation passes | **Partially addressed by B-3.** `expectedDigestInput` is now mandatory, so a reviewer recomputes `digest(input)` and re-derives the frame from recorded fields without a second implementation — catching wrong framing, wrong purpose, wrong profile, and unframed hashing. It does **not** catch a correct digest over a wrongly canonicalized payload; that still needs independent reproduction |
| FX-003 | One runtime testing itself | **Critical** | Implementation A generates expected values; A is later "verified" against them. Self-consistency reported as cross-runtime agreement | **Unchanged.** Gate condition 3 forbids a fixture becoming its own oracle, and promotion requires independent reproduction — but both are process controls with no structural backstop while no second runtime exists |
| FX-004 | Git destroys authoritative bytes | **Critical** | Verified in this repo: `printf 'a\r\nb'` and `printf 'a\nb'` hash identically through `git hash-object --path=…`, silently, `core.safecrlf` unset. The fixture proving ACJ-1 §27 is the file Git rewrites into a passing test | **Addressed structurally.** Sidecars prohibited; bytes inline as hex, unaffected by text conversion |
| FX-005 | Text-versus-byte comparison | **Critical** | A harness decodes to strings before comparing, silently passing mismatched line endings, BOMs, and normalization — precisely the defects the corpus exists to catch. Suite stays green | Comparison MUST be on bytes. Most likely harness bug, hardest to notice |
| FX-006 | Silent coverage deletion | **Critical** | The only fixture covering a load-bearing rule is removed, or demoted to `illustrative` by one token, and the suite stays green | `coversRules` anchors, required-rule inventory, monotonic non-decrease against the prior manifest, governance-controlled `status` |
| FX-007 | Acceptance-only corpus | **Critical** | An over-permissive implementation passes every positive fixture while accepting floats, duplicates, and non-NFC input | Rejection fixtures first-class; a release where any coverage area lacks one is incomplete |
| FX-008 | Rejection-everything implementation | High | An implementation that rejects all input scores perfectly on a rejection corpus | Rejecting earlier than the declared stage is a conformance failure; acceptance fixtures must pass |
| FX-009 | Corpus checksum mistaken for an ACJ-1 digest | High | A field named `digest`, computed over bare decoded bytes, teaches implementers exactly the unframed digest ACJ-1 §23 forbids | **Addressed.** Named `checksum`, contractually non-substitutable; ACJ-1 digests only in `expectedDigest` with full frame fields |
| FX-010 | Contradictory fixture | High | One record claims both acceptance and rejection, or carries expected bytes for a stage it never reaches | **Addressed structurally.** Closed discriminated union on one `expectation` member; `reject` prohibits output members |
| FX-011 | Duplicate members hidden by the host parser | High | The corpus file carries two `expectation` members; the host parser keeps the last; review sees one | Loader performs its own duplicate-key rejection; must not rely on the host parser or on ACJ-1 §19, which an unimplemented validator enforces |
| FX-012 | Parsed value used as evidence for a parse-level rule | High | A structured value is offered as evidence for duplicate members; the collapse already destroyed the fact | Entry-B mandatory for every case a parsed value cannot represent; routing rule is normative |
| FX-013 | Pre-epoch truncation moves the instant forward | High | ACJ-1 §14 permits four-digit years. Truncating a negative epoch offset toward zero moves the instant **forward** — the outcome CTO-DECISION-004 prohibits | **Addressed.** Floor toward negative infinity; `precisionLoss` carries exact integer instants so a harness asserts `canonicalInstant ≤ sourceInstant` directly; at least one pre-epoch fixture required |
| FX-014 | Fixture tampering | High | Corpus edited so a broken implementation passes | Per-fixture checksum in the manifest; releases pinned by version and checksum; assertion changes require a new ID |
| FX-015 | Harness discovers fixtures by globbing | High | A deleted or misnamed fixture vanishes from the run; suite reports green | Manifest is normative and enumerates every fixture; globbing prohibited |
| FX-016 | Corpus release rollback | High | An older, weaker release is substituted | Pinned by version and checksum; ratchet fails on decreased counts |
| FX-017 | Private or owner data in the corpus | **Critical** | Résumé, email, or calendar content used as a "realistic" fixture; corpus is public-by-intent, so exposure is immediate and permanent in history | Hard prohibition, no exception path; `sourceProvenance` restricted to synthetic or cited spec/standard derivation; review must reject |
| FX-018 | Secrets in fixtures | **Critical** | A token used as a sample string is compromised on commit | Same prohibition; Git history rewriting does not revoke a copied secret |
| FX-019 | Hex is unreviewable by eye | Medium | A reviewer cannot see that `00000001310000001561696f6e…` is a valid frame; wrong bytes pass review | Accepted cost of FX-004. Mitigated by `length` and `checksum` triple-agreement and by third-party decode in review, not by the format |
| FX-020 | Illustrative treated as normative | High | An unreviewed example is promoted by accident or by a one-token edit | `status` mandatory; promotion and demotion governance-controlled at supersession level |
| FX-021 | Fixture ID collision or reuse | Medium | Two assertions share an ID; one silently shadows the other | Append-only per-family ledger; duplicate IDs a hard manifest error; IDs never reused after withdrawal |
| FX-022 | Version categories conflated | High | A profile bump is recorded as a fixture-schema bump; consumers cannot tell what changed | Seven categories defined with what changes each and what it does **not** govern |
| FX-023 | Profile migration loses historical evidence | High | `acj-2` fixtures replace `acj-1` fixtures; historical digests in retained backups and exports become unverifiable | Migration produces **paired** fixtures; old fixture retained, never edited, never deleted |
| FX-024 | S0 error taxonomy cannot agree across runtimes | High → **Medium** | Two JSON parsers will not naturally agree on error categories; over-specifying stable codes at parser level makes conformance unachievable | **Resolved by B-1.** S0 conformance is limited to rejection, stage, and the absence of canonical bytes, frame, and digest. Parser diagnostics are non-normative. **Accepted narrowing:** two implementations rejecting at S0 for genuinely different reasons both pass, and the corpus cannot detect that |
| FX-025 | Fixture schema complexity | High | The record is elaborate enough that authors get it wrong, or that a second-language loader diverges | Conditional-requirement matrix is explicit and machine-checkable; complexity is the price of making contradiction unrepresentable — but it must be re-examined after the first ten fixtures |
| FX-026 | DG-4 limits treated as final | High | Boundary fixtures authored against ACJ-1 §29–§31 values that the contract itself marks provisional | Coverage areas 26 and (partly) 25 marked **BLOCKED**; limits remain DG-4's to fix |
| FX-027 | Blocked coverage silently omitted | High | A corpus claims complete coverage while three areas cannot yet be authored | Blocked areas explicitly marked in the coverage matrix; a completeness claim before those gates close is false by construction |
| FX-028 | Generator recipes become a language | Medium | The constructor set grows until recipes are Turing-complete and the corpus executes untrusted code | Closed set, integer-only arguments; adding a constructor is a contract amendment, not a corpus edit |
| FX-029 | Oversized corpus denial of service | Medium | The corpus grows until runs are unaffordable and get skipped | 4096-byte literal cap; recipes for large sources; per-release counts visible in the manifest |
| FX-030 | Ten-year loader loss | High | The fixture record schema evolves until old releases cannot be loaded; retained evidence becomes unreadable | `fixtureSchemaVersion` on every record; archival loaders preserved alongside releases, as ACJ-1 requires for profiles |
| FX-031 | Independent implementations share a misreading | Medium | Both implementations read an ambiguous clause the same wrong way and agree | Agreement is evidence, not proof. Adversarial fixtures and specification review carry this; the corpus cannot |
| FX-032 | Deliberately inverted but well-formed fixture | Medium | An acceptance case recorded as a rejection passes every structural check | Review only. Structure catches malformed inversion, not intentional inversion |

## Scalability challenges

**Corpus growth is monotonic by design.** Assertion changes require new IDs, migrations
produce pairs, and nothing is deleted. Over ten years and several profile advances the
corpus only grows. That is correct for evidence and expensive for runtime, and the tension
is unresolved until run cost is measured.

**Hex doubles byte-artifact size** versus raw and is 1.5× base64url. For envelope-sized
artifacts this is irrelevant; for the 16 MiB ACJ-1 §31 ceiling it is not, which is another
reason limit cases must be recipes rather than literals.

**Review cost per fixture is high.** Every fixture requires `coversRules`,
`expectedValueProvenance`, and a rationale. That is deliberate friction on the artifact that
defines correctness, but it will be the first thing someone proposes to relax.

## Security challenges

Highest risks are FX-001 (vacuous pass), FX-002 (wrong expected value), FX-003 (one runtime
testing itself), FX-005 (text comparison), and FX-017/FX-018 (owner data and secrets). The
first five all share a shape: **the suite stays green while the evidence is worthless.** The
threat model defines controls; none is implemented, and three of the five are process
controls that only review can enforce.

## Improvements required before DG-3 closure

1. Resolve the readiness review's blocking findings and accept ADR-009.
2. Settle the required-rule inventory and the initial ratchet floor.
3. Settle S0 error-category granularity across runtimes.
4. Settle the generator-recipe constructor set.
5. Close DG-4 limits, unblocking boundary and maximum-member coverage.
6. Land the decimal representation decision, unblocking scaled-integer coverage.
7. Select a second runtime and define how independence is verified.
8. Author the initial corpus with positive and negative cases and paired migration fixtures.
9. Demonstrate cross-runtime byte, frame, and digest agreement on a pinned, checksummed
   release, reproducible on a clean environment.

## Architecture recommendation

AFX-1 is coherent enough for CTO review. Its strongest properties are the ones that make
whole attack classes unrepresentable rather than defended — prohibited sidecars, a closed
expectation union, manifest-driven enumeration — and its most important contribution is
naming the vacuous-pass failure mode before anyone could stumble into it.

It is **not ready for corpus authoring**. Three coverage areas are blocked on open gates, S0
error granularity is unsettled, and the two controls that matter most (FX-002 wrong expected
values, FX-003 self-testing) are process controls with no structural backstop. Authoring
fixtures before those are settled would bake in guesses at the exact place guesses are most
expensive: the artifact that defines what correct means.
