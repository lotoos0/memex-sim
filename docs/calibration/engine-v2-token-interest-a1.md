# Engine V2 A1: token BUY interest and position exits

Verdict: **REJECT for adoption as the market policy.** The approved fixed five-minute variant is implemented and remains opt-in. It reduces late trading and releases agent capital, but removes **all BUY at token ages 10–30 minutes** in all six seeds, increases early intensity and 80% attainment, and leaves completion unchanged. This is a measured outcome, not a reason to tune the lease or add another repair in this task.

## Implemented contract

The experiment starts from BOUNDED PR #84, `fadb96b8705e9fcf04eb997aef38626931ccf340`. Enable `tokenInterestA1: true` together with `boundedReactive: true` and `sellFeeReserve: true`. A1 rejects configurations missing either prerequisite. Omit the A1 flag for the unchanged baseline. There is no UI switch.

- The first accepted Observe starts a **300,000 ms BUY lease per agent × token**, measured from receipt, not token launch. BUY is allowed only while `now < buyUntil`. There is no token-age cutoff.
- Ordinary observations, trade feedback, own fills, curve progression and ACTIVE transitions never extend the lease. Expired records survive eviction and a fully closed position, so repeated discovery cannot recreate interest.
- Candidates are known tradable tokens with an unexpired lease or available owned atoms, plus SELL-only remembered positions outside `known`. The original scoring, trade/WAIT sampling, side probabilities and sizing formulas remain. An expired selected BUY becomes WAIT, without a forced SELL or another candidate draw. No new RNG calls are introduced; changed candidate sets naturally change subsequent consumption of the existing decision stream.
- `known=16` and its eviction rule remain unchanged. The last genuinely received view, prior and evidence are retained for a held position or pending BUY. This exit memory is never a BUY discovery source and does not subscribe the agent to new feedback outside `known`. A delayed older observation cannot replace a newer retained position view or recreate a watch subscription when it is rejected.
- SELL uses **available ledger atoms**, excluding reservations. Its existing upfront fee, side selection and size remain authoritative. Remembering a position does not guarantee a tradable market, a good quote or sufficient fee funds. Full exit or an unfilled/rejected/cancelled/expired BUY releases the exit view when no owned/reserved atoms or pending BUY remain; the lease tombstone stays.
- A previously decided BUY is not cancelled at interest expiry. It may settle after the deadline under its original order rules. No scheduler, order book, ledger, fee, curve, Social, lifecycle or V1 behavior is changed.

Renewal requires an actually interpreted Discover for a linked narrative and a distinct ORIGINAL or a QUOTE introducing another narrative. The post must be published later than the previous source watermark, not in the future, and less than 300 seconds old at interpretation. The initial watermark is the first receipt time, so an old publication delivered later does not count as fresh news. Duplicate/equal-or-older publications, REPOST, publication alone and trade feedback cannot renew. Existing Discover deduplication remains in force. **No qualifying renewal occurred in the six benchmark seeds.** Synthetic tests exercise the supported renewal path; no new Social events are added to the experiment.

Source trust is limited to the existing simulated post identity, kind, publication time, delivery and narrative link. This is not semantic or external verification that an ORIGINAL contains true new information. A publisher repeatedly inventing new ORIGINAL IDs would require a separate Social provenance policy; this experiment does not add such a publisher or policy.

## Persistence and compatibility

`Agent.tokenInterest` is optional and omitted in OFF. Each entry stores `buyUntil`, the latest source ID/publication watermark and an optional exit observation. The new state, pending tasks and original RNG counters are included in existing checkpoint serialization. No expiration tasks are scheduled. A1 adds the manifest policy `tokenInterest: buy-lease-300s-exit-1`, while leaving the existing agent RNG version key unchanged. An old OFF recording therefore keeps its manifest and state layout; A1 cannot silently masquerade as the old policy.

## Measurement and population

Six existing seeds V2-PILOT-A–F, 100 agents/world, 90 simulated minutes each. CONTROL below means **BOUNDED PR #84 with SELL reserve ON**, not the original unbounded scheduler. No cohorts. The default reserve-OFF baseline and the earlier reserve-ON/unbounded CONTROL are also replayed only as regression checks.

