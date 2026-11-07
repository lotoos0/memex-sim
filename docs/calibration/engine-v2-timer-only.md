# Engine V2 timer-only experiment

CONTROL uses the existing reactive scheduler and SELL fee reserve ON.
TIMER_ONLY uses the same fee reserve and adds `timerOnly: true`. An absent flag
preserves the original configuration and manifest. Both variants use 100 agents,
the original capital, Social ON and no cohort rotation.

The first eligible Observe or Discover schedules a bootstrap decision at the
existing one-millisecond wake delay. Once an agent has a scheduled decision,
information events keep that deadline. The executed decision schedules its next
timer through the existing 4,500–9,499 ms draw. Observe continues to update market
knowledge and Discover continues to update narrative state. The checkpoint
stores the configuration, current deadline, generation and queued task.

## Verdict · REWORK

TIMER_ONLY removed reactive amplification and brought several market measures
closer to Real C. It also overshot the reduction in trading within active
seconds, retained an excessive share of late-age trades and produced no
completions. Keep it opt-in while evaluating the remaining differences.

| World-level decision metric, six seeds | CONTROL | TIMER_ONLY |
| --- | ---: | ---: |
| Actual decisions | 16,610,108 | 462,854 |
| Bootstrap from Observe / Discover | 385 / 215 | 385 / 215 |
| Later reactive decisions | 16,511,877 | 0 |
| Executed periodic decisions | 97,631 | 462,254 |
| Stale decision tasks processed | 16,511,044 | 0 |
| Decision tasks queued at the horizon | 1,433, including 833 stale | 600, all current |
| Decisions per agent per simulated minute | 307.595 | 8.571 |
| Gap between actual decisions, p10 / p50 / p90 / p99 (ms) | 15 / 90 / 312 / 2,257 | 5,000 / 6,999 / 8,996 / 9,450 |
| Executed swaps, all token ages and venues | 4,024,070 | 129,447 |

Decision counts fell 97.21% and executions fell 96.78%. Every agent bootstrapped
once. All observed TIMER_ONLY intervals after bootstrap were within the original
4,500–9,499 ms range. These scheduler checks are independent of agreement with
Real C.

| Common curve metric | Real C | CONTROL | TIMER_ONLY |
| --- | ---: | ---: | ---: |
| Active non-instant paths | 20,278 | 645 | 644 |
| Swaps | 2,058,945 | 3,874,110 | 103,537 |
| First 120 s, swaps per exposed token-second | 0.469 | 7.379 | 0.217 |
| Age 0–2 min, swap share | 55.40% | 14.74% | 16.17% |
| Age 2–10 min, swap share | 32.40% | 46.46% | 39.48% |
| Age 10–20 min, swap share | 8.63% | 28.57% | 26.63% |
| Age 20–30 min, swap share | 3.57% | 10.23% | 17.71% |
| Empty exposed token-seconds | 98.14% | 52.45% | 92.13% |
| Swaps per active token-second | 3.055 | 7.018 | 1.136 |
| Swaps per exposed token-second | 0.057 | 3.337 | 0.089 |
| BUY share by count / fee-exclusive SOL | 53.56% / 51.50% | 42.12% / 50.03% | 56.98% / 56.25% |
| Swap quote SOL, p10 / p50 | 0.009778 / 0.161459 | 0.000051 / 0.005506 | 0.014183 / 0.296250 |
| Swap quote SOL, p90 / p99 | 1.099112 / 3.160494 | 0.412129 / 1.481250 | 1.283750 / 2.947337 |
| Paths reaching 80% | 685 (3.38%) | 64 (9.92%) | 64 (9.94%) |
| Paths reaching 90% | 408 (2.01%) | 27 (4.19%) | 12 (1.86%) |
| Paths completing the curve | 203 (1.00%) | 0 (0.00%) | 0 (0.00%) |
| BUY / SELL fee-exclusive turnover (SOL) | 465,226.32 / 438,051.34 | 262,191.28 / 261,831.56 | 30,527.88 / 23,742.04 |

