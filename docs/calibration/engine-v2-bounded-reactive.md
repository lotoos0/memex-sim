# Engine V2 bounded reactive wake experiment

Verdict: **REWORK**. The fixed 2,000 ms bound removes CONTROL's feedback storm and produces a much more realistic median transaction size. It does not reproduce market sparsity, age distribution, active-second clustering or curve completion. Keep this opt-in experiment for diagnosis; do not promote it to the default scheduler or tune another cooldown from these results.

## Scope and scheduler contract

Based on main `b0857fedb579dd2980d9382e4b8565b30302d3c6` after PR #81. [PR #83](https://github.com/lotoos0/memex-sim/pull/83) was read first: TIMER_ONLY reduced early intensity below Real C and received REWORK. Its saved six-seed measurements are used unchanged, not reimplemented or merged into this branch. Its measured revision and input-summary checksum are retained in [the machine-readable results](engine-v2-bounded-reactive-results.json).

All three variants have 100 agents and `sellFeeReserve: true`, unchanged deterministic initial balances and nine simulated hours in total (six seeds, 90 minutes each). There is no cohort rotation. The original reserve-OFF variant is run only as a regression check. No policy, transaction sizing, Social schedule, execution, curve, lifecycle or V1 changes are included.

BOUNDED is `WorldConfig.boundedReactive: true`; omit it for OFF. It has two separate pending decision channels per agent:

- The first eligible Observe/Discover bootstraps one decision at the existing `now + 1 ms`, then starts the ordinary periodic cycle. Later information continues updating knowledge and narratives.
- Periodic deadlines keep their independent 4,500–9,499 ms draws in the baseline session. Reactive execution makes no timer RNG draw and never moves or cancels that deadline.
- Information requests a reaction no earlier than `max(now + 1, lastActualDecision + 2000)`. Further impulses coalesce into that pending reaction.
- **Periodic priority:** a proposed reaction less than 2,000 ms before the next periodic deadline is serviced by that periodic decision instead. This is necessary to keep both the minimum actual-decision gap and the unchanged periodic deadline. The periodic decision sees all intervening information. Equality at exactly 2,000 ms is allowed. At an exact task collision only the periodic decision executes, regardless of insertion order.

There is no global time grid. The fixed cooldown is the only new experiment parameter. The optional channel state, generations and last execution time are checkpointed; the opt-in config changes the manifest hash. OFF adds no serialized default flag or agent state. Existing session-override behavior is unchanged; no override is used here.

## Comparable population and definitions

Use the existing local Real C baseline (2026-10-15), not Shrine. Real C excludes known MAYHEM; incompletely labeled protocols remain a data limitation. Select active, noninstant curve paths, ages `[0, 1800)` seconds, and stop exposure at curve completion, including its second. V2 launches end at 60 minutes, leaving the full 30-minute observation horizon in a 90-minute run. Post-curve/pool fills are excluded from the common population.

Rates pool numerators and exposure denominators across seeds, rather than averaging per-seed rates. Empty seconds include the entire exposed horizon, even when a token stops trading. Active-second intensity is swaps divided by nonempty token-seconds. Early intensity uses exposed token-seconds in ages `[0,120)`. BUY volumes and sizes use SOL excluding fees. Curve thresholds count paths that ever reach 80%, 90% and completion in the observation horizon. Size quantiles use pooled samples with linear interpolation; decision-gap quantiles use the empirical nearest rank. Decision gaps cover all agents and the entire run, not just early token ages.

Real C is a full-day reference with 20,278 eligible paths; V2 is six small independent synthetic worlds. Raw totals are reported to identify the populations, not as equivalent market sizes. The known MAYHEM exclusion cannot establish that every remaining Real C path is STANDARD. Calendar times and agent decisions cannot be compared to Real C, which has no agent scheduler traces.

## Market results

