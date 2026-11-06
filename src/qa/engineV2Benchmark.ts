import { SOL, TOKEN } from '../engineV2/contracts';
import { DEFAULT_WORLD, World } from '../engineV2/world';

const asSol = (atoms: bigint) => Number(atoms) / Number(SOL);
const asTokens = (atoms: bigint) => Number(atoms) / Number(TOKEN);
const genesisSpot = 30 / 1_073_000_000;
const followup = 1_800_000;
const census = (value: number) => value < 800_000 ? 0 : value < 900_000 ? 1 : 2;
const percentile = (sorted: number[], p: number) => {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * p;
  return sorted[Math.floor(index)] + (sorted[Math.ceil(index)] - sorted[Math.floor(index)]) * (index % 1);
};
const distribution = (values: number[]) => {
  const sorted = values.slice().sort((a, b) => a - b);
  return { n: values.length, p50: percentile(sorted, 0.5), p90: percentile(sorted, 0.9), p99: percentile(sorted, 0.99) };
};

function emptyBand() {
  return { bins: 0, empty: 0, trades: 0, bars: 0, single: 0, wicks: 0, eventTrades: 0, eventDurationMs: 0, buyQuote: 0, sellQuote: 0 };
}

type Print = { ageMs: number; priceSol: number; progress: number; preProgress: number; quoteSol: number; side: 'BUY' | 'SELL' };
type Path = { tokenId: string; source: 'baseline' | 'social'; launchAt: number; rows: Print[]; migrationAge: number | null };

