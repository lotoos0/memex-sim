# SIM-01 / P1c participation capacity A/B

**REJECT.** All three improvement thresholds are above the upper ends of their paired intervals.

The improvement is limited to ages 120–300 s. Conditional activity falls in both older bands. The top-five-percent share increases slightly as the total market and its top group both lose quote turnover. Fixed A leaders also lose activity and turnover.

A is main `4b976ad` after PR #73. B is runtime `f429c99`. The frozen policy uses an expiring token-local reserve, with a 120 s lot deadline and no 12 SOL brake. It changes only organic arrival intensity. See [frozen plan](plan.md). PR #72 and #74 are separate.

600 paired pilot births checked the mechanism. The primary run uses 6,000 paired fresh births, six seeds SIM01-A through F, 1,000 per seed, 200 ms ticks, 1,800 s horizon, alternating 08Z/19Z. Both arms reproduced their complete measurement hashes exactly. All paired warm-up prints through 60 s and stillborn outcomes match. A also matches the prior PR73/74 A tape measurement hash. No pilot-driven parameter changes were made.

Real is the PR73 standard active noninstant sample from one day, selected differently from all sim births. In the all-path Real column this means 20,319 observed paths, not all Pump.fun launches. Real readiness/stillborn are unavailable. See [source and metric definitions](../real-market/README.md). Windows use the first80 <=1680 s rule, observed exposure and completion censoring. The counts of event-only zero-duration prints and quote are stored separately. The Real/A union of post-entry windows matches the saved 120 s benchmark.

## Whole cohort and concentration

| Metric | Real | A | B |
| --- | --- | --- | --- |
| Observed paths | 20319 | 6000 | 6000 |
| Active paths | 20319 | 4728 | 4728 |
| Trades | 2059319 | 364196 | 349879 |
| Gross SOL | 903,377.7588 | 233,941.8103 | 226,794.7056 |
| Signed net SOL | 27,135.4880 | 44,144.2679 | 42,077.4907 |
| Signed net/gross | 3.0038% | 18.8698% | 18.5531% |
| Active trades/token p50 / p90 / p99 | 12.0000 / 205.0000 / 1,694.6400 | 59.0000 / 159.0000 / 320.4600 | 56.0000 / 153.0000 / 315.7300 |
| Executed SOL/trade p50 / p90 / p99 | 0.1614 / 1.0991 / 3.1605 | 0.1060 / 1.5490 / 8.1161 | 0.1052 / 1.5472 / 8.3294 |
| Top 1% quote share, active | 21.7403% | 4.5245% | 4.7183% |
| Top 5% quote share, active | 54.1642% | 17.9826% | 18.2544% |
| Top 10% quote share, active | 69.7641% | 31.2321% | 31.5766% |
| Reached first80 | 685 | 469 | 435 |
| First80 age p50 s | 74.0000 | 94.3010 | 95.1010 |
| Gross / net SOL to first80, respective medians | 142.2874 / 43.9293 | 74.1191 / 45.8866 | 73.4176 / 46.0637 |
| Recycling gross/net to first80, median ratio | 3.2000 | 1.5185 | 1.5179 |
| Migrated | 203 | 111 | 102 |
| Migration share in arm population | 0.9991% | 1.8500% | 1.7000% |
| Migration age p50 / p90 s | 308.0000 / 1,073.0000 | 173.9010 / 494.5010 | 187.9010 / 340.6010 |
| Stillborn | unavailable | 1272 | 1272 |

The leader set below is the top 5% by quote among A's active tokens. The same token IDs are used in B. Endogenous top shares above re-rank each arm. The fixed-leader share change is decomposed by averaging the two orders of substituting leader and other quote.

| A-defined group | A trades | B trades | A gross SOL | B gross SOL |
| --- | --- | --- | --- | --- |
| leaders | 54509 | 51606 | 42,068.7375 | 37,779.8241 |
| others | 309687 | 298273 | 191,873.0728 | 189,014.8815 |

Fixed-group share contribution from leaders is **-1.539 pp**. The contribution from other tokens is **+0.215 pp**. The difference between endogenous and fixed share changes reflects re-ranking. Results also retain fixed-group counts and gross flow by age.

The endogenous top group share increased 0.272 pp while its absolute quote fell from 42,068.7375 to 41,399.9330 SOL. Re-ranking contributed +1.596 pp relative to the fixed group. The A leaders lost both transactions and quote, so the relative concentration increase is not evidence of stronger leader activity.

## Age and first80 windows

Participation requires a print in the observed age window. Intensity divides participating trades by those tokens’ observed window exposure. Composition and survival may differ after treatment.

