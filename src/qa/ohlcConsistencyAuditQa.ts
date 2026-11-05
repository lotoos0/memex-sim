import { CandleAggregator } from '../engine/aggregator';
import { TokenSim } from '../tokens/tokenSim';
import { SUPPLY, type TokenMeta } from '../tokens/types';
import { projectOhlc } from './ohlcOracle';

// Reconstruct all eight projections, with no tolerated discrepancy count.
let comparisons = 0;
function equal(actual: unknown, expected: unknown, label: string): void {
  comparisons++;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(label);
}
const timeframes = [1, 15, 30, 60];
equal(projectOhlc([
  { tMs: 0, price: 10, volume: 0 }, { tMs: 100, price: 12, volume: 2 },
  { tMs: 50, price: 1, volume: 99 }, { tMs: 100, price: 11, volume: 3 },
  { tMs: 3100, price: 20, volume: 4 },
], 1), [
  { time: 0, open: 10, close: 11, high: 12, low: 10, volume: 5 },
  { time: 3, open: 11, close: 20, high: 20, low: 11, volume: 4 },
], 'oracle hand-calculated genesis, rejection, equal times, continuity, sparse volume');
for (const tf of timeframes) for (const scale of [1, SUPPLY]) {
  const rows = Array.from({ length: 3005 }, (_, i) => ({
    tMs: 1_800_000_000_000 + i * tf * 1000, price: (10 + i % 7) * scale,
    volume: i === 0 ? 0 : 2,
  }));
  rows.splice(3, 0, { ...rows[0]!, volume: 99 });
  rows.splice(5, 0, { ...rows[4]!, price: 3 * scale, volume: 4 });
  const aggregator = new CandleAggregator(tf);
  let rejected = 0;
  for (const row of rows) if (aggregator.pushTick(row.tMs, row.price, row.volume).mode === 'rejected') rejected++;
  equal(rejected, 1, `late admission ${tf}/${scale}`);
  const fields = ['time', 'open', 'high', 'low', 'close', 'volume'] as const;
  equal(aggregator.getSeries().map(c => fields.map(field => c[field])),
    projectOhlc(rows, tf).map(c => fields.map(field => c[field])), `retention/projection ${tf}/${scale}`);
}

const originalNow = Date.now;
let now = 1_800_000_000_000;
try {
  Date.now = () => now;
  for (let index = 0; index < 12; index++) {
    const meta: TokenMeta = {
      id: `ohlc-consistency-${index}`, name: 'OHLC consistency', ticker: 'QA',
      logoColor: '#ffffff', imageUrl: null, supply: SUPPLY, createdAtSimMs: 0, fate: 'NORMAL',
      metrics: { topHoldersPct: 10, devHoldingsPct: 2, snipersPct: 1,
        lpBurnedPct: 100, insidersPct: 1, bundlersPct: 1 },
    };
    const sim = new TokenSim(meta, 5000, 1_000_000);
    const birth = sim.getSpawnRealMs();
    const genesis = sim.getLastPriceUsd();
    for (let tick = 0; tick < 1500; tick++) {
      now += 200;
      sim.tick(0.2, 'OFF');
    }
    for (const tf of timeframes) for (const metric of ['price', 'mcap'] as const) {
      const scale = metric === 'price' ? 1 : SUPPLY;
      const rows = [{ tMs: birth, price: genesis * scale, volume: 0 },
        ...sim['tape'].map(row => ({ tMs: row.tMs,
          price: metric === 'price' ? row.priceUsd : row.mcapUsd, volume: row.notionalUsd }))];
      const actual = sim.getCandles(tf, metric);
      const expected = projectOhlc(rows, tf);
      if (actual.length !== expected.length) throw new Error(`bucket count ${index}/${tf}/${metric}`);
      for (let i = 0; i < expected.length; i++) {
        for (const key of ['time', 'open', 'high', 'low', 'close', 'volume'] as const) {
          comparisons++;
          if (Math.abs(actual[i]![key] - expected[i]![key]) > Math.max(1e-12, Math.abs(expected[i]![key]) * 1e-9)) {
            throw new Error(`projection ${index}/${tf}/${metric}/${i}/${key}`);
          }
        }
      }
    }
  }
} finally {
  Date.now = originalNow;
}
console.log(`OHLC consistency QA: PASS (${comparisons} comparisons)`);
