# CTO DIRECTIVE
## Project AION
### Sprint 3.0 — Minimum Personal Career Vertical Slice

This directive records the Founder/CTO decision to end foundation-only development and
begin the first narrowly controlled, owner-useful vertical slice.

Current reported repository state:

- Branch: main
- Current reported HEAD:
  3dde2353e6350bd2801a4e70ffe85795542e4324
- Canonical remote:
  https://github.com/danieljames-dev/personalasist1.git
- External backup root:
  D:\AION-backups
- Working tree: clean
- Local main and origin/main: synchronized
- npm run verify: 12 passed, 0 failed
- ADR-007: Accepted
- ADR-008: Accepted
- ADR-009: Accepted
- ADR-010: Proposed
- DG-1 Identity bootstrap: Open
- DG-2 Canonical serialization: Closed
- DG-3 Representative fixtures: Open
- DG-4 Resource and complexity limits: Open
- Object Contract: Pre-stable
- Production implementation freeze: Active
- No personal data has been authorized for repository use
- No job discovery or job application system exists

This directive contains two sequential decisions:

1. Ratify the bounded resource-limit architecture.
2. Lift the implementation freeze only for the Minimum Personal Career Vertical Slice.

Do not expand implementation beyond the authorization in this directive.

======================================================================
FOUNDER/CTO DECISION — SPLIT DG-4
======================================================================

Split DG-4 into two independently tracked gates.

DG-4a — Canonical Processing Resource Limits

Scope:

- raw canonical-contract input limits;
- structural depth;
- object-member count;
- array-element count;
- total value-node count;
- canonical-position string limits;
- identifier limits;
- canonical output limits;
- AION Frame v1 field and payload limits;
- deterministic accept/reject boundaries;
- overflow-safe accounting;
- canonical processing rejection semantics.

DG-4a may close after the corrections and evidence already recorded in Sprint 2.9 are
ratified.

DG-4b — Object and Domain Workload Limits

Scope:

- relationship counts;
- provenance sizes;
- history retrieval;
- aggregate sizes;
- career document counts;
- Memory workloads;
- Planner workloads;
- workflow batches;
- concurrent operations;
- persistence workloads;
- domain-specific processing limits;
- user-facing service quotas;
- production time budgets.

DG-4b remains open.

DG-4b does not block a local, single-owner, bounded reference vertical slice using small,
explicitly approved inputs.

It does block claims of:

- production-scale Object ingestion;
- hostile public ingestion;
- unbounded document processing;
- multi-user service readiness;
- production workload readiness.

Update every relevant gate register so DG-4 is no longer treated as one indivisible
gate.

======================================================================
FOUNDER/CTO DECISION — ADR-010
======================================================================

Accept ADR-010 only for the DG-4a canonical-processing scope.

Before accepting it:

1. State explicitly that one named profile has one deterministic limit per owned
   surface.
2. Preserve deployment admission limits as separate policy outcomes.
3. Preserve the exact total-value-node definition.
4. Preserve exact processing-stage ownership.
5. Preserve JCS-compatible UTF-16 code-unit member ordering.
6. Add the out-of-range integer requirement described below.
7. Remove or defer any domain or Object-business limit that lacks an implementation or
   workload to validate it.
8. Do not imply that DG-4b is closed.
9. Do not imply production controls exist merely because limits are specified or
   benchmarked.

Use the current local date and CTO as decision owner.

Create:

docs/decisions/CTO-DECISION-008-resource-limits-and-vertical-slice.md

The decision must record:

- the DG-4a/DG-4b split;
- ADR-010 acceptance scope;
- DG-4a closure;
- DG-4b remaining open;
- the vertical-slice authorization boundary;
- privacy and personal-data restrictions;
- remaining architecture risks.

======================================================================
OUT-OF-RANGE INTEGER DECISION
======================================================================

Resolve NF-1.

A conforming AION implementation must not trust a host parser merely because the parser
successfully produced a numeric value.

At the canonical validation boundary:

