# Engine V2 slice and calibration-day pilot

The implementation branch starts at V1 main `4b976ad94dfe04429ec3e51af188f87dec06b461`. The approved architecture is RFC Rev. 2. The source specifications are copied from the original checkout. V1 remains the default. Start a V2 session with **New session with V2** or `/?engine=v2`. Switching reloads the app and starts a fresh session.

## Implemented architecture

- One integer-millisecond SimulationClock and single-writer min-heap. Task keys order by time, round, phase and sequence. The manifest pins the model, scheduler, arithmetic, RNG, policies, catalog and config. Recorded ingress captures receipt and acceptance time. Facts carry causes and commit ordinals.
- One shared bigint ledger for user and agents, with SOL and token reserves, individual order escrow, weighted-average cost basis and separate fee collectors. Both curve and pool charge 125 bps. The 5,000-lamport base attempt fee and any priority or bribe amounts are separate. Cancel, expiry and pre-attempt terminal rejection refund the full reservation.
- One standard curve with 1B issued tokens, 793.1M initially offered and the rest in migration escrow. The final curve fill and the funded pool handoff share a settlement commit. The finishing fill stays on the curve tape. Residual assets remain locked. V2 curve SELL debits gross from reserves, with the swap fee transferred to its collector.
- Finite genesis accounts, lightweight creator, momentum and contrarian policies, delayed market observations, a bounded candidate set and shared attention and capital. The ordinary listing desk has a dedicated finite endowment so Social ON and OFF use the same baseline launch schedule.
- Three simulated posts from two fictional authors drive delayed exposure and discovery, related launches, a narrative fork and one repost entity. Lifecycle stores activity separately from market stage and terminal closure. Dormant markets preserve balances, links and prices and can wake on discovery or orders.
- Portable, checksummed world checkpoints include the pending heap, counters, ledger, orders, ingress, agent state and log prefix. Deterministic rerun executes ingress again. Recorded playback applies committed postings, fills, orders and market facts to reconstruct market and financial read models.
- The session binding selects V1 or V2 before mounting the shared views. V2 publishes one revision with its Pulse, order, position, wallet and feed data. Charts consume sparse trade-derived candles and completion markers. Pausing freezes V2 simulation time and pending orders. V2 accounting is owned by its ledger.

## Mechanics and regression

| Check | Result |
| --- | --- |
| `npm run qa:engine-v2` | PASS. Supply, reserves, fees, cost basis, shared cash across tokens, oversell, command deduplication, partial fills, paid failures, refunds, same-time cancel and expiry, unfunded handoff rollback, one migration, next pool BUY and SELL, terminal refund, a below-spot trigger crossed by a committed SELL, and recorded playback. |
| Host steps and restore | PASS for 100, 200 and 1000 ms versus a single advance. Checkpoints exercised during pending completion, open trigger, delayed discovery and dormant state. Node 22.18.0 and Edge returned state `f8092dfbdd7be89f` and log `edd06a22c30a0ffe` for the same core fixture. |
| Social isolation | PASS. No fills or financial changes with agent decisions disabled. Repost wakes a dormant token and produces one shared post. |
| Build and static checks | PASS for build, TypeScript and lint. Five existing lint warnings and the Vite bundle-size warning remain. |
| V1 regressions | PASS for market baseline and OHLC QA, 5 benchmark-definition tests, DEAD floor and quick-limit Edge regressions. The Edge runners used port 5187 to avoid the P1c server on port 5173. |
| Browser V2 | PASS for Pulse, chart rendering, 0.10 SOL BUY, position SELL, open trigger and refund, and eligible trigger execution after resume. The first 1% slippage BUY rejected in a moving market. The successful test used a wider tolerance. The price-crossing path ran in headless QA. |
| UI migration and command replay | PASS. An Edge UI BUY of 90 SOL reached `PARTIAL_CLOSED` and produced one migration marker at $61,632.03. The chart had ten candles and rendered canvas elements. The recorded UI command reran in Node with state `acb818af93738ff3` and log `3fd320463b349cfa`. |
| Browser soak | PASS through 394.801 simulated seconds. Edge reported 14 tokens, 23,570 fills, revision 1,976 and no runtime fault. The dev server logged a favicon 404. No memory profiler was run. |

## Real, V1 and V2 on available data

**Empirical verdict is inconclusive.** The Real reference is the previously analyzed calibration day C, 2026-10-15 UTC. D1 validation and D2 holdout were unavailable. No thresholds for a realism verdict were frozen. The raw Real source and its license and checksums are pinned in [sources.json](sim01/real-market/sources.json).

