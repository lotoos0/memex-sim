# Engine V2 cohort rotation experiment

CONTROL activates all 100 agents at genesis. COHORTS uses the same 100 agents,
with each agent retaining the same seed-specific funding. Indices 0–24, 25–49,
50–74 and 75–99 become eligible at 0, 15, 30 and 45 simulated minutes. Both
variants use the `1000 × BASE_FEE` SELL fee reserve. The absent `cohortRotation`
flag keeps the original configuration and manifest.

Inactive agents receive no observations or Social exposures and cannot decide
or submit orders. Once eligible, agents receive future events through the
ordinary discovery and feedback mechanisms. No history is delivered on entry.
All three creator agents are in the first cohort, and the authored Social posts
are early. This experiment varies both participation timing and information
access. The results cannot isolate capital timing by itself.

## Verdict · REWORK

COHORTS reduced launch intensity and trades per active second. It also made
already overactive paths less sparse, moved more flow into late token ages,
and eliminated all 80% crossings. Both variants had zero completions. Keep the
flag OFF for ordinary sessions. The tested schedule is evidence about staged
participation, with mixed results against Real C.

## CONTROL vs COHORTS vs Real C

| Comparable curve metric | Real C | CONTROL | COHORTS |
| --- | ---: | ---: | ---: |
| Active non-instant paths | 20,278 | 645 | 646 |
| Curve swaps | 2,058,945 | 3,874,110 | 3,825,853 |
| Age 0–2 min | 1,140,667 (55.40%) | 571,154 (14.74%) | 435,156 (11.37%) |
| Age 2–10 min | 667,186 (32.40%) | 1,799,844 (46.46%) | 1,541,621 (40.29%) |
| Age 10–20 min | 177,614 (8.63%) | 1,106,723 (28.57%) | 1,231,668 (32.19%) |
| Age 20–30 min | 73,478 (3.57%) | 396,389 (10.23%) | 617,408 (16.14%) |
| First 120 s, swaps per exposed token-second | 0.469 | 7.379 | 5.613 |
| BUY share by count / fee-exclusive SOL | 53.56% / 51.50% | 42.12% / 50.03% | 42.11% / 50.05% |
| Swap quote SOL, p10 | 0.009778 | 0.000051 | 0.000082 |
| Swap quote SOL, p50 | 0.161459 | 0.005506 | 0.008850 |
| Swap quote SOL, p90 | 1.099112 | 0.412129 | 0.398044 |
| Swap quote SOL, p99 | 3.160494 | 1.481250 | 1.481250 |
| Empty exposed token-seconds | 98.14% | 52.45% | 28.57% |
| Swaps per active token-second | 3.055 | 7.018 | 4.606 |
| Swaps per exposed token-second | 0.057 | 3.337 | 3.290 |
| Paths reaching 80% | 685 (3.38%) | 64 (9.92%) | 0 (0.00%) |
| Curve completions | 203 (1.00%) | 0 (0.00%) | 0 (0.00%) |

**Improvement.** Early intensity fell 23.9% and active-second intensity fell
34.4%. Median quote rose from 0.005506 to 0.008850 SOL. These moved toward Real
C, although early intensity stayed about 12× higher and the median swap about
18× smaller. Trading is less clustered within a single active second, which
reduces the number of simulated execution opportunities packed into that second.

**Deterioration.** The share of swaps at age 10–30 min increased from 38.80% to
48.33%, versus 12.20% in C. Empty seconds fell by 23.88 percentage points even
though Real C is substantially sparser. A simulated trader gets too many
opportunities on older curve tokens, while the experiment removes all late
curve and migration opportunities. BUY remains underrepresented by count. The
result covers one Real C day and six seeded worlds, with no holdout claim.

| Seed | Last swap CONTROL | Last swap COHORTS |
| --- | ---: | ---: |
| A | 89:56.805 | 89:59.995 |
| B | 89:58.537 | 89:59.986 |
| C | 89:32.018 | 89:59.978 |
| D | 89:51.857 | 89:59.997 |
| E | 89:55.334 | 89:59.999 |
| F | 89:53.654 | 89:59.987 |

Every COHORTS run executed within 22 ms of the observation cutoff. Both modes
were trading near minute 90. The stall time beyond the horizon is unknown.

