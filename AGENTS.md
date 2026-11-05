# AGENTS.md - memex-sim

## Purpose

This file defines how humans and AI agents work in this repository.
memex-sim is a **pure simulation** of DEX memecoin trading. No real wallet. No blockchain. No real money.
Vision: **Sim → Replay → Live**.

---

## Roles

| Role | Responsibility |
|------|---------------|
| Human | Product decisions, architecture tradeoffs, approvals, releases, and final PR/merge |
| Coordinating AI chat | Task definition, planning, delegating to implementing agents, reviewing their results and CI with the Human |
| Implementing agents | Analysis, technical planning, implementation, fixes, and validation within approved scope (e.g. Codex, Cursor cloud agents, subagents) |
| Independent AI reviewer | Separate review pass (e.g. Codex review); findings are fixed in the same PR before Human merge |

Implementing agents may analyze, plan, implement, and validate in the same PR. The coordinating chat and Human review the result; the Human retains final approval.
Deploy, release publication, and merge require explicit Human authorization. Creating a PR does not authorize merge or deploy.
Agents working in parallel must not touch the same files or branches.

---

## Workflow rules

1. Read the task spec fully before touching code.
2. If the task is ambiguous, stop and ask — do not guess.
3. Keep changes **small and vertical**: one concern per PR.
4. Code, comments, test names, and UI copy must be in **English**.
5. Do not add dependencies without explicit user approval.
6. Calibration/behavior PRs must include a before/after measurement (numbers + how measured, seeds/hours). See PR `## Measurement`.