- integers outside the accepted exact range are rejected;
- the accepted exact range must be defined by the canonical profile;
- JavaScript precision loss above its exact integer range must not be silently accepted;
- Python or another runtime preserving a larger integer must still apply the same AION
  contract limit;
- the same source contract value must receive the same AION accept/reject result across
  runtimes.

Add the required future cross-runtime fixture to the fixture coverage register.

Do not create the normative fixture in this directive.

======================================================================
SPRINT 3.0 MISSION
======================================================================

Build the smallest end-to-end AION workflow that provides direct value to its owner.

The vertical slice must allow the owner to:

1. Initialize one local AION owner identity.
2. Place explicitly selected career files into a private local input location.
3. Import and index those files with provenance.
4. Maintain a structured, evidence-backed career profile.
5. Import one job posting supplied by the owner.
6. Compare the job posting against the career profile.
7. Produce a transparent match report.
8. Produce an application-preparation draft.
9. Review every claim and its supporting evidence.
10. Export the private career workspace locally.

This sprint does not perform internet job discovery.

This sprint does not submit applications.

This sprint does not send email.

This sprint does not access Gmail, Google Drive, a phone, browser history, cloud
accounts, private GitHub repositories, or arbitrary laptop folders.

======================================================================
IMPLEMENTATION AUTHORIZATION
======================================================================

The implementation freeze is lifted only for:

- local single-owner Identity bootstrap;
- the minimum Identity records needed by this slice;
- a replaceable local Identity repository adapter;
- the minimum Universal Object envelope needed by this slice;
- a replaceable local Object repository adapter;
- bounded canonical validation needed by this slice;
- bounded canonical serialization needed by this slice;
- local career-source ingestion;
- an evidence-backed Career Profile;
- owner-supplied Job Posting ingestion;
- deterministic job-match analysis;
- application-preparation drafting;
- CLI commands;
- tests;
- synthetic demonstration data;
- local export;
- documentation.

The freeze remains active for:

- general-purpose Memory;
- Planner;
- Event Bus;
- Knowledge Graph;
- Capability Registry;
- Workflow Engine;
- autonomous agents;
- plugins;
- browser automation;
- web scraping;
- job-board integrations;
- Gmail or Calendar;
- automatic applications;
- application submission;
- external account access;
- multi-owner tenancy;
- authentication providers;
- authorization policy engines;
- public APIs;
- production deployment;
- cloud storage;
- remote synchronization;
- vector databases;
- model training;
- unrestricted filesystem crawling.

======================================================================
PHASE 1 — VERIFY REPOSITORY STATE
======================================================================

Before modifying anything, inspect and report:

1. Current branch.
2. Current HEAD.
3. Origin URL.
4. Ahead/behind state.
5. Working-tree state.
6. Staged and untracked files.
7. ADR-007 through ADR-010 statuses.
8. DG-1, DG-2, DG-3, DG-4 states.
9. Object Contract stability state.
10. Existing package/workspace structure.
11. Existing Kernel public contracts.
12. Existing architecture-boundary tests.
13. Latest successful backup manifest.
14. Current npm run verify result.

The expected current test result is 12 passed and 0 failed.

Stop if:

- origin differs from the approved remote;
- the branch has diverged;
- unexplained changes exist;
- verification fails;
- production source changed outside prior authorization;
- ADR-007, ADR-008, or ADR-009 is no longer Accepted;
- DG-2 is no longer closed.

Do not discard unexplained work.

======================================================================
PHASE 2 — RATIFY RESOURCE LIMITS
======================================================================

Apply the minimum documentation changes required to:

1. Split DG-4 into DG-4a and DG-4b.
2. Close DG-4a.
3. Keep DG-4b open.
4. Accept ADR-010 for DG-4a only.
5. Record the out-of-range integer decision.
6. Keep the Object Contract Pre-stable.
7. Keep DG-3 open.
8. Preserve all limitations of benchmark evidence.
9. Preserve the statement that no production security control currently exists merely
   because it is specified.

Run npm run verify.

Create a documentation-only commit:

docs: accept canonical resource limits and split DG-4

