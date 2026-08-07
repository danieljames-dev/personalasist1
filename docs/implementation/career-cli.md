# Local Career CLI

The Career CLI is a local-only Reference Candidate. Build scripts may install dependencies or push
source during development, but domain commands never send career data externally.

Every non-demo command requires `--root <absolute-workflow-root>`. Inputs and outputs must be
explicit normalized absolute paths inside the approved private input or export root. Commands do
not scan, traverse implicitly, browse, fetch, scrape, submit, email, sign, attest, or use a model.

| Command | Reads | Writes |
|---|---|---|
| `npm run career:init -- --root <root>` | tracked blank templates | ignored `<root>/private/` Identity, config, input, export, and Object-store structure |
| `career:ingest -- --root <root> --input <file>` | one selected local input | CareerSource, CareerFacts, provenance edges, local config |
| `career:profile -- --root <root>` | configured pinned CareerFacts | CareerProfile and membership edges |
| `career:job:import -- --root <root> --input <file>` | one owner-supplied local posting | JobPosting with exact provenance; currentness stays unknown unless explicit evidence exists |
| `career:match -- --root <root> --job <id>` | pinned profile, facts, posting, preferences | transparent JobMatchReport and two edges |
| `career:draft -- --root <root> --match <id>` | pinned Match and cited facts | review-gated ApplicationDraft and support edges |
| `career:export -- --root <root> --output <file>` | configured Object revisions | one local versioned JSON export followed by reload verification |
| `npm run career:demo` | tracked code and generated neutral synthetic inputs | temporary runtime only; deleted even on failure |

Add `--dry-run` to significant write commands. `--help` works globally and after every command.
Exit 0 is success, 1 is a failed-closed domain/runtime operation, and 2 is invalid arguments. Normal
output withholds complete Identity identifiers. Initialization is explicit and idempotent and copies
only blank templates; it populates no facts.

Private exports are owner data and are not source backups. Source backup tooling excludes `private/`
and `.aion-local/`; it never automatically stores private exports in `D:\AION-backups`.
