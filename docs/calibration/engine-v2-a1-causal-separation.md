# A1 causal separation: EXIT × LEASE

The controlled 2×2 comparison is complete. **The late-BUY cliff belongs to LEASE; EXIT restores liquidation access and changes BUY through the shared candidate pool and subsequent market feedback. Their aggregate BUY effects are strongly nonadditive.** This does not propose another interest policy or change the A1 REJECT verdict.

## Fixed experiment and compatibility

Local base: `cb19c064a700f261a0d6b747090be9dd92148657`; BOUNDED reference: PR #84 `fadb96b8705e9fcf04eb997aef38626931ccf340`. All variants use BOUNDED, SELL fee reserve ON, the original 100 agents and deterministic balances, V2-PILOT-A–F, 90 simulated minutes per seed. No cohort rotation or changes to parameters, Social, fees, order sizing, lifecycle, curve, execution or V1.

| Variant | EXIT | LEASE | Config in addition to boundedReactive/sellFeeReserve |
|---|---|---|---|
| BOUNDED | OFF | OFF | No additional flag |
| EXIT_ONLY | ON | OFF | `tokenExitOnly: true` |
| LEASE_ONLY | OFF | ON | `tokenLeaseOnly: true` |
| A1 | ON | ON | Original `tokenInterestA1: true` |

The three variant flags are mutually exclusive and require both BOUNDED and SELL reserve. They are not silently normalized. BOUNDED and A1 retain their original serialized configuration, manifests and state layouts. EXIT_ONLY has optional `exitMemory`, no leases; LEASE_ONLY has lease records without exit views. New manifest policy IDs are `exit: position-exit-only-1` and `tokenInterest: buy-lease-300s-only-1`. The old A1 policy ID and all RNG versions remain unchanged. Missing flags stay omitted, not serialized as false.

LEASE retains the existing **300,000 ms** receipt-based deadline, expired-pair tombstones, original Discover renewal rules, candidate filtering and expired BUY → WAIT. Ordinary feedback does not renew it. EXIT retains the existing position/pending-BUY view cache, cached-view freshness handling, outside-known SELL qualification and cache cleanup. No parameter or scoring rule is added.

In particular, EXIT_ONLY keeps ordinary BUY eligibility for tokens in `known`, but **never permits BUY from an exit-only view**. Such a selected BUY branch returns WAIT. SELL probabilities, sizes and upfront fees are unchanged, and there is no reroll or forced SELL. LEASE_ONLY intentionally leaves owned tokens outside `known` unavailable to the agent policy. This is the control factor being isolated, not a defect repaired inside that variant.

EXIT is not neutral to BUY: cached positions participate in the original common candidate pool, scoring and narrative-count calculation. Changed candidates also change consumption of the existing decision RNG stream and subsequent balances/feedback. The experiment measures this complete EXIT package; it does not pretend to isolate candidate displacement from all its downstream consequences.

## Population and measurement

Primary market tables use active, noninstant curve paths, token ages `[0,1800)` seconds, with exposure through completion including its second. **All four variants have the same 646 launches, 646 active paths, zero no-fill launches, 1,161,188 exposed seconds and 77,520 exposed first-120s seconds.** Thus population loss does not explain the differences. Original exogenous launch schedules are asserted per seed; all 18 Social launch times and first market/narrative discovery distributions also match.

Early intensity means the first 120 seconds of **each token**, including tokens launched later in the run. Economic snapshots at global minutes 0 and 5 match exactly across all variants; this is compatible with different pooled early-token intensity later on.

SOL is quote excluding fees. Engine quantities and common quote totals remain integer atoms/lamports; cell aggregates and statistical rates are used for display. Positions count agent × token pairs with positive **available + reserved** atoms, including dust. Full exit means that total reaches zero after an executed SELL, not merely that an order closes. Exit counts are closure events, not unique token pairs, because a position may reopen.

Burst series are consecutive nonempty token-seconds; gaps exclude censored leading/trailing silence. Windows are nonoverlapping, age-zero aligned, with partial final 5/10 s windows omitted. Quantiles are pooled empirical p50/p90/p99. Age × curve-stage × inactivity cells use opening-second progress and the same 10/35-second inactivity proxy as the previous audit, without lookahead.

