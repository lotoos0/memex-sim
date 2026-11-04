import { CandleAggregator } from '../engine/aggregator';
import { RNG } from '../engine/rng';
import { TokenSim } from '../tokens/tokenSim';
import { generateToken, getFateTimeoutSimMs } from '../tokens/generator';
import { SUPPLY, type TokenMeta } from '../tokens/types';

// Headless checks for the two clock-alignment regressions:
// bootstrap must keep candle history that no longer fits in the tape, and a
// stalled tick must not pin later trades to a wall timestamp ahead of the sim clock.
const failures: string[] = [];
let checks = 0;

function check(condition: boolean, label: string): void {
  checks += 1;
  if (!condition) failures.push(label);
}

function create(id: string): TokenSim {
  const meta: TokenMeta = {
    id, name: 'Clock QA', ticker: 'CLOCK', logoColor: '#ffffff', imageUrl: null,
    supply: SUPPLY, createdAtSimMs: 0, fate: 'NORMAL',
    metrics: { topHoldersPct: 10, devHoldingsPct: 2, snipersPct: 1,
      lpBurnedPct: 100, insidersPct: 1, bundlersPct: 1 },
  };
  return new TokenSim(meta, 5_000, 60 * 60_000);
}

function sumVolume(sim: TokenSim, metric: 'price' | 'mcap'): number {
  return sim.getCandles(1, metric).reduce((sum, candle) => sum + candle.volume, 0);
}

function runAggregatorShift(): void {
  const aggregator = new CandleAggregator(1);
  aggregator.pushTick(1_000, 10, 2);
  aggregator.pushTick(2_200, 12, 3);
  aggregator.pushTick(4_000, 9, 4);
  const before = aggregator.getSeries().map((candle) => ({ ...candle }));
  const volumeBefore = before.reduce((sum, candle) => sum + candle.volume, 0);
  aggregator.shift(5_000);
  const after = aggregator.getSeries();
  check(after.length === before.length, 'shift/keeps-candle-count');
  check(after.reduce((sum, candle) => sum + candle.volume, 0) === volumeBefore, 'shift/keeps-volume');
  check(after[0]!.time === before[0]!.time + 5, 'shift/moves-first-bucket');
  check(after[after.length - 1]!.time === before[before.length - 1]!.time + 5, 'shift/moves-last-bucket');
  check(aggregator.pushTick(4_000, 1, 1).mode === 'rejected', 'shift/old-time-is-late');
  check(aggregator.pushTick(9_200, 11, 6).mode !== 'rejected', 'shift/new-time-accepted');
  check(aggregator.getSeries().reduce((sum, candle) => sum + candle.volume, 0) === volumeBefore + 6,
    'shift/accepted-volume-added');
}

function runStallStamp(): void {
  const base = 1_800_000_000_000;
  let now = base;
  const previous = Date.now;
  Date.now = () => now;
  try {
    const sim = create('stall-stamp');
    for (let i = 0; i < 5; i++) {
      now += 200;
      sim.tick(0.2, 'OFF');
    }
    const ageBefore = sim.getSimTimeMs() - sim.meta.createdAtSimMs;
    now += 60_000;
    const submit = sim.submitUserTrade({
      side: 'BUY', amountIn: 0.1, slippageBps: 10_000, latencyMs: 20,
    });
    check(submit.ok, 'stall/submit');
    now += 50;
    sim.tick(0.2, 'OFF');
    const notices = sim.drainUserTradeExecutions();
    check(notices.length === 1 && notices[0]!.status === 'FILLED', 'stall/filled');
    const fillTs = notices[0]?.execMs ?? 0;
    const marketNow = sim.getSpawnRealMs() + (sim.getSimTimeMs() - sim.meta.createdAtSimMs);
    const ageAfter = sim.getSimTimeMs() - sim.meta.createdAtSimMs;
    check(ageAfter - ageBefore <= 1_500, 'stall/age-clamped');
    check(Math.abs(fillTs - marketNow) <= 1_500, `stall/fill-on-sim-clock fill=${fillTs} market=${marketNow}`);
    check(now - fillTs > 30_000, 'stall/fill-not-on-wall-clock');

    const tape = sim['tape'];
    const fillIndex = tape.findIndex((trade) => trade.walletId === 'you');
    check(fillIndex >= 0, 'stall/fill-on-tape');
    for (let i = 0; i < 20; i++) {
      now += 200;
      sim.tick(0.2, 'OFF');
    }
    const later = tape.slice(fillIndex + 1).map((trade) => trade.tMs);
    const unique = new Set(later);
    const lastTs = later[later.length - 1] ?? fillTs;
    const marketEnd = sim.getSpawnRealMs() + (sim.getSimTimeMs() - sim.meta.createdAtSimMs);
    check(later.length > 0, 'stall/later-trades');
    check(unique.size > 3, `stall/timestamps-keep-moving unique=${unique.size}`);
    check(lastTs > fillTs + 2_000, `stall/tape-advanced-after-fill last=${lastTs} fill=${fillTs}`);
    check(Math.abs(lastTs - marketEnd) < 2_000, `stall/tape-tracks-sim last=${lastTs} market=${marketEnd}`);
    check(now - lastTs > 30_000, 'stall/tape-stays-behind-wall');
    const candles = sim.getCandles(1);
    const lastCandle = candles[candles.length - 1]?.time ?? 0;
    check(lastCandle * 1000 + 1_000 >= lastTs, 'stall/candle-time-follows-tape');
  } finally {
    Date.now = previous;
  }
}

function runBootstrapHistory(): void {
  const rng = new RNG('sim-clock-bootstrap');
  const meta = generateToken(rng, 0, 'LONG_RUNNER');
  const sim = new TokenSim(meta, 2_000, getFateTimeoutSimMs('LONG_RUNNER', rng));
  sim.bootstrapAdvance(18 * 60_000, 'OFF');
  const tape = sim['tape'];
  const candles = sim.getCandles(1);
  const candleVolume = sumVolume(sim, 'price');
  const mcapVolume = sumVolume(sim, 'mcap');
  const tapeVolume = tape.reduce((sum, trade) => sum + trade.notionalUsd, 0);
  check(tape.length === 2_000, `bootstrap/tape-capped len=${tape.length}`);
  check(candles.length > 100, `bootstrap/candle-count=${candles.length}`);
  check(candleVolume > tapeVolume * 1.5, `bootstrap/volume-beyond-tape candles=${candleVolume} tape=${tapeVolume}`);
  check(Math.abs(candleVolume - mcapVolume) < 1e-6, 'bootstrap/price-and-mcap-volume-match');
  const gapSec = (candles[1]?.time ?? 0) - (candles[0]?.time ?? 0);
  check(candles.length > 1 && gapSec >= 0 && gapSec < 30, `bootstrap/no-hole-after-genesis gap=${gapSec}`);
  const lastSec = candles[candles.length - 1]?.time ?? 0;
  const headLagSec = Date.now() / 1000 - lastSec;
  check(headLagSec >= -2 && headLagSec < 15, `bootstrap/head-near-wall lag=${headLagSec}`);
  const spanSec = lastSec - (candles[0]?.time ?? lastSec);
  check(spanSec > 10 * 60, `bootstrap/history-spans-age span=${spanSec}`);
}

runAggregatorShift();
runStallStamp();
runBootstrapHistory();

for (const failure of failures) console.error(`FAIL ${failure}`);
console.log(`Sim clock QA: ${checks - failures.length}/${checks} checks passed`);
if (failures.length > 0) {
  throw new Error(`Sim clock QA: ${failures.length} failures`);
}
