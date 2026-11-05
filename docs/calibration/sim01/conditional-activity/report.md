# SIM-01 / P1: Conditional Market Activity A/B

**Recommendation: REJECT this candidate for integration.** It improves several activity
measures but roughly doubles early activity and capital turnover and quadruples
migration, while conditional high-progress activity remains far below the real sample.
This is evidence against this fixed configuration, not proof that executed-flow memory
cannot be useful. No compensating parameter changes were made. Draft experiment only.

## Design and attribution

Parameters were committed in `ad0da50` before the full run; [plan](plan.md) records
the mechanism and limits. A is main `4b976ad` after #73. B replaces only pre-migration
last-print excitement with capped, exponentially decaying executed-print memory.
Eight-second time constant; +0.075/s per print; organic extra capped at 2/s and 5x
the unexcited organic rate. Existing factors still apply (largest 1.7, so final extra
<=3.4/s); total organic amplification <=6x. Unchanged finish-stretch floor can mask
that amplification. Kernel mass 0.6 before those factors is not a stability proof.

Both sides excite equally. Actual successful tape records enter a pending counter,
committed after phase update at tick end. The arrival query uses only previously
committed ticks and simulation milliseconds. Failed fills/genesis do not excite.
Stillborn, silent, DEAD and collapse paths bypass the extra rate. Post-migration
arrival formula, sizes, bias (including ready 0.98), suppression, cadence, microbursts,
guards, reserves, fees and execution are unchanged. Subsequent state/size distributions
can nevertheless change through feedback, elapsed age, slot allocation and selection.

The old rule remembers one last print for <=12s and adds <=18%, while the age curve
continues decaying. The candidate accumulates actual flow; it has no 80% or readiness
trigger. Its broad early amplification and the remaining sixfold organic ceiling help
explain why it does not solve the conditional gap economically. This experiment does
not isolate age decay, regime shape, finish-floor or bootstrap as individual causes.

## Populations and measurement

Fresh launches: six paired seeds SIM01-A..F, 1000 tokens/seed, 1800s launch-age
follow-up, 200ms ticks, alternating 08Z/19Z on 2026-10-15: maximum 3000 token-hours
per arm. All initial ids/fates/stillborn flags/hours match. Both full arms repeated
exactly; A's 6000 ordered tapes also match historical A from #73 exactly. Runtime
source fingerprints, configuration, measurement hashes and prepared input hashes are
in [results](results.json). The measured candidate runtime is `ad0da50`; later changes
in this PR add tests, controls and reporting without changing that runtime.

Real data: pinned Pumpdatafun day/revision, standard-K-compatible active noninstant
launches, 20,319 paths, 30min follow-up, completion-censored. See the immutable
[source manifest](../real-market/sources.json) and [metric contract](../real-market/README.md).
Real/A outputs reproduce all persistent benchmark reference fields. No real readiness
state is inferred. Real all-launch counts and instant/nonstandard graduations remain
in that benchmark, rather than being mixed with this conditional price population.

Native tables use unique 1s bins owned by state at bin start; single-print/wick shares
condition on observed candles. Event MDD/impulses/streaks and quote SOL/s use contiguous
pre-swap-owned event episodes and actual exposure duration. These denominators differ.
Continuity OPEN participates in wicks; empty seconds are not fabricated production
candles. First80 windows exclude their entry print, retain retreats, require entry
<=1680s and stop at completion or entry+120s. Completed durations are not survival
estimates. Event-stage token counts differ from native-bin token counts when a stage
is crossed inside a second. All distributions retain sample sizes in JSON.

## Real / A / B price and activity

### 0–80%

