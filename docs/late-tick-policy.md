# Late tick policy - Slice 2B

Status: proposal and diagnostic QA only. Audited local `main`: `dbd6820` after PR #46, 2026-11-03. No production code, frozen types, dependencies, package scripts or CI gates changed. Implementation requires STANDARD plan review and explicit Human approval.

## Current behavior and consumers

[`CandleAggregator`](../src/engine/aggregator.ts) buckets milliseconds into seconds. A later bucket creates a sparse candle with the previous close as its open. Equal and earlier buckets both update the latest candle's high, low, close and volume. There is no timestamp watermark, rejection or historical correction. Even a decreasing timestamp inside the same bucket changes the close in insertion order. `getSeries()` copies the array only; candle objects remain shared.

[`engine/types.ts`](../src/engine/types.ts) defines `Tick.t` in Unix milliseconds and `Candle.time` in Unix seconds. Neither defines ordering or a push result. The inline result belongs to `aggregator.ts`: `{ mode: 'new' | 'update'; candle: Candle }`. No frozen type needs changing for the proposal.

Repository search for every `pushTick()` call found:

| Caller | Use of result |
| --- | --- |
| `TokenSim` constructor, eight genesis pushes | Ignored |
| `TokenSim.recordTradeTick`, eight pushes per trade | Ignored |
| `src/qa/curveParityQa.ts` | Ignored; examines series |
| `src/qa/tradeOhlcQa.ts` | Ignored; examines series |
| New `src/qa/lateTickQa.ts` | Examines modes for characterization and proposed rejection |

There is no existing caller branching on `new` versus `update`, destructuring the result or forwarding its candle. No production aggregator reset caller was found. TokenSim constructs eight fresh instances: price and market cap at 1s, 15s, 30s and 60s.

[`tradeOhlcQa.ts`](../src/qa/tradeOhlcQa.ts) is an older diagnostic using a sorted trade-only oracle. Its late-event expectations describe chronological reconstruction, not rejection. Its genesis, continuity-open, price and volume convention discrepancies remain separate findings. Do not change those expectations into the proposed rejection oracle or interpret all its FAILs as late-policy failures.

[`tradeTimestampQa.ts`](../src/qa/tradeTimestampQa.ts) verifies actual SIM producers after PR #46, including equal-time priority ordering, background flow, both chart metrics and all four TFs. It includes genesis and continuity opens. It is complementary: monotonic producer output does not prove defensive rejection in the aggregator. Background timestamps in `TokenSim.executeMarketFlowAsTape` are clamped against the last tape timestamp or spawn time; the target fixtures pass without dropped trades.

## Proposed SIM contract

For finite, otherwise valid SIM ticks, each aggregator accepts timestamps in nondecreasing millisecond order. The first tick is accepted. Reject exactly when `tMs < lastAcceptedTimestampMs`, before any candle mutation. Equal timestamps are accepted in call order: the final equal-time price becomes close and every accepted volume is added once. Rejected ticks leave every candle field, series length and watermark unchanged. Timestamp validation beyond the existing valid-input assumptions is outside this slice.

Store `lastAcceptedTimestampMs: number | null` per instance. Bucket start cannot detect decreasing time inside a bucket, and a candle's time does not retain milliseconds. Update the watermark only on acceptance. It must survive candle retention trimming. `reset()` must clear both candles and the watermark, allowing an earlier first timestamp in a new session. Do not infer the watermark from retained candles.

This rule is independent of TF. All eight instances receiving the same complete stream and reset history make identical accept/reject decisions. Sparse gaps still create only one new candle. Continuity-open and the zero-volume genesis remain unchanged; genesis establishes the initial accepted timestamp, so pre-genesis ticks would be late.

## API recommendation and migration

A return-type change is not logically required to make rejection detectable: throwing would also signal it. However, an expected input-policy outcome should be explicit in the result. Recommended local migration, not implemented:

```ts
type PushTickResult =
  | { mode: 'new' | 'update'; candle: Candle }
  | { mode: 'rejected'; reason: 'late' };
```

Keep this type in `aggregator.ts`; preserve `engine/types.ts` and `tokens/types.ts`. A rejected result has no candle, avoiding an apparent successful update. This widens the mode union and requires callers reading `candle` to narrow first. All current production callers ignore the result, so compilation alone will not establish that rejection is handled. `lateTickQa.ts` checks this proposed `rejected`/`late` shape through `unknown`, without pretending it already exists in production types. If review chooses another explicit API, update that diagnostic assertion alongside the approved migration.

The eventual migration note must describe the new result, narrowing requirement, ignored-result callers and SIM-only ordering semantics. No frozen contract migration is currently recommended.

## Tape, OHLCV and volume consistency

`TokenSim.recordTradeTick` pushes to eight aggregators, then unconditionally updates `statWindow`, wallet trade statistics and tape. Swap execution has already changed reserves and price before this call. An aggregator-only rejection would omit candle volume while tape and statistics still include the executed trade. Throwing at that point could leave an executed trade with incomplete records; returning early could hide it from tape. Neither is a safe rollback strategy.

