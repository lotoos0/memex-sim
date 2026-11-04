import { TokenSim } from '../tokens/tokenSim';
import { CandleAggregator } from '../engine/aggregator';
import { SOL_PRICE_USD, SUPPLY, type TokenMeta } from '../tokens/types';

// Independent integer oracle for the reference SDK's legacy SOL buy quote.
// Reference: nirholas/pump-fun-sdk/src/bondingCurve.ts, retrieved 2026-11-03.
// Fixed protocol fee of 100 bps, no creator fee; not a live fee schedule.
const LAMPORTS = 1_000_000_000;
const TOKEN_UNITS = 1_000_000;
function referenceBuy(base: bigint, tokens: bigint, real: bigint, budget: bigint): bigint {
  if (budget === 0n) return 0n;
  const net = (budget - 1n) * 10_000n / 10_100n;
  const out = net * tokens / (base + net);
  return out < real ? out : real;
}

export function runCurveParityQa(): void {
  const failures: string[] = [];
  let checks = 0;
  function check(label: string, actual: number, expected: number, tolerance = 0): void {
    checks++;
    if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
      failures.push(`${label}: actual=${actual}, expected=${expected}, tolerance=${tolerance}`);
    }
  }
  const originalNow = Date.now;
  try {
    Date.now = () => 1_800_000_000_000;
    const meta: TokenMeta = {
      id: 'curve-parity-fixed', name: 'Curve Parity', ticker: 'PARITY',
      logoColor: '#ffffff', imageUrl: null, supply: SUPPLY, createdAtSimMs: 0, fate: 'NORMAL',
      metrics: { topHoldersPct: 10, devHoldingsPct: 2, snipersPct: 1,
        lpBurnedPct: 100, insidersPct: 1, bundlersPct: 1 },
    };
    const sim = new TokenSim(meta, 5_000, 1_000_000);
    const state = sim.getCurveDebugSnapshot();
    const base = BigInt(Math.floor(state.vBase / SOL_PRICE_USD * LAMPORTS));
    const tokens = BigInt(Math.floor(state.vTok * TOKEN_UNITS));
    const real = BigInt(Math.floor(state.rTok * TOKEN_UNITS));
    check('oracle zero', Number(referenceBuy(base, tokens, real, 0n)), 0);
    check('oracle one lamport', Number(referenceBuy(base, tokens, real, 1n)), 0);
    for (const budget of [1n, 1_000n, 100_000_000n, 1_000_000_000n]) {
      const quote = sim.quoteUserTrade('BUY', Number(budget) / LAMPORTS, 0);
      const expected = Number(referenceBuy(base, tokens, real, budget)) / TOKEN_UNITS;
      // Quantizing the observed floating reserves adds < 1 lamport and token unit.
      // This allowance does not hide the fee formula discrepancy.
      const tolerance = 2 * state.vTok / Number(base) + 2 / TOKEN_UNITS;
      check(`BUY ${budget} lamports`, quote.ok ? quote.expectedOut : 0, expected, tolerance);
    }
    const exhausted = sim.quoteUserTrade('BUY', 1_000_000, 0);
    check('BUY real-token cap', exhausted.ok ? exhausted.expectedOut : 0,
      Number(referenceBuy(base, tokens, real, 1_000_000n * BigInt(LAMPORTS))) / TOKEN_UNITS,
      2 / TOKEN_UNITS);
    check('unclamped market cap', state.mcapCurveUsd, state.vBase / state.vTok * SUPPLY, 1e-9);
    check('quotes preserve reserves', sim.getCurveDebugSnapshot().k, state.k);

    const aggr = new CandleAggregator(1);
    aggr.pushTick(1_000, 10, 2);
    aggr.pushTick(1_100, 12, 3);
    const first = aggr.getSeries()[0]!;
    check('same bucket open', first.open, 10);
    check('same bucket high', first.high, 12);
    check('same bucket low', first.low, 10);
    check('same bucket close', first.close, 12);
    check('same bucket volume', first.volume, 5);
    aggr.pushTick(3_000, 20, 4);
    const next = aggr.getSeries()[1]!;
    check('sparse buckets', aggr.getSeries().length, 2);
    // Trade OHLC uses the first executed price in the new bucket.
    check('trade OHLC new bucket open', next.open, 20);
    check('trade OHLC new bucket low', next.low, 20);
    check('new bucket volume', next.volume, 4);
  } finally {
    Date.now = originalNow;
  }
  for (const failure of failures) console.error(`FAIL ${failure}`);
  console.log(`Curve parity: ${checks - failures.length}/${checks} checks passed`);
  if (failures.length) throw new Error(`Curve parity audit found ${failures.length} discrepancies`);
}

runCurveParityQa();