Common market metrics use active, noninstant curve paths at token ages `[0,1800)` seconds, including silent time and censoring at completion including its second. Both variants have exactly **646 launches, 646 active paths, zero no-fill launches, 1,161,188 exposed seconds and 77,520 first-120s exposed seconds**. Thus the result does not improve by deleting untraded paths from the denominator. Exogenous launch schedules, all 18 Social launch timestamps, and first-discovery/narrative timestamp distributions match exactly.

Real C is the existing local 2026-10-15 reference, excluding known MAYHEM and retaining the previous integrity/noninstant filters: 20,278 active paths, 2,058,945 swaps and 36,220,043 exposed seconds. Saved Market Persistence audit aggregates supply comparable age/stage/burst distributions; no Real C data was downloaded or newly reconstructed here. Remaining protocol-label uncertainty and the different population sizes still limit comparison. Raw totals identify populations; rates/shares provide comparisons. No Shrine cohort is used.

Quote amounts exclude fees. Aggregate SOL totals retain integer lamports before conversion for display. Size quantiles pool samples using interpolation. Burst/gap quantiles are empirical p50/p90/p99. Cell progress and inactivity proxy use the opening of each token-second, without lookahead. Idle proxy thresholds are 10/35 seconds since the previous swap (launch is the initial anchor); Real C has no native V2 lifecycle. Window counts use nonoverlapping age-zero-aligned 1/5/10 s windows and omit end-censored partial windows.

The [machine-readable results](engine-v2-token-interest-a1-results.json) retain all age × progress × inactivity cells, marginal flow/exposure/size means, progression, window distributions, manifests, tape hashes and source fingerprints. Local `summary.json` also retains all per-seed diagnostics and per-path burst/gap/window histograms.

## Main comparison

| Metric | BOUNDED control | A1 | Real C |
|---|---:|---:|---:|
| Curve swaps, ages 0–30 min | 342,586 | 329,913 | 2,058,945 |
| Actual agent decisions, full worlds | 1,387,308 | 1,279,392 | N/A |
| Swaps / exposed second, first 120 s | 0.64372 | **1.08562** | 0.46930 |
| Swaps / exposed second, full horizon | 0.29503 | 0.28412 | 0.05685 |
| Empty token-seconds | 78.13% | 79.85% | 98.14% |
| Swaps / active token-second | 1.3490 | 1.4099 | 3.0553 |
| Swap share, age 0–2 min | 14.57% | 25.51% | 55.40% |
| Swap share, age 2–10 min | 39.26% | 52.70% | 32.40% |
| Swap share, age 10–30 min | 46.17% | **21.79%** | 12.20% |
| BUY / SELL counts | 171,389 / 171,197 | 131,595 / 198,318 | 1,102,824 / 956,121 |
| BUY count share | 50.03% | **39.89%** | 53.56% |
| BUY / SELL SOL | 71,384.92 / 65,831.15 | 85,773.53 / 85,649.35 | 465,226.32 / 438,051.34 |
| BUY SOL share | 52.02% | 50.04% | 51.50% |
| Size SOL p10 | 0.002708 | 0.002568 | 0.009778 |
| Size SOL p50 | 0.15827 | **0.29497** | 0.16146 |
| Size SOL p90 | 1.14430 | 1.28375 | 1.09911 |
| Size SOL p99 | 2.68850 | 3.17024 | 3.16049 |
| Reach 80% | 86/646 (13.31%) | **190/646 (29.41%)** | 685/20,278 (3.38%) |
| Reach 90% | 22/646 (3.41%) | 26/646 (4.02%) | 408/20,278 (2.01%) |
| Complete curve | 1/646 (0.155%) | **1/646 (0.155%)** | 203/20,278 (1.00%) |

Total swaps decrease only 3.70%, while common turnover increases from **137,216.07 to 171,422.88 SOL (+24.93%)**. The improvement in late share partly reflects increased young-token activity, not merely stopping late trades. Early intensity rises 68.65% and becomes 2.31× Real C. First-80% attainment more than doubles without additional completions. A global BUY SOL share near Real C masks the complete absence of late BUY.

