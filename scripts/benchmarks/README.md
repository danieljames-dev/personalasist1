# AION research benchmarks (Grok)

Isolated harnesses. Do **not** import or patch production `service.ts` / `server.mjs`.

## OCR VIN EasyOCR

```text
python scripts/benchmarks/ocr_vin_easyocr_bench.py
```

- Reads private paths under `C:\AION-HQ\private\aion\intake\` (not committed).
- Writes `ocr-vin-easyocr-results.json` next to the script.
- Oracle VINs are **test-only**.

## Privacy

Never commit private JPEG/WAV paths with contents. Results JSON should omit full image bytes (current harness stores text samples only).
