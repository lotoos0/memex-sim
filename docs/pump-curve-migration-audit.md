# Slice 3A — Pump.fun curve and migration contract audit

Date: 2026-11-04. Audited local main: `7aa11cbebe335093ec62f99e4c0d05e98110df51`. Audit and implementation plan only. The pre-existing untracked `docs/trading-core-regression-signoff.md` was preserved. This task adds only this report; no production changes, frozen-contract edits, dependency additions, PR or deployment.

## Finding and scope of evidence

The reported `rTok=0`, progress 100%, FINAL, hasMigrated=false, No liquidity state is internally reachable. Completion uses real-token depletion, while migration independently uses a USD market-cap threshold. Neither implies the other with today's randomized reserve configuration. This is a contract mismatch for the requested completion-driven target, not evidence that refund/K accounting is broken.

A temporary standalone fixture used the ordinary constructor and actual execution, with no reserve or phase overrides: Date.now=1800000000000; id=pump-audit-0; NORMAL fate; supply=1B; start MCAP=2000; fate timeout=1000000; metrics topHolders=10, dev=2, snipers=1, LP=100, insiders=1, bundlers=1. Call executeUserTradeImmediate(BUY, 1000000 SOL, now). This isolated engine fixture deliberately bypasses wallet affordability; it establishes reachability from generated reserves, not a naturally timed public-session reproduction.

| Snapshot | Observed value |
|---|---:|
| Initial virtual tokens | 1,228,152,137.3229835 |
| Initial real tokens | 918,369,010.2212131 |
| Initial virtual USD / real USD | 2456.304274645967 / 40 |
| Actual gross charged | USD 7355.402284280474 = 49.03601522853649 SOL |
| Tokens filled / remaining real tokens | 918,369,010.2212131 / 0 |
| Terminal virtual tokens / virtual USD | 309,783,127.1017704 / 9738.152536083637 |
| Terminal MCAP | USD 31,435.3871600129 |
| K before and after | 3,016,715,344,822.025; drift 0 |
| Phase / progress / migrated | FINAL / 100% / false |
| Next BUY quote, 0.1 SOL | No liquidity |
| SELL quote, 1000 tokens | accepted, 0.0002074728855262947 SOL |

The last observation matters: depletion is not currently a sticky completed state; selling can refill the curve. The UI symptom alone does not prove permanent immobility: selling or lifecycle death can change it. There is, however, no bounded completion-to-migration guarantee, and further BUY cannot raise MCAP after inventory is exhausted. Conversely, a curve can pass the fixed MCAP threshold with tokens still available and migrate prematurely relative to the requested target. Existing buyExhaustionQa explicitly allows exhausted curves below the threshold to reject subsequent BUY; prior passing tests therefore do not certify the new desired lifecycle contract.

## Reference sources and version boundaries

Reference SDK pinned during this audit to **a4fd02bf8a2720fce1cecadd9afe229e60719657**, rather than an unversioned main:

