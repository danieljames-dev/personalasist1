# Career Evidence Deterministic Parsing Reference

Status: Sprint 3 Phase 7 reference implementation

`@aion/career-evidence` composes the Phase 3 approved-root boundary and Phase 6 preflight. It reads
only the explicitly selected bounded file, recomputes exact bytes and digest, performs strict
UTF-8/ACJ validation where applicable, and dispatches from the explicit source type only after
content-kind confirmation.

The version-1 structured parser performs direct field projection from
`aion.career-facts-input.v1`; it has no statistical or semantic interpretation. JSON Pointers are
deterministic. Markdown/text handling records line count and heading start lines only. It does not
extract facts, summarize, infer, or preserve source body text. Career preferences are catalogue
evidence only. Job-posting contracts reject.

Opaque Object IDs are deterministic SHA-256-derived UUIDv4 values, domain-separated by operation,
purpose, and logical source location. This permits a retry to locate the same records without
duplicate facts or relationships. Returned references use separate 16-hex fingerprints and never
display complete private Object IDs.

Limitations: parser rules are intentionally narrow; Markdown heading recognition is syntactic;
there is no date or prose interpretation; no production inference rule runs; and a filesystem link
swap remains constrained by repeated approved-root checks and the underlying Phase 3/Phase 6
residual platform race boundary. Expanding parsers requires a new accepted version and tests.
