#!/usr/bin/env python3
"""
Long-lived EasyOCR worker for AION sticker / VIN OCR.

Protocol (line-delimited JSON on stdin/stdout):
  Request:  {"id":"...","cmd":"ocr"|"ping"|"shutdown","imagePath":"...","regions":[...|null],"stopOnVin":true}
  Response: {"id":"...","ok":true|false,"error":"...","result":{...}}

Regions are fractional crops on the EXIF-oriented image: {name,x,y,w,h} in [0,1].
When stopOnVin is true, OCR each region in order and return on first text containing a
17-char VIN charset run; otherwise fall through to full-page OCR when regions were tried.

The EasyOCR Reader is loaded once and reused (warm path).
"""
from __future__ import annotations

import json
import re
import sys
import time
import traceback

# Unbuffered-friendly
sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
sys.stderr.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]

VIN_RUN = re.compile(r"[A-HJ-NPR-Z0-9]{17}")

_reader = None
_reader_load_ms = 0


def log_err(msg: str) -> None:
    try:
        sys.stderr.write(msg + "\n")
        sys.stderr.flush()
    except Exception:
        pass


def get_reader():
    global _reader, _reader_load_ms
    if _reader is None:
        t0 = time.time()
        import easyocr  # noqa: WPS433

        _reader = easyocr.Reader(["en"], gpu=False, verbose=False)
        _reader_load_ms = int((time.time() - t0) * 1000)
        log_err(f"easyocr_reader_ready load_ms={_reader_load_ms}")
    return _reader


def orient_image(path: str):
    from PIL import Image, ImageOps

    raw = Image.open(path)
    exif = raw.getexif()
    ori = exif.get(274) if exif else None
    img = ImageOps.exif_transpose(raw).convert("RGB")
    return img, ori


def crop_region(img, region: dict):
    w, h = img.size
    x0 = int(max(0, min(w - 1, float(region["x"]) * w)))
    y0 = int(max(0, min(h - 1, float(region["y"]) * h)))
    cw = int(max(8, min(w - x0, float(region["w"]) * w)))
    ch = int(max(8, min(h - y0, float(region["h"]) * h)))
    return img.crop((x0, y0, x0 + cw, y0 + ch)), {
        "name": region.get("name") or "region",
        "pixel": [x0, y0, cw, ch],
        "frac": {
            "x": float(region["x"]),
            "y": float(region["y"]),
            "w": float(region["w"]),
            "h": float(region["h"]),
        },
    }


def ocr_array(arr):
    import numpy as np

    reader = get_reader()
    return reader.readtext(np.array(arr), detail=1, paragraph=False)


def pack_lines(res, offset_xy=(0, 0)):
    ox, oy = offset_xy
    lines = []
    for item in res:
        box, text, conf = item[0], item[1], float(item[2])
        adj = None
        if box is not None:
            adj = [[float(p[0]) + ox, float(p[1]) + oy] for p in box]
        lines.append({"text": str(text), "confidence": conf, "box": adj})
    full = " ".join(l["text"] for l in lines)
    return lines, full


def has_vin_run(text: str) -> bool:
    return bool(VIN_RUN.search(str(text or "").upper()))


def handle_ocr(req: dict) -> dict:
    path = req.get("imagePath")
    if not path:
        return {"ok": False, "error": "missing imagePath"}
    t_all = time.time()
    img, ori = orient_image(path)
    regions = req.get("regions") or []
    stop_on_vin = bool(req.get("stopOnVin", True))
    attempts = []

    # Priority regions first (native-resolution crops — never downscale whole page first).
    for region in regions:
        if not isinstance(region, dict):
            continue
        try:
            crop, meta = crop_region(img, region)
        except Exception as e:
            attempts.append({"region": region.get("name"), "error": str(e)})
            continue
        t0 = time.time()
        res = ocr_array(crop)
        ms = int((time.time() - t0) * 1000)
        ox, oy = meta["pixel"][0], meta["pixel"][1]
        lines, full = pack_lines(res, (ox, oy))
        attempt = {
            "region": meta["name"],
            "latencyMs": ms,
            "lineCount": len(lines),
            "hasVinRun": has_vin_run(full),
            "cropSize": [crop.size[0], crop.size[1]],
        }
        attempts.append(attempt)
        if stop_on_vin and has_vin_run(full):
            return {
                "ok": True,
                "result": {
                    "engine": "easyocr",
                    "orientedWidth": img.size[0],
                    "orientedHeight": img.size[1],
                    "exifOrientation": ori,
                    "lines": lines,
                    "fullText": full,
                    "latencyMs": int((time.time() - t_all) * 1000),
                    "ocrMs": ms,
                    "readerLoadMs": _reader_load_ms,
                    "sourceRegion": meta["name"],
                    "strategy": "vin-band",
                    "attempts": attempts,
                    "warm": _reader_load_ms > 0 and len(attempts) >= 1,
                },
            }

    # Full-page fallback (or sole path when no regions).
    t0 = time.time()
    res = ocr_array(img)
    ms = int((time.time() - t0) * 1000)
    lines, full = pack_lines(res)
    attempts.append(
        {
            "region": "full-page",
            "latencyMs": ms,
            "lineCount": len(lines),
            "hasVinRun": has_vin_run(full),
            "cropSize": [img.size[0], img.size[1]],
        }
    )
    return {
        "ok": True,
        "result": {
            "engine": "easyocr",
            "orientedWidth": img.size[0],
            "orientedHeight": img.size[1],
            "exifOrientation": ori,
            "lines": lines,
            "fullText": full,
            "latencyMs": int((time.time() - t_all) * 1000),
            "ocrMs": ms,
            "readerLoadMs": _reader_load_ms,
            "sourceRegion": "full-page",
            "strategy": "full-page" if regions else "full-page-only",
            "attempts": attempts,
            "warm": True,
        },
    }


def main() -> int:
    # Eager-load Reader so first client request is warm OCR, not model load.
    try:
        get_reader()
    except Exception as e:
        log_err(f"reader_preload_fail: {e}")
        # Still accept commands — ocr will fail clearly.

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            cmd = req.get("cmd") or "ocr"
            if cmd == "ping":
                out = {
                    "id": req_id,
                    "ok": True,
                    "result": {
                        "pong": True,
                        "readerReady": _reader is not None,
                        "readerLoadMs": _reader_load_ms,
                    },
                }
            elif cmd == "shutdown":
                out = {"id": req_id, "ok": True, "result": {"shutdown": True}}
                sys.stdout.write(json.dumps(out) + "\n")
                sys.stdout.flush()
                return 0
            elif cmd == "ocr":
                body = handle_ocr(req)
                out = {"id": req_id, **body}
            else:
                out = {"id": req_id, "ok": False, "error": f"unknown cmd {cmd}"}
        except Exception as e:
            out = {
                "id": req_id,
                "ok": False,
                "error": str(e),
                "trace": traceback.format_exc()[-1500:],
            }
        sys.stdout.write(json.dumps(out, ensure_ascii=False) + "\n")
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