- [SDK bondingCurve.ts](https://github.com/nirholas/pump-fun-sdk/blob/a4fd02bf8a2720fce1cecadd9afe229e60719657/src/bondingCurve.ts): quote arithmetic, configurable initialization, migrated-state detection and v3 quote paths.
- [SDK curve mathematics](https://github.com/nirholas/pump-fun-sdk/blob/a4fd02bf8a2720fce1cecadd9afe229e60719657/docs/bonding-curve-math.md): standard SOL reserve example, completion and graduation semantics.
- [SDK mirrored synthetic-migration specification](https://github.com/nirholas/pump-fun-sdk/blob/a4fd02bf8a2720fce1cecadd9afe229e60719657/docs/pump-official/docs/SYNTHETIC_MIGRATION.md).
- [Current first-party Pump program documentation](https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_PROGRAM_README.md), consulted 2026-11-04; mutable, not a live account read.
- [Current first-party synthetic migration documentation](https://github.com/pump-fun/pump-public-docs/blob/main/docs/SYNTHETIC_MIGRATION.md), consulted 2026-11-04.

Context7 resolved the exact requested SDK and supplied graduation documentation; raw pinned files and current first-party docs were also read. `docs/MIGRATION.md` in the SDK is primarily a package-upgrade guide, not a definition of curve graduation. No RPC, account fetch, wallet SDK or live trading integration was used. Published examples are not a guarantee of current on-chain Global configuration or a complete protocol implementation specification.

Distinguish three scopes. The standard SOL example supplies a useful fixed reference profile. Other quote mints, pump-coin recursive quoting, configurable Global reserves and Mayhem have different admission/initialization behavior. V3 synthetic migration is a separate execution contract: a completing BUY can consume a curve leg and a pool-to-be leg. Legacy partial-fill behavior and refund must not be silently replaced by that whole-budget route. First-party docs state that completed curves reject further curve trades until migration, while a separate migration operation creates the pool. Therefore completion and pool readiness are distinct concepts even when the simulator elects to perform them atomically.

The SDK separates protocol/creator fees and integer rounding; Slice 2E already established that memex-sim uses a coherent but different fee-on-gross convention. Adopting reserve/completion rules alone must be described as a Pump-inspired SOL profile, not full SDK fee or instruction parity.

## AS-IS versus proposed target

| Concern | AS-IS | Proposed target, subject to decisions below |
|---|---|---|
| Initial reserves | Archetype/random ratios; USD MCAP determines virtual quote | One versioned standard-SOL profile with explicit virtual/real reserves |
| Progress | clamp(1-rTok/rTok0); reversible after SELL | Same quantity measure while open; sticky completion once terminal BUY commits |
| Migration trigger | MCAP >= 228*150 USD | Valid completing BUY with real token reserves depleted; no market-cap gate |
| FINAL | Sticky hasEnteredFinal after FINAL_PROGRESS | UI approach phase, never an unbounded completed trading mode |
| Completed curve | No separate completion latch; SELL can reopen | Curve BUY and SELL closed; handoff cannot be undone by a pending SELL |
| Pool readiness | hasMigrated/phase switch plus 2-4s bot freeze | Explicit atomic simulated handoff, or separately bounded ready state if approved |
| USD valuation | Multiple constants fixed at 150 | One immutable session valuation, default 150 |
| Chart marker | Global USD threshold | Derived profile completion reference and actual handoff event coordinates |
| Post-migration market | Per-call synthetic reserves anchored at last price | Initially retain approximation with documented continuity; authentic pool is a separate decision |

## Existing implementation and dependency map

`src/tokens/tokenSim.ts:2393` initializes real supply from an archetype ratio, virtual tokens from another multiplier, virtual USD as startPrice*virtualTokens, and real USD as startMcap*0.02. These are not the standard reference seeds. Consequently a universal completion MCAP cannot be inferred from start MCAP alone.

`getCurveProgress` at 2532 computes quantity depletion correctly for that generated initial inventory, but there is no sticky complete flag. `updatePhase` at 1747 sets hasEnteredFinal from progress and migrates solely when lastMcapUsd reaches getMigrationThresholdUsd. It does not test rTok==0 or runtime readiness. Runtime readiness (age >=90 simulated seconds, >=30 real-window transactions, >=120 holders) affects flow only. It is not an additional hard migration predicate. RUGGED becomes DEAD before normal migration logic; already MIGRATED/hasMigrated guards prevent duplicate events in ordinary serial execution.

`src/tokens/tokenMarketRegimes.ts:20-21,572-574`: 228 SOL and a separate USD reference 150 produce USD 34,200. Frozen `src/tokens/types.ts` still exports USD 69,000 and SOL_PRICE_USD=150; the legacy threshold is not the runtime migration gate. Do not reconcile it incidentally.

Every direct threshold call and its downstream use found in production:

| Location | Use and required migration |
|---|---|
| tokenSim.ts:498 | Post-migration overextension/plateau and retest behavior; derive anchor from actual completion/handoff, not old global threshold |
| tokenSim.ts:633 | Approach friction, readiness overshoot penalty; quantity progress must govern approach |
| tokenSim.ts:741 -> tokenActors.ts:173 | Actor overlay progressToMigration, nearMigration >=0.72 or hasEnteredFinal; use explicit normalized depletion |
| tokenSim.ts:1044 | applyPreMigrationFlowGuard threshold-price cap, expected-price steering and buy/sell balancing; remove fixed-price admission implications |
| tokenSim.ts:1763 | Phase gate and event price/mcap; completion predicate and actual event coordinates required |
| components/chart/Chart.tsx:156 | Memoized static migration line and PRICE conversion; use session/profile-derived reference and per-token actual event |
| tokenMarketRegimes.ts:572 | Threshold helper definition; replace internal consumers coherently |

`tokenBuckets.ts` uses phase and >=80% bonding progress for Final Stretch rather than the global USD gate. It explicitly excludes progress=100 and DEAD/RUGGED/MIGRATED; an aged FINAL token at 100% can therefore disappear from both New Pairs and Final Stretch without entering Migrated. Preserve bucket meaning and ensure completion hands off. `generator.ts` starts fresh tokens at USD 2000, and registry constructs both fresh and bootstrapped simulations with that seed and bootstrapAdvance. Fixed standard SOL reserves at USD 150 imply a different launch MCAP, so these paths need an explicit initialization policy. Archetypes should vary activity/fate rather than silently alter the chosen reserve contract.

BUY estimate/execution (2536/2599) cap output, inverse-solve required input and refund unused gross budget through existing settlement. SELL currently replenishes real tokens and uses a real-quote defensive guard. User execution calls updatePhase after recording a successful trade; bot flow updates curve state during the tick and updatePhase runs at the tick end. A target completion latch must therefore cover both user and bot entrypoints immediately, including multiple bot executions within one tick, not only updatePhase.

`tick` processes pending user orders before background flow. `processPendingUserTrades` at 2073 sorts due orders by priority, then execution/submission time, requotes each against current state, checks original minOut, and emits FILLED/FAILED notices. A completing earlier order can change the execution model for later orders in the same due batch. Migration's current freeze changes bot behavior and blocks executeSimBuyTrade, while immediate user execution does not apply that same freeze guard. A documented readiness policy must replace this asymmetry.

`registryExecutionRelay.ts` publishes runtime and notices; tradingStore settles reservations and wallet/position cost/PnL from fills. No order may be silently removed at handoff. Failed economic execution should not create tape, candles, holder mutations or fill PnL, but reservation release, FAILED audit history and the already-declared transaction-cost policy are legitimate settlement effects, not forbidden mutations.

## Exact reference reserve contract and independent mathematics

Choose units explicitly: SOL quote, whole tokens in explanatory equations, total supply S=1,000,000,000 tokens; integer parity later uses 1e9 lamports/SOL and 1e6 units/token. Standard illustrative profile:

- X0=30 SOL virtual quote; Y0=1,073,000,000 virtual tokens.
- R0=793,100,000 saleable real tokens; real quote initially zero.
- K=X0*Y0=32,190,000,000 SOL*tokens.
- Open-curve progress q=1-R/R0; the completion operation consumes precisely the remaining R and latches completion.
- Yf=Y0-R0=279,900,000 virtual tokens. Xf=K/Yf=115.005359056806 SOL.
- Net quote raised Xf-X0=85.005359056806 SOL, excluding fees.
- Marginal terminal price Pf=Xf/Yf; terminal MCAP Pf*S=410.8801681200643 SOL.
- Initial MCAP X0/Y0*S=27.958993476234856 SOL.
- At session SOL/USD P=150: initial MCAP USD 4193.849021435228; terminal MCAP USD 61632.02521800964.

These values were calculated independently in PowerShell during the audit. Integer division/fee conventions move dust-scale outcomes; the equations are continuous reference values, not exact on-chain instruction outputs. 228 SOL is neither terminal virtual quote (~115), net raise (~85), nor terminal MCAP (~410.88) for this profile. Replacing only 228 with 410.88 would still leave incorrect MCAP-based completion semantics and randomized reserves.

For an ordinary net BUY N: output T=Y*N/(X+N), capped at available R. For a completing capped BUY: Nused=X*R/(Y-R); gross charged depends on approved fee convention. Under today's fee-on-gross, Gused=Nused/0.99; unused gross budget is refunded. Under reference fee-on-net plus rounding, gross is net plus separately rounded applicable fees. Neither changes the continuous terminal marginal price when reserves and saleable quantity are fixed. No oversize budget is spent on a pool leg in the proposed legacy-partial-fill profile.

Before completion a SELL of T moves Y to Y+T and X to K/(Y+T), increases real token inventory and reduces progress. Target real quote debits and fee custody need a separate explicit accounting convention: the current SELL retains the fee-sized residual in real quote, whereas authentic reserve accounting must distinguish quote leaving reserves from fee transfers. Full reserve parity cannot be claimed while leaving this ambiguity unaddressed. Maintain the current cash-cap rejection until a separately approved account model replaces it.

## Completion, handoff, price continuity and pending-order proposal

Recommended minimum simulator policy: completing trade commits its capped fill and price, latches completion, then atomically initializes the simulated migrated market and sets MIGRATED/hasMigrated once before another execution can enter the curve. Completion and pool-ready are separate internal steps within one synchronous operation, so existing TokenPhase need not grow. There is no await, external transaction, permanent FINAL-completed state, or real wallet action. A diagnostic completion snapshot can be private to TokenSim. Do not reuse `rTok==0` alone as a completion latch after a protocol-faithful migration zeroes other reserves; retain historical initial and terminal information for reporting.

A presentation shock/freeze may remain, but must not ambiguously mean pool unavailability. Proposed default is that migrated execution is immediately available while shock governs background activity. If product requires a simulated migration delay, use a private bounded deadline/readiness flag, reject both BUY and SELL symmetrically with a specific reason while waiting, and guarantee transition by that deadline independently of flow, age, holders and MCAP. This is an alternative requiring approval, not an extra hidden gate.

No early migration: neither high USD MCAP, actor activity, holder count nor elapsed time may latch completion before terminal inventory depletion. Readiness/age conditions may tune activity only and cannot block an already completed curve. DEAD/RUGGED precedence and fate timeout at the completing timestamp require a deterministic explicit decision; recommended successful completing fill wins and handoff happens before subsequent fate logic.

Completing BUY fills only the curve leg and settles its actual cost/refund once. Proposed subsequent pending orders reprice on the migrated market using existing execution-time semantics and their original minOut. They may fill or fail slippage; a prior curve quote is not a price guarantee. The completing order must not be requoted or executed twice. Later SELL must not refill the completed curve. Priority and equal-time insertion order remain stable. Fill, migration event and user-event publication must have explicit deterministic ordering at the same timestamp; propose successful fill observation followed by one MIGRATION observation, with terminal fill coordinates. Reject stale timestamps before changing either phase or reserves.

Price continuity is a product tradeoff, not automatic protocol parity. Current getMigratedReserves synthesizes quote liquidity and sets token reserves=quoteLiquidity/lastPrice, even with side-dependent liquidity; it preserves the starting marginal price but is not a persistent authentic AMM. Reference pool quote is raised quote less applicable migration costs and pool base is the actual remaining physical token balance, not Yf virtual tokens. For a simple 1B physical-supply assumption the unsold physical inventory is 206.9M, not 279.9M; actual account balances/configuration must determine the pool. Real-pool opening ratio need not equal the terminal virtual ratio. Do not force price equality by silently inventing physical liquidity.

Recommended 3B preserves the existing simulated-market continuity approximation, seeds its anchor from the actual final reserve ratio, and labels it accordingly. Authentic pool custody/fees/reserve transfer would need another approved design; v3 pool-to-be execution is explicitly excluded. Assert no change in lastPrice/lastMcap or zero-volume fake trade during the handoff itself. A later real migrated trade can move price. Chart MIGRATION marker must use the actual handoff price, not the old threshold line, and all eight aggregators keep ordering and genesis conventions.

## Session SOL/USD valuation and frozen contracts

Do not edit SOL_PRICE_USD in frozen types.ts as a shortcut. Add a small immutable session configuration outside frozen contracts, defaulting to the existing value 150; freeze/capture it when a registry session starts. Store the standard profile in that same explicit configuration or a small local configuration module, not a provider abstraction. All tokens and stores in one session must use the same captured rate. A new session may select another deterministic configured rate; do not update an active session, revalue historical fills in place or add a live feed.

Prefer keeping current USD internal fields for the first reserve migration: initialize virtual USD=30*P and real USD=0, while ratios/costs convert through the single session rate. This is a simulation approximation rather than integer SOL accounting. A later integer-ledger decision has separate rounding and type implications. Existing frozen exports may remain compatibility defaults, but active consumers must agree and the obsolete threshold must not control behavior.

Impact of changing only the frozen constant: TokenSim BUY budget, SELL SOL proceeds, bot clip sizes, profile SOL accounting, liquidity-holder conversion and every quote/fill fee conversion change. walletStore solToUsd/usdToSol affects reservations, SOL-target SELL quantities and realized PnL; UI trades use a separate hardcoded 150; TradeSidebar.tsx:221 hardcodes the displayed conversion as 1 SOL = $150. tokenMarketRegimes has a separate 150 so the threshold would not follow. Dollar MCAP floor/cap, generator USD2000 start, soft targets and dead-floor behavior are further independent USD policies. A rate change can therefore alter natural lifecycle and execution unless those choices are explicit.

## Proposed minimal vertical slices, each requiring approval

### 3B — completion-driven handoff on the existing simulated curve

Goal: remove the reproduced inventory-exhausted FINAL stall and pre-completion migration without bundling reserve/fee migration. Files: tokenSim.ts completion admission, bot/user sequencing, phase/event handoff and actual event coordinates; Chart.tsx migration reference/actual marker semantics; narrow new completion QA; update lifecycle contract docs. Preserve fee model, current generated reserves, frozen types and existing wallet interfaces. Keep migrated price anchored to actual terminal price. A global predictive price line cannot represent randomized completion; calculate a per-token reference from its initial reserves using a non-frozen internal snapshot/callback shape, or temporarily show only actual migration events until 3C. Approve that UI choice explicitly. Readiness/steering must not prevent completion-to-handoff; no new provider or store-owned engine.

Acceptance: one completing fill/refund, exactly one event, no pre-completion migration, no price jump on handoff, same-timestamp user/bot safety, late rejection before mutations, explicit pending-order policy. Existing below-migration exhaustion expectation changes deliberately: a completed curve must now hand off regardless of its dollar value. Regression fixtures must be versioned/updated with that rationale rather than masking old diagnostics.

### 3C — standard SOL reserve profile and coherent session valuation

Goal: end-to-end standard seeds and derived valuation across engine, stores and UI. Likely files: new small session/profile configuration outside frozen types; tokenSim.ts initCurveState, USD/SOL conversion and derived anchors; tokenMarketRegimes.ts global threshold retirement; tokenActors.ts normalized depletion input; generator.ts launch valuation policy; registry.ts fresh/bootstrap session initialization; walletStore.ts and tradingStore.ts conversion entrypoints; Chart.tsx and token trading/trades display consumers. Keep tokenId keys and registry/store ownership. This slice is broader because partial currency adoption would create internally inconsistent settlement.

Acceptance: 30/1.073B/793.1M profile, zero initial real quote, derived 410.880168-SOL reference, same SOL curve trajectory at two fixed session rates, correct USD scaling, positive real liquidity guards, no frozen-file changes. Refresh/session-reset semantics explicit. Choose reserve accounting and fee-parity scope before coding; retain fee-on-gross under an explicit hybrid-profile label if full parity is deferred. Archetype reserve randomness becomes behavior-only variability. QA expected launch/floor and natural cadence values must be intentionally recalibrated.

### 3D — natural lifecycle, migration-boundary integration and UI sign-off

Goal: prove the selected contract through public runtime flows without private phase/reserve/debug overrides. Primarily add focused QA and browser fixtures plus documentation; production fixes only under a separately reviewed plan if evidence requires them. Existing relevant files: src/qa/buyExhaustionQa.ts, cashCapSellQa.ts, volumeBasisQa.ts, lateTickQa.ts, tradeTimestampQa.ts, ohlcConsistencyAuditQa.ts, curveParityAuditQa.ts, quickLimitQa.ts and Windows scripts. No mandatory CI gate is implied.

Run deterministic multi-seed sessions with unmodified generation/flow, exercising 99.99% -> depletion -> handoff under user and bot completing trades. Some fates should die rather than graduate; do not assert universal migration. Test pending BUY/SELL and open limits across handoff, fees/refunds, history and store/UI agreement, marker location and persistence. If existing natural flow cannot reach completion because friction/steering fights the new anchor, report the failing seed and approve a narrow tuning change rather than override phase in the test. Freeze-type migration, full persistent PumpSwap accounting and v3 crossing remain separate decisions.

## QA matrix and regression risks

| Scenario | Required evidence |
|---|---|
| 99.99% versus 100% | No early migration; exact output cap; completed latch and one handoff |
| Oversize completing BUY | Capped tokens, independently inverse-solved cost, unused budget refunded once, K within stated precision |
| Pending BUY then SELL, opposite priority, equal timestamps | Requote on selected execution venue, original minOut enforced, no curve reopening, no duplicate settlement |
| Failed/slippage/late order at boundary | Reserve/phase/ledger/profile/tape/candles unchanged; wallet reservation released per policy and failure audit retained |
| Bot batch completes mid-tick | Next bot execution uses migrated venue or explicit waiting policy; no extra curve trade before tick-end updatePhase |
| Repeat updatePhase/tick/drain | Exactly one MIGRATION event and one fill notice per order; all eight aggregator volumes counted once |
| Handoff | Terminal and initial migrated marginal price equal for chosen simulated continuity policy; marker uses actual coordinates; no synthetic trade |
| Natural public lifecycle | Seeded flow reaches NEW/FINAL/completion/MIGRATED or legitimate DEAD without overrides; no completed FINAL stall |
| Rate P=150 versus another fixed rate | SOL output/reserve curve equivalent; USD price/volume/cost scale; SOL PnL and refund consistent |
| New reserve profile | Independent initial/terminal calculations, physical versus virtual inventory distinguished, no MCAP-floor clipping of intended launch |
| UI / reload | Pulse buckets, B.Curve, marker, positions, Your Trades, limits and PnL agree; documented session reset preserved |

Trading QA is sensitive to seed, constructor RNG consumption, migration timing, market venue, supply ratios and price floors. Old 335/413 and 14/18 are historical convention baselines, not universal acceptance targets after an approved economics change. Preserve historical evidence and create explicit model-version expectations. Current new audit suites also assume below-threshold exhaustion stays non-migrated; review those assumptions. Cash-cap test's hardcoded 150 and reserve-forcing fixtures need both compatibility coverage and new public-path coverage. Execute lint/build, the full trading QA set, Windows dead-floor and quick-limit scripts, and UI smoke at each implemented boundary. This documentation-only audit did not rerun that full suite and does not claim a new sign-off.

## Decisions required before implementation

1. Approve 3B completion-driven atomic simulated handoff, or a specified bounded waiting period with symmetric BUY/SELL rejection. Decide fate-timeout precedence and pending-order venue policy.
2. Approve the standard SOL reserve profile versus configurable profiles. Decide whether USD2000 launches/floors and archetype reserve diversity should remain product features.
3. Approve continuity-preserving synthetic post-migration liquidity as an approximation, or commission authentic pool accounting and accept an explicit opening-price policy. Do not equate this approximation with v3 synthetic migration.
4. Decide fee-on-gross compatibility versus reference fee-on-net, integer precision, creator/protocol fees and SELL fee custody. Full Pump.fun parity requires those decisions; they are not prerequisites for fixing the completion stall.
5. Approve deterministic session SOL/USD configuration and scope of conversion-consumer migration, while keeping types.ts untouched. Any frozen export/type change requires a separate migration decision and consumer plan.
6. Approve derived reference marker versus actual migration marker presentation, and retain read-only historical audit results as such.

Recommendation: review and approve **3B first**, using the existing accounting and continuity model to repair the completion/handoff contract. Approve 3C economics separately, then require 3D public-flow evidence before calling the profile Pump.fun-aligned. Stop here for review; no implementation is authorized by this audit.

### Concrete consumer inventory for 3C review

In addition to the core files named above, review these exact currency consumers: `src/components/token/TradeSidebar.tsx` (literal USD150 label), `src/components/token/TradesTablePanel.tsx` (local USD150 conversion), `src/components/floating/InstantTradePanel.tsx` (USD-target quick SELL), `src/components/token/BottomTabs.tsx`, `src/components/token/OrdersTab.tsx`, `src/components/token/PositionsTab.tsx`, and `src/components/token/tradingUiFormatters.ts` (shared wallet conversion). Consumers already using walletStore helpers may need no direct edit if the helper contract is preserved; this is an impact inventory, not authorization to change every file. `src/tokens/registryExecutionRelay.ts` and `registryFeedPublisher.ts` need boundary verification; avoid edits if existing runtime snapshots suffice.

Steering executes additional BUY/SELL calls at tokenSim.ts:961-965 after generated flow. Its timestamp is clamped to the last tape timestamp. Completion admission must be enforced at those execution helpers too, so steering cannot reopen a just-completed curve or create a second migration event. Keep this timestamp clamp and Slice 2B rejection behavior.
