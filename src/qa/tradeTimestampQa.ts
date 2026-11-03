import type { Candle } from '../engine/types';
import { TokenSim, type SimTapeTrade } from '../tokens/tokenSim';
import { SUPPLY, type TokenMeta } from '../tokens/types';

// Standalone regression. Private fixture access avoids new production contracts.
const base = 1_800_000_000_000;
const failures: string[] = [];
const economics: unknown[] = [];
let checks = 0;
let now = base;
function check(condition: boolean, label: string): void {
  checks++;
  if (!condition) failures.push(label);
}
function near(actual: number, expected: number, label: string): void {
  check(Number.isFinite(actual) && Math.abs(actual - expected) <= Math.max(1e-12, Math.abs(expected) * 1e-9),
    `${label}: actual=${actual}, expected=${expected}`);
}
function fixture(condition: boolean, label: string): asserts condition {
  if (!condition) throw new Error(`Invalid fixture: ${label}`);
}
function create(id: string): TokenSim {
  const meta: TokenMeta = {
    id, name: 'Timestamp QA', ticker: 'TIME', logoColor: '#ffffff',
    supply: SUPPLY, createdAtSimMs: 0, fate: 'NORMAL',
    metrics: { topHoldersPct: 10, devHoldingsPct: 2, snipersPct: 1,
      lpBurnedPct: 100, insidersPct: 1, bundlersPct: 1 },
  };
  return new TokenSim(meta, 5_000, 1_000_000);
}

// Independent sparse OHLC oracle with the current genesis/continuity convention.
function project(sim: TokenSim, tf: number, metric: 'price' | 'mcap'): Candle[] {
  const groups = new Map<number, Array<{ price: number; volume: number }>>();
  const points = [{ tMs: sim.getSpawnRealMs(), price: metric === 'price' ? 5_000 / SUPPLY : 5_000, volume: 0 },
    ...sim['tape'].map((row) => ({ tMs: row.tMs,
      price: metric === 'price' ? row.priceUsd : row.mcapUsd, volume: row.notionalUsd }))];
  for (const point of points.sort((a, b) => a.tMs - b.tMs)) {
    const time = Math.floor(point.tMs / (tf * 1000)) * tf;
    const rows = groups.get(time) ?? [];
    rows.push(point);
    groups.set(time, rows);
  }
  const result: Candle[] = [];
  for (const [time, rows] of groups) {
    const open = result.length ? result[result.length - 1]!.close : rows[0]!.price;
    result.push({ time, open, close: rows[rows.length - 1]!.price,
      high: Math.max(open, ...rows.map((row) => row.price)),
      low: Math.min(open, ...rows.map((row) => row.price)),
      volume: rows.reduce((sum, row) => sum + row.volume, 0) });
  }
  return result;
}
function verify(label: string, sim: TokenSim): void {
  const tape = sim['tape'];
  for (let i = 1; i < tape.length; i++) check(tape[i]!.tMs >= tape[i - 1]!.tMs, `${label}/monotonic/${i}`);
  check(tape.every((row) => row.tMs >= sim.getSpawnRealMs()), `${label}/not-before-genesis`);
  for (const tf of [1, 15, 30, 60]) for (const metric of ['price', 'mcap'] as const) {
    const actual = sim.getCandles(tf, metric);
    const expected = project(sim, tf, metric);
    near(actual.length, expected.length, `${label}/${tf}/${metric}/bucket-count`);
    for (let i = 0; i < expected.length; i++) {
      if (!actual[i]) continue;
      for (const key of ['time', 'open', 'high', 'low', 'close', 'volume'] as const) {
        near(actual[i]![key], expected[i]![key], `${label}/${tf}/${metric}/${i}/${key}`);
      }
    }
    near(actual.reduce((sum, row) => sum + row.volume, 0), tape.reduce((sum, row) => sum + row.notionalUsd, 0),
      `${label}/${tf}/${metric}/volume-once`);
  }
  // Compare these timestamp-free traces before/after the patch, without golden
  // constants derived from today's simulator outputs.
  economics.push({ label, curve: sim.getCurveDebugSnapshot(), ledger: [...sim['ledger']],
    trades: tape.map(({ side, walletId, tokenAmount, notionalUsd, priceUsd, mcapUsd }) =>
      ({ side, walletId, tokenAmount, notionalUsd, priceUsd, mcapUsd })) });
}
function marketFlow(sim: TokenSim): SimTapeTrade[] {
  const start = sim['tape'].length;
  sim['executeMarketFlowAsTape']({ candleTsMs: now, realDtSec: 0.2,
    targetBuyUsd: 200, targetSellUsd: 100, previousPriceUsd: sim.getLastPriceUsd(),
    expectedNextPriceUsd: sim.getLastPriceUsd(), buyMix: [], sellMix: [] });
  const rows = sim['tape'].slice(start);
  fixture(rows.length > 2 && rows.some((row) => row.side === 'BUY') && rows.some((row) => row.side === 'SELL'),
    'multiple background BUY and SELL');
  return rows;
}

