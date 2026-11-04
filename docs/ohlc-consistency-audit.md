# OHLC consistency audit — Slice 2D

Base: `89250a5`, 2026-11-04. Diagnostic only; production behavior is unchanged.

## Contract and evidence

Execution admits nondecreasing millisecond timestamps before reserve mutation. Equal timestamps preserve execution order. `recordTradeTick` synchronously calls `pushCandleTicks` for Price and MCAP at 1, 15, 30 and 60 seconds, then appends the tape entry. Candle timestamps are bucket starts in Unix seconds. The eight aggregators receive the same fee-exclusive market volume exactly once. Tape price is the post-execution marginal reserve price; it is not the average exchange price. User fill USD includes wallet fee effects.

Genesis contributes a zero-volume observation and establishes the admission watermark. Sparse buckets are omitted; a new candle opens at the preceding close, which also participates in high/low. Retention keeps 3000 candles and preserves the admission watermark. getSeries copies the array, not its candle objects. Registry selects the active metric/timeframe and forwards candles to Chart, which maps their OHLC and volume to chart series without reconstructing trade prices.

The independent audit oracle applies admission in arrival order, groups admitted events, explicitly includes genesis, and applies continuity opens. It does not call CandleAggregator. It verifies all eight projections for the four-actor execution fixture and the public tick fixture. Separate 3005-bucket fixtures exercise both scales, retention, equal timestamps and late rejection.

## Baseline and classification

Original diagnostic: **335/413 PASS, 78 discrepancies**. Curve parity: **14/18**, including two separate BUY fee-formula discrepancies outside this OHLC audit.

| Cause | Count | Verdict | Evidence |
|---|---:|---|---|
| Continuity OPEN and resulting LOW | 26 | CONVENTION | Explicitly preserved and asserted by Slice 2B lateTickQa; 12 then 20 produces open/low 12, close/high 20 |
| Late events included by old sorted oracle | 24 | STALE_QA | Earlier timestamps are rejected before mutation; old oracle includes their price/volume |
| Genesis omitted from trade-only oracle | 20 | CONVENTION | Four initial counts and sixteen first-bucket price/MCAP open/low comparisons |
| Wallet and market notional mixed | 4 | STALE_QA | BUY wallet 15 versus market 14.85; SELL wallet proceeds exclude fee |
| Marginal price compared to average | 4 | CONVENTION | Tape equals post-swap reserve ratio; average measures the executed curve interval |
| Unknown | 0 | UNKNOWN | No unexplained baseline labels |
| Total | 78 | | |

These conventions have evidence beyond their existence in implementation: Slice 2B explicitly preserves continuity/genesis and tests rejection; volume-basis QA independently checks fee-exclusive reserve exchange volume. They describe simulator chart semantics, not an exchange trade-only OHLC feed.

## Impact and next slice

No baseline discrepancy demonstrates lost or double-counted accepted trades. Genesis and continuity can extend wick ranges beyond trade-only prices, including across a long empty interval. Chart faithfully displays these candles; trading settlement does not consume candle OHLC. Market volume is fee-exclusive and unaffected by continuity or genesis. Equal timestamps use execution order, while pending user fills and background/steering flow must remain monotonic. The existing timestamp and late-tick regressions are complementary evidence for that producer ordering.

Changing OPEN would alter wicks and visual continuity. Removing genesis would change empty chart behavior and the initial admission boundary. Accepting late events would require historical correction and chart synchronization; do not revert Slice 2B. Tape retention and candle retention differ, so a retained tape alone cannot reconstruct all retained candles in a long session. The finite diagnostic fixtures do not prove all lifecycle states or every possible execution sequence.

Recommended next slice, ordered by user impact: (1) document chart price as post-trade marginal price and volume as fee-exclusive market exchange; (2) add a convention-aware replacement diagnostic while retaining the historical diagnostic; (3) decide product semantics for trade-only versus continuity candles before any production change. Fee-formula parity remains a separate trading concern.

