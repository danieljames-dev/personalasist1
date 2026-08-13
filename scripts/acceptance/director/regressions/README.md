# Known-defect regression / oracle pack

Not the frozen 95-gate catalog.

| Suite | Role |
| --- | --- |
| `scripts/acceptance/director/director-acceptance.mjs` | Independent ex-ante contract (95 gates). Do not reshape after seeing Claude. |
| `scripts/acceptance/director/regressions/` | Defects found during implementation. Must never return. |

Final Director acceptance runs **both**.

```powershell
cd C:\AION-HQ-grok-director-v01-acceptance
node scripts/acceptance/director/director-acceptance.mjs
node scripts/acceptance/director/regressions/run-regressions.mjs
```

## Packs

- `deployment-truth-regression.mjs` — sticky `deploymentTruth`. A second `DEPLOY_STARTED` is illegal until production verification establishes `VERIFIED_OLD_PRODUCTION`. The same tests fail against a breadcrumb/`interruptedFrom` machine (the known defect).
- `windows-resource-identity-regression.mjs` — live Win32/Node probes in `os.tmpdir()`. Slash+case fold is not identity. Devices, ADS, driveless roots, and missing containment roots are deny.

Does not write Claude's worktree. Does not write `private/aion/state-v1.json`. Does not mutate the 95-gate catalog.
