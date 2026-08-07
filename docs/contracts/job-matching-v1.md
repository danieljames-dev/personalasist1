# Job Matching Contract v1

Status: **Reference Candidate**. This contract is implemented by `@aion/job-matching`. It is not
a hiring prediction, ranking service, or normative conformance fixture.

## Inputs and result

`JobMatchRequestV1` is closed and pins an Owner, Actor, CareerProfile Object/revision, JobPosting
Object/revision, operation identifier, and complete matching configuration. The operation loads
only the profile's pinned CareerFact revisions. It creates one `JobMatchReportObject` and exactly
two RelationshipObjects: `match-evaluates-posting` and `match-uses-profile`.

Scores are integers on a 0–10000 basis-point scale with floor rounding. Visible default weights
total exactly 10000: required skills 2400; preferred skills 600; relevant experience 1400; title
1000; industry 700; location 700; work arrangement 700; employment type 500; compensation 800;
mandatory qualifications 1200. The overall result is the weighted score divided by applied weight.
Excluded titles and explicit location/work-arrangement/employment conflicts produce zero. A
component is not applied where both sides do not provide the evidence it requires.

Every requirement is `matched`, `unmatched`, `unknown`, or `conflict`. Positive evidence links pin
fact ID, revision, type, assertion, verification, conflict state, source Object, and source location.
Missing, unknown, superseded, or conflicting evidence never counts positively. JobPosting v1 has
no structured industry field, so industry alignment remains unknown rather than inferred from prose.

## Safety and determinism

Object IDs and relationship IDs derive deterministically from the operation and logical inputs.
An identical retry returns `already-completed`; stale revisions or changed content under the same
identity fail closed. The operation has no network, model, embedding, vector store, protected-
attribute scoring, job discovery, submission, or probability/employability claim.

All payload positions pass the accepted ACJ-1 and `aion-resource-limits-1` validation boundary
before integrity output. DG-3 and DG-4b remain Open, the Universal Object Contract remains
Pre-stable, and normative fixtures remain unauthorized.
