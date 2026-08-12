# AION Execution Handoff — Window-Sticker / VIN Vision V2

## Directive

- Directive ID: grok-window-sticker-v2
- Directive title: Real phone photo → reliable VIN → inventory match
- Starting status: Moondream full/crop/region FAIL on dense Monroney; EXIF-6 phone JPEGs sideways
- Final status: REAL_FULL_IMAGE_PASS = YES on Crown Signia Monroney (IMG_0326)

## Repository Start

- Root: C:\AION-HQ-grok-window-sticker-v2 (dedicated worktree)
- Branch: executor/grok-window-sticker-v2
- START_HEAD: 6a8046aea4f3bb4f4b8972bfce5dae7b5388a0c3
- Origin: origin/main @ 6a8046a (merge: Grok local audio transcription)
- Working tree: isolated; private intake junctioned read-only from C:\AION-HQ\private

## Authorized Scope

USD 0. Local EasyOCR/Python, EXIF orient, VIN candidate guards, tests, branch push only.
No main merge. No private photos in public Git.

## Work Completed

1. **Baseline reproduction** on preserved private intake images.
2. **Root cause (d449 glass photo):** EXIF orientation 6 — unoriented pixels → garbage VLM/OCR.
3. **Root cause (dense Monroney):** Moondream inadequate; local EasyOCR reads VIN line at high confidence after full-image OCR.
4. **Image identity clarification:**
   - `private/aion/intake/d449b76d57391da6/image.jpg` = windshield glass etch, VIN `JTDACAAU4V3084476` (Prius in inventory) — **not** the Crown Signia Monroney.
   - Crown Signia Monroney regression image: `private/aion/intake/fe94885578538c2f/IMG_0326.jpeg` → VIN `JTDACAAJ8T3051788`.
5. Implemented pipeline:
   - EXIF orient before vision/OCR (`orientImageBytesForVision`)
   - EasyOCR primary path (`runEasyOcrOnImageBytes` via Python, connectors only)
   - Contiguous VIN observation gate (blocks Tesseract-style scatter false-valid VINs)
   - Existing structural/check-digit/charset/noise guards retained
   - Moondream + crop + tesseract remain as fallbacks
6. Sticker field regex: Crown Signia / total MSRP preference
7. Tests + monorepo build/verify green

## Files Created or Modified

- packages/local-assistant/src/connectors/sticker-ocr.ts (new)
- packages/local-assistant/src/index.ts
- packages/local-assistant/src/service.ts
- packages/local-assistant/src/vin-ocr.ts
- packages/local-assistant/test/vin-ocr.test.ts
- docs/handoffs/2026-08-12-grok-window-sticker-v2.md

Not committed: eng.traineddata (local tesseract artifact), private images, tmp reports.

## Real regression report

```
REAL_IMAGE_SOURCE = private/aion/intake/fe94885578538c2f/IMG_0326.jpeg
REAL_IMAGE_FOUND = YES
REAL_IMAGE_HASH = 97bdd4add91347ff0917b54b7eeaace28ed633f9e9d7de4fa5d79d047c92afb5
REAL_IMAGE_DIMENSIONS = 5712 × 4284 (EXIF orientation 1)

VIN_FROM_IMAGE = JTDACAAJ8T3051788
EXPECTED_VIN = JTDACAAJ8T3051788
RAW_ENGINE_OBSERVATION = EasyOCR line "JTDACAAJ8T3051788" conf ~0.875 (also full page text includes TOYOTA CROWN SIGNIA LIMITED)
SOURCE_ENGINE = easyocr
SOURCE_REGION = full-image (post-EXIF; no manual crop required)
NORMALIZATION = none (direct contiguous read)
CHECK_DIGIT = PASS
INVENTORY_MATCH = YES (2026 Toyota Crown Signia Limited, vin present in state-v1 inventory)

REAL_FULL_IMAGE_PASS = YES

Secondary image (glass etch, not Monroney):
  d449b76d57391da6/image.jpg hash c5b42add… EXIF 6 → oriented 3024×4032
  VIN_FROM_IMAGE = JTDACAAU4V3084476 (Prius XLE in inventory)
```

## Design / engine notes