| Age s | Arm | Participants | Observed active cohort | Conditional tx/s | Gross SOL/s all observed | Net SOL/s all observed |
| --- | --- | --- | --- | --- | --- | --- |
| 120_300 | Real | 8970 | 20272 | 0.2491 | 0.0381 | -0.0031 |
| 120_300 | A | 2946 | 4708 | 0.0629 | 0.0419 | 0.0069 |
| 120_300 | B | 2965 | 4713 | 0.0756 | 0.0500 | 0.0079 |
| 300_600 | Real | 6498 | 20219 | 0.1373 | 0.0161 | -0.0010 |
| 300_600 | A | 2542 | 4643 | 0.0212 | 0.0116 | -0.0020 |
| 300_600 | B | 2488 | 4645 | 0.0189 | 0.0100 | -0.0028 |
| 600_1800 | Real | 5407 | 20162 | 0.0389 | 0.0040 | -0.0003 |
| 600_1800 | A | 3079 | 4625 | 0.0115 | 0.0070 | -0.0027 |
| 600_1800 | B | 3041 | 4633 | 0.0103 | 0.0060 | -0.0027 |
| 120_600 | Real | 10752 | 20272 | 0.1301 | 0.0244 | -0.0018 |
| 120_600 | A | 3196 | 4708 | 0.0326 | 0.0230 | 0.0014 |
| 120_600 | B | 3206 | 4713 | 0.0357 | 0.0251 | 0.0013 |

- 120–300 s conditional tx/s 0.0629 → 0.0756 (20.2579%).
- 300–600 s conditional tx/s 0.0212 → 0.0189 (-10.8838%).
- 600–1800 s conditional tx/s 0.0115 → 0.0103 (-10.5904%).

The feasibility observer found almost no qualifying A states after 600 s. Interpret the oldest interval separately. Earlier effects do not establish sustained capacity in older tokens.

| Seconds relative to first80 | Arm | Positive-duration paths | Observed seconds | Trades/s | Gross SOL/s | Net SOL/s |
| --- | --- | --- | --- | --- | --- | --- |
| -120_-60 | Real | 364 | 18,903.0000 | 2.2930 | 0.9747 | 0.1862 |
| -120_-60 | A | 352 | 15,286.1940 | 0.8581 | 0.4362 | 0.2530 |
| -120_-60 | B | 319 | 14,079.3150 | 0.8998 | 0.4796 | 0.2691 |
| -60_-30 | Real | 464 | 12,433.0000 | 2.9594 | 1.2752 | 0.2935 |
| -60_-30 | A | 407 | 11,474.2870 | 0.9012 | 0.5092 | 0.2538 |
| -60_-30 | B | 374 | 10,484.2870 | 0.8542 | 0.5110 | 0.2448 |
| -30_-10 | Real | 554 | 10,094.0000 | 3.4208 | 1.5530 | 0.4920 |
| -30_-10 | A | 460 | 8,698.1840 | 1.1716 | 0.7477 | 0.3863 |
| -30_-10 | B | 427 | 8,038.1840 | 1.0894 | 0.7393 | 0.4054 |
| -10_0 | Real | 605 | 5,793.0000 | 4.5008 | 2.6028 | 1.0886 |
| -10_0 | A | 466 | 4,645.3920 | 1.0819 | 1.0848 | 0.7024 |
| -10_0 | B | 433 | 4,315.3920 | 0.9814 | 1.0403 | 0.7199 |
| 0_10 | Real | 677 | 6,751.0000 | 5.7617 | 3.2683 | 0.0975 |
| 0_10 | A | 465 | 4,646.4000 | 0.5129 | 0.6632 | 0.1138 |
| 0_10 | B | 432 | 4,318.8000 | 0.4795 | 0.5819 | 0.0535 |
| 10_30 | Real | 672 | 13,320.0000 | 4.4106 | 2.0113 | -0.1063 |
| 10_30 | A | 463 | 9,160.2830 | 0.3506 | 0.3699 | 0.0693 |
| 10_30 | B | 431 | 8,531.7660 | 0.3399 | 0.3974 | 0.0489 |
| 30_120 | Real | 659 | 56,760.0000 | 2.8902 | 1.1115 | -0.0435 |
| 30_120 | A | 450 | 37,782.6520 | 0.1458 | 0.1614 | 0.0323 |
| 30_120 | B | 422 | 35,977.4360 | 0.1677 | 0.1854 | 0.0350 |

## Prespecified criteria