- Accept ADR-010 for canonical-processing limits
- Close DG-4a
- Preserve DG-4b for Object and domain workloads
- Require cross-runtime rejection of out-of-range integers
- Keep DG-3 open and the Object Contract pre-stable
- Authorize only the minimum personal-career vertical slice

Do not include vertical-slice implementation in this commit.

Push normally to the approved canonical remote.

Run the approved external backup and restore process after the push.

Stop and report if the commit, push, backup, or restore verification fails.

======================================================================
PHASE 3 — PRIVACY AND DATA-OWNERSHIP BOUNDARY
======================================================================

Before implementing career ingestion, establish the private-data boundary.

Private owner data must not be stored inside tracked repository paths.

Use a local runtime root that is ignored by Git.

Preferred project-relative location:

private/

Create or update .gitignore so all content under private/ is ignored.

Do not commit actual private files.

Do not commit empty placeholder files inside private/.

Create tracked templates under a non-private location such as:

templates/career/

The implementation must never automatically scan:

- the owner’s home directory;
- Desktop;
- Documents;
- Downloads;
- browser profiles;
- email stores;
- cloud-drive folders;
- external drives;
- Git repositories;
- phone backups;
- removable media.

The implementation may read only:

- a path explicitly supplied by the owner in the current command; or
- the configured private career input directory after the owner places files there.

No path inference.

No recursive traversal outside the approved root.

No symbolic-link or junction escape.

No network access.

No telemetry.

No analytics.

No model-provider call.

No external API call.

No personal data may appear in:

- Git commits;
- test fixtures;
- logs intended for source control;
- benchmark evidence;
- error stack traces committed to the repository;
- synthetic examples.

The external backup automation must exclude private/ by default.

Do not place private career data onto D:\ automatically.

A separate encrypted personal-data backup policy will be required before owner data is
included in external backups.

======================================================================
PHASE 4 — LOCAL IDENTITY BOOTSTRAP
======================================================================

Implement the minimum single-owner local Identity bootstrap consistent with ADR-006.

On first explicit initialization:

1. Generate one OwnerIdV1.
2. Generate one PrincipalIdV1.
3. Generate one ActorIdV1.
4. Generate one SystemInstanceIdV1.
5. Persist the records and relationships:
   - Actor → Principal
   - Principal → Owner
   - System Instance → Owner
6. Record:
   - created timestamp;
   - updated timestamp;
   - version;
   - lifecycle status;
   - provenance;
   - generator/profile version.

The bootstrap must:

- require an explicit CLI command;
- be idempotent;
- never create a second owner silently;
- fail if conflicting bootstrap state exists;
- never treat the IDs as credentials;
- never implement authentication;
- never implement authorization;
- never include an email, username, display name, vendor identifier, or device name in a
  canonical identifier;
- support local export;
- use injected clock and identifier-generator ports in tests;
- use atomic local persistence;
- preserve IDs exactly across reload.

Create a focused decision or implementation note if required:

docs/implementation/local-owner-bootstrap.md

Do not claim DG-1 is fully closed for all future deployment models.

Split it if necessary:

- DG-1a: local single-owner reference bootstrap;
- DG-1b: secure external-access bootstrap and authentication boundary.

DG-1a may close after this vertical slice passes.

DG-1b remains open.

======================================================================
PHASE 5 — MINIMUM OBJECT REFERENCE IMPLEMENTATION
======================================================================

Implement only the Object capabilities required by this vertical slice.

Required Object families:

1. CareerSourceObject
2. CareerFactObject
3. CareerProfileObject
4. JobPostingObject
5. JobMatchReportObject
6. ApplicationDraftObject
7. RelationshipObject

Every persisted record must include the approved minimum Object envelope fields required
by ADR-007, including:

- opaque object ID;
- object family/profile;
- owner reference;
- actor reference;
- lifecycle status;
- created and updated timestamps;
- version;
- provenance;
- schema/profile references;
- integrity metadata where the accepted contract requires it.

RelationshipObject remains the sole persisted relationship truth.

Use relationships such as:

- CareerFact derivedFrom CareerSource
- CareerProfile contains or references CareerFact
- JobMatchReport evaluates JobPosting
- JobMatchReport uses CareerProfile
- ApplicationDraft derivedFrom JobMatchReport
- ApplicationDraft supportedBy CareerFact

Do not embed relationship arrays into Object envelopes.

Do not create a generic unrestricted mutation API.

Use explicit commands or operations for each allowed transition.

Use a replaceable local reference repository.

For this vertical slice, a bounded filesystem-backed adapter is authorized.

It must:

- live under private/;
- use atomic write or append semantics;
- reject path traversal;
- preserve versions;
- avoid silent overwrite;
- retain provenance;
- be independently testable;
- not be described as the permanent production storage decision.

No database is authorized.

======================================================================
PHASE 6 — CAREER INPUT CONTRACT
======================================================================

Support owner-approved UTF-8 input files only.

Required supported inputs:

- .json
- .md
- .txt

Do not support PDF, DOCX, email archives, images, OCR, browser pages, or cloud documents
in this sprint.

Create tracked templates under:

templates/career/

At minimum create:

templates/career/career-facts.template.json

templates/career/career-preferences.template.json

templates/career/job-posting.template.json

templates/career/resume-evidence.template.md

templates/career/work-history-evidence.template.md

The structured career-facts template should support:

- role titles;
- employers;
- start and end dates;
- responsibilities;
- accomplishments;
- skills;
- tools and technologies;
- certifications;
- education;
- licenses;
- industries;
- projects;
- evidence references;
- owner-confirmed status.

Career preferences should support:

- desired roles;
- excluded roles;
- locations;
- remote/hybrid/on-site preference;
- employment type;
- minimum compensation where supplied;
- schedule constraints;
- travel preference;
- industries of interest;
- industries to avoid;
- physical or other work constraints only when the owner explicitly supplies them.

Do not infer sensitive health or disability information.

Do not require the owner to include sensitive information.

Do not commit completed templates containing owner data.

======================================================================
PHASE 7 — CAREER EVIDENCE AND PROFILE
======================================================================

Implement a local evidence catalogue.

Each imported source must record:

- source object ID;
- original filename;
- approved source path relative to the private input root;
- source type;
- import timestamp;
- content digest;
- owner ID;
- importing actor ID;
- parser version;
- processing outcome.

Every CareerFact must record:

- fact ID;
- fact type;
- normalized value;
- source object ID;
- source location, section, or field;
- confidence;
- owner-confirmed status;
- extraction method;
- created timestamp;
- supersession state.

Do not present an inferred fact as owner-confirmed.

Do not invent:

- employment dates;
- job titles;
- degrees;
- certifications;
- licenses;
- accomplishments;
- metrics;
- salary history;
- skills;
- security clearances;
- eligibility;
- physical capabilities.

Conflicts must be represented explicitly.

Example:

- one source says an employment period ended in 2021;
- another says 2022.

Do not silently choose one.

Create a CareerProfileObject derived only from:

- owner-confirmed structured facts; and
- clearly labelled extracted or inferred candidate facts.

The profile must distinguish:

- verified;
- owner-confirmed;
- extracted;
- inferred;
- conflicting;
- missing.

The first implementation may use deterministic parsing and explicit structured inputs.

Do not add an LLM dependency.

Do not call an external model.

======================================================================
PHASE 8 — JOB POSTING IMPORT
======================================================================

The owner must explicitly provide the job posting.

Support:

- structured JSON from the supplied template;
- plain UTF-8 text or Markdown.

A JobPostingObject should support:

- title;
- company;
- location;
- work arrangement;
- employment type;
- compensation where supplied;
- description;
- required skills;
- preferred skills;
- required experience;
- education requirements;
- certification requirements;
- travel;
- schedule;
- application deadline where supplied;
- source reference manually supplied by the owner;
- imported timestamp.

Do not fetch the source URL.

Do not browse the internet.

Do not scrape job boards.

Do not claim the listing is still open unless the owner supplies current evidence.

Do not infer compensation or requirements that are not present.

