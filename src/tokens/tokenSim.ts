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

type TokenArchetype = 'DOA' | 'SLOW_COOK' | 'HEALTHY' | 'CHAOS';

type ArchetypeProfile = {
  lambdaMul: number;
  volMul: number;
  driftBiasPerSec: number;
  maxDevEvents: number;
  targetRaiseUsdMin: number;
  targetRaiseUsdMax: number;
  sellReturnFactorMin: number;
  sellReturnFactorMax: number;
  minSupplyRatio: number;
  maxSupplyRatio: number;
  migrationChaosChance: number;
  deathSpiralChance: number;
};

const FINAL_PROGRESS = 0.85;
const MIGRATE_PROGRESS = 1.0;
const PRE_MIGRATION_MCAP_CAP = MIGRATION_THRESHOLD_USD * 1.2;

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
  private mcapAggr1s: CandleAggregator;
  private mcapAggr15s: CandleAggregator;
  private mcapAggr30s: CandleAggregator;
  private mcapAggr1m: CandleAggregator;

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
  private emittedInitialDevBuy = false;
  private emittedDoaSell = false;
  private devEventsUsed = 0;
  private postMigrationChaosLeftMs = 0;
  private deathSpiralLeftMs = 0;
  private hasEnteredFinal = false;
  private hasMigrated = false;
  private raisedUsd = 0;
  private targetRaiseUsd = 1;
  private bondingProgress = 0;
  private sellReturnFactor = 0.9;
  private minCirculatingSupply = SUPPLY * 0.03;
  private maxCirculatingSupply = SUPPLY;
  private archetype: TokenArchetype = 'HEALTHY';
  private archetypeProfile!: ArchetypeProfile;

  // Rolling 5-min stats window (in simMs)
  private statWindow: StatBucket[] = [];
  private readonly WINDOW_SIM_MS = 5 * 60_000;

  constructor(meta: TokenMeta, startMcapUsd: number, fateTimeoutSimMs: number) {
    this.meta = meta;
    this.fateTimeoutSimMs = fateTimeoutSimMs;
    this.spawnRealMs = Date.now();
    this.lastTickRealMs = this.spawnRealMs;
    this.rng = new RNG(meta.id);

    // Token-specific baseline params.
    this.baseLambda = 8 + this.rng.next() * 16;
    this.baseLiquidityUsd = startMcapUsd * (1.2 + this.rng.next() * 1.0);
    this.baseTradeSizeUsd = 120 + this.rng.next() * 680;
    this.tradeSigma = 0.75 + this.rng.next() * 0.45;
    this.impactK = 0.08 + this.rng.next() * 0.14;
    this.baseVol = 0.015 + this.rng.next() * 0.035;
    this.attention = 0.9 + this.rng.next() * 0.8;
    this.archetype = this.rollArchetype();
    this.archetypeProfile = this.buildArchetypeProfile(this.archetype);
    this.targetRaiseUsd = this.archetypeProfile.targetRaiseUsdMin
      + (this.archetypeProfile.targetRaiseUsdMax - this.archetypeProfile.targetRaiseUsdMin) * this.rng.next();
    this.sellReturnFactor = this.archetypeProfile.sellReturnFactorMin
      + (this.archetypeProfile.sellReturnFactorMax - this.archetypeProfile.sellReturnFactorMin) * this.rng.next();
    this.minCirculatingSupply = SUPPLY * this.archetypeProfile.minSupplyRatio;
    this.maxCirculatingSupply = SUPPLY * this.archetypeProfile.maxSupplyRatio;
    this.raisedUsd = Math.max(0, startMcapUsd * 0.08);
    this.bondingProgress = clamp(this.raisedUsd / this.targetRaiseUsd, 0, 1);

    this.aggr1s = new CandleAggregator(1);
    this.aggr15s = new CandleAggregator(15);
    this.aggr30s = new CandleAggregator(30);
    this.aggr1m = new CandleAggregator(60);
    this.mcapAggr1s = new CandleAggregator(1);
    this.mcapAggr15s = new CandleAggregator(15);
    this.mcapAggr30s = new CandleAggregator(30);
    this.mcapAggr1m = new CandleAggregator(60);

    const startCirculatingSupply = this.getCirculatingSupply(this.bondingProgress);
    const startPriceUsd = startMcapUsd / startCirculatingSupply;
    this.lastPriceUsd = startPriceUsd;
    this.priceAtSpawn = startPriceUsd;
    this.phase = 'NEW';
    this.rollRegime();

    // Seed initial flat candle so first dev buy grows from launch baseline.
    this.aggr1s.pushTick(this.spawnRealMs, startPriceUsd, 0);
    this.aggr15s.pushTick(this.spawnRealMs, startPriceUsd, 0);
    this.aggr30s.pushTick(this.spawnRealMs, startPriceUsd, 0);
    this.aggr1m.pushTick(this.spawnRealMs, startPriceUsd, 0);
    this.mcapAggr1s.pushTick(this.spawnRealMs, startMcapUsd, 0);
    this.mcapAggr15s.pushTick(this.spawnRealMs, startMcapUsd, 0);
    this.mcapAggr30s.pushTick(this.spawnRealMs, startMcapUsd, 0);
    this.mcapAggr1m.pushTick(this.spawnRealMs, startMcapUsd, 0);
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
    const inMigrationChaos = this.postMigrationChaosLeftMs > 0;

    if (this.regime === 'IMPULSE') this.attention = Math.min(2.8, this.attention + 0.04 * realDtSec);
    if (this.regime === 'DUMP') this.attention = Math.min(2.8, this.attention + 0.02 * realDtSec);

    let lambdaMul = phaseModel.lambdaMul * regimeLambdaMul;
    let volMul = phaseModel.volMul * regimeVolMul;
    let liquidityMul = phaseModel.liquidityMul;
    let driftPerSec = regimeDriftPerSec + this.archetypeProfile.driftBiasPerSec;
    let effectiveBuyBias = regimeBuyBias;

    lambdaMul *= this.archetypeProfile.lambdaMul;
    volMul *= this.archetypeProfile.volMul;

    if (this.postMigrationChaosLeftMs > 0) {
      this.postMigrationChaosLeftMs = Math.max(0, this.postMigrationChaosLeftMs - realDtSec * 1000);
      const chaosPulse = 0.9 + this.rng.next() * 0.8;
      lambdaMul *= (2.0 + this.rng.next() * 4.0) * chaosPulse;
      volMul *= 1.6 + this.rng.next() * 1.7;
      liquidityMul *= 0.3 + this.rng.next() * 0.4;
    }
    if (this.deathSpiralLeftMs > 0) {
      this.deathSpiralLeftMs = Math.max(0, this.deathSpiralLeftMs - realDtSec * 1000);
      driftPerSec -= 0.12;
      effectiveBuyBias = Math.min(effectiveBuyBias, 0.22);
      lambdaMul *= 1.4;
      volMul *= 1.3;
      liquidityMul *= 0.7;
    }

    const liquidityUsd = this.baseLiquidityUsd * liquidityMul;
    const candleTsMs = nowMs;
    const isLaunchTick = !this.emittedInitialDevBuy;
    const devFlow = this.buildDevFlow(candleTsMs, realDtSec, effectiveBuyBias, isLaunchTick);
    const prevPriceUsd = this.lastPriceUsd;

    // Minimal warm-up only for launch tick (avoid scripted behavior).
    if (isLaunchTick) {
      effectiveBuyBias = 1;
      driftPerSec = Math.max(driftPerSec, 0.01);
      volMul *= 0.05;
      lambdaMul *= 0.1;
    }

    const market = stepMarket(this.rng, {
      dtSec: realDtSec,
      priceUsd: prevPriceUsd,
      liquidityUsd,
      attention: this.attention,
      baseLambda: this.baseLambda * lambdaMul * (isLaunchTick ? 0.15 : 1),
      baseTradeSizeUsd: this.baseTradeSizeUsd,
      tradeSigma: this.tradeSigma,
      driftPerSec,
      volatilityPerSqrtSec: isLaunchTick ? 0 : this.baseVol * volMul,
      buyBias: effectiveBuyBias,
      impactK: this.impactK,
      whaleChance: isLaunchTick ? 0 : this.getWhaleChance(inMigrationChaos),
      externalFlow: devFlow?.externalFlow,
    });

    this.raisedUsd = clamp(
      this.raisedUsd + market.buyUsd - market.sellUsd * this.sellReturnFactor,
      0,
      this.targetRaiseUsd
    );
    this.bondingProgress = clamp(this.raisedUsd / this.targetRaiseUsd, 0, 1);

    // Clamp price through mcap limits using current circulating supply.
    const circulatingSupply = this.getCirculatingSupply(this.bondingProgress);
    const nextMcapUsd = market.nextPriceUsd * circulatingSupply;
    const migratedOrPastThreshold = this.hasMigrated || this.bondingProgress >= MIGRATE_PROGRESS;
    const mcapCap = migratedOrPastThreshold
      ? MCAP_CAP_USD
      : Math.min(MCAP_CAP_USD, PRE_MIGRATION_MCAP_CAP);
    const clampedMcap = Math.max(MCAP_FLOOR_USD, Math.min(mcapCap, nextMcapUsd));
    const priceUsd = clampedMcap / circulatingSupply;
    this.lastPriceUsd = priceUsd;

    this.aggr1s.pushTick(candleTsMs, priceUsd, market.volumeUsd);
    this.aggr15s.pushTick(candleTsMs, priceUsd, market.volumeUsd);
    this.aggr30s.pushTick(candleTsMs, priceUsd, market.volumeUsd);
    this.aggr1m.pushTick(candleTsMs, priceUsd, market.volumeUsd);
    this.mcapAggr1s.pushTick(candleTsMs, clampedMcap, market.volumeUsd);
    this.mcapAggr15s.pushTick(candleTsMs, clampedMcap, market.volumeUsd);
    this.mcapAggr30s.pushTick(candleTsMs, clampedMcap, market.volumeUsd);
    this.mcapAggr1m.pushTick(candleTsMs, clampedMcap, market.volumeUsd);

    const events: TokenChartEvent[] = [];
    if (devFlow?.eventType) {
      events.push({
        tokenId: this.meta.id,
        tMs: candleTsMs,
        type: devFlow.eventType,
        price: priceUsd,
        size: devFlow.sizeUsd,
      });
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
    if (this.archetype === 'DOA') {
      this.regime = u < 0.12 ? 'IMPULSE' : u < 0.75 ? 'PAUSE' : 'DUMP';
      this.regimeTtlSec = 4 + this.rng.next() * 18;
      return;
    }
    if (this.archetype === 'SLOW_COOK') {
      this.regime = u < 0.2 ? 'IMPULSE' : u < 0.62 ? 'PAUSE' : u < 0.93 ? 'PULLBACK' : 'DUMP';
      this.regimeTtlSec = 5 + this.rng.next() * 16;
      return;
    }
    if (this.archetype === 'CHAOS') {
      this.regime = u < 0.3 ? 'IMPULSE' : u < 0.42 ? 'PAUSE' : u < 0.75 ? 'PULLBACK' : 'DUMP';
      this.regimeTtlSec = 2 + this.rng.next() * 10;
      return;
    }
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
      case 'IMPULSE': return 1.15;
      case 'PAUSE': return 0.5;
      case 'PULLBACK': return 0.8;
      case 'DUMP': return 1.2;
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
    if (this.devEventsUsed >= this.archetypeProfile.maxDevEvents) return 0;
    if (this.archetype === 'DOA') return 0.015;
    if (this.phase === 'MIGRATED') {
      return this.regime === 'IMPULSE' ? 0.04 : this.regime === 'DUMP' ? 0.035 : 0.015;
    }
    if (this.phase === 'FINAL') {
      return this.regime === 'IMPULSE' ? 0.08 : this.regime === 'DUMP' ? 0.09 : 0.03;
    }
    return this.regime === 'IMPULSE' ? 0.07 : this.regime === 'DUMP' ? 0.06 : 0.025;
  }

  private getWhaleChance(inMigrationChaos: boolean): number {
    if (inMigrationChaos) return this.regime === 'IMPULSE' ? 0.04 : this.regime === 'DUMP' ? 0.035 : 0.025;
    if (this.phase === 'MIGRATED') return this.regime === 'IMPULSE' ? 0.012 : this.regime === 'PAUSE' ? 0.006 : 0.009;
    if (this.phase === 'FINAL') return this.regime === 'IMPULSE' ? 0.014 : this.regime === 'PAUSE' ? 0.007 : 0.011;
    return this.regime === 'IMPULSE' ? 0.015 : this.regime === 'PAUSE' ? 0.008 : 0.012;
  }

  private buildDevFlow(candleTsMs: number, realDtSec: number, buyBias: number, isLaunchTick: boolean): {
    eventType: 'DEV_BUY' | 'DEV_SELL';
    externalFlow: { buyBoostUsd?: number; sellBoostUsd?: number };
    sizeUsd: number;
  } | null {
    // First visible dev action: seed buy that actually impacts price/volume.
    if (!this.emittedInitialDevBuy) {
      this.emittedInitialDevBuy = true;
      this.lastDevEventRealMs = candleTsMs;
      const sizeUsd = this.baseTradeSizeUsd * (3 + this.rng.next() * 3.5);
      this.devEventsUsed += 1;
      return {
        eventType: 'DEV_BUY',
        externalFlow: { buyBoostUsd: sizeUsd },
        sizeUsd,
      };
    }

    if (this.archetype === 'DOA' && !this.emittedDoaSell && this.simTimeMs >= 120_000) {
      this.emittedDoaSell = true;
      this.lastDevEventRealMs = candleTsMs;
      const sizeUsd = this.baseTradeSizeUsd * (6 + this.rng.next() * 8);
      this.devEventsUsed += 1;
      return {
        eventType: 'DEV_SELL',
        externalFlow: { sellBoostUsd: sizeUsd },
        sizeUsd,
      };
    }

    if (isLaunchTick) return null;

    if (candleTsMs - this.lastDevEventRealMs < 2500) return null;
    if (this.rng.next() >= this.getDevSignalChancePerSec() * realDtSec) return null;

    const isBuy = this.rng.next() < buyBias;
    const sizeUsd = this.baseTradeSizeUsd * (2 + this.rng.next() * 6);
    this.lastDevEventRealMs = candleTsMs;
    this.devEventsUsed += 1;
    if (isBuy) {
      return {
        eventType: 'DEV_BUY',
        externalFlow: { buyBoostUsd: sizeUsd },
        sizeUsd,
      };
    }
    return {
      eventType: 'DEV_SELL',
      externalFlow: { sellBoostUsd: sizeUsd },
      sizeUsd,
    };
  }

  private updatePhase(candleTsMs: number): TokenChartEvent | null {
    if (this.phase === 'RUGGED' || this.phase === 'DEAD' || this.phase === 'MIGRATED') return null;

    if (this.hasMigrated) {
      this.phase = 'MIGRATED';
      return null;
    }

    if (!this.hasEnteredFinal && this.bondingProgress >= FINAL_PROGRESS) {
      this.hasEnteredFinal = true;
    }

    if (this.bondingProgress >= MIGRATE_PROGRESS && !this.hasMigrated) {
      this.hasMigrated = true;
      this.phase = 'MIGRATED';
      this.rollRegime();
      if (this.rng.next() < this.archetypeProfile.migrationChaosChance) {
        this.postMigrationChaosLeftMs = 8_000 + this.rng.next() * 17_000;
      } else {
        this.postMigrationChaosLeftMs = 0;
      }
      if (this.rng.next() < this.archetypeProfile.deathSpiralChance) {
        this.deathSpiralLeftMs = 5_000 + this.rng.next() * 15_000;
      } else {
        this.deathSpiralLeftMs = 0;
      }
      return {
        tokenId: this.meta.id,
        tMs: candleTsMs,
        type: 'MIGRATION',
        price: this.lastPriceUsd,
      };
    }

    this.phase = this.hasEnteredFinal ? 'FINAL' : 'NEW';

    if (this.simTimeMs >= this.fateTimeoutSimMs) {
      this.phase = 'RUGGED';
      this.ruggedAtSimMs = this.simTimeMs;
    }
    return null;
  }

  getRuntime(): TokenRuntime {
    const mcap = this.getLastMcapUsd();
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
      bondingCurvePct: Math.min(100, this.bondingProgress * 100),
      vol5mUsd: vol5m,
      buys5m,
      sells5m,
      changePct,
      priceAtSpawn: this.priceAtSpawn,
      ruggedAtSimMs: this.ruggedAtSimMs,
    };
  }

  getCandles(tfSec: number, metric: 'price' | 'mcap' = 'price') {
    if (metric === 'mcap') {
      if (tfSec <= 1) return this.mcapAggr1s.getSeries();
      if (tfSec <= 15) return this.mcapAggr15s.getSeries();
      if (tfSec <= 30) return this.mcapAggr30s.getSeries();
      return this.mcapAggr1m.getSeries();
    }
    if (tfSec <= 1) return this.aggr1s.getSeries();
    if (tfSec <= 15) return this.aggr15s.getSeries();
    if (tfSec <= 30) return this.aggr30s.getSeries();
    return this.aggr1m.getSeries();
  }

  getPhase(): TokenPhase { return this.phase; }
  getSimTimeMs(): number { return this.simTimeMs; }
  getSpawnRealMs(): number { return this.spawnRealMs; }
  getLastPriceUsd(): number { return this.lastPriceUsd; }
  getLastMcapUsd(): number { return this.lastPriceUsd * this.getCirculatingSupply(this.bondingProgress); }

  private rollArchetype(): TokenArchetype {
    const u = this.rng.next();
    if (u < 0.56) return 'DOA';
    if (u < 0.66) return 'SLOW_COOK';
    if (u < 0.98) return 'HEALTHY';
    return 'CHAOS';
  }

  private buildArchetypeProfile(archetype: TokenArchetype): ArchetypeProfile {
    if (archetype === 'DOA') {
      return {
        lambdaMul: 0.45,
        volMul: 0.5,
        driftBiasPerSec: -0.01,
        maxDevEvents: 2,
        targetRaiseUsdMin: 110_000,
        targetRaiseUsdMax: 180_000,
        sellReturnFactorMin: 0.96,
        sellReturnFactorMax: 1.0,
        minSupplyRatio: 0.015,
        maxSupplyRatio: 0.28,
        migrationChaosChance: 0,
        deathSpiralChance: 0.5,
      };
    }
    if (archetype === 'SLOW_COOK') {
      return {
        lambdaMul: 0.9,
        volMul: 0.85,
        driftBiasPerSec: 0.0015,
        maxDevEvents: 3,
        targetRaiseUsdMin: 100_000,
        targetRaiseUsdMax: 150_000,
        sellReturnFactorMin: 0.9,
        sellReturnFactorMax: 0.97,
        minSupplyRatio: 0.02,
        maxSupplyRatio: 0.85,
        migrationChaosChance: 0.03,
        deathSpiralChance: 0.04,
      };
    }
    if (archetype === 'CHAOS') {
      return {
        lambdaMul: 1.35,
        volMul: 1.4,
        driftBiasPerSec: 0.003,
        maxDevEvents: 5,
        targetRaiseUsdMin: 55_000,
        targetRaiseUsdMax: 90_000,
        sellReturnFactorMin: 0.75,
        sellReturnFactorMax: 0.88,
        minSupplyRatio: 0.018,
        maxSupplyRatio: 1.0,
        migrationChaosChance: 0.8,
        deathSpiralChance: 0.28,
      };
    }
    return {
      lambdaMul: 1,
      volMul: 0.85,
      driftBiasPerSec: 0.0015,
      maxDevEvents: 3,
      targetRaiseUsdMin: 60_000,
      targetRaiseUsdMax: 95_000,
      sellReturnFactorMin: 0.8,
      sellReturnFactorMax: 0.9,
      minSupplyRatio: 0.025,
      maxSupplyRatio: 1.0,
      migrationChaosChance: 0.15,
      deathSpiralChance: 0.08,
    };
  }

  private getCirculatingSupply(progress: number): number {
    const clampedProgress = clamp(progress, 0, 1);
    return this.minCirculatingSupply
      + (this.maxCirculatingSupply - this.minCirculatingSupply) * clampedProgress;
  }
}
