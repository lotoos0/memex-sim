# A2 opportunity attention (opt-in): frozen six-seed experiment

**Verdict: REWORK.** The mechanism is correct and isolated: with the interest weights forced to 1 it reproduces EXIT_FALLTHROUGH exactly on all six seeds, SELL selection, RNG consumption, scheduling and capital paths are untouched, and BOUNDED / EXIT_ONLY / FALLTHROUGH hashes are unchanged. But the frozen design produces strong launch herding (first-120 s intensity +81% over FALLTHROUGH, 80%-progress tokens ×2.6, the only completion lost), and its price-news component is almost inert, so it is effectively a launch-recency weighting. It should not be promoted. Nothing here is a claim about Real C beyond the descriptive columns.

## What was implemented (experimental, opt-in)

`opportunityAttention` requires `exitFallthrough` (stacked experimental dependency only; nothing here is to be merged or promoted). Per agent × token record `{level, at, strikes, strikeAt, ref, impulsePostId, impulsePublishedAt}` in `agent.attention`; all arithmetic is integer, decay is lazy, no new RNG draws, no new events.

* Weight `w = 1 + floor(decay(level) × 15 / 1 000 000)`, `decay = floor(level × H / (H + dt))`.
* BUY target = deterministic BigInt exponential race over the **existing** `draw(60)` of known tradable candidates (equal weights compare the draws, i.e. exactly the FALLTHROUGH target). The union contest, bounded SELL selection, `sellBias`, sizes and the 45% gate are unchanged.
* Signals: launch sight (full level, inherits the source post for dedup); independent post (A1 rule, deduplicated by post id / publish time); cumulative price displacement ≥ 700 bps from `ref` on a snapshot newer than `ref.at` in the same epoch (granted level `ATTENTION_FLOW_LEVELS[k]`, `k` = effective strikes, strikes saturate at 4, recover one per `R = 140 s`, table instead of bit shifts); own fills (including curve-completing executions reported as `MarketMigrated`) absorb the reference; epoch change resets the reference without an impulse.
* Frozen constants: `H = 35 000 ms`, `θ = 700 bps`, `R = 4H`, `W_MAX = 15`. Not tuned. 700 bps is an experimental assumption, not an empirically validated informational threshold.
* One refinement versus the review text: strike recovery uses its own `strikeAt`, so a news event that adds nothing does not re-anchor the level (hyperbolic decay is not memoryless).
* Files: `src/engineV2/attention.ts` (new), `agents.ts`, `world.ts`, `events.ts` (optional `launch`), `src/qa/engineV2Qa.ts`, `engineV2Benchmark.ts`, harness `--attention` mode.

## Acceptance checks

| Check | Result |
|---|---|
| Zero-bonus equivalence vs FALLTHROUGH (`W_MAX` patched to 0, state machine live), six seeds | **Pass.** Entire 90-min decision tape, trade tape (fact ids normalised), RNG counters across all namespaces, economics samples, scheduler/attempt/reject counters and size samples identical. The state machine was exercised (launch impulses, news). |
| BOUNDED / EXIT_ONLY / FALLTHROUGH reference hashes | Re-run matches the committed manifests, tape hashes and full-tape hashes (A1 results file for the first two, FALLTHROUGH results file for the third). `qa:engine-v2` prints `f8092dfbdd7be89f` / `edd06a22c30a0ffe`. |
| A2 diverges from FALLTHROUGH exactly at the first changed target | Pass in every seed (decision 137–248; 4.4–7.2 s). The trade tape first differs 350 ms later. |
| SELL and RNG parity | Unit property test over 4 weight pairs × 400 draw vectors × 2 sell draws: identical WAIT/TRADE, side, SELL intent and draw count; BUY differs only by target. |
| Own-fill absorption, incl. curve-completing `MarketMigrated` path | Unit test (migration, epoch-0 reference, spot equals market reference, older snapshot cannot overwrite). In the runs, own-fill absorptions (519,759) equal total fills (254,075 + 265,684). |
| Uninstrumented replay | 24 repeats (4 modes × 6 seeds) match both tapes and summaries. |
| `npm run qa:engine-v2`, `npm run build`, `npm run lint` | Pass (0 lint errors, existing warnings). |

## Method and data availability

V2-PILOT-A–F, 90 simulated minutes, BOUNDED scheduler, SELL fee reserve, original 100 agents. Same population in every cell (646 launches / paths / 1,161,188 exposed seconds). The local reference outputs required by the legacy harness do not exist in either checkout, so BOUNDED/EXIT_ONLY/FALLTHROUGH were re-run and anchored to the **committed** compact results; Real C columns come from that file's read-only `real` block and the A1 report. Legacy OFF/CONTROL regressions against the missing references were not re-run. No reference file or expected hash was changed.

## Results (pooled over six seeds)

