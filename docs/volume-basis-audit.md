# Volume basis audit - Slice 2C

Historical audit snapshot from `799d903`, preserved below. The approved Slice 2C1 implementation and current validation are recorded in [Slice 2C1 implementation](#slice-2c1-implementation---pending-code-review).

Status at audit time: audit and diagnostic QA, pending contract decision. Base: `9ffdca1` (`main` after Slice 2B / PR #47), 2026-11-03. Branch: `docs/volume-basis-audit`. Only this report and `src/qa/volumeBasisQa.ts` are added. No production implementation or contract migration is authorized by this report.

## Current contract and data flow

There is no single runtime volume basis. The same `notionalUsd` name describes different fee treatments depending on actor and side. A numeric field's name is not evidence that it means exchanged quote.

The active path is:

1. [`TokenSim`](../src/tokens/tokenSim.ts) executes a curve swap or computes a migrated swap and updates marginal price and token ownership.
2. User execution passes `filledUsd` to `recordTradeTick`. Bot execution passes its selected curve/AMM input/output field instead.
3. `recordTradeTick` sends that value to all eight price/mcap aggregators, appends a stat entry, updates the holder's wallet profile and appends tape. These are sibling writes from the same value, not a projection successively read from tape.
4. [`CandleAggregator`](../src/engine/aggregator.ts) adds the supplied volume once per accepted tick. It does not know fees or convert units. Genesis contributes zero; late ticks are rejected under Slice 2B.
5. `getFlowWindowTotals` sums stat entries into `vol5mUsd`, BUY counts and SELL counts. `getRuntime` exposes those totals. `getMarketSnapshot` exposes tape and holder profiles.
6. [`TokenRegistry`](../src/tokens/registry.ts) serves candles directly through the chart callback. [`registryFeedPublisher`](../src/tokens/registryFeedPublisher.ts) publishes runtime and micro snapshots to [`tokenStore`](../src/store/tokenStore.ts). Neither normalizes fees or volume.
7. UI consumes those projections. The separate [`tradingStore`](../src/store/tradingStore.ts) consumes execution fills for wallet settlement, positions, PnL and Your Trades. Its `QuickTrade.notionalUsd` is wallet cash flow, not an independently specified chart-volume contract.

Retention differs: stat entries cover five simulation minutes, pruned on trade recording; tape retains at most 2,000 rows; each aggregator retains at most 3,000 sparse candles; published recent trades default to 120 rows. Consequently, lifetime candle volume, visible tape volume and `vol5mUsd` need not be equal after windowing/trimming. QA compares controlled matching windows with no pruning.

## Execution matrix

The current fee rate is 100 bps. Let `f = 0.99`, `Q` be the actual fee-exclusive quote exchanged by the pricing model, `G = Q / f` be the gross BUY charge, and `N = f * Q` be the net SELL payout. Token quantities are actual executed quantities. Transaction/priority costs in SOL are separate from swap fee and contribute no trade volume.

| Phase | Actor / side | Gross quote | Fee | Net quote | Recorded volume / tape / candles / stats | User-visible amounts |
| --- | --- | --- | --- | --- | --- | --- |
| Pre | User BUY | Wallet input `G` | `G - Q` | Curve input `Q` | `G` from `filledUsd` | Market tape and Your Trades show `G`; wallet pays `G` plus transaction cost |
| Pre | Bot BUY | Requested/used gross `G` | `G - Q` | Curve input `Q` | `Q` from `buy.baseInUsd` | Market tape and holder Bought show `Q`; bot profile SOL is debited by `Q / 150` |
| Pre | User SELL | Model output `Q` | `Q - N` | Wallet output `N` | `N` from `filledUsd` | Market tape and Your Trades show `N`; wallet receives `N` |
| Pre | Bot SELL | Model output `Q` | `Q - N` | Wallet output `N` | `N` from `sell.baseOutUsd` | Market tape and holder Sold show `N` |
| Post | User BUY | Wallet input `G` | `G - Q` | AMM input `Q` | `G` from `filledUsd` | Same wallet/Your Trades basis as pre migration |
| Post | Bot BUY | Requested gross `G` | `G - Q` | AMM input `Q` | `Q` from `buy.baseInNetUsd` | Same bot profile undercount of gross cost |
| Post | User SELL | AMM output `Q` | `Q - N` | Wallet output `N` | `N` from `filledUsd` | Same wallet/Your Trades basis as pre migration |
| Post | Bot SELL | AMM output `Q` | `Q - N` | Wallet output `N` | `N` from `sell.baseOutNetUsd` | Same market tape basis as pre migration |

For BUY the token output is the net-input constant-product result. For SELL token input is consumed and the quote-side fee is deducted from output. Bot SELL's target USD is converted to approximate tokens using current price, jitter and available wallet inventory; its target is not a guaranteed gross or net settlement amount.

Fee and charged/returned amounts are computed consistently by ordinary user fills under this existing model. The inconsistency is using those wallet amounts as market volume for users while recording bot BUY volume on another basis. Trading wallet accounting and chart volume must not be conflated when fixing it.

### Concrete QA traces

Amounts below are rounded for readability; QA compares unrounded values with relative tolerance.

| Fixture | Actual exchanged quote `Q` | Wallet quote | Swap fee | Recorded volume |
| --- | ---: | ---: | ---: | ---: |
| Pre user BUY, $15 gross | 14.85 | 15.00 paid | 0.15 | 15.00 |
| Pre bot BUY, $15 gross | 14.85 | 15.00 required by fee model | 0.15 | 14.85 |
| Pre user SELL, 1m tokens | 9.900990099 | 9.801980198 received | 0.099009901 | 9.801980198 |
| Pre bot SELL | 15.956870195 | 15.797301493 received | 0.159568702 | 15.797301493 |
| Post user BUY, $15 gross | 14.85 | 15.00 paid | 0.15 | 15.00 |
| Post bot BUY, $15 gross | 14.85 | 15.00 required by fee model | 0.15 | 14.85 |
| Post user SELL, 1m tokens | 9.997977081 | 9.897997310 received | 0.099979771 | 9.897997310 |
| Post bot SELL | 16.604511317 | 16.438466204 received | 0.166045113 | 16.438466204 |

Bot wallet quote in this table is the fee model's required cash flow, not a claim that its profile currently debits gross BUY cost. Actor-specific IDs produce deterministic but different market contexts; post-migration rows do not assume identical liquidity across different tokens.

## Execution limits, failures and reserve semantics

### Exhaustion and partial execution

The Slice 2A BUY exhaustion fix charges only input needed for capped token output. At `X = 1000`, `Y = 100m` and 10m tokens available, `Q = X * 10m / 90m = 111.111111111`, gross used is `112.233445567`. A request for three times this budget does not record unused input. User tape records the used gross; bot tape records the used net. Both output caps are verified. Actual pending BUY settlement also verifies the unused SOL refund, position cost and Your Trades amount; it preserves transaction cost.

Partial execution is represented as a successful FILLED result with smaller actual quantities, not a separate PARTIAL status or a residual order. The curve caps SELL tokens at `curveInitialRealToken - curveRealToken`; QA requests 20m and fills 10m. Its quote exchange is `90.909090909`, payout and recorded volume are `90`. Public pending processing first checks a fresh quote against minOut, so a changed cap can instead cause FAILED. A direct private execution fixture proves the cap's fill semantics; it does not prove every pending order will accept a reduced fill. Post-migration helpers have no equivalent real-token inventory cap; bot wallet availability can still limit its token sale.

FAILED orders create no execution volume. Submission reserves wallet SOL but does not add candle/tape/stat volume. QA worsens a pending BUY quote with a real intervening bot BUY, observes FAILED, and proves the failed order adds nothing to the existing records. Settlement refunds the reserved principal, retaining transaction cost. Invalid immediate fills and all four late user/bot BUY/SELL attempts also add zero volume. Slice 2B's separate QA covers late FAILED refund settlement.

### Virtual quote versus real collateral

Before migration, normal BUY adds `Q` to both virtual and real base reserves. SELL removes `Q` from virtual base but only `N` from real base. Thus `abs(delta real base)` is not a universal fee-exclusive oracle for this model. Fee custody is not represented by a separate audited ledger here. The report does not infer a real external pool transfer or a fee-recipient balance.

An additional forced cash-cap fixture sets real base to $1 while virtual reserves imply a larger SELL. Current execution consumes 1m tokens, pays $1 and removes `1 / 0.99 = 1.010101010` from virtual base. Unconstrained constant product for those tokens requires `9.900990099`. K changes from `100,000,000,000` to `100,897,979,797.9798`. This is a confirmed reserve-model inconsistency in the isolated capped state, separate from the volume convention. Reachability of that state through valid public trading history has not been established. Do not disguise it by recording hypothetical unconstrained volume. A separate scoped accounting investigation is needed before changing that execution behavior.

After migration, `getMigratedReserves(side)` synthesizes reserve context from price, phase liquidity and market behavior. SELL additionally applies its side-specific liquidity multiplier. `executeMigratedBuy/Sell` computes a hypothetical swap, and callers retain updated price/ownership rather than persistent AMM reserve balances. Subtracting consecutive curve snapshots after migration is therefore invalid as a volume oracle.

## Candidate contract and alternatives

Recommended for review: **market volume USD = actual fee-exclusive exchanged quote**. It is coherent for both sides and actors if explicitly scoped to the pricing model:

- BUY: actual net quote used by the curve/AMM, after input fee and after output-cap adjustment.
- SELL: actual quote removed by the curve/AMM model, before output fee. This is virtual gross quote for the current curve model, not necessarily the real collateral delta.
- Failed/rejected execution: zero. Partial execution: actual exchanged portion only. Reservations, unused budget, refunds, transaction costs and mark-to-market token value are excluded.
- Market tape, chart volume and market stat entries share this basis. Equal-time ordering, genesis and price convention remain independent.

For ordinary 100 bps fills, migration to this basis reduces user BUY market volume by 1%, leaves bot BUY unchanged and increases SELL market volume by approximately 1.010101%. Aggregate change depends on actor/side mix. This is a convention migration, not evidence that every current mismatch is an accounting loss.

| Basis | BUY | SELL | Consequence |
| --- | --- | --- | --- |
| Fee-exclusive exchanged quote | `Q` | `Q` | Comparable market turnover across actors/sides; distinct from wallet cash flow |
| Wallet cash-flow notional, including the trader's fee effect | `G` | `N` | Matches user cost/proceeds and current Your Trades; bot BUY market amount must increase |
| Gross trade quote before fee deduction | `G` | `Q` | Includes input fee for BUY but not a separate wallet credit on SELL; should not be called literal wallet cash flow |

“Gross wallet notional” needs a precise definition: gross SELL model output is not what the wallet receives. Using a single field for all three concepts leaves the ambiguity unresolved.

The candidate works for migrated hypothetical execution, but must not claim parity with a persisted external AMM ledger. The cash-cap inconsistency also prevents treating ideal constant-product output as universally executed volume. These qualifications require an explicit decision; the proposal is not approved merely by adding this audit.

## Confirmed findings and FAIL classification

1. **Mixed market-volume basis:** actor-dependent BUY recording and net SELL recording are confirmed in both phases. This violates the candidate contract, not an already declared frozen volume contract. Schema fields currently carry only numeric types.
2. **Coupled holder accounting:** `recordWalletTradeStats` uses the same recording value for bought/sold totals, cost basis, realized PnL and profile SOL. Bot BUY records net cost and debits net SOL despite a fee-bearing gross input. Four QA checks expose this profile mismatch. Changing SELL recording to gross volume would also increase holder SOL credits and PnL unless accounting is separated first.
3. **Capped SELL model:** the forced low-real-base fixture breaks constant product and the unconstrained token/quote relation. Two model FAILs describe that one isolated inconsistency, not a newly introduced regression or proof of public reachability.
4. **Propagation is consistent:** 249 integrity checks pass, including per-timeframe volume sums, tape/stat entry counts, publication, fill fee identities, actual refunds and no additional failed/late volume. There is no demonstrated duplicate recording in these matching-window fixtures.

The 182 candidate FAIL assertions are convention discrepancies against the proposed market-volume definition. The same fee-basis difference is checked at tape, stat, runtime and individual candles in eight projections; these are not 182 independent defects. They do not show a missing wallet debit or duplicate trade by themselves.

The following six FAILs concern accounting/model consistency independently of the proposed market-volume convention:

| Group / exact QA label | Actual | Expected | Cause |
| --- | ---: | ---: | --- |
| `wallet/pre/bot/BUY/holder-profile-wallet-notional` | $14.85 | $15.00 | Net curve input is reused as holder Bought/cost instead of gross fee-bearing input |
| `wallet/post/bot/BUY/holder-profile-wallet-notional` | $14.85 | $15.00 | Migrated net AMM input is reused as holder Bought/cost |
| `wallet/exhaustion/bot/holder-profile-wallet-notional` | $111.111111111 | $112.233445567 | Capped BUY correctly limits used input, but the holder profile still omits the fee on that used input |
| `wallet/mixed/bot/BUY/holder-profile-wallet-notional` | $0.99 | $1.00 | The same net-versus-gross cost mismatch persists in a mixed execution stream |
| `model/cash-cap/user/SELL/virtual-quote-vs-K-oracle` | $1.010101010 | $9.900990099 | Real-base payout is clamped without reducing the consumed token quantity to match constant product |
| `model/cash-cap/user/SELL/constant-product` | 100,897,979,797.9798 | 100,000,000,000 | The same capped SELL leaves virtual token input unchanged while reducing virtual quote output, increasing K |

The four wallet assertions directly measure the change in holder bought/sold totals. Code inspection additionally establishes that the same notional changes holder cost basis and profile SOL; these assertions do not independently measure every SOL debit or realized-PnL outcome. The two model assertions describe one cash-cap defect in a forced state, with public reachability still unverified. Neither group is evidence of a regression introduced by this audit. No production or QA expectations were changed to force green output.

## Downstream impact and feedback

| Consumer | Current use | Effect of a market-volume migration |
| --- | --- | --- |
| [`Chart`](../src/components/chart/Chart.tsx) | Histogram uses `c.volume`; hover displays it | Histogram/hover change; OHLC prices need not change for a fixed execution trace |
| [`TokenPage`](../src/pages/TokenPage.tsx), [`TradeSidebar`](../src/components/token/TradeSidebar.tsx), [`TokenCard`](../src/components/pulse/TokenCard.tsx) | Tape notionals and/or `vol5mUsd` | Displayed amounts change |
| [`TradesTablePanel`](../src/components/token/TradesTablePanel.tsx) | Market rows use tape, Your Trades use `QuickTrade` | Views can intentionally differ after migration; labels/meaning need review |
| [`BottomTabs`](../src/components/token/BottomTabs.tsx) | Tape BUY/SELL/net sums and holder totals | Top-trader rankings/net sums change; holder accounting must keep wallet basis |
| [`PulsePage`](../src/pages/PulsePage.tsx), [`pulseSorts`](../src/components/pulse/pulseSorts.ts) | Min/max volume filters, volume sort and tie-breakers | Token inclusion and ordering change at the same thresholds |
| [`SearchOverlay`](../src/components/layout/SearchOverlay.tsx) | Sort/display uses `vol5mUsd`, including an existing `volume1h` sort label | Rankings change; label/window mismatch is separate scope |
| Token store 60s flow | Counts BUY/SELL rows in recent-trade snapshots | No direct change in counts for a fixed trace; not USD-weighted flow |
| Trading store / wallet / positions | Fills drive cost/proceeds, fee, refunds and realized PnL | Must retain wallet basis; a market-volume change must not replace `filledUsd` |
| [`RegistryNarrativeRelay`](../src/tokens/registryNarrative.ts) | Big-trade thresholds/ranking use tape notional | BIG_BUY/BIG_SELL eligibility/amounts can change; narrative emits posts, not execution |

**Volume feeds future simulation.** `getFlowStrength` calls `computeFlowStrength` in [`tokenMarketRegimes.ts`](../src/tokens/tokenMarketRegimes.ts), using `vol5mUsd / mcapUsd` in a weighted heat term. Flow strength affects market behavior, quality score and regime transition decisions. `getSyntheticTradeActivityFactor` also uses volume directly for activity heat; sizing/minimum clip/splitting and cadence depend on this activity/behavior. `getMigratedReserves` consumes that behavior, including SELL liquidity. `updatePhase` captures pre-migration strength and uses strength/quality when choosing post-migration outcome.

`stepMarket` in [`marketModel.ts`](../src/tokens/marketModel.ts) produces target BUY/SELL USD and their sum; it does not directly consume the recorded tape field. However, its parameters are constructed from the volume-dependent behavior described above. Requested flow is not guaranteed executed turnover: clipping, wallet inventory, failed SELL fallback BUY and steering trades can change it.

The QA temporarily replaces only the mixed fixture's stat volumes with oracle volumes, reads flow strength, then restores the entries. The result changes from `0.00629548594007734` to `0.006294328305173782` with unchanged price/counts. This proves feedback sensitivity, not the magnitude of long-run market divergence. Subsequent sizing, transitions, price and migration timing may change as feedback compounds; no multi-seed distribution study was performed.

Replay must state the basis of imported events and retain fee/cash-flow information if converting it. Live would require explicit treatment of venue fees, quote currency valuation and input/output fee conventions. Current SIM uses fixed `$150/SOL`; neither integration nor real feeds are part of this task. There is no basis to claim the candidate matches an unspecified future provider.

## Deterministic QA and validation

[`volumeBasisQa.ts`](../src/qa/volumeBasisQa.ts) fixes time, uses ID-seeded simulator RNG and a seeded replacement for store ID randomness, restored on exit. It uses private fixture access like existing QA, with explicit reserves and seeded user/bot inventory. Fixtures isolate branches rather than reconstructing a valid launch-to-migration history. No production seam or dependency is added.

Pre-migration oracle observes actual virtual quote delta and independently checks it against constant product using executed token quantity: BUY `X * tokens / (Y - tokens)`, SELL `X * tokens / (Y + tokens)`. These equations do not use recorded notional or a production quote helper. The cash-cap case deliberately separates actual delta from ideal output. Post-migration oracle captures only `getMigratedReserves` context, then solves those equations independently; it does not reuse execution's returned quote. It is independent of notional/fee recording but not independent of reserve-context selection, which is outside this volume slice.

Candidate volume is accumulated into independent timestamp buckets for 1s/15s/30s/1m and both metrics, preserving genesis zero volume. A mixed sequence crosses bucket boundaries and checks total/entry conservation. Integrity checks against recorded tape verify propagation separately, so consistent propagation cannot hide a wrong basis. Store-backed fixtures verify capped BUY refunds and FAILED slippage settlement. Existing late and BUY exhaustion regressions remain unchanged.

```sh
./node_modules/.bin/esbuild src/qa/volumeBasisQa.ts src/qa/lateTickQa.ts src/qa/tradeTimestampQa.ts src/qa/buyExhaustionQa.ts src/qa/tradeOhlcQa.ts src/qa/curveParityQa.ts --bundle --platform=node --format=esm --define:import.meta.env.DEV=true --out-extension:.js=.mjs --outdir=/tmp/volume-audit-qa
node /tmp/volume-audit-qa/volumeBasisQa.mjs
node /tmp/volume-audit-qa/lateTickQa.mjs
node /tmp/volume-audit-qa/tradeTimestampQa.mjs
node /tmp/volume-audit-qa/buyExhaustionQa.mjs
node /tmp/volume-audit-qa/tradeOhlcQa.mjs
node /tmp/volume-audit-qa/curveParityQa.mjs
npm run build
npm run lint
```

| Validation | Result |
| --- | --- |
| Volume integrity | 249/249 PASS |
| Candidate volume contract | 83/265 PASS; 182 convention discrepancies |
| Reserve/model checks | 35/37 PASS; 2 cash-cap discrepancies |
| Holder wallet-basis checks | 12/16 PASS; 4 bot BUY discrepancies |
| Overall volume diagnostic | Exit 1; 188 diagnostic discrepancies |
| Late tick | 52/52 contract + 81/81 integration PASS |
| Trade timestamp | 350/350 PASS |
| BUY exhaustion | 135 assertions PASS |
| Trade OHLC diagnostic | 336/413; 77 discrepancies; exit 1 |
| Curve parity diagnostic | 14/18; 4 discrepancies; exit 1 |
| Build | PASS; existing chunk-size warning |
| Lint | Exit 0; 0 errors, 7 existing Hooks warnings |

Early QA development exposed a missing bot-inventory fixture and an optional-boolean TypeScript error; both were corrected in the new QA. Final results above come from the corrected source. Two further fresh-process runs produced identical stdout, stderr and exit code, confirming reproducibility of the diagnostic output. Existing QA files, package scripts and CI were not changed. The volume diagnostic is not a mandatory CI gate. Browser/manual QA was not run for this documentation/standalone-QA-only change; no production UI or behavior changed.

## Migration decisions and smallest safe vertical slice

No frozen field must be structurally changed just to express volume numerically, but repurposing `TokenRuntime.vol5mUsd` is a semantic contract migration even if its TypeScript type remains `number`. Any required edit to frozen files needs a separately approved migration note. `SimTapeTrade.notionalUsd`, published market trade rows, `Candle.volume`, stat entries and consumer documentation must explicitly agree on the selected market basis. `QuickTrade.notionalUsd` and fill amounts must remain documented wallet cash flow. Avoid reconstructing old volumes from mixed actor/side fields without original fee context.

Smallest safe proposed slice, pending STANDARD approval:

1. Approve the exact market basis, its virtual/real and post-migration interpretation, and whether market-model feedback is intended to adopt it. Accept that this can change future market behavior. If behavioral continuity is required, retaining a separately named legacy model input is another contract decision, not an incidental fix.
2. In `TokenSim`, carry actual market quote volume separately from wallet cost/proceeds at the existing recording boundary. Derive it from actual used BUY net input and actual SELL gross output, including caps. Route market volume to candles/tape/stats and keep a separate, explicitly named holder-accounting value with its existing semantics. Keep fills, trading store settlement, fee math and price unchanged. Correcting bot holder accounting from net to gross cost requires explicit additional approval; do not silently change its PnL in a market-volume patch.
3. Migrate the semantics of market fields and review display labels for market versus Your Trades amounts. Document epoch/reset requirements: SIM state is in-memory, so start a fresh session rather than mixing old/new stat windows and candles. The inspected paths do not persist tape/candles; exported or future persisted/replayed data needs a basis/version marker if supported later. Do not add one speculatively now.
4. Promote candidate volume checks only after the approved convention is implemented, keeping reserve/accounting diagnostics separate. Run unchanged regression suites and supported lifecycle/trading browser QA. Add bounded deterministic feedback comparisons and assess near-threshold regimes/migration outcomes; isolated swap equality is insufficient to claim unchanged economics.

The forced cash-cap execution fix and bot fee/PnL correction should be independently scoped if not essential to the approved market-volume routing. No larger execution rewrite, provider, event bus or new abstraction is proposed.

Open decisions: exact holder accounting migration, intentional market-feedback recalibration, UI terminology and treatment of capped collateral states. Deferred: integer AMM parity, fee custody, public reachability of the cash-cap state, complete partial-fill order policy, long-run market distributions, historical data conversion and Replay/Live design. This audit stops before production implementation.

## Slice 2C1 implementation - pending code review

The Human approved fee-exclusive exchanged quote as the market-volume contract. Branch `fix/market-volume-basis` retains audit commit `799d903fc981f079cee1c1c5b2fe0b78569bcc04`, based on `main` at `9ffdca1`. The preceding audit describes pre-change behavior; this section records the implementation. No PR has been created.

### Recording boundary and data-contract migration

`TokenSim.recordTradeTick` now takes separate `marketVolumeUsd` and `walletNotionalUsd` arguments. Market volume goes to all eight candle aggregators, stat entries and tape `notionalUsd`. `vol5mUsd`, published market snapshots and model flow consume those market values through the existing path. `walletNotionalUsd` alone reaches the existing `recordWalletTradeStats` logic.

| Execution branch | Market volume source | Holder-accounting input retained |
| --- | --- | --- |
| Pre user BUY | `buy.baseInUsd`, actual used net quote | Existing `filledUsd`, gross used cost |
| Pre bot BUY | `buy.baseInUsd` | Same net amount as before; known bot cost defect preserved |
| Pre user SELL | `sell.baseOutUsd / feeFactor`, already computed as `grossOutUsd` | Existing `filledUsd`, net proceeds |
| Pre bot SELL | `sell.baseOutUsd / feeFactor` | Existing `sell.baseOutUsd`, net proceeds |
| Post user BUY | `buy.baseInNetUsd` | Existing `filledUsd`, gross cost |
| Post bot BUY | `buy.baseInNetUsd` | Same net cost as before |
| Post user SELL | `sell.baseOutGrossUsd` | Existing `filledUsd`, net proceeds |
| Post bot SELL | `sell.baseOutGrossUsd` | Existing `sell.baseOutNetUsd`, net proceeds |

These are successful execution results, not requested budgets. Capped BUY uses only consumed net input. Pre SELL derives actual gross from the final payout after any cash cap, matching the current execution's virtual quote deduction. The $1 cash-cap fixture records `1.010101010` market USD, not the unconstrained `9.900990099`. Its reserve-model defect remains unchanged. FAILED, invalid and late executions still produce no additional volume.

This is a **semantic data-contract migration** for `SimTapeTrade.notionalUsd`, published market trade notionals, `Candle.volume`, `StatBucket.volUsd` and `TokenRuntime.vol5mUsd`. They now uniformly mean actual fee-exclusive quote exchanged by the pricing model. Their numeric structures are unchanged; neither frozen types file was edited. Normal user BUY market volume decreases by 1%; bot BUY stays unchanged; SELL market volume increases by approximately 1.010101% at the existing 100 bps fee.

`UserTradeFill.filledUsd`, `filledSol`, `feeUsd`, refund/transaction-cost handling, trading position cost, PnL and `QuickTrade.notionalUsd` retain wallet basis. Your Trades and market tape can therefore intentionally show different USD amounts for the same user trade. Holder profiles retain every old per-execution accounting input, including the bot BUY net-cost inconsistency. No fee/PnL correction is bundled into the volume migration.

Start a fresh SIM session when applying this version. Existing in-memory candles, tape and stat windows cannot be mixed across the semantic boundary; they have no basis/version marker. No persisted-state conversion, Replay/Live provider or historical reconstruction was added.

### QA changes and results

The 265 volume expectations and 249 integrity expectations are unchanged. Their results now pass against the approved contract. The model/cash-cap and holder-cost diagnostics retain their original expectations and all six known FAILs. `candidate` remains the historical QA group name for the now-approved volume contract.

The old feedback assertion replaced current stat entries with candidate entries. Those entries are now already on the new basis, so QA instead constructs the legacy basis for the same fixed execution trace, measures it, and restores the actual market entries. It checks both flow strength and synthetic activity change. This temporary fixture comparison is confined to QA; production has no legacy feed or compensating weights.

Ten additional settlement assertions execute a real pending BUY and SELL via the existing registry/store path. They verify Your Trades notional/fee, gross BUY position cost, remaining SELL cost, net-proceeds realized PnL, wallet PnL and actual SOL settlement including transaction costs. Existing capped BUY and FAILED/refund checks remain in the integrity group.

| Check | Audit baseline | Slice 2C1 |
| --- | --- | --- |
| Market-volume contract | 83/265, 182 discrepancies | 265/265 PASS |
| Integrity | 249/249 | 249/249 PASS |
| Reserve/model | 35/37, 2 cash-cap FAIL | 35/37, same 2 FAIL |
| Holder accounting | 12/16, 4 bot BUY FAIL | 12/16, same 4 FAIL |
| Additional wallet settlement | Not present | 10/10 PASS |
| Overall volume diagnostic exit | 1, 188 discrepancies | 1, only 6 retained diagnostics |
| Isolated swap differential | Not present | 12/12 identical economics versus `799d903` |
| Late Tick | 52/52 + 81/81 | 52/52 + 81/81 PASS |
| Timestamp | 350/350 | 350/350 PASS |
| BUY exhaustion | 135 | 135 assertions PASS |
| Trade OHLC diagnostic | 336/413, 77 discrepancies | 335/413, 78 discrepancies; exit 1 |
| Curve parity diagnostic | 14/18 | 14/18; same 4 discrepancies; exit 1 |
| Build | PASS | PASS; chunk-size warning |
| Lint | 0 errors, 7 warnings | Exit 0; 0 errors, 7 existing Hooks warnings |

The original audit QA was rerun in an isolated baseline tree and reproduced its published counts. The unchanged OHLC diagnostic removes three uniform-volume failures but adds four assertions that equate user tape notional/average price with wallet fill amounts. Those identities no longer hold under the approved separation; its oracle also retains the separate OHLC/convention findings. Its net change of one additional FAIL is explained by semantics, not a new swap-accounting failure. No existing QA file outside `volumeBasisQa.ts` was modified, and no diagnostic was added as a CI gate.

### Identical-state single-swap comparison

`volumeBasisQa.ts` emits `ECONOMICS` JSON for 12 isolated cases: all eight actor/side/phase combinations, user and bot exhaustion, partial SELL and cash-cap SELL. Traces contain initial/final curve state, captured migrated reserve context, fills, ledger, holder profiles, final price/mcap/phase, last swap, trade token/price data and RNG state. They deliberately exclude the market-volume fields being migrated. Each case starts from the same explicit fixture and seeded state in both revisions.

The updated harness was run against the old `TokenSim` from `799d903` and the new one. All 12 economic traces matched exactly, including the two known capped-model diagnostics. This establishes equality for those isolated executions; it does not claim identical future market paths after feedback changes. The actual pending settlement checks independently verify the wallet-basis formulas.

Reproduce this comparison after building the current QA bundle using the command in the audit section above:

```sh
python3 - <<'PY'
import json
import os
import shutil
import subprocess
import tempfile

root = tempfile.mkdtemp(prefix='volume-differential-', dir='/tmp')
shutil.copytree('src', root + '/src')
shutil.copytree('config', root + '/config')
os.symlink(os.getcwd() + '/node_modules', root + '/node_modules')
with open(root + '/src/tokens/tokenSim.ts', 'wb') as file:
    file.write(subprocess.check_output(['git', 'show', '799d903:src/tokens/tokenSim.ts']))
subprocess.run([
    './node_modules/.bin/esbuild', root + '/src/qa/volumeBasisQa.ts', '--bundle',
    '--platform=node', '--format=esm', '--define:import.meta.env.DEV=true',
    '--outfile=' + root + '/baseline.mjs',
], check=True)
def trace(path):
    run = subprocess.run(['node', path], capture_output=True, text=True)
    # Both revisions retain diagnostic FAILs; compare the economic export itself.
    assert run.returncode == 1
    return json.loads(next(line[10:] for line in run.stdout.splitlines()
                           if line.startswith('ECONOMICS ')))
old = trace(root + '/baseline.mjs')
new = trace('/tmp/volume-audit-qa/volumeBasisQa.mjs')
assert len(old) == len(new) == 12
for before, after in zip(old, new):
    assert before == after, before['label']
print('Single-swap differential: 12/12 identical economic traces')
PY
```

### Feedback, consumers and limits

For the fixed mixed execution trace, legacy versus market basis changes flow strength from `0.00629548594007734` to `0.006294328305173782` and synthetic activity from `0.1346104164910008` to `0.13459568882785103`. Prices and counts are held fixed during this measurement. Production uses the new `vol5mUsd` directly, with unchanged regime weights and simulation parameters. Later liquidity context, sizing, regime decisions and migration outcomes may diverge as intended; no full multi-tick equality or long-run distribution equivalence is claimed.

Pulse volume filters, sorting and displayed totals now use fee-exclusive market volume. Chart histograms and market tape follow the same basis. Narrative big-trade thresholds/ranking also read the new notionals, so post eligibility may change. Existing UI labels and Your Trades remain unchanged; the market-versus-wallet distinction is documented here rather than introducing UI work into this slice. Count-based BUY/SELL flow has the same immediate counts for a fixed accepted trace; subsequent activity may change through model feedback.

Remaining risks are the separately documented cash-cap SELL accounting defect, bot holder cost defect, in-memory mixed-basis sessions and the synthetic post-migration reserve interpretation. Slice 2B's fan-out invariant alarm still has no rollback for unsupported private-state desynchronization. This change does not alter that admission proof or add recovery behavior.

Both Windows QA launchers were attempted sequentially and exited 127 because PowerShell is unavailable. Full browser/manual lifecycle and trading verification, including the five-minute run, remains unverified on this host. A permitted local Vite launch returned HTTP 200; that proves serving/startup only, not browser execution. Production changes are confined to `tokenSim.ts`; aggregators, frozen types, curve/AMM math, fees, latency/slippage, migration rules, OHLC/genesis conventions, UI/store, dependencies and Replay/Live architecture are unchanged.

## Slice 2C2 - bot BUY holder accounting

Base: `bbae15b` after PR #48. Branch: `fix/bot-holder-buy-accounting`. This slice resolves the four bot BUY holder-cost diagnostics above; the two cash-cap SELL diagnostics remain. The preceding audit and Slice 2C1 results are historical snapshots.

Cause: bot BUY passed net input as both market volume and holder notional. `recordWalletTradeStats` consequently omitted the swap fee from Bought, average entry, open cost and profile SOL debit, overstating later realized PnL. The fix changes only the BUY holder argument: pre migration uses actual `buy.baseInUsd / feeFactor`, including exhaustion caps; post migration uses `buy.baseInGrossUsd`. Market volume stays net. `recordWalletTradeStats`, SELL, swap math, fees and trading wallet settlement are unchanged.

Holder cost basis now includes gross used BUY cost. Average BUY is cumulative gross cost divided by purchased tokens. SELL still records net proceeds, allocates average cost proportionally to sold tokens, leaves the remaining cost with the open position and realizes net proceeds minus allocated cost. Profile SOL decreases by gross BUY cost / 150 and increases by net SELL proceeds / 150; the existing zero-floor behavior is retained. No requested-but-unused budget is charged at exhaustion.

`volumeBasisQa.ts` retains all previous expectations and adds 162 holder checks. Four existing bot BUY fixtures (pre/post, exhaustion and mixed flow) additionally verify open-cost increment, average entry, SOL debit, no immediate realized PnL and token inventory. Two isolated holder fixtures cover BUY, partial SELL and full SELL before/after migration. Each starts with no other holders; assertions verify the actual tape walletId is the BUY holder on both SELLs. Normal selection and swaps run unchanged. A private observer captures profile SOL before its initial debit; no public test API is added. The cycles check all holder amounts/averages, inventory, remaining cost, PnL, swap fee and volume in all eight projections.

| Check | Slice 2C1 | Slice 2C2 |
| --- | --- | --- |
| Market volume / integrity | 265/265 / 249/249 | 265/265 / 249/249 PASS |
| Holder accounting | 12/16, four FAIL | 16/16 PASS |
| User wallet settlement/PnL | 10/10 | 10/10 PASS |
| New holder/cycle checks | Not present | 162/162 PASS |
| Reserve model | 35/37, two FAIL | 35/37, same two cash-cap FAIL |
| Late Tick | 52/52 + 81/81 | 52/52 + 81/81 PASS |
| Timestamp / BUY exhaustion | 350/350 / 135 | 350/350 / 135 PASS |
| OHLC / curve diagnostics | 335/413 / 14/18 | 335/413 / 14/18; exit 1 |
| Build / lint | PASS / 7 warnings | PASS / 0 errors, 7 existing Hooks warnings |

The volume diagnostic now exits 1 only for the two unchanged cash-cap model assertions. No mandatory CI gate was added. Existing reproduction commands build the extended QA; it also emits `HOLDER_CYCLES` and expanded `ECONOMICS` JSON for comparison.

Economic regression used the same updated harness with `TokenSim` from `bbae15b` in a temporary tree and the current source. Across 12 isolated swaps, execution quantities, reserves, price/mcap, fills/fees, RNG, market tape, stats, all eight OHLCV series and the user's trading wallet matched exactly. Only the three isolated bot BUY cases changed holder profiles: gross bought/open cost and average entry increased by the fee effect, while SOL decreased accordingly. The mixed-stream holder change is checked separately by the existing wallet assertion and added accounting checks.

Across six stages of the two same-holder cycles, all market/execution/inventory/user-wallet data also matched exactly. Differences in open cost equal the BUY fee times the unsold fraction; realized PnL decreases by the fee times the sold fraction; SOL is lower by the BUY fee / 150. Sold totals/averages and token quantities are unchanged. Comparison allowed only these named holder fields and verified their expected deltas, rather than ignoring whole profiles. The older Slice 2C1 full-profile equality command is historical and must be run at that revision; full holder-profile equality is intentionally invalid for Slice 2C2.

Scope is three files: `tokenSim.ts`, this report and `volumeBasisQa.ts`. No market-volume semantic change, frozen types, aggregator, curve/AMM, fee model, stores, migration, regime parameters, UI or Replay/Live changes. A fresh SIM session avoids mixing earlier understated costs with corrected BUY entries; old profiles are not retroactively recalculated. Future actor behavior may diverge if it consumes corrected profile accounting; isolated regression does not claim equality of all future paths. The cash-cap SELL model defect and its unverified public reachability remain separate work.

Two fresh-process QA runs produced identical output. Both Windows browser QA launchers were attempted sequentially and exited 127 (`powershell` unavailable). Full manual/browser lifecycle and trading checks remain unverified on this Linux host; a permitted Vite startup returned HTTP 200, which checks serving only. Build retained the chunk-size warning. No PR is created by this task; the dedicated commit is prepared for code review.