| Metric | Real | A | B |
| --- | --- | --- | --- |
| Event-band tokens | 20319 | 4728 | 4728 |
| Transactions / exposed native second | 0.0474 | 0.0435 | 0.0883 |
| Transactions / active native second | 2.9090 | 1.5595 | 1.8141 |
| Empty native bins, % | 98.3695 | 97.2088 | 95.1329 |
| Single-print observed candles, % | 49.6985 | 70.9934 | 59.9139 |
| Observed candles with wick, % | 22.5892 | 15.4166 | 23.1647 |
| BUY / SELL quote SOL per event-exposure s | 0.0110 / 0.0102 | 0.0162 / 0.0108 | 0.0304 / 0.0214 |
| Individual quote SOL p50 / p90 | 0.1749 / 1.0951 | 0.1019 / 1.4884 | 0.1132 / 1.4746 |
| Direction changes / 100 transactions | 29.4128 | 45.6209 | 47.3670 |
| Episode MDD % p50 / p90 | 12.6719 / 59.9472 | 27.5590 / 64.6775 | 29.9599 / 70.4481 |
| Impulse / correction % p50 | 2.1245 / 2.7703 | 1.8723 / 0.9360 | 1.8153 / 0.9761 |
| BUY streak trades p50 / p90 | 2.0000 / 7.0000 | 2.0000 / 5.0000 | 2.0000 / 4.0000 |
| SELL streak trades p50 / p90 | 2.0000 / 6.0000 | 1.0000 / 3.0000 | 1.0000 / 3.0000 |

### 80–90%

| Metric | Real | A | B |
| --- | --- | --- | --- |
| Event-band tokens | 679 | 463 | 1001 |
| Transactions / exposed native second | 2.1108 | 0.0388 | 0.0893 |
| Transactions / active native second | 3.8115 | 1.3010 | 1.6711 |
| Empty native bins, % | 44.6190 | 97.0188 | 94.6575 |
| Single-print observed candles, % | 31.8417 | 79.1344 | 62.8126 |
| Observed candles with wick, % | 37.4433 | 8.8231 | 19.0827 |
| BUY / SELL quote SOL per event-exposure s | 0.4392 / 0.4273 | 0.0224 / 0.0266 | 0.0580 / 0.0489 |
| Individual quote SOL p50 / p90 | 0.1235 / 1.1983 | 0.3212 / 3.4311 | 0.3657 / 3.3512 |
| Direction changes / 100 transactions | 35.1992 | 39.2264 | 41.4085 |
| Episode MDD % p50 / p90 | 5.8276 / 24.5217 | 10.5908 / 32.7057 | 8.5758 / 30.3185 |
| Impulse / correction % p50 | 1.1331 / 1.1457 | 1.9566 / 2.3285 | 2.5011 / 2.0443 |
| BUY streak trades p50 / p90 | 2.0000 / 7.0000 | 1.0000 / 4.0000 | 1.0000 / 4.0000 |
| SELL streak trades p50 / p90 | 1.0000 / 4.0000 | 1.0000 / 4.0000 | 1.0000 / 4.0000 |

### 90–100%

| Metric | Real | A | B |
| --- | --- | --- | --- |
| Event-band tokens | 408 | 171 | 573 |
| Transactions / exposed native second | 2.9193 | 0.1118 | 0.2578 |
| Transactions / active native second | 4.4470 | 1.3176 | 1.6346 |
| Empty native bins, % | 34.3535 | 91.5162 | 84.2290 |
| Single-print observed candles, % | 26.9284 | 75.9820 | 62.3389 |
| Observed candles with wick, % | 40.8383 | 6.3599 | 10.1594 |
| BUY / SELL quote SOL per event-exposure s | 0.5530 / 0.5508 | 0.0899 / 0.0414 | 0.2264 / 0.0700 |
| Individual quote SOL p50 / p90 | 0.1020 / 1.0641 | 0.3554 / 3.0402 | 0.3668 / 3.1375 |
| Direction changes / 100 transactions | 34.7475 | 18.8679 | 19.1196 |
| Episode MDD % p50 / p90 | 7.2093 / 26.1189 | 3.5785 / 34.5642 | 0.9939 / 24.9109 |
| Impulse / correction % p50 | 0.9689 / 0.8284 | 3.2396 / 1.6072 | 2.8917 / 1.5753 |
| BUY streak trades p50 / p90 | 2.0000 / 7.0000 | 2.0000 / 17.8000 | 2.0000 / 18.2000 |
| SELL streak trades p50 / p90 | 1.0000 / 4.0000 | 1.0000 / 5.0000 | 1.0000 / 4.0000 |

