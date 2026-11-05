import { RNG } from '../engine/rng';
import { getSessionBucket } from '../market/session';
import { pickFreshLaunchFate, rollStillbornLaunch } from '../tokens/freshLaunch';
import { generateToken, getFateTimeoutSimMs, getStartingMcapUsd } from '../tokens/generator';
import { TokenSim, type SimTapeTrade } from '../tokens/tokenSim';
import { distribution, measurePath, summarizePaths, type MarketPath, type MarketPrint } from './marketBehaviorMetrics';

export type BaselineConfig = {
  seeds: string[];
  tokensPerSeed: number;
  horizonSec: number;
  tickMs: number;
  startUtc: string;
  startHoursUtc: number[];
};
export const defaultBaselineConfig: BaselineConfig = {
  seeds: ['SIM01-A', 'SIM01-B', 'SIM01-C'], tokensPerSeed: 200,
  horizonSec: 1800, tickMs: 200, startUtc: '2026-10-15T00:00:00.000Z', startHoursUtc: [8, 19],
};
type Group = '80_90_ready' | '80_90_not_ready' | '90_100_ready' | '90_100_not_ready';
const groups: Group[] = ['80_90_ready', '80_90_not_ready', '90_100_ready', '90_100_not_ready'];
type Episode = MarketPath & { group: Group };

function runToken(seed: string, index: number, rng: RNG, config: BaselineConfig, setNow: (ms: number) => void) {
  const date = new Date(config.startUtc);
  date.setUTCHours(config.startHoursUtc[index % config.startHoursUtc.length]!, 0, 0, 0);
  const birth = date.getTime();
  setNow(birth);
  const generated = generateToken(rng, 0, pickFreshLaunchFate(rng));
  // Isolate the constructor's RNG from generateToken's process-global id counter.
  // A seed produces the same token ids even when run alone or in another seed order.
  const meta = { ...generated, id: `sim01:${JSON.stringify([seed, index])}` };
  const sim = new TokenSim(meta, getStartingMcapUsd(meta.fate, rng), getFateTimeoutSimMs(meta.fate, rng));
  const stillborn = rollStillbornLaunch(rng);
  if (stillborn) sim.markStillbornLaunch();
  sim.enableDormantFastPath();
  const initialPriceUsd = sim.getLastPriceUsd();
  const prints: MarketPrint[] = [];
  let first80: { ageMs: number; priceUsd: number; printIndex: number } | null = null;
  let migratedAtMs: number | null = null;
  let returnedBelow80 = false;
  let tickPrints: MarketPrint[] = [];
  const tape = sim['tape'];
  const push = tape.push;
  tape.push = (...rows: SimTapeTrade[]): number => {
    for (const row of rows) {
      // A completing curve print is recorded before hasMigrated latches. Any
      // subsequent same-tick migrated prints must not enter a pre-migration path.
      if (sim['hasMigrated']) continue;
      const print = { ageMs: row.tMs - birth, priceUsd: row.priceUsd,
        quoteUsd: row.notionalUsd, side: row.side };
      prints.push(print);
      tickPrints.push(print);
      if (first80 === null && sim['getCurveProgress']() >= 0.8) {
        first80 = { ageMs: print.ageMs, priceUsd: print.priceUsd, printIndex: prints.length - 1 };
      }
      if (first80 !== null && sim['getCurveProgress']() < 0.8) returnedBelow80 = true;
      if (sim['getCurveProgress']() === 1) migratedAtMs = print.ageMs;
    }
    return push.apply(tape, rows);
  };
  const episodes: Episode[] = [];
  let elapsedMs = 0;
  while (elapsedMs < config.horizonSec * 1000) {
    const progress = sim['getCurveProgress']();
    const ready = sim['isMigrationRuntimeReady'](birth + elapsedMs);
    const group: Group | null = progress >= 0.8 && progress < 1
      ? `${progress < 0.9 ? '80_90' : '90_100'}_${ready ? 'ready' : 'not_ready'}` : null;
    const previousEpisode = episodes[episodes.length - 1];
    let active = previousEpisode?.endMs === elapsedMs && previousEpisode.group === group ? previousEpisode : undefined;
    if (group && !active) {
      active = { group, startMs: elapsedMs, endMs: elapsedMs, initialPriceUsd: sim.getLastPriceUsd(), prints: [] };
      episodes.push(active);
    }
    tickPrints = [];
    elapsedMs += config.tickMs;
    setNow(birth + elapsedMs);
    sim.tick(config.tickMs / 1000, getSessionBucket(birth + elapsedMs));
    if (active) {
      active.prints.push(...tickPrints);
      active.endMs = migratedAtMs ?? elapsedMs;
    }
    if (sim.getPhase() === 'MIGRATED') break;
  }
  const endMs = migratedAtMs ?? elapsedMs;
  // The callback mutates this value; a local assertion avoids TS's closure-narrowing limitation.
  const entry = first80 as { ageMs: number; priceUsd: number; printIndex: number } | null;
  const from80 = entry ? { startMs: entry.ageMs, endMs, initialPriceUsd: entry.priceUsd,
    prints: prints.slice(entry.printIndex + 1) } : null;
  return {
    seed, index, tokenId: meta.id, fate: meta.fate, stillborn, startUtc: date.toISOString(),
    first80Sec: entry ? entry.ageMs / 1000 : null,
    migratedAtSec: migratedAtMs === null ? null : migratedAtMs / 1000,
    observationEndSec: endMs / 1000,
    from80EndReason: from80 ? migratedAtMs === null ? 'horizon' : 'migration' : null,
    returnedBelow80,
    preMigration: measurePath({ startMs: 0, endMs, initialPriceUsd, prints }),
    from80: from80 ? measurePath(from80) : null,
    episodes: episodes.map(({ group, ...path }) => ({ group, startSec: path.startMs / 1000,
      endSec: path.endMs / 1000, metrics: measurePath(path) })),
  };
}

