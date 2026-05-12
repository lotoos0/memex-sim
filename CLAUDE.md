# CLAUDE.md — memex-sim

## Claude Code role

Claude Code is a coding assistant, not an autonomous agent. It proposes and implements changes in response to explicit instructions. It does not deploy, publish, or execute real-money operations.

memex-sim is a **pure simulation**. Claude must never introduce code that connects to real wallets, real blockchains, or live trading APIs — even as a stub or placeholder.

---

## Planning format

Before implementing any non-trivial change, produce a plan in this format:

```
## Goal
<one sentence>

## Files touched
<list: file path → what changes and why>

## Guardrails check
- Does this touch src/tokens/types.ts? If yes: migration note required.
- Does this add a new dependency? If yes: stop and ask.
- Does this cross the registry/store boundary? If yes: justify.
- Does this add provider abstraction? If yes: stop and ask.

## Risk
<one sentence: what could go wrong>
```

Wait for approval before writing code.

---

## Review checklist

Before marking a task done:

- [ ] `npm run build` passes (TypeScript strict + Vite).
- [ ] `npm run lint` passes (ESLint).
- [ ] No `console.error` or unhandled promise rejections in the browser.
- [ ] PulsePage renders all three columns with live data.
- [ ] TokenPage chart renders with correct migration marker position.
- [ ] Trading flow: quickBuy → pending → filled → position updated.
- [ ] `src/tokens/types.ts` not changed, or a migration note is present in the PR.
- [ ] No new npm dependencies added without approval.
- [ ] All new code and comments are in English.

---

## Architecture guardrails

### Never modify without a scoped plan

- `src/tokens/registry.ts` — owns the simulation loop; changes affect all tokens.
- `src/store/tradingStore.ts` — position accounting; bugs here corrupt PnL.
- `src/engine/` — price engine; changes alter simulation fidelity for all tokens.
- `src/sim/` — matching engine; changes affect fill behavior and slippage.

### tokenId-centric rule

All positions, orders, and trade history are keyed on `tokenId`. Do not introduce:
- Global symbol (`ticker`) lookups for trading logic.
- Cross-token position aggregation (unless explicitly requested).
- Symbol-to-id resolution outside of UI display code.

### Frozen constants (src/tokens/types.ts)

```typescript
SUPPLY = 1_000_000_000
MIGRATION_THRESHOLD_USD = 69_000   // frozen legacy/public constant; do not use as runtime trigger unless explicitly reconciling migration contracts The runtime/chart migration threshold should use getMigrationThresholdUsd() from src/tokens/tokenMarketRegimes.ts unless a migration-contract cleanup is explicitly approved.
MCAP_FLOOR_USD = 2_000
MCAP_CAP_USD = 10_000_000
SIM_TIME_MULTIPLIER = 60
SOL_PRICE_USD = 150
```

The **actual migration runtime trigger** is `MIGRATION_TARGET_SOL = 228` in
`src/tokens/tokenMarketRegimes.ts` (228 × $150 = $34,200). The `$69K` figure is
used only for UI labeling. Do not silently reconcile these — any change requires
a documented migration note.

### Registry / store separation

- `TokenRegistry` is the single source of truth for simulation state.
- Zustand stores hold UI-ready snapshots only.
- Candle data flows through `registry.setChartCallback()` directly to `Chart.tsx` — never through a store.
- Do not put simulation tick logic in a Zustand action.

### Replay / Live mode

Do not add `providers/` abstraction, `replayProvider`, or `liveProvider` until
Replay mode is actively being built. Adding an abstraction layer prematurely
creates dead code and misleads future readers.

---

## Manual verification format

After any change to token lifecycle, trading, or chart rendering, verify manually:

```
1. npm run dev — no errors in terminal or browser console.
2. PulsePage: 3 columns load with tokens, mcap/vol/age update in real time.
3. Token lifecycle: observe at least one token transition NEW → FINAL → MIGRATED or RUGGED.
4. TokenPage: open a token, confirm chart renders candles.
5. Migration marker: the M line on the chart aligns with the token's mcap at migration.
6. Quick Buy: buy 0.1 SOL worth, confirm wallet balance decreases, position appears.
7. Quick Sell: sell position, confirm SOL returns to wallet, realized PnL updates.
8. Limit order: place a limit buy below current price, wait for trigger, confirm fill.
9. Run for 5 minutes: no frozen UI, no memory errors, feed continues updating.
```

---

## Things Claude must not do

| Must not | Reason |
|----------|--------|
| Call any blockchain RPC or API | memex-sim is pure simulation |
| Import `ethers`, `web3`, `@solana/web3.js`, or similar | No real-money code allowed |
| Replace `SOL_PRICE_USD = 150` with a live price feed | Explicit design choice; ask first |
| Change `src/tokens/types.ts` without a migration note | Frozen contract; all consumers must be updated |
| Add `providers/` abstraction before Replay is approved | Premature abstraction |
| Expand symbol-based (`ticker`) trading logic | Deprecated path; use tokenId |
| Add DOM selectors targeting external pages | This is a self-contained SPA |
| Auto-click any external Buy/Sell button | There are no external pages |
| Add `npm` dependencies without approval | Dependency changes require explicit approval |
| Write code comments that describe what the code does | Only write comments for non-obvious WHY |
| Commit directly to `main` | All changes go through PRs |