======================================================================
PHASE 9 — TRANSPARENT JOB MATCHING
======================================================================

Implement a deterministic, explainable matching baseline.

The algorithm must be configuration-driven and visible to the owner.

Evaluate at minimum:

- required-skill coverage;
- preferred-skill coverage;
- relevant experience;
- role-title alignment;
- industry alignment;
- location and work-arrangement compatibility;
- employment-type compatibility;
- compensation compatibility where both sides contain evidence;
- explicit exclusions;
- missing mandatory qualifications;
- unsupported or unknown requirements.

Return:

- overall score;
- score components;
- matched requirements;
- unmatched requirements;
- uncertain requirements;
- disqualifying conflicts;
- evidence for every match;
- configuration/profile version;
- explanation of limitations.

Do not claim the score predicts hiring probability.

Do not use protected or sensitive personal attributes.

Do not create hidden weights.

Do not treat unknown as satisfied.

A required qualification that is unknown must remain unknown.

Allow weights to be configured locally, with safe defaults documented and versioned.

======================================================================
PHASE 10 — APPLICATION PREPARATION
======================================================================

Generate preparation materials only.

Required outputs:

1. Job match report in JSON.
2. Human-readable job match report in Markdown.
3. Tailored résumé recommendation document.
4. Cover-letter draft.
5. Application-question preparation file.
6. Missing-information checklist.
7. Evidence appendix linking every material claim to CareerFact records.

The tailored résumé recommendation may propose:

- ordering changes;
- skills to emphasize;
- verified accomplishments to surface;
- irrelevant material to de-emphasize;
- keywords already supported by evidence.

It must not invent content.

The cover-letter draft must:

- use only supported facts;
- include visible placeholders where information is missing;
- avoid claiming enthusiasm, familiarity, or experience not supported by owner input;
- identify every material supporting CareerFact;
- remain a draft requiring owner review.

Do not produce:

- a fabricated résumé;
- an application submission;
- an email;
- a browser action;
- a legal certification;
- consent to a background check;
- a salary representation not supplied by the owner;
- an answer to demographic or disability questions.

======================================================================
PHASE 11 — CLI WORKFLOW
======================================================================

Provide a simple local CLI workflow consistent with repository conventions.

Preferred commands:

npm run career:init

npm run career:ingest -- --input <explicit-approved-path>

npm run career:profile

npm run career:job:import -- --input <explicit-job-file>

npm run career:match -- --job <job-object-id>

npm run career:draft -- --match <match-report-id>

npm run career:export -- --output <explicit-local-path>

npm run career:demo

Adapt command names only when existing repository conventions require it.

career:init must:

- create the ignored private directory structure;
- create local configuration;
- bootstrap the local owner identity;
- copy blank templates into the private input directory;
- not populate them with personal data.

career:demo must:

- use entirely synthetic people, employers, skills, and job information;
- write only to a temporary or demo path;
- never resemble the Founder’s actual personal history;
- complete the entire vertical slice;
- produce a profile, match report, and application draft.

Every command must support:

- clear help;
- deterministic exit codes;
- understandable errors;
- no network behavior;
- no hidden file traversal;
- safe re-runs;
- dry-run mode where a write operation is significant.

======================================================================
PHASE 12 — CANONICAL AND RESOURCE-LIMIT BOUNDARY
======================================================================

Implement only the accepted canonical-processing subset required by this vertical slice.

The implementation must be labelled:

Reference Candidate

It must not be called fully conformant while DG-3 remains open.

At minimum enforce:

- raw input byte limit;
- depth limit;
- member-count limit;
- array-element limit;
- total-value-node limit;
- string byte limit;
- member-name limit;
- identifier limit;
- exact integer range;
- prohibited binary-float canonical positions;
- timestamp syntax and precision;
- NFC requirement;
- deterministic UTF-16 code-unit member ordering;
- canonical-output limit;
- AION Frame v1 boundaries where integrity metadata is generated.

Use cheapest safe checks first where practical.

Do not silently:

- normalize invalid Unicode;
- truncate timestamps;
- coerce numbers;
- remove duplicate members;
- remove unknown fields;
- repair identifiers;
- fill missing required fields.

Reject invalid canonical-position values before producing integrity output.

Add explicit documentation that this implementation remains a candidate until independent
fixtures and cross-runtime conformance exist.

======================================================================
PHASE 13 — TEST PLAN
======================================================================

Add deterministic tests covering at minimum:

Identity:

- initial bootstrap;
- idempotent re-run;
- conflicting state;
- actor → principal → owner resolution;
- exact reload;
- injected clock and ID generator.

Private-data boundary:

- private/ ignored by Git;
- no traversal outside approved root;
- symlink or junction escape rejection where testable;
- no automatic home-directory scan;
- no network calls.

Object repository:

- atomic persistence;
- reload;
- version increment;
- no silent overwrite;
- RelationshipObject as sole edge truth;
- export.

Canonical/resource limits:

- exact integer rejection;
- depth boundary;
- member boundary;
- array boundary;
- node boundary;
- UTF-8 byte boundary;
- non-NFC rejection;
- timestamp excess-precision rejection;
- UTF-16 member ordering;
- output limit;
- no integrity output after rejection.

Career ingestion:

- structured fact import;
- source provenance;
- owner-confirmed versus inferred distinction;
- conflicting facts preserved;
- unsupported extension rejected;
- oversized input rejected.

Job matching:

- required match;
- required missing;
- unknown requirement;
- explicit exclusion;
- location conflict;
- compensation unknown;
- deterministic scoring;
- evidence linking.

Drafting:

- only supported claims used;
- missing data creates placeholders;
- no unsupported metrics;
- every material claim has evidence;
- output marked Draft — Owner Review Required.

End-to-end:

- synthetic career intake;
- synthetic job import;
- profile creation;
- match report;
- draft generation;
- export;
- reload and repeatability.

Keep all existing tests.

Do not hardcode the final test count.

The test count may increase, but no existing test may disappear without documented
Founder/CTO approval.

======================================================================
PHASE 14 — DOCUMENTATION
======================================================================

Create:

docs/sprints/sprint-3.0-career-vertical-slice/specification.md

docs/sprints/sprint-3.0-career-vertical-slice/acceptance-criteria.md

docs/sprints/sprint-3.0-career-vertical-slice/risks.md

docs/security/career-data-threat-model.md

docs/privacy/personal-data-boundary.md

docs/implementation/career-cli.md

docs/implementation/reference-candidate-status.md

docs/reviews/sprint-3.0-career-vertical-slice-review.md

Update:

docs/README.md

AION_V2_MASTER_PLAN.md

The documentation must state exactly:

- what AION can now do;
- what it cannot do;
- what personal data it reads;
- where that data is stored;
- what is sent externally;
- whether data is included in backup;
- what remains non-conformant;
- what the owner must review.

No marketing language.

Do not claim autonomous job search or application capability.

======================================================================
PHASE 15 — ARCHITECTURE REVIEW
======================================================================

Review the implementation against:

1. Identity boundary.
2. Object Model boundary.
3. RelationshipObject rule.
4. Canonical serialization boundary.
5. Resource-limit boundary.
6. Provenance.
7. Data ownership.
8. Private-data isolation.
9. Replaceability.
10. Storage independence.
11. Determinism.
12. Testability.
13. No vendor lock-in.
14. No hidden network access.
15. No unsupported claim generation.
16. No automatic application behavior.
17. No broad filesystem collection.
18. No personal data committed.
19. No premature Memory or Planner implementation.
20. Whether the slice provides real owner value.

Return exactly one recommendation:

APPROVE
APPROVE WITH CHANGES
REJECT

Correct blocking findings before committing.

Do not expand scope to fix non-blocking future concerns.

======================================================================
PHASE 16 — VERIFICATION AND HYGIENE
======================================================================

Run all repository verification commands.

At minimum:

npm run verify

Run the complete synthetic demonstration.

Run the CLI help commands.

Run a clean temporary-directory end-to-end test.