## Age-specific flow

| Age min | Variant | Swaps | Swaps/exposed s | Empty % | BUY count % | BUY SOL % | Mean size SOL |
|---|---|---:|---:|---:|---:|---:|---:|
| 0–2 | BOUNDED | 49,901 | 0.64372 | 63.66 | 70.39 | 62.86 | 0.65425 |
| 0–2 | A1 | 84,157 | 1.08562 | 38.71 | 71.24 | 65.13 | 0.73074 |
| 0–2 | Real C | 1,140,667 | 0.46930 | 87.44 | 55.63 | 54.46 | 0.50091 |
| 2–10 | BOUNDED | 134,503 | 0.43435 | 69.06 | 51.50 | 49.70 | 0.51290 |
| 2–10 | A1 | 173,860 | 0.56144 | 61.61 | 41.21 | 42.98 | 0.61191 |
| 2–10 | Real C | 667,186 | 0.06893 | 97.46 | 50.86 | 46.33 | 0.35412 |
| 10–20 | BOUNDED | 94,493 | 0.24417 | 80.13 | 43.51 | 46.73 | 0.28662 |
| 10–20 | A1 | 51,978 | 0.13431 | 87.53 | **0** | **0** | 0.06223 |
| 10–20 | Real C | 177,614 | 0.01473 | 99.30 | 51.46 | 46.49 | 0.38163 |
| 20–30 | BOUNDED | 63,689 | 0.16457 | 86.29 | 40.63 | 46.13 | 0.13345 |
| 20–30 | A1 | 19,918 | 0.05147 | 95.00 | **0** | **0** | 0.01528 |
| 20–30 | Real C | 73,478 | 0.00610 | 99.68 | 51.11 | 46.88 | 0.37906 |

Late swaps fall **158,182 → 71,896 (−54.55%)**, but all 71,896 are SELL. At 20–30 minutes every A1 fill belongs to the opening 0–20% curve stage; its conditional rate remains **65.5× Real C** in that age/stage cell. The mechanism has no global age predicate, and tests demonstrate first interest in an old token is allowed. Nevertheless, early discovery plus no later independent impulses makes it **effectively suppress all old-token BUY in this population**. That realizes the design's liquidity-cliff risk and fails the intended market-realism requirement.

## SELL access, rejections and unfilled decisions

Counts below cover the complete six worlds, including pool fills and ages outside the common 30-minute cohort; overlapping counters must not be added as independent contributions.

| Diagnostic | BOUNDED | A1 |
|---|---:|---:|
| BUY attempts / executed | 205,654 / 204,297 | 133,642 / 131,743 |
| SELL attempts / executed | 220,929 / 219,882 | 212,417 / 209,169 |
| BUY execution rejects: SLIPPAGE | 1,349 | 1,899 |
| SELL execution rejects: SLIPPAGE | 1,022 | 1,495 |
| SELL execution rejects: DUST_OR_LIQUIDITY | 3 | **1,752** |
| Pending orders at 90 min | 8 BUY / 22 SELL | 0 BUY / 1 SELL |
| Selected expired known BUY → WAIT | N/A | 168,689 |
| Selected exit-only BUY → WAIT | N/A | 83,130 |
| Above WAITs with another unexpired tradable known candidate | N/A | 200,593 |
| WAIT with no eligible known or exit market | N/A | 144,279 |
| SELL fills from outside-known position memory | N/A | **43,884** |
| SELL fills whose decision followed lease expiry | N/A | 134,907 |
| Previously decided BUY filling after lease expiry | N/A | 149 |
| Qualifying interest renewals | N/A | **0** |

Attempt accounting reconciles exactly: attempts = fills + rejections + pending orders. There are no admission rejects in these runs. An interested alternative is only a potential candidate, not a promised funded/executable BUY. No-eligible WAIT includes any lack of candidates; it is not presented as an isolated causal attribution to expiry.

