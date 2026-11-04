# Cash-cap SELL reachability - Slice 2C3

Verdict: **B - UNREACHABLE UNDER CURRENT INVARIANTS**. This conclusion follows from the initialized reserve and inventory invariants below, not merely from a search that found no failures.

Audited base: `653d3d8` (`main` after PR #49), 2026-11-04. Branch: `docs/cash-cap-sell-reachability`. Changes are restricted to this report and [`cashCapSellQa.ts`](../src/qa/cashCapSellQa.ts). No production code, frozen contracts, dependency or CI change is included.

## Activation condition and observed defect

In [`TokenSim`](../src/tokens/tokenSim.ts), let:

- `X = curveVirtualBase`, `Y = curveVirtualToken`, `R = curveRealBase`.
- `S = curveInitialRealToken`, `T = curveRealToken`, `I = S - T`, the total tokens issued from the curve.
- `f = 0.99`, the existing quote-side fee factor.
- `q = min(requested token input, I)` for a valid positive SELL.

`estimateCurveSellOut` and `executeCurveSell` first compute:

```text
g = X - X*Y/(Y+q) = X*q/(Y+q)       gross model quote output
n = f*g                            net wallet payout
cash cap activates iff n > R
```

If the cap activates, current execution sets `n = R`, uses `g_used = R/f`, subtracts `g_used` from virtual quote and still adds all `q` to virtual tokens. Constant product is then violated:

```text
K_after - K_before = (g - g_used)*(Y+q) > 0
```

The defect is real for an inconsistent injected reserve state. The audit asks whether initialized execution can reach it.

## Initialization and all reserve mutation paths

`initCurveState` is called only by the constructor. It sets `T0 = S`, virtual tokens `Y0 = S * virtualMul`, virtual quote `X0 = max(1, startPrice * Y0)`, and real quote `R0 = max(0, startMcapUsd * 0.02)`. Current archetype profiles have `virtualMul` between 1.05 and 1.4; `Y0 > S`. The generator's `getStartingMcapUsd` always returns $2,000, so ordinary spawn has `R0 = $40`.

Genesis does not distribute unbacked tokens: `seedGenesisHolders` returns immediately, ledger starts empty, and the constructor creates zero-volume candles only. The first dev BUY is a target flow from `buildDevFlow`; it is executed through actual bot BUY and curve accounting. It is not a reserve write or free token allocation.

The only ordinary reserve writes after initialization are `executeCurveBuy`, `executeCurveSell` and `sanitizeCurveState`. BUY quotes do not mutate reserves. BUY execution adds actual used net quote equally to virtual and real quote, removes actual output equally from virtual and real tokens, and preserves K. The exhaustion branch recomputes used quote for capped output before charging; requested unused budget does not enter reserves.

SELL globally caps token input at `S - T`. Bot SELL also caps input to its chosen wallet's inventory; the trading store limits user sales by positions. The global curve bound is sufficient for the proof even when a private caller does not enforce ownership. Raw helpers do not maintain the holder ledger themselves; their pool-token accounting is tested separately from public ledger conservation.

`sanitizeCurveState` clamps nonfinite/negative reserve values and inventory bounds and marks invalid numeric state. It does not reconstruct K or collateral. Under valid initialized execution, finite reserves are positive and inventory remains within bounds, so these repairs are inactive. A repaired/injected inconsistent state is outside the invariant proof and must not be presented as normal reachability.

Lifecycle phase changes, price/mcap clamps, dead/rug handling and `bootstrapAdvance` do not independently rewrite these curve reserves. Bootstrap invokes ticks. Migration stops using the pre-migration curve helpers and hands off to synthetic per-execution reserve context; that context is not a persistent AMM ledger and is excluded from this audit. Returning tokens after an exhaustion BUY is valid pre-migration evidence only if the public execution has not already migrated.

## Invariants and induction proof

Use initialization constants `X0`, `Y0`, `R0`, `S` and `K0 = X0*Y0`. Let `F` be the cumulative SELL fee difference `sum((1-f)*gross SELL output)` in this model. This is a reserve-offset identity, not a claim about a separate physical fee-custody ledger.

The following hold initially:

```text
0 <= I <= S
Y = Y0 - I
X*Y = K0
R - X = R0 - X0 + F             F >= 0
```

BUY preserves these invariants: actual used quote increases X and R equally; actual tokens decrease Y and T equally. Both normal and capped/exhaustion execution preserve K by the same inverse constant-product equation.

Assume the invariants hold before SELL. Its global bound gives `q <= I`, hence:

```text
Y+q <= Y0
X_after_ideal = K0/(Y+q) >= K0/Y0 = X0
g = X - X_after_ideal <= X-X0
R = X-X0 + R0 + F
f*g <= f*(X-X0) <= X-X0 <= R
```

Therefore the cash-cap condition is false. More strongly, the payout safety margin satisfies:

```text
R - f*g >= R0 + F + (1-f)*(X-X0) >= R0
```

Without the cap, SELL preserves K and the token offset and increases `R-X` by `(1-f)*g`. This completes the induction without assuming the conclusion: the pre-SELL invariants prove the cap is inactive, which then proves the post-SELL invariants.

Repeated SELL cannot drain quote while retaining issued tokens for later reuse: each sale returns tokens to T and reduces I. Full redemption returns X to X0 and leaves at least R0 plus F in real quote. Repeated round trips increase, rather than decrease, that collateral margin. Example: a $100 gross BUY adds $99 net; full redemption pays $98.01 after SELL fee, leaving $0.99 extra real quote. The BUY fee never entered the pool; the SELL fee explains this residual.

### Floating-point scope

The algebra is exact-real arithmetic. JavaScript uses doubles, so QA separately checks step and cumulative residuals rather than requiring bitwise K equality. For normal initialized bounds, `Y >= Y0-S` stays far above `CURVE_TOKEN_EPS = 1e-6`; X is bounded by `K0/(Y0-S)` before exhaustion. The current minimum virtual multiplier 1.05 bounds this ratio relative to X0 by 21. There is no near-zero token-reserve division in these valid states.

QA uses `64 * Number.EPSILON` (approximately `1.4211e-14`) relative step-K tolerance. Cumulative K, token-offset and quote-offset tolerances scale that allowance by operation count and the relevant reserve magnitude. This conservative operation budget allows double rounding/cancellation; it is not a formal error bound for arbitrary-length runs or invalid/extreme constructor inputs. Holder ledger comparisons also allow up to `1e-6` removed wallet dust per helper call.

Maximum measured step-K relative residual was `9.417139969420917e-16`, and cumulative relative drift was `6.325673700986286e-15`. Those are rounding-scale residuals, not a cash-cap event. The smallest unforced full-redemption margin was approximately $40.0000000001, vastly larger than measured numerical residuals. The forced control's relative K jump is approximately `0.00897979798` (0.89798%), which is an economic/model discrepancy, not rounding.

The verdict applies while these current finite initialized invariants hold. It does not certify arbitrary imported states, nonfinite corruption, a future fee/inventory model, or unlimited numerical accumulation. The recommendation below addresses invalid-state defense explicitly.

## Deterministic experiments and reachability tiers

Observers wrap the original private BUY/SELL methods without replacing their execution. Every call records before/after reserves, requested and executed token quantities, actual quote movement and the exact cap predicate. A detected cap prints `CASH_CAP_REPRO` containing the initial state, full command prefix and swap trace. No unforced reserve writes, fake token replenishment, phase overrides or swap stubs are used.

| Tier | Scenarios | Curve calls / successful calls | Cash-cap activations |
| --- | ---: | ---: | ---: |
| Public TokenSim execution | 144 | 77,779 / 77,739 | 0 |
| Private curve helpers from initialized state | 240 | 117,216 / 117,216 | 0 |
| Manually forced positive control | 1 | 1 / 1 | 1 |

### Public execution

- 32 deterministic generator seeds across all four fates: 128 lifecycle scenarios, each using the real $2,000 spawn, pending user BUY then SELL, background/dev flow and up to 500 public ticks of 0.2s. Additional small user trades alternate according to actual inventory. Early stop on migration keeps subsequent synthetic swaps outside the evidence.
- 16 further public exhaustion attempts use computed needed quote and a requested budget capped at 100 SOL. If still pre-migration, the holder sells its actual resulting inventory through the public pending/tick path. Some exhaustion BUYs migrate immediately; their later synthetic SELLs are deliberately not used as pre-migration evidence.
- In total, 31 public scenarios reach exhaustion, including lifecycle-driven examples. Observed phases are NEW, FINAL and MIGRATED; final phases are 36 NEW, 44 FINAL and 64 MIGRATED. DEAD was not observed in this bounded sample. The reserve proof does not depend on observing every phase.

“Public” here means actual `TokenSim.submitUserTrade` and `tick` APIs, including latency, minOut checks and background flow. It is not a full UI/store funding test. Requested exhaustion budgets are below the default development wallet balance, but this fixture does not exercise store reservation/refund. Existing regression QA covers those paths. These public cases have no hand-edited reserves or holder inventory.

The sample includes all four archetypes (DOA, SLOW_COOK, HEALTHY and CHAOS), all fates and model-generated reserve ratios. It uses the generator's current starting price rather than inventing low-collateral production spawns.

### Private helpers

16 additional deterministic seeds, three positive constructor start values ($2,000/$5,000/$10,000) and five sequences yield 240 cases:

1. 100 complete BUY/SELL round trips.
2. A large BUY using 80% of exhaustion input, then 20 SELL chunks.
3. A BUY with three times exhaustion budget, then 20 SELL chunks.
4. 1,000 alternating BUY/partial SELL pairs with seeded sizes.
5. 100 tiny `$1e-8` gross BUY/partial SELL pairs to probe cancellation and token rounding.

All 48 designated private exhaustion cases reach the token cap without reserve edits. These cases exercise low actual spawn liquidity ($40 initial real quote), large issued inventory, repeated SELL and accumulated fee offsets. $5,000/$10,000 are constructor sensitivity inputs, not values produced by the current registry generator. Raw helpers can continue after prices exceed migration eligibility because they do not run lifecycle transitions. These are a useful superset for the reserve proof, but not proof of a public pre-migration sequence. Pool inventory/output quantities and estimate/fill agreement are checked; raw helpers alone do not update holder inventory or tape.

### Forced control and the two known FAILs

The control preserves the isolated fixture used in volume QA: `X=1000`, `Y=100m`, `S=100m`, `T=90m`, `R=1`, then request SELL of 1m tokens. These reserves are assigned manually and do not satisfy initialized execution provenance. It is not a minimal production reproduction.

| Assertion | Actual | Independent expectation |
| --- | ---: | ---: |
| Gross quote for 1m consumed tokens | 1.010101010 | 9.900990099 |
| K after SELL | 100,897,979,797.9798 | 100,000,000,000 |

The actual net payout is $1 and all 1m input tokens are consumed. Both failures describe the same clamped-output defect. The observer detects exactly one cap; positive-control detection checks pass, while the two model assertions intentionally fail. There is no unforced minimal reproduction because neither public execution nor the larger initialized-helper domain reaches the cap under the proven invariants.

## Validation

```sh
./node_modules/.bin/esbuild src/qa/cashCapSellQa.ts src/qa/volumeBasisQa.ts src/qa/buyExhaustionQa.ts src/qa/lateTickQa.ts src/qa/tradeTimestampQa.ts src/qa/tradeOhlcQa.ts src/qa/curveParityQa.ts --bundle --platform=node --format=esm --define:import.meta.env.DEV=true --out-extension:.js=.mjs --outdir=/tmp/cash-cap-audit-qa
node /tmp/cash-cap-audit-qa/cashCapSellQa.mjs
node /tmp/cash-cap-audit-qa/volumeBasisQa.mjs
node /tmp/cash-cap-audit-qa/buyExhaustionQa.mjs
node /tmp/cash-cap-audit-qa/lateTickQa.mjs
node /tmp/cash-cap-audit-qa/tradeTimestampQa.mjs
node /tmp/cash-cap-audit-qa/tradeOhlcQa.mjs
node /tmp/cash-cap-audit-qa/curveParityQa.mjs
npm run build
npm run lint
```

| Check | Result |
| --- | --- |
| New reachability/inventory/invariant checks | 2,314,437 / 2,314,437 PASS |
| Forced-control model assertions | 0/2; two expected diagnostic FAIL; overall exit 1 |
| Volume market / integrity / holder accounting | 265/265 / 249/249 / 16/16 PASS |
| Volume user settlement / holder-cycle checks | 10/10 / 162/162 PASS |
| Volume reserve model | 35/37; same two forced-state FAIL; exit 1 |
| BUY exhaustion | 135 assertions PASS |
| Late Tick | 52/52 + 81/81 PASS |
| Timestamp | 350/350 PASS |
| Trade OHLC diagnostic | 335/413; 78 discrepancies; exit 1 |
| Curve parity diagnostic | 14/18; 4 discrepancies; exit 1 |
| Build | PASS; existing chunk-size warning |
| Lint | Exit 0; 0 errors, 7 existing Hooks warnings |

Two fresh processes produced identical new-QA stdout, stderr and exit code. Default output groups scenario summaries to avoid losing large console output when Node throws into a captured pipe; cap reproductions retain the full leading sequence. The diagnostic is not added to package scripts or CI gates. Existing QA expectations and production files are unchanged. Browser/manual QA was not run for this audit-only change.

## Impact of a future defense or execution correction

Under current valid invariants, a defensive rejection should have no effect on quantities, fees, market volume, holder costs/PnL, user settlement or OHLCV. This needs differential verification, not an assumption. In an injected inconsistent state, rejecting before mutation must leave both token and quote reserves, ownership, tape and candles unchanged; the existing failed-fill/refund path can handle the order without recording volume.

A different design that fills a smaller token input to match the limited quote would change execution quantities, released cost basis, net proceeds, market volume and candle close/volume. Its quote estimate and settlement would also have to use the same actual quantities. Such a fix would be a separate execution contract and should not be introduced merely to make the forced fixture green. Post-migration synthetic reserve behavior is outside this recommendation.

## Recommended next vertical slice

**B - UNREACHABLE UNDER CURRENT INVARIANTS.** Keep the current curve model. The smallest proposed STANDARD follow-up is a defensive pre-mutation check in both curve SELL estimate and execution: if intended net payout exceeds real quote in an invariant-broken state, reject consistently through the existing zero-output/No liquidity result instead of consuming the full token input with clamped quote. Do not add a provider, reserve rebuilder or silently recalculate K.

Acceptance for that separately approved change: valid initialized public/private sequences remain economically identical; the forced invalid state returns no executed tokens/quote and changes no reserves, ownership, volume or OHLCV; estimate and fill agree; pending order failure/refund stays correct. Preserve the positive control as invalid-state defense coverage. Handling near-boundary numerical conditions and explicit invariant reporting should be scoped with that plan. No such defense is implemented in this audit.