Inspect the complete Git diff.

Confirm:

- no personal owner data;
- no résumé or employment history belonging to the Founder;
- no email content;
- no credentials;
- no API keys;
- no network calls;
- no external account access;
- no machine-specific usernames;
- no private runtime files;
- no private/ content staged;
- no database;
- no vector store;
- no unrelated dependency;
- no job-board integration;
- no application submission;
- no production package importing benchmark tooling.

If any private data is staged:

- remove it from the index without deleting the owner’s local copy;
- confirm .gitignore protection;
- stop and report before committing.

======================================================================
PHASE 17 — COMMIT BOUNDARIES
======================================================================

Use separate commits.

COMMIT 1 was the resource-limit ratification commit from Phase 2.

COMMIT 2:

feat: add local career intake and job-match vertical slice

- Bootstrap one local owner identity
- Persist bounded local career Objects with provenance
- Import owner-approved career files
- Build an evidence-backed Career Profile
- Import an owner-supplied Job Posting
- Produce a transparent match report
- Generate review-required application drafts
- Keep private data outside Git
- Make no network calls and submit no applications

Reference candidate only. DG-3 and DG-4b remain open.

COMMIT 3, only when documentation changes are meaningfully separable:

docs: document the career vertical slice and personal-data boundary

Do not add model co-author trailers unless governance requires them.

Before every commit:

- run npm run verify;
- run the relevant end-to-end command;
- inspect the staged files;
- verify no private data is staged.

======================================================================
PHASE 18 — PUSH AND BACKUP
======================================================================

Push normally to:

https://github.com/danieljames-dev/personalasist1.git

Do not force push.

Confirm:

- origin/main contains all approved commits;
- local and remote are synchronized;
- working tree contains no unexpected files;
- private runtime data remains ignored and local.

Run the approved external code/documentation backup process using:

D:\AION-backups

The backup process must continue excluding:

private/

Do not include real personal career data in the external backup.

Require:

- mirror update;
- timestamped Git bundle;
- SHA-256 checksums;
- manifest;
- isolated restore;
- checkout of exact HEAD;
- npm ci;
- npm run verify;
- synthetic career demo;
- SUCCESS only after all checks pass.

Do not alter the current backup strategy to include personal data.

======================================================================
PHASE 19 — STOP BEFORE REAL DATA INGESTION
======================================================================

After implementation, tests, documentation, push, and backup succeed:

Stop.

Do not ingest the Founder’s actual files.

Do not ask the operating system to locate them.

Do not scan the laptop.

Do not search jobs.

Do not submit applications.

Return instructions showing exactly how the owner can:

1. Run career:init.
2. Review the generated private directory.
3. Fill or copy selected files into the approved input directory.
4. Run a dry-run ingestion.
5. Inspect what would be imported.
6. Approve the first real ingestion.

The first real ingestion requires a separate explicit owner command.

======================================================================
FINAL RESPONSE REQUIRED
======================================================================

Return:

1. Initial repository state.
2. DG-4a/DG-4b split result.
3. ADR-010 final status.
4. DG-4a and DG-4b status.
5. NF-1 integer decision result.
6. Resource-limit commit, push, backup, and restore result.
7. Vertical-slice architecture.
8. Identity bootstrap implementation.
9. Object reference implementation.
10. Private-data storage layout.
11. Supported input types.
12. Career evidence and profile behavior.
13. Job Posting behavior.
14. Match scoring behavior.
15. Application-draft behavior.
16. CLI commands.
17. Synthetic demo result.
18. Architecture-review recommendation.
19. Files created or modified.
20. Exact test and verification results.
21. Hygiene and privacy scan.
22. Implementation commit hashes.
23. Push and synchronization result.
24. Backup paths, checksum, manifest, and restore result.
25. What AION can now do.
26. What AION still cannot do.
27. Exact instructions for the first owner-approved real-data dry run.
28. Remaining blockers.
29. Exact next recommended task.

Do not ingest real owner data.

Do not search the internet for jobs.

Do not submit an application.

Stop after reporting.
