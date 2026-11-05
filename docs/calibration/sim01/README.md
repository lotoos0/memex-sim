# SIM-01 / PR1 — reproducible pre-migration baseline

This is measurement tooling, not an engine calibration change. Runtime BUY/SELL flow,
curve math, migration, execution, frozen contracts and dependencies are unchanged.

The [persistent Real vs Sim price-structure benchmark](real-market/README.md) contains
the raw-data source manifest, historical comparison, normalized flow/streak metrics
and offline reproduction tools. It keeps A and draft #72's B as separate pinned sources.

The [P1 conditional-activity experiment](conditional-activity/report.md) records a
separate bounded arrival-memory candidate, its paired results and rejection rationale.

## Run

From the repository root, after `npm ci`:

```text
npm run qa:sim:market-baseline:check
npm run qa:sim:market-baseline -- --verify
npm run qa:sim:market-baseline -- --seeds SIM01-A,SIM01-B,SIM01-C --tokens 200 --seconds 1800 --verify --out output/experiment.json
```

The default output directory is ignored by Git. `--verify` runs the complete experiment
twice in the same process and requires identical serialized measurements. The fast QA
also tests seed-order independence, the restored clock and hand-calculated metric paths.
No performance timings or current wall dates enter the measurement hash.

The wrapper uses the already installed esbuild build tool, bundles to an OS temporary
directory, and removes its own temporary directory in `finally`. No packages are installed
by these commands. It validates options and fails on unknown options or invalid values.

## Experiment and provenance

The checked-in `baseline-main.json` measures runtime from main
`df2de0794ec41c9de9ad95c852115d3635549cb5`, also verified as GitHub main before the run.
The working copy had an unrelated walletStore edit and an untracked regression signoff;
neither is imported by the harness or included in this PR. `sourceDirtyPaths` identifies
the new, then-uncommitted QA inputs, not a changed runtime. Runtime and harness input
fingerprints separately identify the exact measured code, normalized to LF.

JSON schema version 1 records the source commit, measured dirty paths, runtime/harness
SHA256 fingerprints, Node version, full experiment config, measurement SHA256, summary,
and per-token metrics/episodes. A source commit identifies the checkout; when measured
inputs are dirty, the fingerprints identify the actual code, and the JSON must not be
represented as a pristine checkout result. Metadata may differ after a QA-only commit;
compare `measurementSha256` and runtime fingerprint when reproducing this baseline.

- Seeds: SIM01-A/B/C, 200 fresh tokens each, 30 minutes maximum, 200 ms ticks.
- Start date: 2026-10-15 UTC; alternate token starts at 08Z and 19Z.
- Fate, starting-liquidity argument, timeout and stillborn sampling use the current
  fresh-launch functions and order. Dormant fast path is enabled as in registry.
- `TokenSim` RNG uses deterministic test ids from `[seed, index]`; metadata generation
  still consumes its usual RNG draws. This removes the process-global generator id
  counter dependency. These are new paths, not numerically identical to the audit's
  prototype ids. No production RNG or generator is edited.
- Fixed mocked `Date.now`, restored in `finally`. No user trades, registry narratives,
  bootstrap, launch scheduling, eviction or interactions between tokens.
- A QA-only tape observer retains every pre-migration print before bounded-tape pruning.
  It invokes the original push unchanged and consumes no random draws. The completing
  curve print is included; subsequent migrated prints in that same tick are excluded.

## Metric definitions

Shares are fractions [0,1]; price moves/drawdowns are percentages. No-trade shares and
zero-exposure frequencies are `null`, not zero. Empty distributions have null quantiles.
Quantiles interpolate at `(n-1)*p`.

- Quote volume is `SimTapeTrade.notionalUsd`: fee-exclusive executed quote, for both
  sides. Count/volume shares and frequency are pooled by actual count/quote/exposure,
  not an unweighted average of token ratios.
- Price is post-trade reserve spot. Max drawdown uses every retained print, plus the
  path's opening price: `max(1 - price / runningPeak)`. It includes intrasecond extrema.
- An impulse/correction is a consecutive run of same-sign nonzero print-to-print spot
  changes. Equal prices do not end a run; silence does not reset it. Magnitude is the
  compounded start-to-end move, with corrections reported as positive magnitudes.
  This is trade-level structure, not a candle-pattern detector or 1s close metric.
- Four groups: 80–90 / 90–100 percent curve progress, readiness true/false.
  Membership is observed at the **start of the 200 ms tick**. Its prints and elapsed
  time belong to that group until the next observation, including the print that exits
  a band or completes the curve. This preserves exit losses rather than dropping them.
  It does not claim the parameters used inside the tick had exactly the same readiness.
- An episode is contiguous exposure to one group. Leaving the band or changing
  readiness ends it; reentry starts a new episode. Episode distributions weight episodes,
  and the JSON retains each token's episodes for paired experiments.
- `first80Sec` is the timestamp of the first executed print reaching progress >=0.8.
  `from80` starts at that print's price, excludes its notional/count (the entry print
  already belongs to preMigration), and includes **all subsequent pre-migration prints**,
  even after retreats below 80%. It ends at migration or the original launch-age horizon.
  An immediate 80%-to-completion jump can have zero post-entry duration/prints.
