# AGENTS.md - memex-sim

## Purpose

This file defines how Codex works with Human + ChatGPT in this repository.
memex-sim is a **pure simulation** of DEX memecoin trading. No real wallet. No blockchain. No real money.
Vision: **Sim → Replay → Live**.

---

## Roles

| Role | Responsibility |
|------|---------------|
| Human | Product decisions, architecture tradeoffs, releases, explicit implementation approval in STANDARD, and final PR/merge approval |
| ChatGPT | Task definition, plan review, and diff/CI review with the Human |
| Codex | Codebase analysis, technical planning, implementation, fixes, and validation within the approved scope |

Codex may analyze, plan, implement, and validate in the same PR. Human + ChatGPT review the result; the Human retains final approval.
Codex works from explicit task instructions. Deployment and release publication require explicit Human authorization. Creating a PR does not authorize either or automatic merging.

---

## Workflow rules

1. Read the task spec fully before touching code.
2. If the task is ambiguous, stop and ask - do not guess.
3. Keep changes **small and vertical**: one concern per PR.
4. Do not refactor surrounding code unless the task requires it.
5. Do not add error handling for cases that cannot happen.
6. Code, comments, test names, and UI copy must be in **English**.
7. Do not add dependencies without explicit user approval.
8. Write comments for non-obvious reasons, not to narrate what the code does.

---

## AI workflow mode selection

For mode selection, workflows, and the technical plan format, see [docs/ai-workflow.md](docs/ai-workflow.md).

FAST is the default for clear, local, reversible work with straightforward validation.
Use STANDARD for unclear or risky work, architecture decisions, dependencies, frozen contracts, persistence, or changes to core runtime/trading/data flow, registry, engine, sim, Replay, or Live.
Risk overrides file count: a one-file accounting change is STANDARD; several documentation files can still be FAST.
STANDARD requires explicit Human implementation approval after Human + ChatGPT plan review. An already approved plan does not need another approval unless its scope or risks change.

---

## Git / branch / PR rules

- Branch from `main` unless told otherwise.
- Branch naming: `feat/<slug>`, `fix/<slug>`, `refactor/<slug>`, `docs/<slug>`.
- One logical change per branch. Do not bundle unrelated fixes.
- PRs must target `main`. Do not commit directly to `main`.
- Do not squash or rebase published commits without asking.
- Do not force-push to `main`.

---

## Commit format

```
type(scope): short description

Optional body if the why is non-obvious.
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`

Scopes: `engine`, `tokens`, `store`, `ui`, `chart`, `sim`, `narrative`, `runtime`, `registry`

Examples:
```
fix(runtime): hard-cap non-ready tokens at migration line
feat(store): add selectQuickTradingUiState selector
docs: clarify Codex workflow
```

---

## Versioning / changelog rules

- No `manifest.json`. Version lives in `package.json`.
- Maintain CHANGELOG.md once it exists. Do not create it only for routine docs or small implementation PRs unless the task explicitly asks for release documentation.
- Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), semver.
- Bump version in `package.json` only on release, not on every PR.

---

## Architecture guardrails

### Frozen files - do not change without a migration note

- `src/tokens/types.ts` - all core token types and constants. Any change requires updating every consumer and a comment in the PR explaining why.
- `src/engine/types.ts` - Tick, Candle, Regime, SimEvent, EnginesConfig.
- `src/engine/` and `src/sim/` modules - treat as stable. Refactors need a scoped plan first.

### Scoped plans for core changes

Before modifying these areas, use STANDARD and obtain approval for a scoped plan:

- `src/tokens/registry.ts` - owns the simulation loop; changes affect all tokens.
- `src/store/tradingStore.ts` - owns position accounting; mistakes can corrupt PnL.
- `src/engine/` - simulation engine behavior and fidelity.
- `src/sim/` - matching, fills, slippage, risk, and journal behavior.

### Frozen constants in `src/tokens/types.ts`

```text
SUPPLY = 1_000_000_000
MIGRATION_THRESHOLD_USD = 69_000
MCAP_FLOOR_USD = 2_000
MCAP_CAP_USD = 10_000_000
SIM_TIME_MULTIPLIER = 1
SOL_PRICE_USD = 150
```

`SIM_TIME_MULTIPLIER` is the only simulation time scale (simulation milliseconds per wall-clock millisecond). It is 1 after the clock migration in [docs/architecture.md](docs/architecture.md): age, gates, market steps, candles, and tape all use that scale once via `src/tokens/simClock.ts`. Do not reintroduce a second clock or apply the constant anywhere else.

