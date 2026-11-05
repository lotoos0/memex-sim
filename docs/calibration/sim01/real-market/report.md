# SIM-01 / Real vs Sim Price Structure

Preserved research snapshot. This report describes the original read-only analysis, not a calibration change in the persistence PR. See [reproduction and metric contract](README.md), [normalized metrics](metrics.json), and [pinned inputs](sources.json).


Read-only research, 2026-11-05. No branch, commit, PR, merge, dependency change or production-market edit was made in this task. Existing user changes remain untouched. Main is `84eca0906dc26387ca8b0fd761faad547e06a3fb`; PR #72 is still open/draft/unmerged, head `8eb3b1257ab77bc179998b2b3502ae0a38dc6327`. A is main; B is exactly PR72, not a deployed main behavior. Original large research data/output remains under ignored `output/sim01-pr3/`; maintained scripts and aggregates are now versioned here.

## Findings that change the diagnosis

1. **The largest measured gap at 80–90% is activity and intrasecond structure, not universally smaller corrections.** In native 1s bins real standard-curve tokens print 2.111 trades/exposed second versus 0.0388 A / 0.0356 B; empty seconds are 44.62% versus 97.02% / 97.20%. Among observed candles, single-print bars are 31.84% versus 79.13% / 80.84%, while wick incidence is 37.44% versus 8.82% / 8.17%. This naturally produces isolated steps and few wicks without a defective OHLC renderer.
2. **Single-band and whole-path drawdowns tell different stories.** Median event-band episode MDD at 80–90% is 5.83% real versus 10.59% A / 9.40% B. It is false that every simulated correction in that band is too shallow. Over a common maximum 120s after first 80%, real median MDD is 40.28% versus 9.90% / 12.36%, with 92 versus 5 / 7.5 median direction changes. Simulated paths can have larger individual prints but far fewer successive decisions, reversals and cumulative losses.
3. **PR72 does not change the initial approach from 80% to 90%.** Every one of the 6000 A/B tape prefixes through the first actual >=90% print matches exactly. Later marginal 80–90% differences include reentries after treatment at 90%; they are not proof that the 0.98 branch caused the original pre-90 path.
4. **The trend signal has a confirmed structural blind spot.** Launch-relative return saturates the positive price-impulse component throughout 80–90%. Under the precise conditions below, CHOP cannot enter BLEED_OUT through either of its two decay tests. How much of the empirical gap this explains still needs a separately approved experiment.
5. B reduces forced 90-ready BUY dominance, as PR72 showed, but leaves the large activity/wick gap and most first-80 retracement gap. More drawdown is not itself evidence of realism. No production calibration change is recommended as already validated by this report.

## Sources, access and integrity

