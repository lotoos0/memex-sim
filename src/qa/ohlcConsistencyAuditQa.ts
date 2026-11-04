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
    id: 'trade-ohlc-fixed', name: 'Trade OHLC QA', ticker: 'OHLC', logoColor: '#ffffff', imageUrl: null,
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
  for (const fixture of [sim, tickSim]) {
    for (const tf of timeframes) for (const metric of ['price', 'mcap'] as const) {
      const rows = [{ tMs: fixture.getSpawnRealMs(), price: 5000 / (metric === 'price' ? SUPPLY : 1), volume: 0, side: 'BUY' as const },
        ...fixture['tape'].map(row => ({ ...fromTape(row), price: metric === 'price' ? row.priceUsd : row.mcapUsd }))];
      const actual = fixture.getCandles(tf, metric);
      const expected = continuityOracle(rows, tf);
      if (!sameCandles(actual, expected)) throw new Error(`Projection mismatch ${tf}/${metric}`);
    }
  }
} finally {
  Date.now = originalNow;
}
const groups: Record<string, number> = {};
for (const failure of failures) {
  const group = failure.startsWith('genesis/') || /\/(price|mcap)-projection\//.test(failure)
    ? 'GENESIS:CONVENTION' : failure.includes('trade-average-price-convention')
      ? 'POST_PRICE:CONVENTION' : /tape-vs-fill-notional|fill-average-identity/.test(failure)
        ? 'WALLET_BASIS:STALE_QA' : failure.includes('late-') && !failure.includes('/bucket1/')
          ? 'LATE_REJECTION:STALE_QA' : /\/(open|low):/.test(failure)
            ? 'CONTINUITY:CONVENTION' : 'UNKNOWN';
  groups[group] = (groups[group] ?? 0) + 1;
  console.log(`BASELINE ${group} ${failure}`);
}
console.log('CLASSIFICATION', groups);
if (checks !== 413 || failures.length !== 78 || groups.UNKNOWN) throw new Error('Baseline drift');
console.log(`Trade OHLC QA: ${checks - failures.length}/${checks} checks passed; ${failures.length} discrepancies`);



// Independent batch reconstruction; admission precedes grouping, equal times retain order.
function continuityOracle(rows: Trade[], tf: number): Candle[] {
  let watermark = -Infinity;
  const accepted = rows.filter(row => {
    if (row.tMs < watermark) return false;
    watermark = row.tMs;
    return true;
  });
  const candles = oracle(accepted, tf);
  for (let i = 1; i < candles.length; i++) {
    const candle = candles[i]!;
    candle.open = candles[i - 1]!.close;
    candle.high = Math.max(candle.high, candle.open);
    candle.low = Math.min(candle.low, candle.open);
  }
  return candles.slice(-3000);
}
for (const tf of timeframes) for (const scale of [1, SUPPLY]) {
  const rows: Trade[] = Array.from({ length: 3005 }, (_, i) => ({
    tMs: 1_800_000_000_000 + i * tf * 1000, price: (10 + i % 7) * scale,
    volume: i === 0 ? 0 : 2, side: 'BUY',
  }));
  rows.splice(3, 0, { ...rows[0]!, volume: 99 });
  rows.splice(5, 0, { ...rows[4]!, price: 3 * scale, volume: 4 });
  const aggregator = new CandleAggregator(tf);
  let rejected = 0;
  for (const row of rows) if (aggregator.pushTick(row.tMs, row.price, row.volume).mode === 'rejected') rejected++;
  if (rejected !== 1 || !sameCandles(aggregator.getSeries(), continuityOracle(rows, tf))) {
    throw new Error(`Retention/admission mismatch ${tf}/${scale}`);
  }
}
console.log('Independent projections, retention and admission: PASS');
function sameCandles(a: Candle[], b: Candle[]): boolean {
  return a.length === b.length && a.every((c, i) => (['time', 'open', 'high', 'low', 'close', 'volume'] as const).every(k => Math.abs(c[k] - b[i]![k]) <= Math.max(1e-12, Math.abs(b[i]![k]) * 1e-9)));
}
for (const [group, expected] of Object.entries({
  'CONTINUITY:CONVENTION': 26, 'LATE_REJECTION:STALE_QA': 24,
  'GENESIS:CONVENTION': 20, 'WALLET_BASIS:STALE_QA': 4, 'POST_PRICE:CONVENTION': 4,
})) {
  if (groups[group] !== expected) throw new Error(`Classification drift: ${group}`);
}