Real uses the existing standard-K noninstant path analysis. V1 uses the measured A tape at `4b976ad`, SHA-256 `e4f5abccf25682412f038a5b94a8b15d7f77d9765a80dbfd416f6b4131cc424f`. V1 uses `SIM01-A…F`, 1,000 launches per seed, 200 ms steps, 08:00 and 19:00 UTC cohorts and 1,800 s per token. The historical `84eca09` S4 report and P1c candidate are separate artifacts.

V2 uses `ae83b794c6fe96d989b1fa8b307f7530f764a369`, Windows x64 and Node 22.18.0. Run `npm run qa:engine-v2:benchmark` to regenerate the pilot. It runs `V2-PILOT-A…F` in each of three variants, one hour of births and another 30 minutes of follow-up. Each world has 100 agents and a fixed civil epoch of 2026-10-25 09:00 UTC. The summary records source and tape SHA-256 values and each world manifest. NDJSON records births, fills, pre/post reserves and progress, fee-exclusive quote, fees, order IDs and rejections before any UI cap. The pilot pools counts within each variant and gives per-seed ranges where indicated. The independent units for uncertainty are worlds and market days.

| 1,800 s pre-migration horizon | Real C | V1 A | V2 OFF | V2 ON | V2 ON, fixed launches |
| --- | ---: | ---: | ---: | ---: | ---: |
| All births | 36,037 | 6,000 | 628 | 646 | 628 |
| Quiet births | 2,204 | 1,272 | 423 | 458 | 420 |
| Active standard noninstant paths | 20,319 | 4,728 | 205 | 188 | 208 |
| First 80% entrants | 685 | 469 | 57 | 53 | 57 |
| Completions in active standard noninstant paths | 203 | 111 | 18 | 23 | 15 |
| Completions / active standard noninstant | 1.00% | 2.35% | 8.78% | 12.23% | 7.21% |
| Curve fills in active standard noninstant paths | 2,059,319 | 364,196 | 170,634 | 154,494 | 172,265 |
| 80–90% prints per exposed native 1 s bin | 2.1108 | 0.0388 | 2.1773 | 2.1065 | 2.4949 |
| Empty native 1 s bins at 80–90% | 44.62% | 97.02% | 71.33% | 70.37% | 66.87% |
| Median prints per active path, V2 range of world medians | 12 | 59 | 32.5–275 | 115–360 | 47.5–178 |

Quiet births are measured over all observed launches. Real's active cohort excludes nonstandard K and instant completions and therefore cannot be reconstructed by subtracting quiet births from all launches. Native bins use progress at second start. The completing curve print is included. Pool prints are reported separately in the V2 pilot, with no Real pool target.

V2 ON is close to C in average print density at 80–90%, while empty bins remain 25.75 percentage points higher. The ON cohort is much more polarized than C. It has both a higher quiet-birth share and more activity and completion among active tokens. In the first 120 seconds after first80, ON world median reversal counts range from 430 to 645.5. The C median is 92. The sample does not establish a beneficial Social effect. ON adds 18 births across six worlds and has fewer pre-migration prints than OFF. The fixed-launch Social variant shows a different direction in print totals. All variants preserve identical per-seed baseline listing times.

## Performance

The six ON worlds advanced 5,400 simulated seconds each in 5.50–8.32 wall seconds of headless processing per world. Across those worlds, the p99 elapsed time of a one-second advance was 9.62–14.80 ms, throughput was 67k–105k committed facts per wall second and the largest sampled pending queue was 4,565 events. Sampling was every 30 simulated seconds. Timings include the scheduler and fact creation and exclude tape writing, browser rendering and checkpoint I/O. They are observations at this pilot scale.

## Limits and RFC departures

- The demo uses one authored scenario and lightweight strategy heuristics. Author reputation learning, broader catalog variation and empirical social calibration remain open. The initial epoch and thresholds are scenario choices. The calendar is simplified and browser session overrides map to quiet or busy policy tempo.
- Dormant timers are sparse and records survive inactivity. The full journal and projection histories are retained in RAM. The RFC's storage-backed cold history, bounded hot-memory recording, checkpoint durability and storage-quota handling are not implemented. Checkpoint, rerun and playback are programmatic interfaces, with no product Replay UI or browser session persistence.
- Playback reconstructs markets, balances, orders and views. Agent policy memory and pending timers require a full checkpoint. No general fork from a playback cursor is provided. Hash parity is tested for the pinned fixture on Node and Edge.
- The compatibility UI uses existing numeric input controls before converting decimal representations to atoms. Legacy execution rows carry a V2 status extension for partial, expiry and cancel. Terminal UI can retain last-known mark values. Complete unavailable-valuation styling for terminal positions remains open.
- The pilot is diagnostic. The export and report cover core cohorts, event and second-bin exposure, first80, streaks, concentration, drawdowns and reversals. Full §14 joint stratification, pooled path quantiles for every V2 variant, resampling intervals, D1/D2, and production-scale browser memory, GC and commit-latency profiling remain open.