The exit-memory result is a **separate approved change in SELL access within A1**. It recovers eligibility for positions previously excluded by `known`, while preserving the existing side probabilities and fee/settlement rules. Its contribution cannot be separated causally from the BUY lease without another experiment, which was not run. SELL is never mechanically substituted for a blocked BUY. The full-world dust/liquidity rejects demonstrate that eligibility does not guarantee successful liquidation.

## Capital and positions over time

Available SOL excludes order reservations and sums all 600 agents. Positions are agent × token pairs with positive available or reserved atoms; tiny/dust positions count. No capital is minted or transferred by A1. Conservation is asserted at every sample and at each run's end.

| Sim min | BOUNDED available SOL | A1 available SOL | BOUNDED positions outside known | A1 positions outside known |
|---|---:|---:|---:|---:|
| 0 | 6975.000 | 6975.000 | 0 | 0 |
| 5 | 3665.777 | 3665.777 | 0 | 0 |
| 10 | 2102.154 | 3816.355 | 37 | 29 |
| 15 | 1053.284 | 3592.247 | 1198 | 591 |
| 20 | 504.816 | 3427.809 | 3372 | 1279 |
| 30 | 132.428 | 3248.821 | 7724 | 1994 |
| 45 | 27.390 | 3033.073 | 13113 | 2556 |
| 60 | 10.435 | 2813.989 | 18163 | 3064 |
| 90 | **9.205** | **4793.651** | 18163 | 45 |

At 90 minutes BOUNDED has 600 holders and 25,347 positions; A1 has **48 holders and 69 positions**, all expired, with zero sampled outside-known positions missing exit memory. Remaining A1 reserved SOL is 0.000005 (one pending SELL fee). Transaction-fee collectors hold **2.132765 vs 1.730290 SOL**, and swap-fee collectors **1791.754419 vs 2160.225763 SOL**. These collector totals cover the full worlds. Lower transaction count does not imply lower turnover or swap fees. The much higher available SOL is recovered/retained capital, not newly issued SOL.

## Burst and progression checks

| Metric | BOUNDED | A1 | Real C |
|---|---:|---:|---:|
| Active-series length p50/p90/p99 s | 1/3/7 | 1/3/9 | 1/4/18 |
| Internal empty-gap p50/p90/p99 s | 2/8/25 | 3/15/51 | 3/44/604 |
| Empty 5 s windows | 45.25% | 48.30% | 95.77% |
| Empty 10 s windows | 35.01% | **31.82%** | 94.21% |
| Paths with ≥300 s terminal silence | 46.44% | **6.50%** | 91.82% |
| Nonempty 10 s count p50/p90/p99 | 4/8/23 | 2/10/23 | 3/26/91 |

Reduced late count does not reproduce market abandonment: the preserved exit candidates generate a long tail of small SELL fills across many paths. Terminal silence becomes substantially worse, despite fewer late fills. Internal-gap quantiles exclude censored leading/trailing time, while terminal silence is reported separately. This is not evidence that SELL eligibility should simply be removed.

All **190 A1 paths reaching 80%** and **26 reaching 90%** retreat below the threshold at least once; one later completes. At +120 s after first crossing, 44/190 and 3/26 are above their crossing progress, while 146/190 and 23/26 are below. None has no later fill. There is progression and reversal, but much more 80% attainment does not translate to successful completion. Completion remains only one observation, so a stable rate cannot be estimated.

| Seed | BOUNDED swaps | A1 swaps | A1 reach 80 / 90 / complete | A1 last world swap ms |
|---|---:|---:|---|---:|
| A | 56,139 | 54,547 | 27 / 4 / 0 | 5,352,323 |
| B | 55,632 | 55,064 | 32 / 4 / 1 | 5,355,898 |
| C | 57,167 | 54,835 | 28 / 3 / 0 | 5,382,516 |
| D | 59,536 | 56,485 | 44 / 6 / 0 | 5,397,576 |
| E | 58,105 | 53,934 | 31 / 5 / 0 | 5,392,067 |
| F | 56,007 | 55,048 | 28 / 4 / 0 | 5,373,709 |

