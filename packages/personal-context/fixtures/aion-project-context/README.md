# AION project context — acceptance source

This folder is the bounded, deliberately harmless source used to prove the Personal Context sync
engine end to end. Everything in it describes **the AION project**, under the subject
`aion-project`. There is no Owner personal data here, and none may be added.

Two files, on purpose:

- `project-context.json` is a structured declaration, so the extractor produces facts from it.
- this `README.md` is prose, so the extractor produces **nothing** from it and records
  `UNSUPPORTED_CONTENT` in the sync receipt. That refusal is the point: the engine does not infer
  claims from free text, and a run over this folder demonstrates the refusal on real files rather
  than only in a unit test.

Proving the engine over this folder is not the same as knowing anything about the Owner. The Owner's
real sources are enrolled separately, one explicit approval at a time, through
`scripts/register-context-source.mjs`.