function pathStats(paths: Path[]) {
  const bands = [emptyBand(), emptyBand(), emptyBand()];
  const active = paths.filter(path => path.rows.length > 0 && !(path.migrationAge !== null && path.migrationAge <= 1000));
  const counts: number[] = [];
  const turnover: number[] = [];
  const sizes: number[] = [];
  const streaks: number[] = [];
  const completionTimes: number[] = [];
  const recycling: number[] = [];
  const drawdown: number[] = [];
  const reversals: number[] = [];
  const from80Drawdown: number[] = [];
  const from80Reversals: number[] = [];
  const ageActivity = [0, 0, 0, 0];
  let first80 = 0;
  let retreats = 0;
  let buySol = 0;
  let sellSol = 0;

  const moves = (rows: Print[], opening: number) => {
    let peak = opening, previous = opening, direction = 0, flips = 0, mdd = 0;
    for (const row of rows) {
      peak = Math.max(peak, row.priceSol);
      mdd = Math.max(mdd, 1 - row.priceSol / peak);
      const sign = Math.sign(row.priceSol - previous);
      if (sign && direction && sign !== direction) flips++;
      direction = sign || direction;
      previous = row.priceSol;
    }
    return [mdd * 100, flips];
  };

  for (const path of active) {
    const rows = path.rows;
    const end = path.migrationAge ?? followup;
    const currentBands = new Map<number, Print[]>();
    let gross = 0, signed = 0, previousAge = 0, progress = 0, streak = 0;
    let previousSide: Print['side'] | null = null;
    let first80Index = -1;
    for (const [index, row] of rows.entries()) {
      const side = row.side;
      if (previousSide !== side && streak) { streaks.push(streak); streak = 0; }
      streak++;
      previousSide = side;
      sizes.push(row.quoteSol);
      const b = bands[census(row.preProgress)];
      b.eventDurationMs += row.ageMs - previousAge;
      b.eventTrades++;
      if (side === 'BUY') { b.buyQuote += row.quoteSol; buySol += row.quoteSol; }
      else { b.sellQuote += row.quoteSol; sellSol += row.quoteSol; }
      gross += row.quoteSol;
      signed += side === 'BUY' ? row.quoteSol : -row.quoteSol;
      previousAge = row.ageMs;
      progress = row.progress;
      if (first80Index < 0 && progress >= 800_000) {
        first80Index = index;
        if (signed > 0) recycling.push(gross / signed);
      }
      const second = Math.floor(row.ageMs / 1000);
      const bucket = currentBands.get(second) ?? [];
      bucket.push(row);
      currentBands.set(second, bucket);
      ageActivity[row.ageMs < 120_000 ? 0 : row.ageMs < 600_000 ? 1 : row.ageMs < 1_200_000 ? 2 : 3]++;
    }
    if (progress < 1_000_000) bands[census(progress)].eventDurationMs += end - previousAge;
    streaks.push(streak);
    if (path.migrationAge !== null) completionTimes.push(path.migrationAge / 1000);
    counts.push(rows.length);
    turnover.push(gross);
    const [mdd, flips] = moves(rows, genesisSpot);
    drawdown.push(mdd);
    reversals.push(flips);
    if (first80Index >= 0) {
      first80++;
      const cross = rows[first80Index];
      if (rows.slice(first80Index + 1).some(row => row.progress < 800_000)) retreats++;
      if (cross.ageMs <= 1_680_000) {
        const [dd, n] = moves(rows.slice(first80Index + 1).filter(row => row.ageMs <= cross.ageMs + 120_000), cross.priceSol);
        from80Drawdown.push(dd);
        from80Reversals.push(n);
      }
    }

    let previousSec = -1;
    let close = genesisSpot;
    let startProgress = 0;
    for (const [sec, prints] of currentBands) {
      const b = bands[census(startProgress)];
      const gap = sec - previousSec - 1;
      b.bins += gap + 1;
      b.empty += gap;
      b.bars++;
      b.trades += prints.length;
      if (prints.length === 1) b.single++;
      const last = prints[prints.length - 1];
      if (prints.some(row => row.priceSol > Math.max(close, last.priceSol) * (1 + 1e-10)
        || row.priceSol < Math.min(close, last.priceSol) * (1 - 1e-10))) b.wicks++;
      previousSec = sec;
      close = last.priceSol;
      startProgress = last.progress;
    }
    const tail = Math.max(0, Math.ceil(end / 1000) - previousSec - 1);
    if (startProgress < 1_000_000) {
      bands[census(startProgress)].bins += tail;
      bands[census(startProgress)].empty += tail;
    }
  }

  const sorted = turnover.sort((a, b) => a - b);
  const total = sorted.reduce((a, b) => a + b, 0);
  const concentration = (portion: number) => total
    ? sorted.slice(-Math.ceil(sorted.length * portion)).reduce((a, b) => a + b, 0) / total : null;
  return {
    births: paths.length, quiet: paths.filter(path => !path.rows.length).length, activeStandardNoninstant: active.length,
    first80, retreats, migrations: completionTimes.length, migrationSeconds: distribution(completionTimes),
    preMigrationFills: counts.reduce((sum, value) => sum + value, 0), counts: distribution(counts), tradeSizeSol: distribution(sizes),
    streaks: distribution(streaks), fullMddPct: distribution(drawdown), fullReversals: distribution(reversals),
    first80Mdd120Pct: distribution(from80Drawdown), first80Reversals120: distribution(from80Reversals),
    quoteSol: { grossTurnover: buySol + sellSol, signedReserveFlow: buySol - sellSol },
    recyclingToFirst80: distribution(recycling), ageActivity,
    concentration: {
      top1: concentration(0.01), top5: concentration(0.05), top10: concentration(0.1),
      gini: total ? 2 * sorted.reduce((sum, amount, i) => sum + amount * (i + 1), 0) / (sorted.length * total)
        - (sorted.length + 1) / sorted.length : null,
    },
    bands: Object.fromEntries(bands.map((band, index) => [['0_80', '80_90', '90_100'][index], {
      ...band,
      tradesPerExposedBin: band.bins ? band.trades / band.bins : null,
      emptyShare: band.bins ? band.empty / band.bins : null,
      singleShare: band.bars ? band.single / band.bars : null,
      wickShare: band.bars ? band.wicks / band.bars : null,
      tradesPerExposureSec: band.eventDurationMs ? band.eventTrades * 1000 / band.eventDurationMs : null,
    }])),
  };
}