## Participation, capital and discovery

Totals across six independent worlds. CONTROL has 600 eligible agents at every
snapshot. COHORTS separates available SOL already eligible to circulate from
available SOL held by inactive agents. Order escrow is excluded from both.

| Minute | CONTROL available SOL | COHORTS eligible agents | COHORTS eligible SOL | COHORTS inactive SOL |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 6,975.000 | 150 | 1,763.000 | 5,212 |
| 5 | 1,571.381 | 150 | 270.749 | 5,212 |
| 10 | 95.075 | 150 | 29.722 | 5,212 |
| 15 | 28.345 | 300 | 1,748.060 | 3,477 |
| 20 | 9.252 | 300 | 634.674 | 3,477 |
| 30 | 4.526 | 450 | 1,792.286 | 1,703 |
| 45 | 3.007 | 600 | 1,716.121 | 0 |
| 60 | 2.916 | 600 | 19.515 | 0 |
| 90 | 2.909 | 600 | 3.047 | 0 |

Activation changes which balances are eligible. It creates no ledger posting.
At minute 45, COHORTS had 1,716.121 SOL available to eligible agents versus
3.007 in CONTROL. That timing preserves purchasing power for later arrivals,
with both variants starting at 6,975 SOL across their six worlds. Across the shared
curve horizon, turnover was 524,022.84 SOL in CONTROL and 513,835.96 in COHORTS.

| Agent index group | COHORTS entry | Observed token-world pairs CONTROL / COHORTS | Delivered Social exposures CONTROL / COHORTS | COHORTS delay to first observation, median / max (s) |
| --- | ---: | ---: | ---: | ---: |
| 0–24 | 0 min | 646 / 646 | 305 / 305 | 0.61 / 113.39 |
| 25–49 | 15 min | 646 / 471 | 309 / 0 | 29.79 / 242.03 |
| 50–74 | 30 min | 646 / 315 | 298 / 0 | 40.46 / 249.99 |
| 75–99 | 45 min | 646 / 160 | 272 / 0 | 36.62 / 242.92 |

A token-world pair counts once per group when any member receives an
observation. Every group had 150 of 150 agents with at least one observation
across the six worlds. Later cohorts therefore discover ordinary markets, but
they see fewer tokens and receive none of the early Social exposures.

The 628 ordinary listing times matched exactly, seed by seed. Both variants
launched the same 18 Social tokens and all 646 tokens were observed in each
variant. Social launch times matched except in seed C. `tok_social_02` moved
from 2.741 to 4.714 s and `tok_social_00` from 4.142 to 4.441 s. These launch
times depend on creator decisions. The authored post schedule stayed fixed.

## Reproduction and validation

Run the existing pilot on `V2-PILOT-A`–`F`, for 90 simulated minutes per world.
This command uses the local Real C baseline and the saved CONTROL
`output/engine-v2-sell-fee-reserve/summary.json` from the preceding experiment.
It writes the per-seed results and exact size samples to an ignored directory.
Insert a seed before `--cohorts` to run it independently.

```powershell
node scripts/qa/engine-v2-sell-fee-reserve.mjs `
  output/engine-v2-real-c-baseline output/engine-v2-cohort-rotation-reproduction --cohorts
```

The harness checks six OFF manifests and tapes against the original baseline,
and six CONTROL manifests and tapes against the previous fee reserve experiment.
It compares initial funding agent by agent and asserts that no inactive agent
receives an event, decides, submits or reaches execution. It checks conservation
at all nine sampled times and at the end of every world, and repeats the full
COHORTS run for seed A. `npm run qa:engine-v2` separately tests inactive
admission, activation boundaries, future discovery and checkpoint/replay.

The shared Real C comparison covers the existing STANDARD-compatible cohort,
with known MAYHEM excluded. The first 1,800 seconds of active non-instant curve
paths are compared, censoring at the completion second. Pool fills are excluded
from curve metrics. Last-swap time is measured across the whole world, including
pools, and has no equivalent Real C denominator.
Size percentiles use linear interpolation after pooling the per-seed Float64
samples in lamports and converting to SOL. Empty seconds include the entire
observed pre-completion exposure. Age rows use the number of curve swaps as
their share denominator.
