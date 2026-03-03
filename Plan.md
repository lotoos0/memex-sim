# memex-sim — Plan & Roadmap

## Wizja projektu

**Strzelnica memecoinów** — symulator DEX tradingu inspirowany Axiom.trade.
Platforma do nauki handlu memecoinami: Sim → Replay → Live.

---

## Decyzje projektowe (ustalone)

### Tokeny na home page
- ~5 tokenów na kolumnę (New Pairs / Final Stretch / Migrated)
- Nowe pary pojawiają się automatycznie, zastępując dead tokeny

### Wallet
- Fake wallet: startowe **1 SOL**
- SOL/USD: stała cena referencyjna (np. $150) — uproszczenie
- Wszystkie operacje w SOL, przeliczane na USD w UI

### Token lifecycle (probabilistyczny)
Każdy token dostaje "fate" przy urodzeniu:

| Typ | Czas sim | Czas realny (60x) | % |
|-----|----------|-------------------|---|
| Quick rug | 5–30 min | 5–30 sek | ~20% |
| Short | 30 min–3h | 30 sek–3 min | ~40% |
| Normal | 3h–12h | 3–12 min | ~30% |
| Long runner | 12h–48h+ | 12–48 min | ~10% |

- **SIM_TIME_MULTIPLIER: 60** — 1s realna = 60s symulacji
- Migration threshold: mcap ~$69K → przechodzi do kolumny Migrated
- Rug: token zostaje w feed jako `RUGGED` przez 60–120s (realnych), potem `DEAD` i cleanup
- Floor mcap: ~$2K (żywy token nie spada niżej)
- Cap mcap: ~$500K (zapobiega crazy outliers)

### Architektura: soft reboot
- **Zachowujemy** `engine/` (PriceEngine, CandleAggregator, EventEngine, Clock, RNG)
- **Zachowujemy** `sim/` (matcherSim, journal, risk)
- **Piszemy od nowa**: store, komponenty, routing, layout

---

## Kontrakty danych (zamrożone — nie zmieniamy)

```ts
// Static metadata — nigdy nie zmienia się po spawn
type TokenMeta = {
  id: string;
  name: string;
  ticker: string;
  logoKey: string;          // seed dla koloru/inicjałów
  createdAtSimMs: number;
  fate: 'QUICK_RUG' | 'SHORT' | 'NORMAL' | 'LONG_RUNNER';
  metrics: {
    topHoldersPct: number;
    devHoldingsPct: number;
    snipersPct: number;
    lpBurnedPct: number;
    insidersPct: number;
    bundlersPct: number;
  };
};

// Runtime values — zmienia się często
type TokenPhase = 'NEW' | 'FINAL' | 'MIGRATED' | 'RUGGED' | 'DEAD';

type TokenRuntime = {
  phase: TokenPhase;
  lastPriceUsd: number;
  mcapUsd: number;
  liquidityUsd: number;
  bondingCurvePct: number;
  vol5mUsd: number;
  buys5m: number;
  sells5m: number;
  changePct: number;
  expiresAtSimMs: number | null;  // kiedy token znika z feed
};

// Tick (wspólny dla Sim/Replay/Live)
type Tick = { tsMs: number; priceUsd: number; volumeUsd: number };
```

---

## Abstrakcja na źródło danych (Sim/Replay/Live)

```ts
interface MarketDataProvider {
  listTokens(): Promise<Array<{ id: string; name: string; ticker: string }>>;
  subscribeTicks(tokenId: string, onTick: (t: Tick) => void): () => void;
}

// Implementacje:
// SimProvider    → engine/ (teraz)
// ReplayProvider → czyta z IndexedDB/pliku (faza 3)
// LiveProvider   → WebSocket / indexer API (faza 4)
```

Trading (wallet + orders + PnL) jest **identyczny** niezależnie od trybu.

---

## Architektura store (jedno źródło prawdy)

### Stores:
- `walletStore` — saldo SOL, historia
- `tokenStore` — `tokensById: Record<string, TokenMeta & TokenRuntime>` + `activeTokenId`
- `tradingStore` — pozycje, zlecenia, PnL (per token)
- `presetStore` — 3 presety (amounts, slPct, tpPct, sellPcts)
- `uiStore` — pozycja floating panelu, widoczność

