import { CandleAggregator } from '../engine/aggregator';
import type { Candle } from '../engine/types';
import { TokenSim, type SimTapeTrade } from '../tokens/tokenSim';
import { SUPPLY, type TokenMeta } from '../tokens/types';

// Diagnostic only, not a CI gate. Oracle: sparse, chronological trade OHLC;
// equal timestamps retain execution order. Convention differences are reported too.
type Trade = { tMs: number; price: number; volume: number; side: 'BUY' | 'SELL' };
const timeframes = [1, 15, 30, 60];
const failures: string[] = [];
let checks = 0;
function check(label: string, actual: number, expected: number): void {
  checks++;
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > Math.max(1e-12, Math.abs(expected) * 1e-9)) {
    failures.push(`${label}: actual=${actual}, expected=${expected}`);
  }
}
function requireFixture(condition: boolean, label: string): asserts condition {
  if (!condition) throw new Error(`Invalid QA fixture: ${label}`);
}
function oracle(trades: Trade[], tf: number): Candle[] {
  const buckets = new Map<number, Trade[]>();
  for (const trade of trades.slice().sort((a, b) => a.tMs - b.tMs)) {
    const time = Math.floor(trade.tMs / (tf * 1000)) * tf;
    const bucket = buckets.get(time) ?? [];
    bucket.push(trade);
    buckets.set(time, bucket);
  }
  return Array.from(buckets, ([time, rows]) => ({
    time, open: rows[0]!.price, close: rows[rows.length - 1]!.price,
    high: Math.max(...rows.map((row) => row.price)),
    low: Math.min(...rows.map((row) => row.price)),
    volume: rows.reduce((sum, row) => sum + row.volume, 0),
  }));
}
function compare(label: string, actual: Candle[], expected: Candle[]): void {
  check(`${label}/length`, actual.length, expected.length);
  for (let i = 0; i < expected.length; i++) {
    const a = actual[i];
    if (!a) continue;
    for (const key of ['time', 'open', 'high', 'low', 'close', 'volume'] as const) {
      check(`${label}/bucket${i}/${key}`, a[key], expected[i]![key]);
    }
  }
}
function fromTape(trade: SimTapeTrade): Trade {
  return { tMs: trade.tMs, price: trade.priceUsd, volume: trade.notionalUsd, side: trade.side };
}

for (const tf of timeframes) {
  const base = 1_800_000_000_000; // Aligned to all supported timeframes.
  const span = tf * 1000;
  const trade = (offset: number, price: number, volume: number, side: Trade['side'] = 'BUY'): Trade =>
    ({ tMs: base + offset, price, volume, side });
  const scenarios: Record<string, Trade[]> = {
    single: [trade(100, 10, 2)],
    mixed: [trade(100, 10, 2), trade(200, 14, 3), trade(300, 8, 4, 'SELL'), trade(400, 11, 5)],
    boundary: [trade(span - 1, 12, 2), trade(span, 20, 3)],
    sparse: [trade(100, 12, 2), trade(4 * span + 100, 20, 3)],
    'late-same-bucket': [trade(300, 20, 2), trade(100, 10, 3, 'SELL')],
    'late-previous-bucket': [trade(100, 10, 2), trade(span + 100, 20, 3), trade(200, 8, 4, 'SELL')],
    'equal-time': [trade(100, 10, 2), trade(100, 12, 3, 'SELL')],
  };
  for (const [scenario, trades] of Object.entries(scenarios)) {
    const aggregator = new CandleAggregator(tf);
    for (const row of trades) aggregator.pushTick(row.tMs, row.price, row.volume);
    compare(`aggregator/${tf}s/${scenario}`, aggregator.getSeries(), oracle(trades, tf));
  }
}

