# Application Preparation Contract v1

Status: **Reference Candidate**. `@aion/application-preparation` creates local preparation material;
it does not create or submit an application.

`ApplicationPreparationRequestV1` is closed and pins an Owner, Actor, JobMatchReport Object and
revision. `ApplicationDraftPayloadV1` contains the seven authorized outputs: Match JSON, Match
Markdown, résumé recommendations, cover-letter draft, application-question preparation, missing-
information checklist, and evidence appendix. Every output is marked or governed by
`Draft — Owner Review Required`.

Positive résumé and cover-letter claims use only exact supplied CareerFact values cited as clean,
matched evidence by the pinned report. Each claim contains one or more fact citations, and every
citation must appear in the appendix. Unknown, missing, unmatched, unsupported, or conflicting
requirements become visible checklist items, never invented claims. Questions involving work
authorization, compensation, availability, background checks, demographic/disability information,
signatures, or attestations remain owner decisions and are never answered automatically.

Persistence creates one `ApplicationDraftObject`, one `draft-derived-from-match` RelationshipObject,
and one `draft-supported-by-fact` RelationshipObject per used fact. IDs are deterministic; identical
retry is idempotent and stale inputs fail closed. No network, external model, embedding, vector
database, email, form interaction, signature, attestation, or submission exists.

Canonical positions are validated against ACJ-1 and the accepted resource-limit profile before
integrity output. DG-3 and DG-4b remain Open, the Object Contract remains Pre-stable, implementation
status remains Reference Candidate, and normative fixtures are unauthorized.
