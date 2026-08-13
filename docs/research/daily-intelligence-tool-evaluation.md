# AION Daily-Intelligence Tool Evaluation (Independent Research)

**Agent:** Grok (research / benchmark only)  
**Branch:** `executor/grok-daily-intelligence-research`  
**Base main verified:** `d18c7927c1e9eec0f876201b36a487b2ac91add0`  
**Retrieval date:** 2026-08-12  
**Spend:** USD 0  
**Shared runtime files touched:** 0  

**Scope:** Independent technical choices for Claude / Director. Claude owns Daily-Use Intelligence + Persistent Memory implementation. This document does **not** merge, deploy, or edit `service.ts` / `server.mjs` / `app.js`.

**Parallelism note:** Claude worktree observed at `C:\AION-HQ-claude-daily-intelligence` (`executor/claude-daily-intelligence`). Grok used isolated worktree `C:\AION-HQ-grok-daily-intelligence-research` only.

---

## Executive recommendations (one screen)

| Area | Recommendation |
|------|----------------|
| **VIN / sticker OCR PRIMARY** | Keep **EasyOCR warm worker + VIN-band crops + check-digit gate** (already in AION). Proven Crown exact read. |
| **OCR SECONDARY** | **RapidOCR (ONNX / Paddle models)** as lighter CPU sidecar experiment; same post-filters. |
| **OCR NOT WORTH yet** | Surya (weight license friction + heavy), full DocTR dual-stack without measured win, paid VLMs |
| **Multi-photo fusion** | Consensus architecture (per-field evidence bags + VIN majority of *valid* reads only). No fuzzy VIN repair. |
| **iPhone mic** | Root cause: **non-secure context** (`http://100.75.78.14:31415/`). Fix via **Tailscale Serve HTTPS** (not Funnel). |
| **TTS** | Near-term: browser `SpeechSynthesis` after HTTPS; mid-term: **Kokoro-82M** or **Piper** (license-aware). |
| **Web research** | Immediate: keep/extend **SearXNG-compatible self-host** (AION already has search provider hook). No paid search API. |
| **Structured storage** | **Keep FileStateRepositoryV1** until ~24–28 MiB sustained; plan **SQLite hybrid** for high-churn append-only domains. |
| **FTS** | **SQLite FTS5** for archive/transcripts/email/docs when spill begins. |
| **Vector DB** | **Not needed now** — lexical + structured IDs + Owner memory refs first. |
| **Models** | FAST: small Ollama instruct; REASONING: defer large download; VISION: moondream/llava-phi3; STT: faster-whisper; TTS: Kokoro/Piper |

---

## 1. Vision / VIN / window-sticker OCR

### 1.1 Problem (Owner evidence)

- iPhone lot photos still produce **invalid 17-char shapes** (example cited by Owner/Director: `STDAAABS1RS004150`).
- AION correctly **refuses invalid VINs** (check digit / structure), but identification quality is incomplete on hard shots.
- Dense Monroney stickers need both **exact VIN** and **field extraction** (base MSRP vs total MSRP vs packages) without inventing prices.

### 1.2 Candidates (research, retrieval 2026-08-12)

