# @aion/career-input

This package defines the closed version-1 owner-input contracts and explicit non-ingesting preflight
for Sprint 3 Phase 6. It accepts only an explicitly named local `.json`, `.md`, or `.txt` regular
file beneath an explicitly named approved root. Input must be strict UTF-8 without a BOM or NUL and
must not exceed the inclusive 4 MiB DG-4a raw-input limit.

JSON preflight validates exactly one supported career-facts, career-preferences, or job-posting
contract. Text evidence is decoded without normalization and is never returned by preflight. Results
contain only kind, extension, byte count, contract version where applicable, and fixed safety flags;
they never contain the document body or full path.

The package reuses the Phase 3 privacy boundary and the accepted ACJ-1 parser/limits. It does not
import an Object repository adapter or Identity persistence and does not create, persist, copy,
modify, ingest, index, infer from, or summarize any input. It has no network, telemetry, model,
database, vector-store, matching, drafting, authentication, authorization, or archive behavior.
Phase 7 remains unauthorized.
