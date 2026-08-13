import time, re, json, os, sys
from pathlib import Path

# ISO 3779 VIN check digit
TRANSLIT = {**{str(i):i for i in range(10)}, **{c:v for c,v in zip(
    "ABCDEFGHJKLMNPRSTUVWXYZ",
    [1,2,3,4,5,6,7,8,1,2,3,4,5,7,9,2,3,4,5,6,7,8,9])}}
WEIGHTS = [8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2]

def vin_valid(v: str) -> bool:
    v = v.upper()
    if len(v) != 17 or any(ch in "IOQ" for ch in v):
        return False
    try:
        total = sum(TRANSLIT[ch] * w for ch, w in zip(v, WEIGHTS))
    except KeyError:
        return False
    check = total % 11
    expect = "X" if check == 10 else str(check)
    return v[8] == expect

VIN_RE = re.compile(r"[A-HJ-NPR-Z0-9]{17}")

ORACLE = {
    "crown": "JTDACAAJ8T3051788",
}

IMAGES = [
    ("crown_img0326_a", r"C:\AION-HQ\private\aion\intake\fe94885578538c2f\IMG_0326.jpeg", "crown"),
    ("crown_img0326_b", r"C:\AION-HQ\private\aion\intake\67e0de5aaeec44a8\IMG_0326.jpeg", "crown"),
    ("img_0325", r"C:\AION-HQ\private\aion\intake\16cbb2a1727d6b0f\IMG_0325.jpeg", None),
    ("img_0394", r"C:\AION-HQ\private\aion\intake\66e20b7aabea206e\IMG_0394.jpeg", None),
]

def candidates(text: str):
    found = []
    for m in VIN_RE.finditer(text.upper().replace(" ", "")):
        found.append(m.group(0))
    # also spaced OCR variants
    for m in re.finditer(r"(?:[A-HJ-NPR-Z0-9]\s*){17}", text.upper()):
        compact = re.sub(r"\s+", "", m.group(0))
        if len(compact) == 17:
            found.append(compact)
    return list(dict.fromkeys(found))

print("Loading EasyOCR (cold)...", flush=True)
t0 = time.perf_counter()
import easyocr
reader = easyocr.Reader(["en"], gpu=False, verbose=False)
cold_load = (time.perf_counter() - t0) * 1000
print(f"READER_LOAD_MS={cold_load:.0f}", flush=True)

results = []
for name, path, oracle_key in IMAGES:
    if not os.path.isfile(path):
        print(f"SKIP {name} missing", flush=True)
        continue
    size = os.path.getsize(path)
    t1 = time.perf_counter()
    # full page first (matches dense sticker need); detail=1 for conf
    lines = reader.readtext(path, detail=1, paragraph=False)
    ocr_ms = (time.perf_counter() - t1) * 1000
    texts = [str(x[1]) for x in lines]
    confs = [float(x[2]) for x in lines if len(x) > 2]
    full = "\n".join(texts)
    cands = candidates(full)
    valid = [c for c in cands if vin_valid(c)]
    invalid = [c for c in cands if not vin_valid(c)]
    oracle = ORACLE.get(oracle_key) if oracle_key else None
    exact = oracle in valid if oracle else None
    # price-like dollars
    dollars = re.findall(r"\$?\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{2})?)", full)
    msrp_hits = [d for d in dollars]
    # false known bad shape example
    has_stdaaabs = "STDAAABS1RS004150" in full.replace(" ", "").upper()
    row = {
        "name": name,
        "bytes": size,
        "ocr_ms": round(ocr_ms, 1),
        "line_count": len(lines),
        "mean_conf": round(sum(confs)/len(confs), 3) if confs else None,
        "candidates": cands,
        "valid_vins": valid,
        "invalid_candidates": invalid,
        "oracle": oracle,
        "exact_oracle": exact,
        "dollar_tokens": msrp_hits[:12],
        "has_invalid_example_STDAAABS": has_stdaaabs,
        "text_sample": full[:400].replace("\n", " | "),
    }
    results.append(row)
    print(json.dumps(row, indent=2), flush=True)

# warm second pass on crown only
crown = r"C:\AION-HQ\private\aion\intake\fe94885578538c2f\IMG_0326.jpeg"
if os.path.isfile(crown):
    t2 = time.perf_counter()
    reader.readtext(crown, detail=0, paragraph=False)
    warm_ms = (time.perf_counter() - t2) * 1000
    print(f"WARM_OCR_MS={warm_ms:.0f}", flush=True)

out = {
    "engine": "easyocr",
    "version": getattr(easyocr, "__version__", "1.7.2"),
    "gpu": False,
    "reader_load_ms": round(cold_load, 1),
    "results": results,
}
Path(r"C:\AION-HQ-grok-daily-intelligence-research\docs\research").mkdir(parents=True, exist_ok=True)
out_path = r"C:\AION-HQ-grok-daily-intelligence-research\scripts\benchmarks\ocr-vin-easyocr-results.json"
Path(out_path).parent.mkdir(parents=True, exist_ok=True)
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(out, f, indent=2)
print("WROTE", out_path, flush=True)