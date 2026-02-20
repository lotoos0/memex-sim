import { RNG } from '../engine/rng';
import { CandleAggregator } from '../engine/aggregator';
import type { TokenMeta, TokenRuntime, TokenPhase } from './types';
import {
  SUPPLY, MIGRATION_THRESHOLD_USD, MCAP_FLOOR_USD, MCAP_CAP_USD, SIM_TIME_MULTIPLIER,
} from './types';
import { stepMarket, type FlowRegime } from './marketModel';
import type { TokenChartEvent } from '../chart/tokenChartEvents';

interface StatBucket {
  simMs: number;
  volUsd: number;
  buys: number;
  sells: number;
}

type PhaseModel = {
  liquidityMul: number;
  lambdaMul: number;
  volMul: number;
  attentionDecayPerSec: number;
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export class TokenSim {
  readonly meta: TokenMeta;

  private rng: RNG;

  // Candle aggregators for chart TFs (real-time based)
  private aggr1s: CandleAggregator;
  private aggr15s: CandleAggregator;
  private aggr30s: CandleAggregator;
  private aggr1m: CandleAggregator;

  // Time tracking
  private simTimeMs = 0;
  private spawnRealMs: number;
  private lastTickRealMs: number;
  private fateTimeoutSimMs: number;

  // Price state
  private lastPriceUsd: number;
  private priceAtSpawn: number;
  private phase: TokenPhase;
  private ruggedAtSimMs: number | null = null;

  // Microstructure internals (not part of external contracts)
  private regime: FlowRegime = 'PAUSE';
  private regimeTtlSec = 0;
  private attention = 1;
  private baseLambda = 10;
  private baseLiquidityUsd = 25_000;
  private baseTradeSizeUsd = 350;
  private tradeSigma = 0.95;
  private impactK = 0.2;
  private baseVol = 0.04;
  private lastDevEventRealMs = 0;

  // Rolling 5-min stats window (in simMs)
  private statWindow: StatBucket[] = [];
  private readonly WINDOW_SIM_MS = 5 * 60_000;

  constructor(meta: TokenMeta, startMcapUsd: number, fateTimeoutSimMs: number) {
    this.meta = meta;
    this.fateTimeoutSimMs = fateTimeoutSimMs;
    this.spawnRealMs = Date.now();
    this.lastTickRealMs = this.spawnRealMs;

    const startPriceUsd = startMcapUsd / SUPPLY;
    this.rng = new RNG(meta.id);

    // Token-specific baseline params.
    this.baseLambda = 8 + this.rng.next() * 16;
    this.baseLiquidityUsd = startMcapUsd * (0.6 + this.rng.next() * 0.8);
    this.baseTradeSizeUsd = 120 + this.rng.next() * 680;
    this.tradeSigma = 0.75 + this.rng.next() * 0.45;
    this.impactK = 0.15 + this.rng.next() * 0.25;
    this.baseVol = 0.025 + this.rng.next() * 0.06;
    this.attention = 0.9 + this.rng.next() * 0.8;

    this.aggr1s = new CandleAggregator(1);
    this.aggr15s = new CandleAggregator(15);
    this.aggr30s = new CandleAggregator(30);
    this.aggr1m = new CandleAggregator(60);

    this.lastPriceUsd = startPriceUsd;
    this.priceAtSpawn = startPriceUsd;
    this.phase = 'NEW';
    this.rollRegime();
  }

  tick(fallbackRealDtSec: number): TokenChartEvent[] {
    if (this.phase === 'RUGGED' || this.phase === 'DEAD') return [];

    const nowMs = Date.now();
    const measuredDtSec = (nowMs - this.lastTickRealMs) / 1000;
    const realDtSec = clamp(
      Number.isFinite(measuredDtSec) && measuredDtSec > 0 ? measuredDtSec : fallbackRealDtSec,
      0.05,
      1.5
    );
    this.lastTickRealMs = nowMs;

    const simDtSec = realDtSec * SIM_TIME_MULTIPLIER;
    this.simTimeMs += simDtSec * 1000;

    this.advanceRegime(realDtSec);
    const phaseModel = this.getPhaseModel();
    this.attention = Math.max(0.12, this.attention * Math.exp(-phaseModel.attentionDecayPerSec * realDtSec));

    const regimeDriftPerSec = this.getRegimeDriftPerSec();
    const regimeBuyBias = this.getRegimeBuyBias();
    const regimeVolMul = this.getRegimeVolMul();
    const regimeLambdaMul = this.getRegimeLambdaMul();

    if (this.regime === 'IMPULSE') this.attention = Math.min(2.8, this.attention + 0.04 * realDtSec);
    if (this.regime === 'DUMP') this.attention = Math.min(2.8, this.attention + 0.02 * realDtSec);

    const liquidityUsd = this.baseLiquidityUsd * phaseModel.liquidityMul;
    const market = stepMarket(this.rng, {
      dtSec: realDtSec,
      priceUsd: this.lastPriceUsd,
      liquidityUsd,
      attention: this.attention,
      baseLambda: this.baseLambda * phaseModel.lambdaMul * regimeLambdaMul,
      baseTradeSizeUsd: this.baseTradeSizeUsd,
      tradeSigma: this.tradeSigma,
      driftPerSec: regimeDriftPerSec,
      volatilityPerSqrtSec: this.baseVol * phaseModel.volMul * regimeVolMul,
      buyBias: regimeBuyBias,
      impactK: this.impactK,
      devSignalChancePerSec: this.getDevSignalChancePerSec(),
      devBuyBias: regimeBuyBias,
    });

    // Clamp price to floor/cap.
    const clampedMcap = Math.max(MCAP_FLOOR_USD, Math.min(MCAP_CAP_USD, market.nextPriceUsd * SUPPLY));
    const priceUsd = clampedMcap / SUPPLY;
    this.lastPriceUsd = priceUsd;

    const candleTsMs = nowMs;
    this.aggr1s.pushTick(candleTsMs, priceUsd, market.volumeUsd);
    this.aggr15s.pushTick(candleTsMs, priceUsd, market.volumeUsd);
    this.aggr30s.pushTick(candleTsMs, priceUsd, market.volumeUsd);
    this.aggr1m.pushTick(candleTsMs, priceUsd, market.volumeUsd);

    const events: TokenChartEvent[] = [];
    if (market.devSignal && candleTsMs - this.lastDevEventRealMs >= 2500) {
      events.push({
        tokenId: this.meta.id,
        tMs: candleTsMs,
        type: market.devSignal,
        price: priceUsd,
      });
      this.lastDevEventRealMs = candleTsMs;
    }

    this.statWindow.push({
      simMs: this.simTimeMs,
      volUsd: market.volumeUsd,
      buys: market.buys,
      sells: market.sells,
    });
    const cutoff = this.simTimeMs - this.WINDOW_SIM_MS;
    let i = 0;
    while (i < this.statWindow.length && this.statWindow[i]!.simMs < cutoff) i++;
    if (i > 0) this.statWindow.splice(0, i);

    const migrationEvent = this.updatePhase(candleTsMs);
    if (migrationEvent) events.push(migrationEvent);
    return events;
  }

  private getPhaseModel(): PhaseModel {
    if (this.phase === 'MIGRATED') {
      return {
        liquidityMul: 4.5,
        lambdaMul: 0.62,
        volMul: 0.5,
        attentionDecayPerSec: 0.045,
      };
    }
    if (this.phase === 'FINAL') {
      return {
        liquidityMul: 2.1,
        lambdaMul: 1.0,
        volMul: 0.9,
        attentionDecayPerSec: 0.022,
      };
    }
    return {
      liquidityMul: 1.0,
      lambdaMul: 1.35,
      volMul: 1.2,
      attentionDecayPerSec: 0.016,
    };
  }

  private advanceRegime(realDtSec: number): void {
    this.regimeTtlSec -= realDtSec;
    if (this.regimeTtlSec <= 0) this.rollRegime();
  }

  private rollRegime(): void {
    const u = this.rng.next();
    if (this.phase === 'MIGRATED') {
      this.regime = u < 0.15 ? 'IMPULSE' : u < 0.65 ? 'PAUSE' : u < 0.92 ? 'PULLBACK' : 'DUMP';
      this.regimeTtlSec = 4 + this.rng.next() * 14;
      return;
    }
    if (this.phase === 'FINAL') {
      this.regime = u < 0.22 ? 'IMPULSE' : u < 0.48 ? 'PAUSE' : u < 0.85 ? 'PULLBACK' : 'DUMP';
      this.regimeTtlSec = 3 + this.rng.next() * 12;
      return;
    }
    this.regime = u < 0.4 ? 'IMPULSE' : u < 0.72 ? 'PAUSE' : u < 0.92 ? 'PULLBACK' : 'DUMP';
    this.regimeTtlSec = 2 + this.rng.next() * 9;
  }

  private getRegimeDriftPerSec(): number {
    switch (this.regime) {
      case 'IMPULSE': return 0.035;
      case 'PAUSE': return 0;
      case 'PULLBACK': return -0.012;
      case 'DUMP': return -0.05;
    }
  }

  private getRegimeBuyBias(): number {
    switch (this.regime) {
      case 'IMPULSE': return 0.63;
      case 'PAUSE': return 0.51;
      case 'PULLBACK': return 0.43;
      case 'DUMP': return 0.32;
    }
  }

  private getRegimeVolMul(): number {
    switch (this.regime) {
      case 'IMPULSE': return 1.35;
      case 'PAUSE': return 0.45;
      case 'PULLBACK': return 0.9;
      case 'DUMP': return 1.45;
    }
  }

  private getRegimeLambdaMul(): number {
    switch (this.regime) {
      case 'IMPULSE': return 1.5;
      case 'PAUSE': return 0.6;
      case 'PULLBACK': return 1.0;
      case 'DUMP': return 1.25;
    }
  }

  private getDevSignalChancePerSec(): number {
    if (this.phase === 'MIGRATED') {
      return this.regime === 'IMPULSE' ? 0.08 : this.regime === 'DUMP' ? 0.07 : 0.03;
    }
    if (this.phase === 'FINAL') {
      return this.regime === 'IMPULSE' ? 0.16 : this.regime === 'DUMP' ? 0.17 : 0.07;
    }
    return this.regime === 'IMPULSE' ? 0.14 : this.regime === 'DUMP' ? 0.12 : 0.05;
  }

  private updatePhase(candleTsMs: number): TokenChartEvent | null {
    if (this.phase === 'RUGGED' || this.phase === 'DEAD' || this.phase === 'MIGRATED') return null;

    const mcap = this.lastPriceUsd * SUPPLY;

    if (mcap >= MIGRATION_THRESHOLD_USD) {
      this.phase = 'MIGRATED';
      this.rollRegime();
      return {
        tokenId: this.meta.id,
        tMs: candleTsMs,
        type: 'MIGRATION',
        price: this.lastPriceUsd,
      };
    }

    this.phase = mcap >= 30_000 ? 'FINAL' : 'NEW';

    if (this.simTimeMs >= this.fateTimeoutSimMs) {
      this.phase = 'RUGGED';
      this.ruggedAtSimMs = this.simTimeMs;
    }
    return null;
  }

  getRuntime(): TokenRuntime {
    const mcap = this.lastPriceUsd * SUPPLY;
    let vol5m = 0;
    let buys5m = 0;
    let sells5m = 0;
    for (let i = 0; i < this.statWindow.length; i++) {
      vol5m += this.statWindow[i]!.volUsd;
      buys5m += this.statWindow[i]!.buys;
      sells5m += this.statWindow[i]!.sells;
    }
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