const originalNow = Date.now;
try {
  Date.now = () => now;
  // Same public tick fixture as tradeOhlcQa, crossing an exact 1s boundary.
  now = base + 900;
  const tickSim = create('trade-ohlc-tick');
  const submit = tickSim.submitUserTrade({ side: 'BUY', amountIn: 0.1, slippageBps: 10_000, latencyMs: 100 });
  fixture(submit.ok, 'tick submission');
  now = Math.max(base + 1000, submit.execMs);
  tickSim.tick(0.1, 'OFF');
  const notices = tickSim.drainUserTradeExecutions();
  fixture(notices.length === 1 && notices[0]!.status === 'FILLED', 'one public tick user fill');
  fixture(tickSim['tape'].length > 1 && tickSim['tape'][0]!.walletId === 'you', 'user executes before flow');
  check(tickSim['tape'].every((row) => row.tMs >= notices[0]!.execMs), 'tick/background-not-backdated');
  economics.push({ label: 'tick-fills', notices });
  verify('public-tick', tickSim);
  now += 200;
  tickSim.tick(0.2, 'OFF');
  verify('next-tick-without-user', tickSim);

  for (const withUser of [false, true]) {
    now = base;
    const sim = create('timestamp-mixed');
    // Supply bot inventory before the target window; do not mock swap functions.
    fixture(sim['executeSimBuyTrade'](300, now + 10), 'seed bot inventory');
    let executionTs = 0;
    if (withUser) {
      now = base + 900;
      const orders = [0, 0.002, 0.002].map((prioritySol, i) =>
        sim.submitUserTrade({ side: 'BUY', amountIn: 0.1 + i * 0.01,
          slippageBps: 10_000, prioritySol, latencyMs: 100 }));
      fixture(orders.every((order) => order.ok), 'priority submissions');
      now = base + 1000;
      sim['processPendingUserTrades'](now);
      const executions = sim.drainUserTradeExecutions();
      fixture(executions.length === 3 && executions.every((row) => row.status === 'FILLED'), 'priority fills');
      const expectedIds = [orders[1], orders[2], orders[0]].map((order) => order.ok ? order.orderId : '');
      check(executions.every((row, i) => row.orderId === expectedIds[i]), 'priority/stable-execution-order');
      check(executions.every((row) => row.execMs === now), 'priority/equal-timestamps');
      executionTs = now;
      economics.push({ label: 'priority-fills', executions });
    } else now = base + 1000;
    const rows = marketFlow(sim);
    if (withUser) check(rows.every((row) => row.tMs === executionTs), 'mixed/clamped-equal-timestamps');
    else {
      check(new Set(rows.map((row) => row.tMs)).size > 2, 'no-user/natural-spread');
      check(rows[0]!.tMs > base + 800 && rows[0]!.tMs < now, 'no-user/natural-window');
      // Timestamp equality of this array is also checked by the differential run.
      economics.push({ label: 'no-user-natural-times', times: rows.map((row) => row.tMs) });
    }
    verify(withUser ? 'mixed-after-priority-user' : 'mixed-without-user', sim);
  }
} finally {
  Date.now = originalNow;
}
console.log(`ECONOMICS ${JSON.stringify(economics)}`);
for (const failure of failures) console.error(`FAIL ${failure}`);
console.log(`Trade timestamp QA: ${checks - failures.length}/${checks} checks passed`);
if (failures.length) throw new Error(`Trade timestamp regression: ${failures.length} failures`);
