// Headless harness (copy of memex-sim@HEAD src; repo untouched). Mocks Date.now, ticks TokenSim at 200ms like registry.
import { RNG } from './src/engine/rng';
import { TokenSim } from './src/tokens/tokenSim';
import { generateToken, getFateTimeoutSimMs, getStartingMcapUsd } from './src/tokens/generator';
import { getSessionBucket } from './src/market/session';
import { writeFileSync } from 'node:fs';

const N = Number(process.env.N ?? 150);
const REAL_MIN = Number(process.env.MIN ?? 30);
const TICK_MS = 200;
let clock = Date.UTC(2026, 9, 15, 0, 0, 0);
(Date as any).now = () => clock;
const rng = new RNG('harness-seed');
const fates = ['SHORT', 'NORMAL', 'LONG_RUNNER'] as const; // registry.spawnFreshToken
const trades: any[] = [];
const tokens: any[] = [];
for (let k = 0; k < N; k++) {
  clock = Date.UTC(2026, 9, 15, 0, 0, 0) + Math.floor((k / N) * 86_400_000); // spread spawns across the day (sessions)
  const fate = fates[Math.floor(rng.next() * 3)]!;
  const meta = generateToken(rng, 0, fate);
  const sim = new TokenSim(meta, getStartingMcapUsd(meta.fate, rng), getFateTimeoutSimMs(meta.fate, rng));
  const spawn = clock;
  const tape = (sim as any).tape as any[];
  tape.push = function (...xs: any[]) { for (const x of xs) trades.push({ tok: k, t: x.tMs - spawn, side: x.side, w: x.walletId, usd: x.notionalUsd, mcap: x.mcapUsd }); return Array.prototype.push.apply(this, xs); };
  let migratedAt: number | null = null; let deadAt: number | null = null; let peak = 0;
  const steps = (REAL_MIN * 60_000) / TICK_MS;
  for (let i = 0; i < steps; i++) {
    clock += TICK_MS;
    const evs = sim.tick(TICK_MS / 1000, getSessionBucket(clock));
    for (const e of evs) if (e.type === 'MIGRATION' && migratedAt == null) migratedAt = clock - spawn;
    const ph = sim.getPhase(); if (ph === 'DEAD' && deadAt == null) deadAt = clock - spawn;
    peak = Math.max(peak, sim.getLastMcapUsd());
  }
  tokens.push({ tok: k, fate: meta.fate, archetype: (sim as any).archetype, baseLambda: (sim as any).baseLambda, baseTradeSizeUsd: (sim as any).baseTradeSizeUsd, migratedAt, deadAt, peakMcapUsd: peak, session: getSessionBucket(spawn), simTimeMsEnd: sim.getSimTimeMs() });
}
writeFileSync('out_tokens.json', JSON.stringify(tokens));
writeFileSync('out_trades.jsonl', trades.map((t) => JSON.stringify(t)).join('\n'));
console.log('tokens', tokens.length, 'trades', trades.length);