Existing Real C aggregates provide context only; Real C is not a treatment cell or a tuning target. The previous known-MAYHEM exclusions, integrity filters and protocol-label limitations still apply. No data was downloaded or newly reconstructed. All comparisons and contrasts are preserved in [compact results](engine-v2-a1-causal-separation-results.json), including per-seed contrasts, exposure/flow cells, sample times, manifests, hashes and source fingerprints. Full per-path histograms remain in local `summary.json`.

## Main outcomes

| Metric | BOUNDED | EXIT_ONLY | LEASE_ONLY | A1 |
|---|---:|---:|---:|---:|
| Common curve swaps | 342,586 | 381,895 | 346,866 | 329,913 |
| BUY / SELL | 171,389 / 171,197 | 190,646 / 191,249 | 151,710 / 195,156 | 131,595 / 198,318 |
| BUY count share | 50.03% | 49.92% | 43.74% | 39.89% |
| BUY SOL / SELL SOL | 71,384.92 / 65,831.15 | 106,296.18 / 100,589.50 | 96,750.24 / 95,855.47 | 85,773.53 / 85,649.35 |
| Swaps aged 10–30 min | 158,182 | 191,406 | 38,466 | 71,896 |
| BUY aged 10–30 min | 66,991 | 78,648 | **0** | **0** |
| First-120s swaps / exposed second | 0.64372 | 0.66009 | **1.26317** | 1.08562 |
| Empty token-seconds | 78.13% | 74.95% | 80.58% | 79.85% |
| Swaps / active second | 1.3490 | 1.3128 | 1.5382 | 1.4099 |
| Size SOL p50 / p90 / p99 | .15827 / 1.14430 / 2.68850 | .35911 / 1.28375 / 2.83278 | .32171 / 1.33695 / 3.26096 | .29497 / 1.28375 / 3.17024 |
| Reach 80% | 86 (13.31%) | 83 (12.85%) | 199 (30.80%) | 190 (29.41%) |
| Reach 90% | 22 (3.41%) | 23 (3.56%) | 25 (3.87%) | 26 (4.02%) |
| Complete | 1 (0.155%) | 1 (0.155%) | 1 (0.155%) | 1 (0.155%) |

Real C reference: early intensity 0.46930, BUY share 53.56%, swaps/active second 3.0553, median size 0.16146 SOL, first-80% 3.38%, completion 1.00%. None of the single-factor cells establishes a calibrated market model. In particular, LEASE_ONLY's reduced late count does not make its missing late BUY or stranded inventory realistic. One completion per cell is insufficient for a stable completion-rate inference.

### Age-specific BUY / SELL counts

| Age min | BOUNDED | EXIT_ONLY | LEASE_ONLY | A1 |
|---|---:|---:|---:|---:|
| 0–2 | 35,124 / 14,777 | 37,146 / 14,024 | 67,878 / 30,043 | 59,951 / 24,206 |
| 2–10 | 69,274 / 65,229 | 74,852 / 64,467 | 83,832 / 126,647 | 71,644 / 102,216 |
| 10–20 | 41,114 / 53,379 | 47,224 / 62,649 | 0 / 36,412 | 0 / 51,978 |
| 20–30 | 25,877 / 37,812 | 31,424 / 50,109 | 0 / 2,054 | 0 / 19,918 |

### Age-specific BUY / SELL SOL

| Age min | BOUNDED | EXIT_ONLY | LEASE_ONLY | A1 |
|---|---:|---:|---:|---:|
| 0–2 | 20,521.01 / 12,126.48 | 23,931.67 / 12,628.88 | 44,149.69 / 25,102.87 | 40,049.97 / 21,446.65 |
| 2–10 | 34,288.64 / 34,697.32 | 44,128.62 / 43,087.20 | 52,600.55 / 69,088.74 | 45,723.56 / 60,663.61 |
| 10–20 | 12,654.95 / 14,428.62 | 23,692.27 / 27,725.76 | 0 / 1,655.20 | 0 / 3,234.72 |
| 20–30 | 3,920.32 / 4,578.72 | 14,543.61 / 17,147.66 | 0 / 8.66 | 0 / 304.37 |

