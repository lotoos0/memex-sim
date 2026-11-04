// Headless clock measurement. Ticks TokenSim the way the registry does (200 ms),
// with Date.now mocked so age is the simulated wall interval, not the host runtime.
// Does not tune market parameters. Used to compare clocks before and after unification.
import { writeFileSync } from 'node:fs';
import { RNG } from '../src/engine/rng';
import { getSessionBucket } from '../src/market/session';
import { generateToken, getFateTimeoutSimMs, getStartingMcapUsd } from '../src/tokens/generator';
import { TokenSim } from '../src/tokens/tokenSim';

const N = Number(process.env.N ?? 120);
const REAL_MIN = Number(process.env.MIN ?? 30);
const TICK_MS = 200;
const DAY_MS = 86_400_000;
const BUCKETS: Array<[number, number]> = [
  [0, 10],
  [10, 30],
  [30, 60],
  [60, 120],
  [120, 300],
  [300, 600],
  [600, 1800],
];

let clock = Date.UTC(2026, 9, 15, 0, 0, 0);
Date.now = () => clock;

const rng = new RNG('harness-seed');
const fates = ['SHORT', 'NORMAL', 'LONG_RUNNER'] as const;
const bucketCounts = BUCKETS.map(() => 0);
const devFirstSellSec: number[] = [];
const migrationSec: number[] = [];
let tradeCount = 0;
let devSellTokens = 0;
let lastSimAgeSec = 0;
let lastWallAgeSec = 0;

const started = performance.now();
for (let k = 0; k < N; k++) {
  clock = Date.UTC(2026, 9, 15, 0, 0, 0) + Math.floor((k / N) * DAY_MS);
  const fate = fates[Math.floor(rng.next() * fates.length)]!;
  const meta = generateToken(rng, 0, fate);
  const sim = new TokenSim(meta, getStartingMcapUsd(meta.fate, rng), getFateTimeoutSimMs(meta.fate, rng));
  const spawn = clock;
  const tape = sim['tape'] as Array<{ tMs: number; side: string; walletId: string }>;
  const originalPush = tape.push.bind(tape);
  let devSold = false;
  tape.push = (...rows: Array<{ tMs: number; side: string; walletId: string }>) => {
    for (const row of rows) {
      const ageSec = (row.tMs - spawn) / 1000;
      tradeCount += 1;
      for (let b = 0; b < BUCKETS.length; b++) {
        const [lo, hi] = BUCKETS[b]!;
        if (ageSec >= lo && ageSec < hi) bucketCounts[b] += 1;
      }
      if (!devSold && row.side === 'SELL' && row.walletId.startsWith('dv_')) {
        devSold = true;
        devSellTokens += 1;
        devFirstSellSec.push(ageSec);
      }
    }
    return originalPush(...rows);
  };

  let migrated = false;
  const steps = (REAL_MIN * 60_000) / TICK_MS;
  for (let i = 0; i < steps; i++) {
    clock += TICK_MS;
    const events = sim.tick(TICK_MS / 1000, getSessionBucket(clock));
    if (!migrated) {
      for (const event of events) {
        if (event.type === 'MIGRATION') {
          migrated = true;
          migrationSec.push((clock - spawn) / 1000);
        }
      }
    }
  }
    lastSimAgeSec = (sim.getSimTimeMs() - meta.createdAtSimMs) / 1000;
    lastWallAgeSec = (clock - spawn) / 1000;
    if ((k + 1) % 10 === 0) {
    console.error(`progress ${k + 1}/${N} trades ${tradeCount} migrated ${migrationSec.length}`);
  }
}

function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index]!;
}

const hostSec = (performance.now() - started) / 1000;
const result = {
  n: N,
  realMin: REAL_MIN,
  tickMs: TICK_MS,
  hostSec,
  lastTokenSimAgeSec: lastSimAgeSec,
  lastTokenWallAgeSec: lastWallAgeSec,
  trades: tradeCount,
  tradeRateByAge: BUCKETS.map(([lo, hi], i) => ({
    lo,
    hi,
    tradesPerTokenPerSec: bucketCounts[i]! / (N * (hi - lo)),
    trades: bucketCounts[i]!,
  })),
  devFirstSell: {
    tokens: devSellTokens,
    share: devSellTokens / N,
    p10Sec: quantile(devFirstSellSec, 0.1),
    p50Sec: quantile(devFirstSellSec, 0.5),
    p90Sec: quantile(devFirstSellSec, 0.9),
  },
  migration: {
    count: migrationSec.length,
    rate: migrationSec.length / N,
    p10Sec: quantile(migrationSec, 0.1),
    p50Sec: quantile(migrationSec, 0.5),
    p90Sec: quantile(migrationSec, 0.9),
  },
};

const outPath = process.env.OUT ?? 'sim-clock-metrics.json';
writeFileSync(outPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