### ❌ Usunięto:
- `registryStore` — zastąpiony **selectorami** z `tokenStore`:
  ```ts
  selectTokensByPhase('NEW')    // → newPairs[]
  selectTokensByPhase('FINAL')  // → finalStretch[]
  selectTokensByPhase('MIGRATED') // itd.
  ```

---

## Tick architecture (performance)

```
Engine tick:           200ms  (każdy token, PriceEngine.tick())
Store publish (feed):  1000ms (snapshoty dla wszystkich tokenów → re-render home)
Store publish (active): 200ms (tylko aktywny token → re-render chart)
Candles: trzymane w engine, Chart odczytuje bezpośrednio (poza Zustand)
```

`TokenRegistry` trzyma `Map<tokenId, TokenEngine>` — **poza Zustand**.
Store dostaje tylko lekkie snapshoty, nie pełne candle arrays.

---

## Struktura plików

```
src/
├── engine/          ← BEZ ZMIAN
├── sim/             ← BEZ ZMIAN
├── tokens/
│   ├── types.ts          ← TokenMeta, TokenRuntime, TokenPhase
│   ├── generator.ts      ← losowe generowanie tokenów
│   ├── lifecycle.ts      ← fazy, rug logic, migration trigger
│   ├── tokenSim.ts       ← wrapper: token = PriceEngine + events + aggregator
│   └── registry.ts       ← Map<id, TokenEngine>, spawn, cleanup
├── providers/
│   ├── types.ts          ← MarketDataProvider interface, Tick
│   ├── simProvider.ts    ← używa registry
│   ├── replayProvider.ts ← (faza 3)
│   └── liveProvider.ts   ← (faza 4)
├── store/
│   ├── walletStore.ts
│   ├── tokenStore.ts     ← tokensById + selectors + activeTokenId
│   ├── tradingStore.ts
│   ├── presetStore.ts
│   └── uiStore.ts
├── pages/
│   ├── PulsePage.tsx
│   └── TokenPage.tsx
├── components/
│   ├── pulse/
│   │   ├── TokenColumn.tsx
│   │   └── TokenCard.tsx
│   ├── chart/
│   │   ├── Chart.tsx
│   │   └── ChartTopbar.tsx
│   ├── token/
│   │   ├── TokenHeader.tsx
│   │   ├── TokenStats.tsx
│   │   └── TokenInfo.tsx
│   ├── trading/
│   │   └── FloatingPanel.tsx
│   ├── bottom/
│   │   └── BottomPanel.tsx
│   └── layout/
│       └── Header.tsx
├── hooks/
│   └── useTokenEngine.ts  ← hook dla TokenPage (chart data)
├── router.tsx
├── main.tsx
└── styles.css
```

---

## Implementacja - Vertical Slices (nie Big Bang)

### Slice 1 - Dziala end-to-end (bez ladnego UI)
- [x] Zainstalowac `react-router-dom`
- [x] Nowa struktura folderow, cleanup starych komponentow
- [x] `tokens/types.ts` - zamrozone kontrakty
- [x] `tokens/generator.ts` - generator tokenow (obecnie 12 tokenow startowo)
- [x] `tokens/tokenSim.ts` + `tokens/registry.ts`
- [x] `store/tokenStore.ts` z selectorami
- [x] `router.tsx` - `/` i `/token/:id`
- [x] `pages/PulsePage.tsx` - lista 3 kolumn NEW/FINAL/MIGRATED
- [x] `pages/TokenPage.tsx` - token details + wykres aktywnego tokena
- [x] **Cel:** klik na token -> widze wykres

### Slice 2 - Wallet + trading
- [x] `store/walletStore.ts` - 1 SOL
- [x] `store/tradingStore.ts` - multi-token trading + presety w store
- [ ] `components/trading/FloatingPanel.tsx` - brak (jest `TradeSidebar`)
- [ ] `store/presetStore.ts` - brak osobnego store (presety sa w `tradingStore`)
- [ ] Quick buy z listy (PulsePage)
- [ ] **Cel:** pelny flow "kup token z listy i od razu widze pozycje" (czesciowo)

