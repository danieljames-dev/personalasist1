# Contributing to AION

Start with the problem and evidence, not code. Use the templates in
`docs/templates/`, identify the owning component, and list affected contracts and
ADRs.

A change is reviewable only when it preserves component boundaries, includes tests
proportional to risk, updates documentation, and supplies migration/rollback steps
where necessary. Runtime dependencies require an ADR or an accepted dependency
assessment showing maintenance health, security posture, necessity, and exit path.

Run `npm test` before review. Never commit generated output, dependencies, secrets,
owner data, credentials, or local configuration.