| Metric | BOUNDED | EXIT_ONLY | FALLTHROUGH | A2 | Real C |
|---|---:|---:|---:|---:|---:|
| Common swaps | 342,586 | 381,895 | 410,290 | 433,888 | n/a |
| BUY / SELL | 171,389 / 171,197 | 190,646 / 191,249 | 214,688 / 195,602 | 228,744 / 205,144 | n/a |
| BUY share | 50.03% | 49.92% | 52.33% | 52.72% | 53.56% |
| First-120 s swaps / exposed s | 0.644 | 0.660 | 0.687 | **1.243** | 0.469 |
| Empty token-seconds | 78.13% | 74.95% | 73.21% | 72.26% | 98.14% |
| Empty 5 s / 10 s windows | 45.3 / 35.0% | 32.9 / 17.0% | 30.6 / 15.8% | 29.0 / 13.1% | 95.8 / 94.2% |
| Terminal silence ≥ 300 s | 46.44% | 0% | 0% | 0% | 91.82% |
| Size SOL p50 / p90 / p99 | .158 / 1.14 / 2.69 | .359 / 1.28 / 2.83 | .332 / 1.27 / 2.84 | .296 / 1.27 / 3.17 | .161 median |
| Reach 80% / 90% / complete | 86 / 22 / 1 | 83 / 23 / 1 | 87 / 23 / 1 | **224 / 64 / 0** | n/a |
| Paths retreating after 80% / 90% | 86 / 22 | 83 / 23 | 87 / 23 | 224 / 64 | n/a |

### BUY / SELL by token age (count; SOL ex fees)

| Age min | BOUNDED | EXIT_ONLY | FALLTHROUGH | A2 |
|---|---|---|---|---|
| 0–2 | 35,124 / 14,777 | 37,146 / 14,024 | 39,027 / 14,200 | **76,979 / 19,361** |
| 2–10 | 69,274 / 65,229 | 74,852 / 64,467 | 82,691 / 66,210 | 86,360 / 72,054 |
| 10–20 | 41,114 / 53,379 | 47,224 / 62,649 | 56,171 / 64,419 | 37,400 / 63,633 |
| 20–30 | 25,877 / 37,812 | 31,424 / 50,109 | 36,799 / 50,773 | 28,005 / 50,096 |
| SOL 0–2 | 20,521 / 12,126 | 23,932 / 12,629 | 24,169 / 12,625 | 42,522 / 21,360 |
| SOL 2–10 | 34,289 / 34,697 | 44,129 / 43,087 | 45,464 / 44,337 | 43,833 / 52,058 |
| SOL 10–20 | 12,655 / 14,429 | 23,692 / 27,726 | 25,889 / 29,952 | 15,745 / 21,623 |
| SOL 20–30 | 3,920 / 4,579 | 14,544 / 17,148 | 15,504 / 18,095 | 11,100 / 13,290 |

### Late BUY and progress

| | BOUNDED | EXIT_ONLY | FALLTHROUGH | A2 |
|---|---:|---:|---:|---:|
| BUY aged ≥ 10 min | 66,991 | 78,648 | 92,970 | 65,405 (−30% vs FALLTHROUGH) |
| …at progress < 20% | 29,761 | 638 | 711 | 1,049 |
| BUY by progress 0–20 / 20–50 / 50–80% | 53,540 / 35,699 / 65,416 | 8,254 / 54,565 / 110,988 | 9,026 / 58,787 / 129,577 | 9,487 / 54,294 / 143,788 |

Late BUY is nonzero in every seed and age band (per seed: 10–20 min 5,926–6,556; 20–30 min 4,545–4,907). Missing late BUY was therefore not triggered as an investigation case. Note that EXIT-family cells already have ~2% of BOUNDED's late low-progress BUY; that gap predates A2.

### Is trade frequency unchanged? (requirement 3: measured, not assumed)

| | FALLTHROUGH | A2 | Change |
|---|---:|---:|---:|
| Periodic / reactive decisions | 462,254 / 924,459 | 462,254 / 924,457 | none / −2 |
| TRADE / WAIT decisions | 528,459 / 858,836 | 523,789 / 863,504 | −0.9% / +0.5% |
| BUY / SELL attempts | 258,273 / 270,186 | 256,655 / 267,134 | −0.6% / −1.1% |
| Fills BUY / SELL (all ages) | 256,813 / 268,717 | 254,075 / 265,684 | −1.1% / −1.1% |
| BUY execution slippage rejects | 1,443 | 2,563 | +78% |

A2 changes allocation, not frequency: intents and fills are slightly lower. The +5.8% in *common* swaps is composition: more BUY lands on tokens younger than 30 minutes, which is the measured population. Decision counts per agent are unchanged within the table's tolerance (decision tape lengths differ by at most 3 per seed). Slippage rejects rise because fresh-token herding trades into fast-moving prices.

### Capital, positions, exits

