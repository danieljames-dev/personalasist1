# `@aion/job-matching`

Reference Candidate package for transparent deterministic comparison of one evidence-backed
CareerProfileObject with one owner-supplied JobPostingObject. Scores and weights are exact integer
basis points, all positive matches cite CareerFact evidence, unknown is never satisfied, and
conflicted evidence remains visible. Compensation is evaluated only when both sides contain
explicit evidence.

The package persists a JobMatchReportObject plus separate `evaluates` and `uses` RelationshipObjects.
It contains no relationship arrays, protected-attribute scoring, hiring-probability claim, job
discovery, network access, model, embeddings, vector store, drafting, or application behavior.

See `docs/contracts/job-matching-v1.md` for weights, unknown handling, persistence, and limitations.
This is a Reference Candidate: DG-3 and DG-4b remain Open, the Object Contract remains Pre-stable,
and the synthetic tests are not normative fixtures.
DG-3 and DG-4b remain Open; the Universal Object Contract remains Pre-stable.
