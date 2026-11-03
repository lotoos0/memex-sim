import { TokenSim } from '../tokens/tokenSim';
import { registry } from '../tokens/registry';
import { useTokenStore } from '../store/tokenStore';
import { useTradingStore } from '../store/tradingStore';
import { useWalletStore } from '../store/walletStore';
import { SOL_PRICE_USD, SUPPLY, type TokenMeta } from '../tokens/types';
import { getMigrationThresholdUsd } from '../tokens/tokenMarketRegimes';

// Standalone QA only: bracket access keeps deterministic fixtures and isolated
// order processing out of the public runtime API. Run in a fresh Node process.
let assertions = 0;
function assert(condition: boolean, label: string): asserts condition {
  assertions++;
  if (!condition) throw new Error(label);
}
function near(actual: number, expected: number, label: string): void {
  assert(Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected)),
    `${label}: actual=${actual}, expected=${expected}`);
}

const originalNow = Date.now;
let now = 1_800_000_000_000;
try {
  Date.now = () => now;
  const threshold = getMigrationThresholdUsd();
  for (const scenario of ['normal', 'exact', 'exhaustion', 'below-migration', 'above-migration'] as const) {
    const meta: TokenMeta = {
      id: `exhaustion-${scenario}`, name: 'Exhaustion QA', ticker: 'QA',
      logoColor: '#ffffff', supply: SUPPLY, createdAtSimMs: 0, fate: 'NORMAL',
      metrics: { topHoldersPct: 10, devHoldingsPct: 2, snipersPct: 1,
        lpBurnedPct: 100, insidersPct: 1, bundlersPct: 1 },
    };
    const sim = new TokenSim(meta, 5_000, 1_000_000);
    const y = 100_000_000;
    const available = 10_000_000;
    const terminalMcap = scenario === 'above-migration' ? threshold * 1.001
      : scenario === 'below-migration' ? threshold * 0.999 : 12_000;
    const x = terminalMcap / SUPPLY * (y - available) ** 2 / y;
    sim['curveVirtualBase'] = x;
    sim['curveVirtualToken'] = y;
    sim['curveRealToken'] = available;
    sim['curveInitialRealToken'] = available;
    sim['curveRealBase'] = 100;
    sim['curveKStart'] = x * y;
    sim['lastPriceUsd'] = x / y;
    sim['lastMcapUsd'] = x / y * SUPPLY;

    // Independent inverse constant-product equation, retaining the existing fee model.
    const exhaustionNet = x * available / (y - available);
    const grossBudget = scenario === 'normal' ? 15
      : scenario === 'exact' ? exhaustionNet / 0.99 : exhaustionNet / 0.99 * 3;
    const requestedSol = grossBudget / SOL_PRICE_USD;
    const expectedTokens = Math.min(available, y * (grossBudget * 0.99) / (x + grossBudget * 0.99));
    const expectedNet = x * expectedTokens / (y - expectedTokens);
    const expectedGross = expectedNet / 0.99;
    const quote = sim.quoteUserTrade('BUY', requestedSol, 0);
    assert(quote.ok, `${scenario}: quote available`);
    near(quote.expectedOut, expectedTokens, `${scenario}: quote output`);
    near(sim['estimateCurveBuyOut'](grossBudget).baseInUsedUsd, expectedGross, `${scenario}: quote input`);
    near(sim.getCurveDebugSnapshot().k, x * y, `${scenario}: quote is read only`);

    registry['tokens'].set(meta.id, sim);
    useTokenStore.getState().addToken(meta, sim.getRuntime());
    useWalletStore.setState({ solBalance: 1_000 });
    const submit = useTradingStore.getState().quickBuy(meta.id, requestedSol, { slippagePct: 0 });
    assert(submit.ok, `${scenario}: submitted`);
    const pending = Object.values(useTradingStore.getState().pendingQuickOrdersById)
      .find((order) => order.tokenId === meta.id);
    assert(pending !== undefined, `${scenario}: pending order`);
    near(useWalletStore.getState().solBalance, 1_000 - requestedSol - pending.txCostSol,
      `${scenario}: upfront reservation`);
    now = pending.execMs;
    const events = sim['processPendingUserTrades'](now);
    const notices = sim.drainUserTradeExecutions();
    const notice = notices[0];
    assert(notices.length === 1 && notice.status === 'FILLED', `${scenario}: one fill`);
    const fill = notice.fill;
    const after = sim.getCurveDebugSnapshot();
    near(fill.filledToken, quote.expectedOut, `${scenario}: quote/fill agreement`);
    near(fill.filledUsd, expectedGross, `${scenario}: charged gross`);
    near(fill.filledSol, expectedGross / SOL_PRICE_USD, `${scenario}: charged SOL`);
    near(fill.feeUsd, expectedGross - expectedNet, `${scenario}: fee`);
    near(after.vBase - x, expectedNet, `${scenario}: virtual base delta`);
    near(after.rBase - 100, expectedNet, `${scenario}: real base delta`);
    near(y - after.vTok, expectedTokens, `${scenario}: virtual token delta`);
    near(available - after.rTok, expectedTokens, `${scenario}: real token delta`);
    near(after.k, x * y, `${scenario}: constant product`);
    near(fill.priceAfterUsd, after.vBase / after.vTok, `${scenario}: reserve price`);
    near(fill.mcapAfterUsd, terminalMcap === 12_000 && scenario === 'normal'
      ? after.vBase / after.vTok * SUPPLY : terminalMcap, `${scenario}: market cap`);
    assert(fill.filledSol <= requestedSol + 1e-10, `${scenario}: no overcharge`);
    const shouldMigrate = scenario === 'above-migration';
    assert((sim.getPhase() === 'MIGRATED') === shouldMigrate, `${scenario}: migration phase`);
    assert(events.some((event) => event.type === 'MIGRATION') === shouldMigrate,
      `${scenario}: migration event`);
    if (scenario !== 'normal') near(after.rTok, 0, `${scenario}: reserves exhausted`);
    if (scenario === 'exhaustion') {
      const retry = sim.quoteUserTrade('BUY', requestedSol, 0);
      assert(!retry.ok, 'exhausted curve rejects another BUY before migration');
    }
    registry['executions'].process(meta.id, sim, notices);
    near(useWalletStore.getState().solBalance, 1_000 - fill.filledSol - pending.txCostSol,
      `${scenario}: wallet refund conserves SOL including transaction cost`);
    near(useTradingStore.getState().quickPositionsByTokenId[meta.id].costBasisUsd,
      expectedGross, `${scenario}: position uses charged cost`);
    near(useTradingStore.getState().quickPositionsByTokenId[meta.id].qty,
      expectedTokens, `${scenario}: position quantity`);
    assert(!useTradingStore.getState().pendingQuickOrdersById[pending.orderId],
      `${scenario}: reservation settled`);
    registry['tokens'].delete(meta.id);
    console.log(`PASS ${scenario}`);
    now += 1_000;
  }
  console.log(`BUY exhaustion QA: ${assertions} assertions passed`);
} finally {
  Date.now = originalNow;
}