| Name | License | Windows | CPU-only | RAM / size (order-of-mag) | Runtime | Offline | Install complexity | VIN / dense strengths | Limitations |
|------|---------|---------|----------|---------------------------|---------|---------|--------------------|-----------------------|-------------|
| **EasyOCR 1.7.2** (current AION) | Apache-2.0 (engine) | Yes | Yes (GPU optional) | ~1–2 GB models + PyTorch | Python + torch | Full offline | Medium (already installed) | Scene + sticker; AION warm path works on Crown | Dense full-page slow (~20–23 s on ~4 MP phone JPEG CPU); many **false 17-char runs** from prose |
| **PaddleOCR 3.x / PP-OCR** | **Apache-2.0** | Yes (official) | Yes | ~3–10 GB stack+models; 4 GB min cited | Python + PaddlePaddle | Offline | High on Windows (Paddle wheels) | Strong dense/layout; often tops public OCR tables | Heavier install; different stack from EasyOCR |
| **RapidOCR** | Apache-style (ONNX) | Yes | Yes (designed for) | ~50–80 MB models | onnxruntime | Offline | Low–medium | Fast Paddle-class models; AMD/CPU friendly | Accuracy depends on model pack; less layout structure |
| **DocTR (Mindee)** | **Apache-2.0** | Yes | Yes (slow) | PyTorch-scale | Python + torch | Offline | Medium–high | Layout-aware detection/recognition | Second torch stack if EasyOCR already present |
| **Surya OCR 2** | Code Apache-2.0; **weights OpenRAIL-M / revenue limits** | Possible | CPU possible, heavy | 650M params; large VRAM if GPU | torch / llama.cpp paths | Offline | High | Layout + multilingual strong | **Commercial weight license friction**; overkill for VIN line |
| **Tesseract 5.x** | Apache-2.0 | Yes | Excellent | ~10–50 MB | native | Offline | Low if installed | Clean print | Weak on phone glare/angle without heavy preprocess; **not on PATH** in this host snapshot |
| **OpenCV preprocess** | Apache-2.0 | Yes | Yes | Low | C++/Python | Offline | Low | Deskew, CLAHE, adaptive thresh, crop | Not OCR alone |
| **Local VLM** (Ollama `moondream`, `llava-phi3`) | Model-dependent | Yes | Slow | 1.7–2.9 GB present | Ollama HTTP localhost | Offline | Already present | Describe / secondary confirmation | **Must not invent VIN**; use only as assistive text |

Sources:

- EasyOCR: local install verified `1.7.2`; AION `packages/local-assistant/src/connectors/sticker-ocr.ts` (read-only inspection).
- PaddleOCR: <https://github.com/PaddlePaddle/PaddleOCR> (Apache-2.0; Windows notes).
- DocTR: <https://github.com/mindee/doctr> (Apache-2.0).
- Surya: <https://github.com/datalab-to/surya> (code Apache; weight license commercial caveats).
- Comparative tables (community, not AION-owned): codesota OCR comparison 2026; Modal “8 open-source OCR” 2025; Unstract OSS OCR 2026.

### 1.3 Local benchmark (this research session)

**Harness:** `scripts/benchmarks/ocr_vin_easyocr_bench.py`  
**Results JSON:** `scripts/benchmarks/ocr-vin-easyocr-results.json`  
**Private images:** read only from `C:\AION-HQ\private\aion\intake\…` — **not committed**.  
**Oracle VIN (test only):** Crown `JTDACAAJ8T3051788` — not production hardcode.  
**Host:** Windows, EasyOCR CPU, `gpu=False`.

| Image | Bytes | OCR ms (full page) | Valid VINs | Exact oracle | Notes |
|-------|-------|--------------------|------------|--------------|-------|
| Crown IMG_0326 (fe9488…) | 4,126,207 | **23,082** | `JTDACAAJ8T3051788` | **YES** | 14 invalid 17-char prose runs; dollars include 49,090 base + 50,955 MSRP + noise |
| Crown IMG_0326 (67e0de…) | 4,126,207 | 22,845 | same | YES | Duplicate path content |
| IMG_0325 (Camry-like Monroney) | 3,913,590 | 20,742 | **none** | n/a | Dense sticker; false 17-char runs only |
| IMG_0394 (RAV4 Buyers Guide) | 4,428,579 | 21,897 | **none** | n/a | VIN fragmented in text (`2T3WIRFV8SC317152` appears as multi-token; not one clean 17) |

**Latency summary (EasyOCR full-page CPU):**

| Metric | Value |
|--------|-------|
| Cold reader load | **4,649 ms** |
| Warm full-page Crown | **~22,458 ms** |
| False 17-char candidates / Crown | **14** (all fail check digit) |
| STDAAABS false form on Crown bench | **not present** (failure mode is class of “charset soup”, not that exact string) |

**Production path note (prior AION deploy, not re-run here):** Lot Walk with same Crown JPEG via warm EasyOCR + domain pipeline returned exact VIN, website join, sticker MSRP separation — confirms **post-OCR validation + inventory join** matter as much as engine choice.

**Glass VIN re-check (this session, raw EasyOCR, no EXIF/band pipeline):**  
`d449b76d57391da6/image.jpg` — load ~1.4 s, OCR ~9.7 s, **VIN_CAND = []**, output near-garbled single characters. Prior debug JSON with EXIF orientation 6 + crops recorded `JTDACAAU4V3084476`. **Conclusion:** glass shots **require EXIF orientation + crop** (already in AION sticker worker); naive full-page EasyOCR is insufficient.