- `returnedBelow80` checks actual print-time progress, not merely price below an
  overshooting entry. Time to first 80%, observed time since 80%, and time from 80% to
  migration are separate. Censored paths are explicitly counted; migration-time
  distributions include only observed migrants and are not survival estimates.
- Frequency is trades divided by actual exposure seconds. Empty bins use launch-age
  seconds `(s,s+1]`, including partial edge bins touched by an episode. Event-only
  zero-duration bins count as exposed if they contain a print. `emptySecondShare` is
  empty **bin count**, not exact wall-time occupancy. Group aggregates pool episode bins;
  two episodes in one second can count that bin twice. Do not compare that share to a
  unique global per-second series without rebuilding a common exposure convention.
- No-trade seconds are not candles. The production sparse aggregator creates no
  synthetic empty candles. A genesis observation has no trade count/volume.

## Current main result

600 tokens, 34,688 curve prints, 296.48 token-hours observed pre-migration. 42 reached 80%,
30 later printed below 80%, 34 of the entrants remained censored at the horizon.
8/600 migrated (1.333%); median launch-to-migration 161.501 s, p90 393.161 s.
Median first-80 age 95.501 s; median 80%-to-migration among migrants 80.9 s.
Full post-80 path max drawdown p50/p90: 30.19% / 89.45%.

| Start-of-tick group | Tokens / episodes | BUY count / quote share | Trades/s | Empty bins | Episode MDD p50 |
|---|---:|---:|---:|---:|---:|
| 80–90 ready | 17 / 19 | 65.89% / 75.80% | 0.06977 | 93.67% | 2.74% |
| 80–90 not ready | 34 / 46 | 32.51% / 30.43% | 0.02327 | 98.33% | 10.21% |
| 90–100 ready | 8 / 8 | 97.18% / 90.07% | 0.36132 | 72.25% | 0% |
| 90–100 not ready | 7 / 9 | 24.87% / 25.73% | 0.04586 | 97.19% | 21.81% |

These are descriptive engine measurements, not real-market targets. Small high-progress
samples (especially only 8 ready migrants), two start hours, finite follow-up, repeated
membership, differing episode durations and survivor selection limit inference. The
full post-80 path reduces band-survivor bias but still conditions on reaching 80%.
The original audit used different ids, 1s metrics and a separate 120s first-passage window;
its numbers must not be read as before/after this QA-only PR. There is no behavior change.
No raw Pump.fun sequence is available in the repo, so this report makes no numerical
claim about real-market drawdown, impulses or candle similarity.

## Root cause of every historical OHLC failure

`ohlc-failures-main.json` retains all **91 individual labels and actual/expected values**
from main's `tradeOhlcQa`, grouped below. The production contracts are documented in
[OHLC consistency](../../ohlc-consistency-audit.md),
[late tick policy](../../late-tick-policy.md), and the approved implementation section of
[volume basis](../../volume-basis-audit.md). Historical audit documents are preserved.

| Cause | Old failures | Correct expectation / independent evidence |
|---|---:|---|
| Continuity OPEN and resulting LOW | 26 | Previous close participates in new candle range; lateTickQa's explicit continuity fixture |
| Sorted oracle includes rejected late ticks | 24 | Admission in arrival order; no price/volume mutation from earlier timestamps; equal timestamps preserve insertion order |
| Genesis omitted | 20 | One zero-volume genesis observation included in projections and count |
| Wallet notional equated with market quote | 4 | User BUY market=filledUsd-feeUsd; SELL market=filledUsd+feeUsd; reserve-quote delta checked independently for all four actor/side cases |
| Spot equated with exchange average | 4 | Tape/price candles use post-swap reserve ratio; wallet average remains filledUsd/filledToken |
| Public-tick genesis hardcoded to $5000 | 13 | Legacy constructor argument scales liquidity, not curve start price; capture actual genesis before ticking; officialCurveQa separately verifies literal official reserves/start price |

The former `ohlcConsistencyAuditQa` stops earlier at `Projection mismatch 1/price`
for the same hardcoded genesis. Fixing that value alone would expose its later hardcoded
78-discrepancy baseline, which is stale (now 91). This PR replaces tolerated discrepancy
counts with contract assertions; no unexplained failure is ignored. Redundant trade-only
versus seeded projections are consolidated, while the four actor/side reserve checks,
public user-fill tick, both metrics, all TFs, equal/late input and retention remain tested.
The independent oracle has a hand-calculated check and does not call the aggregator.
Natural fixed-id simulations additionally verify all eight projections against complete
short-session tape. Their coverage is finite, not proof of all execution states.

## Validation

- `npm run qa:sim:market-baseline:check`: 415/415 trade OHLC checks; 11,489 consistency
  comparisons; known-path/determinism/seed-order metrics checks; official curve QA PASS.
- Default full `--verify` experiment: exact repeated measurement match (hash in JSON).
- TypeScript `--noEmit`, build and lint pass. Five pre-existing React Hook warnings and
  the existing bundle-size warning remain outside this PR.
- Existing Windows/Edge dead-floor and quick-limit launchers pass sequentially. The
  first sandboxed attempt could not connect to the local dev server; retry outside the
  sandbox passed. Browser checks used the working copy, including the unrelated existing
  walletStore edit. No manual UI/lifecycle signoff is claimed for this tooling-only PR.
- CI now runs the fast baseline/OHLC checks; the full 600-token experiment is opt-in.
