# R6.5 / R6.5-R1 Elevated Operator Broker

## Status

- Implemented: YES (source + synthetic tests + R6.5.1 install path)
- Installed as Windows service: **YES** (R6.5.1 on Owner-authorized machines)
- Activated: **YES** after R6.5.1 install (local Owner UI + provisioned presence)
- UAC disabled: **NO**
- Owner password stored: **NO**
- Arbitrary elevated PowerShell exposed: **NO**
- High-consequence ops independently gated: YES
- Unattended routine elevation after activation: YES (authorized envelope ops)
- Protected install architecture: YES (Program Files + ProgramData)
- Durable anti-replay: YES
- Independent integrity port: YES
- Founder recovery/breakglass: AVAILABLE

## IPC

Named pipe contract: `\\.\pipe\AION-ElevatedOperatorBroker-v1` (HMAC-framed messages).
No public TCP listener.

## Service account

Virtual service account / NT SERVICE style; LocalSystem not default.

## Protected installation architecture (M-4) — NOT DEPLOYED in R6.5-R1

Future activated brokers must **never** load privileged binaries, policy, templates,
pipe ACLs, or service definitions from the writable Git tree `C:\AION-HQ`.

### Layout (conventions for R6.5.1+)

| Role | Path |
|------|------|
| Install root (code/policy) | `C:\Program Files\AION\ElevatedOperatorBroker\` |
| State root (replay, manifest) | `C:\ProgramData\AION\ElevatedOperatorBroker\` |
| Binary | `...\bin\aion-elevated-broker.exe` |
| Policy | `...\config\policy.v1.json` |
| Service definition | `...\service\aion-elevated-broker.xml` |
| Expected digests | `C:\ProgramData\AION\ElevatedOperatorBroker\manifest.v1.json` |

### Packaging flow (future Owner-gated install)

1. Build/review pinned artifacts from the monorepo (or signed release).
2. Copy **only** reviewed files into the install root (not a live bind-mount of `C:\AION-HQ`).
3. Compute SHA-256 digests; write `manifest.v1.json` under the state root.
4. Apply ACLs: Administrators + service SID write; Authenticated Users no write on install root.
5. Register service under virtual service account with pipe ACL limited to that SID + local Owner UI process.
6. Broker at startup measures actual files and compares to protected manifest via `BrokerIntegrityPort`.
7. **Mismatch or unavailable integrity → refuse all elevated ops.**

### Capability separation

| Capability | Who | May touch broker install/state |
|------------|-----|--------------------------------|
| Ordinary GROK_BUILD repo write | Builder lease | **NO** |
| Privileged broker update | Separate Owner high-consequence maintenance envelope | YES (future) |
| Repository write authority | Founder / delegated builder envelope | repo tree only |

Ordinary builder envelopes (`repo.edit`, `powershell.repo_operation`, elevated write ops)
**refuse** any path under the protected roots. Substring-only checks are not the trust
boundary; the OS-protected layout + independent integrity measurement is.

### R6.5.1 ACL / Service-SID expectations (document only — not applied here)

- Install root: inherited deny-write for Users; service SID + Administrators full.
- State root: service SID write for replay/manifest; Administrators full.
- Named pipe: create/connect for service SID and Owner UI host process only.
- No dependency on scripts under `C:\AION-HQ` after activation.
- Code signing of the broker binary recommended before first install.

## Anti-replay (M-5)

`DurableReplayStore` under the broker state directory. Consume write-ahead before
privileged execution. Restart of the broker process reloads the same state and
refuses reuse. Corrupt/missing state fails closed.

## Integrity (M-3)

`BrokerIntegrityPort.expectedDigests()` comes from protected installation state.
`measureActualDigests()` measures files independently. Callers cannot supply both
sides of the comparison.

## Activation (R6.5.1)

Owner-authorized install via `scripts/r65.1/install-elevated-broker.ps1` (UAC once).
Pins digests under ProgramData `manifest.v1.json`. Service: `AionElevatedBroker`.
Owner UI loopback; Founder phrase script remains available as recovery.