### 1.4 Vision ranking

| Rank | Choice | Why |
|------|--------|-----|
| **PRIMARY** | **EasyOCR + existing AION pipeline** (warm worker, EXIF orient, VIN-band first, full-page fallback, ISO check digit, no fuzzy repair) | Already integrated; Crown oracle exact; refuses invalid; warm path documented |
| **SECONDARY / FALLBACK** | **RapidOCR ONNX** (or Paddle mobile models) as parallel experimental engine behind same validators | Faster/lighter CPU in community benches; Apache; drop-in text → same VIN filters |
| **ASSIST** | OpenCV deskew/CLAHE/binarize **before** OCR; optional VLM “read the VIN line only” with **discard if not check-digit valid** | Improves hard angles without new trust |
| **NOT WORTH ADDING now** | Surya as primary (license + weight); dual DocTR+EasyOCR without A/B on Owner photos; any cloud OCR | Cost, license, or complexity without measured Owner-set win |

**If EasyOCR still wins:** **Yes for PRIMARY**, on current evidence for the Crown class. Gaps are: (1) non-Crown stickers missing VIN, (2) ~20 s full-page CPU, (3) MSRP digit garble (`S49,090` / `550,955`). Those are **pipeline + preprocess + multi-photo** problems more than “replace EasyOCR tomorrow”.

---

## 2. Multi-photo vehicle fusion

### 2.1 Goal

Multiple iPhone photos of one car:

- VIN close-up + full Monroney + options page + price footer  
- Must **not** trust first OCR  
- Must **not** fuzzy-repair invalid VINs  
- Preserve **per-field provenance**

### 2.2 Recommended architecture (implementation guidance for Claude — not coded here)

```
Photo_i → preprocess → OCR engine(s) → raw lines + boxes
       → extract candidates:
            VIN_cands (charset + check digit ONLY accept)
            price_cands (kind: BASE_MSRP | TOTAL_MSRP | PACKAGE | UNKNOWN)
            identity_cands (year/make/model/trim tokens)
       → EvidenceBag field → [{value, photoRef, engine, conf, box, observedAt}]
       → Consensus:
            VIN: require ≥1 check-digit-valid; prefer exact multi-photo agreement;
                 if 2+ distinct valid VINs → AMBIGUOUS (Owner resolve)
            prices: never promote MSRP → advertised; keep kinds separate
            model: token vote with inventory join only after VIN lock
       → VehicleObservationSet { vehicleKey?, fields[], unresolved[] }
```

**Rules:**

1. Invalid VIN candidates stay in raw evidence; **never** auto-corrected toward a known inventory VIN.  
2. Cross-image consensus is **exact string match** for VIN, not edit-distance.  
3. A single high-conf valid VIN + inventory exact join beats multi-invalid noise.  
4. Field-level TTL: prices expire faster than identity.  
5. Free OCR/VLM improves fusion only if it **increases valid-VIN hit rate** or **separates price kinds** — measure before stack expansion.

### 2.3 Does a free OCR/VLM materially help fusion?

| Approach | Fusion value |
|----------|--------------|
| Second OCR engine voting | Medium — helps when engines disagree on characters |
| Multi-crop of same photo | High / cheap — already partially in VIN-band strategy |
| VLM “which line is VIN” | Medium — crop proposal only; re-OCR crop with classical OCR |
| Fuzzy VIN repair | **Forbidden** |

---

## 3. iPhone voice (Safari mic)

### 3.1 Root cause research

| Fact | Source |
|------|--------|
| `getUserMedia` requires a **secure context** | MDN MediaDevices.getUserMedia (secure contexts); AddPipe getUserMedia 2025 guide |
| Secure contexts include `https://`, `http://localhost`, `http://127.0.0.1` | MDN / web standards |
| **`http://100.75.78.14:31415/` is NOT a secure context** | Tailscale IP over plain HTTP → Safari shows **Not Secure**; `navigator.mediaDevices` typically undefined |
| MediaRecorder on iOS needs secure context + user gesture; codecs vary (`audio/mp4` AAC historically; WebM/Opus on newer iOS) | WebKit MediaRecorder notes; mobile MediaRecorder guides 2025–2026 |

