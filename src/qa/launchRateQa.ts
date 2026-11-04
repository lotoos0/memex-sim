import { RNG } from '../engine/rng';
import { expectedLaunches, LAUNCHES_PER_MIN_BY_UTC_HOUR, launchesPerMinute } from '../market/launchRate';
import { usePostStore } from '../store/postStore';
import { useTokenStore } from '../store/tokenStore';
import { useTradingStore } from '../store/tradingStore';
import { TokenRegistry } from '../tokens/registry';
import { toSimDtMs } from '../tokens/simClock';

// Spawn rate is a Poisson process on the sim clock.
// A 200 ms callback and a 1 s callback must share the hourly mean.
const failures: string[] = [];
let checks = 0;

function check(condition: boolean, label: string): void {
  checks += 1;
  if (!condition) failures.push(label);
}

function countLaunches(stepMs: number, durationMs: number, startMs: number, seed: number): number {
  const rng = new RNG(seed);
  let total = 0;
  let now = startMs;
  const steps = Math.round(durationMs / stepMs);
  for (let i = 0; i < steps; i++) {
    const simDtSec = toSimDtMs(stepMs) / 1000;
    total += rng.poisson(expectedLaunches(now, simDtSec));
    now += stepMs;
  }
  return total;
}

function runTable(): void {
  check(LAUNCHES_PER_MIN_BY_UTC_HOUR.length === 24, `table/24-hours n=${LAUNCHES_PER_MIN_BY_UTC_HOUR.length}`);
  const mean = LAUNCHES_PER_MIN_BY_UTC_HOUR.reduce((sum, rate) => sum + rate, 0) / 24;
  check(Math.abs(mean - 32.3) < 0.15, `table/mean ${mean.toFixed(2)}`);
  const night = launchesPerMinute(Date.UTC(2026, 9, 15, 8, 0, 0));
  const peak = launchesPerMinute(Date.UTC(2026, 9, 15, 19, 0, 0));
  check(night === 17.9, `table/hour-8 ${night}`);
  check(peak === 56.7, `table/hour-19 ${peak}`);
  check(peak > night * 2, `table/peak-above-night peak=${peak} night=${night}`);
  console.log(`launch table: mean ${mean.toFixed(2)}/min, 08:00Z ${night}, 19:00Z ${peak}`);
}

function runTickIndependence(): void {
  // Stay inside one civil hour so the target rate does not change mid-run.
  const durationMs = 45 * 60_000;
  const hours = [8, 19];
  for (const hour of hours) {
    const startMs = Date.UTC(2026, 9, 15, hour, 0, 0);
    const targetPerMin = launchesPerMinute(startMs);
    const minutes = durationMs / 60_000;
    const target = targetPerMin * minutes;
    let fine = 0;
    let coarse = 0;
    const seeds = 8;
    for (let seed = 1; seed <= seeds; seed++) {
      fine += countLaunches(200, durationMs, startMs, seed);
      coarse += countLaunches(1000, durationMs, startMs, seed + 100);
    }
    const finePerMin = fine / (seeds * minutes);
    const coarsePerMin = coarse / (seeds * minutes);
    const fineGap = Math.abs(finePerMin - targetPerMin) / targetPerMin;
    const coarseGap = Math.abs(coarsePerMin - targetPerMin) / targetPerMin;
    const tickGap = Math.abs(finePerMin - coarsePerMin) / targetPerMin;
    check(fineGap < 0.08, `rate/200ms-h${hour} got ${finePerMin.toFixed(2)} target ${targetPerMin} gap ${(fineGap * 100).toFixed(1)}%`);
    check(coarseGap < 0.08, `rate/1000ms-h${hour} got ${coarsePerMin.toFixed(2)} target ${targetPerMin} gap ${(coarseGap * 100).toFixed(1)}%`);
    check(tickGap < 0.08, `rate/tick-gap-h${hour} ${(tickGap * 100).toFixed(1)}% fine=${finePerMin.toFixed(2)} coarse=${coarsePerMin.toFixed(2)}`);
    console.log(
      `hour ${hour}: target ${targetPerMin}/min over ${minutes} min x ${seeds}, 200ms ${finePerMin.toFixed(2)}, 1000ms ${coarsePerMin.toFixed(2)} (expected total/seed ${target.toFixed(0)})`,
    );
  }
}

function resetStores(): void {
  useTokenStore.setState({
    tokensById: {},
    eventsByTokenId: {},
    marketByTokenId: {},
    tradeFlowByTokenId: {},
    activeTokenId: null,
  });
  useTradingStore.setState({
    quickPositionsByTokenId: {},
    quickLimitOrdersById: {},
    pendingQuickOrdersById: {},
  });
  usePostStore.setState({ postsByTokenId: {} });
}

function runRegistryHour(stepMs: number, durationMs: number, hour: number): { perMin: number; maxSize: number } {
  const previous = Date.now;
  let now = Date.UTC(2026, 9, 15, hour, 30, 0);
  Date.now = () => now;
  const registry = new TokenRegistry();
  let maxSize = 0;
  try {
    registry.beginHeadless();
    const steps = Math.round(durationMs / stepMs);
    for (let i = 0; i < steps; i++) {
      now += stepMs;
      registry.advance(stepMs);
      if (registry.size > maxSize) maxSize = registry.size;
    }
    const perMin = registry.freshSpawnCount / (durationMs / 60_000);
    return { perMin, maxSize };
  } finally {
    registry.stop();
    Date.now = previous;
    resetStores();
  }
}

function runRegistryAgrees(): void {
  const durationMs = 10 * 60_000;
  const hour = 19;
  const target = launchesPerMinute(Date.UTC(2026, 9, 15, hour, 0, 0));
  const fine = runRegistryHour(200, durationMs, hour);
  const coarse = runRegistryHour(1000, durationMs, hour);
  const fineGap = Math.abs(fine.perMin - target) / target;
  const coarseGap = Math.abs(coarse.perMin - target) / target;
  check(fineGap < 0.2, `registry/200ms ${fine.perMin.toFixed(2)}/min target ${target} gap ${(fineGap * 100).toFixed(1)}% size ${fine.maxSize}`);
  check(coarseGap < 0.2, `registry/1000ms ${coarse.perMin.toFixed(2)}/min target ${target} gap ${(coarseGap * 100).toFixed(1)}% size ${coarse.maxSize}`);
  check(fine.maxSize < 360 && coarse.maxSize < 360, `registry/bounded fine=${fine.maxSize} coarse=${coarse.maxSize}`);
  console.log(
    `registry hour ${hour}: 200ms ${fine.perMin.toFixed(2)}/min (max ${fine.maxSize}), 1000ms ${coarse.perMin.toFixed(2)}/min (max ${coarse.maxSize}), target ${target}`,
  );
}

runTable();
runTickIndependence();
runRegistryAgrees();

for (const failure of failures) console.error(`FAIL ${failure}`);
console.log(`Launch rate QA: ${checks - failures.length}/${checks} checks passed`);
if (failures.length > 0) {
  throw new Error(`Launch rate QA: ${failures.length} failures`);
}
