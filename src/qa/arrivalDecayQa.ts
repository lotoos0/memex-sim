import { TokenSim } from '../tokens/tokenSim';
import { SUPPLY, type TokenFate, type TokenMeta } from '../tokens/types';

// Headless checks for age-decaying arrivals:
// the rate falls with sim age, a large share of coins go quiet by 5 min,
// and the expected count does not depend on tick length.
const failures: string[] = [];
let checks = 0;

function check(condition: boolean, label: string): void {
  checks += 1;
  if (!condition) failures.push(label);
}

function meta(id: string, fate: TokenFate): TokenMeta {
  return {
    id,
    name: 'Arrival',
    ticker: 'ARR',
    logoColor: '#ffffff',
    imageUrl: null,
    supply: SUPPLY,
    createdAtSimMs: 0,
    fate,
    metrics: {
      topHoldersPct: 12,
      devHoldingsPct: 2,
      snipersPct: 4,
      lpBurnedPct: 100,
      insidersPct: 1,
      bundlersPct: 1,
    },
  };
}

const FATES: TokenFate[] = ['SHORT', 'NORMAL', 'LONG_RUNNER'];

function runToken(id: string, fate: TokenFate, tickMs: number, durationMs: number, now0: number): number[] {
  let now = now0;
  const previous = Date.now;
  Date.now = () => now;
  const ages: number[] = [];
  try {
    const sim = new TokenSim(meta(id, fate), 2_000, 6 * 60 * 60_000);
    const spawn = now;
    const tape = sim['tape'];
    const originalPush = tape.push.bind(tape);
    tape.push = (...rows: typeof tape) => {
      for (const row of rows) ages.push((row.tMs - spawn) / 1000);
      return originalPush(...rows);
    };
    const steps = Math.round(durationMs / tickMs);
    for (let i = 0; i < steps; i++) {
      now += tickMs;
      sim.tick(tickMs / 1000, 'OFF');
    }
    return ages;
  } finally {
    Date.now = previous;
  }
}

function rate(ages: number[][], lo: number, hi: number): number {
  let n = 0;
  for (const token of ages) {
    for (const age of token) {
      if (age >= lo && age < hi) n += 1;
    }
  }
  return n / (ages.length * (hi - lo));
}

function runQuickRugStillDumps(): void {
  let now = 1_700_000_000_000;
  const previous = Date.now;
  Date.now = () => now;
  try {
    const sim = new TokenSim(meta('quick-rug', 'QUICK_RUG'), 2_000, 90_000);
    const steps = Math.round((5 * 60_000) / 200);
    for (let i = 0; i < steps; i++) {
      now += 200;
      sim.tick(0.2, 'OFF');
    }
    const runtime = sim.getRuntime();
    check(runtime.ruggedAtSimMs != null, 'quick-rug/fate-timeout-marks-rug');
    check(runtime.mcapUsd <= 2_100 && runtime.bondingCurvePct < 5,
      `quick-rug/dumps phase=${sim.getPhase()} mcap=${runtime.mcapUsd.toFixed(2)} bond=${runtime.bondingCurvePct.toFixed(2)}`);
    console.log(`quick rug: phase ${sim.getPhase()}, mcap ${runtime.mcapUsd.toFixed(2)}, bond ${runtime.bondingCurvePct.toFixed(2)}`);
  } finally {
    Date.now = previous;
  }
}

function runDecayAndDeath(): void {
  const durationMs = 8 * 60_000;
  const ages: number[][] = [];
  for (let i = 0; i < 24; i++) {
    ages.push(runToken(`decay-${i}`, FATES[i % FATES.length]!, 200, durationMs, 1_700_000_000_000 + i * 3_600_000));
  }
  const early = rate(ages, 0, 10);
  const mid = rate(ages, 60, 120);
  const late = rate(ages, 300, 480);
  const dead = ages.filter((token) => token.every((age) => age < 300)).length / ages.length;
  check(early > 0.25 && early < 6, `decay/launch-rate ${early.toFixed(3)}/s`);
  check(early > mid * 1.8, `decay/launch-above-1m early=${early.toFixed(3)} mid=${mid.toFixed(3)}`);
  check(mid > late * 1.5, `decay/1m-above-5m mid=${mid.toFixed(3)} late=${late.toFixed(3)}`);
  check(late < 0.45, `decay/late-rate ${late.toFixed(3)}/s`);
  check(dead >= 0.4 && dead < 0.96, `death/no-trades-after-5m ${(dead * 100).toFixed(1)}%`);
  console.log(
    `arrival decay: 0-10s ${early.toFixed(3)}/s, 1-2m ${mid.toFixed(3)}/s, 5-8m ${late.toFixed(3)}/s, quiet-by-5m ${(dead * 100).toFixed(1)}%`,
  );
}

function runTickIndependence(): void {
  const durationMs = 60_000;
  let fine = 0;
  let coarse = 0;
  const n = 20;
  for (let i = 0; i < n; i++) {
    const fate = FATES[i % FATES.length]!;
    fine += runToken(`tick-${i}`, fate, 200, durationMs, 1_700_000_000_000).length;
    coarse += runToken(`tick-${i}`, fate, 1000, durationMs, 1_700_000_000_000).length;
  }
  const mean = (fine + coarse) / 2;
  const gap = Math.abs(fine - coarse) / Math.max(1, mean);
  check(mean > n * 5, `tick/tokens-actually-trade fine=${fine} coarse=${coarse}`);
  check(gap < 0.4, `tick/rate-independent gap=${(gap * 100).toFixed(1)}% fine=${fine} coarse=${coarse}`);
  console.log(`arrival ticks: 200ms ${fine} trades, 1000ms ${coarse} trades, gap ${(gap * 100).toFixed(1)}%`);
}

runDecayAndDeath();
runTickIndependence();
runQuickRugStillDumps();

for (const failure of failures) console.error(`FAIL ${failure}`);
console.log(`Arrival QA: ${checks - failures.length}/${checks} checks passed`);
if (failures.length > 0) {
  throw new Error(`Arrival QA: ${failures.length} failures`);
}