```
BASELINE_FAILURE = Moondream garbage on dense sticker; unoriented EXIF-6 on glass photos
ROOT_CAUSE = (1) wrong pixels without EXIF transpose (2) VLM weak on dense Monroney print
DOCUMENT_LOCALIZATION = full-frame EasyOCR (document OCR); existing crop bands remain fallback
VIN_LOCALIZATION = candidate extraction from OCR page + contiguous observation filter
EXTRACTION_ENGINE = easyocr (primary) → moondream → tesseract.js crops (fallback)
NEW_ENGINE_ADDED = EasyOCR via Python (USD 0 local; gpu=False)
WHY = Measured success on real Crown Signia full photo; beats moondream materially

VIN_CANDIDATE_MODEL = proposeVinsFromOcrText + generateVinConfusionCandidates
NORMALIZATION_MODEL = confusion map only as candidates; seed observation preserved via source=corrected
CHECK_DIGIT_BEHAVIOR = validateVin required for HIGH_CONFIDENCE
FALSE_POSITIVE_GUARDS = isPlausibleVinCharset + isContiguousVinObservation + isNoisyOcrText + prohibited I/O/Q

FALSE_VIN_READS = 0 (on measured real images)
FALSE_IMAGE_LINKS = 0

STICKER_FIELDS_EXTRACTED = year 2026, make Toyota, model Crown Signia, trim Limited;
  totalSuggestedRetail 53378 recovered from EasyOCR garble "553.378.00" ($→5)

FIRST_PASS_MS ≈ 27621 (EasyOCR cold+full page on 5712×4284; re-measured 2026-08-12 session)
LOCALIZATION_MS ≈ 0 separate (full-frame OCR)
OCR/VISION_MS ≈ 27621
RETRY_COUNT = 0 (first EasyOCR pass succeeded)
TOTAL_REAL_IMAGE_MS ≈ 28000
RAM_IMPACT = EasyOCR/torch CPU load (host-local; no external API)
```

## Follow-up in same branch (this session)

- Independent Phase 1 reproduction confirmed REAL_FULL_IMAGE_PASS on IMG_0326.
- Clarified d449 path is Prius glass etch, not Crown Monroney.
- `parseStickerMoneyBlob` recovers TOTAL SUGGESTED RETAIL when OCR turns `$53,378.00` into `553.378.00`.
- Updated `.aion-local/coordination/GROK-LATEST.md`.

## Verification Results

```
BUILD = PASS (npm run build)
FULL_VERIFY = PASS (npm run verify)
LOCAL_ASSISTANT_TESTS = PASS (767/767)
SERVER_TESTS = included in verify PASS
RAW_CONTROL_BYTES_INTRODUCED = 0
```

## Git Results

- BRANCH = executor/grok-window-sticker-v2
- START_HEAD = 6a8046aea4f3bb4f4b8972bfce5dae7b5388a0c3
- END_HEAD = (see latest commit after price-recovery checkpoint)
- Do NOT merge main from this lane

## Privacy and Hygiene

- Real Owner photos remain under private/aion/intake only
- No public vision endpoint; Ollama/EasyOCR localhost-only
- No hardcoding of expected VIN in production logic

## Unresolved defects / next steps

```
UNRESOLVED_DEFECTS =
  - EasyOCR cold-start + full-page latency (~30s on large phone JPEG) — practical but not instant
  - Barcode/DataMatrix decode not implemented (VIN already reliable from OCR on this regression)
  - Region-first crop before EasyOCR not required for PASS; still available via existing crop fallbacks
  - eng.traineddata may appear in worktree cwd if tesseract.js was invoked locally — do not commit

RECOMMENDED_NEXT_STEP =
  Integrate branch to main via normal Owner integration lane.
  Optionally warm EasyOCR reader process or crop-to-VIN-band first for latency.
  Optionally decode Monroney barcode when present as corroborating evidence.

READY_TO_INTEGRATE = YES
```

## Architecture and Gate Status

- child_process confined to connectors/sticker-ocr.ts (same boundary as local-whisper)
- Inventory corroborates only after image-origin VIN validates
- No audio / Gmail / Tekion / career / browser automation changes
