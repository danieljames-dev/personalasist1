# CTO-DECISION-012: Phase 6 Approval and Phase 7 Authorization

Status: Accepted
Date: 2026-08-06
Accepted commit: `4cdacdd96d77c11c13f7fcb2d5a6c55c4ae4bcfb`

## Decision

Sprint 3 Phase 6 is approved. Its closed career-facts, career-preferences, and job-posting input
contracts, five neutral blank templates, strict local preflight, tests, documentation, pushed
commit, backup, and isolated restore are accepted. Preflight remains non-ingesting: it returns no
source body or complete path and creates no Identity or Object state. No real owner data was read.

Sprint 3 Phase 7 is separately authorized by the Founder/CTO directive
`AION-S3-P7-CAREER-EVIDENCE-PROFILE`. That authorization is limited to the local evidence
catalogue, evidence-backed CareerFacts and CareerProfiles, deterministic structured extraction,
explicit conflicts and supersession, bounded Object persistence, and synthetic proof.

## Preserved boundaries

- Phase 8 remains unauthorized. Job-posting import, matching, drafting, scoring, ranking, and job
  search are not Phase 7 behavior.
- AI-assistant archives and exports remain unapproved for access.
- No real resume, work history, archive, or owner career file is authorized for ingestion.
- DG-3 remains Open; Phase 6 templates and Phase 7 tests are not normative AFX-1 fixtures.
- DG-4b remains Open; bounded synthetic reference evidence is not representative production
  workload evidence.
- The Universal Object Contract remains Pre-stable.

This decision preserves earlier decisions and does not authorize Phase 8 or a Stable Object claim.