**IPHONE_MIC_ROOT_CAUSE_RESEARCH:**  
Owner mic failure is **almost certainly secure-context**, not AION STT quality. STT (faster-whisper) can work once audio bytes arrive.

### 3.2 Private-only HTTPS architecture (USD 0, no Funnel)

Requirements satisfied by **Tailscale Serve** (tailnet-only), not Funnel (public).

Official Serve docs (retrieved 2026-08-12): <https://tailscale.com/docs/features/tailscale-serve>  
HTTPS certs: <https://tailscale.com/docs/how-to/set-up-https-certificates>

**Recommended setup (do not apply while Claude owns runtime):**

1. **Admin console (Owner step — cannot fully automate):**  
   - Enable **MagicDNS**  
   - Enable **HTTPS Certificates** (acknowledges machine names published on public ledger for ACME)  
2. On AION host: ensure Tailscale running; Ollama remains **127.0.0.1 only**.  
3. Serve AION HTTP port privately, e.g. concept:  
   `tailscale serve --bg 31415`  
   (exact CLI per installed Tailscale version — verify with `tailscale serve --help`)  
4. Open iPhone Safari to:  
   `https://<machine-name>.<tailnet>.ts.net/`  
   **not** `http://100.75.78.14:31415/`.  
5. Confirm **Funnel off** for that port so service is **not** on public internet.  
6. AION remote pairing still required for non-loopback API (existing 401 boundary).

**OWNER_STEP_REQUIRED:** Tailscale admin DNS page: MagicDNS + HTTPS Certificates enable + consent. Possibly one browser login on iPhone Tailscale app. Certificate issuance may need `tailscale cert` or Serve’s guided enable.

**Do not:** router port-forward, Funnel, public Let’s Encrypt on home WAN, expose Ollama on LAN/Tailscale.

**Caveat:** Occasional iOS TLS issues with Serve have been reported upstream (e.g. GitHub tailscale issues). If Serve HTTPS fails on a specific iOS version, fallback research: local reverse proxy with Tailscale cert files — still no Funnel.

---

## 4. Local TTS

| Candidate | Naturalness | Latency | CPU/RAM | Windows | Privacy | License note | Integration |
|-----------|-------------|---------|---------|---------|---------|--------------|-------------|
| **Browser SpeechSynthesis** | OS-dependent; iOS limited voices | Very low | Negligible | Yes (browser) | On-device | N/A | After HTTPS; needs user gesture on iOS |
| **Windows neural voices** | Good on Win11 | Low | OS | Native | Local | OS | Edge/SAPI; less control from Node |
| **Piper** | Good for size | Extremely fast CPU | Tiny models | Yes | Offline | **Archived MIT** vs **active GPL-3.0** (`OHF-Voice/piper1-gpl`) | CLI/binary → WAV → phone |
| **Kokoro-82M** | Stronger naturalness in 2026 roundups | Real-time+ on CPU | ~2–3 GB class | Yes (Python) | Offline | **Apache-2.0** (widely cited) | Heavier than Piper; better voice quality |
| Cloud TTS | Highest | Network | n/a | n/a | Leaves machine | Paid | **Out of scope (USD 0)** |

Sources: rhasspy/piper archive note; OHF-Voice piper1-gpl; Kokoro Apache summaries 2026 local TTS roundups; MDN Web Speech API; iOS SpeechSynthesis user-gesture limitations.

**LOCAL_TTS_RECOMMENDATION:**

1. **Phase A (no new infra):** `speechSynthesis` on Owner devices once HTTPS works; tap-to-speak.  
2. **Phase B (local neural):** **Kokoro-82M** if quality matters and Apache preferred; **Piper** if minimal CPU and Owner accepts GPL-3.0 for maintained branch or pins archived MIT knowingly.  
3. Do **not** block daily intelligence on TTS.

---

## 5. Public web research (USD 0)

### 5.1 Needs

Discovery → fetch → extract → `sourceRefs` + timestamps → bounded tokens → injection-resistant (web text is **data**, never authority).

### 5.2 Options

