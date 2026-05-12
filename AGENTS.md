# AGENTS.md — memex-sim

## Purpose

This file defines how AI agents (Claude, Codex, etc.) should work in this repository.
memex-sim is a **pure simulation** of DEX memecoin trading. No real wallet. No blockchain. No real money.
Vision: **Sim → Replay → Live**.

---

## Roles

| Role | Responsibility |
|------|---------------|
| Human | Final decision maker for product direction, architecture tradeoffs, releases, and PR approval |
| Claude Code | Planner and reviewer; identifies scope, risks, affected files, architecture concerns, and manual verification |
| Codex | Implementer and fixer; makes small scoped changes, runs checks, and reports exact diffs |
| ChatGPT | External reviewer / prompt shaper; helps turn plans into safe Codex/Claude prompts and reviews outputs |

Agents must not perform multiple roles in a single PR without explicit approval.

---

## Workflow rules

1. Read the task spec fully before touching code.
2. If the task is ambiguous, stop and ask — do not guess.
3. Keep changes **small and vertical**: one concern per PR.
4. Do not refactor surrounding code unless the task requires it.
5. Do not add error handling for cases that cannot happen.
6. Code, comments, test names, and UI copy must be in **English**.
7. Do not add dependencies without explicit user approval.

---

## AI workflow mode selection

For day-to-day workflow selection, see docs/ai-workflow.md.

Default mode is FAST.
Escalate to STANDARD only when the task is unclear, risky, architectural, multi-file, or touches core runtime/trading/data flow.

---

## Git / branch / PR rules

- Branch from `main` unless told otherwise.
- Branch naming: `feat/<slug>`, `fix/<slug>`, `refactor/<slug>`, `docs/<slug>`.
- One logical change per branch. Do not bundle unrelated fixes.
- PRs must target `main`.
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
docs: add AGENTS.md and CLAUDE.md
```

---

## Versioning / changelog rules

- No `manifest.json`. Version lives in `package.json`.
- Maintain CHANGELOG.md once it exists. Do not create it only for routine docs or small implementation PRs unless the task explicitly asks for release documentation.
- Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), semver.
- Bump version in `package.json` only on release, not on every PR.

---

## Architecture guardrails

### Frozen files — do not change without a migration note

- `src/tokens/types.ts` — all core token types and constants. Any change requires updating every consumer and a comment in the PR explaining why.
- `src/engine/types.ts` — Tick, Candle, Regime, SimEvent, EnginesConfig.
- `src/engine/` and `src/sim/` modules — treat as stable. Refactors need a scoped plan first.

### tokenId-centric logic

- All trading and position logic is keyed on `tokenId` (e.g., `tok_42_a3f1bc`).
- Do not add or expand global symbol-based lookups (`ticker`, `name`).
- Do not introduce cross-token global aggregations unless explicitly requested.

### Registry / store boundary

- `TokenRegistry` lives outside Zustand. It owns the simulation loop.
- Stores receive **lightweight snapshots** — not full candle arrays.
- Chart reads candles directly via `registry.setChartCallback()`, never through a store.
- Do not move simulation state into Zustand.

### Provider abstraction

- Do not add `providers/` abstraction until Replay mode is actively being built.
- No `liveProvider.ts`, no `replayProvider.ts` until explicitly approved.

---

## Trading simulation safety rules

These rules exist because the trading simulation must never become real-money infrastructure.

1. **No real wallet calls.** No `ethers.js`, no `web3.js`, no Solana web3 SDK.
2. **No blockchain RPC calls.** No on-chain reads, no on-chain writes.
3. **No real Buy/Sell button automation.** There are no real buttons to click.
4. **No DOM scraping.** This is a React SPA — no document selectors for external data.
5. **No HUD overlays on external pages.** memex-sim is a standalone SPA.
6. **All SOL and token quantities are simulated.** `walletStore` balances are fake.
7. **`SOL_PRICE_USD = 150` is a hardcoded constant**, not a live feed. Do not replace it with an API call without explicit approval.
8. **Migration threshold**: the actual runtime trigger is `MIGRATION_TARGET_SOL = 228` in `tokenMarketRegimes.ts` (~$34,200), not `MIGRATION_THRESHOLD_USD = 69_000` in `types.ts`. Do not silently reconcile these — document any change.

---

## Testing and manual verification

- TypeScript `strict` mode must pass: `npm run build` must succeed.
- ESLint must pass: `npm run lint`.
- No automated test suite exists yet — manual verification is required for UI changes.

### Manual verification checklist

For any change that touches token lifecycle, trading, or the chart:

- [ ] `npm run dev` starts without console errors.
- [ ] PulsePage loads: New Pairs / Final Stretch / Migrated columns populate.
- [ ] Tokens transition: NEW → FINAL → MIGRATED / RUGGED over time.
- [ ] TokenPage: chart renders candles, migration marker `M` appears at correct price.
- [ ] Quick Buy / Quick Sell executes and updates wallet balance and position.
- [ ] Limit order opens, triggers at target price, fills correctly.
- [ ] No memory leaks or frozen UI after 5 minutes of running.

---

## PR summary format

Every PR description must include:

```
## What
<1–2 sentences: what changed>

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
- If migration marker `M` is misaligned: check `MIGRATION_TARGET_SOL` vs `MIGRATION_THRESHOLD_USD` desync (known issue, documented in `info/02_token_lifecycle.md`).
- If a token gets stuck in FINAL: check `isFinalStretchToken()` in `tokenBuckets.ts` and the bonding curve pct logic in `tokenMarketRegimes.ts`.
- If wallet balance goes negative: check `walletStore.deductSol()` — it returns `false` on failure; callers must check the return value.
