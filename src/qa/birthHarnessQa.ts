import { launchesPerMinute } from '../market/launchRate';
import { usePostStore } from '../store/postStore';
import { useTokenStore } from '../store/tokenStore';
import { useTradingStore } from '../store/tradingStore';
import { TokenRegistry } from '../tokens/registry';
import { MAX_REGISTRY_TOKENS } from '../tokens/registryEviction';
import type { TokenSim } from '../tokens/tokenSim';

// Headless hour at the night trough and the evening peak.
// Reports launch rate, stillborn share, graduation, population, and tick cost.
const HOURS = [
  { hour: 8, minutes: 60 },
  { hour: 19, minutes: 60 },
];
const STEP_MS = 1_000;
const TICK_PROBE_STEPS = 40;
const TICK_PROBE_MS = 200;

type Audit = ReturnType<TokenSim['getLaunchAudit']> & { spawnMs: number };

class Probe extends TokenRegistry {
  readonly spawnMsById = new Map<string, number>();
  readonly done: Audit[] = [];
  readonly starts: number[] = [];
  readonly graduations = new Map<string, { seconds: number; mcap: number }>();

  observeGraduations(): void {
    this.forEachToken((sim) => {
      if (!this.spawnMsById.has(sim.meta.id) || this.graduations.has(sim.meta.id)) return;
      if (sim.getPhase() === 'MIGRATED') {
        this.graduations.set(sim.meta.id, {
          seconds: sim.getAgeMs() / 1000, mcap: sim.getMigrationReferenceMcapUsd(),
        });
      }
    });
  }

  protected onFreshTokenSpawned(sim: TokenSim, nowMs: number): void {
    this.spawnMsById.set(sim.meta.id, nowMs);
    this.starts.push(sim.getCurveDebugSnapshot().mcapCurveUsd);
  }

  protected onTokenEvicted(sim: TokenSim): void {
    const spawnMs = this.spawnMsById.get(sim.meta.id);
    if (spawnMs == null) return;
    this.spawnMsById.delete(sim.meta.id);
    this.done.push({ ...sim.getLaunchAudit(), spawnMs });
  }