## EXIT selection: SELL, WAIT and alternative BUY

These diagnostics cover **all actual policy decisions in the full 90-minute worlds**, including ages/pool fills excluded from the common curve cohort. A choice is recorded only after the existing 45% WAIT gate and scoring have selected a token. SELL below means an emitted SELL intent; executed fills and full position exits are reported separately.

| Diagnostic | BOUNDED | EXIT_ONLY | LEASE_ONLY | A1 |
|---|---:|---:|---:|---:|
| Choices exclusively from exit memory | 0 | **206,476** | 0 | **128,203** |
| Those choices → SELL intent | 0 | 81,227 | 0 | 45,073 |
| Those choices → WAIT | 0 | **125,249** | 0 | **83,130** |
| Those WAIT with another qualifying BUY candidate | 0 | **73,784** | 0 | **53,347** |
| Those choices → BUY | 0 | **0** | 0 | **0** |
| Executed SELL from exit-memory choices | 0 | 81,086 | 0 | 43,884 |
| Full position exits from those choices | 0 | 20,100 | 0 | 11,059 |
| All full position-exit events | 54,787 | 66,026 | 48,830 | 52,208 |

Choice reconciliation is exact: exit choices = SELL intents + WAIT, with no BUY. A qualifying alternative BUY must be another tradable entry in `known`, have an unexpired lease when LEASE is active, and leave a positive BUY budget after the existing fee and SELL reserve. This is policy eligibility based on the agent's information, not guaranteed execution or a claim that rerolling would have produced a fill. No extra selection or RNG draw is performed.

EXIT therefore has a directly observed BUY-displacement channel. **That channel is not its total causal effect:** without LEASE, EXIT ultimately increases common BUY by 19,257; with LEASE, EXIT decreases common BUY by 20,115. Restored inventory access, released cash, candidate competition and subsequent feedback evolve together. The ledger traces and contrasts support these aggregate statements; they do not separately identify how many eventual BUY each channel creates or prevents.

Outside-known status at selection is kept distinct from status at execution. A previously selected known token can be evicted while its order is pending; such a fill is not reclassified as a choice from exit memory.

## Four disjoint primary WAIT categories

Classification follows the **actual first return of the existing policy**, not a list of independently true predicates:

1. `NO_CANDIDATE`: eligible candidate pool empty; no policy RNG draw.
2. `POLICY_WAIT`: the original 45% gate returns WAIT before token selection.
3. `BUY_BUDGET`: after the original side branch, BUY has no fee-adjusted cash, or its original size calculation leaves no positive amount beyond the protected reserve.
4. `BUY_RESTRICTION`: a selected BUY is forbidden by EXIT-only knowledge or by the existing expired lease.

The actual order is empty pool → random WAIT → selection/ordinary SELL branch → cash check → BUY restriction → original size/reserve check. Thus an expired selected BUY that also lacks spendable reserve-adjusted budget returns at the restriction branch, rather than being counted again as budget failure.

Within BUY_RESTRICTION, `EXIT_VIEW` has priority over `LEASE_EXPIRED`, matching the guard's short-circuit order. Both underlying conditions may still appear in secondary counters. No-candidate and preselection WAIT have no selected-token expiry condition; their available-budget and candidate conditions are interpreted accordingly.

| Primary reason | BOUNDED | EXIT_ONLY | LEASE_ONLY | A1 |
|---|---:|---:|---:|---:|
| NO_CANDIDATE | 409 | 409 | 156,651 | 144,279 |
| POLICY_WAIT | 624,742 | 624,881 | 481,945 | 509,741 |
| BUY_BUDGET | 335,556 | 138,087 | 46,916 | 27,476 |
| BUY_RESTRICTION | 0 | 125,249 | 189,553 | 251,819 |
| **Total actual WAIT** | **960,707** | **888,626** | **875,065** | **933,315** |