The 80–90% rate rises 2.30x but remains about 23.6x below Real. BUY+SELL
quote flow rises from 0.0490 to 0.1069 SOL/s in event episodes, still below Real
0.8665. In 0–80%, native frequency changes from 0.0435 (near Real 0.0474) to 0.0883.
An improved wick share in early phase does not excuse this activity/turnover shift.
The 90–100% BUY-dominated streak tail persists because #72's bias change is absent.
Larger or smaller MDD is not intrinsically a realism improvement.

## Burst and silence distributions

High activity means >=2 prints in one native second, a diagnostic threshold rather
than a calibration target. A burst is a contiguous run of such bins within a stage;
silence is a contiguous run of zero-print bins. Stage transitions and observation
boundaries clip/reset runs. Weights are observed runs, not tokens; token peaks and
ever-high shares use tokens with native exposure to the stage. This excludes tokens
that transit the band entirely inside a second. Full intensity histograms are in JSON.

### 80–90% native bins

| Metric | Real | A | B |
| --- | --- | --- | --- |
| Native-exposed tokens | 628 | 459 | 986 |
| Ever-high token share, % | 99.6815 | 62.3094 | 83.8742 |
| High-bin share, % | 37.7467 | 0.6220 | 1.9867 |
| Token peak prints/s p50 / p90 | 15.0000 / 41.0000 | 2.0000 / 4.0000 | 3.0000 / 6.0000 |
| Burst duration s p50 / p90 / p99 | 1.0000 / 5.0000 / 19.0000 | 1.0000 / 2.0000 / 4.0000 | 1.0000 / 3.0000 / 7.0000 |
| Silence duration s p50 / p90 / p99 | 2.0000 / 6.0000 / 27.8700 | 7.0000 / 94.0000 / 831.9200 | 4.0000 / 70.0000 / 698.7200 |

### 90–100% native bins

| Metric | Real | A | B |
| --- | --- | --- | --- |
| Native-exposed tokens | 394 | 170 | 565 |
| Ever-high token share, % | 99.4924 | 84.1176 | 94.6903 |
| High-bin share, % | 47.9690 | 2.0376 | 5.9395 |
| Token peak prints/s p50 / p90 | 15.0000 / 42.7000 | 2.0000 / 4.0000 | 3.0000 / 6.0000 |
| Burst duration s p50 / p90 / p99 | 1.0000 / 7.0000 / 31.0000 | 1.0000 / 2.0000 / 4.0000 | 1.0000 / 3.0000 / 7.0000 |
| Silence duration s p50 / p90 / p99 | 1.0000 / 6.0000 / 28.0000 | 2.0000 / 10.0000 / 497.7500 | 2.0000 / 7.0000 / 251.8000 |

## First80 + 120 seconds, including retreats

| Metric | Real | A | B |
| --- | --- | --- | --- |
| Eligible paths | 681 | 466 | 1006 |
| Trades / actual exposed s | 3.4063 | 0.2152 | 0.5397 |
| MDD % p50 / p90 | 40.2813 / 87.0680 | 9.8990 / 38.3588 | 15.3634 / 52.3257 |
| Direction changes p50 | 92.0000 | 5.0000 | 10.0000 |
| Retreated below80, % | 82.9662 | 47.2103 | 49.6024 |

