# memex-sim

**Crypto trading simulator (DEX-style) built with React + TypeScript.**
Random OHLC candles, pump/dump events, trading panel, positions, PnL, and persistent storage.

## Demo

* Live: *TBD (Vercel/Netlify)*
* GIF/screenshot: *TBD* ()

## Features

* 📈 Chart (Lightweight Charts) with volume, crosshair, OHLC tooltip
* 📰 **Fake news events**: "CT hype", "Dev rug" → drift/volatility spikes
* 💼 **Trading panel**: Market/Limit, preset amounts, % of balance
* 📊 **Positions & history**: unrealized/realized PnL, order statuses
* 💾 **Persistence**: localStorage (v1), IndexedDB planned (v2)
* ⚙️ Settings: TF, candle type, indicators (EMA/SMMA), reset/lock autoscale

## Roadmap (short)

* [x] PnL, events, persistence
* [ ] Limit/Stop lines with drag ↔ input sync
* [ ] SL/TP with draggable lines and PnL calculator modal
* [ ] Partial fills, fee model (maker/taker + dex fee)
* [ ] Leverage, IM/MM, **liq price** (gold line) and liquidation
* [ ] IndexedDB + migrations, CSV export, sorting/filtering
* [ ] Seed `?seed=1234` + "Replay run"
* [ ] Hotkeys: B/S/C/R, Alt-LMB=SL, Shift-LMB=TP

## Tech Stack

* **Frontend:** React, TypeScript, Vite
* **Charting:** TradingView Lightweight Charts
* **State:** Zustand
* **Testing:** Vitest + Cypress (planned)
* **CI/CD:** GitHub Actions (planned)
* **Deploy:** Vercel / Netlify

## Architecture (v1)

```
/src
  /components    # Chart, Toolbar, TradePanel, Tables
  /lib           # candle generator, PnL/fees utils, events
  /store         # trading state (positions, orders, settings)
  /hooks         # feed/interval, persistence
```

## Installation

```bash
git clone https://github.com/lotoos0/memex-sim.git
cd memex-sim
npm i
npm run dev
```

## Scripts

```bash
npm run dev       # start dev
npm run build     # production build
npm run preview   # local preview
npm run test      # tests (when added)
```

## Hotkeys (planned)

* **B/S** – Buy/Sell
* **C** – Close 100%
* **R** – Reset View
* **Ctrl+0** – Reset zoom
* **Alt+LMB** – draw SL, **Shift+LMB** – draw TP

## Quality & Performance

* 60 FPS with 5–10k candles (worker + rAF)
* Zustand selectors for minimal re-renders
* Unit tests for PnL/avgPrice/liq (planned)

## Contribution / Issues

PRs welcome. Report bugs and feature requests in **Issues**:

* bug: description + steps + screenshot
* feature: use-case + acceptance criteria

## License

MIT. See `LICENSE` file.

> CI gate smoke test marker (2026-03-06).