| Restriction detail, mutually exclusive | BOUNDED | EXIT_ONLY | LEASE_ONLY | A1 |
|---|---:|---:|---:|---:|
| EXIT_VIEW | 0 | 125,249 | 0 | 83,130 |
| LEASE_EXPIRED | 0 | 0 | 189,553 | 168,689 |
| Restriction WAIT with another qualifying BUY | 0 | 73,784 | 125,461 | 165,057 |

The last row is an additional condition, **not a third restriction detail**. In A1, 251,765 WAIT have selected-token expiry and 83,130 have exit-only selection. **83,076 have both**; each is counted once under EXIT_VIEW. Adding these secondary counters would falsely inflate the number of blocks. Their proper primary total is 251,819, split into 83,130 EXIT_VIEW and 168,689 LEASE_EXPIRED.

The canonical tally is `counters.causal` with keys `wait:*`. `waitDetail:*`, `waitSecondary:*`, `waitOtherBuy:*` and selection-outcome keys are separate breakdowns or conditions. The older `counters.a1` fields remain for harness compatibility, not as additional blocks or as a uniform four-cell WAIT classification.

Random POLICY_WAIT can also occur with a qualifying BUY: 246,330 / 390,383 / 348,274 / 369,688 in matrix order. These are intentional policy sampling, not lease/exit blocks. General alternative-candidate counters and budget/expiry conditions remain separate in the results. SELL alternatives require available atoms and the upfront fee; execution liquidity/slippage is not predicted.

## Available SOL and inventory

Available SOL excludes reservations and sums the same 600 agents. Initial capital is 6,975 SOL in every cell. Conservation is checked at every sample and run end; no system-account transfer or issuance is added.

| Sim minute | BOUNDED | EXIT_ONLY | LEASE_ONLY | A1 |
|---|---:|---:|---:|---:|
| 0 | 6975.000 | 6975.000 | 6975.000 | 6975.000 |
| 5 | 3665.777 | 3665.777 | 3665.777 | 3665.777 |
| 10 | 2102.154 | 2100.699 | 3803.289 | 3816.355 |
| 15 | 1053.284 | 1194.722 | 3549.651 | 3592.247 |
| 20 | 504.816 | 905.446 | 3351.778 | 3427.809 |
| 30 | 132.428 | 623.242 | 3071.388 | 3248.821 |
| 45 | 27.390 | 497.364 | 2631.724 | 3033.073 |
| 60 | 10.435 | 381.951 | 2209.044 | 2813.989 |
| 90 | 9.205 | 412.074 | 3717.460 | 4793.651 |

Positions below are **all open / outside known**; reserved-only positions are included.

| Sim minute | BOUNDED | EXIT_ONLY | LEASE_ONLY | A1 |
|---|---:|---:|---:|---:|
| 10 | 6244 / 37 | 6252 / 33 | 5161 / 30 | 5159 / 29 |
| 30 | 13938 / 7724 | 11823 / 4818 | 8451 / 3297 | 7401 / 1994 |
| 60 | 23600 / 18163 | 14543 / 7956 | 13306 / 8301 | 8514 / 3064 |
| 90 | 25347 / 18163 | 9373 / 1399 | **8320 / 8301** | **69 / 45** |

At 90 minutes there are 600 / 600 / 599 / 48 holders. With EXIT enabled, no sampled outside-known position lacks its exit view. Without EXIT, that guarantee is intentionally absent. LEASE_ONLY's 8,301 outside-known positions are excluded from its candidate pool despite remaining in the ledger; a quieter tape must not be mistaken for completed liquidation. No value estimate is assigned to these positions merely from their count.

## Terminal silence, bursts and progression

| Metric | BOUNDED | EXIT_ONLY | LEASE_ONLY | A1 | Real C reference |
|---|---:|---:|---:|---:|---:|
| Paths with ≥300 s terminal silence | 46.44% | **0.00%** | **87.00%** | **6.50%** | 91.82% |
| Active-series p50/p90/p99 s | 1/3/7 | 1/3/6 | 1/4/11 | 1/3/9 | 1/4/18 |
| Internal-gap p50/p90/p99 s | 2/8/25 | 3/10/33 | 2/10/45 | 3/15/51 | 3/44/604 |
| Empty 5 s windows | 45.25% | 32.91% | 58.46% | 48.30% | 95.77% |
| Empty 10 s windows | 35.01% | 17.01% | 49.56% | 31.82% | 94.21% |
| Nonempty 10 s count p50/p90/p99 | 4/8/23 | 3/7/21 | 3/14/26 | 2/10/23 | 3/26/91 |

