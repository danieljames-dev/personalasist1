# `@aion/job-posting`

Sprint 3 Phase 8 reference package for explicit owner-supplied Job Posting import. It accepts one
explicit `.json`, `.md`, or `.txt` path beneath one approved root, repeats Phase 6 preflight, and
creates or explicitly revises one bounded `JobPostingObject`.

Structured JSON maps only the accepted Phase 6 fields. Markdown and text map their exact UTF-8 body
only to `description`; every other field is `not-supplied`. Currentness defaults to `unknown` and
changes only with explicit owner-observation evidence. Source references are inert and never
fetched. The package has no matching, scoring, ranking, drafting, network, browser, model,
telemetry, database, vector-store, Identity-persistence, or source-scanning behavior.
