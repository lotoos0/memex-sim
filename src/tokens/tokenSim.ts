import { RNG } from '../engine/rng';
import { PriceEngine } from '../engine/price';
import EventEngine from '../engine/events';
import { CandleAggregator } from '../engine/aggregator';
import type { EnginesConfig } from '../engine/types';
import type { TokenMeta, TokenRuntime, TokenPhase } from './types';
import {
  SUPPLY, MIGRATION_THRESHOLD_USD, MCAP_FLOOR_USD, MCAP_CAP_USD, SIM_TIME_MULTIPLIER,
} from './types';
import { getInitialRegime } from './generator';
import baseCfg from '../../config/config.json';

interface StatBucket {
  simMs: number;
  volUsd: number;
  isBuy: boolean;
}

export class TokenSim {
  readonly meta: TokenMeta;

  // Engine instances
  private rng: RNG;
  private priceEngine: PriceEngine;
  private eventEngine: EventEngine;

  // Candle aggregators for chart TFs (real-time based)
  private aggr1s: CandleAggregator;
  private aggr15s: CandleAggregator;
  private aggr30s: CandleAggregator;
  private aggr1m: CandleAggregator;

  // Time tracking
  private simTimeMs = 0;
  private spawnRealMs: number;        // real wall-clock time at spawn
  private fateTimeoutSimMs: number;

  // Price state
  private lastPriceUsd: number;
  private priceAtSpawn: number;
  private phase: TokenPhase;
  private ruggedAtSimMs: number | null = null;

  // Rolling 5-min stats window (in simMs)
  private statWindow: StatBucket[] = [];
  private readonly WINDOW_SIM_MS = 5 * 60_000;

  constructor(meta: TokenMeta, startMcapUsd: number, fateTimeoutSimMs: number) {
    this.meta = meta;
    this.fateTimeoutSimMs = fateTimeoutSimMs;
    this.spawnRealMs = Date.now();

    const startPriceUsd = startMcapUsd / SUPPLY;

    // Token-specific deterministic RNG (seed = token id string)
    this.rng = new RNG(meta.id);

    // Build engine config from base, with token-specific start price
    const cfg: EnginesConfig = {
      ...(baseCfg as unknown as EnginesConfig),
      startPrice: startPriceUsd,
      initial: {
        ...(baseCfg as any).initial,
        price: startPriceUsd,
        supply: SUPPLY,
      },
    };

    this.priceEngine = new PriceEngine(cfg, this.rng);
    this.eventEngine = new EventEngine(cfg, this.rng, new EventTarget());

    // Set initial regime based on fate
    this.priceEngine.setRegime(getInitialRegime(meta.fate));

    // Candle aggregators (tf in real seconds)
    this.aggr1s = new CandleAggregator(1);
    this.aggr15s = new CandleAggregator(15);
    this.aggr30s = new CandleAggregator(30);
    this.aggr1m = new CandleAggregator(60);

    this.lastPriceUsd = startPriceUsd;
    this.priceAtSpawn = startPriceUsd;
    this.phase = 'NEW';
  }

  tick(realDtSec: number): void {
    if (this.phase === 'RUGGED' || this.phase === 'DEAD') return;

    const simDtSec = realDtSec * SIM_TIME_MULTIPLIER;
    this.simTimeMs += simDtSec * 1000;

    // Advance engines
    this.eventEngine.setRegime(this.priceEngine.getRegime());
    const eff = this.eventEngine.onTick(simDtSec, this.simTimeMs);
    const { price: rawPrice, volume } = this.priceEngine.nextTick(simDtSec, eff);

    // Clamp price to floor/cap
    const clampedMcap = Math.max(MCAP_FLOOR_USD, Math.min(MCAP_CAP_USD, rawPrice * SUPPLY));
    const priceUsd = clampedMcap / SUPPLY;
    this.lastPriceUsd = priceUsd;

    // Real timestamp for chart candles.
    const candleTsMs = Date.now();

    // Push to all aggregators
    this.aggr1s.pushTick(candleTsMs, priceUsd, volume);
    this.aggr15s.pushTick(candleTsMs, priceUsd, volume);
    this.aggr30s.pushTick(candleTsMs, priceUsd, volume);
    this.aggr1m.pushTick(candleTsMs, priceUsd, volume);

    // Rolling 5m stats
    const isBuy = this.rng.next() < 0.54;
    this.statWindow.push({ simMs: this.simTimeMs, volUsd: volume, isBuy });
    const cutoff = this.simTimeMs - this.WINDOW_SIM_MS;
    let i = 0;
    while (i < this.statWindow.length && this.statWindow[i]!.simMs < cutoff) i++;
    if (i > 0) this.statWindow.splice(0, i);

    this.updatePhase();
  }

  private updatePhase(): void {
    if (this.phase === 'RUGGED' || this.phase === 'DEAD' || this.phase === 'MIGRATED') return;

    const mcap = this.lastPriceUsd * SUPPLY;

    if (mcap >= MIGRATION_THRESHOLD_USD) {
      this.phase = 'MIGRATED';
      return;
    }

    this.phase = mcap >= 30_000 ? 'FINAL' : 'NEW';

    if (this.simTimeMs >= this.fateTimeoutSimMs) {
      this.phase = 'RUGGED';
      this.ruggedAtSimMs = this.simTimeMs;
      this.priceEngine.setRegime('rugRisk');
    }
  }

  getRuntime(): TokenRuntime {
    const mcap = this.lastPriceUsd * SUPPLY;
    const vol5m = this.statWindow.reduce((s, w) => s + w.volUsd, 0);
    const buys5m = this.statWindow.filter(w => w.isBuy).length;
    const sells5m = this.statWindow.filter(w => !w.isBuy).length;
    const changePct = this.priceAtSpawn > 0
      ? ((this.lastPriceUsd - this.priceAtSpawn) / this.priceAtSpawn) * 100
      : 0;

    return {
      phase: this.phase,
      simTimeMs: this.simTimeMs,
      lastPriceUsd: this.lastPriceUsd,
      mcapUsd: mcap,
      liquidityUsd: mcap * 0.15,
      bondingCurvePct: Math.min(100, (mcap / MIGRATION_THRESHOLD_USD) * 100),
      vol5mUsd: vol5m,
      buys5m,
      sells5m,
      changePct,
      priceAtSpawn: this.priceAtSpawn,
      ruggedAtSimMs: this.ruggedAtSimMs,
    };
  }

  /** Returns candle series for the given timeframe (in real seconds for UI) */
  getCandles(tfSec: number) {
    if (tfSec <= 1) return this.aggr1s.getSeries();
    if (tfSec <= 15) return this.aggr15s.getSeries();
    if (tfSec <= 30) return this.aggr30s.getSeries();
    return this.aggr1m.getSeries();
  }

  getPhase(): TokenPhase { return this.phase; }
  getSimTimeMs(): number { return this.simTimeMs; }
  getSpawnRealMs(): number { return this.spawnRealMs; }
  getLastPriceUsd(): number { return this.lastPriceUsd; }
}