### Slice 3 - Lifecycle + feed
- [ ] `tokens/lifecycle.ts` - brak osobnego pliku (lifecycle jest w `tokenSim.ts` i `registry.ts`)
- [x] Spawn nowych tokenow co X sekund
- [x] Cleanup dead tokenow
- [ ] Animacje: nowy token, rug flash, migration
- [x] Liczniki live (vol/buys/sells)
- [x] **Cel:** feed zyje, tokeny przechodza przez lifecycle

### Slice 4 - Polish UI (Axiom look)
- [x] `components/pulse/TokenCard.tsx` - pelna karta
- [ ] `components/token/TokenHeader.tsx` - brak osobnego komponentu
- [ ] `components/token/TokenInfo.tsx` - brak osobnego komponentu
- [ ] `components/bottom/BottomPanel.tsx` - brak (jest `BottomTabs` jako placeholder)
- [x] Global CSS - ciemny motyw
- [ ] **Cel:** wyglad jak Axiom (wciaz WIP)

### Slice 5 - Replay Mode
- [ ] `providers/replayProvider.ts`
- [ ] Zapis tickow do IndexedDB podczas Sim
- [ ] Odtwarzanie z predkoscia x10/x60
- [ ] UI: tryb replay, scrubber czasu

### Slice 6 - Live Mode (opcjonalnie, na koncu)
- [ ] `providers/liveProvider.ts`
- [ ] Wybor API (3rd party vs wlasny indexer)
- [ ] Obsluga limitow, desyncow, lagow

### Dodatkowo zrobione (poza pierwotna checklista)
- [x] Chart: ciagle swiece bez gapow + domyslny TF 15s
- [x] TF na wykresie: 1s / 15s / 30s / 1m
- [x] Display Options + markery: `M`, `DB`, `DS`, `B`, `S`
- [x] Pipeline eventow (migration/dev/user) + ring buffer eventow
- [x] Pre-migration bonding curve oparty o reserve state
- [x] Dev debug overlay `?debug=curve` (k, kDrift, invalid state, last swap)
- [x] Smooth handoff po migracji + sanity clampy swapow

---
## Tech Stack (nasz, inspirowany Axiom)

### Axiom używa (Wappalyzer):
`Next.js · React · React Router · Tailwind CSS · Framer Motion · Goober · Howler.js · Ethers · Lucide · Sentry · Turbopack`

### My zostajemy z Vite (nie Next.js — SPA, zero SSR/SEO potrzebne)

### Dodajemy:
| Biblioteka | Po co | Priorytet |
|-----------|-------|-----------|
| `framer-motion` | Animacje tokenów (appear, rug flash, migration) | Slice 3 |
| `howler` | Dźwięki (fill, SL hit, rug event) | Slice 4 |
| `lucide-react` | Ikony (zastępuje obecne SVG stubs) | Slice 1 |
| `tailwindcss` | Zamiast custom CSS — spójny design system | Decyzja do podjęcia |

### ✅ CSS: Tailwind CSS v4 (z @tailwindcss/vite plugin)
Custom color palette w CSS:
```css
@import "tailwindcss";
@theme {
  --color-ax-bg: #0a0a0f;
  --color-ax-surface: #12121a;
  --color-ax-border: #1e1e2e;
  --color-ax-green: #00d4a1;
  --color-ax-red: #ff4d6a;
  --color-ax-yellow: #f5c542;
  --color-ax-muted: #6b7280;
  --color-ax-text: #e2e8f0;
}
```

### Nie dodajemy:
- `ethers` — nie potrzebujemy Web3 (pure simulation)
- `goober` — Tailwind wystarczy
- `Sentry` / `Datadog` — nie na tym etapie

---

## Config (SIM_TIME_MULTIPLIER)

Do `config/config.json`:
```json
{
  "sim": {
    "timeMultiplier": 60,
    "spawnIntervalRealMs": 45000,
    "maxTokensPerColumn": 5,
    "feedPublishIntervalMs": 1000,
    "activePublishIntervalMs": 200
  }
}
```

---

## Istniejące bugi (stara wersja — do pominięcia przy rewrite)
- Chart zoom/pan
- KPI hardcoded mocks
- CSV export zakomentowany
- applyPreset stub
- Toolbar buttons ikony bez handlerów