Style details (comments, error handling, minimal diff, judgment) live in [Engineering style](#engineering-style) and the full guide [docs/engineering-style.md](docs/engineering-style.md).

---

## AI workflow mode selection

For mode selection, workflows, and the technical plan format, see [docs/ai-workflow.md](docs/ai-workflow.md).

FAST is the default for clear, local, reversible work with straightforward validation.
Use STANDARD for unclear or risky work, architecture decisions, dependencies, frozen contracts, persistence, or changes to core runtime/trading/data flow, registry, engine, sim, Replay, or Live.
Risk overrides file count: a one-file accounting change is STANDARD; several documentation files can still be FAST.
STANDARD requires explicit Human implementation approval after Human + coordinating-chat plan review. An already approved plan does not need another approval unless its scope or risks change.

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
docs: clarify agent workflow
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
- `src/tokens/curveConstants.ts` - official pump.fun bonding-curve reserves/fees; changing them shifts all calibration.

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

`MIGRATION_THRESHOLD_USD` is a frozen legacy/public constant. Do not use it as a runtime trigger or silently reconcile it with curve completion.

**Migration threshold (runtime):** since PR #61, official bonding-curve constants live in `src/tokens/curveConstants.ts` (`INITIAL_VIRTUAL_TOKEN_RESERVES = 1_073_000_000`, `INITIAL_VIRTUAL_SOL_RESERVES = 30`, `INITIAL_REAL_TOKEN_RESERVES = 793_100_000`, `CURVE_FEE_BPS = 125`). Migration latches when the curve is exhausted (`curveRealToken === 0` → `curveCompleted` in `src/tokens/tokenSim.ts`), then phase update can graduate the token. At `SOL_PRICE_USD = 150` that is roughly **~85 SOL** net raised and **~$61.6k** completion mcap (see `src/qa/officialCurveQa.ts`). Chart/regime reference mcap uses `TokenSim.getMigrationReferenceMcapUsd()` (actual completion/event mcap), not the legacy USD constants.

`MIGRATION_TARGET_SOL = 228` and `getMigrationThresholdUsd()` in `src/tokens/tokenMarketRegimes.ts` still exist (~$34,200). They are **not** the runtime migration trigger; they remain for regimes/QA helpers that still call them. Do not silently reconcile them with curve completion — document any change.

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
8. **Migration trigger**: curve exhaustion (`curveRealToken === 0` → `curveCompleted` in `tokenSim.ts`), using constants from `curveConstants.ts` (~85 SOL / ~$61.6k mcap at SOL=150). Not `MIGRATION_TARGET_SOL = 228` (~$34,200) and not `MIGRATION_THRESHOLD_USD = 69_000`. Do not silently reconcile these — document any change.

---

## Testing and manual verification

- TypeScript `strict` mode must pass: `npm run build` must succeed.
- ESLint must pass: `npm run lint` (`.js/.jsx/.ts/.tsx` only).
- CI (`.github/workflows/ci.yml`) runs on **Windows**: lint, `tsc --noEmit`, build, and the browser QA scripts below.
- Focused browser QA (Windows PowerShell + Edge): `npm run qa:sim:dead-floor` and `npm run qa:sim:quick-limit`. Run them sequentially for lifecycle or trading changes. Manual verification is still required for UI changes.
- Headless QA scripts live in `src/qa/*.ts` (~21 files). Run one with:
  ```bash
  ./node_modules/.bin/esbuild src/qa/<file>.ts --bundle --platform=node --format=esm \
    --define:import.meta.env.DEV=true --out-extension:.js=.mjs --outdir=/tmp/qa \
    && node /tmp/qa/<file>.mjs
  ```
  Note: some scripts export a `run*Qa()` function (call it); others self-execute on import. `quickLimitQa.ts` is **browser-only** (driven by the PowerShell launcher), not this Node path.
- Real-market calibration targets and handoff notes: [docs/calibration/](docs/calibration/) (`HANDOFF.md`, `zrodla-danych-i-plan.md`, `faza1/`).
- Report checks actually run, known existing failures, and any checks that could not run. Do not describe unrun checks as passing.

### Manual verification checklist

For any change that touches token lifecycle, trading, or the chart:

- [ ] `npm run dev` starts without terminal/browser errors or unhandled promise rejections.
- [ ] PulsePage loads: New Pairs / Final Stretch / Migrated columns populate; mcap, volume, and age update.
- [ ] Tokens transition: NEW → FINAL → MIGRATED / RUGGED over time.
- [ ] TokenPage: chart renders candles, migration marker `M` appears at the migration event.
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

## Measurement
<!-- Required for behavior/calibration changes; optional for docs. -->
<before/after numbers + how measured (command, seeds, hours)>

## Guardrails check
- [ ] src/tokens/types.ts not changed (or migration note included)
- [ ] No real wallet/blockchain code added
- [ ] No new dependencies added (or approval noted)
- [ ] tokenId-centric logic preserved
- [ ] npm run build passes
```

---

## Engineering style

Condensed from Senior Engineering Style v2.0. Full Polish text: [docs/engineering-style.md](docs/engineering-style.md). On conflict, this section + the Workflow rules above win.

**Mindset:** Write as the engineer who will maintain this in production. Prefer correctness, readability, predictability, and risk awareness over clever abstractions.

- **Comments — why, not what.** Explain non-obvious constraints and decisions; do not narrate obvious code. Prefer simplifying code that needs a wall of comments.
- **Honest debt.** Use `TODO` / `FIXME` / `HACK` only for real planned work, confirmed bugs, or conscious workarounds — with the problem stated (and an exit condition when possible). Do not invent debt or leave a critical bug as a comment alone.
- **Minimal sufficient design.** Fit existing architecture; no new layers/frameworks for hypothetical needs. Every abstraction must pay for itself. No drive-by large refactors during a small change.
- **Clear control flow.** Guard clauses over deep nesting; split functions when responsibility clarity improves, not by line count. Handle errors at the right level — do not add handlers for impossible cases.
- **Precise names.** Domain terms, concise; avoid vague `manager`/`handler` without a clear job. Do not rename for taste alone.
- **Production mindset.** Apply timeouts, retries, validation, concurrency, resource, security, and observability concerns **when the real risk warrants them** — not every imagined scenario.
- **Evidence.** Do not invent benchmarks or claim improvements without measurement. Separate observation from hypothesis; say when you could not verify.
- **Minimal diff.** Change only what the task needs; prefer small, testable, reversible edits; keep behavior changes distinct from refactors.
- **Verify.** Test behavior and relevant edges with existing tools; never claim unrun checks passed.
- **Judgment.** Ask what breaks and how you will verify before coding; prefer not changing code that already meets the need; push back on unsafe or overcomplicated asks with a simpler proposal.

**Agent method:** (1) read relevant context, (2) pick the least justified complexity, (3) make a coherent bounded change, (4) verify with available tools, (5) summarize what changed, what was checked, and remaining risks. Plan briefly only when the change is complex or risky. No filler docs, fake comments, or extra files without cause.

**Final rule:** Write code for the next engineer who will maintain it — not for the reviewer you want to impress.

---

## Failure handling

- If `npm run build` fails: fix TypeScript errors before declaring done.
- If the chart stops rendering after a change: check `registry.setChartCallback()` wiring and candle aggregator state.
- If migration marker `M` or the migration line looks wrong: marker `M` is the migration **event**; the line uses `TokenSim.getMigrationReferenceMcapUsd()` (completion/event mcap from the bonding curve). Do not substitute `getMigrationThresholdUsd()` / 228 SOL or the frozen `$69,000` legacy constant.
- If a token gets stuck in FINAL: check curve progress / `curveCompleted` latch in `tokenSim.ts`, migration readiness gates, and `isFinalStretchToken()` in `tokenBuckets.ts`.
- If wallet balance goes negative: check `walletStore.deductSol()` - it returns `false` on failure; callers must check the return value.