**Improvements.** Empty seconds, overall exposed-second intensity, the BUY count
share and all four size percentiles moved closer to Real C. The 90% entrant
share also approached the reference. The median quote increased from 0.005506
to 0.296250 SOL while capital remained available for longer. This replaces much
of the CONTROL turnover in very small prints with fewer, larger transactions.

**Remaining errors and regressions.** First-120-second intensity fell below
Real C, while trades per active second fell from above the reference to less
than half of it. Trades at ages 10–30 min increased from 38.80% to 44.35%, versus
12.20% in C. BUY volume share moved farther away, the 80% entrant share remained
about three times the reference, and no curve completed. Sparse trading and
realistic clustering are separate requirements. Smaller counts alone do not
establish realism or similar limit-order execution opportunities.

| Minute | Agent SOL available CONTROL | Agent SOL available TIMER_ONLY |
| ---: | ---: | ---: |
| 0 | 6,975.000 | 6,975.000 |
| 5 | 1,571.381 | 4,156.751 |
| 10 | 95.075 | 2,891.991 |
| 15 | 28.345 | 1,672.991 |
| 20 | 9.252 | 988.113 |
| 30 | 4.526 | 285.150 |
| 45 | 3.007 | 46.880 |
| 60 | 2.916 | 20.122 |
| 90 | 2.909 | 17.266 |

| Seed | Last swap CONTROL | Last swap TIMER_ONLY |
| --- | ---: | ---: |
| A | 89:56.805 | 89:59.972 |
| B | 89:58.537 | 89:59.680 |
| C | 89:32.018 | 89:59.912 |
| D | 89:51.857 | 89:59.920 |
| E | 89:55.334 | 89:59.840 |
| F | 89:53.654 | 89:59.982 |

Both variants traded near the 90-minute boundary. Persistence beyond the
observation horizon remains unmeasured.

Each variant launched 628 ordinary tokens on identical per-seed schedules and
18 Social tokens. Thirteen Social launch timestamps changed across the six
seeds, with delays of up to 15.333 s. The authored post schedule was unchanged.
First market observation remained available to all 600 agents. Its median was
0.653 s in both variants, while p90 moved from 10.687 to 13.451 s and maximum
from 113.495 to 141.150 s. First narrative discovery covered the same 575 agents,
with the same median 6.662 s and p90 10.779 s. Social launch timing remains an
endogenous consequence of decisions, so it can change under this experiment.

The next step is a separately scoped experiment with a bounded reactive wake
channel that preserves the single periodic timer. The active-second intensity
and early-age deficits motivate that comparison. It should measure clustering
and age distribution alongside completion and BUY/SELL balance. No new wake
parameter was selected or tested here.

## Measurement and reproduction

The existing pilot harness runs six seeds (`V2-PILOT-A`–`F`) for 90 simulated
minutes each. The runner reads the saved original OFF baseline and the preceding
SELL fee reserve CONTROL from local output directories. Pass a fresh output
directory. An optional final seed argument supports independent runs.

```powershell
node scripts/qa/engine-v2-timer-only.mjs `
  output/engine-v2-real-c-baseline output/engine-v2-timer-only-reproduction
```

The runner verifies all six OFF manifests and compact tapes, and all six CONTROL
manifests and compact/full tapes. It repeats every TIMER_ONLY world and compares
the full measurements and both tape hashes. Instrumentation distinguishes
bootstrap, reactive and periodic decisions, stale tasks and tasks still queued
at the horizon. It checks conservation at nine sampled times and the end of each
world, and verifies that TIMER_ONLY has one current task per agent with no
reactive rescheduling. `npm run qa:engine-v2` separately tests both bootstrap
paths, knowledge and narrative updates without deadline changes, and
checkpoint/replay timing.

Real C uses the previous STANDARD-compatible active non-instant cohort, with
known MAYHEM excluded. Curve metrics cover token ages `[0, 1800)`, censoring at
the completion second. Empty seconds count as exposure. Pool fills are excluded
from these curve metrics. World-level decision totals and last-swap times cover
the full 90-minute run and include pool activity where present. Real C provides
no comparable internal agent decisions or decision intervals.