export function runMarketBehaviorBaseline(config: BaselineConfig) {
  if (!config.seeds.length || new Set(config.seeds).size !== config.seeds.length
    || config.seeds.some(seed => !seed.trim()) || !Number.isFinite(Date.parse(config.startUtc))
    || !Number.isSafeInteger(config.tokensPerSeed) || config.tokensPerSeed <= 0
    || !Number.isSafeInteger(config.horizonSec) || config.horizonSec <= 0
    || config.tickMs !== 200 || !config.startHoursUtc.length
    || config.startHoursUtc.some(hour => !Number.isInteger(hour) || hour < 0 || hour > 23)) {
    throw new Error('Invalid baseline configuration (tickMs must be 200)');
  }
  const originalNow = Date.now;
  let now = Date.parse(config.startUtc);
  Date.now = () => now;
  try {
    const tokens = config.seeds.flatMap(seed => {
      const rng = new RNG(seed);
      return Array.from({ length: config.tokensPerSeed }, (_, index) =>
        runToken(seed, index, rng, config, ms => { now = ms; }));
    });
    const migrations = tokens.filter(row => row.migratedAtSec !== null);
    const entrants = tokens.filter(row => row.from80 !== null);
    return { tokens, summary: {
      tokens: tokens.length, migrated: migrations.length, migrationRate: migrations.length / tokens.length,
      timeToMigrationSec: distribution(migrations.map(row => row.migratedAtSec!)),
      reached80: entrants.length, returnedBelow80: entrants.filter(row => row.returnedBelow80).length,
      timeToFirst80Sec: distribution(entrants.map(row => row.first80Sec!)),
      from80CensoredAtHorizon: entrants.filter(row => row.migratedAtSec === null).length,
      timeFrom80ToMigrationSec: distribution(entrants.filter(row => row.migratedAtSec !== null)
        .map(row => row.migratedAtSec! - row.first80Sec!)),
      preMigration: summarizePaths(tokens.map(row => row.preMigration)),
      from80: summarizePaths(entrants.map(row => row.from80!)),
      groups: Object.fromEntries(groups.map(group => {
        const episodes = tokens.flatMap(token => token.episodes.filter(row => row.group === group));
        return [group, { tokens: tokens.filter(token => token.episodes.some(row => row.group === group)).length,
          ...summarizePaths(episodes.map(row => row.metrics)) }];
      })),
    } };
  } finally {
    Date.now = originalNow;
  }
}
