import type { Candle } from '../engine/types';

export type OhlcObservation = { tMs: number; price: number; volume: number };

// Batch oracle for the documented contract, independent of CandleAggregator:
// admission in arrival order, stable equal times, sparse buckets, continuity OPEN.
export function projectOhlc(rows: readonly OhlcObservation[], tfSec: number): Candle[] {
  let watermark = -Infinity;
  const buckets = new Map<number, OhlcObservation[]>();
  for (const row of rows) {
    if (row.tMs < watermark) continue;
    watermark = row.tMs;
    const time = Math.floor(row.tMs / (tfSec * 1000)) * tfSec;
    const bucket = buckets.get(time) ?? [];
    bucket.push(row);
    buckets.set(time, bucket);
  }
  const result: Candle[] = [];
  for (const [time, bucket] of buckets) {
    const open = result.length ? result[result.length - 1]!.close : bucket[0]!.price;
    result.push({ time, open, close: bucket[bucket.length - 1]!.price,
      high: Math.max(open, ...bucket.map(row => row.price)),
      low: Math.min(open, ...bucket.map(row => row.price)),
      volume: bucket.reduce((sum, row) => sum + row.volume, 0) });
  }
  return result.slice(-3000);
}
