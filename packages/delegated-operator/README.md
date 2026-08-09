# @aion/delegated-operator

R6.5 / R6.5-R1 **Delegated Operator Control Plane** (administrative).

## Status

- **Implementation:** present (R6.5-R1 activation-blocker corrections applied)
- **Real approval root activated:** **NO**
- **Elevated broker installed/activated:** **NO**
- **Founder remains authoritative:** **YES**
- **Normal AION chat/model path:** must not use this package as shell authority

## Architectural rule

**Request-supplied facts are never trusted observations.** Envelope fields are
EXPECTATIONS. Host/repo/git/broker-integrity ports produce OBSERVATIONS. Production
composition constructs those adapters; callers cannot inject both sides of a comparison.

## R6.5-R1 corrections

| ID | Correction |
|----|------------|
| M-1 | HostFactsPort / RepositoryFactsPort for machine, root, origin |
| M-2 | Strict canonical UTC timestamps at parse; fail-closed expiry |
| M-3 | BrokerIntegrityPort (expected from protected install vs measured) |
| M-4 | Protected install layout (Program Files + ProgramData); no load from C:\AION-HQ after activation |
| M-5 | DurableReplayStore survives broker restart |
| M-6 | Owner UI binds exact displayed envelope digest + one-time nonce |
| M-7 | GitFactsPort / ExecGitFactsPort for independent ancestry |

## What it is not

- Not R6.5.1 broker activation
- Not real Owner signing key provisioning
- Not private migration / writer cutover / desktop promotion
- Not a model-callable unrestricted shell

## Tests

```bash
npm run test --workspace @aion/delegated-operator
```