| Metric | CONTROL | TIMER_ONLY (#83) | BOUNDED | Real C |
|---|---:|---:|---:|---:|
| Eligible paths | 645 | 644 | 646 | 20,278 |
| Curve swaps, ages 0–30 min | 3,874,110 | 103,537 | 342,586 | 2,058,945 |
| Swaps / exposed second, first 120 s | 7.3793 | 0.2166 | **0.6437** | 0.4693 |
| Swaps / exposed second, full horizon | 3.3369 | 0.0893 | 0.2950 | 0.05685 |
| Empty token-seconds | 52.45% | 92.13% | **78.13%** | 98.14% |
| Swaps / active token-second | 7.0176 | 1.1356 | **1.3490** | 3.0553 |
| Swap share, age 0–2 min | 14.74% | 16.17% | 14.57% | 55.40% |
| Swap share, age 2–10 min | 46.46% | 39.48% | 39.26% | 32.40% |
| Swap share, age 10–20 min | 28.57% | 26.63% | 27.58% | 8.63% |
| Swap share, age 20–30 min | 10.23% | 17.71% | 18.59% | 3.57% |
| Swap share, age 10–30 min | 38.80% | 44.35% | **46.17%** | 12.20% |
| BUY / SELL count | 1,631,867 / 2,242,243 | 58,999 / 44,538 | 171,389 / 171,197 | 1,102,824 / 956,121 |
| BUY share by count | 42.12% | 56.98% | **50.03%** | 53.56% |
| BUY / SELL SOL | 262,191.28 / 261,831.56 | 30,527.88 / 23,742.04 | 71,384.92 / 65,831.15 | 465,226.32 / 438,051.34 |
| BUY share by SOL | 50.03% | 56.25% | **52.02%** | 51.50% |
| Size SOL p10 | 0.0000508 | 0.01418 | 0.002708 | 0.009778 |
| Size SOL p50 | 0.005506 | 0.29625 | **0.15827** | 0.16146 |
| Size SOL p90 | 0.41213 | 1.28375 | 1.14430 | 1.09911 |
| Size SOL p99 | 1.48125 | 2.94734 | 2.68850 | 3.16049 |
| Reach 80% | 64 (9.92%) | 64 (9.94%) | **86 (13.31%)** | 685 (3.38%) |
| Reach 90% | 27 (4.19%) | 12 (1.86%) | 22 (3.41%) | 408 (2.01%) |
| Complete curve | 0 | 0 | **1 (0.15%)** | 203 (1.00%) |

The BOUNDED completion occurs in seed B. One completion is insufficient to estimate a stable completion rate. Threshold attainment is counted within the same active-path population; it is not a completion percentage across all launches.

## Scheduling and coalescing

Counts below are across six complete 90-minute runs. World fills include pool fills and curve fills outside the common age window.

| Diagnostic | CONTROL | TIMER_ONLY | BOUNDED |
|---|---:|---:|---:|
| Actual decisions | 16,610,108 | 462,854 | **1,387,308** |
| Actual bootstrap (Observe / Discover) | 385 / 215 | 385 / 215 | 385 / 215 |
| Actual periodic decisions | 97,631 | 462,254 | **462,254** |
| Actual reactive decisions | 16,511,877 | 0 | **924,454** |
| Decisions / agent / simulated minute | 307.59 | 8.57 | 25.69 |
| All executed world swaps | 4,024,070 | 129,447 | 424,179 |
| Stale-generation decision tasks executed without decision | 16,511,044 | 0 | **0** |
| Pending periodic / reactive tasks at cutoff | 1,433 / — | 600 / 0 | **600 / 292** |
| Actual gap ms p10 / p50 / p90 / p99 | 15 / 90 / 312 / 2257 | 5000 / 6999 / 8996 / 9450 | **2000 / 2000 / 3334 / 3925** |
| Minimum actual gap ms | 2 | 4500 | **2000** |

CONTROL's queued periodic count includes stale tasks. BOUNDED has 12,226,896 post-bootstrap information impulses: 6,074,668 merge into an already pending reaction; 5,227,482 are serviced by an upcoming periodic deadline; 924,746 schedule reactions (924,454 executed, 292 still pending). Thus **92.44%** of impulses create no additional task. These two coalescing categories are reported separately so periodic servicing is not presented as a reactive execution. There are never more than one valid periodic and one pending reactive task per agent.

All 462,254 BOUNDED periodic executions retain the timer distribution; successive periodic gaps p10/p50/p90/p99 are 5000/6999/8996/9450 ms, with every gap in 4500–9499 ms. These match TIMER_ONLY's decision-gap distribution. Periodic draws are independent of the extra reactive execution stream; policy RNG still changes naturally as decision ordinals change. No RNG algorithm or policy draw rule was modified.

## Sustained activity, cash and discovery

Available SOL sums the six worlds' 600 agent accounts; reserved SOL is excluded, not destroyed. Conservation is asserted at every sample. Initial agent SOL is 6,975 in all variants.

| Simulated minute | CONTROL SOL | TIMER_ONLY SOL | BOUNDED SOL |
|---|---:|---:|---:|
| 0 | 6975.000 | 6975.000 | 6975.000 |
| 5 | 1571.381 | 4156.751 | 3665.777 |
| 10 | 95.075 | 2891.991 | 2102.154 |
| 15 | 28.345 | 1672.991 | 1053.284 |
| 20 | 9.252 | 988.113 | 504.816 |
| 30 | 4.526 | 285.150 | 132.428 |
| 45 | 3.007 | 46.880 | 27.390 |
| 60 | 2.916 | 20.122 | 10.435 |
| 90 | 2.909 | 17.266 | 9.205 |

| Seed | CONTROL last swap ms | TIMER_ONLY last swap ms | BOUNDED last swap ms | BOUNDED early intensity |
|---|---:|---:|---:|---:|
| A | 5,396,805 | 5,399,972 | 5,399,972 | 0.6548 |
| B | 5,398,537 | 5,399,680 | 5,399,962 | 0.6224 |
| C | 5,372,018 | 5,399,912 | 5,399,797 | 0.6465 |
| D | 5,391,857 | 5,399,920 | 5,399,995 | 0.6695 |
| E | 5,395,334 | 5,399,840 | 5,399,962 | 0.6291 |
| F | 5,393,654 | 5,399,982 | 5,399,808 | 0.6399 |

These last-fill times demonstrate activity at the 5,400,000 ms cutoff, not correctness of intensity throughout the run. The age/exposure table includes inactive time and reveals persistent overactivity at older ages.

All variants make the same 18 Social launches (three per seed), but changing decision timing changes their execution times: CONTROL 2741–9216 ms, TIMER_ONLY 2797–18074 ms, BOUNDED 2797–10955 ms. The exogenous baseline launch schedule is identical per seed, asserted by the runner. No posts, exposures or discovery rules were changed.

First market observation p50/p90/p99 across agents is 653/10687/75329.65 ms for CONTROL, 653/13451.3/87215.7 for TIMER_ONLY and 653/11389.4/85926.88 for BOUNDED. First interpreted narrative p50/p90/p99 remains identical: 6662/10778.8/89982.46 ms. These are first-per-agent timestamps, not a per-token discovery latency estimate. Endogenous changes in Social launches and feedback explain why first market observation can move without changing discovery code.

## Interpretation and next step

1. Early intensity falls 91.28% from CONTROL, from 15.72× to **1.37× Real C**. All six BOUNDED seeds remain above Real C. This makes early execution less frantic, but does not by itself establish realism.
2. Median size differs from Real C by about **−1.98%**, and BUY SOL share differs by +0.52 percentage points. Less fee-consuming churn preserves purchasing capacity longer without extra capital. The lower tail remains too small and BUY count share is still −3.53 points.
3. Market sparsity remains wrong: empty-second share is **20.01 percentage points below Real C**, worse than TIMER_ONLY's gap. Full-horizon intensity is **5.19× Real C**. Traders still encounter an unusually continuous market.
4. Activity clustering remains too weak: **1.35 vs 3.06 swaps per active second**. The per-agent bound smooths trading, even though the early mean rate is closer. It must not be accepted solely on swap-count reduction.
5. Activity is too persistent at older token ages: **46.17% vs 12.20%** at 10–30 minutes, worse than both predecessors. Reaching 80% is too common (13.31% vs 3.38%), while completion remains rare. Trading paths offer excess sustained liquidity without reproducing real successful progression.

Recommended next step: review why the unchanged policy/discovery/lifecycle combination sustains old-token turnover and fails to concentrate activity into short bursts, using these fixed results. Treat that as a separate diagnostic decision before any new behavior experiment. Do not sweep cooldowns or automatically apply another repair. The present evidence supports retaining BOUNDED as an experimental scheduler, not accepting it as a calibrated market model.

## Validation and reproduction

Checks actually run:

- `npm run qa:engine-v2`: PASS, including bootstrap, coalescing, information updates, immutable periodic deadline/generation, periodic-first collision in reverse insertion order, pending-channel checkpoint/restore, deterministic replay and ledger conservation. Original fixture hashes remain `f8092dfbdd7be89f` / `edd06a22c30a0ffe`.
- Six seeds: OFF manifests, compact tape hashes, summaries, decision/fact counts and launch schedules match the original baseline 1:1. CONTROL manifests, compact and full tape hashes and summaries match the SELL reserve experiment 1:1.
- Each BOUNDED seed is run twice: full measurement objects, both tape hashes, RNG-derived launch schedule and manifests match exactly. Every actual gap is at least 2000 ms, every periodic interval is within the original range, and every information/reactive callback preserves the pending periodic deadline. Scheduled = executed + stale + queued; order attempts = fills + rejections + pending orders.
- `npm run qa:sim:market-baseline:check`: PASS (415 trade-OHLC checks, 11,489 OHLC comparisons, market metrics, official curve and SIM-01).
- `npm run lint`: PASS with five pre-existing React-hook warnings. `npm run build`: PASS with the existing bundle-size warning. `git diff --check`: PASS.

The V1 browser dead-floor and quick-limit launchers were not run locally: they invoke package installation and shared Playwright browser sessions; this task forbids new downloads and leaves V1 unchanged. No UI change requires manual UI verification. Browser checks remain available in CI; local results above do not claim they passed.

Use the existing local baseline directories. No raw data is committed. From the repository root, with installed dependencies, choose a **fresh output directory** (the runner refuses overwriting artifacts):

```powershell
$boundedOut = 'output/engine-v2-bounded-reactive-rerun'
foreach ($letter in @('A', 'B', 'C', 'D', 'E', 'F')) {
  node --max-old-space-size=1400 scripts/qa/engine-v2-bounded-reactive.mjs output/engine-v2-real-c-baseline $boundedOut "V2-PILOT-$letter"
  if ($LASTEXITCODE -ne 0) { throw "Failed seed $letter" }
}
node --max-old-space-size=1200 scripts/qa/engine-v2-bounded-summary.mjs $boundedOut
```

The saved CONTROL reference is `output/engine-v2-sell-fee-reserve/summary.json`; TIMER_ONLY is `output/engine-v2-timer-only/summary.json` plus its six `*-timer-sizes.bin` files. The summary verifies all input fingerprints and size-sample checksums, and emits `summary.json` (full local diagnostics) and `results.json` (compact aggregate evidence). The committed results retain the measured engine input fingerprints, baseline revision, all variant manifests and tape hashes. They are aggregate diagnostics, not a raw market dataset. Reproduction requires these pre-existing local artifacts; it does not download missing inputs.
