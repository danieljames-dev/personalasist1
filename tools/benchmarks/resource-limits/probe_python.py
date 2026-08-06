# NON-PRODUCTION BENCHMARK PROBE - second-runtime observations.
#
# NOT the AION canonicalizer. NOT CanonicalContractValidatorV1. NOT a fixture loader.
# NOT a conformance harness. NOT a security boundary. NOT proof of production readiness.
#
# Purpose: observe where a SECOND runtime's behaviour differs from Node's, so that
# limits proposed from Node measurements are not silently machine- or runtime-specific.
#
# Python standard library only. No third-party imports. No network. No personal data.
# Synthetic shapes only, generated from stable seeds.

import json
import sys
import time
import platform
import gc
import argparse

QUICK = "--quick" in sys.argv


def stats(xs):
    s = sorted(xs)
    n = len(s)
    return {
        "median": round(s[n // 2], 4),
        "p95": round(s[min(n - 1, int(n * 0.95))], 4),
        "worst": round(s[-1], 4),
        "min": round(s[0], 4),
    }


def measure(name, category, fn, runs=9, warmup=3, input_bytes=None, expect_throw=False, note=None):
    for _ in range(warmup):
        try:
            fn()
        except Exception:
            pass
    durations = []
    completed = 0
    failure_type = None
    retain = None
    gc.collect()
    for _ in range(runs):
        t0 = time.perf_counter()
        threw = False
        try:
            retain = fn()
        except Exception as e:  # noqa: BLE001 - probe records the type, does not handle
            threw = True
            failure_type = type(e).__name__
        t1 = time.perf_counter()
        durations.append((t1 - t0) * 1000.0)
        if threw == expect_throw:
            completed += 1
    del retain
    d = stats(durations)
    return {
        "name": name,
        "category": category,
        "note": note,
        "runs": runs,
        "warmup": warmup,
        "durationMs": d,
        "opsPerSecond": int(1000 / d["median"]) if d["median"] > 0 else None,
        "inputBytes": input_bytes,
        "completedAsExpected": completed,
        "completionRate": round(completed / runs, 3),
        "failureType": failure_type,
        # Explicitly unavailable in this probe:
        "peakMemoryBytes": "unavailable (tracemalloc not used; would perturb timing)",
        "cancellationLatencyMs": "unavailable (no cancellable implementation exists)",
    }


# ---------------------------------------------------------------------------
# Shape generators - mirror shapes.mjs so the two runtimes see the same input
# ---------------------------------------------------------------------------

def nest_array(depth):
    return "[" * depth + "null" + "]" * depth


def wide_object(members):
    return "{" + ",".join('"m%d":%d' % (i, i) for i in range(members)) + "}"


def large_array(elements):
    return "[" + ",".join(str(i) for i in range(elements)) + "]"


def duplicate_members(count):
    return "{" + ",".join('"dup":%d' % i for i in range(count)) + "}"


results = []


def emit(r):
    results.append(r)
    d = r.get("durationMs")
    if d:
        print("  %-46s %10s ms  %9s op/s" % (r["name"], d["median"], r.get("opsPerSecond") or "-"))


# ---------------------------------------------------------------------------
# A. THE ORDERING DIVERGENCE - the reason this probe exists
# ---------------------------------------------------------------------------
print("\nA. MEMBER ORDERING (ACJ-1 §2 requires UTF-16 code-unit order)")


def utf16_sort_key(s):
    """Order by UTF-16 code units, as ACJ-1 §2 / RFC 8785 §3.2.3 require.

    Python's default str ordering is by Unicode CODE POINT. For supplementary-plane
    characters (>= U+10000) the two orders differ, because UTF-16 represents those as
    surrogate pairs beginning 0xD800-0xDBFF, which sort BELOW U+E000-U+FFFF.
    Encoding to UTF-16BE and comparing the resulting bytes reproduces the required order.
    """
    return s.encode("utf-16-be")


# U+FFFF (BMP, code point 65535) vs U+10000 (supplementary, code point 65536).
# Code point order:      U+FFFF  <  U+10000
# UTF-16 code-unit order: U+10000 (D800 DC00) < U+FFFF (FFFF)
KEYS = ["￿", "\U00010000", "", "a"]

default_order = sorted(KEYS)
required_order = sorted(KEYS, key=utf16_sort_key)
diverges = default_order != required_order


def describe(k):
    return {
        "literal": repr(k),
        "codePoints": [hex(ord(c)) for c in k],
        "utf16CodeUnits": [hex(int.from_bytes(k.encode("utf-16-be")[i:i + 2], "big"))
                           for i in range(0, len(k.encode("utf-16-be")), 2)],
    }


ordering = {
    "name": "ordering.utf16VsCodePoint",
    "category": "ordering",
    "note": ("Python's default str sort is by code point. ACJ-1 §2 requires UTF-16 code-unit "
             "order. They diverge for supplementary-plane keys. A naive Python canonicalizer "
             "would emit different canonical bytes and therefore a different digest."),
    "keys": [describe(k) for k in KEYS],
    "pythonDefaultOrder": [describe(k)["codePoints"] for k in default_order],
    "requiredUtf16Order": [describe(k)["codePoints"] for k in required_order],
    "diverges": diverges,
    "conformantComparator": "s.encode('utf-16-be') then bytewise compare",
    "runs": 1,
    "warmup": 0,
}
results.append(ordering)
print("  default (code point) : %s" % [describe(k)["codePoints"] for k in default_order])
print("  required (UTF-16)    : %s" % [describe(k)["codePoints"] for k in required_order])
print("  DIVERGES             : %s" % diverges)

# Cost of the conformant comparator versus the default.
n_keys = 200 if QUICK else 2000
sort_keys = ["k%d\U00010000" % i if i % 3 == 0 else "k%d" % i for i in range(n_keys)]
emit(measure("ordering.sort.default", "ordering", lambda: sorted(sort_keys),
             runs=3 if QUICK else 9, warmup=1 if QUICK else 3,
             note="NON-CONFORMANT for supplementary-plane keys"))
emit(measure("ordering.sort.utf16Conformant", "ordering", lambda: sorted(sort_keys, key=utf16_sort_key),
             runs=3 if QUICK else 9, warmup=1 if QUICK else 3,
             note="conformant; allocates one UTF-16BE copy per key"))

# ---------------------------------------------------------------------------
# B. DEPTH - does Python's parser bound it? (Node's does not.)
# ---------------------------------------------------------------------------
print("\nB. DEPTH (Node's JSON.parse bounded nothing to 1,000,000)")

parse_ok = None
parse_break = None
parse_error = None
for d in [64, 256, 1000, 2000, 2900, 2990, 3000, 4000, 8000, 100000]:
    try:
        json.loads(nest_array(d))
        parse_ok = d
    except RecursionError as e:
        parse_break = d
        parse_error = type(e).__name__
        break
    except Exception as e:  # noqa: BLE001
        parse_break = d
        parse_error = type(e).__name__
        break

# Is the guard tunable? Node's is not; check whether Python's is.
tunable = None
try:
    old = sys.getrecursionlimit()
    sys.setrecursionlimit(20000)
    try:
        json.loads(nest_array((parse_break or 4000)))
        tunable = True
    except Exception:  # noqa: BLE001
        tunable = False
    finally:
        sys.setrecursionlimit(old)
except Exception:  # noqa: BLE001
    tunable = "unavailable"

depth_result = {
    "name": "depth.runtimeCeiling.python",
    "category": "depth",
    "note": ("Python's json.loads is RECURSIVE. Unlike Node it bounds depth by itself - which "
             "means the same input can reject at a DIFFERENT processing stage in the two "
             "runtimes unless AION enforces its own depth limit before parsing."),
    "deepestParsed": parse_ok,
    "firstFailingDepth": parse_break,
    "failureType": parse_error,
    "tunableViaSetRecursionLimit": tunable,
    "recursionLimitDefault": sys.getrecursionlimit(),
    "runs": 1,
    "warmup": 0,
}
results.append(depth_result)
print("  deepest parsed %s ; first failure %s (%s) ; tunable=%s"
      % (parse_ok, parse_break, parse_error, tunable))

for d in ([64] if QUICK else [64, 256, 1000]):
    src = nest_array(d)
    emit(measure("depth.parse.nestArray(%d).python" % d, "depth", lambda s=src: json.loads(s),
                 runs=3 if QUICK else 9, warmup=1 if QUICK else 3, input_bytes=len(src)))

# ---------------------------------------------------------------------------
# C. WIDTH - per-unit cost, to compare against Node
# ---------------------------------------------------------------------------
print("\nC. WIDTH")
for m in ([1024] if QUICK else [1024, 4096, 65536]):
    src = wide_object(m)
    r = measure("width.parse.wideObject(%d).python" % m, "width", lambda s=src: json.loads(s),
                runs=3 if QUICK else 9, warmup=1 if QUICK else 3, input_bytes=len(src))
    r["unitsUnderTest"] = m
    r["nsPerUnit"] = round(r["durationMs"]["median"] * 1e6 / m, 3)
    emit(r)
for e in ([65536] if QUICK else [65536, 1000000]):
    src = large_array(e)
    r = measure("width.parse.largeArray(%d).python" % e, "width", lambda s=src: json.loads(s),
                runs=3 if QUICK else 9, warmup=1 if QUICK else 3, input_bytes=len(src))
    r["unitsUnderTest"] = e
    r["nsPerUnit"] = round(r["durationMs"]["median"] * 1e6 / e, 3)
    emit(r)

# ---------------------------------------------------------------------------
# D. DUPLICATE MEMBERS - same destruction as Node?
# ---------------------------------------------------------------------------
print("\nD. DUPLICATE MEMBERS")
dup_n = 1000 if QUICK else 10000
parsed = json.loads(duplicate_members(dup_n))
dup = {
    "name": "reject.duplicateMembers.hostCollapse.python",
    "category": "reject",
    "note": "Confirms in a second runtime that a parsed value is not evidence for ACJ-1 §19.",
    "sourceMemberCount": dup_n,
    "parsedKeyCount": len(parsed),
    "lastWins": parsed.get("dup") == dup_n - 1,
    "evidenceDestroyedByParsing": len(parsed) == 1,
    "runs": 1, "warmup": 0,
}
results.append(dup)
print("  %d members -> %d key(s) ; lastWins=%s" % (dup_n, len(parsed), dup["lastWins"]))

# ---------------------------------------------------------------------------
# E. NUMERIC - does Python lose precision where Node does?
# ---------------------------------------------------------------------------
print("\nE. NUMERIC")
cases = ["9007199254740993", "9007199254740995", "18014398509481985", "123456789012345678901"]
observed = []
for lit in cases:
    v = json.loads('{"n":%s}' % lit)["n"]
    observed.append({"literal": lit, "parsed": str(v), "lossless": str(v) == lit, "type": type(v).__name__})
num = {
    "name": "numeric.precisionHazard.python",
    "category": "numeric",
    "note": ("Python parses JSON integers as arbitrary-precision int and is LOSSLESS where "
             "Node is lossy. This is itself a cross-runtime hazard: the same document yields "
             "different values in the two runtimes, which is exactly why ACJ-1 §7 caps the "
             "integer domain rather than relying on the parser."),
    "cases": observed,
    "losslessCount": sum(1 for o in observed if o["lossless"]),
    "runs": 1, "warmup": 0,
}
results.append(num)
for o in observed:
    print("  %-22s -> %-22s lossless=%s (%s)" % (o["literal"], o["parsed"], o["lossless"], o["type"]))

# ---------------------------------------------------------------------------
# F. UNICODE - NFC behaviour in a second runtime
# ---------------------------------------------------------------------------
print("\nF. UNICODE")
import unicodedata  # noqa: E402 - stdlib, imported here to keep the section self-contained

chars = 50000 if QUICK else 200000
nfd = "é" * chars
nfc = "é" * chars
emit(measure("unicode.isNFC.check.nfd.python", "unicode",
             lambda: unicodedata.is_normalized("NFC", nfd),
             runs=3 if QUICK else 9, warmup=1 if QUICK else 3,
             input_bytes=len(nfd.encode("utf-8")),
             note="Python has a native is_normalized; JavaScript has none and must normalize-and-compare"))
emit(measure("unicode.isNFC.check.nfc.python", "unicode",
             lambda: unicodedata.is_normalized("NFC", nfc),
             runs=3 if QUICK else 9, warmup=1 if QUICK else 3,
             input_bytes=len(nfc.encode("utf-8"))))

# ---------------------------------------------------------------------------
# Environment and emit
# ---------------------------------------------------------------------------
report = {
    "schema": "aion.resource-limit-benchmark.python.v1",
    "disclaimer": ("NON-PRODUCTION PROBE. Not the AION canonicalizer, validator, fixture loader, "
                   "conformance harness, or a security boundary. Second-runtime observations only."),
    "environment": {
        "runtime": "CPython",
        "pythonVersion": platform.python_version(),
        "implementation": platform.python_implementation(),
        "osFamily": platform.system(),
        "osRelease": platform.release(),
        "architecture": platform.machine(),
        "recursionLimitDefault": sys.getrecursionlimit(),
        "maxUnicode": sys.maxunicode,
        "notes": [
            "Standard library only. No third-party imports. No network access.",
            "Synthetic shapes only. No personal or owner data.",
            "Timing uses perf_counter wall clock; peak memory deliberately not sampled.",
        ],
    },
    "runConfig": {"quick": QUICK},
    "unavailableMeasurements": [
        "peakMemoryBytes - tracemalloc would perturb the timings it is meant to accompany",
        "cancellationLatencyMs - no cancellable implementation exists",
        "cpuDurationMs - not attributable per probe at this granularity",
    ],
    "results": results,
}

ap = argparse.ArgumentParser(add_help=False)
ap.add_argument("--out")
ap.add_argument("--quick", action="store_true")
known, _ = ap.parse_known_args()
if known.out:
    with open(known.out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(report, f, indent=2, ensure_ascii=True)
        f.write("\n")
    print("\nJSON written to %s" % known.out)

print("\nProbes: %d  CPython %s  recursionlimit %d"
      % (len(results), platform.python_version(), sys.getrecursionlimit()))