Verdict: **0/78 require a demonstrated production correction; 78/78 require QA expectation/convention alignment (28 stale assertions and 50 convention comparisons); 0 unresolved baseline cases**. The current candle model is adequate for further simulator development under this explicit contract, with limited fixture coverage rather than a proof of universal correctness.

## Reproduction and complete label inventory

Bundle the QA entry with the installed esbuild using `--bundle --platform=node --format=esm`, then execute the output with Node. The original diagnostic intentionally exits nonzero. The new diagnostic prints every original failing label, requires 413 checks and 78 discrepancies, and then checks independent projections and retention.

```text
BASELINE CONTINUITY:CONVENTION aggregator/1s/boundary/bucket1/open: actual=12, expected=20
BASELINE CONTINUITY:CONVENTION aggregator/1s/boundary/bucket1/low: actual=12, expected=20
BASELINE CONTINUITY:CONVENTION aggregator/1s/sparse/bucket1/open: actual=12, expected=20
BASELINE CONTINUITY:CONVENTION aggregator/1s/sparse/bucket1/low: actual=12, expected=20
BASELINE LATE_REJECTION:STALE_QA aggregator/1s/late-same-bucket/bucket0/open: actual=20, expected=10
BASELINE LATE_REJECTION:STALE_QA aggregator/1s/late-same-bucket/bucket0/low: actual=20, expected=10
BASELINE LATE_REJECTION:STALE_QA aggregator/1s/late-same-bucket/bucket0/volume: actual=2, expected=5
BASELINE LATE_REJECTION:STALE_QA aggregator/1s/late-previous-bucket/bucket0/low: actual=10, expected=8
BASELINE LATE_REJECTION:STALE_QA aggregator/1s/late-previous-bucket/bucket0/close: actual=10, expected=8
BASELINE LATE_REJECTION:STALE_QA aggregator/1s/late-previous-bucket/bucket0/volume: actual=2, expected=6
BASELINE CONTINUITY:CONVENTION aggregator/1s/late-previous-bucket/bucket1/open: actual=10, expected=20
BASELINE CONTINUITY:CONVENTION aggregator/1s/late-previous-bucket/bucket1/low: actual=10, expected=20
BASELINE CONTINUITY:CONVENTION aggregator/15s/boundary/bucket1/open: actual=12, expected=20
BASELINE CONTINUITY:CONVENTION aggregator/15s/boundary/bucket1/low: actual=12, expected=20
BASELINE CONTINUITY:CONVENTION aggregator/15s/sparse/bucket1/open: actual=12, expected=20
BASELINE CONTINUITY:CONVENTION aggregator/15s/sparse/bucket1/low: actual=12, expected=20
BASELINE LATE_REJECTION:STALE_QA aggregator/15s/late-same-bucket/bucket0/open: actual=20, expected=10
BASELINE LATE_REJECTION:STALE_QA aggregator/15s/late-same-bucket/bucket0/low: actual=20, expected=10
BASELINE LATE_REJECTION:STALE_QA aggregator/15s/late-same-bucket/bucket0/volume: actual=2, expected=5
BASELINE LATE_REJECTION:STALE_QA aggregator/15s/late-previous-bucket/bucket0/low: actual=10, expected=8
BASELINE LATE_REJECTION:STALE_QA aggregator/15s/late-previous-bucket/bucket0/close: actual=10, expected=8
BASELINE LATE_REJECTION:STALE_QA aggregator/15s/late-previous-bucket/bucket0/volume: actual=2, expected=6
BASELINE CONTINUITY:CONVENTION aggregator/15s/late-previous-bucket/bucket1/open: actual=10, expected=20
BASELINE CONTINUITY:CONVENTION aggregator/15s/late-previous-bucket/bucket1/low: actual=10, expected=20
BASELINE CONTINUITY:CONVENTION aggregator/30s/boundary/bucket1/open: actual=12, expected=20
BASELINE CONTINUITY:CONVENTION aggregator/30s/boundary/bucket1/low: actual=12, expected=20
BASELINE CONTINUITY:CONVENTION aggregator/30s/sparse/bucket1/open: actual=12, expected=20
BASELINE CONTINUITY:CONVENTION aggregator/30s/sparse/bucket1/low: actual=12, expected=20
BASELINE LATE_REJECTION:STALE_QA aggregator/30s/late-same-bucket/bucket0/open: actual=20, expected=10
BASELINE LATE_REJECTION:STALE_QA aggregator/30s/late-same-bucket/bucket0/low: actual=20, expected=10
BASELINE LATE_REJECTION:STALE_QA aggregator/30s/late-same-bucket/bucket0/volume: actual=2, expected=5
BASELINE LATE_REJECTION:STALE_QA aggregator/30s/late-previous-bucket/bucket0/low: actual=10, expected=8
BASELINE LATE_REJECTION:STALE_QA aggregator/30s/late-previous-bucket/bucket0/close: actual=10, expected=8
BASELINE LATE_REJECTION:STALE_QA aggregator/30s/late-previous-bucket/bucket0/volume: actual=2, expected=6
BASELINE CONTINUITY:CONVENTION aggregator/30s/late-previous-bucket/bucket1/open: actual=10, expected=20
BASELINE CONTINUITY:CONVENTION aggregator/30s/late-previous-bucket/bucket1/low: actual=10, expected=20
BASELINE CONTINUITY:CONVENTION aggregator/60s/boundary/bucket1/open: actual=12, expected=20
BASELINE CONTINUITY:CONVENTION aggregator/60s/boundary/bucket1/low: actual=12, expected=20
BASELINE CONTINUITY:CONVENTION aggregator/60s/sparse/bucket1/open: actual=12, expected=20
BASELINE CONTINUITY:CONVENTION aggregator/60s/sparse/bucket1/low: actual=12, expected=20
BASELINE LATE_REJECTION:STALE_QA aggregator/60s/late-same-bucket/bucket0/open: actual=20, expected=10
BASELINE LATE_REJECTION:STALE_QA aggregator/60s/late-same-bucket/bucket0/low: actual=20, expected=10
BASELINE LATE_REJECTION:STALE_QA aggregator/60s/late-same-bucket/bucket0/volume: actual=2, expected=5
BASELINE LATE_REJECTION:STALE_QA aggregator/60s/late-previous-bucket/bucket0/low: actual=10, expected=8
BASELINE LATE_REJECTION:STALE_QA aggregator/60s/late-previous-bucket/bucket0/close: actual=10, expected=8
BASELINE LATE_REJECTION:STALE_QA aggregator/60s/late-previous-bucket/bucket0/volume: actual=2, expected=6
BASELINE CONTINUITY:CONVENTION aggregator/60s/late-previous-bucket/bucket1/open: actual=10, expected=20
BASELINE CONTINUITY:CONVENTION aggregator/60s/late-previous-bucket/bucket1/low: actual=10, expected=20
BASELINE GENESIS:CONVENTION genesis/1s/trade-only-count: actual=1, expected=0
BASELINE GENESIS:CONVENTION genesis/15s/trade-only-count: actual=1, expected=0
BASELINE GENESIS:CONVENTION genesis/30s/trade-only-count: actual=1, expected=0
BASELINE GENESIS:CONVENTION genesis/60s/trade-only-count: actual=1, expected=0
BASELINE WALLET_BASIS:STALE_QA user-BUY/tape-vs-fill-notional: actual=14.85, expected=15
BASELINE POST_PRICE:CONVENTION user-BUY/trade-average-price-convention: actual=0.000005022812689988737, expected=0.00000501139336411986
BASELINE WALLET_BASIS:STALE_QA user-BUY/fill-average-identity: actual=0.000005062013499110846, expected=0.0000050113933641197375
BASELINE POST_PRICE:CONVENTION bot-BUY/trade-average-price-convention: actual=0.000005045677303475858, expected=0.000005034232015857966
BASELINE WALLET_BASIS:STALE_QA user-SELL/tape-vs-fill-notional: actual=7.467268829164823, expected=7.392596140873175
BASELINE POST_PRICE:CONVENTION user-SELL/trade-average-price-convention: actual=0.000005034173424994133, expected=0.00000503992208196293
BASELINE WALLET_BASIS:STALE_QA user-SELL/fill-average-identity: actual=0.0000049895228611433, expected=0.00000503992208196293
BASELINE POST_PRICE:CONVENTION bot-SELL/trade-average-price-convention: actual=0.000005032783893960583, expected=0.00000503347861152643
BASELINE GENESIS:CONVENTION execution/1s/price-projection/bucket0/open: actual=0.000005, expected=0.000005022812689988737
BASELINE GENESIS:CONVENTION execution/1s/price-projection/bucket0/low: actual=0.000005, expected=0.000005022812689988737
BASELINE GENESIS:CONVENTION execution/1s/mcap-projection/bucket0/open: actual=5000, expected=5022.812689988737
BASELINE GENESIS:CONVENTION execution/1s/mcap-projection/bucket0/low: actual=5000, expected=5022.812689988737
BASELINE GENESIS:CONVENTION execution/15s/price-projection/bucket0/open: actual=0.000005, expected=0.000005022812689988737
BASELINE GENESIS:CONVENTION execution/15s/price-projection/bucket0/low: actual=0.000005, expected=0.000005022812689988737
BASELINE GENESIS:CONVENTION execution/15s/mcap-projection/bucket0/open: actual=5000, expected=5022.812689988737
BASELINE GENESIS:CONVENTION execution/15s/mcap-projection/bucket0/low: actual=5000, expected=5022.812689988737
BASELINE GENESIS:CONVENTION execution/30s/price-projection/bucket0/open: actual=0.000005, expected=0.000005022812689988737
BASELINE GENESIS:CONVENTION execution/30s/price-projection/bucket0/low: actual=0.000005, expected=0.000005022812689988737
BASELINE GENESIS:CONVENTION execution/30s/mcap-projection/bucket0/open: actual=5000, expected=5022.812689988737
BASELINE GENESIS:CONVENTION execution/30s/mcap-projection/bucket0/low: actual=5000, expected=5022.812689988737
BASELINE GENESIS:CONVENTION execution/60s/price-projection/bucket0/open: actual=0.000005, expected=0.000005022812689988737
BASELINE GENESIS:CONVENTION execution/60s/price-projection/bucket0/low: actual=0.000005, expected=0.000005022812689988737
BASELINE GENESIS:CONVENTION execution/60s/mcap-projection/bucket0/open: actual=5000, expected=5022.812689988737
BASELINE GENESIS:CONVENTION execution/60s/mcap-projection/bucket0/low: actual=5000, expected=5022.812689988737
BASELINE CONTINUITY:CONVENTION tick/1s/chronological-projection/bucket1/open: actual=0.000005, expected=0.0000050385338892675825
BASELINE CONTINUITY:CONVENTION tick/1s/chronological-projection/bucket1/low: actual=0.000005, expected=0.0000050385338892675825
```

## Validation results

- New consistency diagnostic: baseline reproduced, independent projection/admission/retention checks PASS.
- tradeOhlcQa: 335/413; intentional nonzero exit, all 78 labels above.
- curveParityQa: 14/18; intentional nonzero exit.
- buyExhaustionQa: 135 assertions PASS.
- cashCapSellQa: 2,314,439 invariant checks PASS; forced guard 2/2 PASS.
- lateTickQa: exit 0.
- tradeTimestampQa: 350/350 PASS.
- volumeBasisQa: integrity 249, candidate 265, model 37, wallet 16, settlement 10, holderCycle 162, guard 14; all PASS.
- npm run build: PASS, existing bundle-size warning.
- npm run lint: exit 0, zero errors and seven warnings in existing UI components.

No manual browser interaction was performed: this slice changes diagnostics and documentation only.
