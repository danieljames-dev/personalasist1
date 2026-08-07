# Job Posting Import Contract v1

Status: Sprint 3 Phase 8 reference contract
Package: `@aion/job-posting`

## Payload boundary

`JobPostingPayloadV1` is the only non-empty payload accepted for the Phase 8
`JobPostingObject`. It is closed and uses contract version `aion.job-posting-payload.v1`. The
payload contains exactly `sourceProvenance`, `fields`, and `listingCurrentness` beneath its version.
The accepted Object envelope continues to provide typed ownership, Actor attribution, immutable
revision history, canonical integrity, lifecycle, and provenance.

The fields are title, company, location, work arrangement, employment type, compensation,
description, required and preferred skills, required experience, education and certification
requirements, travel, schedule, application deadline, and inert owner-supplied source reference.
Text, enumeration, list, compensation, and date values preserve closed explicit states. A
`not-supplied` state is distinct from `unknown`; structured JSON preserves its explicit Phase 6
states, while Markdown/text use `not-supplied` for every field other than description. No omitted
value is inferred or defaulted into a claim.

Compensation is present only with explicit structured input. Currency is exactly three uppercase
ASCII letters. Minimum and maximum are nullable non-negative safe-integer minor units, at least one
must be present, and maximum cannot be below minimum. Binary floating-point compensation is invalid.

## Source and parser provenance

Source provenance records the import-operation ID, explicit source type, original filename,
approved-root-relative path, exact SHA-256 digest of the parsed bytes, parser name/version, injected
import timestamp, and typed Owner/Actor references. Complete paths are invalid. The source file is
not copied. A supplied URL or other source reference remains inert data and is never fetched.

Structured JSON uses the accepted `aion.job-posting-input.v1` contract and maps fields directly.
Markdown and text preserve their exact decoded UTF-8 body only as description. Headings, labels,
URLs, dates, compensation, and apparent requirements in prose are not parsed as structured fields;
there is no summary, semantic parser, LLM, or model call.

## Listing currentness

Availability defaults to `{ state: "unknown" }`. Neither import time, a source reference, a URL,
a future application deadline, nor a later revision proves that the listing is current. The only
non-unknown states are explicit owner observations of current or not-current status with canonical
observation time and an exact owner-confirmation marker. Future-dated observation evidence rejects.
The state describes the owner observation; it is not a perpetual freshness guarantee.

## Dry run and explicit import

Dry run repeats root, path, extension, link/reparse, size, UTF-8, BOM, NUL, contract, digest,
parser, payload, and currentness validation. It reports proposed create/revision, a redacted Object
fingerprint, unknown/not-supplied fields, currentness, warnings, digest, and safe rejection details.
It returns no complete path or source body and performs zero Object, RelationshipObject, Identity,
copy, or network writes.

Permanent import is a separate explicit operation. Create produces exactly one JobPostingObject.
Revision requires the exact target Object ID and expected current revision. Each repository commit
is atomic and no-overwrite; stale revisions and conflicting deterministic identities fail closed.
Identical operation retries return `already-completed`; changed bytes or values under the same
operation ID reject. Concurrent create or revision has one winner, immutable prior revisions remain,
and injected installation failures leave no partial valid-looking Object. No RelationshipObject,
CareerProfile, JobMatchReport, ApplicationDraft, Identity state, or source copy is created.
