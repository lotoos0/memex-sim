import { TokenSim } from '../tokens/tokenSim';
import { SUPPLY, type TokenMeta } from '../tokens/types';

let checks = 0;
function check(ok: boolean, label: string): void { checks++; if (!ok) throw new Error(label); }
function near(a: number, b: number, label: string): void {
  check(Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(b)), label);
}
const originalNow = Date.now;
let now = Date.parse('2026-10-15T08:00:00Z');
Date.now = () => now;
try {
  const meta: TokenMeta = { id: 'p1-financial', name: 'Financial QA', ticker: 'QA', logoColor: '#fff',
    imageUrl: null, supply: SUPPLY, createdAtSimMs: 0, fate: 'NORMAL',
    metrics: { topHoldersPct: 10, devHoldingsPct: 2, snipersPct: 1, lpBurnedPct: 100, insidersPct: 1, bundlersPct: 1 } };
  const sim = new TokenSim(meta, 2000, 1000000);
  const buy = sim['executeCurveBuy'].bind(sim);
  const sell = sim['executeCurveSell'].bind(sim);
  sim['executeCurveBuy'] = gross => {
    const before = sim.getCurveDebugSnapshot();
    const estimate = sim['estimateCurveBuyOut'](gross);
    const result = buy(gross);
    const after = sim.getCurveDebugSnapshot();
    if (result.tokensOut > 0) {
      near(after.k, before.k, 'BUY constant product');
      near(after.rTok, before.rTok - result.tokensOut, 'BUY real tokens');
      near(after.vBase - before.vBase, result.baseInUsd, 'BUY reserve quote');
      near(result.baseInUsd, estimate.baseInUsedUsd * .9875, 'BUY official 125bps fee');
      near(result.tokensOut, estimate.tokensOut, 'observed BUY quote/fill');
    }
    check(!after.invalidState && after.rTok >= 0 && after.rBase >= 0, 'BUY valid reserves');
    return result;
  };
  sim['executeCurveSell'] = tokens => {
    const before = sim.getCurveDebugSnapshot();
    const result = sell(tokens);
    const after = sim.getCurveDebugSnapshot();
    if (result.tokenIn > 0) {
      near(after.k, before.k, 'SELL constant product');
      near(after.rTok, before.rTok + result.tokenIn, 'SELL real tokens');
      const gross = before.vBase * result.tokenIn / (before.vTok + result.tokenIn);
      near(before.vBase - after.vBase, gross, 'SELL reserve quote');
      near(result.baseOutUsd, gross * .9875, 'SELL official 125bps fee');
    }
    check(!after.invalidState && after.rTok >= 0 && after.rBase >= 0, 'SELL valid reserves');
    return result;
  };
  for (let i = 0; i < 9000; i++) { now += 200; sim.tick(.2); }
  const quoted = new TokenSim({ ...meta, id: 'p1-quote' }, 2000, 1000000);
  for (const gross of [0.001, 1, 150, 1000]) {
    const estimate = quoted['estimateCurveBuyOut'](gross);
    const fill = quoted['executeCurveBuy'](gross);
    near(estimate.tokensOut, fill.tokensOut, 'BUY quote/fill tokens');
    near(estimate.baseInUsedUsd, fill.baseInUsd / .9875, 'BUY quote/fill gross');
  }
  // Completing bot fill must hand off before the next fill, without reopening reserves.
  const completion = quoted['executeSimBuyTrade'](1e8, now);
  check(completion && quoted.getPhase() === 'MIGRATED', 'completion handoff');
  check(quoted.getCurveDebugSnapshot().rTok === 0, 'completion empty reserve');
  check(quoted['botMigrationEvents'].length === 1, 'one completion event');
  check(quoted['executeSimBuyTrade'](1, now), 'subsequent migrated venue fill');
  check(quoted['botMigrationEvents'].length === 1 && quoted.getCurveDebugSnapshot().rTok === 0, 'no duplicate handoff');
} finally { Date.now = originalNow; }
console.log(`P1 financial QA: ${checks} assertions PASS`);