Last-swap time is not a claim of healthy market participation. A1's residual activity near the 90-minute cutoff is compatible with only 48 holders remaining across six worlds and no renewed BUY in old tokens.

## Validation

- All six original reserve-OFF manifests, compact tape hashes and benchmark summaries match 1:1. All six earlier reserve-ON/unbounded CONTROL manifests and compact/full tape hashes match. All six BOUNDED manifests, compact/full tape hashes, decisions, summaries and launch schedules match PR #84.
- Each A1 seed is run twice with exact full-result equality. A separate **uninstrumented** build reruns all six A1 seeds: both hashes, manifests, decisions, facts, pool fills, summaries and launch schedules match the diagnostic build. The sole source injection observes the expired BUY branch without changing its return or RNG.
- Periodic execution count is **462,254 in both variants**; each seed's entire periodic-gap histogram is identical. Min actual decision gap remains 2000 ms. Bootstrap remains 600 decisions. No stale decision tasks occur. Scheduled = executed + stale + queued. Pre-expiry economic snapshots at minutes 0 and 5 match exactly.
- `npm run qa:engine-v2`: PASS, including lease boundaries, rediscovery, old-token first interest, duplicate/stale/future/repost rejection, linked Discover renewal, publication-only rejection, unforced SELL, fee admission, outside-known exits, reservations, pending BUY expiry, history pruning and orphan expiration, checkpoint/replay and conservation. Original fixture hashes remain `f8092dfbdd7be89f` / `edd06a22c30a0ffe`.
- `node scripts/qa/engine-v2-market-persistence-metrics.test.mjs`: PASS for exposure, no lookahead, series/gaps, window histograms, native-state exposure, crossing exclusion and completion censoring. Age/progress/idle/cross marginals reconcile with common totals; all size sample checksums are verified.
- `npm run qa:sim:market-baseline:check`: PASS (415 trade OHLC checks, 11,489 OHLC comparisons, baseline metrics, official curve and SIM-01). `npm run lint`: PASS with five existing hook warnings. `npm run build`: PASS with the existing bundle-size warning. Script syntax checks and `git diff --check`: PASS.

V1 browser dead-floor/quick-limit launchers were not run: they install a CLI package and manipulate shared browser sessions; this task adds no dependency/download or UI flow and keeps V1 unchanged. No browser or remote CI success is claimed. No new PR, push or merge is performed under this implementation approval.

## Reproduce and review boundary

Run from the repository root with existing dependencies and existing local references: `output/engine-v2-real-c-baseline/{v2-runs,metrics}.json`, `output/engine-v2-sell-fee-reserve/summary.json`, `output/engine-v2-bounded-reactive/summary.json`, and `output/engine-v2-persistence-audit/summary.json`. Missing inputs are an error; nothing is downloaded. Use a fresh output directory because capture and summary refuse overwriting their main artifacts:

```powershell
$interestOut = 'output/engine-v2-interest-a1-rerun'
foreach ($letter in @('A','B','C','D','E','F')) {
  node --max-old-space-size=1600 scripts/qa/engine-v2-interest-a1.mjs output/engine-v2-real-c-baseline $interestOut "V2-PILOT-$letter"
  if ($LASTEXITCODE -ne 0) { throw "Failed seed $letter" }
}
node --max-old-space-size=1600 scripts/qa/engine-v2-interest-a1-summary.mjs $interestOut
```

The final measurement is in `output/engine-v2-interest-a1-final/`; preliminary captures are not the reported reference. Measurements were made on the A1 working tree based on PR #84; exact engine-input hashes identify the implementation beyond the base revision. The committed compact results equal generated `results.json`. Full tapes, databases and binary size samples remain untracked. The harness reuses `measure()` and the existing BOUNDED accounting/scheduling instrumentation; it does not introduce a new simulation framework.

**Review decision:** retain the opt-in result as evidence and reject promotion of A1. The late-BUY cliff, increased launch-age intensity, worse median size and terminal silence outweigh the capital-access and late-count improvements. Any softer interest model or other repair requires a new design review and isolated experiment; none is implemented or selected here.
