import { RNG } from '../engine/rng';
import { TokenSim } from '../tokens/tokenSim';
import { SUPPLY, type TokenFate, type TokenMeta } from '../tokens/types';

// Dev first-sell schedule: separate RNG, real quantiles, stillborn never sells.
const failures: string[] = [];
let checks = 0;

function check(condition: boolean, label: string): void {
  checks += 1;
  if (!condition) failures.push(label);
}

function meta(id: string, fate: TokenFate = 'NORMAL'): TokenMeta {
  return {
    id,
    name: 'Dev',
    ticker: 'DEV',
    logoColor: '#fff',
    imageUrl: null,
    supply: SUPPLY,
    createdAtSimMs: 0,
    fate,
    metrics: {
      topHoldersPct: 10,
      devHoldingsPct: 1,
      snipersPct: 1,
      lpBurnedPct: 100,
      insidersPct: 1,
      bundlersPct: 1,
    },
  };
}

function scheduledMs(id: string): number {
  const rng = new RNG(`${id}:devsell`);
  if (rng.next() < 0.10) return Number.POSITIVE_INFINITY;
  const knots = [0, 0.10, 0.25, 0.50, 0.75, 0.90, 0.995];
  const secs = [1, 3, 7, 25, 93, 376, 1400];
  const u = rng.next();
  let i = 0;
  while (i < knots.length - 2 && u > knots[i + 1]!) i += 1;
  const span = Math.max(1e-6, knots[i + 1]! - knots[i]!);
  const w = Math.min(1, Math.max(0, (u - knots[i]!) / span));
  return Math.exp(Math.log(secs[i]!) + (Math.log(secs[i + 1]!) - Math.log(secs[i]!)) * w) * 1000;
}

function runIsolation(): void {
  const now = Date.UTC(2026, 9, 15, 8, 0, 0);
  const previous = Date.now;
  Date.now = () => now;
  try {
    const sim = new TokenSim(meta('tok_devsell_iso'), 2_000, 6 * 60 * 60_000);
    const exposed = sim as unknown as { rng: { state: number }; archetype: string; devFirstSellAtSimMs: number };
    const curve = sim.getCurveDebugSnapshot();
    check(exposed.archetype === 'DOA', `iso/archetype ${exposed.archetype}`);
    check(exposed.rng.state === 779592712, `iso/rng-state ${exposed.rng.state}`);
    check(Math.abs(curve.mcapCurveUsd - 4193.849021435229) < 1e-6, `iso/mcap ${curve.mcapCurveUsd}`);
    check(curve.vTok === 1_073_000_000 && curve.rTok === 793_100_000 && curve.feeBps === 125, 'iso/curve-constants');
    check(exposed.devFirstSellAtSimMs === scheduledMs('tok_devsell_iso'), 'iso/schedule-uses-devsell-stream');
  } finally {
    Date.now = previous;
  }
}

function quantile(sorted: number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
  return sorted[index]!;
}

function runDistribution(): void {
  const finite: number[] = [];
  let never = 0;
  const n = 400;
  for (let i = 0; i < n; i++) {
    const sim = new TokenSim(meta(`devsell-dist-${i}`), 2_000, 60_000);
    const at = (sim as unknown as { devFirstSellAtSimMs: number }).devFirstSellAtSimMs;
    if (!Number.isFinite(at)) never += 1;
    else finite.push(at / 1000);
  }
  finite.sort((a, b) => a - b);
  const neverShare = never / n;
  const med = quantile(finite, 0.50);
  check(neverShare > 0.06 && neverShare < 0.16, `dist/never ${(neverShare * 100).toFixed(1)}%`);
  check(med > 18 && med < 35, `dist/median ${med.toFixed(1)}s`);
  check(quantile(finite, 0.10) < 8, `dist/p10 ${quantile(finite, 0.10).toFixed(1)}s`);
  check(quantile(finite, 0.90) > 200 && quantile(finite, 0.90) < 700, `dist/p90 ${quantile(finite, 0.90).toFixed(1)}s`);
  console.log(`dev first sell schedule: never ${(neverShare * 100).toFixed(1)}%, median ${med.toFixed(1)}s, p10 ${quantile(finite, 0.10).toFixed(1)}s, p90 ${quantile(finite, 0.90).toFixed(1)}s`);
}

function runStillbornDoesNotSell(): void {
  let now = Date.UTC(2026, 9, 15, 8, 0, 0);
  const previous = Date.now;
  Date.now = () => now;
  let sells = 0;
  try {
    const sim = new TokenSim(meta('devsell-stillborn', 'SHORT'), 2_000, 60 * 60_000);
    sim.markStillbornLaunch();
    sim.enableDormantFastPath();
    for (let step = 0; step < 300; step++) {
      now += 200;
      const events = sim.tick(0.2, 'EU');
      if (events.some((event) => event.type === 'DEV_SELL')) sells += 1;
    }
    check(sells === 0, `stillborn/sells ${sells}`);
    check(Math.abs(sim.getLastMcapUsd() - sim.getCurveDebugSnapshot().mcapCurveUsd) / sim.getCurveDebugSnapshot().mcapCurveUsd < 0.001,
      `stillborn/mcap ${sim.getLastMcapUsd().toFixed(2)}`);
  } finally {
    Date.now = previous;
  }
}

function runNoSellBeforeSchedule(): void {
  let now = Date.UTC(2026, 9, 15, 8, 0, 0);
  const previous = Date.now;
  Date.now = () => now;
  try {
    const id = 'devsell-order';
    const sim = new TokenSim(meta(id, 'SHORT'), 2_000, 60 * 60_000);
    sim.enableDormantFastPath();
    const atMs = (sim as unknown as { devFirstSellAtSimMs: number }).devFirstSellAtSimMs;
    check(Number.isFinite(atMs), 'order/has-a-sell');
    let firstSellAge: number | null = null;
    const steps = Math.ceil((atMs + 2_000) / 200);
    for (let step = 0; step < steps; step++) {
      now += 200;
      const events = sim.tick(0.2, 'EU');
      if (firstSellAge == null && events.some((event) => event.type === 'DEV_SELL')) {
        firstSellAge = sim.getAgeMs();
      }
    }
    check(firstSellAge != null && firstSellAge + 1 >= atMs, `order/not-early sell=${firstSellAge} at=${atMs}`);
    console.log(`dev first sell order: scheduled ${(atMs / 1000).toFixed(2)}s, fired ${((firstSellAge ?? 0) / 1000).toFixed(2)}s`);
  } finally {
    Date.now = previous;
  }
}

runIsolation();
runDistribution();
runStillbornDoesNotSell();
runNoSellBeforeSchedule();

for (const failure of failures) console.error(`FAIL ${failure}`);
console.log(`Dev first sell QA: ${checks - failures.length}/${checks} checks passed`);
if (failures.length > 0) throw new Error(`Dev first sell QA: ${failures.length} failures`);