| Guard | Measured | Allowed | Outcome |
| --- | --- | --- | --- |
| Whole-cohort trades, relative | -3.9311% | +/-10.0000% | PASS |
| Whole-cohort gross SOL, relative | -3.0551% | +/-10.0000% | PASS |
| Migration rate, absolute | -0.1500 pp | +/-0.5000 pp | PASS |
| Migration rate, relative | -8.1081% | +/-25.0000% | PASS |
| Whole-cohort signed net/gross, absolute | -0.3166 pp | +/-3.0000 pp | PASS |

| Primary improvement | Measured | Required | Point threshold |
| --- | --- | --- | --- |
| Top 5% active quote share, absolute | 0.2718 pp | 3.0000 pp | FAIL |
| Active trades/token p99, relative | -1.4760% | 10.0000% | FAIL |
| Participating 120–600 s tx/s, relative | 9.6536% | 15.0000% | FAIL |

Paired descriptive 95% intervals use 500 resamples within seed. Seeds are held fixed. This does not estimate independent-day uncertainty.

| Contrast | 95% interval |
| --- | --- |
| top5_share_delta | -0.1288% / 0.7002% |
| p99_relative | -3.9755% / 3.4504% |
| age120_600_rate_relative | 7.6900% / 11.5979% |

| Seed | Top5 share delta | p99 relative | 120–600 s tx/s relative |
| --- | --- | --- | --- |
| SIM01-A | -0.2370% | -1.0578% | 11.9463% |
| SIM01-B | 1.2068% | 2.3911% | 8.4067% |
| SIM01-C | 0.2414% | 2.7868% | 12.2079% |
| SIM01-D | 0.1073% | -2.3051% | 5.5920% |
| SIM01-E | 0.4865% | -1.0165% | 8.8003% |
| SIM01-F | -0.4995% | -4.5555% | 11.5205% |

## Validation and cost

The overlapping timing run was +13.3% and the alternating-order confirmation was −34.5%. The confirmation is within the +10% ceiling, but the sign change makes the magnitude unreliable. The rejection rests on market outcomes. Neither timing run justifies a general performance improvement claim.

Timing without per-print research instrumentation uses three 600-token runs per arm. Median CPU ms per observed token-second is **0.020923** A and **0.013708** B (-34.4824%). This includes harness work and GC. The confirmation runs after the primary simulation and alternates A/B order. The normalized threshold is +10%. An initial overlapping timing run is retained separately as a diagnostic.

| Tick ms (600 pairs) | A trades | B trades | A migrations | B migrations |
| --- | --- | --- | --- | --- |
| 100 | 33931 | 32592 | 9 | 8 |
| 200 | 34030 | 32857 | 11 | 13 |
| 1000 | 33657 | 32178 | 6 | 9 |

Fixed-event capacity is time-partition invariant in QA. Whole-engine sampled paths vary with tick size in both arms. The tick-size runs are sensitivity checks, not substitutes for the primary 200 ms results.

Passed locally: TypeScript, lint (five pre-existing Hook warnings), build (existing bundle-size warning), 415 trade OHLC checks, 11,573 OHLC consistency comparisons, official curve, 369 financial assertions (reserves, fees, quote/fill and completion handoff), migration gate, stillborn, arrival decay, simulation clock, and browser dead-floor/quick-limit. Reserve QA covers long gaps, expiry at tick end, terminal and silence clearing, duplicate begin and settlement, prior credit, protected steps and single bursts. The browser runs used the workspace with the unrelated walletStore edit. That edit is excluded from this PR. No full manual UI walkthrough is claimed.

## Reproduce

Run from the repo root with existing npm dependencies and Python 3.12. Prepare the real inputs with the pinned PR73 tooling.

```text
node scripts/qa/participation-capacity.mjs --tokens 100 --out output/sim01-p1c-pilot
node scripts/qa/participation-capacity.mjs --repeat --out output/sim01-p1c-full
python scripts/qa/participation-capacity-analysis.py --work-dir output/sim01-p1c-full --reference-work output/sim01-pr3-persistent
node scripts/qa/participation-capacity.mjs --tokens 100 --tick 100 --out output/sim01-p1c-tick100
node scripts/qa/participation-capacity.mjs --tokens 100 --tick 1000 --out output/sim01-p1c-tick1000
node scripts/qa/participation-capacity.mjs --timing --tokens 100 --out output/sim01-p1c-performance
npm run qa:sim:market-baseline:check
```

[Results JSON](results.json) includes paired and age-stratified diagnostics, source and tape hashes, performance runs and tick controls. The data and tapes stay outside Git.
