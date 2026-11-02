# memex-sim

DEX-style memecoin trading practice with synthetic tokens, a simulated wallet, and no real money, wallet connection, or blockchain access.

## Current state

**IMPLEMENTED:** simulation mode, Pulse token feed, token charts, synthetic news/posts, tokenId-based quick buy/sell, limit placement/cancellation, positions, PnL, watchlists, and market-session profiles.

**PARTIAL:** the trading UI includes settings with no execution effect, decorative navigation, and a Dev Tokens placeholder. QA covers focused scenarios, not the full application.

**PLANNED:** Replay and optional Live paper-trading are historical product intentions, not implemented modes or implementation approval. See the [status roadmap](docs/roadmap.md).

Status describes source wiring, not a claim that every flow has been verified manually. Known limitations are documented in the [architecture](docs/architecture.md).

## Getting started

```bash
git clone https://github.com/lotoos0/memex-sim.git
cd memex-sim
npm ci
npm run dev
```

Use the URL printed by Vite. CI currently uses Node 20 on Windows; see the [workflow configuration](.github/workflows/ci.yml) for the exact setup.

## Commands

Commands are defined in [package.json](package.json).

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite development server. |
| `npm run build` | Run TypeScript project build checks and create a production build. |
| `npm run lint` | Run ESLint; this is a local requirement, but is not currently a CI step. |
| `npm run preview` | Serve an existing production build locally. |
| `npm run qa:sim:dead-floor` | Run the focused floor/sparse-candle/post-DEAD-buy browser check. |
| `npm run qa:sim:quick-limit` | Run the focused limit-order cancellation and fill browser check. |

Run the two QA commands sequentially. Their current launchers use Windows PowerShell, `cmd.exe`, Edge, and an npm-fetched Playwright CLI; they use the shared local server at `127.0.0.1:5173`. They are not platform-neutral test commands. See [QA coverage and limitations](docs/architecture.md#qa-coverage-and-limitations).

## Routes

| Route | Page |
| --- | --- |
| `/` | Pulse: New Pairs, Final Stretch, and Migrated columns with filters, sorting, and quick buy. |
| `/token/:id` | Token chart, trade sidebar, positions/orders, posts, holders, and optional floating trading/trades panels. |

Only these two routes are registered. Other labels in the header do not imply implemented pages.

## Implementation map

The entry is [src/main.tsx](src/main.tsx), which renders [src/router.tsx](src/router.tsx). The app shell starts and stops the [token registry](src/tokens/registry.ts).

The registry owns TokenSim instances outside Zustand. Active simulation uses [TokenSim](src/tokens/tokenSim.ts), [stepMarket](src/tokens/marketModel.ts), RNG, and CandleAggregator. Stores expose UI snapshots and trading/accounting state; candles go directly to the chart through the registry callback. The historical PriceEngine path is not the active simulation flow.

## Stack

React 19, TypeScript 5.8, Vite 7, Zustand 5, Lightweight Charts 5, React Router 7, Tailwind CSS v4, and Lucide icons. Versions and dependency declarations live in [package.json](package.json).

Preferences and favorites use localStorage/Zustand persistence. `idb-keyval` is referenced by legacy journal code; it does not provide active quick-trading persistence or Replay recording.

## Documentation and contribution

- [Documentation index](docs.md)
- [Architecture and known limitations](docs/architecture.md)
- [Status roadmap](docs/roadmap.md)
- [Agent rules](AGENTS.md) and [FAST/STANDARD workflow](docs/ai-workflow.md)
- [Git playbook](git.md)
- [Historical plan archive](docs/archive/Plan.md)

Use a branch and PR targeting `main`. Bug reports should include reproduction steps and relevant screenshots; feature proposals need a use case and acceptance criteria. New dependencies require explicit approval. Frozen contracts and simulation-only restrictions are defined in AGENTS.md.

## License

MIT. See [LICENSE](LICENSE).
