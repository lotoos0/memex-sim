import type { runMarketBehaviorBaseline } from './marketBehaviorBaseline';
import { distribution } from './marketBehaviorMetrics';

type Result = ReturnType<typeof runMarketBehaviorBaseline>;
type Token = Result['tokens'][number];
type Group = Token['episodes'][number]['group'];
const groups: Group[] = ['80_90_ready', '80_90_not_ready', '90_100_ready', '90_100_not_ready'];

function exposure(token: Token, group: string) {
  const rows = token.episodes.filter(row => row.group.startsWith(group));
  return { seconds: rows.reduce((sum, row) => sum + row.metrics.durationSec, 0),
    trades: rows.reduce((sum, row) => sum + row.metrics.trades, 0) };
}

function cohort(tokens: Token[]) {
  const entrants = tokens.filter(token => token.first80Sec !== null);
  const migrated = tokens.filter(token => token.migratedAtSec !== null);
  const returned = entrants.filter(token => token.returnedBelow80);
  return { tokens: tokens.length, reached80: entrants.length, migrated: migrated.length,
    migrationRate: tokens.length ? migrated.length / tokens.length : null,
    reached80WithoutMigration: entrants.filter(token => token.migratedAtSec === null).length,
    returnedBelow80: returned.length,
    returnedBelow80ShareOfInitial: tokens.length ? returned.length / tokens.length : null,
    returnedBelow80ShareOfEntrants: entrants.length ? returned.length / entrants.length : null,
    timeToMigrationSec: distribution(migrated.map(token => token.migratedAtSec!)),
    timeSince80Sec: distribution(entrants.map(token => token.from80!.durationSec)),
    bands: Object.fromEntries([...groups, '80_90', '90_100'].map(group => {
      const all = tokens.map(token => exposure(token, group));
      const occupied = all.filter(row => row.seconds > 0);
      return [group, { tokens: occupied.length,
        allTokenSeconds: distribution(all.map(row => row.seconds)),
        allTokenTrades: distribution(all.map(row => row.trades)),
        occupiedTokenSeconds: distribution(occupied.map(row => row.seconds)),
        occupiedTokenTrades: distribution(occupied.map(row => row.trades)) }];
    })),
  };
}

function deltas(pairs: Array<{ a: Token; b: Token }>) {
  const metric = (get: (token: Token) => number | null) => {
    const values = pairs.flatMap(({ a, b }) => {
      const x = get(a), y = get(b);
      return x === null || y === null ? [] : [y - x];
    });
    return { ...distribution(values), decreased: values.filter(v => v < 0).length,
      unchanged: values.filter(v => v === 0).length, increased: values.filter(v => v > 0).length };
  };
  return {
    tokens: pairs.length,
    migrationOutcomes: {
      both: pairs.filter(({ a, b }) => a.migratedAtSec !== null && b.migratedAtSec !== null).length,
      onlyA: pairs.filter(({ a, b }) => a.migratedAtSec !== null && b.migratedAtSec === null).length,
      onlyB: pairs.filter(({ a, b }) => a.migratedAtSec === null && b.migratedAtSec !== null).length,
      neither: pairs.filter(({ a, b }) => a.migratedAtSec === null && b.migratedAtSec === null).length,
    },
    preMigrationDrawdownPp: metric(token => token.preMigration.maxDrawdownPct),
    from80DrawdownPp: metric(token => token.from80?.maxDrawdownPct ?? null),
    from80ReturnPp: metric(token => token.from80?.returnPct ?? null),
    from80DirectionChanges: metric(token => token.from80?.directionChanges ?? null),
    from80BuyCountShare: metric(token => token.from80?.buyCountShare ?? null),
    from80BuyVolumeShare: metric(token => token.from80?.buyVolumeShare ?? null),
    from80ImpulseMedianPp: metric(token => token.from80 ? distribution(token.from80.impulsesPct).p50 : null),
    from80CorrectionMedianPp: metric(token => token.from80 ? distribution(token.from80.correctionsPct).p50 : null),
    from80DurationSec: metric(token => token.from80?.durationSec ?? null),
    // Conditional on migration in BOTH variants; never impute the horizon as a migration time.
    migrationTimeSec: metric(token => token.migratedAtSec),
    returnedBelow80Difference: metric(token => token.returnedBelow80 ? 1 : 0),
    bandSeconds: Object.fromEntries(groups.map(group => [group, metric(token => exposure(token, group).seconds)])),
    bandTrades: Object.fromEntries(groups.map(group => [group, metric(token => exposure(token, group).trades)])),
  };
}

export function compareFinalStretchBias(a: Result, b: Result) {
  if (a.tokens.length !== b.tokens.length) throw new Error('Different cohort sizes');
  const byId = new Map(b.tokens.map(token => [token.tokenId, token]));
  if (byId.size !== b.tokens.length || new Set(a.tokens.map(token => token.tokenId)).size !== a.tokens.length) {
    throw new Error('Duplicate token ids');
  }
  const pairs = a.tokens.map(token => {
    const other = byId.get(token.tokenId);
    if (!other || token.seed !== other.seed || token.index !== other.index || token.fate !== other.fate
      || token.stillborn !== other.stillborn || token.startUtc !== other.startUtc || token.first80Sec !== other.first80Sec) {
      throw new Error(`Unpaired token or divergence before first 80%: ${token.tokenId}`);
    }
    return { a: token, b: other };
  });
  const aReady = pairs.filter(({ a: token }) => token.episodes.some(row => row.group === '90_100_ready'));
  const entrants = pairs.filter(({ a: token }) => token.first80Sec !== null);
  return {
    cohortA: cohort(a.tokens), cohortB: cohort(b.tokens),
    identicalTokenRecords: pairs.filter(pair => JSON.stringify(pair.a) === JSON.stringify(pair.b)).length,
    pairedInitial: deltas(pairs), pairedFirst80: deltas(entrants), pairedBaseline90Ready: deltas(aReady),
    perSeed: [...new Set(a.tokens.map(token => token.seed))].map(seed => ({ seed,
      a: cohort(a.tokens.filter(token => token.seed === seed)), b: cohort(b.tokens.filter(token => token.seed === seed)) })),
    // Retain all launch outcomes, including the unaffected majority and non-migrants.
    tokenPairs: pairs.map(({ a: x, b: y }) => ({ tokenId: x.tokenId, seed: x.seed, index: x.index,
      first80Sec: x.first80Sec, baseline90Ready: aReady.some(pair => pair.a.tokenId === x.tokenId),
      a: { migratedAtSec: x.migratedAtSec, returnedBelow80: x.returnedBelow80,
        from80DrawdownPct: x.from80?.maxDrawdownPct ?? null, from80ReturnPct: x.from80?.returnPct ?? null },
      b: { migratedAtSec: y.migratedAtSec, returnedBelow80: y.returnedBelow80,
        from80DrawdownPct: y.from80?.maxDrawdownPct ?? null, from80ReturnPct: y.from80?.returnPct ?? null } })),
  };
}
