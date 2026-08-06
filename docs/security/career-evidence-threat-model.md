# Career Evidence Privacy and Threat Model

Status: Sprint 3 Phase 7 reference boundary

Career evidence can be sensitive. Phase 7 minimizes exposure by requiring an explicit approved
root and file, repeating Phase 3 path checks and Phase 6 preflight, bounding bytes and canonical
values, storing only exact structured facts/provenance, redacting returned Object references, and
keeping private inputs/state ignored and excluded from source backups.

| Threat | Control | Residual risk |
|---|---|---|
| directory scan or archive harvesting | no discovery API; one explicit path; archives, home folders, cloud/email/browser sources, and AI-assistant exports prohibited | the owner may later explicitly select a sensitive file |
| traversal, cross-drive, device, link, junction, or reparse escape | Phase 3 authorization/recheck plus Phase 6 preflight and repository containment | platform filesystem race/privilege differences remain |
| invented or falsely confirmed fact | closed state semantics; direct structured projection; explicit owner marker; no prose/LLM inference | structured owner input itself may be wrong |
| lost provenance | exact digest, parser version, source location, RelationshipObject edge, immutable Object provenance | source file can later change or disappear; digest identifies imported bytes |
| silent conflict resolution | explicit same-type conflict groups preserve every fact; profile exposes conflict | human resolution workflow is future work |
| destructive correction | explicit supersession appends history; no patch/delete API | retained sensitive history requires future retention/deletion design |
| partial multi-Object acceptance | pending/partial source/profile operation records and deterministic retry; success last | no database-grade cross-Object transaction |
| duplicate retry | domain-separated deterministic IDs and exact-content verification | operation-ID reuse with different content rejects and needs owner action |
| exfiltration | no network/model/telemetry dependency; no source body or complete path in results | host, filesystem, and process compromise are outside this package |
| future-phase creep | job-posting import and matching/drafting APIs absent; architecture tests scan dependencies/API | Phase 8 requires separate authorization and review |

No real owner input was used in Phase 7. Tests use neutral temporary sources and temporary Object
stores only. This is bounded reference evidence, not hostile-input or production workload proof;
DG-4b remains Open. Tests are not normative fixtures; DG-3 remains Open and the Object Contract is
Pre-stable.