  collectRemaining(): Audit[] {
    const rows = this.done.slice();
    this.forEachToken((sim) => {
      const spawnMs = this.spawnMsById.get(sim.meta.id);
      if (spawnMs == null) return;
      rows.push({ ...sim.getLaunchAudit(), spawnMs });
    });
    return rows;
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

function pct(n: number, d: number): string {
  if (d <= 0) return 'n/a';
  return `${((100 * n) / d).toFixed(1)}%`;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

const failures: string[] = [];

function runHour(hour: number, minutes: number): void {
  const previous = Date.now;
  let now = Date.UTC(2026, 9, 15, hour, 0, 0);
  Date.now = () => now;
  const probe = new Probe();
  const target = launchesPerMinute(now);
  const populations: { min: number; size: number }[] = [];
  let maxSize = 0;
  let cheap = 0;
  let stepped = 0;
  const tickCosts: number[] = [];
  try {
    probe.beginHeadless();
    const steps = minutes * 60;
    for (let i = 0; i < steps; i++) {
      now += STEP_MS;
      probe.advance(STEP_MS);
      probe.observeGraduations();
      probe.forEachToken((sim) => {
        stepped += 1;
        if (sim.wasCheapStep()) cheap += 1;
      });
      if (probe.size > maxSize) maxSize = probe.size;
      if ((i + 1) % (10 * 60) === 0) populations.push({ min: (i + 1) / 60, size: probe.size });
    }

    for (let i = 0; i < TICK_PROBE_STEPS; i++) {
      now += TICK_PROBE_MS;
      const t0 = performance.now();
      probe.advance(TICK_PROBE_MS);
      probe.observeGraduations();
      tickCosts.push(performance.now() - t0);
    }

    const rows = probe.collectRemaining();
    const endMs = now;
    const perMin = probe.freshSpawnCount / minutes;
    const gap = Math.abs(perMin - target) / target;
    const matured = rows.filter((row) => endMs - row.spawnMs >= 10 * 60_000);
    const aged5 = rows.filter((row) => row.ageMs >= 5 * 60_000 || endMs - row.spawnMs >= 5 * 60_000);
    const quiet5 = aged5.filter((row) => row.tradesAfter5Min === 0);
    const zero = rows.filter((row) => row.tradeCount === 0);
    const handful = rows.filter((row) => row.tradeCount <= 3);
    const graduated = matured.filter((row) => row.phase === 'MIGRATED');
    const nearLaunch = rows.filter((row) => row.mcapUsd <= 6_000);
    const stillborn = rows.filter((row) => row.stillborn);
    const stillbornHandful = stillborn.filter((row) => row.tradeCount <= 3);
    const mcaps = rows.map((row) => row.mcapUsd);
    const stillMcaps = stillborn.map((row) => row.mcapUsd);
    const avgTick = tickCosts.reduce((sum, value) => sum + value, 0) / tickCosts.length;
    const graduationTimes = [...probe.graduations.values()].map((g) => g.seconds);
    const graduationMcaps = [...probe.graduations.values()].map((g) => g.mcap);

    console.log(
      [
        `hour ${hour}Z target ${target}/min achieved ${perMin.toFixed(2)}/min (${(gap * 100).toFixed(1)}% off) n=${probe.freshSpawnCount}`,
        `  zero trades ${pct(zero.length, rows.length)} (${zero.length}/${rows.length}), <=3 trades ${pct(handful.length, rows.length)}`,
        `  stillborn ${pct(stillborn.length, rows.length)}, of those <=3 trades ${pct(stillbornHandful.length, stillborn.length)}, median mcap $${median(stillMcaps).toFixed(0)}`,
        `  no trades after 5 min ${pct(quiet5.length, aged5.length)} (${quiet5.length}/${aged5.length})`,
        `  graduation of launches aged >=10 min ${pct(graduated.length, matured.length)} (${graduated.length}/${matured.length})`,
        `  start mcap min/median/max $${Math.min(...probe.starts).toFixed(2)}/$${median(probe.starts).toFixed(2)}/$${Math.max(...probe.starts).toFixed(2)}`,
        `  observed graduation n=${graduationTimes.length}, median seconds ${median(graduationTimes).toFixed(1)}, mcap min/median/max $${Math.min(...graduationMcaps).toFixed(2)}/$${median(graduationMcaps).toFixed(2)}/$${Math.max(...graduationMcaps).toFixed(2)}`,
        `  mcap <= $6k ${pct(nearLaunch.length, rows.length)}, median mcap $${median(mcaps).toFixed(0)}`,
        `  population ${populations.map((point) => `${point.min}m:${point.size}`).join(' ')} max ${maxSize} final ${probe.size}`,
        `  cheap steps ${pct(cheap, stepped)}, tick cost after ${minutes} min ${avgTick.toFixed(2)} ms (n=${TICK_PROBE_STEPS} x ${TICK_PROBE_MS}ms)`,
      ].join('\n'),
    );

    if (gap > 0.15) failures.push(`hour ${hour} rate gap ${(gap * 100).toFixed(1)}%`);
    if (maxSize > MAX_REGISTRY_TOKENS) failures.push(`hour ${hour} population ${maxSize}`);
    if (matured.length > 50) {
      const grad = graduated.length / matured.length;
      // SOL-sized flow lands near the organic ~1.5% (08Z ~2.0%, 19Z ~1.6% in this harness).
      if (grad < 0.015 || grad > 0.07) failures.push(`hour ${hour} graduation ${(grad * 100).toFixed(2)}%`);
    }
    if (aged5.length > 50) {
      const quiet = quiet5.length / aged5.length;
      if (quiet < 0.4 || quiet > 0.9) failures.push(`hour ${hour} quiet-after-5m ${(quiet * 100).toFixed(1)}%`);
    }
  } finally {
    probe.stop();
    Date.now = previous;
    resetStores();
  }
}

for (const spec of HOURS) runHour(spec.hour, spec.minutes);

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  throw new Error(`Birth harness: ${failures.length} failures`);
}
console.log('Birth harness: ok');
