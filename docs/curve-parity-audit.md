# Curve parity audit

Audit date: 2026-11-03. Audited checkout: `601746e75fe5f734ff41ca4c4fce776f8ea656f8` (cleanup). Local `main` points to `d62b238`; the audit branch preserves the supplied cleanup checkout. No production files changed.

Reference: [bondingCurve.ts](https://github.com/nirholas/pump-fun-sdk/blob/main/src/bondingCurve.ts), plus [fees.ts](https://github.com/nirholas/pump-fun-sdk/blob/main/src/fees.ts), retrieved from raw GitHub during this audit. These are mutable URLs, not a pinned commit. This compares against the supplied SDK, not independently verified deployed Pump.fun behavior. Legacy SOL quote functions are the primary comparison; newer v3 cross-completion/pool quotes are a separate contract and are not covered by this test.

## Reference math

Let X be virtual quote reserves, Y virtual token reserves, R real tokens, A the quote budget, T tokens in/out. Use integer base units (SOL lamports and six-decimal token units).

- Legacy exact-budget BUY: N = floor((A - 1) * 10000 / (10000 + totalBps)); out = min(R, floor(N * Y / (X + N))).
- Exact-token BUY: T = min(requested, R); cost = floor(T * X / (Y - T)) + 1, then add fees.
- SELL: gross = floor(T * X / (Y + T)); subtract fees, clamp net at zero.
- Fees: round each protocol/creator component upward independently. Rates depend on configuration and creator eligibility.
- Market cap: floor(X * supply / Y), in quote base units.

The reference SELL quote does not enforce real quote availability. Its quote alone cannot prove on-chain acceptance or reserve mutation semantics. Real-reserve accounting findings below distinguish internal conservation from claims about program behavior.

## Confirmed agreements

- `tokenSim.ts:2526-2678`: the continuous, pre-fee BUY/SELL equations are constant product. BUY increases virtual quote and reduces virtual tokens; SELL reverses that direction.
- Both cap BUY token output by remaining real tokens. Ordinary uncapped virtual swaps preserve K approximately; floating arithmetic prevents integer parity.
- SELL computes curve output before subtracting a fee. Market cap uses virtual reserve price times total supply before simulator clamps.
- Quotes use the same general formulas as execution. Quote-only checks leave K unchanged.

## Confirmed discrepancies

| Finding | Evidence and consequence |
| --- | --- |
| BUY fee basis | `estimateCurveBuyOut` and `executeCurveBuy` use A * 0.99. Reference budget inversion uses roughly A / 1.01 at 100 bps. For the fixed QA fixture, 0.1 SOL gives 2,960,638.6712926626 tokens versus 2,960,933.801911; 1 SOL gives 28,789,690.482637286 versus 28,792,481.42806. These are quote-level executable findings. |
| Integer rounding absent | Production uses floating USD and whole-token quantities, with no lamport/token quantization. Dust can quote positive output where integer input leaves no spendable quote. The QA tolerance covers reserve normalization and deliberately does not certify dust parity. |
| BUY exhaustion overcharges | Both BUY paths clamp `tokensOut` before testing `tokensOut > curveRealToken`. That condition is unreachable, so execution retains all net input even when output is capped. It can increase K and jump the final price. The output-cap test passes but does not test charged input; this accounting defect is confirmed by code inspection. |
| SELL real quote accounting | Virtual quote decreases by gross output, while real quote decreases only by net output (`executeCurveSell`). The fee-sized residual stays in real reserves without a separately tracked fee reserve. After a normal round trip, virtual and real quote deltas disagree by the SELL fee. This is an internal accounting inconsistency; the reference quote does not specify account mutation. |
| SELL real-reserve cap order | Net output is capped against real quote, then divided by 0.99 to obtain virtual debit. This can debit more virtual quote than real quote available. Tokens in are not recomputed for a partial fill; a cap can break K. Reachability in normal lifecycle has not been dynamically demonstrated. |
| SELL inventory policy | Input is capped to initial real tokens minus current real tokens. The reference direct SELL quote has no such cap; wallet ownership and transaction validity are separate concerns. Simulator policy avoids selling unsold inventory but is not SDK quote parity. |
| Fee model | Fixed 100 bps, no independently rounded creator/protocol components or schedule. This is an intentional-looking simplification; current production Pump.fun rates were not queried. |
| Market-cap display | `getCurveMcapUsd` clamps to $2,000-$10,000,000 while curve price remains the raw ratio. Outside those bounds price * supply can differ from displayed market cap. |

## Execution, tape and candles

The actual path is execution -> `recordTradeTick` -> parallel writes to aggregators and tape. `SimTapeTrade` is not the aggregator's input. It is a sibling projection of the same call (`tokenSim.ts:2768-2814`).

- Both projections use the post-swap marginal reserve price. `avgPriceUsd` in the user fill is gross BUY cost/token or net SELL proceeds/token; neither is the tape price. `impactPct` measures signed post/pre marginal price change, not execution slippage or average execution premium.
- Background BUY records net quote; user BUY records gross quote. Both SELL paths record net proceeds. Candle USD volume is therefore actor/side dependent. Tape and candles agree with each other but do not share a uniform traded-volume definition.
- `CandleAggregator` correctly accumulates high, low, close and volume within an ordered bucket. It skips empty buckets.
- A new bucket opens at previous close, not its first trade. A gap from 12 to 20 produces open/low 12 although the only new-bucket trade is 20. This is documented continuity behavior, but fails trade-OHLC semantics; the test deliberately reports that difference.
- An older-bucket tick updates the latest candle. Pending user fills run at `nowMs` before background trades timestamped within the preceding window. This ordering is confirmed in `tick()` and `executeMarketFlowAsTape`; actual bucket-boundary distortion is a hypothesis requiring an integration fixture. Tape sorts by timestamp while candles use insertion order.
- Genesis candles have zero volume and a synthetic opening baseline.

These choices matter more for visual realism than sub-unit rounding: post-swap prices alter bodies/wicks; continuity opens inject untraded extrema; mixed volume definitions change volume comparisons; exhaustion overcharge can produce a large artificial last-curve move. Fee/accounting errors accumulate across repeated flows. The size and frequency of chronological distortions remain unmeasured.

## Simulation choices and limits

Initialization randomizes real/virtual token reserves by archetype, derives virtual quote from starting market cap, and seeds real quote at 2% of starting market cap (`initCurveState`). Reference initialization takes configured reserves and starts real quote at zero. These are different initial conditions, so production trajectories cannot be compared without normalizing reserves.

Migration is a market-cap threshold from `getMigrationThresholdUsd()` (228 simulated SOL * $150 = $34,200), not depletion of real token inventory. The legacy $69,000 constant was not changed or used. Post-migration liquidity is synthetic and side/regime dependent; this audit does not claim AMM parity. Accelerated time, narrative flow, price bounds, fixed SOL/USD and genesis candles support the simulation design. Their existence is confirmed; calling every accounting discrepancy intentional would be unsupported.

## QA and missing seams

`src/qa/curveParityQa.ts` uses public constructor/debug/quote APIs, a fixed token seed and a restored-in-finally synchronous fake clock. It includes an independent BigInt legacy BUY oracle with protocol=100 bps, creator=0, normalizes observed reserves, and separately checks trade-OHLC semantics. It does not import or install the SDK, access private members, or modify the engine. It runs standalone, not through the app.

Run with existing TypeScript tooling:

```sh
./node_modules/.bin/tsc src/qa/curveParityQa.ts --outDir /tmp/memex-curve-parity --module commonjs --target ES2020 --strict --skipLibCheck
node /tmp/memex-curve-parity/qa/curveParityQa.js
```

Result: 14/18 checks passed; process exits 1 for two BUY fee differences and two new-bucket OHLC differences. This is a discrepancy detector, not a passing regression suite or complete parity proof.

Missing seams for isolated reserve/SELL/end-to-end fixtures: initialize explicit integer reserves; execute one swap at an explicit timestamp without background flow; capture immediate before/after reserves and fill together. Public submit/drain APIs exist, but processing requires `tick()`, which also generates market trades. No engine redesign was attempted. The current QA does not dynamically verify SELL, exhaustion charges, dust exactness, execution-to-tape integration or all timeframe outputs.

Validation: `npm run build` passed (bundle-size and Node deprecation warnings); `npm run lint` passed with seven warnings in unchanged UI files. Both browser QA commands were attempted sequentially and could not start because `powershell` is unavailable. `npm run dev -- --host 127.0.0.1` was attempted but sandbox port binding failed with `listen EPERM` on port 5173. Browser/manual lifecycle and five-minute checks were not run; no UI/runtime changes were made.

## Proposed smallest safe vertical slice

Planned, requires STANDARD plan review and explicit implementation approval: repair only pre-migration BUY exhaustion accounting. Determine the capped token amount before deciding whether to recompute used quote, apply the same result to quote and execution, and charge only the required gross amount. Preserve the existing fee model for that slice so accounting and fee migration remain independently reviewable.

Success checks: a deterministic swap ending exactly at real-token exhaustion; quote/fill agreement; unused input remains uncharged; real/virtual reserve deltas match used net quote; K stays within specified floating tolerance; resulting tape volume and candle close match the corrected fill under the current documented chart convention. Add a narrowly scoped isolated swap seam only if approved, then run build/lint and lifecycle/trading browser QA on a supported host. Fee basis, integer parity, SELL accounting and trade-OHLC semantics should remain separately scoped follow-ups. No production fix or PR was created in this audit.

## Slice 1 implementation follow-up

The subsequently authorized BUY exhaustion slice changes only `estimateCurveBuyOut` and `executeCurveBuy`: detect capped output before clamping, then recompute used net input from constant product. Gross input still uses the existing 100 bps fee model. The existing store refunds reserved SOL minus filled SOL; no store changes were required. Findings above describe the pre-fix audit snapshot.

`src/qa/buyExhaustionQa.ts` verifies normal BUY, exact exhaustion, excess input, and terminal market caps at 99.9% and 100.1% of the runtime migration threshold. Its independent equation is net = X * tokensOut / (Y - tokensOut), gross = net / 0.99. It checks quote/fill agreement, K, reserve deltas, charged fee, migration events, wallet reservation/refund including transaction cost, and position settlement: 135 assertions passed. The pre-fix implementation passes normal/exact cases but fails excess-input accounting ($327.272727 charged instead of $109.090909 in the fixture).

The standalone QA uses bracket access to existing private state/methods for deterministic reserve setup, pending-order processing without background flow, and delivery through the real registry execution relay to the store. No public production test API was added. This couples the fixture to private names; run it in a fresh process because it initializes singleton stores.

```sh
./node_modules/.bin/esbuild src/qa/buyExhaustionQa.ts --bundle --platform=node --format=esm --define:import.meta.env.DEV=false --outfile=/tmp/buyExhaustionQa.mjs
node /tmp/buyExhaustionQa.mjs
```

Validation after the fix: build passed; lint passed with the same seven UI warnings. The original parity QA remains 14/18 with the same four fee/OHLC discrepancies. Browser QA launchers were attempted sequentially but PowerShell is absent. Dev startup was attempted and blocked by sandbox `listen EPERM`; manual browser and five-minute lifecycle checks remain unrun. Post-migration execution was not changed or covered by this slice. No PR was created.

---

## Slice 2E — current curve parity audit (2026-11-04)

Base: `d58a9aa`, main after OHLC audit PR #52. This section supersedes historical findings only where explicitly stated; all text above remains a historical record. Scope: this report and `src/qa/curveParityAuditQa.ts`. No production or existing QA changes.

### Economic contract versus external fidelity

README and docs/architecture.md describe a synthetic, simulation-only constant-product market with simulated SOL fixed at USD 150. They do not promise parity with a particular deployed protocol or version of the SDK. The historical SDK comparison is an explicitly named reference convention, not normative simulator economics. No fresh external SDK retrieval is used here: the integer reference formula is the one already embedded in curveParityQa.ts, attributed there to retrieval on 2026-11-03. Mutable historical URLs above cannot establish a pinned protocol specification.

The current simulator contract has stronger internal evidence than implementation alone: buyExhaustionQa independently solves inverse constant product using a 0.99 budget factor; volumeBasisQa independently checks gross BUY cost, net SELL proceeds, holder cost and PnL, and wallet settlement. These tests specify the current model. This does not establish that the original product decision intended fidelity to any particular protocol; a future protocol-fidelity goal would require an explicit economic decision.

With gross budget G and fee rate f=0.01, simulator net reserve input N=G*(1-f). Fee is G*f. The reference instead interprets fee as a surcharge on net input, approximately N=G/(1+f), then applies integer rounding and a one-lamport subtraction. At 100 bps, 0.99 versus 1/1.01 differs by 1/10100 of gross budget. Both are coherent conventions with different fee bases.

### Four original discrepancies, reproduced unchanged

| Label | Actual | Expected | Tolerance | Verdict |
|---|---:|---:|---:|---|
| BUY 100000000 lamports | 2960638.6712926626 | 2960933.801911 | 0.06000200000055094 | CONVENTION |
| BUY 1000000000 lamports | 28789690.482637286 | 28792481.42806 | 0.06000200000055094 | CONVENTION |
| trade OHLC new bucket open | 12 | 20 | 0 | CONVENTION |
| trade OHLC new bucket low | 12 | 20 | 0 | CONVENTION |

Count: **4 CONVENTION, 0 BUG, 0 STALE_QA, 0 UNKNOWN** among these four comparisons. The legacy QA remains useful as a diagnostic comparison, so its intentional external/trade-only expectations are not silently rewritten. If used as an internal correctness gate, those same expectations would be inappropriate.

OPEN/LOW reuse Slice 2D: prices 10 then 12 in the first bucket, then 20 after a sparse gap, produce OPEN=12 and LOW=12. The previous close participates in the next candle's range. This is only a representative confirmation of the approved convention, not another OHLC audit.

### Independent calculations and quantization

The new QA computes continuous output as min(R, Y*N/(X+N)), and capped net cost as X*T/(Y-T), independently of production quote helpers. The integer reference uses floor((budget-1)*10000/10100), then floors token output in six-decimal units, starting from lamport-quantized reserves. Budget zero is handled explicitly.

| Budget lamports | Simulator continuous tokens | SDK continuous tokens | SDK integer tokens | Fee-basis difference | Quantization difference |
|---|---:|---:|---:|---:|---:|
| 0 | 0 | 0 | 0 | 0 | 0 |
| 1 | 0.02969999999906091 | 0.029702970296090425 | 0 | 0.0000029702970295 | -0.029702970296090425 |
| 1000 | 29.699999060907164 | 29.702969357749026 | 29.669999 | 0.002970296841862563 | -0.03297035774902568 |
| 100000000 | 2960638.671292505 | 2960933.8314003972 | 2960933.801911 | 295.16010789200664 | -0.029489397071301937 |
| 1000000000 | 28789690.48263721 | 28792481.481391672 | 28792481.42806 | 2790.9987544603646 | -0.05333167314529419 |

Fee-basis difference is SDK continuous minus simulator continuous. Quantization difference includes the one-lamport subtraction, intermediate integer division, reserve normalization and token-unit floor, not just final token rounding. Ordinary-budget mismatches exceed the original tolerance by orders of magnitude; rounding does not explain them. Dust parity is deliberately absent: continuous simulation can quote fractional output for one lamport when the reference quotes zero. Production subtracts two reserve-sized floats; the new independent stable formula allows a bound of four machine epsilons times virtual token reserves for cancellation error, separate from SDK comparison differences.

### Quote, execution, exhaustion and accounting evidence

The new QA has 181 passing assertions. Five independent inverse-K fixtures cover normal, exact exhaustion, oversize budget exhaustion, and terminal prices just below/above migration threshold. It checks quote output and required input, quote read-only behavior, actual filled amount, gross charged cost, fee, real and virtual reserve deltas, K, reserve price, migration event, exhausted retries, upfront wallet reservation, unused-budget refund including transaction cost, position quantity/cost, holder gross bought USD/tokens and zero realized BUY PnL. Ordinary 0.1 and 1 SOL trades additionally compare actual execution against the independent gross-fee formula.

Current exhaustion charging uses the inverse curve cost for capped output. Thus the historical exhaustion overcharge finding above is no longer current. BUY increases real and virtual quote by net input and decreases real and virtual tokens by filled output. Gross charge is net input/0.99 and unused gross budget is returned by settlement. K remains constant within floating tolerance. A large unused budget is not a fee or realized loss.

PnL and SELL accounting are checked by existing independent volumeBasisQa: the holderCycle group (162 checks) includes BUY/partial SELL/full SELL accounting, remaining basis, and realized PnL from net proceeds minus allocated gross cost; settlement (10 checks) checks position and wallet PnL. The new QA adds holder BUY cost checks rather than duplicating that full cycle. Mark-to-market PnL can immediately be negative because gross purchase cost includes fees and the displayed price is a marginal reserve price, not average execution price. That difference is not evidence of a fill-accounting defect.

Real SELL reserves currently decrease by net wallet proceeds while virtual reserves decrease by gross exchanged quote, leaving the fee residual in real reserves. volumeBasisQa explicitly characterizes this model; the old report's concern about an untracked fee reserve remains a separate economic-design issue, not demonstrated by either BUY parity mismatch. Defensive insufficient-real-quote rejection is covered by cashCapSellQa. This audit does not certify protocol account mutation semantics.

### Validation and reproducibility

Bundle standalone QA entries with the installed esbuild using `--bundle --platform=node --format=esm --define:import.meta.env.DEV=true`, then run each generated `.mjs` in a fresh Node process. No dependencies or CI gate were added.

| Command / diagnostic | Result |
|---|---|
| curveParityQa | 14/18; four preserved FAILs, exit 1 |
| curveParityAuditQa | 181 assertions PASS, exit 0 |
| volumeBasisQa | integrity 249/249, candidate 265/265, model 37/37, wallet 16/16, settlement 10/10, holderCycle 162/162, guard 14/14 |
| buyExhaustionQa | 135 assertions PASS |
| cashCapSellQa | 2,314,439 invariant checks PASS; forced guard 2/2 |
| tradeOhlcQa | 335/413; 78 preserved discrepancies, exit 1 |
| npm run build | PASS; existing bundle-size warning |
| npm run lint | exit 0; 0 errors, 7 existing UI warnings |

Fixtures use private access for deterministic isolation and do not constitute universal lifecycle or on-chain fidelity proof. The initial five scenarios reproduce the independent exhaustion fixtures used by the existing regression, extending them with holder assertions; the external comparison uses a separate fixed constructor fixture.

### Recommendation and migration cost

No production correction is justified by these four FAILs. Keep the current model for internal simulation development and label the reference comparison as protocol-specific diagnostic parity. First formalize whether fee is a fraction of gross budget or a surcharge on net curve input before requesting any migration.

If SDK fidelity becomes an explicit product requirement, a separate minimal vertical slice should target BUY fee inversion consistently in estimate and execution, capped inverse-cost/refund calculations, and all downstream wallet/holder cost and PnL expectations. Validate dust/rounding policy separately; changing only 0.99 to 1/1.01 would not provide integer parity. That change would buy more tokens for a fixed ordinary budget, reduce gross cost for a fixed capped output, alter reserves, marginal price, migration timing, volume and subsequent PnL. Deterministic trajectories and existing economic fixtures would need versioned expectations. SELL fees and the retained real-reserve fee residual require an explicit accounting decision of their own. None of those economic changes are implemented or authorized by this audit.
