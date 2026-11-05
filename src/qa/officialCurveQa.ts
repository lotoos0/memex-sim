import { TokenSim } from '../tokens/tokenSim';
import { SOL_PRICE_USD, SUPPLY, type TokenMeta } from '../tokens/types';

// Independent fixtures intentionally use literal protocol values rather than production constants.
export function runOfficialCurveQa(): void {
  const meta: TokenMeta = {
    id: 'official-curve', name: 'Official Curve', ticker: 'QA', logoColor: '#ffffff',
    imageUrl: null, supply: SUPPLY, createdAtSimMs: 0, fate: 'NORMAL',
    metrics: { topHoldersPct: 10, devHoldingsPct: 2, snipersPct: 1,
      lpBurnedPct: 100, insidersPct: 1, bundlersPct: 1 },
  };
  const near = (actual: number, expected: number, label: string) => {
    if (!Number.isFinite(actual) || Math.abs(actual - expected) > 1e-8 * Math.max(1, Math.abs(expected))) {
      throw new Error(`${label}: ${actual} != ${expected}`);
    }
  };
  const sim = new TokenSim(meta, 2_000, 1_000_000);
  const start = sim.getCurveDebugSnapshot();
  near(start.vTok, 1_073_000_000, 'initial virtual tokens');
  near(start.rTok, 793_100_000, 'initial real tokens');
  near(start.vBase, 30 * SOL_PRICE_USD, 'initial virtual quote');
  near(start.rBase, 0, 'initial real quote');
  near(start.mcapCurveUsd, 30 * SOL_PRICE_USD / 1_073_000_000 * SUPPLY, 'start mcap');
  const bought = sim['executeCurveBuy'](SOL_PRICE_USD);
  near(bought.baseInUsd, SOL_PRICE_USD * 0.9875, 'buy fee');
  const sold = sim['executeCurveSell'](bought.tokensOut);
  near(sold.baseOutUsd, SOL_PRICE_USD * 0.9875 ** 2, 'round-trip fees');
  near(sim.getCurveDebugSnapshot().vBase, start.vBase, 'round-trip virtual quote');
  near(sim.getCurveDebugSnapshot().rTok, start.rTok, 'round-trip real tokens');

  const completion = new TokenSim(meta, 99_000, 1_000_000);
  const netToComplete = (30 * 1_073_000_000 / 279_900_000 - 30) * SOL_PRICE_USD;
  completion['executeCurveBuy'](netToComplete * 0.999 / 0.9875);
  if (completion.getCurveDebugSnapshot().rTok <= 0) throw new Error('premature completion');
  if (completion.getPhase() === 'MIGRATED') throw new Error('premature graduation');
  const fill = completion['executeUserTradeImmediate']('BUY', 1000, Date.now()).fill;
  if (!fill.ok || completion.getPhase() !== 'MIGRATED') throw new Error('exhaustion must graduate');
  const end = completion.getCurveDebugSnapshot();
  near(end.rTok, 0, 'completion exactly exhausts real tokens');
  near(end.rBase, netToComplete, 'completion real quote (~85 SOL)');
  near(end.vTok, 279_900_000, 'terminal virtual tokens');
  near(end.k, start.k, 'constant product');
  near(completion['executeCurveBuy'](SOL_PRICE_USD).tokensOut, 0, 'exhausted curve closed');
  console.log(`Official curve QA: PASS; start $${start.mcapCurveUsd.toFixed(2)}, completion ${(end.rBase / SOL_PRICE_USD).toFixed(6)} SOL, mcap $${end.mcapCurveUsd.toFixed(2)}`);
}