| Option | Free? | Fit | Limitations |
|--------|-------|-----|-------------|
| **Self-hosted SearXNG** + JSON API | Yes (self-host) | Best long-term control; AION already has SearXNG-compatible search hook in architecture | Scraping engines can break; rate limits; needs Docker/host process |
| Direct HTML fetch of known URLs | Yes | Strong when Owner or prior search supplies URL | No discovery alone |
| Official free APIs (gov, NHTSA recalls, etc.) | Often yes | Perfect for structured domains | Not general web |
| Commercial search APIs | **No** (generally paid) | High quality | Violates USD 0 |
| Browser automation for search | Free tools exist | Fragile; higher injection surface | Avoid for V1 research |

Sources: <https://docs.searxng.org/>; SearXNG GitHub; AION `search` provider pattern in server state (read-only: configurable SearXNG base URL).

### 5.3 Recommendation

| Horizon | Choice |
|---------|--------|
| **Immediately usable** | Configure **local SearXNG** (or existing compatible endpoint) + bounded page fetch + readability/HTML text extract + hard max pages/bytes + store `sourceRef`, URL, retrievedAt, etag/hash |
| **Longer-term** | Same + allowlists for dealer/OEM domains; optional sitemap/RSS for inventory blogs; site-specific parsers before general extract |
| **Hard rules** | Prompt-injection: retrieved text never changes authority/workspace/tools; citations required for claims; empty result > hallucinated summary |

**WEB_RESEARCH_RECOMMENDATION:** SearXNG self-host primary; no paid Google/Bing API; treat HTML as untrusted.

---

## 6. Memory / data scale

### 6.1 Measured baseline (this host)

| Metric | Value |
|--------|-------|
| `state-v1.json` size | **17.06 MiB** (17,893,436 bytes) |
| Configured ceiling | **32 MiB** (`MAX_STATE_BYTES = 32 * 1024 * 1024` in `adapters.ts`) |
| Inventory scale | **~2,195 vehicles** (production observation class) |
| Repository | `FileStateRepositoryV1` (atomic write patterns already present) |

### 6.2 FileStateRepositoryV1 vs SQLite hybrid

| Criterion | File JSON state | SQLite hybrid |
|-----------|-----------------|---------------|
| Windows reliability | Good if atomic replace + backup | Excellent with WAL |
| Transactions | Whole-document rewrite | True multi-row tx |
| Query speed | Full parse O(n) | Indexed O(log n) / FTS |
| FTS | Manual / external | **FTS5 built-in** |
| Schema migration | Version field in JSON | Migrations + pragma user_version |
| Backup/restore | Copy file / existing private backup | `VACUUM INTO` / file copy of DB |
| Portability | Excellent | Excellent (single file) |
| Corruption recovery | JSON easier to hand-edit | Needs dump/repair tools |
| Concurrency | Single writer simple | WAL multi-reader |
| Node support | Native fs | `better-sqlite3` or `node:sqlite` |
| Python support | json | sqlite3 stdlib |
| Ops complexity | Lowest now | Medium (new surface) |
| USD 0 | Yes | Yes |