const originalNow = Date.now;
let now = 1_800_000_000_000;
try {
  Date.now = () => now;
  const meta: TokenMeta = {
    id: 'trade-ohlc-fixed', name: 'Trade OHLC QA', ticker: 'OHLC', logoColor: '#ffffff',
    supply: SUPPLY, createdAtSimMs: 0, fate: 'NORMAL',
    metrics: { topHoldersPct: 10, devHoldingsPct: 2, snipersPct: 1,
      lpBurnedPct: 100, insidersPct: 1, bundlersPct: 1 },
  };
  const sim = new TokenSim(meta, 5_000, 1_000_000);
  const genesisPrice = sim.getLastPriceUsd();
  for (const tf of timeframes) {
    check(`genesis/${tf}s/volume`, sim.getCandles(tf)[0]!.volume, 0);
    check(`genesis/${tf}s/trade-only-count`, sim.getCandles(tf).length, 0);
  }
  // Test-only private access follows buyExhaustionQa; no production seam added.
  let userTokens = 0;
  for (const actor of ['user-BUY', 'bot-BUY', 'user-SELL', 'bot-SELL'] as const) {
    now += 100;
    const before = sim.getCurveDebugSnapshot();
    let average = 0;
    if (actor.startsWith('user')) {
      const result = sim['executeUserTradeImmediate'](actor === 'user-BUY' ? 'BUY' : 'SELL',
        actor === 'user-BUY' ? 0.1 : userTokens / 2, now);
      requireFixture(result.fill.ok, actor);
      average = result.fill.avgPriceUsd;
      if (actor === 'user-BUY') userTokens = result.fill.filledToken;
      const last = sim['tape'][sim['tape'].length - 1]!;
      check(`${actor}/tape-vs-fill-post-price`, last.priceUsd, result.fill.priceAfterUsd);
      check(`${actor}/tape-vs-fill-notional`, last.notionalUsd, result.fill.filledUsd);
    } else {
      requireFixture(actor === 'bot-BUY' ? sim['executeSimBuyTrade'](15, now)
        : sim['executeSimSellTrade'](1, now), actor);
    }
    const after = sim.getCurveDebugSnapshot();
    const tape = sim['tape'][sim['tape'].length - 1]!;
    const grossCurveQuote = Math.abs(after.vBase - before.vBase);
    const exchangeAverage = grossCurveQuote / tape.tokenAmount;
    check(`${actor}/tape-vs-reserve-price`, tape.priceUsd, after.vBase / after.vTok);
    // A declared common, fee-exclusive exchanged-quote volume, for every actor/side.
    check(`${actor}/uniform-exchanged-quote-volume`, tape.notionalUsd, grossCurveQuote);
    check(`${actor}/trade-average-price-convention`, tape.priceUsd, exchangeAverage);
    if (actor.startsWith('user')) {
      check(`${actor}/fill-average-identity`, average, tape.notionalUsd / tape.tokenAmount);
    }
  }
  const trades = sim['tape'].map(fromTape);
  for (const tf of timeframes) {
    compare(`execution/${tf}s/price-projection`, sim.getCandles(tf), oracle(trades, tf));
    const mcapTrades = sim['tape'].map((row) => ({ ...fromTape(row), price: row.mcapUsd }));
    compare(`execution/${tf}s/mcap-projection`, sim.getCandles(tf, 'mcap'), oracle(mcapTrades, tf));
    const seeded = [{ tMs: sim.getSpawnRealMs(), price: genesisPrice, volume: 0, side: 'BUY' as const }, ...trades];
    compare(`execution/${tf}s/including-genesis`, sim.getCandles(tf), oracle(seeded, tf));
  }

  // Real tick path: process due user orders at now, then timestamp market flow
  // within the preceding window. This can straddle a 1s bucket boundary.
  now = 1_800_000_000_900;
  const tickSim = new TokenSim({ ...meta, id: 'trade-ohlc-tick' }, 5_000, 1_000_000);
  const submit = tickSim.submitUserTrade({ side: 'BUY', amountIn: 0.1, slippageBps: 10_000, latencyMs: 100 });
  requireFixture(submit.ok, 'tick submission');
  now = Math.max(1_800_000_001_000, submit.execMs);
  tickSim.tick(0.1, 'OFF');
  const notices = tickSim.drainUserTradeExecutions();
  requireFixture(notices.length === 1 && notices[0]!.status === 'FILLED', 'tick user execution');
  const tickTape = tickSim['tape'];
  requireFixture(tickTape.length > 1, 'tick includes background trades');
  const inversions = tickTape.slice(1).filter((row, i) => row.tMs < tickTape[i]!.tMs).length;
  check('tick/chronological-insertion', inversions, 0);
  const seed = { tMs: tickSim.getSpawnRealMs(), price: 5_000 / SUPPLY, volume: 0, side: 'BUY' as const };
  for (const tf of timeframes) {
    compare(`tick/${tf}s/chronological-projection`, tickSim.getCandles(tf),
      oracle([seed, ...tickTape.map(fromTape)], tf));
  }
} finally {
  Date.now = originalNow;
}
for (const failure of failures) console.error(`FAIL ${failure}`);
console.log(`Trade OHLC QA: ${checks - failures.length}/${checks} checks passed; ${failures.length} discrepancies`);
if (failures.length) throw new Error(`Trade OHLC audit found ${failures.length} discrepancies`);
