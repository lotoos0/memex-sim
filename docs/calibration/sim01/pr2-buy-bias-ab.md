# SIM-01 / PR2 — Final Stretch BUY bias experiment

## Intervention and provenance

Base A is integrated PR #71, main `84eca0906dc26387ca8b0fd761faad547e06a3fb`.
GitHub confirms #71 was merged on 2026-11-05. The only runtime difference in B removes
the `effectiveBuyBias = 0.98` branch at readiness and curve progress >=90%.
The existing `clamp(effectiveBuyBias + 0.1, 0.4, 0.75)` readiness rule from 80% then also
applies above 90%. Its bounds, underlying regime bias and all other mechanisms remain
unchanged. No arrival floor, SELL suppression, readiness requirement, curve/execution,
guard, microburst, constant or frozen contract is changed.

The runner loads A's `tokenSim.ts` directly from the pinned Git object through esbuild;
B uses the working file. It checks that replacing exactly the authorized branch in A
produces B, and that every other bundled runtime input matches the pinned commit.
No production feature flag, dependency, wallet change or monkey-patched bias is added.
The unrelated existing walletStore edit and regression-signoff document are preserved.

```text
npm run qa:sim:buy-bias-ab:check
npm run qa:sim:buy-bias-ab -- --verify --out output/sim01-pr2/ab.json
```

Optional `--base`, `--seeds`, `--tokens`, `--seconds`, `--out` are explicit experiment
configuration, not tuning knobs selected to produce a desired outcome. Default sample
was fixed before observing B: SIM01-A/B/C/D/E/F, 1000 tokens per seed, 1800s launch-age
horizon, 200ms ticks, alternating 08Z/19Z starts on 2026-10-15 UTC. This is ten times
PR1's cohort. The aim is at least 50 baseline 90–100% ready tokens, not a target for
migration or drawdown. Full repetition is requested for both variants.

The existing PR1 harness and metrics are unchanged. Token ids, fate, stillborn status,
start times and first-80 passage times must match exactly by id; mismatch fails the
comparison. Pairing works in any record order and rejects duplicates. Same seeds mean
the same initial random stream, not identical later random draws: changed execution
after treatment can consume RNG differently and propagate into subsequent flow.

`pr2-buy-bias-ab.json` retains provenance, config, summaries, distributions, per-seed
results and ALL initial-cohort paired outcomes. The runner also writes full PR1-format
variant records to `<output>.A.json` and `<output>.B.json` for inspection and reanalysis;
these larger files live under ignored `output/` and are reproducible with the command.
Wall runtimes are logged, not included in measurement hashes. Bundled-source and runner
hashes distinguish the measured code from a checkout SHA with local changes.

## Reading the metrics