B raises median MDD and reversals here, but it also changes entrant composition.
The A-age-anchored control retains 466 A-defined anchors: 60 B paths have already
completed before their A anchor and cannot provide a pre-migration window. Remaining
B exposure is 41,334.071s versus A 51,589.335s; rates 0.6798 versus 0.2152/s. This
control exposes selection/censoring rather than establishing an unbiased matched-state
effect. Whole-cohort outcomes below include all 6000 pairs, including those completions.

## Whole initial cohort and paired differences

| Metric | A | B |
| --- | --- | --- |
| Initial tokens | 6000 | 6000 |
| Active / stillborn | 4728 / 1272 | 4728 / 1272 |
| Executed trades | 364196 | 696840 |
| Quote turnover SOL | 233941.8103 | 433040.6945 |
| Observed pre-migration token-hours | 2953.0803 | 2798.4618 |
| Trades / observed second | 0.0343 | 0.0692 |
| Quote SOL / observed second | 0.0220 | 0.0430 |
| Migrated / initial, % | 1.8500 | 7.6667 |
| Migrated / active, % | 2.3477 | 9.7293 |
| Migration time s p50 / p90 | 173.9010 / 494.5010 | 125.6010 / 411.4210 |
| Reached80 / retreated / censored entrants | 469 / 339 / 358 | 1010 / 662 / 550 |
| Terminal DEAD/RUGGED | 0 | 0 |
| Unmigrated with no print in final60s | 5369 | 5020 |
| Ever >=2 prints/s, initial cohort % | 75.6167 | 76.8167 |

Real standard active noninstant graduation is 203/20,319 (0.9991%); this is a
conditional real denominator, not the all-launch denominator of 6000 simulation births.
It must not be used as an arbitrary graduation tuning target. Real terminal DEAD is
unobserved; sim DEAD=0 does not imply no economic inactivity. The final60s diagnostic
counts unmigrated paths with no executed print in that period, including stillborn.
All 1272 stillborn tokens have zero prints in both arms. The active birth count stays
4728. Deadline-after-silence print totals (25,433 / 33,112) include unchanged finish
floor, scheduled dev flow, rug and user-rebound exceptions; they are not a count of
memory-driven revivals. Gating is tested directly; no blanket claim of zero late prints.

Paired deltas use each token's complete observed pre-migration path, with its own
completion censoring. A-defined subgroups use reference outcomes, not pretreatment
randomized strata. A token can occur in multiple readiness rows. Units: MDD percentage
points, quote SOL. Full p10/p50/p90/p99 are saved; the table shows p50 / p90.

| A-defined group | Pairs | Trade delta | Quote SOL delta | MDD pp delta | Migration count delta |
| --- | --- | --- | --- | --- | --- |
| initial_cohort | 6000 | 38.0000 / 143.0000 | 11.6236 / 105.3283 | 0.0000 / 29.4825 | 349 |
| A_reached80 | 469 | 110.0000 / 229.4000 | 49.2382 / 158.6011 | 1.9303 / 40.8268 | 87 |
| A_80_90_ready | 227 | 114.0000 / 179.0000 | 59.6123 / 155.7238 | 10.3893 / 46.6059 | 41 |
| A_80_90_not_ready | 377 | 108.0000 / 232.0000 | 45.7310 / 154.1110 | 0.7135 / 37.9932 | 87 |
| A_90_100_ready | 102 | 121.5000 / 203.3000 | 58.5657 / 154.4678 | 15.1230 / 52.1434 | -27 |
| A_90_100_not_ready | 87 | 114.0000 / 253.6000 | 34.5618 / 159.2083 | -0.9460 / 51.8795 | 7 |

There are 349 net extra migrations overall, but -27 in the 102 A-defined
90–100-ready tokens. This heterogeneity is lost in unpaired survivor-only averages.

## Readiness groups (simulation only)

Start-of-tick band/readiness owns the tick and its exit prints, as in PR #71. Groups
can overlap per token across time; they are not the native-bin population above.

