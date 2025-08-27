import type { Candle } from './types';

export class CandleAggregator {
  private tfSec: number;
  private candles: Candle[] = [];
  private maxLen = 3000;

  constructor(tfSec: number) {
    this.tfSec = tfSec;
  }

  reset() {
    this.candles = [];
  }

  pushTick(tMs: number, price: number, vol: number): { mode: 'new' | 'update'; candle: Candle } {
    const tSec = Math.floor(tMs / 1000);
    const bucket = Math.floor(tSec / this.tfSec) * this.tfSec;

    const last = this.candles[this.candles.length - 1];
    if (!last || last.time !== bucket) {
      const c: Candle = { time: bucket, open: price, high: price, low: price, close: price, volume: vol };
      this.candles.push(c);
      if (this.candles.length > this.maxLen) this.candles.splice(0, this.candles.length - this.maxLen);
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