EXIT preserves continued trading access to old positions, and terminal silence falls at both LEASE settings. LEASE_ONLY looks closer to Real C on terminal silence but retains almost all remaining positions outside `known` and has zero late BUY. It is therefore not evidence that the original abandonment problem has been solved. A1's persistent small-SELL tail cannot be attributed to the BUY lease alone.

LEASE raises first-80% attainment at either EXIT setting; completion remains one in every cell. There is no basis here to claim a completion improvement or tune the lease. Complete curve-stage flow/exposure and first-crossing progression aggregates remain in the results rather than being reduced to a single attainment rate.

## DUST_OR_LIQUIDITY and actual exits

These are full-world **execution rejections**, not WAIT or failed token selections.

| DUST_OR_LIQUIDITY origin at selection | BOUNDED | EXIT_ONLY | LEASE_ONLY | A1 |
|---|---:|---:|---:|---:|
| KNOWN | 3 | 0 | 632 | 569 |
| EXIT | 0 | 63 | 0 | 1183 |
| **Total** | **3** | **63** | **632** | **1752** |

The engine reports a combined reason; this audit does not invent a split between rounding dust and insufficient liquidity. In addition, exit-origin SELL has 75 SLIPPAGE rejections in EXIT_ONLY and 5 in A1. Successful SELL, rejected SELL, cutoff-pending orders and full position exits are different outcomes. The existing global identity attempts = fills + rejections + pending orders remains exact.

## Paired causal contrasts and interaction

For each seed and metric Y, let B=BOUNDED, E=EXIT_ONLY, L=LEASE_ONLY, A=A1. Report E−B, L−B, A−L, A−E and **I=A−E−L+B**. Counts and SOL stocks below sum the six paired contrasts. They are not estimates of how many direct candidate displacements would have executed.

| Metric | EXIT at LEASE OFF | LEASE at EXIT OFF | EXIT at LEASE ON | LEASE at EXIT ON | Interaction |
|---|---:|---:|---:|---:|---:|
| Common BUY | **+19,257** | −19,679 | **−20,115** | −59,051 | **−39,372** |
| Common swaps | +39,309 | +4,280 | −16,953 | −51,982 | −56,262 |
| Swaps aged 10–30 min | +33,224 | −119,716 | +33,430 | −119,510 | +206 |
| Available SOL at 90 min | +402.868 | +3708.255 | +1076.191 | +4381.578 | +673.323 |
| Open positions at 90 min | −15,974 | −17,027 | −8,251 | −9,304 | +7,723 |
| DUST_OR_LIQUIDITY rejects | +60 | +629 | +1,120 | +1,689 | +1,060 |

The −39,372 BUY interaction has the same negative sign in all six seeds. Mean is **−6,562 BUY per world**, range **−7,455 to −6,035**. EXIT's BUY contrast changes sign in every seed: +2,997…+3,459 without LEASE, versus −3,996…−3,023 with LEASE.

| Seed | B BUY | E BUY | L BUY | A BUY | BUY interaction |
|---|---:|---:|---:|---:|---:|
| A | 27922 | 31124 | 24607 | 21584 | −6225 |
| B | 27872 | 30929 | 25327 | 22095 | −6289 |
| C | 28317 | 31461 | 25181 | 21605 | −6720 |
| D | 30075 | 33473 | 26162 | 22912 | −6648 |
| E | 29194 | 32653 | 25335 | 21339 | −7455 |
| F | 28009 | 31006 | 25098 | 22060 | −6035 |

Other prespecified paired interaction summaries:

- Early rate: mean **−0.19382 swaps/exposed s**, range −0.24344…−0.16675, negative in 6/6 seeds.
- Terminal silence: mean **−34.08 percentage points**, range −39.05…−30.28, negative in 6/6. This is the mean of seed contrasts, not subtraction of differently weighted pooled percentages.
- Available SOL: mean **+112.221 SOL**, range +94.504…+132.115, positive in 6/6.
- Late count: mean +34.33 swaps, range −924…+525, positive in 4/6 and negative in 2/6. Do not claim a stable directional late-count interaction from this small residual.
- DUST_OR_LIQUIDITY: mean +176.67 rejects, range −34…+275, positive in 5/6 and negative in 1/6.