export function measure(seed: string, variant: 'off' | 'on' | 'fixed-launches', write: (row: object) => void,
  options: { sellFeeReserve?: true; cohortRotation?: true; streamFacts?: true } = {}) {
  const { sellFeeReserve, cohortRotation, streamFacts } = options;
  const world = new World({
    ...DEFAULT_WORLD, seed, social: variant !== 'off', socialLaunches: variant === 'on',
    ...(sellFeeReserve ? { sellFeeReserve } : {}),
    ...(cohortRotation ? { cohortRotation } : {}),
  });
  const markets: Record<string, Path> = {};
  let poolFills = 0;
  let decisions = 0;
  let facts = 0;
  function collectFacts() {
    facts += world.kernel.log.length;
    for (const fact of world.kernel.log) {
      if (fact.kind === 'AgentDecided') decisions++;
      if (fact.kind === 'TokenLaunched') {
        const { market, link } = fact.payload;
        markets[market.tokenId] = {
          tokenId: market.tokenId, source: link ? 'social' : 'baseline', launchAt: market.launchedAt, rows: [], migrationAge: null,
        };
        write({ kind: 'birth', tokenId: market.tokenId, launchAt: market.launchedAt, source: link ? 'social' : 'baseline' });
      }
      if (fact.kind === 'MarketMigrated') {
        const path = markets[fact.payload.tokenId];
        const age = fact.key.at - path.launchAt;
        if (age <= followup) path.migrationAge = age;
      }
      if (fact.kind === 'TradeExecuted') {
        const { fill, before, after, progressBefore, progressAfter } = fact.payload;
        const path = markets[fill.tokenId];
        const ageMs = fact.key.at - path.launchAt;
        const priceSol = asSol(fill.spotAfter.quoteAtoms) / asTokens(fill.spotAfter.tokenAtoms);
        write({ kind: 'fill', id: fact.id, globalSeq: fact.key.seq, ...fill, before, after, progressBefore, progressAfter,
          priceSol, completion: fill.marketEpoch === 0 && progressAfter === 1_000_000,
          reservationId: world.state.orders[fill.orderId].reservationId });
        if (fill.marketEpoch > 0) poolFills++;
        else if (ageMs <= followup) path.rows.push({
          ageMs, priceSol, progress: progressAfter, preProgress: progressBefore,
          quoteSol: asSol(fill.quoteAtomsExFee), side: fill.side,
        });
      }
      if (fact.kind === 'AdmissionRejected') write({ kind: 'admission-rejected', ...fact.payload, at: fact.key.at });
      if (fact.kind === 'OrderChanged' && fact.payload.order.status === 'REJECTED') {
        write({ kind: 'attempt-rejected', ...fact.payload.order, at: fact.key.at });
      }
    }
  }
  const started = performance.now();
  const durations = [];
  let maxQueue = 0;
  for (let now = 0; now <= 5_400_000; now += 1000) {
    const start = performance.now();
    world.advanceTo(now);
    durations.push(performance.now() - start);
    if (now % 30_000 === 0) maxQueue = Math.max(maxQueue, world.kernel.snapshot().pending.length);
    if (streamFacts && now % 30_000 === 0) {
      collectFacts();
      world.pruneRecordedHistory(world.kernel.log);
    }
  }
  const advanceMs = streamFacts ? durations.reduce((sum, duration) => sum + duration, 0) : performance.now() - started;
  world.ledger.assertConservation();
  if (!streamFacts) collectFacts();
  const paths = Object.values(markets);
  return {
    manifest: world.kernel.manifest, seed, variant, all: pathStats(paths), baseline: pathStats(paths.filter(path => path.source === 'baseline')),
    poolFills, decisions, facts, advanceMs, maxSampledQueue: maxQueue,
    advanceOneSecondMs: distribution(durations), factsPerWallSecond: facts * 1000 / advanceMs,
    simulatedMs: world.now,
    baselineSchedule: paths.filter(path => path.source === 'baseline').map(path => path.launchAt),
  };
}
