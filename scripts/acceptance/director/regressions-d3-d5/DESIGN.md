# D3 / D5 oracle freeze

Director binds `127.0.0.1:31417` only. Phone reaches it only through Command Center `/api/director/*` after existing pairing + origin checks. The bridge is not an open localhost proxy: no `url`/`host`/`port` override, no path traversal, allowlisted Director routes only.

Forbidden generic writes: mission state, gate clear, deploymentTruth, lease release, review PASS, production authorize.

Owner-gate presentation: physical iPhone blocks deploy/post-deploy only. Independent READY/RUNNING work continues. Global WAITING_FOR_OWNER is legal only when an open Owner gate exists and no independent READY/RUNNING work remains. Dashboard statuses stay distinct: WORKING, WAITING_ON_OWNER_DEPENDENCY, BLOCKED, WAITING_FOR_CAPACITY, REVIEWING, READY, DEPLOYMENT_BLOCKED.

Status delivery v0.1: **polling** (2s) of durable GET /status. SSE deferred.

D5 smoke success is the D2 conjunction. Claude login-fail = UNAVAILABLE. Grok argv: `--prompt-file`, never bare `-p` plus `--prompt-file`.
