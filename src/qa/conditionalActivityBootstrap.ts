import { RNG } from '../engine/rng';
import { TokenSim, type SimTapeTrade } from '../tokens/tokenSim';
import { generateToken, getStartingMcapUsd, getFateTimeoutSimMs } from '../tokens/generator';
import { isFinalStretchToken } from '../tokens/tokenBuckets';
import { getSessionBucket } from '../market/session';
import { measurePath, distribution, type MarketPrint } from './marketBehaviorMetrics';
import type { BaselineConfig } from './marketBehaviorBaseline';

/** Separate selection diagnostic; unmatched slots exclude registry's new-pair fallback. */
export function runBootstrapControl(config: BaselineConfig) {
  const originalNow = Date.now;
  let now = Date.parse(config.startUtc);
  Date.now = () => now;
  try {
    const tokens = config.seeds.flatMap(seed => {
      const rng = new RNG(`${seed}:bootstrap`);
      return Array.from({ length: config.tokensPerSeed }, (_, index) => {
        now = Date.parse(config.startUtc) + config.startHoursUtc[index % config.startHoursUtc.length]! * 3600000;
        let selected: TokenSim | null = null;
        let attempts = 0;
        for (; attempts < 14; attempts++) {
          const age = 480000 + rng.next() * 840000;
          const fate = rng.next() < 0.5 ? 'NORMAL' : 'LONG_RUNNER';
          const meta = { ...generateToken(rng, 0, fate), id: `p1-bootstrap:${seed}:${index}:${attempts}` };
          const sim = new TokenSim(meta, getStartingMcapUsd(fate, rng), getFateTimeoutSimMs(fate, rng));
          const matches = () => isFinalStretchToken({ ...sim.meta, ...sim.getRuntime() });
          sim.bootstrapAdvance(age, getSessionBucket(now), () =>
            ['MIGRATED', 'DEAD', 'RUGGED'].includes(sim.getPhase()) || (sim.getAgeMs() >= 480000 && matches()));
          if (matches()) { selected = sim; break; }
        }
        if (!selected) return { seed, index, matched: false, attempts, metrics: null, migrated: false, ready: null };
        const sim = selected;
        const ready = sim['isMigrationRuntimeReady'](now);
        const startAgeMs = sim.getAgeMs();
        const initialPriceUsd = sim.getLastPriceUsd();
        const startClockMs = sim['marketNowMs']();
        const prints: MarketPrint[] = [];
        const push = sim['tape'].push;
        sim['tape'].push = (...rows: SimTapeTrade[]) => {
          for (const row of rows) prints.push({ ageMs: row.tMs - startClockMs,
            priceUsd: row.priceUsd, quoteUsd: row.notionalUsd, side: row.side });
          return push.apply(sim['tape'], rows);
        };
        sim.enableDormantFastPath();
        let elapsed = 0;
        while (elapsed < 120000 && sim.getPhase() !== 'MIGRATED') {
          elapsed += 200;
          now += 200;
          sim.tick(.2, getSessionBucket(now));
        }
        return { seed, index, matched: true, attempts: attempts + 1, startAgeMs, ready,
          migrated: sim.getPhase() === 'MIGRATED',
          metrics: measurePath({ startMs: 0, endMs: Math.max(elapsed, prints[prints.length - 1]?.ageMs ?? 0), initialPriceUsd, prints }) };
      });
    });
    const matches = tokens.filter(t => t.matched);
    return { tokens, summary: { slots: tokens.length, matched: matches.length,
      migratedWithin120s: matches.filter(t => t.migrated).length,
      ready: matches.filter(t => t.ready).length,
      trades: distribution(matches.map(t => t.metrics!.trades)),
      drawdownPct: distribution(matches.map(t => t.metrics!.maxDrawdownPct)) } };
  } finally { Date.now = originalNow; }
}
