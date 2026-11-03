# Trade-driven OHLC audit

Audited base: `0288a0ed25d0449c4302a739838665df1b0fa38b` (`main`, after PR #45). Date: 2026-11-03. This change adds only this report and `src/qa/tradeOhlcQa.ts`. No production logic, contracts, dependencies or CI configuration changed.

## Outcome

The chart faithfully displays the candles it receives, but those candles are not strictly chronological trade OHLCV. Two confirmed inconsistencies need attention: late ticks contaminate the latest bucket, and volume has an actor-dependent fee basis. A real `TokenSim.tick()` fixture reproduces the ordering problem, so it is not just a hypothetical malformed input.

Continuity opens, genesis candles and post-swap reserve prices are identifiable presentation/model conventions. They differ from transaction-price OHLC, but this audit does not classify those decisions as accounting bugs. They need an explicit product contract before changing them.

## Actual data path

1. Registry ticks every 200 ms (`src/tokens/registry.ts:60-94`). Each `TokenSim.tick()` advances simulated time and processes pending user orders first (`tokenSim.ts:447-458`).
2. `processPendingUserTrades` sorts due orders by priority, due time and submission time. Each fill uses `max(order.execMs, nowMs)`, which is `nowMs` for due orders. Priority sorting is execution scheduling, not inherently an out-of-order timestamp error: these executions share a timestamp and retain their execution order.
3. User swaps run through `executeUserTradeImmediate`; background swaps through `executeSimBuyTrade` / `executeSimSellTrade`. Both update reserve/last-price state and call `recordTradeTick` once on success. Unfilled orders do not call it. Background SELL may fall back to a BUY when inventory is unavailable; that BUY is recorded as BUY.
4. `recordTradeTick` (`tokenSim.ts:2770-2816`) pushes the same timestamp and volume to four price aggregators and four market-cap aggregators, updates flow/wallet statistics, and then appends `SimTapeTrade`. Tape and candles are sibling projections, not a tape-to-aggregator pipeline.
5. `getCandles` selects 1s, 15s, 30s or 60s series directly from the simulator. Registry calls the active chart callback with those candles and the latest price/market cap. Lightweight store snapshots do not transport candle arrays.
6. `Chart.tsx:495-525` maps candle fields directly to the candlestick series and volume histogram via `setData`. It does not sort, reprice, rebucket, fill gaps or correct OHLC. Histogram color uses close versus open. The crosshair also reads those values directly.
7. Registry separately drains user execution notices through its execution relay for trading settlement/events. The fill contains average execution price and post-swap price; markers use post-swap price. Tape display sorts recent entries by timestamp, descending, which can conceal a different insertion order used by the candles.

## Answers and classification

### Open, gaps and genesis

For transaction-price OHLC, open is the first executed transaction price in that bucket. Current `CandleAggregator` explicitly uses the previous candle close on each new bucket and includes it in high/low. This is a continuity convention: a single new-bucket trade at 20 following close 12 gives O=12, H=20, L=12, C=20. There was no trade at 12 in that bucket. It changes body direction, extrema and volume-bar color relative to transaction OHLC; it is not an extra trade or volume charge.

Empty buckets are deliberately omitted. That is a valid sparse-series contract. No synthetic flat candles are created across gaps; the next occupied bucket still bridges from previous close. Chart supplies no explicit whitespace bars, so elapsed gaps may appear compressed on the logical bar axis. The browser appearance was not visually verified.

Constructor seeds all eight aggregators with a zero-volume baseline candle (`tokenSim.ts:431-439`). Before the first trade, one candle exists despite an empty tape. When the first trade shares that bucket, genesis can set open and an otherwise untraded low/high. In the fixture the price low/open stays $0.000005 instead of first-trade $0.000005022812689988737; market-cap low/open stays $5,000 instead of $5,022.812689988737.

Genesis is not inserted into tape, `statWindow` or transaction counters. It does not inflate volume or trade count; `getRuntime` takes those statistics from `statWindow`, not candles. It does affect displayed candle count, initial viewport/autoscale and OHLC. Calling it a deliberate launch baseline matches the constructor comment; calling its effects transaction OHLC would be inaccurate.

### Chronology: confirmed data errors

- Same-bucket late arrivals update close in arrival order, while open stays the first arrival. They do not represent chronological first/last trades. High, low and total volume still work for that bucket in the simple fixture.
- An older-bucket tick updates the newest bucket instead of its own bucket. Both buckets' volume and OHLC can be wrong even though global volume is conserved. No rejection, late-event policy or historical correction is exposed.
- Production generates this condition: pending user fills are stamped at `nowMs`, then background trades are executed against the resulting reserves but timestamped across the preceding window (`tokenSim.ts:929-935`). The new fixture calls public submit and `tick`, observes one timestamp inversion, and reproduces 1s bucket contamination.

In that fixture, the previous 1s bucket has recorded volume 0 instead of $334.0769555335803; the next has $366.21332886611873 instead of $32.13637333253844. Previous-bucket high/close and next-bucket open/high/low also disagree with chronological projection. These totals use the existing tape notionals, so this error is independent of the gross/net definition problem.

Re-sorting tape after execution cannot restore execution causality: backdated bot prices were calculated after the user swap. Sorting or historical rebucketing would correct timestamp projection but could still show a reserve-price path inconsistent with execution order. The smallest producer fix should first make timestamps agree with execution order.

### Prices: consistent model, different meanings

User and bot paths both publish post-swap marginal reserve price to tape and price candles. They publish the same post-swap market cap to market-cap candles. All four actor/side integration cases agree with the reserve ratio in the tested pre-migration regime. User fill `priceAfterUsd` agrees with tape; `avgPriceUsd` agrees with its own filled notional divided by tokens.

However, post-swap marginal price differs from the average exchange price. A BUY average is below the post-swap price before fee treatment; a SELL average is above it. User `avgPriceUsd` additionally includes BUY fee or excludes SELL fee in its notional. Therefore tape price multiplied by token quantity is not expected to reproduce tape notional. This is a distinction between execution price, wallet cash price and a reserve mark, not proof that tokens or SOL were lost.

The diagnostic flags the difference to fee-exclusive average exchange price under `trade-average-price-convention`. Choosing transaction-average candle prices would be a separate, approved model change. Chart price formatting/precision may round displayed values but does not change the source candle fields.

### Volume: confirmed inconsistency

| Path | Recorded USD volume | Fee-exclusive exchanged quote |
| --- | --- | --- |
| User BUY | Gross wallet input | Net input entering curve |
| Bot BUY | Net input entering curve | Same net input |
| User SELL | Net wallet proceeds | Gross quote leaving virtual curve |
| Bot SELL | Net proceeds | Gross quote leaving virtual curve |

Thus identical user/bot BUY budgets weight volume differently. The $15 user BUY fixture records $15 while $14.85 enters reserves; the bot BUY records $14.85. SELL volume includes the same net-proceeds convention for both actors, but mixes with the BUY definitions. Fee-exclusive exchanged quote is a useful independent comparison contract; choosing gross-wallet or another common definition would also require explicit agreement.

The same volume goes to tape, candles and flow statistics, so there is no duplicate recording in this path. The mixed definition also affects `vol5mUsd` and wallet trade statistics, not just chart pixels. The equivalent user/bot fee choices are visible in post-migration code too, but dynamic post-migration scenarios were not exercised in this audit.

## Deterministic QA

Run using existing tooling, with no dependency installation:

```sh
./node_modules/.bin/esbuild src/qa/tradeOhlcQa.ts --bundle --platform=node --format=esm --outfile=/tmp/tradeOhlcQa.mjs
node /tmp/tradeOhlcQa.mjs
```

Oracle groups a copy of events chronologically into occupied buckets, takes first/last prices as open/close, extrema over trades, and sums volume. Stable equal timestamps retain execution order. It does not call the production aggregator to compute expectations. Comparisons use relative tolerance 1e-9 with absolute floor 1e-12. There is no trade ID/deduplication contract under test; legitimate same-time trades must both contribute volume.

Coverage: single trade; mixed BUY/SELL; exact bucket boundary; multiple empty buckets; same-bucket and historical late arrivals; equal timestamps; real user/bot BUY/SELL; price and market-cap projections; genesis; real pending-order + background-flow `tick`. Each aggregator scenario runs at 1s/15s/30s/1m. Integration checks all eight projections. Larger-TF tick projections pass in this particular fixture because the inversion remains inside one larger bucket; that does not establish correctness at their own boundaries. The scaled unit fixtures demonstrate the historical-bucket problem at every TF.

Test-only bracket access follows `buyExhaustionQa`: it invokes existing private execution paths and inspects tape without changing production API. Fixture failures throw separately from reported discrepancies. The clock is fixed and restored in `finally`. The standalone process does not mount React or run the registry timer/real browser. Registry and chart transport were verified by source inspection, not automated UI execution.

Result: **326/413 PASS, 87 diagnostic FAIL; exit status 1**. These are field-level discrepancies, not 87 independent bugs. Conventions deliberately remain visible; the test is not a mandatory CI gate.

### Complete FAIL inventory

`TF` below expands to each of `1s`, `15s`, `30s`, `60s`. All unlisted checks pass for these fixtures.

| Label prefix | Failed fields | Count | Classification |
| --- | --- | --- | --- |
| `aggregator/TF/boundary/bucket1` | open, low | 8 | Continuity-open convention |
| `aggregator/TF/sparse/bucket1` | open, low | 8 | Same convention after a gap |
| `aggregator/TF/late-same-bucket/bucket0` | open, close | 8 | Chronology error |
| `aggregator/TF/late-previous-bucket/bucket0` | low, close, volume | 12 | Late tick omitted from its bucket |
| `aggregator/TF/late-previous-bucket/bucket1` | open, low, close, volume | 16 | Continuity open plus historical contamination |
| `genesis/TF/trade-only-count` | count 1 versus 0 | 4 | Synthetic genesis convention |
| `user-BUY`, `user-SELL`, `bot-SELL` | `uniform-exchanged-quote-volume` | 3 | Fee-basis inconsistency |
| `user-BUY`, `bot-BUY`, `user-SELL`, `bot-SELL` | `trade-average-price-convention` | 4 | Reserve-mark versus average-price convention |
| `execution/TF/price-projection/bucket0` | open, low | 8 | Genesis included in price OHLC |
| `execution/TF/mcap-projection/bucket0` | open, low | 8 | Genesis included in market-cap OHLC |
| `tick/chronological-insertion` | inversion count 1 versus 0 | 1 | Actual producer ordering error |
| `tick/1s/chronological-projection/bucket0` | high, close, volume | 3 | Actual earlier-bucket contamination |
| `tick/1s/chronological-projection/bucket1` | open, high, low, volume | 4 | Continuity plus actual contamination |

PASS details include single/mixed ordered trades, equal-time execution order, gap bucket counts, high/low within ordinary buckets, no volume duplication, matching tape/fill post-price and notional for users, all actor reserve marks, and projections including genesis. The latter provides a control: the genesis-related FAILs are attributable to the explicit baseline, not random loss of trade data.

## Validation

- `npm run build`: PASS; existing Node deprecation and bundle-size warnings.
- `npm run lint`: PASS, 0 errors and 7 existing warnings in unchanged UI files.
- New trade OHLC QA: 326/413; 87 diagnostic FAIL as listed above.
- Existing BUY exhaustion QA: 135 assertions PASS, including refund and migration boundary cases.
- Existing curve parity QA: 14/18; the same four known BUY fee/OHLC FAIL; exit 1.
- Browser QA launchers attempted sequentially: both stop at `powershell: command not found`. Browser/manual rendering and five-minute lifecycle checks were not run. No claim of browser QA success.

## Risk and realistic behavior

Trading: the audit does not show that chart aggregation changes matching or debits wallets. BUY exhaustion settlement still passes. It does show that volume statistics carry inconsistent units and that chart/tape can tell different chronological stories. Synthetic open/wicks and marginal prices can mislead a user interpreting the chart as executable trade prices. The impact on strategies depending on volume/price history was not quantified.

Replay: a deterministic event log needs a stable timestamp/sequence contract and explicit late-event handling. Present arrival-order close and historical-bucket contamination prevent arbitrary chronological replay from reproducing live candles reliably. Bounded tape retention also prevents using the current tape snapshot as a complete historical replay source. No Replay provider is introduced or assumed here.

Migration: runtime migration uses the latest market cap and `getMigrationThresholdUsd`, not candle high/low. This audit found no evidence that wrong candle buckets directly change that trigger. The migration marker represents the threshold, while trades may overshoot it; exact marker/candle price equality is not a valid invariant. Backdating background executions after user-triggered migration could also timestamp post-migration activity before the transition; that specific cross-phase case remains a hypothesis, not a demonstrated failure. BUY exhaustion migration regression passes; post-migration economic fidelity is outside this audit.

## Recommendation for approval

Proposed first STANDARD vertical slice: make timestamps emitted by the simulation agree with actual execution order within a tick, especially after pending user fills. Scope the producer scheduling in `tokenSim.ts` and one deterministic regression. Preserve priority semantics and allow equal timestamps with insertion order as the tie-breaker. A minimal approach is to bound generated background timestamps by the latest already executed timestamp in that tick; any resulting loss of artificial sub-tick spacing should be explicit.

Acceptance: the current real-tick inversion fixture becomes monotonic; each actual trade's volume reaches its timestamp's bucket; chronological projection agrees after explicitly including existing genesis/continuity semantics; no changes to reserve math, fills/refunds, fees, migration rules or chart/store boundaries. Re-run BUY exhaustion, build/lint and supported browser QA. Do not change arbitrary-late-event aggregation, OHLC open, genesis, volume basis and average-price semantics in the same slice.

Next independent decisions: define a common volume basis across actors/sides; choose an explicit late-event policy for imported/replayed data; decide whether the chart remains a continuous reserve-mark chart or becomes transaction-price OHLC. Merely sorting ticks in the aggregator is insufficient to repair backdated execution causality. No fix or PR is included here; implementation awaits approval.