Raw Parquet was absent from the repository and inspected local data/cache/download directories. Public files were available and downloaded, not substituted with aggregate JSON. Dataset revision: `c85a7e8056d4f866b3dc9ce1e8218b8bbddb24cd`, CC BY 4.0, attribution: pumpdatafun / pumpdata.fun, 2026-10-15 ledger sample. Sources: [dataset](https://huggingface.co/datasets/pumpdatafun/pump-fun-trades-sample), [pinned schema/card](https://huggingface.co/datasets/pumpdatafun/pump-fun-trades-sample/blob/c85a7e8056d4f866b3dc9ce1e8218b8bbddb24cd/README.md).
Four trade shards total 1,373,422,244 bytes, plus launches 3,395,780 bytes, events 4,580,167 bytes and graduations 36,568 bytes. Signatures are unnecessary because `(slot,idx,seq)` provides order and transaction identity. SHA256 checks match Hugging Face LFS oids; see `downloads.jsonl` and the graduations manifest. A portable official DuckDB v2.0.0 executable was used locally, with release-asset SHA256 verified; no project package was installed. The original analysis used Python 3.12 / NumPy 2.3.5. Maintained scripts use only the Python standard library and verify historical values within 1e-9.
The first download attempt was not executed because automatic approval review hit its usage limit; after the user requested continuation the same reviewed operation succeeded. There is no remaining data-download blocker.
Existing `docs/calibration` reports/scripts were reviewed as historical definitions and context. Their old simulation metrics, age-only aggregates and different lifecycle cohort are not used as current price-sequence benchmarks. New results below were calculated from raw rows.

## Cohorts and missing observability

| Cohort item | Measured count |
| --- | --- |
| SOL launches before 23:30 UTC, full 30min available | 36037 |
| Active within the 30min curve observation | 33833 |
| No observed trade within 30min | 2204 |
| Active, standard-K compatible | 20675 |
| Active, nonstandard-K | 13158 |
| Standard-K instant-time completions <=1s, excluded from main paths | 356 |
| Main real path cohort: active standard-K, not instant | 20319 |
| Sim initial launches, each variant | 6000 |
| Sim active path cohort, each variant | 4728 |

All launches are 1B supply / 6 decimals in the SOL cohort. Standard compatibility requires max `abs(K/K0-1)<=1e-6` over the observed pre-completion 30min sequence, with K0=30*1.073B in SOL/token units. The same 20,675 tokens pass thresholds 1e-7, 1e-6 and 1e-5; standard p99 maximum K deviation is about 1.86e-8. First reconstructed virtual token/SOL states match 1.073B and 30 for all 33,833 active coins. No duplicate `(mint,slot,idx,seq)` keys or backward per-mint timestamps were found. Standard quote/reserve delta errors are <=1.43e-14 SOL; token-delta residuals are <=2.39e-7 tokens.
The 13,158 excluded nonstandard-K coins are **not all proven Mayhem coins**. The card describes unflagged Mayhem reserve changes; other exceptional states cannot be ruled out from this export. 6,777 such coins have negative naive standard-sale progress, down to -126.09%; silently clipping these into a standard 0–80% cohort would be wrong. Their real price state exists, but comparable standard bonding progress/mode attribution is not identified well enough here. Quiet real coins cannot be classified by an unobserved K either, so are not silently assigned to the standard active cohort. These selection limits prevent generalizing this benchmark to every Pump.fun launch or launch mode.
For all 36,037 SOL launches, there are 356 instant-time completions <=1s, 466 organic-time completions >1s and <=1800s, and 78 observed completions later than 1800s. Thus the all-launch **organic 30min** completion proportion is 466/36,037=1.293%; it differs in definition from the older report’s full-follow-up organic percentage. In the standard main active non-instant path cohort it is 203/20,319=0.999%. Do not compare that conditional denominator directly with 111/6000 or 81/6000. Instant means a timestamp definition, not a proven bundle: only 257 of the 356 standard instant cases share the exact creation transaction key.
No real `migrationReady` column is inferred. In particular no real token is labeled ready from a simulated fate/quality or a standard price threshold. Accurate holder readiness needs balance/transfer observations not present in this sample. A trade-only wallet balance would be an incomplete proxy; this report does not silently use it. Main Real/A/B comparisons are progress-only. PR72 ready/not-ready results remain a simulator-only diagnostic.

## Reconstruction and comparable definitions

- Admit successful SOL curve rows only. Join launches for age and creators, events for complete/migrate boundaries. Sort per token by `(slot,idx,seq)`; do not sort only by timestamp, average same-second swaps, or count failed attempts as price prints.
- A completing buy can include a pool leg. Match the graduations row by `(slot,idx,mint,wallet)` (unique here), subtract its token/quote amounts, and retain the terminal curve reserve spot. Stop at completion; do not include migrated pool price/volume.
- Curve `r1,r2,r3` are post-swap virtual SOL lamports, virtual token base units and real SOL lamports. Price SOL/token=`(r1/1e9)/(r2/1e6)`. Market volume uses fee-exclusive curve quote; average execution price is not substituted for spot. Standard progress=`(1.073B-r2/1e6)/793.1M`. Terminal observed virtual tokens are 279.9M and median completion mcap 410.880168 SOL, agreeing with official constant-product pricing. All price ratios are SOL-normalized; no historical SOL/USD price is invented.
- Observe each token to first completion or launch age 1800s. Launches at/after 23:30 are excluded so that right-edge follow-up is available. A missing completion by 1800s is censored, not declared never to migrate. Instant-time graduations <=1s are reported separately and excluded from main path comparisons.
- Replayed A/B full tape was recovered by adding observations only in a temporary esbuild-loaded harness copy. No production source file was edited. After removing the extra tape field every one of the 6000 token result records and the summary is exactly equal to the saved PR72 A/B run; the observer consumed no RNG draws. Research scripts and source revisions are retained.
- Event-band episodes use pre-swap progress; a crossing/exit print belongs to the band it exits. Post-print state owns the following interarrival exposure. Reentry is a new episode; zero-duration same-second real episodes are retained as observed at the data’s resolution. Episode quantiles are episode-weighted, not independent token samples. A/B PR72 start-of-200ms-tick episode counts differ slightly; this report uses the same event convention for Real, A and B.
- Full first-80 paths start at the crossing price, omit the crossing print’s volume/count, include ALL later pre-migration swaps including retreats, and end at completion or the launch-age horizon. The 120s sensitivity admits first-80 time <=1680, then ends at the earlier of first80+120 and completion. It does not drop tokens that retreat or fail to reach 90%. Successful first80-to-first90 passages are separately conditional and not conflated with all entrants.
- Trade MDD is peak-to-trough over ordered post-swap spots, including the path opening price. Impulses/corrections are compounded consecutive runs of same-sign nonzero price changes; zeros do not end a run. Direction changes are sign reversals. Results also retain 1s-close MDD/impulses, 1s/5s close returns and duration/trade count quantiles in JSON.
- Native 1s candles group swaps into Unix/launch-age seconds with stable execution order. They use continuity OPEN (previous close), include OPEN in high/low, and omit empty observed bars, matching the simulator’s documented convention. CSV also supplies first-trade OPEN/HIGH/LOW so an exchange-style trade-only convention can be inspected. A zero-volume genesis establishes initial price analytically; it is not counted as a transaction or an observed trade bar. Missing close-grid seconds are carried only for analytic returns, not synthesized as production candles.
- Native candle/exposure tables assign each entire second to the progress at its start (last preceding state), with one per-token bin at most, and may include an event-only edge second at completion. This is different from event-band episode slices. `comparison.json` also stores episode-local empty-bin metrics that can duplicate a second across reentries; the native quiet-share table below is the unique-bin comparison. Block time has only 1s resolution: true intrasecond waits are unknown. Slot/idx/seq preserves price order without inventing subsecond timestamps.

## Main event-band benchmarks

| Dataset / stage | Tokens | Episodes | BUY count | BUY volume | Trades / exposure s | MDD p10 / p50 / p90 (%) |
| --- | --- | --- | --- | --- | --- | --- |
| real / 0_80 | 20319 | 23402 | 52.12% | 51.69% | 0.0480 | 0.00 / 12.67 / 59.95 |
| real / 80_90 | 679 | 4921 | 60.15% | 50.69% | 2.0111 | 0.00 / 5.83 / 24.52 |
| real / 90_100 | 408 | 1856 | 62.91% | 50.10% | 2.6780 | 1.37 / 7.21 / 26.12 |
| A / 0_80 | 4728 | 5263 | 54.40% | 59.94% | 0.0435 | 3.02 / 27.56 / 64.68 |
| A / 80_90 | 463 | 796 | 43.35% | 45.68% | 0.0390 | 0.39 / 10.59 / 32.71 |
| A / 90_100 | 171 | 200 | 68.71% | 68.47% | 0.1127 | 0.00 / 3.58 / 34.56 |
| B / 0_80 | 4728 | 5278 | 54.40% | 59.94% | 0.0435 | 2.97 / 27.51 / 64.62 |
| B / 80_90 | 464 | 911 | 44.10% | 46.22% | 0.0358 | 0.00 / 9.40 / 32.32 |
| B / 90_100 | 171 | 278 | 51.52% | 52.49% | 0.1854 | 2.25 / 11.08 / 34.06 |

The contrast is conditional: all-active frequency is 0.0567 real versus 0.0437 A / 0.0440 B, a modest difference; the 80–90% conditional difference is about 52x A / 56x B under the event definition. Raising every token’s global arrival rate would not be supported by this result.
| Dataset / stage | Impulse p10 / p50 / p90 (%) | Correction p10 / p50 / p90 (%) | Direction changes p10 / p50 / p90 | Episode seconds p10 / p50 / p90 |
| --- | --- | --- | --- | --- |
| real / 0_80 | 0.08 / 2.12 / 18.91 | 0.14 / 2.77 / 14.89 | 0.00 / 3.00 / 54.00 | 18.00 / 1800.00 / 1800.00 |
| real / 80_90 | 0.05 / 1.13 / 7.90 | 0.06 / 1.15 / 7.00 | 0.00 / 3.00 / 38.00 | 0.00 / 3.00 / 44.00 |
| real / 90_100 | 0.05 / 0.97 / 6.30 | 0.04 / 0.83 / 5.63 | 0.00 / 4.00 / 74.00 | 0.00 / 4.00 / 74.00 |
| A / 0_80 | 0.22 / 1.87 / 22.41 | 0.17 / 0.94 / 11.61 | 2.00 / 24.00 / 64.00 | 111.10 / 1800.00 / 1800.00 |
| A / 80_90 | 0.15 / 1.96 / 20.14 | 0.14 / 2.33 / 18.03 | 0.00 / 2.00 / 12.00 | 1.70 / 43.00 / 959.35 |
| A / 90_100 | 0.11 / 3.24 / 52.64 | 0.13 / 1.61 / 17.26 | 0.00 / 1.00 / 6.10 | 4.16 / 41.78 / 525.30 |
| B / 0_80 | 0.22 / 1.87 / 22.41 | 0.17 / 0.94 / 11.62 | 1.00 / 24.00 / 64.00 | 110.97 / 1800.00 / 1800.00 |
| B / 80_90 | 0.16 / 2.07 / 19.63 | 0.15 / 2.39 / 17.52 | 0.00 / 1.00 / 12.00 | 1.80 / 51.60 / 970.97 |
| B / 90_100 | 0.16 / 2.33 / 13.77 | 0.17 / 1.89 / 10.44 | 0.00 / 4.00 / 38.00 | 2.22 / 35.00 / 448.32 |


## Native 1s candle structure and silence

| Dataset / start-of-second band | Observed bars | Trades / exposed second-bin | Empty second-bins | Single-print bars | Bars with a wick |
| --- | --- | --- | --- | --- | --- |
| real / 0_80 | 589440 | 0.0474 | 98.37% | 49.70% | 22.59% |
| real / 80_90 | 50503 | 2.1108 | 44.62% | 31.84% | 37.44% |
| real / 90_100 | 34213 | 2.9193 | 34.35% | 26.93% | 40.84% |
| A / 0_80 | 225783 | 0.0435 | 97.21% | 70.99% | 15.42% |
| A / 80_90 | 6585 | 0.0388 | 97.02% | 79.13% | 8.82% |
| A / 90_100 | 2673 | 0.1118 | 91.52% | 75.98% | 6.36% |
| B / 0_80 | 225848 | 0.0435 | 97.21% | 71.00% | 15.41% |
| B / 80_90 | 7332 | 0.0356 | 97.20% | 80.84% | 8.17% |
| B / 90_100 | 6093 | 0.1846 | 85.47% | 78.40% | 10.29% |

Wick means HIGH above max(OPEN,CLOSE) or LOW below min(OPEN,CLOSE), with relative tolerance 1e-10. It is an incidence, not a desired wick quota. Simulated continuity bars can have a body on a single-print second but no wick: this is a direct consequence of sparse execution. No cosmetic wick injection is justified.
| Dataset / native band | Body p10 / p50 / p90 (%) | Range p10 / p50 / p90 (%) | Trade-only range p50 (%) |
| --- | --- | --- | --- |
| real / 80_90 | -3.86 / 0.08 / 3.58 | 0.09 / 1.24 / 7.94 | 0.40 |
| real / 90_100 | -3.21 / 0.15 / 2.87 | 0.10 / 1.07 / 6.48 | 0.45 |
| A / 80_90 | -5.61 / -0.11 / 4.62 | 0.12 / 1.17 / 11.32 | 0.00 |
| A / 90_100 | -1.52 / 0.45 / 6.04 | 0.10 / 0.99 / 8.33 | 0.00 |
| B / 80_90 | -5.53 / -0.10 / 4.60 | 0.12 / 1.18 / 11.39 | 0.00 |
| B / 90_100 | -3.42 / 0.05 / 4.45 | 0.11 / 1.11 / 7.75 | 0.00 |

The real 80–90% native median range is 1.24%, close to A 1.17% / B 1.18%; real p90 is 7.94% versus 11.32% / 11.39%. Range alone would miss the very different print counts, wicks and quiet-time mass. Trade-only flat-bar shares equal the single-print shares in this sample; the flat share under the continuity convention is zero. These conventions must not be mixed.

## Whole paths from first 80% and common-window sensitivity

| Dataset | Entrants | Returned below 80% | Not migrated by horizon | MDD p10 / p50 / p90 (%) | Direction changes p10 / p50 / p90 |
| --- | --- | --- | --- | --- | --- |
| real | 685 | 602 (87.88%) | 482 | 17.53 / 82.39 / 91.21 | 16.00 / 174.00 / 720.20 |
| A | 469 | 339 (72.28%) | 358 | 2.86 / 35.07 / 88.92 | 0.00 / 9.00 / 33.20 |
| B | 469 | 343 (73.13%) | 388 | 7.84 / 39.67 / 88.92 | 0.00 / 14.00 / 52.00 |

| Dataset | First80 age p10 / p50 / p90, s | First80->first90 p10 / p50 / p90, s | Observed migration age p10 / p50 / p90, s |
| --- | --- | --- | --- |
| real | 0.00 / 74.00 / 554.20 | 0.00 / 45.00 / 336.20 | 52.60 / 308.00 / 1073.00 |
| A | 25.10 / 94.30 / 497.34 | 0.00 / 23.20 / 300.47 | 106.30 / 173.90 / 494.50 |
| B | 25.10 / 94.30 / 497.34 | 0.00 / 23.20 / 300.47 | 120.30 / 316.50 / 930.10 |

The passage-time distribution includes only tokens that actually reach 90% (408 real / 173 each sim), not an imputed value for censored entrants. Full paths have unequal time remaining after 80%; the next sensitivity removes end-of-day/horizon truncation of a common maximum follow-up window.
| Dataset / <=120s after first80 | Eligible n | Returned below 80% | MDD p10 / p50 / p90 (%) | Close1s MDD p50 (%) | Direction changes p10 / p50 / p90 | Trades/s |
| --- | --- | --- | --- | --- | --- | --- |
| real | 681 | 565 (82.97%) | 10.34 / 40.28 / 87.07 | 37.05 | 11.00 / 92.00 / 280.00 | 3.406 |
| A | 466 | 220 (47.21%) | 0.00 / 9.90 / 38.36 | 9.09 | 0.00 / 5.00 / 27.50 | 0.215 |
| B | 466 | 221 (47.42%) | 0.00 / 12.36 / 38.82 | 11.86 | 0.00 / 7.50 / 30.00 | 0.216 |

This includes retreats, not only successful graduates. Migration still censors a successful path; it is not followed onto PumpSwap. It therefore describes pre-migration policy outcomes, not equal uncensored market exposure for every token. Even with this limitation, the short-window path gap is large and is not explained by using intrasecond MDD instead of 1s-close MDD.

## Sensitivities and what is not established

- Matching real launch hours to 08Z/19Z leaves 1885 active standard non-instant tokens, but only 36 first-80 entrants. Its 80–90% trade frequency is 3.279/s, median episode MDD 6.11%, and full post-80 median MDD 81.96%. Direction of the activity/path gap persists; this small hour-matched subset is not an independent market-day validation.
- K tolerance sensitivity gives the same standard cohort at 1e-7 through 1e-5. Including nonstandard-K coins would change the market population and invalidate this particular progress/price comparison; their absence is an explicit limitation, not proof that their prices are invalid.
- The benchmark is a single day, standard-compatible active launches, all actors including creators, max 30min. It is not an exchange-wide or multi-day target. Real transfer-derived holder trajectories and launch-mode flags remain unavailable. No reliable true-readiness comparison or mode-stratified nonstandard stage benchmark is claimed.
- Price vs progress is already compatible for standard curves. The observed price differences arise from transaction sequences and capital flows, selection and observation timing; they do not establish a need to alter official reserves, fees, graduation trigger or the renderer.

## Additional diagnosis: confirmed facts versus hypotheses

**1. Conditional activity and silence — strongest measured discrepancy.** `tokenSim.ts:1128` defines age decay/mid-hump and a bounded attention multiplier (0.65–1.65); `:1003` cancels stepMarket’s extra attention multiplication. Arrival shape has no empirically calibrated high-progress survival/participation response. At 90% only finish-stretch can impose a floor. The code structure and conditional frequency deficit are confirmed; the exact contribution of any one rate factor is not isolated by a new ablation. Priority: measure/calibrate conditional transaction arrivals and smaller interleaved orders on active curves, preserving quiet-launch behavior rather than globally multiplying lambda.
**2. Launch-relative context suppresses local trend-loss signals — confirmed analytic mechanism.** `tokenSim.ts:2819` uses priceAtSpawn, assigned once at constructor launch. Official constant product gives launch returns +498.716% at progress 0.8 and +792.283% at 0.9. In `tokenMarketRegimes.ts:198`, priceImpulse=clamp(changePct/160,-1,1)=1 throughout that band. With nonnegative volume heat, flowStrength>=-0.10 even under 100% recent SELL count. Consequently `flowStrength < -0.12` in CHOP’s BLEED_OUT condition (`:532`) is unreachable there. The alternative decayBias condition is also unreachable if quality>=0.236364, since its maximum is `(1-quality)*0.55+0.10<=0.52`. These statements require pre-migration age>=85s, current CHOP and price still in the band; they do NOT say all other regimes, rugs, low-quality tokens or retreats can never bleed. Base CHOP drift before tokenSim overlays is also >=+0.0013/s because its discovery tailwind is launch-anchored. This drift does not directly move the candle; it enters expected-price/guard flow. Measure a local-return/drawdown context experiment separately before changing it.
**3. Arrival-slot allocation and executed order sizes — confirmed transformation; causal share unmeasured.** `tokenSim.ts:423–456` rounds side slots by notional and transfers the opposite side’s full notional when it gets no slot. A one-arrival tick becomes a winner-take-all print; 50/50 rounds to BUY. This can amplify either direction and is not an inherently BUY-only bug. Combined with sparse arrivals it discards real-market-style two-sided intrasecond structure. The larger simulated impulse/correction tails and 79–81% single-print bars are consistent with this mechanism but do not isolate it from size sampling, inventory caps or arrival rates. A future bounded experiment should preserve sampled side/intention and quote, not invent opposite candles.
**4. Readiness +0.1 and SELL overlay scaling — confirmed protective rules, not yet a causal estimate for the 80–90% real gap.** Main `tokenSim.ts:883–886` adds +0.1 with clamp 0.4–0.75 from 80%; B retains it (`:881–882` after branch removal). Actor SELL overlay is scaled to 0.15 for ready tokens (`:1032`) and to zero during >=90% finish stretch. Readiness/friction is simulation-specific. Aggregate 80–90% sim BUY quote is already below the real band benchmark, so lowering every 80–90% BUY bias from this table alone would be unjustified. Separate ready-state and overlay single-factor experiments are required. PR72 establishes the >=90% 0.98 effect, not these two independent effects.
**5. Impact guards / microbursts — confirmed scheduled smoothing mechanism, magnitude hypothesis.** `tokenSim.ts:1280–1409` clips expected displacement by converting directional flow into opposing flow, then schedules excess over 3–6 steps at 1s cadence, front-loaded weights 0.34/0.24/0.18/0.11 with decay 0.82; retrace chance 0.35 and strength 0.18 (`tokenMarketRegimes.ts:68–72`). This is a plausible source of recurrent steps and weak retrace within one burst. The guard is NOT a hard cap on actual curve candle movement; side allocation can undo the counterflow. Existing large correction tails do not support blindly relaxing it. Attribute realized queue contributions in a dedicated experiment before modifying it.
**6. Bootstrap Final Stretch — confirmed selection, unmeasured share of screenshots.** `registry.ts:31,350–457` targets ages 8–22min, tries up to 14 bucket matches and samples only NORMAL/LONG_RUNNER for Final Stretch; `bootstrapAdvance` uses up to 1.2s steps rather than live 200ms. This is not a representative fresh-launch cohort. Positive launch context and higher-quality CHOP retention can interact with this selection. The present fresh-token A/B benchmark excludes bootstrap; it cannot assign bootstrap a numeric share of the visual problem. Diagnose a separate bootstrap cohort before changing UI sorting or market behavior.
**Negative/control result:** all 6000 A/B ordered tape prefixes through the first >=90% print are identical. Thus B does not resolve the initial 80–90% issue. A/B differences in later 80–90% occupation include post-treatment reentries. Failed SELL fallback, wallet cash/inventory asymmetry and fees are not identified as dominant 80–90% causes by this report; no execution change is proposed.

## Ranking of next investigations, not approved implementation

| Priority | Bounded question | Evidence / acceptance direction |
| --- | --- | --- |
| 1 | State-conditional arrival/participation and silence at high curve progress | Match actual trade/exposure and single-print/wick distributions by progress/age/active cohort; preserve quiet launches; no global arbitrary multiplier. |
| 2 | Local trend context versus launch-relative saturated context | Test whether local trend loss becomes observable and paths can fail/reclaim without manually scripted regimes; report migration/censoring costs. |
| 3 | Side/notional conservation in sparse slot allocation | Attribute intended versus realized BUY/SELL and execution size; preserve valid inventory/execution constraints. |
| 4 | Readiness +0.1 and overlay suppression, independently | Two separate experiments, with fixed pre-treatment cohorts; do not equate real state with simulation readiness. |
| 5 | Microburst/guard attribution | Measure source, queued/released quote, timing and actual price impact before deleting or retuning anything. |
| 6 | Bootstrap cohort representativeness | Compare existing bootstrap with fresh tokens at matched state/age; separate presentation selection from market calibration. |

Do not implement a multi-parameter calibration package from these observations. A future change must retain the official standard bonding curve and trading execution, use a separate approved scope, and report the complete initial cohort plus first-passage/censoring views. No synthetic random candles or prebuilt chart scenarios are recommended.

## Reproduction and artifacts

Maintained scripts live in [scripts/](scripts/). Follow [README.md](README.md) for checksum-verified raw preparation, pinned A/B extraction, analysis and verification. SQL and work-directory paths are explicit; no historical absolute runtime path or old output/sim01-pr2 file is required.

[Historical research aggregates](research-results.json) retain named keys comparison, sensitivity, native_exposure, candle_structure, hours_sensitivity, validation, regime_proof and pre90_pairing. [Normalized metrics](metrics.json) adds direction changes per 100 trades, side quote per exposure second, transactions per active second, individual quote sizes and observed BUY/SELL streak lengths. Definitions and denominator/censoring caveats are in the README.

Large ordered swaps and candles are intentionally not committed. The reproduction commands regenerate real/A/B native candle CSVs, ordered source CSV and both simulation tapes under the chosen ignored work directory. True holder/readiness, launch-mode flags and subsecond real times remain unavailable; no proxy fills them.

Known-path/denominator/episode fixtures and full raw-data reproduction validate this persistence. Original quote/token conservation, K sensitivity, pre-90 A/B control and close1s/hour sensitivities remain evidence of the historical research. This PR does not modify src, execution, OHLC, migration or market parameters.
