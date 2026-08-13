# Tailscale HTTPS verification plan (probe-only)

**Do not change production networking from Grok acceptance lab.**

## Evidence tiers (report separately)

| Field | Pass means |
|-------|------------|
| **TAILSCALE_CONTROL_PLANE_CAPABILITY** | MagicDNS + HTTPS Certificates enabled (or capability confirmed); Serve available on host |
| **LOCAL_HTTPS_VERIFY** | Local/host HTTPS check succeeds — **not** phone proof |
| **TAILSCALE_HTTPS_PASS** | Tailnet HTTPS URL works for a tailnet client |
| **PHYSICAL_IPHONE_OWNER_RETEST_PENDING** | Default until Owner confirms Safari on device |

Local HTTPS verify **must not** be promoted to physical iPhone PASS.

## Requirements

| Flag | Value |
|------|-------|
| TAILSCALE_FUNNEL | OFF |
| PUBLIC_INTERNET | NO |
| ROUTER_PORT_FORWARD | NO |
| OLLAMA | localhost only |
| Unauth AION API | 401 without pair |

## Owner / admin one-time (cannot fully automate)

1. Tailscale admin → DNS → enable **MagicDNS**  
2. Enable **HTTPS Certificates** (acknowledge public ledger for names)  
3. On AION host: `tailscale serve` for port 31415 (exact CLI per client version)  
4. Confirm Funnel not enabled for that port  

## Checks

| ID | Command / action | Pass |
|----|------------------|------|
| T1 | Serve status shows AION port | |
| T2 | `https://<machine>.<tailnet>.ts.net/` → 200 | |
| T3 | Safari certificate valid | |
| T4 | Console: `isSecureContext === true` | |
| T5 | Console: `!!navigator.mediaDevices` | |
| T6 | Non-tailnet client cannot reach | |
| T7 | Funnel status OFF | |
| T8 | Unauth `POST https://…/api/action` → 401 | |
| T9 | Ollama `127.0.0.1:11434` OK; Tailscale IP:11434 blocked | |
| T10 | Document legacy `http://100.x.x.x:31415/` status | |

## Probe script (optional, loopback-safe)

```powershell
# Only run when Owner authorizes network probes
$base = "https://YOUR-MACHINE.YOUR-TAILNET.ts.net"
try { (Invoke-WebRequest "$base/" -UseBasicParsing).StatusCode } catch { $_.Exception.Message }
```
