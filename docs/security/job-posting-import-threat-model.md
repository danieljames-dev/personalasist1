# Job Posting Import Privacy and Threat Model

Status: Sprint 3 Phase 8 reference boundary

Job Postings may contain owner-sensitive search context. Phase 8 requires a single explicit path
beneath a single approved root, applies DG-4a limits before canonical output or persistence,
returns redacted references, and keeps source/Object state ignored and excluded from source backups.

| Threat | Control | Residual risk |
|---|---|---|
| directory scan or archive harvesting | no discovery API; exactly one explicit root/path; no home, archive, browser, email, cloud, or drive access | an owner may later explicitly select a sensitive file |
| traversal, device, link, junction, or reparse escape | Phase 3 authorization/recheck, Phase 6 preflight, bounded reread, and repository containment | platform link-swap and privilege behavior remain |
| malformed or oversized input | strict UTF-8 without BOM/NUL, closed ACJ-1 JSON, safe integers, and inclusive 4 MiB input limit | accepted bounded input can still contain sensitive text |
| semantic invention from prose | Markdown/text map exact body only to description; every other field is `not-supplied`; no heading/parser/model inference | humans must structure fields explicitly when desired |
| fabricated compensation or requirements | direct closed mapping only; exact minor-unit validation; no omitted-field inference | owner-supplied structured data may itself be wrong |
| false freshness claim | currentness defaults unknown; URL, deadline, source reference, and import time are never evidence; only explicit owner observation is accepted | observations become stale and are not perpetual guarantees |
| source-reference exfiltration | reference is inert data; no network, browser, fetch, scrape, API, telemetry, or analytics dependency | another future authorized subsystem must preserve inertness |
| duplicate or overwrite | deterministic create identity, exact retry comparison, explicit expected revision, immutable history, and no-overwrite repository | operation-ID conflicts require owner resolution |
| partial persistence | exactly one atomic Object revision; injected failure tests prove no partial accepted state | filesystem durability remains host-dependent |
| premature Phase 9 behavior | package exports import only; architecture tests reject matching, scoring, ranking, and drafting dependencies/API | Phase 9 requires separate authorization and design |

All Phase 8 tests use neutral synthetic temporary files, synthetic typed Identity references, and
temporary repositories. No real Job Posting, career data, permanent Object, Identity value, or
AI-assistant archive is read. DG-3 and DG-4b remain Open and the Object Contract remains Pre-stable.
