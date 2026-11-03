import type { Candle } from './types';

type PushTickResult =
  | { mode: 'new' | 'update'; candle: Candle }
  | { mode: 'rejected'; reason: 'late' };

export class CandleAggregator {
  private tfSec: number;
  private candles: Candle[] = [];
  private maxLen = 3000;
  private lastAcceptedTimestampMs: number | null = null;

  constructor(tfSec: number) {
    this.tfSec = tfSec;
  }

  reset() {
    this.candles = [];
    this.lastAcceptedTimestampMs = null;
  }

  private pushCandle(c: Candle) {
    this.candles.push(c);
    if (this.candles.length > this.maxLen) {
      this.candles.splice(0, this.candles.length - this.maxLen);
    }
  }

  pushTick(tMs: number, price: number, vol: number): PushTickResult {
    if (this.lastAcceptedTimestampMs !== null && tMs < this.lastAcceptedTimestampMs) {
      return { mode: 'rejected', reason: 'late' };
    }
    this.lastAcceptedTimestampMs = tMs;
    const tSec = Math.floor(tMs / 1000);
    const bucket = Math.floor(tSec / this.tfSec) * this.tfSec;

    const last = this.candles[this.candles.length - 1];
    if (!last) {
      const c: Candle = { time: bucket, open: price, high: price, low: price, close: price, volume: vol };
      this.pushCandle(c);
      return { mode: 'new', candle: c };
    } else if (bucket > last.time) {
      // Sparse-candle contract: if no trade happened in skipped buckets, do not synthesize flat candles.
      // The next candle appears only when a real trade hits a later bucket.
      const prevClose = last.close;
      const c: Candle = { time: bucket, open: prevClose, high: price, low: price, close: price, volume: vol };
      c.high = Math.max(c.open, c.high, c.close);
      c.low = Math.min(c.open, c.low, c.close);
      this.pushCandle(c);
      return { mode: 'new', candle: c };
    } else {
      last.high = Math.max(last.high, price);
      last.low = Math.min(last.low, price);
      last.close = price;
      last.volume += vol;
      return { mode: 'update', candle: last };
    }
  }

  getSeries(): Candle[] {
    return this.candles.slice();
  }
}
