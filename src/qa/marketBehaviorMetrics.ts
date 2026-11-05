export type MarketPrint = { ageMs: number; priceUsd: number; quoteUsd: number; side: 'BUY' | 'SELL' };
export type MarketPath = {
  startMs: number;
  endMs: number;
  initialPriceUsd: number;
  prints: MarketPrint[];
};

export function distribution(values: number[]) {
  const sorted = values.slice().sort((a, b) => a - b);
  const quantile = (p: number): number | null => {
    if (!sorted.length) return null;
    const index = (sorted.length - 1) * p;
    const lo = Math.floor(index);
    return sorted[lo]! + (sorted[Math.ceil(index)]! - sorted[lo]!) * (index - lo);
  };
  return { n: values.length, p10: quantile(0.1), p50: quantile(0.5), p90: quantile(0.9),
    max: sorted.length ? sorted[sorted.length - 1]! : null };
}

export function measurePath(path: MarketPath) {
  if (path.endMs < path.startMs || !Number.isFinite(path.initialPriceUsd) || path.initialPriceUsd <= 0) {
    throw new Error('Invalid path bounds or initial price');
  }
  let peak = path.initialPriceUsd;
  let last = peak;
  let maxDrawdown = 0;
  let buys = 0;
  let buyQuoteUsd = 0;
  let sellQuoteUsd = 0;
  let runSign = 0;
  let runStart = last;
  let changes = 0;
  let moves = 0;
  const impulsesPct: number[] = [];
  const correctionsPct: number[] = [];
  const activeBuckets = new Set<number>();
  let previousTime = path.startMs;
  const closeRun = () => {
    if (!runSign) return;
    (runSign > 0 ? impulsesPct : correctionsPct).push(Math.abs(last / runStart - 1) * 100);
  };
  for (const print of path.prints) {
    if (print.ageMs < previousTime || print.ageMs > path.endMs || !Number.isFinite(print.ageMs)
      || !Number.isFinite(print.priceUsd) || print.priceUsd <= 0 || !Number.isFinite(print.quoteUsd) || print.quoteUsd < 0) {
      throw new Error('Print outside measured path or invalid price');
    }
    previousTime = print.ageMs;
    if (print.side === 'BUY') { buys++; buyQuoteUsd += print.quoteUsd; }
    else sellQuoteUsd += print.quoteUsd;
    activeBuckets.add(Math.ceil(print.ageMs / 1000) - 1);
    const sign = Math.sign(print.priceUsd - last);
    if (sign) {
      moves++;
      if (sign !== runSign) {
        closeRun();
        if (runSign) changes++;
        runStart = last;
        runSign = sign;
      }
    }
    last = print.priceUsd;
    peak = Math.max(peak, last);
    maxDrawdown = Math.max(maxDrawdown, 1 - last / peak);
  }
  closeRun();
  const durationSec = (path.endMs - path.startMs) / 1000;
  // Right-closed age-second bins: (s, s+1]. Edge bins can be partial.
  const exposedBuckets = new Set<number>();
  for (let second = Math.floor(path.startMs / 1000); second < Math.ceil(path.endMs / 1000); second++) exposedBuckets.add(second);
  for (const bucket of activeBuckets) exposedBuckets.add(bucket);
  const exposedSecondBins = exposedBuckets.size;
  const trades = path.prints.length;
  const quote = buyQuoteUsd + sellQuoteUsd;
  return {
    durationSec, trades, buys, sells: trades - buys, buyQuoteUsd, sellQuoteUsd,
    buyCountShare: trades ? buys / trades : null,
    sellCountShare: trades ? (trades - buys) / trades : null,
    buyVolumeShare: quote ? buyQuoteUsd / quote : null,
    sellVolumeShare: quote ? sellQuoteUsd / quote : null,
    tradesPerSec: durationSec ? trades / durationSec : null,
    exposedSecondBins, emptySecondBins: exposedSecondBins - activeBuckets.size,
    emptySecondShare: exposedSecondBins ? (exposedSecondBins - activeBuckets.size) / exposedSecondBins : null,
    maxDrawdownPct: maxDrawdown * 100, returnPct: (last / path.initialPriceUsd - 1) * 100,
    directionChanges: changes, nonzeroMoves: moves, impulsesPct, correctionsPct,
  };
}

export type PathMetrics = ReturnType<typeof measurePath>;

export function summarizePaths(rows: PathMetrics[]) {
  const sum = (key: 'trades' | 'buys' | 'sells' | 'buyQuoteUsd' | 'sellQuoteUsd' | 'durationSec' | 'exposedSecondBins' | 'emptySecondBins') =>
    rows.reduce((total, row) => total + row[key], 0);
  const trades = sum('trades');
  const buys = sum('buys');
  const buyQuoteUsd = sum('buyQuoteUsd');
  const sellQuoteUsd = sum('sellQuoteUsd');
  const quote = buyQuoteUsd + sellQuoteUsd;
  const durationSec = sum('durationSec');
  const exposedSecondBins = sum('exposedSecondBins');
  const emptySecondBins = sum('emptySecondBins');
  return { paths: rows.length, durationSec, trades, buys, sells: sum('sells'), buyQuoteUsd, sellQuoteUsd,
    buyCountShare: trades ? buys / trades : null, sellCountShare: trades ? 1 - buys / trades : null,
    buyVolumeShare: quote ? buyQuoteUsd / quote : null, sellVolumeShare: quote ? sellQuoteUsd / quote : null,
    tradesPerSec: durationSec ? trades / durationSec : null, exposedSecondBins, emptySecondBins,
    emptySecondShare: exposedSecondBins ? emptySecondBins / exposedSecondBins : null,
    maxDrawdownPct: distribution(rows.map(row => row.maxDrawdownPct)),
    durationSecDistribution: distribution(rows.map(row => row.durationSec)),
    returnPct: distribution(rows.map(row => row.returnPct)),
    impulsePct: distribution(rows.flatMap(row => row.impulsesPct)),
    correctionPct: distribution(rows.flatMap(row => row.correctionsPct)),
    directionChanges: distribution(rows.map(row => row.directionChanges)),
  };
}