`MIGRATION_THRESHOLD_USD` is a frozen legacy/public constant. Do not use it as a runtime trigger or silently reconcile it with the current runtime threshold.
Runtime and chart migration thresholds must use `getMigrationThresholdUsd()` from `src/tokens/tokenMarketRegimes.ts` unless a migration-contract cleanup is explicitly approved. Any reconciliation requires a documented migration note.

### tokenId-centric logic

- All positions, orders, and trade history are keyed on `tokenId` (e.g., `tok_42_a3f1bc`).
- Do not add or expand global symbol-based lookups (`ticker`, `name`).
- Do not introduce cross-token global aggregations unless explicitly requested.
- Do not resolve symbols to tokenIds outside UI display code.

### Registry / store boundary

- `TokenRegistry` lives outside Zustand. It owns the simulation loop and is the single source of truth for simulation state.
- Stores receive **lightweight snapshots** - not full candle arrays.
- Chart reads candles directly via `registry.setChartCallback()`, never through a store.
- Do not move simulation state into Zustand or put simulation tick logic in a Zustand action.
- Justify any proposed crossing of the registry/store boundary in the technical plan.

### Provider abstraction

- Do not add `providers/` abstraction until Replay mode is actively being built.
- No `liveProvider.ts`, no `replayProvider.ts` until explicitly approved.

---

## Trading simulation safety rules

These rules exist because the trading simulation must never become real-money infrastructure.

1. **No real wallet calls.** Do not import `ethers`, `web3`, `@solana/web3.js`, or similar wallet/blockchain SDKs.
2. **No blockchain RPC or API calls.** No on-chain reads, on-chain writes, or live trading API connections, even as stubs or placeholders.
3. **No real-money operations or external Buy/Sell button automation.**
4. **No DOM scraping.** This is a React SPA - no document selectors for external data.
5. **No HUD overlays on external pages.** memex-sim is a standalone SPA.
6. **All SOL and token quantities are simulated.** `walletStore` balances are fake.
7. **`SOL_PRICE_USD = 150` is a hardcoded constant**, not a live feed. Do not replace it with an API call without explicit approval.
8. **Migration threshold**: the actual runtime trigger is `MIGRATION_TARGET_SOL = 228` in `tokenMarketRegimes.ts` (~$34,200), not `MIGRATION_THRESHOLD_USD = 69_000` in `types.ts`. Do not silently reconcile these - document any change.

---

## Testing and manual verification

- TypeScript `strict` mode must pass: `npm run build` must succeed.
- ESLint must pass: `npm run lint`.
- Focused browser QA checks exist: `npm run qa:sim:dead-floor` and `npm run qa:sim:quick-limit`. Run them sequentially for lifecycle or trading changes; the current launchers require Windows PowerShell and Edge. Manual verification is still required for UI changes.
- Report checks actually run, known existing failures, and any checks that could not run. Do not describe unrun checks as passing.

### Manual verification checklist

For any change that touches token lifecycle, trading, or the chart:

- [ ] `npm run dev` starts without terminal/browser errors or unhandled promise rejections.
- [ ] PulsePage loads: New Pairs / Final Stretch / Migrated columns populate; mcap, volume, and age update.
- [ ] Tokens transition: NEW → FINAL → MIGRATED / RUGGED over time.
- [ ] TokenPage: chart renders candles, migration marker `M` appears at correct price.
- [ ] Quick Buy: buy 0.1 SOL; verify pending -> filled -> position updated, and wallet balance decreases.
- [ ] Quick Sell: sell the position; verify SOL returns to the wallet and realized PnL updates.
- [ ] Limit buy below current price opens, triggers at target price, and fills correctly.
- [ ] After 5 minutes: feed continues updating, with no frozen UI or memory errors.

---

## PR summary format

Every PR description must include:

```
## What
<1-2 sentences: what changed>

## Why
<1 sentence: why this was needed>

## Scope
<which files were changed and why>

## Guardrails check
- [ ] src/tokens/types.ts not changed (or migration note included)
- [ ] No real wallet/blockchain code added
- [ ] No new dependencies added (or approval noted)
- [ ] tokenId-centric logic preserved
- [ ] npm run build passes
```

---

## Failure handling

- If `npm run build` fails: fix TypeScript errors before declaring done.
- If the chart stops rendering after a change: check `registry.setChartCallback()` wiring and candle aggregator state.
- If migration marker `M` is misaligned: verify runtime and chart both use `getMigrationThresholdUsd()` from `src/tokens/tokenMarketRegimes.ts`; do not substitute the frozen legacy threshold.
- If a token gets stuck in FINAL: check `isFinalStretchToken()` in `tokenBuckets.ts` and the bonding curve pct logic in `tokenMarketRegimes.ts`.
- If wallet balance goes negative: check `walletStore.deductSol()` - it returns `false` on failure; callers must check the return value.
