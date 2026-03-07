# memex-sim - handoff for a second AI

Updated: 2026-03-07

## 1) What this is
`memex-sim` is a memecoin trading simulator inspired by DEX/Axiom UX.
It is currently a React + Vite SPA running in active `SIM` mode.

Main flow:
- `Pulse` (`/`) shows a live token feed split into 3 buckets: `New Pairs`, `Final Stretch`, `Migrated`.
- Clicking a token opens `TokenPage` (`/token/:id`) with chart, trading, feed and market panels.
- Wallet, quick trading and chart all run on a local synthetic market driven by `registry` + `TokenSim`.

## 2) Actual stack
- Frontend: React 19, TypeScript, Vite
- Routing: `react-router-dom` v7
- State: Zustand
- Chart: `lightweight-charts`
- UI: Tailwind CSS v4
- Icons: `lucide-react`
- Local persistence: `localStorage` + `zustand/persist`

Scripts:
- `npm run dev`
- `npm run build`
- `npm run lint`
- `npm run preview`
- `npm run qa:sim:dead-floor`

## 3) Contracts and constants not to change without migration
The core contract lives in `src/tokens/types.ts`.

Most important values:
- lifecycle: `NEW -> FINAL -> MIGRATED`, plus `RUGGED` and `DEAD`
- fate: `QUICK_RUG | SHORT | NORMAL | LONG_RUNNER`
- `MIGRATION_THRESHOLD_USD = 69_000`
- `MCAP_FLOOR_USD = 2_000`
- `MCAP_CAP_USD = 10_000_000`
- `SIM_TIME_MULTIPLIER = 60`
- `SOL_PRICE_USD = 150`
- wallet start: `120 SOL` in DEV, `1 SOL` outside DEV (`src/store/walletStore.ts`)

## 4) Runtime and data architecture
The main orchestrator is `src/tokens/registry.ts`.

Runtime loops:
- engine tick: `200ms`
- publish feed/store snapshot: `1000ms`
- spawn interval: `40_000ms`
- initial tokens: `12`
- bucket limits: `MAX_NEW = 5`, `MAX_FINAL = 5`, `MAX_MIGRATED = 5`

`registry.start()` is called in `src/router.tsx`.

`registry` is responsible for:
- spawning and ticking all `TokenSim` instances
- publishing runtime state to `tokenStore`
- publishing market snapshots: `recentTrades`, `topHolders`, `holdersCount`
- market session bucket (`EU`, `NA`, `OVERLAP`, `OFF`)
- narrative/posts via `postStore`
- user trade orders / executions

In practice there are now 3 data layers:
1. `tokensById` and runtime feed in `src/store/tokenStore.ts`
2. market micro snapshots in `src/store/tokenStore.ts`
3. narrative/social feed in `src/store/postStore.ts`

## 5) Stores and their roles
- `src/store/tokenStore.ts`
  - `tokensById`
  - `eventsByTokenId`
  - `marketByTokenId`
  - `tradeFlowByTokenId` (buys/sells/tx over a 60s window)
  - `activeTokenId`
  - `marketSessionBucket` and debug `marketSessionBucketOverride`
- `src/store/tradingStore.ts`
  - quick token-centric trading used by the UI
  - still also contains an isolated legacy symbol-centric engine (`orders`, `positions`, `trades`, `symbol`)
- `src/store/walletStore.ts`
  - SOL balance and realized PnL
- `src/store/postStore.ts`
  - posts per token, system + user
- `src/store/favoritesStore.ts`
  - watchlist/favorites per token, persisted

Architecture takeaway:
- `tokenStore` is now more than a pure runtime token store
- `tradingStore` is still the main source of technical debt

## 6) Trading - current state
The active trading path is quick token-centric trading:
- `quickBuy(tokenId, amountSol)`
- `quickSell(tokenId, amountSol)`
- `quickPositionsByTokenId`
- `quickTradesByTokenId`
- `pendingQuickOrdersById`
- `quickExecutionHistoryByTokenId`

Current execution path:
- quote/submit/order status flows through `registry` and `TokenSim`
- `registry` emits execution notices
- UI and post feed receive fill information

Legacy still exists in the same store:
- `placeOrder`
- `cancelOrder`
- `onPriceTick`
- `orders`, `positions`, `trades`, `symbol`

Important audit result:
- active `src/` UI no longer reads legacy symbol-centric state directly
- remaining legacy usage is isolated to internal store logic and the `legacy/` directory
- dead public API (`mode`, `setMode`, `hydrateFromDB`, `applyPreset`) has been removed

This is still the main architectural issue: quick flow and legacy flow coexist in the same store until the legacy engine is extracted or deleted.

## 7) UI - what actually works
### Pulse
Files:
- `src/pages/PulsePage.tsx`
- `src/components/pulse/TokenColumn.tsx`
- `src/components/pulse/TokenCard.tsx`
- `src/components/pulse/PulseFiltersModal.tsx`
- `src/components/pulse/pulseFilters.ts`
- `src/components/pulse/pulseSorts.ts`

