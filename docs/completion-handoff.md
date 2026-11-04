# Slice 3B — Completion-driven atomic handoff

Base: `0673d9e` (main after merged PR #55). Branch: `fix/completion-atomic-handoff`. Implementation submitted for review; no PR or merge performed. The unrelated untracked trading-core sign-off is preserved byte-for-byte (SHA256 FAC2D9B565421D8BEF0B38FD1BEEC3945D6B9804E76DB447725E243DC4FD6115).

## Contract

Only a successful BUY that empties real-token inventory latches completion. The user and bot execution wrappers commit curve quantities, fill price, holder accounting and the trade tick, then synchronously set MIGRATED before returning. Completion is irreversible. Low-level curve quote/execution helpers reject after completion/migration; subsequent BUY/SELL use the existing simulated migrated venue. A completing fill wins over the same-timestamp fate deadline. MCAP alone cannot migrate.

The completing order uses existing capped-output inverse cost, fee-on-gross and refund settlement. No pool leg spends its leftover budget. Positive inventory below the existing token epsilon is now eligible for BUY rather than being rejected as empty; the normal cap/inverse calculation empties it. Only actual zero inventory after the successful fill latches completion; rounded UI progress is not the trigger. No integer arithmetic or fee/reserve model migration is included.

The actual terminal price/MCAP is captured for the sole MIGRATION event and post-migration reference. Handoff retains current price and synthetic liquidity anchoring. Migration shock and reduced flow heuristics remain; the old whole-flow freeze no longer blocks the next execution. Readiness, activity and fate heuristics do not replace inventory completion.

## Ordered publication, including same-timestamp pending batches

TokenSim.tick accepts optional synchronous notice and migration callbacks. Registry supplies the existing execution relay for one notice at a time and publishes migration events individually. There is no new relay class or abstraction layer and registryExecutionRelay.ts is unchanged.

For each due order: requote current venue -> original minOut check -> successful economic execution -> publish FILLED notice through existing relay and settlement subscribers -> publish MIGRATION if that fill completed the curve -> begin next due order. Failures publish their FAILED notice in the same serial position. Original priority/execMs/submitMs sorting is retained. No timestamp matching or swapping of two batched arrays is used to infer order.

Bot BUY completion publishes migration synchronously before the bot helper returns; the next planned trade, fallback BUY or steering call selects migrated execution. Bot migration events are also collected for standalone tick callers and drained once. Registry filters these already-published MIGRATION events from the later bulk tick event publication. Without callbacks, existing standalone callers still receive tick events and drained execution notices. A try/finally clears the temporary migration callback after each tick.

The integration QA observes `execute BUY (NEW) -> notice BUY FILLED -> MIGRATION -> execute BUY/SELL (MIGRATED) -> notice FILLED`, checks actual store insertion order USER_BUY/MIGRATION/USER_BUY-or-SELL using the existing relay, and ensures no duplicate queued notices. A strict pending BUY separately fails the actual-venue requote without economic mutations and without relaxing original minOut. Bot tests verify publication before the next execution in a batch.

## Old threshold dependencies

| Dependency | Current implementation |
|---|---|
| Phase gate | Replaced by sticky successful BUY completion |
| Approach friction and final-stretch pressure | Depletion progress instead of MCAP / USD34200 |
| Actor overlay input | Depletion progress; existing actor logic unchanged |
| Readiness-based expected-price cap / net-buy compression | Removed; no hard threshold steering against the remaining inventory |
| Post-migration plateau/retest | Actual handoff MCAP anchor |
| Chart reference | Initial reserve-derived terminal MCAP before handoff; actual event MCAP afterward |
| Bot batch / fallback / steering | Select venue on every helper call, including same-tick completion |
| Legacy getMigrationThresholdUsd export | Retained only for historical QA scenario labels; no active production caller |

Frozen USD69000 and SOL/USD exports are untouched. The new read-only TokenSim reference accessor uses the existing registry.getTokenSim path, so registry/store ownership and frozen snapshot types are unchanged. The reference is a display/flow anchor, not admission logic.

## Diff inventory

- src/tokens/tokenSim.ts: completion latch and actual anchor; per-execution publication callbacks; user/bot handoff; permanent curve closure; positive-dust admission; threshold dependency removal and flow adjustment.
- src/tokens/registry.ts: serial synchronous notice/migration publication, no duplicated migration publication in returned tick events.
- src/components/chart/Chart.tsx: per-token reference / actual migration event instead of fixed global threshold.
- src/qa/completionHandoffQa.ts: 48 checks for boundary, K/cost, event coordinates, same-time ordering, closed curve, dust, actual-venue slippage, bot batching and late rejection.
- src/qa/buyExhaustionQa.ts and src/qa/curveParityAuditQa.ts: completing scenarios now expect migration at any terminal MCAP, accept the next migrated BUY, and assert the original curve quote stays closed.
- This report.

No changes to types.ts, engine/types.ts, aggregator.ts, registryExecutionRelay.ts, stores, fee constants, initial reserve formulas, session SOL/USD, dependencies or CI.

## Validation

Windows/PowerShell, Node 22.18.0. Standalone entries bundled with installed esbuild (`--bundle --platform=node --format=esm --define:import.meta.env.DEV=true`) into a temporary directory, then executed individually in fresh Node processes. Final results:

| Check | Result |
|---|---|
| completionHandoffQa | 48 assertions PASS |
| buyExhaustionQa | 136 assertions PASS |
| cashCapSellQa | 2,683,166 invariant checks PASS; forced guard 2/2 |
| volumeBasisQa | integrity 249; candidate 265; model 37; wallet 16; settlement 10; holderCycle 162; guard 14 — all PASS |
| lateTickQa | contract 52/52; integration 81/81 |
| tradeTimestampQa | 353/353 |
| ohlcConsistencyAuditQa | PASS; baseline reproduced and independent projections/admission/retention pass |
| curveParityAuditQa | 182 assertions PASS |
| tradeOhlcQa | Historical 335/413, 78 discrepancies, expected exit 1 |
| curveParityQa | Historical 14/18, four discrepancies, expected exit 1 |
| npm run build | PASS; existing bundle-size warning |
| npm run lint | PASS; zero errors and seven existing hook warnings |
| npm run qa:sim:dead-floor | PASS on Windows/PowerShell/Edge |
| npm run qa:sim:quick-limit | PASS on Windows/PowerShell/Edge; cancel refund restored 120 SOL, one BUY and one SELL fill, zero open limits |

Counters in cash-cap/timestamp scenarios changed because migration now occurs at completion and natural trajectories differ. No failing assertion was suppressed. The two original historical diagnostics are unmodified. Current exhaustion regressions explicitly change the old below-threshold exhausted-FINAL expectation to the approved handoff contract.

## Browser smoke evidence and limitations

Used real UI controls against local Vite; no store/reserve mutations were injected. CURSEDHOP (`tok_7_87548c`) initially showed about 85.9% depletion and a USD42.5K migration reference. A 100 SOL market BUY reserved the budget, filled the remaining 64.49M tokens, reached 100%, and restored the wallet to 107.0238 SOL from the interim reservation balance of 20 SOL. Thus about 87.0238 SOL unused budget was returned. The marker/reference stayed near the actual USD42.5K completion point rather than the old USD34.2K threshold. A subsequent 0.1 SOL BUY filled and increased holdings to about 64.79M, demonstrating available trading after completion; stats and price continued updating.

A second ordinary token, DEGENFROG (`tok_69_cd5e45`), was seen in New Pairs at about USD31.4K, then completed through ordinary background flow before its page was inspected. Read-only Curve Debug showed MIGRATED, progress100%, F/M latches, rTok=0 and zero K drift; terminal curve MCAP was USD58.650K and the displayed migration reference USD58.6K. A subsequent market BUY filled. A 50% SELL was submitted, but later source-edit HMR reset the simulated session before its final UI state was captured; manual SELL completion in this specific smoke is NOT VERIFIED. Migrated SELL, pending boundary SELL, wallet settlement and limit SELL are covered by executed deterministic regressions. Full multi-seed natural-lifecycle visual sign-off remains the separate 3D scope.

Screenshots/DOM observations were inspected through browser tools; no screenshot artifacts or unrelated reports were added. This slice does not implement authentic PumpSwap custody, v3 crossing, standard 30 SOL reserves, configurable session valuation or integer SDK parity.

## Review focus

Review synchronous publication/settlement order and standalone callback compatibility, quantity-zero completion including positive dust, fate precedence, and removal of threshold-based flow caps. Natural flow can now reach the existing profile's actual completion price, which can differ substantially from USD34200. This is intended by 3B but changes cadence and migration distribution. Initial reserves, fees and synthetic post-migration venue remain the approved existing model; 3C economics and 3D broad natural-lifecycle sign-off are separate decisions.
