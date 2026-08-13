# D2 / D4 executor + recovery oracle

Independent of Claude D1.2. Independent of the frozen 95-gate catalog.

```powershell
cd C:\AION-HQ-grok-director-d2-d4-oracle
node scripts/acceptance/director/regressions-d2-d4/run-d2-d4-oracles.mjs
```

Proves, on this Windows host:

- dynamic Claude / Grok discovery (no pinned VS Code folder)
- `spawn(exe, argv, { shell: false })` keeps prompt data as argv
- PID is not process identity
- killing only the root leaks a detached grandchild
- exit 0 is not work-item success
- Git truth is collected independently
- capacity and lease are both required
- two OS processes cannot share a typed resource lock
- crash recovery must not blindly respawn
- executor flood cannot be stored unbounded

Does not write Claude's worktree, production, or `gate-catalog.json`.
