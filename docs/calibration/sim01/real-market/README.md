# Persistent Real vs Sim benchmark

This package preserves the 2026-11-05 SIM-01 research. It does not calibrate or
change the engine. [Report](report.md), [compact metrics](metrics.json),
[historical research results](research-results.json), and [source manifest](sources.json)
are versioned; Parquets, databases, tapes and candle CSVs are not.

## Reproduce

Run from the repository root. Requirements: Python 3.12 (standard library only),
DuckDB CLI 2.0.0, Node and the existing `npm ci` dependencies. The original research
used NumPy; the maintained analyzer uses standard-library interpolated quantiles.
Historical numbers are checked with absolute/relative tolerance 1e-9; integer
counts and missing keys are checked exactly. No packages are installed by these tools.

The two simulation revisions must exist locally. They are compiled from Git objects,
without checking out or merging PR #72:

```text
git fetch origin 84eca0906dc26387ca8b0fd761faad547e06a3fb
git fetch origin 8eb3b1257ab77bc179998b2b3502ae0a38dc6327
```

Download the pinned public inputs, or point `--raw-dir` at an already downloaded
folder containing `data/`, `launches/`, `events/` and `graduations/`:

```text
python docs/calibration/sim01/real-market/scripts/download.py --raw-dir output/sim01-raw
python docs/calibration/sim01/real-market/scripts/reproduce.py --raw-dir output/sim01-raw --work-dir output/sim01-reproduction --duckdb /path/to/duckdb --stage prepare
node docs/calibration/sim01/real-market/scripts/extract-sim.mjs --work-dir output/sim01-reproduction
python docs/calibration/sim01/real-market/scripts/reproduce.py --raw-dir output/sim01-raw --work-dir output/sim01-reproduction --stage analyze
```

On Windows, pass the actual `duckdb.exe` path instead of `/path/to/duckdb`. Substitute
your Python executable if `python` is not configured. Raw downloads total about 1.38GB;
database/CSV work files require additional space. Tools never download an executable
or install a library. The download revision and each file size/SHA256 are pinned.
Cached files are rehashed; interrupted downloads use `.partial` and are not accepted.

`prepare` verifies all raw inputs, builds the database, checks ordering/reserve integrity,
and exports ordered standard-curve CSV. `extract-sim` pins **every project input** to
A=`84eca09` or B=`8eb3b12`, adding observations only to a temporary harness bundle.
After removing the tape field its measurements must match the saved PR72 SHA256s.
It needs neither the PR72 branch checked out nor old `output/sim01-pr2` files.
`analyze` reconstructs event paths, native candles, common 120s windows and the
08Z/19Z sensitivity. It fails if either simulation tape is missing.

The final command checks every reproduced comparison/sensitivity key, writes reusable `metrics.json`,
expanded `research-results.json`, and `reproduction.json` with script/input/result
fingerprints into the work directory. It never overwrites this versioned reference.
`--stage verify` rechecks existing computed outputs without rerunning the data pass.
Use separate work directories for separate experiments; record source SHA/config and
denominators when comparing them. The pinned extractor reproduces this reference;
it is not a feature switch for future engine candidates.

Fast checks require no dataset or project dependencies:

```text
python docs/calibration/sim01/real-market/scripts/test_benchmark.py
```

The optional extraction `--smoke` uses only 12 tokens per variant and three seconds;
it is explicitly marked noncanonical and cannot validate the full benchmark. It must
use a different work directory from canonical output.

## Metric contract

The report contains the complete research definitions and exclusions. The following
rules also apply to the additional metrics in `metrics.json`:

- **Population:** real primary paths are active standard-K-compatible non-instant
  launches (20,319), not every Pump.fun launch. Sim paths exclude no-trade launches
  (4,728 active out of 6,000 initial per variant). All-launch real lifecycle counts,
  instant completions, nonstandard curves and unknown quiet modes stay separate.
  A real `migrationReady` state is not inferred from simulated readiness.
- **Time:** all have 30min available launch-age follow-up, censored at completion.
  First-80 paths retain retreats. Common 120s windows require first80<=1680 and stop
  at migration or first80+120. Conditional passage times include only actual passages.
- **Event episode:** pre-swap progress owns an exit print; post-swap progress owns
  the subsequent wait. Reentry starts a new episode. Same-second real episodes can
  have prints but zero resolved duration. Zero-exposure rates are `null`, not infinity.
- **Native second:** one token/Unix-second bucket, assigned the state at its start.
  Missing seconds count as exposure and silence, not synthetic candles. Partial/point
  edge buckets can be included. These unique bins differ from episode-local bins,
  where two reentries can touch the same second twice. Both denominators are named.