`better-sqlite3`: mature, fast, production-used; Windows prebuilds common (<https://www.npmjs.com/package/better-sqlite3>).

### 6.3 Recommendations

**STRUCTURED_STORAGE_RECOMMENDATION:**  
**Continue FileStateRepositoryV1** for core Owner state while size stays comfortably under ~24–28 MiB after retention. **Design (not rush) SQLite spill tables** for:

- inventory observations / price history append streams  
- transcript segments  
- email message bodies / sync cache  
- web research corpus  
- large generated content drafts  

Keep **relationships, needs, authority, settings** in JSON until a single migration plan exists.

**SQLITE_EVALUATION:** Strong **yes as hybrid**, not as full rewrite. Prefer one `aion-archive.sqlite` under private data root, WAL mode, backup via existing private backup packaging.

**FTS5_EVALUATION:** **Yes** for Caleb archive, transcripts, emails, documents, historical conversations — when those leave the hot JSON. FTS5 is free, local, good enough for Owner search without embeddings.

**VECTOR_DB_RECOMMENDATION:** **Not now.** No measured retrieval failure that lexical FTS + structured IDs + explicit memory links cannot solve. Revisit only if Owner semantic recall fails on large corpora after FTS.

---

## 7. Growth / N² risks

| Data class | Growth shape | Risk | Policy sketch |
|------------|--------------|------|---------------|
| Photos / audio blobs | Linear in captures | Disk fill | Store once under intake; **refs only** in state; optional thumbnail; never embed base64 in JSON |
| Inventory observations | Linear per walk | Moderate | Cap detail; aggregate daily summaries |
| Price history | Linear per change × vehicle | Moderate | Keep last N + monthly rollup |
| Email history | Linear | High body size | Headers in SQLite; bodies on disk; sync window |
| Transcripts | Linear in audio minutes | High | Segment files + FTS index; not full text in state-v1 |
| Customer needs | Linear per signal | Low–med | Supersede old; don’t fork duplicates |
| Web research | Linear per query | Cache bloat | TTL + hash de-dupe by URL |
| Social analytics | Linear | Low now | PREPARE-only; don’t store raw platform dumps |
| **Customer × vehicle matching** | **O(C×V)** if naively recomputed | **N² risk** | Compute on demand; cache top-k per customer with TTL; never materialize full matrix |
| Generated content | Linear per draft | Dup risk | One facts object → many renderings; don’t re-store vehicle snapshots per draft |
| Derived summaries | Can explode if re-derived daily without invalidation | Cache growth | Version by source hash; overwrite |

**DATA_GROWTH_RISKS / N_SQUARED_RISKS:**  
Primary N² is **customer×vehicle** and **content×vehicle×channel** if every combination is stored. Prefer **lazy match**, **shared VehicleContentFacts**, and **refs**.

---

## 8. Model / reasoning options (repo + host truth)

| Role | Present / known | Recommendation |
|------|-----------------|----------------|
| **FAST MODEL** | Ollama available; deterministic offline always | Keep small instruct (e.g. phi/llama small if already pulled) for routing; **do not** pull huge models without latency budget |
| **REASONING MODEL** | Not required for OCR/STT | Optional mid-size local only if orchestration quality fails; measure first |
| **VISION SPECIALIST** | `moondream` 1.7 GB, `llava-phi3` 2.9 GB listed via Ollama | Use for description / crop assist; **VIN only if check-digit valid** |
| **STT** | faster-whisper path READY in production architecture | **Keep**; tiny.en for speed, small.en if accuracy gaps |
| **TTS** | None first-class | Browser first; Kokoro/Piper later |

**Bias:** USD 0, local, no huge downloads without measured need.

---

## 9. What Claude should / should not take from this

**Use freely:**

- iPhone HTTPS / Serve plan  
- Multi-photo consensus rules  
- Storage hybrid timing  
- N² avoidances  
- OCR ranking + false-candidate severity numbers  

**Do not collide:**

- Grok did not edit `service.ts`, `server.mjs`, `app.js`  
- No production restart, no main merge  
- Benchmarks live under `docs/research/*` and `scripts/benchmarks/*` only  

---

## 10. Source index (retrieval 2026-08-12)

1. MDN getUserMedia secure contexts — <https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia>  
2. Tailscale Serve — <https://tailscale.com/docs/features/tailscale-serve>  
3. Tailscale HTTPS certificates — <https://tailscale.com/docs/how-to/set-up-https-certificates>  
4. PaddleOCR — <https://github.com/PaddlePaddle/PaddleOCR>  
5. DocTR — <https://github.com/mindee/doctr>  
6. Surya — <https://github.com/datalab-to/surya>  
7. SearXNG docs — <https://docs.searxng.org/>  
8. better-sqlite3 — <https://www.npmjs.com/package/better-sqlite3>  
9. Piper archive / OHF move — <https://github.com/rhasspy/piper>  
10. Local EasyOCR bench outputs — `scripts/benchmarks/ocr-vin-easyocr-results.json`  
11. AION MAX_STATE_BYTES — `packages/local-assistant/src/adapters.ts` (read-only)  
12. Private state size — `C:\AION-HQ\private\aion\state-v1.json` (local measure 17.06 MiB)

---

## 11. Open measurements (follow-ups, still research)

1. A/B RapidOCR vs EasyOCR on Owner hard set (including STDAAABS-class fails) — install RapidOCR in isolated venv only.  
2. Glass Prius full cold/warm latency matrix after EXIF-aware band crops.  
3. Confirm Tailscale machine MagicDNS name on this host without changing production Serve config.  
4. SQLite FTS prototype on **copy** of transcripts only (never cut over without Claude coordination).

---

**READY_FOR_DIRECTOR_REVIEW = YES**
