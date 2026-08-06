# CTO-DECISION-009: Phase 4 Approval and Object Reference Authorization

- Status: Accepted
- Date: 2026-08-06
- Decision owner: Founder/CTO
- Phase 4 implementation commit: `cae4266ab1ad10e6c96a3d424f75b1d597e5f5fb`
- Phase 4 final commit: `324b12e217822969c1ce36f71914d1d7b6eff893`
- Phase 5 directive: `AION-S3-P5-OBJECT-REFERENCE`

## Decision

Sprint 3 Phase 4 is Approved. The original DG-1 record remains intact and its prospective split is
accepted: **DG-1a, Local single-owner reference bootstrap, is Closed**; **DG-1b, Secure
external-access bootstrap and authentication boundary, remains Open**.

The accepted Phase 4 evidence is 44 product tests, 32 Identity tests, 22 control-plane tests, eight
collection checks, 15 privacy tests with one truthful Windows file-symlink `EPERM` environment
skip, passing backup-reference and real-repository gates, real explicit initialization, unchanged
idempotent re-initialization, private-state and backup exclusion, and a successful isolated restore.
The local opaque Identity state remains ignored and local. No authentication or authorization was
implemented.

Sprint 3 Phase 5 is separately authorized to implement the minimum domain-neutral Universal Object
reference described by its local directive. That authorization lifts prior implementation freezes
only for the bounded reference package, ACJ-1 processing, DG-4a enforcement, deterministic tests,
and directly related documentation and operations evidence.

## Boundaries retained

- DG-2 and DG-4a remain Closed.
- DG-3 and DG-4b remain Open.
- The Universal Object Contract remains Pre-stable.
- Normative fixtures remain unauthorized.
- Multi-owner, tenant, remote, hosted, federated, and external-access Identity remain unauthorized.
- Authentication, authorization, permissions, credentials, and policy remain absent.
- Career schemas, career records, ingestion, matching, drafting, and Phase 6 remain unauthorized.
- Event Bus, Planner, Memory, Capability Registry, database, vector store, networking, and telemetry
  implementations remain unauthorized.

The Windows `EPERM` skip is accepted only as truthful evidence that file-symlink construction was
unavailable in that environment. It is not evidence that the unavailable operating-system behavior
was directly demonstrated.

## Review trigger

Phase 5 implementation does not close DG-3 or DG-4b and does not make the Object Contract Stable.
Those outcomes require their separately recorded evidence and decisions. External access or any
credential-bearing Identity design requires a separate DG-1b decision.