- **OHLC:** post-swap spot, continuity OPEN, HIGH/LOW include OPEN; no-trade buckets
  are omitted. CSV also exports trade-only fields. Genesis has zero quote/count.
  A wick exceeds the body extrema by relative tolerance 1e-10. An observed flat
  continuity bar is different from an empty second or a flat trade-only bar.
- **Drawdown:** maximum `1-price/runningPeak`, using ordered post-swap spots and the
  path opening price. Percentages and percentage-point deltas must not be confused.
- **Direction changes per 100 transactions:** `100 * sum(sign reversals) / executed
  trade count`, pooled over paths. Equal-price prints do not reverse/end a price run
  but remain in the transaction denominator. A separate per-path distribution is
  provided; it is not an unweighted substitute for the pooled measure. Historical
  `flip_share` instead divides by successive nonzero price moves.
- **BUY/SELL quote per second:** fee-exclusive executed SOL quote divided by actual
  event-path exposure seconds. Native rates instead use the explicitly named unique
  exposed second-bin count, with entire crossing-second flow assigned to its start
  state. Neither denominator is active time unless the field says so.
- **Transactions per active second:** trades divided by nonempty second-bin count.
  Episode-local and unique native versions are separate. Empty seconds are excluded
  only from this denominator; they remain in ordinary frequency/exposure metrics.
- **Transaction size:** individual executed fee-exclusive quote in SOL; all/BUY/SELL
  interpolated p10/p50/p90/p99 and `n`. Sim USD is divided by the frozen 150 USD/SOL
  conversion for this historical run, not a historical real-market FX estimate.
- **BUY/SELL streak:** consecutive identical executed sides, including equal-price
  prints. Length is a number of transactions. Runs reset at token/path/episode
  boundaries and are clipped at the observation boundary; they are observed run
  lengths, not uncensored estimates of eventual full runs. This differs from a
  same-sign price impulse/correction. Count each side's runs separately.
- **Unavailable:** empty samples and undefined denominators are `null` with sample
  counts. True intrasecond waits, transfer-complete holder state, launch-mode flags,
  and a reliable real readiness mapping remain missing. No inferred value replaces
  them. All five requested additional trade metrics are observable in the saved tape.

## Files and limits

`sources.json` records dataset attribution/license, immutable revision, seven input
files with checksums, A/B commits/config, historical hashes and exclusions. The small
`research-results.json` preserves the original comparisons/sensitivities and validation;
`metrics.json` adds normalized measures from those same sequences. The report is
historical evidence, not a claim that the production main now includes B.

For event-band 80–90% episodes, the additional pooled rates are:

| Metric | Real | A | B |
|---|---:|---:|---:|
| Direction changes / 100 transactions | 35.20 | 39.23 | 39.65 |
| BUY quote SOL / exposure second | 0.43921 | 0.02240 | 0.02106 |
| SELL quote SOL / exposure second | 0.42728 | 0.02663 | 0.02450 |
| Transactions / active native second-bin | 3.8115 | 1.3010 | 1.2751 |
| Individual quote SOL, p50 / p90 | 0.12346 / 1.19826 | 0.32115 / 3.43109 | 0.34024 / 3.51446 |
| Observed BUY run, p50 / p90 trades | 2 / 7 | 1 / 4 | 1 / 4 |
| Observed SELL run, p50 / p90 trades | 1 / 4 | 1 / 4 | 1 / 4 |

The active-second row uses native buckets; the other rows use event-band path
boundaries. These measures show why fewer reversals per elapsed minute must not
be interpreted as fewer reversals per transaction. All stages and quantiles/sample
sizes are retained in JSON; these are descriptive observations, not tuning targets.

Reproduction does not require the historical absolute Windows runtime path. It checks
the raw source files before SQL; derived CSVs and tapes must be generated by the stated
steps, not replaced with aggregate JSON. A one-day standard active subset, conditional
stage occupancy, censoring, 1s real timestamps versus finer sim timestamps and small
hour-matched tail cohorts limit generalization. See the report before selecting targets.

## Validation of this persistence change

The full seven-file checksum/SQL preparation and all five analytical passes were run
locally. Every historical reference value and the added compact metrics reproduced
within the stated tolerance. The new pinned extractor reproduced 6,000 tokens per
variant with exact PR72 measurement hashes; both generated tape files also matched
the original research tapes byte for byte. Five definition tests, market-baseline/OHLC
QA, TypeScript, lint and build passed. Lint retains five existing React Hook warnings;
the build retains its existing bundle-size warning. Browser lifecycle/trading QA is
left to CI; this change does not modify those production paths.
