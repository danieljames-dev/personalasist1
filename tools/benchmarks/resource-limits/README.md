# AION Resource-Limit Benchmark Probes

> **NON-PRODUCTION. NON-CONFORMANT. NOT A SECURITY BOUNDARY.**
>
> Nothing in this directory is the AION canonicalizer, `CanonicalContractValidatorV1`, a
> fixture loader, or a conformance harness. These are measurement probes whose only purpose
> is to produce evidence for selecting DG-4 resource limits. They approximate the *cost
> shape* of future operations; they do not implement any AION contract.

## Boundary rules

- **Never imported by `packages/kernel` or any future production package.** Enforced by
  `packages/kernel/test/architecture-boundary.test.mjs`.
- Synthetic data only. **No personal or owner data, ever.**
- No network access. No external service calls.
- No production dependencies. Node built-ins only.
- Records the environment and exact commit with every run.
- Produces reproducible machine-readable output.
- Separates **measured facts** from **architectural recommendation** — this code emits only
  facts.

## Running

```bash
node tools/benchmarks/resource-limits/run.mjs                 # full matrix
node tools/benchmarks/resource-limits/run.mjs --quick         # fewer runs, smoke check
node tools/benchmarks/resource-limits/run.mjs --out FILE.json # explicit output path
```

Output goes to stdout as a human summary and to `--out` as JSON. The committed evidence
lives in `docs/benchmarks/resource-limits-evidence.md`.

## What is measured

Probes cover parse cost, structured traversal, nesting depth, wide objects, large arrays,
long strings, Unicode validation and NFC normalization, duplicate-member handling, exact-byte
framing, hex encoding, digest cost, total-node counting, early-versus-late rejection, and
memory amplification.

## What is not measured

Concurrency, cancellation responsiveness under load, storage I/O, and cross-runtime agreement.
Those require components that do not exist and are recorded as unavailable rather than
estimated.