| Group | A tokens | A tx/s | A quote SOL/s | B tokens | B tx/s | B quote SOL/s |
| --- | --- | --- | --- | --- | --- | --- |
| 80_90_ready | 227 | 0.0813 | 0.1168 | 668 | 0.1633 | 0.2200 |
| 80_90_not_ready | 377 | 0.0322 | 0.0376 | 603 | 0.0661 | 0.0695 |
| 90_100_ready | 102 | 0.3887 | 0.4521 | 432 | 0.6532 | 0.7765 |
| 90_100_not_ready | 87 | 0.0589 | 0.0680 | 169 | 0.1350 | 0.1366 |

## Bootstrap Final Stretch: separate diagnostic

This is not the fresh-launch A/B population or a claim about the full registry/UI.
120 requested slots (20/seed), NORMAL/LONG_RUNNER, target age 8–22min, up to 14
attempts, production bootstrapAdvance up to1.2s steps and Final Stretch predicate.
Stop on terminal phase or matching band after8min; continue matched tokens for120s
at200ms. Unmatched slots are retained as failures; registry's new-pair fallback is
deliberately excluded. This isolates the selection diagnostic without store/registry
mutation. The control has its own fixed ids and repeats exactly. A/B selected identities
and readiness composition differ, so the matched samples are not paired survivors.

| Metric | A | B |
| --- | --- | --- |
| Slots / matched | 120 / 75 | 120 / 80 |
| Ready at selected start | 21 | 48 |
| Migrated within120s | 1 | 10 |
| Trades in120s p50 / p90 | 2.0000 / 4.0000 | 4.0000 / 18.3000 |
| MDD % p50 / p90 | 0.6307 / 16.4753 | 0.3033 / 12.8920 |

This confirms a material selection/retention interaction. Do not combine these
older selected tokens with the fresh cohort to claim conditional activity improvement.

## Determinism, tick partition and performance

Fixed executed-event kernel tests pass for partitioned elapsed time, bounded long-series
excitation, exponential decay, read-only queries, invalid observations, no current-tick
feedback, end-tick commit, failed fills, stillborn/silence/DEAD/collapse gates.
Whole-engine paired control uses 100 SIM01-A tokens at each tick size, 1800s horizon:

| Tick ms | A migrants | A first80 | A trades | A tx/s | B migrants | B first80 | B trades | B tx/s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 100 | 1 | 5 | 5304 | 0.0297 | 8 | 16 | 9704 | 0.0574 |
| 200 | 2 | 8 | 5474 | 0.0310 | 7 | 20 | 10383 | 0.0613 |
| 1000 | 0 | 7 | 5426 | 0.0301 | 8 | 13 | 10343 | 0.0615 |

Exact whole-engine tick-partition invariance **fails in A and B**. The existing
tick-sampled Poisson/RNG, regimes and execution batching already depend on tick size;
P1 does not repair them. Thus a strict tick-invariant engine acceptance gate is unmet,
even though the fixed-event kernel and repeated fixed-tick runs are deterministic.
No broader clock/execution refactor is bundled here.

| Arm | Harness elapsed s | Observed token-hours | CPU-work proxy wall s / token-hour |
| --- | --- | --- | --- |
| A | 159.8412 | 2953.0803 | 0.0541 |
| B | 157.9809 | 2798.4618 | 0.0565 |

These are first-pass wall durations in A-then-B order, excluding bundling and
repeat verification, not CPU profiler measurements. B ends more paths earlier and has
a warmer process; raw elapsed is not equal workload. The harness also includes
tape/readiness observer costs, so this is not an isolated production-engine
microbenchmark. Per observed token-hour is about
4.3% higher in B. No browser frame-time or memory benchmark is claimed. State is O(1)
per token; the new mechanism does not scan tape or add random draws.

## Regression results and limits