For chronological inputs the current definitions already pass volume conservation in the timestamp regression. Rejection must not change fee/volume definitions or substitute average execution prices. Total-volume comparisons must cover matching retained windows: candles, tape and statistics have different retention policies and clocks (`statWindow` uses simulation time).

A safe integration needs a shared admission decision before economic mutation for any path that can receive late input. Accepted trades must still reach all eight aggregators, tape and statistics exactly once. A chart-only defensive guard may expose an upstream invariant failure, but cannot claim ledger consistency for rejected executed trades. Handling that failure remains an explicit implementation decision; it must not silently drop an already executed trade. Do not introduce ad hoc timestamp clamping inside the aggregator: that would disguise rejection and alter event time.

## Deterministic QA and results

[`lateTickQa.ts`](../src/qa/lateTickQa.ts) uses fixed millisecond times, integer prices/volumes, fresh aggregators and no wall clock or random source. Inputs are passed in original insertion order. It covers chronological acceptance, late time in the same and previous bucket, equal-time ordering, five-bucket spacing, reset to earlier time, full-series OHLCV immutability, watermark stability after rejection and chronological volume conservation at all four TFs. Snapshots clone candle objects because `getSeries()` is shallow.

Run locally, without adding a CI gate:

```sh
./node_modules/.bin/esbuild src/qa/lateTickQa.ts src/qa/tradeTimestampQa.ts --bundle --platform=node --format=esm --out-extension:.js=.mjs --outdir=/tmp/late-tick-qa
node /tmp/late-tick-qa/lateTickQa.mjs
node /tmp/late-tick-qa/tradeTimestampQa.mjs
./node_modules/.bin/esbuild src/qa/buyExhaustionQa.ts --bundle --platform=node --format=esm --define:import.meta.env.DEV=true --outfile=/tmp/late-tick-qa/buyExhaustionQa.mjs
node /tmp/late-tick-qa/buyExhaustionQa.mjs
npm run build
npm run lint
```

Local results:

| Check | Result |
| --- | --- |
| Current-behavior characterization | 16/16 PASS |
| Proposed SIM contract | 28/52 PASS; 24 diagnostic FAIL; exit 1 |
| Timestamp regression | 350/350 PASS |
| BUY exhaustion regression | 135 assertions PASS |
| Build | PASS; existing chunk-size warning |
| Lint | Exit 0; 0 errors, 7 existing Hooks warnings |

The 24 expected FAILs are three assertions for each late scenario across four TFs: explicit rejection, unchanged OHLCV and unchanged state after another still-late tick. Characterization failures would indicate a change in current behavior; contract failures describe the unimplemented policy. After a fix, the current-behavior characterization must be retired or revised separately, while all contract checks should pass. A failing diagnostic is deliberately not registered as an npm script or mandatory CI gate.

The first BUY regression launch lacked Vite's `import.meta.env.DEV` and failed before assertions. Rebundling with the explicit development constant above passed. No source workaround was needed. Initial late/timestamp runs used esbuild `.js` output; the commands above use `.mjs` explicitly for portability.

Browser QA and Windows PowerShell/Edge lifecycle/trading launchers were not run: this slice changes only standalone QA and documentation. No UI or production behavior changed.

## Replay and Live

This proposal is a SIM admission contract, not a universal market-data policy. Replay may sort a complete source by timestamp with stable equal-time ordering before feeding a fresh aggregator, or preserve recorded execution order; that choice must be specified before Replay work. Seeking backwards requires resetting/rebuilding every related projection, not just one TF.

Live event time can arrive out of order. Applying the SIM drop rule directly could lose legitimate volume. Buffering with a defined lateness window, historical correction or explicit rejection with metrics are separate design choices requiring a scoped plan. No provider abstraction, network integration or mode implementation is proposed here.

## Smallest safe implementation plan - pending approval

1. Approve the local result migration and the handling of rejected SIM input. Establish whether all producers guarantee admission before execution; add a focused test for any uncovered path. Do not promise ledger consistency based only on chart guards.
2. In `src/engine/aggregator.ts` only, add the nullable millisecond watermark, early explicit rejection and reset behavior. Preserve accepted-tick math, sparse candles, continuity-open, genesis and volume. Add a migration note for the result union. Keep frozen types unchanged.
3. In the same scoped review, resolve `TokenSim` caller handling before shipping the guard: a shared pre-execution admission check for reachable late input, or evidence that rejection is unreachable in supported SIM paths with explicit invariant reporting. Any `TokenSim` change needs separate approval beyond this audit's allowlist. Do not implement chart rejection as an unreviewed silent tape divergence.
4. Retire the pre-fix characterization assertions, require all proposed-contract assertions to pass, rerun timestamp and BUY exhaustion regressions, build and lint. Add integration coverage proving no partial fan-out or post-execution record loss. Run the required sequential Windows lifecycle/trading QA and manual checks on a supported host for production changes.

Acceptance: late ticks are detectable and cannot mutate any candle or watermark; equal timestamps retain execution order; reset permits earlier time; chronological volume is conserved across both metrics and all TFs; no tape/statistics divergence is introduced for supported SIM execution paths. Production implementation stops here pending Human + ChatGPT review and explicit Human approval.
