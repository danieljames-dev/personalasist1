# Career Input Contract v1

Status: Sprint 3 Phase 6 reference contract
Package: `@aion/career-input`

## Boundary

The package owns three closed JSON input contracts:

| Kind | `contractVersion` | Purpose |
|---|---|---|
| Career facts | `aion.career-facts-input.v1` | Explicit owner-supplied career facts and evidence references |
| Career preferences | `aion.career-preferences-input.v1` | Explicit role, location, work, compensation, and constraint preferences |
| Job posting | `aion.job-posting-input.v1` | A bounded owner-supplied posting record for later processing |

Each validator rejects missing required members, unknown members, unsupported versions, duplicate
JSON member names, invalid canonical strings, floating-point numbers, unsafe integers, malformed
dates, and values beyond the accepted ACJ-1/DG-4a resource profile. Contract values are data only:
they are not credentials, commands, authorization grants, Object records, or evidence of truth.

## Explicit value states

Text values use `unknown`, `explicit-empty`, or `supplied`. Dates use `unknown`,
`not-applicable`, or `supplied`; supplied values are valid `YYYY-MM` or `YYYY-MM-DD` dates and an
end date cannot precede a start date. Preference lists use `unknown`, `no-preference`, or
`specified`; only `specified` may contain one or more unique values.

Currency values use exactly three uppercase ASCII letters and non-negative integer minor units.
They do not use floating-point numbers. Work arrangements are `remote`, `hybrid`, or `on-site`.
Employment types are `full-time`, `part-time`, `contract`, `temporary`, `internship`, or `other`.

## Career facts

Every entry has a version, distinct canonical `factId`, fact kind, explicit value and date states,
responsibilities, accomplishments, skills, tools and technologies, evidence references, and an
`ownerConfirmed` flag. Supported fact kinds are role title, employer, responsibility,
accomplishment, skill, tool or technology, certification, education, license, industry, and
project. Distinct entries may deliberately retain conflicting claims; validation does not infer,
merge, resolve, or rank them.

Evidence descriptors contain only a version, document kind, reference, and optional explicit
locator. A descriptor is not a file read, authenticity claim, provenance proof, or persisted
Object relationship.

## Career preferences

The contract covers desired and excluded roles, locations, work arrangements, employment types,
minimum compensation, schedule constraints, travel preference, industries of interest and to
avoid, and optional physical or other work constraints. Physical constraints are absent from the
blank template and remain optional so sensitive information is never solicited by default.

## Job posting

The contract covers title, company, location, work arrangement, employment type, compensation,
description, required and preferred skills, required experience, education and certification
requirements, travel, schedule, application deadline, and a source reference supplied as plain
input. A source reference causes no network access.

## Versioning and compatibility

All public records and result types are explicitly versioned. Unknown fields fail closed, so a
shape change requires a new contract version and explicit migration or coexistence policy. These
contracts are intentionally separate from the Pre-stable Object envelope and do not stabilize it.
Later Phase 7 work may consume validated input only under separate authorization and must preserve
the raw-versus-derived provenance distinction; no such consumer exists in Phase 6.
