# Career Evidence Catalogue Contract v1

Status: Sprint 3 Phase 7 reference contract

## Purpose and boundary

Each explicit accepted source becomes one `CareerSourceObject` whose data is a closed
`CareerSourcePayloadV1`. The catalogue records evidence provenance; it is not a resume store, a
profile biography, an archive index, or permission to scan. Production operations accept exactly
one caller-selected path beneath one explicit approved career-input root and repeat Phase 6
preflight before reading it.

The catalogue entry contains only:

- contract and entry version;
- deterministic source Object ID and import-operation ID;
- original filename and approved-root-relative path, never a complete path;
- explicit source type;
- exact SHA-256 digest of the bytes actually parsed;
- imported timestamp and typed Owner/Actor references;
- parser ID/version and source-location format;
- pending, success, partial, or rejected processing outcome with counts/reason codes;
- a bounded JSON-pointer index or deterministic line/section index.

Raw source bytes and full source text are not stored in the catalogue. The source remains in its
owner-controlled input location. Actual future catalogue Objects belong only below the explicitly
configured `private/object-store/`; career inputs belong below an explicitly approved ignored
private input root. Both are excluded from source backups.

## Supported sources

`career-facts-json` is the only source with semantic Phase 7 extraction. Phase 6
`career-preferences-json` is catalogue-only. Explicit resume/work-history Markdown and plain text
are catalogue-only: Phase 7 records digest, parser version, and deterministic line/section
locations, but creates no semantic fact, summary, or inferred biography. Job-posting content is
rejected because its import belongs to Phase 8.

Source type is explicit and confirmed by content/contract preflight. Extensions alone do not
select a parser. Unsupported or ambiguous content fails before a CareerSource is created.

## Dry run and privacy

Dry run repeats path, byte, encoding, contract, parser, digest, and proposal validation, then
returns counts, warnings, a digest, and a redacted source fingerprint. It writes zero Object or
Identity revisions, copies no source, performs no network action, and returns no source body or
complete path. Operation errors are stable and privacy-safe.