Use [PR1 definitions](README.md#metric-definitions): print-level post-swap spot, actual
fee-exclusive quote, peak-to-trough drawdown, consecutive-sign impulse/correction runs,
and start-of-tick band/readiness episodes INCLUDING exit prints. Pooled group shares
describe different exposure populations in A and B; they are not a paired estimator.

Primary outcomes use all 6000 launches, including unchanged/quiet tokens. Separate
views cover all first-80 entrants and a **fixed cohort selected by A's 90-ready
membership**, rather than retaining only B's successful survivors. Episode distributions
are episode-weighted; time/trades per token are also reported, both across all launches
(including zero exposure) and conditional on occupying that band. Token counts can
overlap readiness groups over time.

All paired deltas are B minus A. Null buy shares or missing runs are omitted only from
that metric's paired distribution, with its own `n`; no-trade BUY share is not set to
zero. Migration time deltas include only tokens that migrate in BOTH variants. Others
are reported as A-only/B-only/neither; a horizon is never imputed as a migration time.
Returned-below-80 shares have both initial-cohort and first-80 denominators. Tokens that
reach 80% but do not migrate are censored at the 30min launch horizon, not declared
permanently unable to migrate.

Full post-80 paths last until migration or the launch-age horizon and include retreats
below 80%. B can have longer exposure when migration slows, increasing the opportunity
to accumulate drawdown and direction changes. These effects are part of the observed
policy outcome, not proof of intrinsic volatility at equal elapsed exposure. Both
variants retain the same official migration trigger. No change is made to compensate
for any graduation-rate change.

More drawdown, more SELL, or longer paths do not establish greater realism. No raw
Pump.fun sequence is available for matched price-structure comparison. This controlled
TokenSim cohort excludes registry narratives/bootstrap, user activity and eviction;
only two start hours and one launch-age horizon are sampled. Paired seeds share
conditions and do not provide independent market-day replications. Report descriptive
effects and seed consistency, without treating episode count as independent tokens.

## Regression evidence

New mathematical regressions exercise valid official reserves without overriding the
curve: 20 BUY/SELL cycles with independent constant-product quantities, 1.25% fees,
quote/fill agreement, K preservation, capped completion and a single migration event.
They run in both A and B, alongside officialCurveQa and migrationGateQa. Pair-comparison
QA uses hand-defined outcomes to test matching, deltas, censoring and denominators.

Two additional legacy diagnostics were run separately, without fixing or suppressing
them in this one-parameter experiment:

- `curveParityQa`: A and B both 16/18, exit 1. OPEN/LOW expect 20 for a new sparse
  bucket following close 12; current documented continuity contract returns 12.
- `completionHandoffQa`: A and B both fail `normal/positive quote output`, identically
  498.7398737370968 actual vs 500.0025000125001 expected. Its precision fixture computes
  budget/output with `0.99`; current official curve uses `0.9875`. This is a nonzero
  quote mismatch, not a demonstrated rejected valid trade or a new B failure.

The legacy fixture files are untouched. Their first failing assertions do not establish
the status of later assertions. Current-contract OHLC tests and official-state execution
tests are separate passing regressions; no claim is made that all historical QA passes.

## Results and recommendation

**INCONCLUSIVE for production adoption; the directional-bias hypothesis is supported.**

Both full 6000-token runs repeated exactly. A reproduces all 600 token records from
PR1 when selecting the same seed/index prefix. Baseline A has 102 observed 90-ready
tokens (goal >=50 met). Both A and B have 171 tokens occupying 90–100%, and 469 first-80
entrants with exactly matching first-passage times. 5901/6000 complete token records are
identical; 99 differ. This is a localized intervention, not a global launch-flow change.

The forced BUY dominance is materially reduced, with more reversals and shorter upward
runs in the affected region. There is a substantial completion/time cost: 30 fewer
migrations within the horizon (-27.03% relative, -0.50 percentage points of launches),
no B-only migrations, and all six seeds show fewer migrations. This is an expected
behavioral consequence worth a product decision, not a math/execution defect. There
is no agreed migration-cost budget or real-market sequence to establish that B is
preferable overall. Do not tune another parameter to restore migration in this PR.

### All launches and all first-80 entrants

| Metric | A | B |
|---|---:|---:|
| Initial tokens | 6000 | 6000 |
| Curve prints | 364196 | 369259 |
| BUY count share, initial cohort | 54.28% | 54.08% |
| BUY quote share, initial cohort | 59.43% | 58.99% |
| Initial-cohort max drawdown p10/p50/p90, % | 0.00 / 23.76 / 62.42 | 0.00 / 24.04 / 62.48 |
| Initial-cohort impulse p10/p50/p90, % | 0.22 / 1.87 / 22.59 | 0.22 / 1.88 / 22.14 |
| Initial-cohort correction p10/p50/p90, % | 0.17 / 0.95 / 11.73 | 0.17 / 0.97 / 11.70 |
| Initial-cohort trades/s | 0.03426 | 0.03454 |
| Initial-cohort empty-bin share | 97.79% | 97.76% |
| Reached 80% | 469 | 469 |
| Migrated | 111 (1.85%) | 81 (1.35%) |
| Migration age p10/p50/p90, s | 106.30 / 173.90 / 494.50 | 120.30 / 316.50 / 930.10 |
| Reached 80% but not migrated by horizon | 358 | 388 |
| Returned below 80% | 339 (72.28% of entrants; 5.65% of launches) | 343 (73.13% of entrants; 5.72% of launches) |
| Post-80 drawdown p10/p50/p90, % | 2.86 / 35.07 / 88.92 | 7.84 / 39.67 / 88.92 |
| Post-80 return p10/p50/p90, % | -85.66 / -19.52 / 130.43 | -85.66 / -20.87 / 119.03 |
| Post-80 impulse p10/p50/p90, % | 0.18 / 2.08 / 24.39 | 0.19 / 2.27 / 18.56 |
| Post-80 correction p10/p50/p90, % | 0.17 / 2.42 / 21.12 | 0.18 / 2.28 / 16.95 |
| Post-80 direction changes p10/p50/p90 | 0.00 / 9.00 / 33.20 | 0.00 / 14.00 / 52.00 |
| Post-80 observation p10/p50/p90, s | 71.84 / 1673.50 / 1772.62 | 242.32 / 1689.10 / 1773.18 |

SELL shares are the complement of BUY; both explicit shares and actual counts/quote
are in JSON. Overall launch medians dilute the localized effect, so they must accompany,
not replace, affected-region and paired results.

### Readiness/band episodes

The following distributions weight episodes, not independent tokens.

| Group | Tokens A/B | BUY count A/B | BUY quote A/B | Episode MDD p10/p50/p90 A -> B, % |
|---|---:|---:|---:|---|
| 80_90_ready | 227/228 | 61.40% / 61.05% | 67.29% / 66.20% | 0.00 / 4.51 / 17.47 -> 0.00 / 3.18 / 17.05 |
| 80_90_not_ready | 377/398 | 36.17% / 36.65% | 35.62% / 36.22% | 0.11 / 10.27 / 33.84 -> 0.00 / 9.85 / 33.33 |
| 90_100_ready | 102/102 | 97.34% / 56.65% | 95.44% / 57.97% | 0.00 / 0.00 / 5.17 -> 1.61 / 11.01 / 28.84 |
| 90_100_not_ready | 87/101 | 32.00% / 32.40% | 33.53% / 32.97% | 1.39 / 10.51 / 39.10 -> 1.12 / 9.15 / 38.76 |

| Group | Impulse p10/p50/p90 A -> B, % | Correction p10/p50/p90 A -> B, % |
|---|---|---|
| 80_90_ready | 0.42 / 4.54 / 26.34 -> 0.41 / 4.01 / 24.54 | 0.15 / 2.59 / 12.63 -> 0.15 / 2.40 / 12.61 |
| 80_90_not_ready | 0.13 / 1.19 / 13.97 -> 0.13 / 1.29 / 15.06 | 0.14 / 1.94 / 21.13 -> 0.14 / 2.09 / 21.02 |
| 90_100_ready | 4.31 / 37.47 / 62.16 -> 0.23 / 2.77 / 14.04 | 0.13 / 1.33 / 11.40 -> 0.18 / 1.93 / 10.00 |
| 90_100_not_ready | 0.09 / 1.02 / 11.39 -> 0.09 / 1.04 / 11.04 | 0.13 / 1.62 / 19.17 -> 0.14 / 1.71 / 17.34 |

In 90-ready, direction-change median per episode is 0 -> 7 and median episode return
is +55.17% -> -1.48%. B therefore replaces much of the one-way finishing behavior with
contested paths, not simply larger single red prints: median correction increases
1.33% -> 1.93%, while its p90 decreases 11.40% -> 10.00%. This is a structure change,
not a blanket increase of every volatility statistic.

### Time and trade distributions per occupying token

Each row sums all that token's episodes in a group. Values are p10/p50/p90. The JSON
also contains distributions over ALL 6000 launches (including zeros), and distributions
over individual episodes; these populations must not be conflated.

| Band/state | Occupying tokens A/B | Seconds A -> B | Trades A -> B |
|---|---:|---|---|
| 80_90_ready | 227/228 | 4.88 / 65.00 / 333.28 -> 6.74 / 157.20 / 394.50 | 2.00 / 8.00 / 24.00 -> 2.00 / 10.00 / 26.00 |
| 80_90_not_ready | 377/398 | 6.60 / 295.60 / 1367.84 -> 8.68 / 366.90 / 1368.86 | 1.00 / 8.00 / 43.00 -> 1.00 / 9.00 / 42.30 |
| 90_100_ready | 102/102 | 15.13 / 44.70 / 100.18 -> 12.02 / 94.60 / 357.74 | 8.00 / 19.50 / 31.90 -> 5.00 / 37.50 / 134.60 |
| 90_100_not_ready | 87/101 | 4.28 / 44.10 / 991.36 -> 3.80 / 31.20 / 856.60 | 1.00 / 8.00 / 39.40 -> 1.00 / 8.00 / 36.00 |
| 80_90 | 462/463 | 6.60 / 195.40 / 1549.46 -> 7.60 / 331.80 / 1643.20 | 1.00 / 12.00 / 43.00 -> 1.00 / 13.00 / 48.00 |
| 90_100 | 171/171 | 9.50 / 55.70 / 653.40 -> 10.80 / 102.70 / 733.50 | 2.00 / 18.00 / 36.00 -> 2.00 / 25.00 / 125.00 |

### Paired token deltas

All deltas below are B-A. Fixed baseline 90-ready cohort: n=102, including tokens that
do not migrate in B. Migration outcomes in this cohort: 70 both, 30 A-only, 0 B-only,
2 neither. Across all 6000 launches: 81 both, 30 A-only, 0 B-only, 5889 neither.

| Metric | Pair n | p10 / p50 / p90 delta |
|---|---:|---|
| Post-80 MDD, percentage points | 102 | 0.00 / 9.14 / 33.19 |
| Post-80 direction changes | 102 | 6.00 / 24.50 / 70.90 |
| Post-80 BUY count, percentage points | 102 | -40.60 / -21.75 / -3.29 |
| Post-80 BUY quote, percentage points | 102 | -38.83 / -20.52 / -3.24 |
| Median post-80 impulse, percentage points | 102 | -69.26 / -15.53 / 0.54 |
| Median post-80 correction, percentage points | 92 | -3.33 / 0.00 / 1.69 |
| Post-80 observation, seconds | 102 | 5.61 / 256.90 / 1566.90 |
| Migration age among both-migrants, seconds | 70 | 5.21 / 147.00 / 640.48 |

For all 469 first-80 entrants, paired post-80 MDD delta p10/p50/p90 is 0/0/+10.27 pp;
79 increase and 390 are unchanged. For all launches, paired MDD median and p90 deltas
are zero (56 increase). In the fixed 102-token A-ready group, 79 have higher post-80
MDD, 99 have more direction changes, and 95 have longer post-80 observation.
Migration age increases by median 102.38s among all 81 both-migrants (65 later, 4 earlier,
12 identical), versus 147s in the fixed A-ready both-migrant subset. These are paired
time differences, not the difference of the two marginal migration-age medians.

Only 30 paired terminal post-80 returns decrease materially (>1e-9 percentage points);
58 other nonzero terminal differences are floating-point noise near the same completion
price. JSON sign counts are strict machine comparisons, so do not interpret such tiny
positive/negative terminal deltas as economic gains or losses. The full delta distributions
and null-pair sample sizes are retained.

### Per-seed consistency

| Seed | Initial tokens | Migrants A/B | 90-ready tokens A/B |
|---|---:|---:|---:|
| SIM01-A | 1000 | 21/15 | 19/19 |
| SIM01-B | 1000 | 16/12 | 14/14 |
| SIM01-C | 1000 | 20/15 | 20/20 |
| SIM01-D | 1000 | 17/11 | 15/15 |
| SIM01-E | 1000 | 23/20 | 21/21 |
| SIM01-F | 1000 | 14/8 | 13/13 |

## Validation and artifacts

- Build, TypeScript noEmit, lint: PASS; existing five Hook warnings and bundle-size warning.
- Current-contract OHLC: 415/415; consistency 11,489 comparisons; PR1 metric QA: PASS.
- A/B paired comparison and source-isolation QA: PASS.
- Official curve, 164 quote/fill/fee/K/completion assertions and 11 readiness checks: PASS in BOTH variants.
- Existing Windows/Edge dead-floor then quick-limit: PASS for B; those checks run on the
  working copy including the unrelated existing wallet balance edit, excluded from the PR.
- Both full 6000-token experiments repeat identically; total measured run time about
  570s for A, B and both repeats. A's 600-token PR1 prefix matches every token record.
- Legacy diagnostics fail identically in A/B as documented above; not rewritten or called passing.
- Extended manual five-minute UI/lifecycle signoff was not run; no chart/UI implementation changed.

Measurement SHA256 A: `5090a707062a0e79ebccd7b350a72b028eeece5528a48dd7cb672339524839b8`.

Measurement SHA256 B: `d271a95d165843cb36831331542b68d67b6e2a5f205ece23f592800185d7e7d6`.

See [complete comparison JSON](pr2-buy-bias-ab.json) for config, source fingerprints,
full distributions and 6000 id-paired outcomes. Source code is the proposed B candidate
on a separate experimental branch; the recorded checkout SHA is the base plus the
explicit one-branch runtime diff, fingerprinted in JSON. No merge or deployment.