| | BOUNDED | EXIT_ONLY | FALLTHROUGH | A2 |
|---|---:|---:|---:|---:|
| Available SOL at 10 / 30 / 60 / 90 min | 2,102 / 132 / 10 / 9 | 2,101 / 623 / 382 / 412 | 2,098 / 376 / 180 / 300 | 2,283 / 560 / 288 / 500 |
| Open / outside-known positions at 90 min | 25,347 / 18,163 | 9,373 / 1,399 | 9,445 / 1,430 | 9,717 / 1,787 |
| Full position exits (all / exit-origin) | 54,787 / 0 | 66,026 / 20,100 | 67,196 / 20,470 | 66,315 / 21,419 |
| Exit-origin SELL fills | 0 | 81,086 | 81,449 | 86,345 |
| New / repeat BUY entries (agent × token) | 32,151 / 172,146 | 34,109 / 196,268 | 34,449 / 222,364 | 38,462 / 215,613 |

Outside-`known` SELL access is preserved (exit-origin fills and exits are higher than FALLTHROUGH). New entries rise 11.6%, repeat entries fall 3%.

### Per-seed change, A2 − FALLTHROUGH

| Seed | Swaps | BUY | First-120 s rate | Reach 80% | Reach 90% | Completions | Late BUY ≥ 10 min | Cash at 90 min |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| A | +2,884 | +1,675 | +0.534 | +17 | +5 | 0 | −5,058 | +11.9 |
| B | +5,628 | +3,390 | +0.565 | +22 | +6 | −1 | −4,065 | +38.7 |
| C | +3,264 | +1,894 | +0.540 | +16 | +5 | 0 | −4,472 | +9.9 |
| D | +3,934 | +2,272 | +0.563 | +29 | +8 | 0 | −4,871 | +55.4 |
| E | +4,055 | +2,537 | +0.574 | +28 | +8 | 0 | −4,255 | +19.4 |
| F | +3,833 | +2,288 | +0.560 | +25 | +9 | 0 | −4,844 | +64.2 |

Signs agree in all six seeds for swaps, BUY, early rate, reach 80/90%, late-BUY decrease and cash. Full contrasts for ~48 metrics are in the results JSON. These are model-system effects of six deterministic seeds, not significance tests.

## Mechanism diagnostics

* **Launch impulses dominate.** 38,283 launch impulses and 572 post impulses versus ~1.8M price-news evaluations. 94% of news (1.71M) arrives at the saturated strike index; only 636 first-strike grants and 3,540 grants at strikes 0–2 (the only grants that can raise a weight above 1) occur in total. Frequent ≥ 7% moves keep strikes saturated because recovery needs `R` of quiet per strike, so **price-driven revival of an old token is nearly inert**: the "dynamic information" part effectively reduces to launch recency.
* **Attention is concentrated on the newest tokens.** Agent × token pairs with weight ≥ 8 exist only for tokens younger than ~2 minutes (seed A at minute 5: 124 of 241 pairs on such tokens, none in older age bands; pooled, 405–491 pairs at any sampled minute out of 4,785–32,658 records). Targets with weight ≥ 8 are 68,232 decisions versus 22,609 for the FALLTHROUGH target.
* **Target changes:** 127,422 BUY-branch decisions got a different target (66,448 became BUY intents, 60,974 stayed WAIT for lack of budget, 65,402 executed fills, 32,398 SOL).
* Direction-neutral news also fires on price drops. Strategy valence stays in the existing momentum/contrarian logic.

## Interpretation

* The research question (can information-weighted BUY allocation reduce diffuse stale BUY without a cliff?) has a partial answer: late BUY falls 30% relative to FALLTHROUGH to roughly BOUNDED's level, never to zero, while exit access, scheduling and capital stay intact.
* The price paid is herding at launch: all agents that see a launch within 250–750 ms receive the same maximal impulse, so BUY volume in the first two minutes doubles, many more tokens run to 80% and then retreat (224 of 224), and the single FALLTHROUGH completion disappears. This moves *away* from Real C on early intensity and progression. A2 does not solve excessive activity or bursts; it was never designed to, and this result shows it can worsen the early-burst shape.
* Likely causes (hypotheses, not tested): the launch impulse is synchronous across agents and at full strength; `R = 4H` is far longer than the typical quiet time of a trading token at `θ = 700 bps`, so news saturates strikes. Any change must go through a new design review (and the separate crowd-synchronisation experiment is directly relevant to the first cause). No constant was changed or swept in this run.

## Reproduction (PowerShell, repository root)

```powershell
foreach ($letter in @('A','B','C','D','E','F')) {
  node --max-old-space-size=2400 scripts/qa/engine-v2-interest-a1.mjs x output/engine-v2-attention "V2-PILOT-$letter" --attention
  if ($LASTEXITCODE -ne 0) { throw "Failed seed $letter" }
}
node --max-old-space-size=2400 scripts/qa/engine-v2-interest-a1-summary.mjs output/engine-v2-attention --attention
```

The first positional argument is unused in this mode; outputs refuse to overwrite, so use a fresh directory. Compact results (including per-cell manifests and tape hashes, zero-bonus equivalence hashes and per-seed prefix data): [engine-v2-opportunity-attention-results.json](engine-v2-opportunity-attention-results.json).