All per-seed values, conditional contrasts and sign counts, including attainment/completion, are preserved in the JSON. No significance test or population-level causal claim is manufactured from six deterministic seeds. These are controlled **model-system** effects: downstream RNG consumption, capital, holdings, discovery feedback and candidate competition are part of the response. The individual contribution of those downstream channels remains unidentified.

## Validation and reproduction

Twenty-four primary 90-minute runs are repeated in a separate **uninstrumented build**, verifying both tape hashes, manifests, full benchmark summaries, decisions, facts, pool fills and launch schedules for every cell/seed. Twelve additional original reserve-OFF and legacy reserve-ON/unbounded CONTROL regressions match their existing references. BOUNDED matches PR #84 and A1 matches `cb19c06` references on all six seeds. No reference manifest or hash is updated to allow a discrepancy.

The four-WAIT classifier instruments actual return points in a diagnostic bundle only. Scripted tests cover every primary category, both budget sites, expired-plus-budget overlap, exit-plus-expiry overlap, another qualifying BUY, outside-known SELL and exact RNG-draw consumption. Primary totals equal actual WAIT; exit selections equal SELL intents plus WAIT; no exit-memory BUY exists; restriction details partition their primary group. Instrumented/uninstrumented parity independently checks that diagnostics do not change trading.

Periodic execution count remains **462,254**, with every seed's periodic-gap histogram identical across all four variants; minimum actual decision gap remains 2000 ms. Economic samples at minutes 0 and 5 match exactly. Conservation is asserted at all nine sample times and at each run end. Complete snapshots include reserved SOL and fee-collector totals, not just available cash.

Checks run: `npm run qa:engine-v2` (including matrix isolation, state layout, freshness ownership, conflicting flags, checkpoint/replay and existing ledger gates); `npm run qa:sim:market-baseline:check`; persistence-metric tests; `npm run build`; `npm run lint`; script syntax and diff-whitespace checks. Original QA hashes remain `f8092dfbdd7be89f` / `edd06a22c30a0ffe`. Existing hook and build-size warnings remain. No browser QA or remote CI success is claimed; the browser launchers install a CLI/manipulate shared sessions and V1/UI are unchanged.

Existing local references are required: the original Real C/V2 baseline, SELL-reserve summary, BOUNDED summary, Market Persistence summary, and `output/engine-v2-interest-a1-final/summary.json` for the A1 anchor. No missing input is downloaded. Use a fresh output directory:

```powershell
$causalOut = 'output/engine-v2-a1-causal-rerun'
foreach ($letter in @('A','B','C','D','E','F')) {
  node --max-old-space-size=1600 scripts/qa/engine-v2-interest-a1.mjs output/engine-v2-real-c-baseline $causalOut "V2-PILOT-$letter" --causal
  if ($LASTEXITCODE -ne 0) { throw "Failed seed $letter" }
}
node --max-old-space-size=1800 scripts/qa/engine-v2-interest-a1-summary.mjs $causalOut --causal
```

Without `--causal`, the existing A1 capture/summary invocation remains supported. In causal outputs `runs.bounded/exit/lease/a1` are the four treatment cells; `runs.off/control` are legacy regressions, with `control` referring to the old unbounded scheduler. Main artifacts refuse overwriting. Local measurements are in `output/engine-v2-a1-causal/`; only compact aggregates are committed. Source fingerprints identify the measured working tree based on `cb19c06`.

**Conclusion:** LEASE accounts for zero old-token BUY in both EXIT conditions. EXIT provides real liquidation access but also direct WAIT displacement and an aggregate BUY effect whose sign depends on LEASE. EXIT prolongs old-token trading at both LEASE settings; the two mechanisms interact strongly on total BUY, cash and silence. A1 remains rejected. No new interest variant, tuning, PR, push or merge is performed.
