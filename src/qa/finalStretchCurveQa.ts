import { TokenSim } from '../tokens/tokenSim';
import { SOL_PRICE_USD, SUPPLY, type TokenMeta } from '../tokens/types';

// Valid official-curve states only; no legacy reserve/fee fixture overrides.
let checks = 0;
function near(actual: number, expected: number, label: string): void {
  checks++;
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > Math.max(1e-10, Math.abs(expected) * 1e-9)) {
    throw new Error(`${label}: ${actual} vs ${expected}`);
  }
}
const meta: TokenMeta = { id: 'final-stretch-curve', name: 'Curve regression', ticker: 'QA',
  logoColor: '#fff', imageUrl: null, supply: SUPPLY, createdAtSimMs: 0, fate: 'NORMAL',
  metrics: { topHoldersPct: 10, devHoldingsPct: 2, snipersPct: 1, lpBurnedPct: 100, insidersPct: 1, bundlersPct: 1 } };
const sim = new TokenSim(meta, 2000, 1_000_000);
let now = sim.getSpawnRealMs();
const initial = sim.getCurveDebugSnapshot();
for (let i = 0; i < 20; i++) {
  const grossUsd = (0.05 + i * 0.01) * SOL_PRICE_USD;
  const before = sim.getCurveDebugSnapshot();
  const expectedNet = grossUsd * 0.9875;
  const expectedOut = before.vTok * expectedNet / (before.vBase + expectedNet);
  const quote = sim['estimateCurveBuyOut'](grossUsd);
  near(quote.tokensOut, expectedOut, 'BUY quote');
  const buy = sim['executeUserTradeImmediate']('BUY', grossUsd / SOL_PRICE_USD, ++now).fill;
  if (!buy.ok) throw new Error('Valid BUY rejected');
  near(buy.filledToken, expectedOut, 'BUY fill');
  near(buy.feeUsd, grossUsd * 0.0125, 'BUY fee');
  near(sim.getCurveDebugSnapshot().k, initial.k, 'BUY K');
  const sellQuote = sim['estimateCurveSellOut'](buy.filledToken);
  const sell = sim['executeUserTradeImmediate']('SELL', buy.filledToken, ++now).fill;
  if (!sell.ok) throw new Error('Valid SELL rejected');
  near(sell.filledUsd, sellQuote.baseOutUsd, 'SELL quote/fill');
  near(sell.filledUsd, grossUsd * 0.9875 ** 2, 'round-trip payout');
  near(sim.getCurveDebugSnapshot().k, initial.k, 'SELL K');
  near(sim.getCurveDebugSnapshot().vBase, initial.vBase, 'round-trip reserve');
}
const remainingNet = (30 * 1_073_000_000 / 279_900_000 - 30) * SOL_PRICE_USD;
const complete = sim['executeUserTradeImmediate']('BUY', remainingNet / 0.9875 / SOL_PRICE_USD * 2, ++now);
if (!complete.fill.ok || sim.getPhase() !== 'MIGRATED') throw new Error('Completing BUY did not migrate');
near(complete.fill.filledUsd, remainingNet / 0.9875, 'capped completion charge');
near(sim.getCurveDebugSnapshot().rTok, 0, 'real tokens exhausted');
near(sim.getCurveDebugSnapshot().k, initial.k, 'completion K');
near(complete.events.filter(event => event.type === 'MIGRATION').length, 1, 'one migration event');
const next = sim['executeUserTradeImmediate']('BUY', 0.1, ++now);
if (!next.fill.ok || next.events.some(event => event.type === 'MIGRATION')) throw new Error('Repeated handoff');
console.log(`Final Stretch curve QA: PASS (${checks} independent quote/fill, fee, K and completion checks)`);
