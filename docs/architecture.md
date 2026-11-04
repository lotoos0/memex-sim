# Current architecture

This describes the implementation at `cf775f0` (main after PR #41), checked against source. It is not a target architecture or a report that every runtime path has been tested. Feature status and historical intentions live in the [roadmap](roadmap.md); binding guardrails remain in [AGENTS.md](../AGENTS.md).

## Application and runtime ownership

[src/main.tsx](../src/main.tsx) renders [src/router.tsx](../src/router.tsx). Its app shell starts `registry` on mount and stops it on cleanup. The registered routes are `/` (PulsePage) and `/token/:id` (TokenPage).

[TokenRegistry](../src/tokens/registry.ts) owns a `Map<string, TokenSim>` outside Zustand, schedules simulation and publication, and selects the active token's candles for the chart. [TokenSim](../src/tokens/tokenSim.ts) owns per-token curve/reserve state, synthetic actors and trades, lifecycle, holders, pending execution, and candle aggregators. Its active market step is [stepMarket](../src/tokens/marketModel.ts), supported by [regimes](../src/tokens/tokenMarketRegimes.ts), [actors](../src/tokens/tokenActors.ts), [RNG](../src/engine/rng.ts), and [CandleAggregator](../src/engine/aggregator.ts).

The registry delegates snapshot publication to [registryFeedPublisher.ts](../src/tokens/registryFeedPublisher.ts), executions to [registryExecutionRelay.ts](../src/tokens/registryExecutionRelay.ts), and narrative processing to [registryNarrative.ts](../src/tokens/registryNarrative.ts). These helpers exist today; they are not Replay/Live provider abstractions.

```text
Router app shell -> registry -> TokenSim instances
TokenSim runtime/market snapshots -> registryFeedPublisher -> tokenStore -> UI
TokenSim candles -> registry chart callback -> Chart
UI -> tradingStore -> registry quote/submit -> TokenSim pending execution
TokenSim execution notices -> registryExecutionRelay -> tradingStore -> wallet/positions/history
registry narrative events -> narrative generation -> postStore -> feed/news UI
```

Snapshot publication, trade execution, and chart delivery are distinct paths. Stores do not own the simulation loop. The active chart does not read candle arrays from a store, although the legacy symbol engine still has a `candles` field in tradingStore.

## Stores and persistence

| Store | Current responsibility | Persistence |
| --- | --- | --- |
| [tokenStore](../src/store/tokenStore.ts) | Token metadata/runtime snapshots, chart events, holder/trade snapshots, derived trade-flow counts, active token and session state. | In memory. |
| [tradingStore](../src/store/tradingStore.ts) | Quick positions, fills, pending orders, open limits, execution/audit history; also retains legacy symbol-centric state and methods. | Active quick trading is in memory. Legacy methods reference IndexedDB journal writers. |
| [walletStore](../src/store/walletStore.ts) | Simulated SOL balance and realized PnL. | In memory; starts at 120 SOL in development and 1 SOL otherwise. |
| [postStore](../src/store/postStore.ts) | Generated, trade and user posts per token. | In memory; capped at 220 posts per token. |
| [favoritesStore](../src/store/favoritesStore.ts) | Favorite tokenIds and compatibility normalization for older saved favorites. | Zustand persist/localStorage under `favorites:v1`. |

UI components also save preferences directly to localStorage: Pulse layout/filter/sort selections, search history, bottom tabs, trade presets/settings, floating-panel position, and panel visibility. Those preferences do not restore simulations, active orders, wallet balances, or positions after reload. TokenIds are generated for each simulation run, so persisted favorite/search ids need not match tokens in a new run.

[src/sim/journal.ts](../src/sim/journal.ts) uses `idb-keyval` for the legacy order/trade/position-history path. Its snapshot loaders have no active callers. This is not a recorder for Replay, and there are no separate presetStore or uiStore modules.

## Scheduling, time and feed buckets

Current scheduling comes from [registry.ts](../src/tokens/registry.ts):

| Mechanism | Current behavior |
| --- | --- |
| Simulation callback | Scheduled every 200 ms. |
| Feed publication | Runtime and market snapshots published every 1,000 ms. Executions/events can update stores between feed publications. |
| Active chart delivery | Invoked from the 200 ms simulation callback when an active token and chart callback exist; not a separate active-token store publisher. |
| Spawn | Poisson count on each simulation step, at the UTC-hour launch rate in [launchRate.ts](../src/market/launchRate.ts) (about 18-57/min; 24-hour mean 32.3). The draw uses sim dt, so the expected count does not depend on tick length. Session tempo profiles do not multiply this rate. |
| Eviction | Every 2 sim seconds, dormant tokens leave the registry and the token/post stores. A token the user is viewing, holds (qty > 0), or has an open or in-flight order on is kept. The newest births plus a bounded Final Stretch and Migrated set stay for Pulse. |
| Bootstrap | Creates 17 tokens with requested groups of 10 New Pairs, 3 Final Stretch, 2 Migrated and 2 weak/dead. Each group uses simulated advancement and retry/fallback logic, so resulting bucket counts can differ. |

### Time base

There is one simulation clock. `SIM_TIME_MULTIPLIER` in [tokens/types.ts](../src/tokens/types.ts) is the scale: simulation milliseconds advanced per wall-clock millisecond. The default is **1** (real time), so in-app ages and durations match wall time the way they do on pump.fun. [simClock.ts](../src/tokens/simClock.ts) is the only code that reads the constant. A different scale, if set later, speeds or slows age, fate and dev timers, migration-readiness age, regime and attention timing, market steps, cooldown decay, candle timestamps, and tape timestamps together. Do not multiply by the constant again at a call site.

Each token measures the wall gap since its previous tick, falls back to the callback's 200 ms when that gap is not positive, and clamps the wall gap to 0.05-1.5 seconds before scaling it. The same scaled step updates token age and the absolute timestamp `spawnWallMs + simTimeMs` used for candles and tape. At scale 1, an on-time 200 ms callback keeps that timestamp on the wall clock. A stalled callback does not dump the whole stall into one market step; age and the chart lag the wall together until later ticks. The registry spawn epoch starts at two hours and advances by the same clamped step as the callback, scaled once. It orders births. Displayed age is the token's own `simTimeMs`, not that epoch. Births during that step use the UTC hour of the wall clock.

Bootstrap fast-forward seeks the same clock in steps of 0.2-1.2 seconds. It stops when the token matches its column (and is at least as old as that column's minimum) or can no longer match, and otherwise stops at the rolled age cap. The head of that clock is then shifted onto the wall, to the nearest second, without rebuilding candles from the capped trade tape. Candle history ends at "now" and spans the simulated age. It does not run a second, faster lifecycle clock.

These stay on the wall clock on purpose, and they line up with the simulation clock only while the scale is 1:

- Market session (EU/NA hour) is civil time.
- Player order latency (about 80-320 ms) is how long a click waits. Due-ness uses that wall wait. The fill timestamp is the simulation clock, including when a clamped stall leaves that clock behind the wall.

The legacy PriceEngine clock is not on this path.

The 5-minute volume window, fate timeouts, flow and dev warmups, and `MIN_MIGRATION_AGE_SEC` are durations on this clock. Curve completion, not that age gate, still latches migration. Readiness (age, real quote in the curve, holder count, and trades over five minutes) only eases the pre-completion approach friction.

[PulsePage](../src/pages/PulsePage.tsx) builds its initial New Pairs list from the newest 20 non-migrated tokens, including eligible dead/rugged entries. Its Final Stretch list uses bonding progress of at least 80% and below 100%, excluding MIGRATED/DEAD/RUGGED; its Migrated list uses phase MIGRATED. User column selections, filters and sorting further shape displayed rows.

[isNewPairsToken](../src/tokens/tokenBuckets.ts) still applies a maximum age of three minutes. Pulse itself lists the newest 20 non-migrated tokens, the top 16 Final Stretch rows, and the top 20 Migrated rows. Bootstrap targets are not per-column display limits. Dormant tokens are evicted during a running session; pinned tokens (open position, open order, or the selected token) are not.

[Market sessions](../src/market/session.ts) use wall time: EU is 06:00-15:00 at fixed UTC+2; NA is 08:00-17:00 in America/New_York. Overlap and off-hours select different synthetic behavior profiles. TokenPage offers a development-only session override and curve debug overlay (`?debug=curve`).

## Contracts, constants and lifecycle

The frozen contracts are [tokens/types.ts](../src/tokens/types.ts) and [engine/types.ts](../src/engine/types.ts). Read them directly rather than copying the historical plan's interfaces. TokenMeta includes `logoColor`, `imageUrl` (themed launch image path or null), and `supply`; TokenRuntime includes simulation time and rug timing. The engine Tick shape is `{ t, p, v }`, not the archived provider example.

| Value | Current source/meaning |
| --- | --- |
| Supply | `SUPPLY = 1_000_000_000` in tokens/types.ts. |
| Floor / cap | `MCAP_FLOOR_USD = 2_000`, `MCAP_CAP_USD = 10_000_000` in tokens/types.ts. |
| Time scale | `SIM_TIME_MULTIPLIER = 1` in tokens/types.ts. Applied only through simClock.ts. See the migration note below. |
| Simulated SOL reference | `SOL_PRICE_USD = 150` in tokens/types.ts. A separate `SOL_PRICE_USD_REFERENCE = 150` exists in tokenMarketRegimes.ts. Neither is a live feed. |
| Runtime/chart migration threshold | `getMigrationThresholdUsd()` in [tokenMarketRegimes.ts](../src/tokens/tokenMarketRegimes.ts) returns `MIGRATION_TARGET_SOL` (228) times its SOL reference (150): $34,200. |
| Frozen legacy/public threshold | `MIGRATION_THRESHOLD_USD = 69_000` remains in tokens/types.ts; it has no active source consumer. It is not the runtime trigger or current chart line. |

These are observations, not approval to reconcile constants or change contracts.

### Migration note: `SIM_TIME_MULTIPLIER` 60 → 1

Until this change the constant advanced only token age, fate, dev/flow warmups, and age gates. `stepMarket`, regime decay, candle time, and tape timestamps used the unscaled wall delta. A 90-second gate therefore elapsed in about 1.5 wall seconds, and the chart's one-second buckets did not match the age label. The constant is now the single scale, default 1, applied only in `simClock.ts`. Numeric gates, warmups, fate ranges, lambdas, trade-size clips, and curve constants are unchanged; they are read on the unified clock. `MIGRATION_THRESHOLD_USD` was not reconciled.

[generator.ts](../src/tokens/generator.ts) defines fates and timeout ranges. Bootstrap still passes an explicit fate. Fresh births use [freshLaunch.ts](../src/tokens/freshLaunch.ts): about half never open crowd flow (dev buy only), and the rest use a fate mix on the existing age-decay arrival model. Fresh tokens start at $2,000 mcap; bootstrapped tokens are advanced before registration. The dev-buy schedule still runs on the launch tick.

TokenSim enters FINAL through bonding progress and migrates when a BUY empties the curve's real-token inventory. Fate timeout starts collapse handling; non-migrated tokens become DEAD when at the floor under that handling. The contract retains RUGGED, but current TokenSim logic normalizes that state to DEAD rather than providing the historical 60-120-second RUGGED display interval. DEAD does not remove the token or prohibit user BUY execution.

## Trading and chart flow

Active UI uses `quickBuy(tokenId, amountSol)`, `quickSell(tokenId, amountSol)`, `placeQuickLimitOrder(...)`, and `cancelQuickLimitOrder(...)` in [tradingStore](../src/store/tradingStore.ts). Positions, pending orders, fills, limits, and execution history are tokenId-based.

Quick buys reserve SOL plus transaction costs; quick sells check available quantity against pending/open sell reservations and deduct transaction costs. Registry quote/submit delegates to TokenSim, which queues execution with simulated latency and slippage checks. The execution relay updates runtime/events/posts and notifies the tradingStore subscriber, which applies fills/failures to wallet, positions and histories.

Open limits reserve funds/quantity. BUY triggers at current price <= limit price; SELL triggers at current price >= limit price. The store checks immediately on placement and on market snapshot changes, normally at the feed cadence. Triggering submits a market execution with slippage checks; it is not a guarantee of filling at the limit price. Cancelling an open limit refunds its reserved SOL and transaction cost. Repricing, expiry and advanced order policies are not implemented.

The same store still exposes symbol-centric `placeOrder`, `cancelOrder` and `onPriceTick` logic. Active UI uses the quick path. Shared defaults and module-level execution/limit subscriptions mean the whole module cannot be classified as dead code.

[Chart](../src/components/chart/Chart.tsx) reads candles through `registry.setChartCallback()`. It supports price/mcap, 1s/15s/30s/1m timeframes (default 1s), average buy/sell and migration lines, and M/DB/DS/B/S event markers from [tokenChartEvents.ts](../src/chart/tokenChartEvents.ts). Aggregators retain up to 3,000 candles per series. Candles are sparse: missing trade buckets do not receive synthetic flat candles.

## UI, narrative and partial features

[PulsePage](../src/pages/PulsePage.tsx) wires dense/comfortable layouts, filters, sorting, token-card quick buy, favorites and recent news. [TokenPage](../src/pages/TokenPage.tsx) wires the chart, trade sidebar, floating instant trade panel, trades table and [bottom tabs](../src/components/token/BottomTabs.tsx): Trades, Feed, Positions, Orders, Holders and Top Traders.

[registryNarrative.ts](../src/tokens/registryNarrative.ts) turns launch, phase changes and large trades into events processed by [tokenNarrative.ts](../src/narrative/tokenNarrative.ts), [authorCatalog.ts](../src/narrative/authorCatalog.ts), and [newsTemplateEngine.ts](../src/narrative/newsTemplateEngine.ts). Posts reach the UI through postStore; [TokenFeed](../src/components/token/TokenFeed.tsx) also accepts local user posts. All of this is synthetic, not an external news feed.

Current UI limitations include:

- Dev Tokens is a placeholder, and Discover/Trackers/Perpetuals/Portfolio header labels are not registered routes.
- [TokenColumn](../src/components/pulse/TokenColumn.tsx) and [InstantTradePanel](../src/components/floating/InstantTradePanel.tsx) duplicate settings and save shared localStorage keys using separate component state. RPC, MEV, auto-fee and max-fee controls do not affect submitted orders; slippage, priority and bribe do.
- [SearchOverlay](../src/components/layout/SearchOverlay.tsx) labels a sort as 1hr volume but compares `vol5mUsd` (five minutes on the simulation clock).
- [TokenCard](../src/components/pulse/TokenCard.tsx) copies synthetic tokenId as CA and constructs a Solscan link from it. This does not make it a real contract address.

## QA coverage and limitations

Commands live in [package.json](../package.json). [CI](../.github/workflows/ci.yml) uses Windows and Node 20, installs with `npm ci`, typechecks, builds, then runs the two QA commands sequentially. It does not run lint. Build success does not demonstrate every UI/trading flow is correct.

| Command | What the current scenario checks | Limits |
| --- | --- | --- |
| `npm run qa:sim:dead-floor` | Above-floor phase is not DEAD in the configured case; no new candles during forced idle; DEAD at floor; a user BUY can fill afterward and grow the tape. | [Harness](../scripts/qa/sim-dead-floor-test.run.js) uses a seeded setup, direct private-state manipulation and real waits. It is not exhaustive lifecycle or timing coverage. |
| `npm run qa:sim:quick-limit` | Placement reduces wallet balance; cancellation restores it; no execution appears during the cancellation wait; BUY/SELL limits fill and update positions; execution-count assertions and no remaining open limits. | [QA module](../src/qa/quickLimitQa.ts) selects a token from the random running simulation. BUY stability reads are adjacent with no delay; zero remaining quantity is rejected by the truthiness-based wait helper. Boundary/negative cases and delayed duplicate BUY fills are not comprehensively tested. See [outer assertions](../scripts/qa/quick-limit-order-test.run.js). |

Run the checks sequentially: both [PowerShell launchers](../scripts/qa/quick-limit-order-test.ps1) use the shared local Vite server on `127.0.0.1:5173`, Playwright CLI sessions and Edge. The [floor launcher](../scripts/qa/sim-dead-floor-test.ps1) has the same platform requirements. CLI provisioning uses unpinned `npx --yes --package @playwright/cli`, so execution also depends on external tooling availability. The scripts' historical "deterministic" labels overstate reproducibility, particularly for quick-limit QA.

There is no broad unit/integration suite. Follow AGENTS.md for manual checks when changing lifecycle, chart or trading behavior. At the PR #41 validation baseline, build passed and lint reported 17 errors and 7 warnings; that is a recorded baseline, not a permanent description of future check results.

## Other known limitations

These code-path findings need targeted validation before selecting remedies:

- Dormant registry tokens are evicted, and a silenced coin skips the market step. Per-token candle/tape/post caps still apply to coins that stay. Quick trade histories for tokens the user already closed are not purged. See [registry](../src/tokens/registry.ts), [avatar cache](../src/lib/tokenAvatar.ts), and tradingStore.
- Registry stop clears execution-relay subscribers, but tradingStore installs its subscriber once behind a global flag. Restart can therefore lose the accounting bridge. Stop also leaves corresponding Zustand snapshots/accounting state behind. This is a lifecycle risk, not a claim of a reproduced production incident.
- TokenSim publishes only the latest 120 trades by default. [tokenStore](../src/store/tokenStore.ts) computes its 60-second buy/sell/transaction counts from that truncated snapshot, so busy tokens can be undercounted. Top Traders also aggregates the published recent tape, not lifetime activity.
- PriceEngine, EventEngine, Clock and [config/config.json](../config/config.json) belong to an inactive historical price path. The old sim matcher/risk helpers are not the active quick matching path. [Legacy components](../legacy/components/README.md) are reference-only and not a working fallback.

No providers directory, Replay recorder/player, or Live feed adapter is implemented. Their absence is consistent with deferring provider abstraction until approved Replay work. This document does not authorize extraction, deletion, a rewrite, or contract changes.