Working:
- 3 bucket columns
- display mode: `comfortable` / `dense`
- per-bucket filters and sort
- trade-flow-aware filtering (`tx60s`, `buys60s`, `sells60s`)
- dead/rugged tokens still show in buckets
- quick actions on token cards
- card also shows latest news/post

### TokenPage
Files:
- `src/pages/TokenPage.tsx`
- `src/components/chart/Chart.tsx`
- `src/components/token/TradeSidebar.tsx`
- `src/components/token/BottomTabs.tsx`
- `src/components/token/TradesTablePanel.tsx`
- `src/components/token/TokenFeed.tsx`
- `src/components/floating/InstantTradePanel.tsx`
- `src/components/token/PositionsTab.tsx`
- `src/components/token/OrdersTab.tsx`

Working:
- chart `mcap/price`
- TF: `1s`, `15s`, `30s`, `1m`
- event markers: `M`, `DB`, `DS`, `B`, `S`
- price lines: avg buy, avg sell, migration
- trade sidebar with market buy/sell
- floating instant trade panel
- right-side live trades table
- bottom tabs: `Trades`, `Feed`, `Positions`, `Orders`, `Holders`, `Top Traders`
- watchlist toggle
- session bucket badge
- dev overlays: curve debug + session override

Still incomplete:
- `Dev Tokens` tab
- limit mode in `TradeSidebar` is still queued/stub
- legacy symbol-centric engine still needs further reduction or extraction from `tradingStore`

## 8) Narrative and social layer
This is a newer area compared with older project descriptions.

Files:
- `src/store/postStore.ts`
- `src/narrative/tokenNarrative.ts`
- `src/narrative/newsTemplateEngine.ts`
- `src/narrative/authorCatalog.ts`
- `src/components/token/TokenFeed.tsx`
- `src/components/news/TweetHoverCard.tsx`

How it works:
- `registry` emits narrative events on launch, migration, rug and big trades
- the narrative layer maps that into pseudo-posts/news
- posts go into `postStore`
- the user can also add manual posts in `Feed`

This is not a separate domain layer yet, but it is already wired into runtime.

## 9) Main technical risks
1. `src/store/tradingStore.ts` still mixes quick token-centric trading with a legacy symbol-centric engine.
2. `src/tokens/registry.ts` keeps growing toward an orchestration god-object: runtime, executions, narrative, session bucket, posting.
3. There is still no provider abstraction (`Sim/Replay/Live`) in code, even though the broader project plan assumes it.
4. `Plan.md` is partially outdated relative to the actual repo.
5. There is no real test suite yet; only focused QA scripts and build/type gates.

## 10) What to do next
Most sensible order:
1. Keep shrinking legacy symbol flow inside `tradingStore`.
2. Keep all active UI on quick selectors/helpers only; do not reintroduce legacy reads.
3. Decide whether `TradeSidebar` limit mode should become quick-native or wait for provider/order-model cleanup.
4. Extract a market provider contract from `registry` if the project is meant to move toward Replay/Live.
5. Add tests for lifecycle, fill logic and market snapshots.

## 11) Minimum file set for a second AI to read
- `Plan.md`
- `package.json`
- `src/router.tsx`
- `src/pages/PulsePage.tsx`
- `src/pages/TokenPage.tsx`
- `src/store/tokenStore.ts`
- `src/store/tradingStore.ts`
- `src/store/walletStore.ts`
- `src/store/postStore.ts`
- `src/store/favoritesStore.ts`
- `src/tokens/types.ts`
- `src/tokens/generator.ts`
- `src/tokens/tokenSim.ts`
- `src/tokens/registry.ts`
- `src/components/chart/Chart.tsx`
- `src/components/token/TradeSidebar.tsx`
- `src/components/token/BottomTabs.tsx`
- `src/components/token/TradesTablePanel.tsx`
- `src/components/token/TokenFeed.tsx`
- `src/components/token/PositionsTab.tsx`
- `src/components/token/OrdersTab.tsx`
- `src/components/floating/InstantTradePanel.tsx`
- `src/components/pulse/TokenCard.tsx`
- `src/components/pulse/PulseFiltersModal.tsx`
- `src/components/pulse/pulseFilters.ts`
- `src/components/pulse/pulseSorts.ts`

## 12) Working prompt for a second AI
Use this style:

"You are acting as a technical copilot for `memex-sim`. Prioritize small vertical slices and working code after every change. Make the decision first, then give short reasoning. Treat `src/tokens/types.ts` as a frozen contract. Prefer `tokenId`-centric architecture. Reduce legacy `symbol` flow instead of expanding it. For every change provide: diagnosis, proposal, files, risk, and a manual test or build check."

## 13) Definition of Done
- `npm run build` passes
- critical UI flow works manually
- no contract changes without a migration note
- short changelog: what was done and what was intentionally not done
