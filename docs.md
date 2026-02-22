# memex-sim - handoff dla drugiego AI

Data aktualizacji: 2026-02-21

## 1) Co to jest
memex-sim to symulator tradingu memecoinow w stylu DEX.
Aktualnie dziala jako SPA (React + Vite) z trybem SIM i synthetic marketem.

Flow usera:
- Pulse (`/`) z kolumnami tokenow.
- Wejscie w token (`/token/:id`) -> chart + trading sidebar + dolny panel.
- Opcjonalny floating `InstantTradePanel` (toggle w BottomTabs).

## 2) Faktyczny stack
- Frontend: React 19, TypeScript, Vite
- Routing: react-router-dom v7
- State: Zustand
- Chart: lightweight-charts
- UI: Tailwind CSS v4 (theme w `src/styles.css`)
- Ikony: lucide-react

Skrypty:
- `npm run dev`
- `npm run build`
- `npm run lint`
- `npm run preview`

## 3) Kontrakty i stale (traktuj jako zamrozone)
Plik: `src/tokens/types.ts`

- Token lifecycle: `NEW -> FINAL -> MIGRATED`, plus `RUGGED`, `DEAD`
- Fate: `QUICK_RUG | SHORT | NORMAL | LONG_RUNNER`
- `MIGRATION_THRESHOLD_USD = 69_000`
- `MCAP_FLOOR_USD = 2_000`
- `MCAP_CAP_USD = 10_000_000`
- `SIM_TIME_MULTIPLIER = 60`
- `SOL_PRICE_USD = 150`

Wallet:
- `src/store/walletStore.ts`
- start balance: `120 SOL` w DEV, `1 SOL` poza DEV

## 4) Architektura runtime (co faktycznie dziala)
Glowny orchestrator: `src/tokens/registry.ts`

- engine tick: `200ms`
- publish feed do store: `1000ms`
- spawn tokena: `40_000ms`
- rugged linger przed cleanupem: `90_000ms`
- startowe tokeny: `12`

`registry.start()` jest wywolywany w `src/router.tsx` (AppShell `useEffect`).

Chart aktualnie idzie callbackiem z registry (poza Zustand dla candle arrays):
- TF: `1s`, `15s`, `30s`, `1m`
- metric: `mcap` / `price`
- markery eventow: `M`, `DB`, `DS`, `B`, `S`
- price lines: avg buy, avg sell, migration
- context menu reset chart + hotkey `Alt+R`

## 5) Trading - realny stan
Plik: `src/store/tradingStore.ts`

Sa dwa swiaty, oba nadal istnieja:

1. Quick token-centric flow (aktywnie uzywany przez UI):
- `quickBuy(tokenId, amountSol)`
- `quickSell(tokenId, amountSol)`
- `quickPositionsByTokenId`
- `quickTradesByTokenId`
- wykonanie przez `registry.executeTrade(...)`

2. Legacy symbol-centric flow (wciaz w store, mniej uzywany):
- `orders`, `positions`, `trades`, `symbol`, `mode`
- `placeOrder`, `cancelOrder`, `onPriceTick`, `applyPreset`
- persist snapshotow przez `src/sim/journal.ts`

Wniosek: trading core jest czesciowo zduplikowany i architektonicznie niespojny.

## 6) UI status
Dziala:
- `src/pages/PulsePage.tsx` (3 kolumny: New Pairs, Final Stretch, Migrated)
- `src/components/pulse/TokenCard.tsx` z quick `Buy 0.1`/`Sell 0.1`
- `src/pages/TokenPage.tsx` (header, chart, sidebar, quick trade status)
- `src/components/token/TradeSidebar.tsx` z market buy/sell (limit ma komunikat "queued")
- `src/components/floating/InstantTradePanel.tsx` (draggable, presety, localStorage)

WIP / placeholder:
- `src/components/token/BottomTabs.tsx` (taby sa, content "queued in next slice")
- `src/hooks/usePriceFeed.ts` jest deprecated stub
- `src/app/App.tsx` jest deprecated stub

## 7) Najwazniejsze ryzyka techniczne
1. Rozjazd miedzy quick token-centric trading i legacy symbol-centric trading w jednym store.
2. Lifecycle i trading coupling przez `registry` (dziala, ale utrudnia przyszly provider abstraction).
3. Brak warstwy providerow (`src/providers/*` nie istnieje) blokuje clean wejscie w Replay/Live.
4. Brak testow automatycznych i brak `npm run test`.

## 8) Priorytety na teraz (kolejnosc)
1. Ujednolicic trading store pod `tokenId` i usunac/odizolowac legacy sciezki.
2. Domknac taby dolne (Trades/Positions/Orders) na realnych danych quick flow.
3. Rozdzielic kontrakt danych marketowych (`MarketDataProvider`) od implementacji SIM.
4. Dopiero potem wchodzic w Replay mode.

## 9) Minimalny pakiet plikow do analizy przez drugie AI
- `Plan.md`
- `package.json`
- `src/router.tsx`
- `src/pages/PulsePage.tsx`
- `src/pages/TokenPage.tsx`
- `src/components/chart/Chart.tsx`
- `src/components/token/TradeSidebar.tsx`
- `src/components/token/BottomTabs.tsx`
- `src/components/floating/InstantTradePanel.tsx`
- `src/store/tokenStore.ts`
- `src/store/tradingStore.ts`
- `src/store/walletStore.ts`
- `src/tokens/types.ts`
- `src/tokens/generator.ts`
- `src/tokens/tokenSim.ts`
- `src/tokens/registry.ts`
- `src/chart/tokenChartEvents.ts`

## 10) Prompt roboczy dla drugiego AI
Uzyj tego jako stylu pracy:

"Dzialaj jako technical copilot dla `memex-sim`. Priorytet: male, pionowe kroki i dzialajacy kod po kazdej zmianie. Najpierw decyzja, potem krotkie uzasadnienie. Traktuj `src/tokens/types.ts` jako kontrakt zamrozony. Preferuj `tokenId`-centric architecture i redukuj legacy `symbol` flow. Przy kazdej zmianie podaj: (1) diagnoza, (2) propozycja, (3) pliki, (4) ryzyko, (5) test manualny/build." 

## 11) Definition of Done dla pojedynczego taska
- `npm run build` przechodzi
- krytyczny flow UI dziala recznie
- brak zmian kontraktow bez notatki migracyjnej
- krotki changelog: co zrobiono i czego swiadomie nie zrobiono
