# Local Tesseract OCR model

AION reads OCR language data from this directory and nowhere else. It never downloads it.

## Why this directory exists

Before V0.4 Finding 4 was repaired, `createWorker("eng")` was called with no path configuration.
tesseract.js therefore resolved its model as `./eng.traineddata` **relative to the process working
directory**, and when that file was not there it requested

```
https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz
```

with no capability, no effect-gate decision, and no approved outward adapter. Discovery Campaign 03
reproduced that six times, and measured that the failure then hung the Owner's request and raised an
uncaught exception in the server process.

A missing local file is state. It is not authorization to contact a third party.

## Provisioning

```
node packages/local-assistant/scripts/provision-ocr-model.mjs [source-path]
```

The script copies a local `eng.traineddata` here and verifies its size and SHA-256 against the
values pinned in `src/ocr-model.ts`. It reads from disk only — it has no network path, by design. If
you have no local copy, obtain one deliberately and out of band; AION will not fetch one for you.

Expected: `eng.traineddata`, 5,199,098 bytes, SHA-256
`5dc5d8d640a212c9d6184921ba103b186f50e0fed9ee716c53e6b312b400d747`.

The digest pins *continuity*, not upstream authenticity: it is the model that has actually been
producing AION's OCR results, recorded so it cannot be swapped silently.

## Without it

OCR reports `OCR_MODEL_UNAVAILABLE` and says the model needs provisioning. It does not report "no
text found", it does not report a service outage, and it does not go looking on the internet.

The model itself is gitignored here — it is 5.2 MB, and `LARGE_TRACKED_FILE_BYTES` exists because a
copy of this exact file once reached a commit.
