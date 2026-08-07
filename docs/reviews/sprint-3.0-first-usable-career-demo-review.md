# Sprint 3.0 first-usable Career demo architecture review

Reviewed scope: Phases 9–11, synthetic demo, canonical/resource integration, privacy, persistence,
CLI, tests, documentation, source recovery, and gate/claim accuracy.

## Findings

- Dependency direction is preserved: preparation depends on matching; matching depends on posting
  and evidence; all domain persistence uses Object/Relationship contracts. Neither domain package
  creates a new architecture center or imports the CLI.
- RelationshipObject remains the sole edge truth. Reports and drafts contain pinned evidence
  references but no embedded relationship arrays.
- Matching is deterministic integer arithmetic with visible weights and explanations. Missing,
  unknown, superseded, and conflicted evidence is non-positive. Protected characteristics and
  hiring probability are outside the implementation.
- Drafting uses only exact clean CareerFact values already cited by the Match, preserves citations,
  and makes uncertainty visible. Submission, external communication, signing, and attestation do
  not exist; owner review is mandatory.
- The CLI requires normalized explicit roots and selected files, performs containment checks, does
  not scan, and withholds complete Identity identifiers. The demo uses an OS temporary directory
  and removes it on success or failure.
- Canonical validation rejects unknown members, floating-point positions, invalid exact integers,
  non-NFC text, oversize values, invalid identifiers, and resource-limit crossings before Object
  integrity output. Existing exact-boundary tests remain intact.
- Production source contains no network/model/embedding/vector/telemetry/process-spawn path.
  Development-only npm and normal Git operations do not carry career domain data.
- Source backup excludes private and local-control state and now requires matching, preparation,
  CLI, demo, and exact restored test evidence.

No blocking defect remains within the authorized milestone. Residual limits are accurately stated:
lexical comparison is not semantic understanding; private export protection is owner-operated;
authentication and production workload evidence are absent; real owner ingestion has not run.

Gate state: DG-3 Open; DG-4b Open; Universal Object Contract Pre-stable; implementation Reference
Candidate; normative fixtures unauthorized.

Recommendation: **APPROVE**