- PASS: build, TypeScript strict, lint (five preexisting Hook warnings), baseline OHLC
  QA (415 checks and 11,489 comparisons), official curve, metric definitions, new P1
  memory tests and 644 financial assertions using literal125bps, quote/fill and bot
  completion handoff. Windows/Edge dead-floor and quick-limit passed sequentially.
- PASS in A and B: migrationGateQa, stillbornLaunchQa, arrivalDecayQa, simClockQa.
- Existing failures reproduced in A and B, kept visible: completionHandoffQa and
  buyExhaustionQa use 0.99/1% fee fixtures; curveParityQa expects trade-only OPEN/LOW
  instead of continuity OPEN (2 failures); tradeTimestampQa includes hardcoded $5000
  genesis/old projection assumptions (106 failures). curveParityAuditQa and volumeBasisQa
  fail in their store-position fixture (`costBasisUsd` undefined); their full paths
  remain unvalidated by those scripts. These are not reported as passing.
- Original cashCapSellQa reports58,492/61,586 fee discrepancies. Every failing label
  is net-output-with-fee using f=0.99. A separately labelled temporary diagnostic changes
  only that test literal to0.9875: A1,575,751/1,575,751 and B1,661,032/1,661,032 invariants
  pass; forced guard2/2 each. Original tests and production execution are unchanged.
  This supplementary check does not erase the original failures.
- Browser launchers exercise local working copy including the existing unrelated
  walletStore edit; that edit is excluded from this PR. No full manual UI signoff.

See `results.json.regressions` for exact A/B outcomes. Diagnostic scripts stop at
their failures; unexecuted later assertions are not claimed covered. Existing failures
require separate work, not changing market parameters to hide them.

## Reproduction and decision

From repo root, with existing npm dependencies and Python3.12 standard library:

```text
npm run qa:sim:market-baseline:check
node scripts/qa/conditional-activity.mjs --repeat --out output/sim01-p1-full
python scripts/qa/conditional-activity-analysis.py --work-dir output/sim01-p1-full --reference-work output/sim01-reproduction
node scripts/qa/conditional-activity-regressions.mjs
node scripts/qa/conditional-activity.mjs --bootstrap --tokens 20 --repeat --out output/sim01-p1-bootstrap
node scripts/qa/conditional-activity.mjs --tokens 100 --seeds SIM01-A --tick 100 --out output/sim01-p1-tick100
node scripts/qa/conditional-activity.mjs --tokens 100 --seeds SIM01-A --tick 200 --out output/sim01-p1-tick200
node scripts/qa/conditional-activity.mjs --tokens 100 --seeds SIM01-A --tick 1000 --out output/sim01-p1-tick1000
```

First prepare `output/sim01-reproduction` using the checksum-verified persistent
benchmark instructions; the analysis links/copies its immutable ordered real CSV and
launches CSV. It does not accept aggregate JSON as raw input. `--reuse-computed`
rechecks existing benchmark outputs against Real/A references and recomputes remaining
P1 aggregates, retaining an existing activity histogram. It requires previous analysis
provenance and rejects changed input hashes. Remove it for full recomputation.
Local run used that procedure with reference directory `output/sim01-pr3-persistent`.
Download transfer was not repeated; cached pinned data was used. Large tapes/Parquets
stay under ignored output; only compact aggregates and provenance are versioned.

**Decision: REJECT for integration.** Transaction count +91.3%, quote turnover +85.1%,
migrations111→460, and early0–80 activity overshoot outweigh partial improvements to
burst lengths, silence and wick shares. No numeric graduation tolerance was predeclared;
this is an engineering recommendation from joint material shifts, not a claimed
statistical acceptance threshold. Whole-engine tick invariance is also unmet. Do not
merge B or compensate via sizes/bias/migration in this experiment. A future proposal
should first separate persistent participation from feedback amplification and address
the tick-partition limitation in its own approved scope. One-day real selection,
age/exposure differences, completion censoring, conditional membership and absent real
readiness/transfer-complete balances prevent a claim of greater whole-engine realism.
