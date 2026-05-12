# memex-sim

DEX-style memecoin trading simulator — pure simulation, no real money.

## What is memex-sim

memex-sim is a pure simulation of DEX-style memecoin trading. It uses no real wallets, no blockchain, and no real money. The goal is to help users practice reading memecoin charts, managing risk, and developing trading intuition in a safe environment.

## Vision

- Sim — current/active simulation mode.
- Replay — next: play back recorded or generated market runs.
- Live — future: paper-trading against a real feed, only after explicit approval.

## Features

- Multi-token feed on PulsePage.
- Token lifecycle: NEW → FINAL → MIGRATED / RUGGED / DEAD.
- Price engine with pump/dump/bleed-style regimes.
- Fake tweet/news narrative system.
- TradingView Lightweight Charts with migration marker.
- Trading panel with quick buy/sell and limit orders.
- Positions with realized/unrealized PnL.
- Simulated wallet and SOL balance.
- Market sessions: EU / NA / OVERLAP / OFF.

## Routes

| Route | Page | Description |
| --- | --- | --- |
| `/` | PulsePage | Live multi-token feed. |
| `/token/:id` | TokenPage | Chart + trade sidebar + positions. |

## Architecture

```text
src/
  app/                  # app root
  chart/                # chart event wiring
  components/
    chart/              # chart UI components
    common/             # shared common components
    floating/           # floating UI components
    layout/             # layout components
    pulse/              # PulsePage UI components
    token/              # TokenPage UI components
    news/               # fake news UI components
    ui/                 # base UI components
  engine/               # price engine
  market/               # session system
  narrative/            # fake tweet/news generation
  pages/                # route pages
  sim/                  # matching, risk, journal simulation
  store/                # Zustand stores
  tokens/               # registry, generator, lifecycle, regimes, buckets, actors
  utils/                # helper utilities
```

## Tech Stack

| Area | Technology |
| --- | --- |
| UI | React 19 |
| Language | TypeScript 5.8 |
| Build | Vite 7 |
| State | Zustand 5 |
| Charts | TradingView Lightweight Charts 5 |
| Styling | Tailwind CSS v4 |
| Routing | react-router-dom v7 |
| Storage helpers | idb-keyval |
| Icons | lucide-react |

## Getting Started

```bash
git clone https://github.com/lotoos0/memex-sim.git
cd memex-sim
npm install
npm run dev
```

## Scripts

```bash
npm run dev
npm run build
npm run lint
npm run preview
npm run qa:sim:dead-floor
npm run qa:sim:quick-limit
```

The `qa:sim:*` scripts use PowerShell scripts.

## Roadmap

| Phase | Status | Scope |
| --- | --- | --- |
| Phase 1 — Sim | Active | Engine, multi-token feed, trading panel, PnL, lifecycle. |
| Phase 2 — Replay | Next | Replay recorded/generated runs, timeline scrubber, export. |
| Phase 3 — Live | Future | Paper trading against a real feed; no code without explicit approval. |

## Contributing

- PRs only.
- Do not commit directly to main.
- Bug reports need description, steps, and screenshot.
- Feature requests need use-case and acceptance criteria.
- New npm dependencies require approval.

## License

MIT. See LICENSE file.
