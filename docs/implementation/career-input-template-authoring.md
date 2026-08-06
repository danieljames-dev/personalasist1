# Career Input Template Authoring

Status: Sprint 3 Phase 6 owner guidance

Blank templates live beneath `templates/career/`:

- `career-facts.template.json`
- `career-preferences.template.json`
- `job-posting.template.json`
- `resume-evidence.template.md`
- `work-history-evidence.template.md`

The JSON templates are valid blank examples of the three v1 contracts. The Markdown templates are
neutral evidence-authoring outlines. They contain no Founder-specific values, sample employers,
names, contact details, credentials, or fabricated facts. They are examples and authoring aids,
not normative AFX-1 fixtures and not stability evidence for DG-3.

Copy a template only to an owner-controlled ignored location, normally beneath `private/career/`.
Never complete it in the tracked `templates/` tree or commit, log, or source-backup the completed
copy. Record only explicit facts; use the contract's unknown or no-preference states rather than
guessing. Sensitive details are optional and should be minimized. Passwords, tokens, government
identifiers, full financial account numbers, and unnecessary medical details do not belong in
these inputs.

Opening or copying a template does not initialize Identity, create an Object, ingest content, or
start a workflow. Phase 6 never reads a real completed template.
