import { RNG } from '../engine/rng';
import { CandleAggregator } from '../engine/aggregator';
import type { TokenMeta, TokenRuntime, TokenPhase } from './types';
import {
  SUPPLY, MCAP_FLOOR_USD, MCAP_CAP_USD, SIM_TIME_MULTIPLIER, SOL_PRICE_USD,
} from './types';
import { stepMarket } from './marketModel';
import type { TokenChartEvent } from '../chart/tokenChartEvents';
import { SESSION_SIM_PROFILE, getSessionBucket, type SessionBucket, type SessionSimProfile } from '../market/session';
import {
  HIGH_LIQUIDITY_DAMPING,
  IMPACT_SATURATION_FLOOR_USD,
  LOW_LIQUIDITY_BOOST,
  MIGRATION_APPROACH_FRICTION_MAX,
  MIGRATION_APPROACH_FRICTION_START_PCT,
  MIN_MIGRATION_AGE_SEC,
  MIN_MIGRATION_HOLDERS,
  MIN_MIGRATION_SUSTAIN_CANDLES,
  MIN_MIGRATION_TX_60S,
  computeBaseQualityScore,
  computeFlowStrength,
  decideMigrationOutcome,
  getMarketBehavior,
  getMigrationShockDurationMs,
  getMigrationThresholdUsd,
  MICROBUST_CANDLES_MAX,
  MICROBUST_CANDLES_MIN,
  MICROBUST_CONTINUATION_DECAY,
  MICROBUST_RETRACE_CHANCE,
  MICROBUST_RETRACE_STRENGTH_PCT,
  rollNextMarketRegime,
  TRADE_SIZE_BUCKETS_SOL,
  type TokenMarketBehavior,
  type TokenMarketRegime,
} from './tokenMarketRegimes';
import {
  computeActorOverlay,
  getActorBuyReuseBias,
  getActorSellAffinityPrefixes,
  getActorSellReuseBias,
  getActorWalletPrefix,
  pickActorGroup,
  type TokenActorGroup,
  type TokenActorMixEntry,
} from './tokenActors';

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
  initialRealTokenRatioMin: number;
  initialRealTokenRatioMax: number;
  virtualTokenLiquidityMulMin: number;
  virtualTokenLiquidityMulMax: number;
};

type CurveSwapDebug = {
  direction: 'BUY' | 'SELL';
  amountIn: number;
  amountOut: number;
  simMs: number;
};

type PendingUserOrder = {
  id: string;
  side: UserTradeSide;
  amountIn: number;
  slippageBps: number;
  expectedOut: number;
  minOut: number;
  submitMs: number;
  execMs: number;
  prioritySol: number;
  txCostSol: number;
};

type HolderWalletProfile = {
  firstSeenMs: number;
  lastActiveMs: number;
  solBalance: number;
  boughtUsd: number;
  boughtTokens: number;
  soldUsd: number;
  soldTokens: number;
  avgBuyUsd: number;
  avgSellUsd: number;
  realizedPnlUsd: number;
  openCostBasisUsd: number;
};

type MicroburstState = {
  stepsUsd: number[];
  cooldownMs: number;
};

export type SimTapeTrade = {
  id: string;
  tMs: number;
  side: UserTradeSide;
  walletId: string;
  tokenAmount: number;
  notionalUsd: number;
  priceUsd: number;
  mcapUsd: number;
};

export type HolderRow = {
  walletId: string;
  isLiquidityPool?: boolean;
  solBalance: number;
  firstSeenMs: number;
  balanceTokens: number;
  balanceUsd: number;
  boughtUsd: number;
  boughtTokens: number;
  avgBuyUsd: number;
  soldUsd: number;
  soldTokens: number;
  avgSellUsd: number;
  unrealizedPnlUsd: number;
  realizedPnlUsd: number;
  remainingUsd: number;
  lastActiveMs: number;
};

export type MarketMicroSnapshot = {
  holdersCount: number;
  topHolders: HolderRow[];
  recentTrades: SimTapeTrade[];
  updatedAtMs: number;
};

export type CurveDebugSnapshot = {
  phase: TokenPhase;
  hasEnteredFinal: boolean;
  hasMigrated: boolean;
  progressNowPct: number;
  rTok: number;
  rTok0: number;
  vTok: number;
  vBase: number;
  rBase: number;
  k: number;
  kDriftPct: number;
  invalidState: boolean;
  priceCurveUsd: number;
  mcapCurveUsd: number;
  feeBps: number;
  lastSwap: CurveSwapDebug | null;
};

export type UserTradeSide = 'BUY' | 'SELL';

export type UserTradeQuote =
  | {
    ok: false;
    side: UserTradeSide;
    amountIn: number;
    reason: string;
  }
  | {
    ok: true;
    side: UserTradeSide;
    amountIn: number;
    expectedOut: number;
    minOut: number;
    slippageBps: number;
    priceUsd: number;
    mcapUsd: number;
    feeBps: number;
    quoteTsMs: number;
  };

export type UserTradeFillSuccess = {
  ok: true;
  side: UserTradeSide;
  requestedAmount: number;
  filledSol: number;
  filledToken: number;
  filledUsd: number;
  feeUsd: number;
  avgPriceUsd: number;
  priceBeforeUsd: number;
  priceAfterUsd: number;
  impactPct: number;
  mcapBeforeUsd: number;
  mcapAfterUsd: number;
  tsMs: number;
};

export type UserTradeFill =
  | {
    ok: false;
    side: UserTradeSide;
    requestedAmount: number;
    reason: string;
  }
  | UserTradeFillSuccess;

export type UserTradeSubmitRequest = {
  side: UserTradeSide;
  amountIn: number;
  slippageBps: number;
  prioritySol?: number;
  txCostSol?: number;
  latencyMs?: number;
};

export type UserTradeSubmitResult =
  | {
    ok: false;
    side: UserTradeSide;
    amountIn: number;
    reason: string;
  }
  | {
    ok: true;
    tokenId: string;
    orderId: string;
    side: UserTradeSide;
    amountIn: number;
    expectedOut: number;
    minOut: number;
    slippageBps: number;
    submitMs: number;
    execMs: number;
    latencyMs: number;
    prioritySol: number;
    txCostSol: number;
  };

type UserTradeExecutionBase = {
  tokenId: string;
  orderId: string;
  side: UserTradeSide;
  amountIn: number;
  expectedOut: number;
  minOut: number;
  actualOut: number;
  slippageBps: number;
  submitMs: number;
  execMs: number;
  prioritySol: number;
  txCostSol: number;
};

export type UserTradeExecutionNotice =
  | (UserTradeExecutionBase & {
    status: 'FILLED';
    fill: UserTradeFillSuccess;
  })
  | (UserTradeExecutionBase & {
    status: 'FAILED';
    reason: string;
  });

export type UserTradeOrderStatus =
  | {
    tokenId: string;
    orderId: string;
    side: UserTradeSide;
    status: 'PENDING';
    amountIn: number;
    expectedOut: number;
    minOut: number;
    slippageBps: number;
    submitMs: number;
    execMs: number;
    prioritySol: number;
    txCostSol: number;
  }
  | UserTradeExecutionNotice;

const FINAL_PROGRESS = 0.85;
const CURVE_FEE_BPS = 100;
const CURVE_TOKEN_EPS = 1e-6;
const MIGRATED_LIQUIDITY_FLOOR_USD = 7_500;
const MIN_USER_LATENCY_MS = 80;
const MAX_USER_LATENCY_MS = 320;
const MIN_EFFECTIVE_LATENCY_MS = 20;
const PRIORITY_LATENCY_IMPACT_MS_PER_SOL = 250_000;
const BASE_TRADE_SIZE_SCALE = 0.9;
const BASE_IMPACT_SCALE = 0.9;
const BASE_VOLATILITY_SCALE = 0.88;
const DEV_FLOW_SCALE = 0.85;
const TAPE_MAX_TRADES = 2_000;
const HOLDERS_TOP_N = 120;
const HOLDER_DUST_USD = 0.25;
const NORMAL_SOFT_MCAP_USD = 100_000;
const SHORT_SOFT_MCAP_USD = 80_000;
const LONG_RUNNER_SOFT_MCAP_USD = 220_000;
const QUICK_RUG_SOFT_MCAP_USD = 1_500_000;
const FLOW_WARMUP_SIM_MS = 90_000;
const DEV_WARMUP_SIM_MS = 60_000;

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
  private lastMcapUsd: number;
  private priceAtSpawn: number;
  private phase: TokenPhase;
  private ruggedAtSimMs: number | null = null;

  // Microstructure internals (not part of external contracts)
  private marketRegime: TokenMarketRegime = 'LAUNCH_CHAOS';
  private marketRegimeTtlSec = 0;
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
  private migrationFreezeLeftMs = 0;
  private migrationShockLeftMs = 0;
  private migrationPostShockRegime: TokenMarketRegime | null = null;
  private preMigrationFlowStrength = 0;
  private deadUserReboundMs = 0;
  private lowEndImpulseCooldownMs = 0;
  private cadenceBurstLeftMs = 0;
  private hasEnteredFinal = false;
  private hasMigrated = false;
  private bondingProgress = 0;
  private curveVirtualBase = 0;
  private curveVirtualToken = 0;
  private curveRealBase = 0;
  private curveRealToken = 0;
  private curveInitialRealToken = 1;
  private curveKStart = 1;
  private invalidCurveState = false;
  private lastCurveSwap: CurveSwapDebug | null = null;
  private archetype: TokenArchetype = 'HEALTHY';
  private archetypeProfile!: ArchetypeProfile;
  private pendingUserOrders: PendingUserOrder[] = [];
  private userTradeExecutions: UserTradeExecutionNotice[] = [];
  private ledger = new Map<string, number>();
  private walletLastActiveMs = new Map<string, number>();
  private walletProfiles = new Map<string, HolderWalletProfile>();
  private tape: SimTapeTrade[] = [];
  private walletSeq = 0;
  private readonly baseQualityScore: number;
  private microburst: MicroburstState | null = null;
  private migrationEligibilityStreak = 0;
  private lastMigrationEligibilitySecond = -1;

  // Rolling 5-min stats window (in simMs)
  private statWindow: StatBucket[] = [];
  private readonly WINDOW_SIM_MS = 5 * 60_000;
  private sessionBucket: SessionBucket = 'OFF';

  constructor(meta: TokenMeta, startMcapUsd: number, fateTimeoutSimMs: number) {
    this.meta = meta;
    this.fateTimeoutSimMs = fateTimeoutSimMs;
    this.spawnRealMs = Date.now();
    this.lastTickRealMs = this.spawnRealMs;
    this.sessionBucket = getSessionBucket(this.spawnRealMs);
    this.rng = new RNG(meta.id);

    // Token-specific baseline params.
    this.baseLambda = 8 + this.rng.next() * 16;
    this.baseLiquidityUsd = startMcapUsd * (1.2 + this.rng.next() * 1.0);
    this.baseTradeSizeUsd = (120 + this.rng.next() * 680) * BASE_TRADE_SIZE_SCALE;
    this.tradeSigma = 0.75 + this.rng.next() * 0.45;
    this.impactK = (0.08 + this.rng.next() * 0.14) * BASE_IMPACT_SCALE;
    this.baseVol = (0.015 + this.rng.next() * 0.035) * BASE_VOLATILITY_SCALE;
    this.attention = 0.9 + this.rng.next() * 0.8;
    this.archetype = this.rollArchetype();
    this.archetypeProfile = this.buildArchetypeProfile(this.archetype);
    this.baseQualityScore = computeBaseQualityScore(this.meta.fate, this.meta.metrics);
    this.initCurveState(startMcapUsd);

    this.aggr1s = new CandleAggregator(1);
    this.aggr15s = new CandleAggregator(15);
    this.aggr30s = new CandleAggregator(30);
    this.aggr1m = new CandleAggregator(60);
    this.mcapAggr1s = new CandleAggregator(1);
    this.mcapAggr15s = new CandleAggregator(15);
    this.mcapAggr30s = new CandleAggregator(30);
    this.mcapAggr1m = new CandleAggregator(60);

    const startPriceUsd = this.getCurvePriceUsd();
    this.lastPriceUsd = startPriceUsd;
    this.lastMcapUsd = this.getCurveMcapUsd();
    this.seedGenesisHolders();
    this.priceAtSpawn = this.lastPriceUsd;
    this.phase = 'NEW';
    this.rollMarketRegime(this.getSessionProfile());

    // Seed initial flat candle so first dev buy grows from launch baseline.
    this.aggr1s.pushTick(this.spawnRealMs, startPriceUsd, 0);
    this.aggr15s.pushTick(this.spawnRealMs, startPriceUsd, 0);
    this.aggr30s.pushTick(this.spawnRealMs, startPriceUsd, 0);
    this.aggr1m.pushTick(this.spawnRealMs, startPriceUsd, 0);
    this.mcapAggr1s.pushTick(this.spawnRealMs, this.lastMcapUsd, 0);
    this.mcapAggr15s.pushTick(this.spawnRealMs, this.lastMcapUsd, 0);
    this.mcapAggr30s.pushTick(this.spawnRealMs, this.lastMcapUsd, 0);
    this.mcapAggr1m.pushTick(this.spawnRealMs, this.lastMcapUsd, 0);
  }

  tick(fallbackRealDtSec: number, sessionBucket: SessionBucket = getSessionBucket(Date.now())): TokenChartEvent[] {
    this.sessionBucket = sessionBucket;
    const sessionProfile = this.getSessionProfile();
    if (this.phase === 'RUGGED') this.phase = 'DEAD';

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
    const queuedEvents = this.processPendingUserTrades(nowMs);
    this.updateMigrationEligibility(nowMs);
    const inDeadMode = this.phase === 'DEAD';
    const inCollapseMode = !inDeadMode && this.ruggedAtSimMs != null;
    const hasUserBuyEvent = queuedEvents.some((ev) => ev.type === 'USER_BUY');
    if ((inDeadMode || inCollapseMode) && hasUserBuyEvent) {
      this.deadUserReboundMs = Math.max(this.deadUserReboundMs, 8_000 + this.rng.next() * 14_000);
    }

    const flowStrength = this.getFlowStrength();
    this.advanceMarketRegime(realDtSec, sessionProfile, flowStrength);
    const phaseModel = this.getPhaseModel();
    this.attention = Math.max(0.12, this.attention * Math.exp(-phaseModel.attentionDecayPerSec * realDtSec));

    const regimeBehavior = this.getMarketBehavior(flowStrength, sessionProfile);
    const inMigrationShock = this.migrationShockLeftMs > 0;
    const inMigrationFreeze = this.migrationFreezeLeftMs > 0;

    if (this.marketRegime === 'FIRST_PUMP' || this.marketRegime === 'MIGRATION_SHOCK') {
      this.attention = Math.min(2.6, this.attention + 0.026 * realDtSec);
    }
    if (this.marketRegime === 'BLEED_OUT') {
      this.attention = Math.max(0.1, this.attention - 0.018 * realDtSec);
    }

    let lambdaMul = phaseModel.lambdaMul * regimeBehavior.lambdaMul;
    let volMul = phaseModel.volMul * regimeBehavior.volMul;
    let liquidityMul = phaseModel.liquidityMul * regimeBehavior.liquidityMul;
    let driftPerSec = regimeBehavior.driftPerSec + this.archetypeProfile.driftBiasPerSec;
    let effectiveBuyBias = clamp(regimeBehavior.buyBias + sessionProfile.buyBiasShift, 0.14, 0.86);

    const cadenceBurstActive = this.advanceCadenceBurst(realDtSec, sessionProfile, flowStrength, regimeBehavior);
    if (cadenceBurstActive) {
      const cadenceHeat = clamp(
        0.9 + Math.max(0, flowStrength) * 0.55 + Math.max(0, this.attention - 1) * 0.18,
        0.75,
        1.6
      );
      lambdaMul *= 1 + regimeBehavior.cadenceBurstIntensity * 0.55 * cadenceHeat;
      volMul *= 1 + regimeBehavior.cadenceBurstIntensity * 0.28 * cadenceHeat;
    }

    if (inMigrationShock) {
      driftPerSec += this.rng.normal() * 0.022;
      effectiveBuyBias = clamp(0.5 + this.rng.normal() * 0.14 + flowStrength * 0.03, 0.24, 0.76);
    }

    if (this.phase === 'MIGRATED') {
      const migrationThresholdUsd = getMigrationThresholdUsd();
      const overMigration = (this.lastMcapUsd - migrationThresholdUsd) / Math.max(1, migrationThresholdUsd);
      if (overMigration > 0) {
        const contestedBias = clamp(overMigration, 0, 1.4);
        driftPerSec -= regimeBehavior.postMigrationPlateauPenalty * contestedBias * 0.028;
        effectiveBuyBias = clamp(
          effectiveBuyBias - regimeBehavior.postMigrationPlateauPenalty * contestedBias * 0.08,
          0.22,
          0.78
        );
        volMul *= 1 + regimeBehavior.postMigrationPlateauPenalty * contestedBias * 0.55;
        lambdaMul *= 1 + regimeBehavior.postMigrationPlateauPenalty * contestedBias * 0.18;

        if (this.rng.next() < regimeBehavior.postMigrationRetestChance * realDtSec) {
          driftPerSec -= 0.018 + contestedBias * 0.016;
          effectiveBuyBias = clamp(effectiveBuyBias - 0.06, 0.2, 0.74);
          volMul *= 1.12;
        }
        if (overMigration > 0.08 && this.rng.next() < regimeBehavior.postMigrationRejectionChance * realDtSec) {
          driftPerSec -= 0.028 + contestedBias * 0.02;
          effectiveBuyBias = clamp(effectiveBuyBias - 0.09, 0.18, 0.72);
          volMul *= 1.18;
        }
        if (overMigration > 0.12 && this.rng.next() < regimeBehavior.postMigrationMeanReversionChance * realDtSec) {
          driftPerSec -= regimeBehavior.postMigrationOverextensionPenalty * (0.04 + contestedBias * 0.02);
          effectiveBuyBias = clamp(
            effectiveBuyBias - regimeBehavior.postMigrationOverextensionPenalty * 0.12,
            0.16,
            0.72
          );
          lambdaMul *= 1.04;
          volMul *= 1.12;
        }
      }

      if (this.marketRegime === 'BLEED_OUT') {
        const belowMigration = clamp((migrationThresholdUsd - this.lastMcapUsd) / Math.max(1, migrationThresholdUsd), 0, 1.4);
        const reclaimBias = clamp(belowMigration, 0, 1);
        driftPerSec += this.rng.normal() * regimeBehavior.postMigrationBleedNoise * 0.02;
        lambdaMul *= 1 + regimeBehavior.postMigrationBleedNoise * 0.08;
        volMul *= 1 + regimeBehavior.postMigrationBleedNoise * 0.16;

        if (!this.microburst && this.rng.next() < regimeBehavior.postMigrationBleedRetestChance * realDtSec) {
          this.queueMicroburst('BUY', this.baseTradeSizeUsd * (1.1 + this.rng.next() * 1.45));
          driftPerSec += 0.006 + reclaimBias * 0.008;
          effectiveBuyBias = clamp(effectiveBuyBias + 0.055, 0.16, 0.72);
          lambdaMul *= 1.06;
        }

        if (!this.microburst && this.rng.next() < regimeBehavior.postMigrationBleedBounceChance * realDtSec) {
          this.queueMicroburst('BUY', this.baseTradeSizeUsd * (0.7 + this.rng.next() * 1.0));
          driftPerSec += 0.004 + reclaimBias * 0.003;
          volMul *= 1.05;
          effectiveBuyBias = clamp(effectiveBuyBias + 0.03, 0.15, 0.7);
        }

        if (!this.microburst && this.rng.next() < regimeBehavior.postMigrationBleedRejectionChance * realDtSec) {
          this.queueMicroburst('SELL', this.baseTradeSizeUsd * (1.35 + this.rng.next() * 1.65));
          driftPerSec -= 0.018 + belowMigration * 0.012;
          effectiveBuyBias = clamp(effectiveBuyBias - 0.085, 0.12, 0.66);
          volMul *= 1.14;
        }

        if (
          !this.microburst
          && belowMigration > 0.06
          && this.rng.next() < (0.1 + reclaimBias * 0.16) * realDtSec
        ) {
          this.queueMicroburst('BUY', this.baseTradeSizeUsd * (0.55 + this.rng.next() * 0.65));
          driftPerSec += 0.003 + reclaimBias * 0.004;
          effectiveBuyBias = clamp(effectiveBuyBias + 0.025, 0.14, 0.68);
        }
      }
    }

    lambdaMul *= this.archetypeProfile.lambdaMul;
    volMul *= this.archetypeProfile.volMul;
    lambdaMul *= sessionProfile.tempoMul;
    volMul *= Math.max(0.6, 0.9 + (sessionProfile.tempoMul - 1) * 0.45);

    if (inCollapseMode) {
      const collapseAgeMs = Math.max(0, this.simTimeMs - (this.ruggedAtSimMs ?? this.simTimeMs));
      const collapseFade = clamp(collapseAgeMs / 120_000, 0, 1);
      lambdaMul *= 0.45 - collapseFade * 0.2;
      volMul *= 0.55;
      liquidityMul *= 0.62;
      driftPerSec -= 0.09;
      effectiveBuyBias = clamp(effectiveBuyBias - 0.34, 0.05, 0.28);

      if (this.deadUserReboundMs > 0) {
        this.deadUserReboundMs = Math.max(0, this.deadUserReboundMs - realDtSec * 1000);
        lambdaMul *= 1.65;
        volMul *= 1.25;
        driftPerSec += 0.01;
        effectiveBuyBias = clamp(effectiveBuyBias + 0.18, 0.08, 0.5);
      }
    }

    if (inDeadMode) {
      const deadAgeMs = Math.max(0, this.simTimeMs - (this.ruggedAtSimMs ?? this.simTimeMs));
      const deadFade = clamp(deadAgeMs / 240_000, 0, 1);
      const baseTempoMul = 0.14 - deadFade * 0.09;
      lambdaMul *= Math.max(0.03, baseTempoMul);
      volMul *= 0.24;
      liquidityMul *= 0.45;
      driftPerSec -= 0.03;
      effectiveBuyBias = clamp(effectiveBuyBias - 0.24, 0.08, 0.34);

      const floorPressure = Math.max(0, (this.lastMcapUsd - MCAP_FLOOR_USD) / Math.max(1, MCAP_FLOOR_USD));
      if (floorPressure > 0) {
        driftPerSec -= Math.min(0.05, floorPressure * 0.03);
      }

      if (this.deadUserReboundMs > 0) {
        this.deadUserReboundMs = Math.max(0, this.deadUserReboundMs - realDtSec * 1000);
        lambdaMul *= 1.9;
        volMul *= 1.35;
        driftPerSec += 0.012;
        effectiveBuyBias = clamp(effectiveBuyBias + 0.2, 0.1, 0.62);
      }
    }

    const flowPowerMul = this.getFlowPowerMul();
    lambdaMul *= flowPowerMul;

    const mcapHeat = this.getMcapHeat();
    if (mcapHeat > 0 && this.meta.fate !== 'QUICK_RUG') {
      const heatRatio = mcapHeat / (1 + mcapHeat);
      effectiveBuyBias = clamp(effectiveBuyBias - 0.22 * heatRatio, 0.18, 0.82);
      driftPerSec -= 0.02 * heatRatio;
      lambdaMul *= Math.max(0.35, 1 - 0.55 * heatRatio);
      volMul *= Math.max(0.45, 1 - 0.35 * heatRatio);
    }

    if (this.phase !== 'MIGRATED' && this.phase !== 'DEAD') {
      const migrationThresholdUsd = getMigrationThresholdUsd();
      const progressToMigration = this.lastMcapUsd / Math.max(1, migrationThresholdUsd);
      if (progressToMigration >= MIGRATION_APPROACH_FRICTION_START_PCT) {
        const frictionProgress = clamp(
          (progressToMigration - MIGRATION_APPROACH_FRICTION_START_PCT)
          / Math.max(1e-6, 1 - MIGRATION_APPROACH_FRICTION_START_PCT),
          0,
          1
        );
        const friction = MIGRATION_APPROACH_FRICTION_MAX * frictionProgress;
        driftPerSec -= friction * 0.035;
        effectiveBuyBias = clamp(effectiveBuyBias - friction * 0.08, 0.18, 0.82);
        lambdaMul *= Math.max(0.55, 1 - friction * 0.28);
        volMul *= 1 + friction * 0.18;
      }

      if (this.phase === 'FINAL') {
        const finalStretchPressure = clamp((progressToMigration - 0.72) / 0.28, 0, 1);
        if (finalStretchPressure > 0) {
          const quality = this.getDynamicQualityScore(flowStrength);
          const stallBias = clamp(
            (1 - quality) * 0.72 + Math.max(0, 0.16 - flowStrength) * 1.15,
            0,
            1.25
          );
          driftPerSec -= finalStretchPressure * stallBias * 0.032;
          effectiveBuyBias = clamp(
            effectiveBuyBias - finalStretchPressure * stallBias * 0.1,
            0.16,
            0.78
          );
          lambdaMul *= Math.max(0.42, 1 - finalStretchPressure * stallBias * 0.26);
          volMul *= 1 + finalStretchPressure * stallBias * 0.14;
        }
      }
    }

    const heatRatio = mcapHeat / (1 + mcapHeat);
    const sessionTradeSizeMul = 0.6 + sessionProfile.tempoMul * 0.4;
    const tradeSizeMul = Math.max(
      0.12,
      flowPowerMul * regimeBehavior.tradeSizeMul * (1 - 0.45 * heatRatio) * sessionTradeSizeMul
    );
    const impactMul = Math.max(
      0.45,
      (0.75 + 0.25 * flowPowerMul - 0.2 * heatRatio)
      * regimeBehavior.impactMul
      * (0.78 + 0.28 * sessionProfile.whaleMul)
    );

    const liquidityUsd = this.baseLiquidityUsd * liquidityMul;
    const recentTradeStats = this.getRecentTradeStatsReal(18_000, nowMs);
    const isNearFloor = this.lastMcapUsd <= MCAP_FLOOR_USD * 3.5;
    const isLowLiquidity = liquidityUsd <= 9_500;
    const isLowActivity = recentTradeStats.tx <= 3;
    const isWeakOrDeadState =
      this.phase === 'DEAD'
      || this.marketRegime === 'DEAD_BOUNCE'
      || this.marketRegime === 'BLEED_OUT'
      || this.meta.fate === 'QUICK_RUG'
      || this.getDynamicQualityScore(flowStrength) < 0.42;
    const lowEndSuppressionContext = isNearFloor && isLowLiquidity && isLowActivity && isWeakOrDeadState;
    if (lowEndSuppressionContext && this.deadUserReboundMs <= 0) {
      this.lowEndImpulseCooldownMs = Math.max(0, this.lowEndImpulseCooldownMs - realDtSec * 1000);
      const suppressionStrength = clamp(
        ((MCAP_FLOOR_USD * 3.5 - this.lastMcapUsd) / Math.max(1, MCAP_FLOOR_USD * 2.5)) * 0.5
        + (1 - clamp(liquidityUsd / 9_500, 0, 1)) * 0.3
        + (1 - clamp(recentTradeStats.tx / 3, 0, 1)) * 0.2,
        0.18,
        0.85
      );
      lambdaMul *= Math.max(0.05, 0.22 - suppressionStrength * 0.08);
      volMul *= Math.max(0.12, 0.42 - suppressionStrength * 0.16);
      driftPerSec -= suppressionStrength * 0.012;
      effectiveBuyBias = clamp(effectiveBuyBias - suppressionStrength * 0.1, 0.06, 0.48);
      if (this.lowEndImpulseCooldownMs > 0) {
        lambdaMul *= 0.22;
        volMul *= 0.45;
      }
    } else {
      this.lowEndImpulseCooldownMs = Math.max(0, this.lowEndImpulseCooldownMs - realDtSec * 1000);
    }
    const candleTsMs = nowMs;
    const isLaunchTick = !this.emittedInitialDevBuy;
    const devFlow = this.buildDevFlow(
      candleTsMs,
      realDtSec,
      effectiveBuyBias,
      isLaunchTick,
      !inMigrationFreeze && !inDeadMode && !inCollapseMode,
      regimeBehavior.devSignalMul
    );
    const actorOverlay = computeActorOverlay(this.rng, {
      regime: this.marketRegime,
      phase: this.phase,
      fate: this.meta.fate,
      simTimeMs: this.simTimeMs,
      qualityScore: this.getDynamicQualityScore(flowStrength),
      flowStrength,
      changePct: this.getChangePct(),
      progressToMigration: this.lastMcapUsd / Math.max(1, getMigrationThresholdUsd()),
      baseTradeSizeUsd: this.baseTradeSizeUsd,
      hasEnteredFinal: this.hasEnteredFinal,
      hasDevBuySignal: devFlow?.eventType === 'DEV_BUY',
      hasDevSellSignal: devFlow?.eventType === 'DEV_SELL',
      suppressLowEndHeartbeat: lowEndSuppressionContext && this.deadUserReboundMs <= 0,
    });
    const prevPriceUsd = this.lastPriceUsd;
    const burstDirectionalUsd = this.consumeMicroburstDirectionalUsd(realDtSec);

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
      baseTradeSizeUsd: this.baseTradeSizeUsd * tradeSizeMul,
      tradeSigma: this.tradeSigma * regimeBehavior.tradeSigmaMul * regimeBehavior.wickinessMultiplier,
      driftPerSec,
      volatilityPerSqrtSec: isLaunchTick ? 0 : this.baseVol * volMul,
      buyBias: effectiveBuyBias,
      impactK: this.impactK * impactMul,
      whaleChance: (isLaunchTick || inMigrationFreeze || inDeadMode || inCollapseMode)
        ? 0
        : this.getWhaleChance(inMigrationShock, sessionProfile, regimeBehavior),
      externalFlow: devFlow?.externalFlow,
    });

    let targetBuyUsd = market.buyUsd;
    let targetSellUsd = market.sellUsd;
    let expectedNextPriceUsd = market.nextPriceUsd;
    const actorActivityScale = clamp(
      (market.buyUsd + market.sellUsd) / Math.max(1, this.baseTradeSizeUsd * 1.2),
      0,
      1.25
    );
    const actorBuyBoostUsd = actorOverlay.buyBoostUsd * actorActivityScale;
    const actorSellBoostUsd = actorOverlay.sellBoostUsd * actorActivityScale;
    const actorDirectionalUsd = actorBuyBoostUsd - actorSellBoostUsd;

    if (actorBuyBoostUsd > 0) targetBuyUsd += actorBuyBoostUsd;
    if (actorSellBoostUsd > 0) targetSellUsd += actorSellBoostUsd;
    if (Math.abs(actorDirectionalUsd) > 1e-6) {
      expectedNextPriceUsd = this.adjustExpectedPriceForDirectionalUsd(
        expectedNextPriceUsd,
        actorDirectionalUsd,
        liquidityUsd,
        this.impactK * impactMul
      );
    }

    if (burstDirectionalUsd > 0) {
      targetBuyUsd += burstDirectionalUsd;
      expectedNextPriceUsd = this.adjustExpectedPriceForDirectionalUsd(
        expectedNextPriceUsd,
        burstDirectionalUsd,
        liquidityUsd,
        this.impactK * impactMul
      );
    } else if (burstDirectionalUsd < 0) {
      targetSellUsd += Math.abs(burstDirectionalUsd);
      expectedNextPriceUsd = this.adjustExpectedPriceForDirectionalUsd(
        expectedNextPriceUsd,
        burstDirectionalUsd,
        liquidityUsd,
        this.impactK * impactMul
      );
    }

    if (lowEndSuppressionContext && this.deadUserReboundMs <= 0 && (targetBuyUsd + targetSellUsd) > 0) {
      const syntheticPulse = actorBuyBoostUsd + actorSellBoostUsd + Math.abs(burstDirectionalUsd);
      if (syntheticPulse > this.baseTradeSizeUsd * 0.18 && this.lowEndImpulseCooldownMs <= 0) {
        this.lowEndImpulseCooldownMs = 5_000 + this.rng.next() * 15_000;
      }
    }

    const guardedFlow = this.guardCandleDisplacement({
      targetBuyUsd,
      targetSellUsd,
      expectedNextPriceUsd,
      previousPriceUsd: prevPriceUsd,
      regimeBehavior,
      realDtSec,
      liquidityUsd,
    });

    if (!inMigrationFreeze) {
      this.executeMarketFlowAsTape({
        candleTsMs,
        realDtSec,
        targetBuyUsd: guardedFlow.targetBuyUsd,
        targetSellUsd: guardedFlow.targetSellUsd,
        expectedNextPriceUsd: guardedFlow.expectedNextPriceUsd,
        previousPriceUsd: prevPriceUsd,
        buyMix: actorOverlay.buyMix,
        sellMix: actorOverlay.sellMix,
      });
    } else {
      this.migrationFreezeLeftMs = Math.max(0, this.migrationFreezeLeftMs - realDtSec * 1000);
    }

    const events: TokenChartEvent[] = queuedEvents.slice();
    if (devFlow?.eventType) {
      events.push({
        tokenId: this.meta.id,
        tMs: candleTsMs,
        type: devFlow.eventType,
        price: this.lastPriceUsd,
        mcap: this.lastMcapUsd,
        size: devFlow.sizeUsd,
      });
    }

    const migrationEvent = this.updatePhase(candleTsMs);
    if (migrationEvent) events.push(migrationEvent);
    return events;
  }

  private executeMarketFlowAsTape(input: {
    candleTsMs: number;
    realDtSec: number;
    targetBuyUsd: number;
    targetSellUsd: number;
    expectedNextPriceUsd: number;
    previousPriceUsd: number;
    buyMix: TokenActorMixEntry[];
    sellMix: TokenActorMixEntry[];
  }): void {
    const targetBuyUsd = Math.max(0, Number.isFinite(input.targetBuyUsd) ? input.targetBuyUsd : 0);
    const targetSellUsd = Math.max(0, Number.isFinite(input.targetSellUsd) ? input.targetSellUsd : 0);
    const totalUsd = targetBuyUsd + targetSellUsd;
    if (totalUsd <= 1e-6) {
      return;
    }

    const minTradeUsd = this.getMinSyntheticTradeUsd();
    const targetTrades = clamp(
      Math.round(3 + Math.sqrt(totalUsd / Math.max(20, this.baseTradeSizeUsd)) * 3.05 + this.rng.next() * 3.6),
      2,
      Math.max(2, Math.min(24, Math.floor(totalUsd / Math.max(1, minTradeUsd)) || 2))
    );
    let buyTrades = targetBuyUsd > 0
      ? Math.max(1, Math.round(targetTrades * (targetBuyUsd / Math.max(1e-9, totalUsd))))
      : 0;
    let sellTrades = targetSellUsd > 0
      ? Math.max(1, targetTrades - buyTrades)
      : 0;
    if (buyTrades > 0 && sellTrades > 0 && buyTrades + sellTrades > targetTrades) {
      if (buyTrades > sellTrades) buyTrades -= 1;
      else sellTrades -= 1;
    }

    const buyParts = this.splitNotional(targetBuyUsd, buyTrades, minTradeUsd);
    const sellParts = this.splitNotional(targetSellUsd, sellTrades, minTradeUsd);
    const sidePlan: UserTradeSide[] = [];
    for (let i = 0; i < buyParts.length; i++) sidePlan.push('BUY');
    for (let i = 0; i < sellParts.length; i++) sidePlan.push('SELL');

    for (let i = sidePlan.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng.next() * (i + 1));
      const tmp = sidePlan[i]!;
      sidePlan[i] = sidePlan[j]!;
      sidePlan[j] = tmp;
    }

    const windowMs = Math.max(80, Math.round(input.realDtSec * 1000));
    const startMs = input.candleTsMs - windowMs + 1;
    let buyIdx = 0;
    let sellIdx = 0;
    let executedTrades = 0;

    for (let i = 0; i < sidePlan.length; i++) {
      const side = sidePlan[i]!;
      const tsMs = startMs + Math.floor(((i + 1) * windowMs) / (sidePlan.length + 1));
      if (side === 'BUY') {
        const targetUsd = buyParts[buyIdx++] ?? 0;
        const actorGroup = pickActorGroup(this.rng, input.buyMix, 'late_retail');
        if (this.executeSimBuyTrade(targetUsd, tsMs, actorGroup)) executedTrades += 1;
        continue;
      }

      const targetUsd = sellParts[sellIdx++] ?? 0;
      const actorGroup = pickActorGroup(this.rng, input.sellMix, 'panic_sellers');
      const sellOk = this.executeSimSellTrade(targetUsd, tsMs, actorGroup);
      if (sellOk) {
        executedTrades += 1;
        continue;
      }
      // If inventory is exhausted, keep tape alive by converting the slot to a small buy.
      if (targetUsd > 0 && this.executeSimBuyTrade(
        targetUsd * (0.65 + this.rng.next() * 0.35),
        tsMs,
        'dip_buyers'
      )) {
        executedTrades += 1;
      }
    }

    const expected = Number.isFinite(input.expectedNextPriceUsd)
      ? clamp(input.expectedNextPriceUsd, input.previousPriceUsd * 0.25, input.previousPriceUsd * 4)
      : input.previousPriceUsd;
    const driftPct = this.lastPriceUsd > 0 ? ((expected - this.lastPriceUsd) / this.lastPriceUsd) : 0;
    if (Math.abs(driftPct) > 0.012 && totalUsd > 25) {
      const steeringTs = input.candleTsMs;
      const steeringNotional = Math.max(8, totalUsd * 0.15);
      if (driftPct > 0) {
        if (this.executeSimBuyTrade(steeringNotional, steeringTs, 'momentum_chasers')) executedTrades += 1;
      } else if (this.executeSimSellTrade(steeringNotional, steeringTs, 'panic_sellers')) {
        executedTrades += 1;
      }
    }

    if (executedTrades === 0) return;
  }

  private guardCandleDisplacement(input: {
    targetBuyUsd: number;
    targetSellUsd: number;
    expectedNextPriceUsd: number;
    previousPriceUsd: number;
    regimeBehavior: TokenMarketBehavior;
    realDtSec: number;
    liquidityUsd: number;
  }): {
    targetBuyUsd: number;
    targetSellUsd: number;
    expectedNextPriceUsd: number;
  } {
    const previousPriceUsd = Math.max(1e-12, input.previousPriceUsd);
    const expectedNextPriceUsd = Math.max(1e-12, input.expectedNextPriceUsd);
    const desiredMovePct = (expectedNextPriceUsd - previousPriceUsd) / previousPriceUsd;
    const maxBodyMovePct = input.regimeBehavior.maxBodyMovePct * clamp(input.realDtSec, 0.18, 1);
    const impactBudgetPct = this.getImpactBudgetPct(input.regimeBehavior, input.liquidityUsd, input.realDtSec);
    const allowedMoveAbsPct = Math.min(maxBodyMovePct, impactBudgetPct);
    if (!Number.isFinite(desiredMovePct) || Math.abs(desiredMovePct) <= allowedMoveAbsPct) {
      return {
        targetBuyUsd: input.targetBuyUsd,
        targetSellUsd: input.targetSellUsd,
        expectedNextPriceUsd: input.expectedNextPriceUsd,
      };
    }

    const totalUsd = input.targetBuyUsd + input.targetSellUsd;
    const netUsd = input.targetBuyUsd - input.targetSellUsd;
    if (totalUsd <= 0 || Math.abs(netUsd) <= 1e-6) {
      return {
        targetBuyUsd: input.targetBuyUsd,
        targetSellUsd: input.targetSellUsd,
        expectedNextPriceUsd: input.expectedNextPriceUsd,
      };
    }

    const allowedMovePct = Math.sign(desiredMovePct)
      * allowedMoveAbsPct
      * (0.9 + this.rng.next() * 0.1);
    const actualAbsMove = Math.abs(desiredMovePct);
    const scale = clamp(Math.abs(allowedMovePct) / Math.max(1e-6, actualAbsMove), 0.08, 1);
    const newNetUsd = netUsd * scale;
    const excessDirectionalUsd = Math.max(0, Math.abs(netUsd) - Math.abs(newNetUsd));
    const newBuyUsd = Math.max(0, (totalUsd + newNetUsd) * 0.5);
    const newSellUsd = Math.max(0, (totalUsd - newNetUsd) * 0.5);

    if (excessDirectionalUsd > this.baseTradeSizeUsd * 0.75) {
      this.queueMicroburst(Math.sign(netUsd) >= 0 ? 'BUY' : 'SELL', excessDirectionalUsd);
    }

    return {
      targetBuyUsd: newBuyUsd,
      targetSellUsd: newSellUsd,
      expectedNextPriceUsd: previousPriceUsd * (1 + allowedMovePct),
    };
  }

  private getImpactBudgetPct(
    regimeBehavior: TokenMarketBehavior,
    liquidityUsd: number,
    realDtSec: number
  ): number {
    const secScale = clamp(realDtSec, 0.18, 1);
    const liq = Math.max(1, liquidityUsd);
    let liquidityModifier: number;
    if (liq <= IMPACT_SATURATION_FLOOR_USD) {
      const ratio = liq / IMPACT_SATURATION_FLOOR_USD;
      liquidityModifier = 1 + (LOW_LIQUIDITY_BOOST - 1) * (1 - ratio);
    } else {
      const ratio = IMPACT_SATURATION_FLOOR_USD / liq;
      liquidityModifier = Math.max(HIGH_LIQUIDITY_DAMPING, Math.pow(ratio, 0.22));
    }

    return regimeBehavior.maxNetImpactPctPerSec
      * regimeBehavior.regimeImpactMultiplier
      * liquidityModifier
      * secScale;
  }

  private queueMicroburst(side: UserTradeSide, directionalUsd: number): void {
    if (!Number.isFinite(directionalUsd) || directionalUsd <= 0) return;

    const candleCount =
      MICROBUST_CANDLES_MIN
      + Math.floor(this.rng.next() * (MICROBUST_CANDLES_MAX - MICROBUST_CANDLES_MIN + 1));
    const weights: number[] = [];
    let sum = 0;
    for (let i = 0; i < candleCount; i++) {
      const frontLoadedBase =
        i === 0 ? 0.34 :
        i === 1 ? 0.24 :
        i === 2 ? 0.18 :
        0.11;
      const decay = Math.pow(MICROBUST_CONTINUATION_DECAY, i);
      const weight = Math.max(0.04, frontLoadedBase * decay * (0.92 + this.rng.next() * 0.24));
      weights.push(weight);
      sum += weight;
    }

    const sign = side === 'BUY' ? 1 : -1;
    const stepsUsd: number[] = [];
    for (let i = 0; i < weights.length; i++) {
      let step = directionalUsd * (weights[i]! / Math.max(1e-6, sum));
      if (i > 0 && this.rng.next() < MICROBUST_RETRACE_CHANCE) {
        step *= -MICROBUST_RETRACE_STRENGTH_PCT * (0.75 + this.rng.next() * 0.6);
      }
      stepsUsd.push(step * sign);
    }

    if (this.microburst) {
      this.microburst.stepsUsd.push(...stepsUsd);
      return;
    }

    this.microburst = {
      stepsUsd,
      cooldownMs: 1_000,
    };
  }

  private consumeMicroburstDirectionalUsd(realDtSec: number): number {
    if (!this.microburst || this.microburst.stepsUsd.length === 0) return 0;

    this.microburst.cooldownMs -= realDtSec * 1000;
    if (this.microburst.cooldownMs > 0) return 0;

    let directionalUsd = 0;
    while (this.microburst && this.microburst.cooldownMs <= 0 && this.microburst.stepsUsd.length > 0) {
      directionalUsd += this.microburst.stepsUsd.shift() ?? 0;
      this.microburst.cooldownMs += 1_000;
    }

    if (this.microburst && this.microburst.stepsUsd.length === 0) {
      this.microburst = null;
    }

    return directionalUsd;
  }

  private adjustExpectedPriceForDirectionalUsd(
    expectedNextPriceUsd: number,
    directionalUsd: number,
    liquidityUsd: number,
    impactK: number
  ): number {
    const price = Math.max(1e-12, expectedNextPriceUsd);
    const liq = Math.max(1, liquidityUsd);
    const dLog = (directionalUsd / liq) * impactK * 0.55;
    return Math.max(1e-12, price * Math.exp(dLog));
  }

  private splitNotional(totalUsd: number, parts: number, minTradeUsdHint = 0): number[] {
    if (!Number.isFinite(totalUsd) || totalUsd <= 0 || parts <= 0) return [];
    if (parts === 1) return [totalUsd];

    const behavior = this.getMarketBehavior(this.getFlowStrength(), this.getSessionProfile());
    const minTradeUsd = Math.max(minTradeUsdHint, this.getMinSyntheticTradeUsd());
    const maxParts = Math.max(1, Math.min(parts, Math.floor(totalUsd / Math.max(1, minTradeUsd)) || 1));
    const bucketUsd = this.getTradeSizeBucketsUsd();
    const out: number[] = [];
    let remaining = totalUsd;

    while (out.length < maxParts - 1) {
      const remainingSlots = maxParts - out.length - 1;
      const reserve = remainingSlots * minTradeUsd;
      const maxAllowed = remaining - reserve;
      if (maxAllowed <= minTradeUsd * 0.7) break;

      const bucketIndex = this.pickWeightedIndex(behavior.tradeSizeBucketWeights);
      const baseBucketUsd = bucketUsd[Math.min(bucketIndex, bucketUsd.length - 1)] ?? minTradeUsd;
      const candidate = baseBucketUsd * (0.82 + this.rng.next() * 0.44);
      const part = clamp(candidate, minTradeUsd, maxAllowed);
      out.push(part);
      remaining -= part;
    }

    if (out.length === 0) return [totalUsd];
    if (remaining < minTradeUsd * 0.55) {
      out[out.length - 1] += remaining;
      return out;
    }
    out.push(Math.max(0, remaining));
    return out;
  }

  private getTradeSizeBucketsUsd(): number[] {
    return [...TRADE_SIZE_BUCKETS_SOL].map((sol) => sol * SOL_PRICE_USD);
  }

  private getMinSyntheticTradeUsd(): number {
    const behavior = this.getMarketBehavior(this.getFlowStrength(), this.getSessionProfile());
    let floorUsd = behavior.tradeSizeMinClipSol * SOL_PRICE_USD;
    const activity = this.getSyntheticTradeActivityFactor();
    floorUsd *= 0.92 + activity * 0.38;
    if (this.phase === 'DEAD') floorUsd *= 0.45;
    else if (this.marketRegime === 'BLEED_OUT' && this.lastMcapUsd <= MCAP_FLOOR_USD * 3.5) floorUsd *= 0.6;
    return Math.max(1.5, floorUsd);
  }

  private getSyntheticTradeActivityFactor(): number {
    const stats = this.getFlowWindowTotals();
    const volHeat = clamp(stats.vol5mUsd / Math.max(4_000, this.lastMcapUsd * 0.18), 0, 1.4);
    const txHeat = clamp((stats.buys5m + stats.sells5m) / 90, 0, 1.25);
    const attentionHeat = clamp(this.attention - 0.8, 0, 1.2);
    return clamp(volHeat * 0.45 + txHeat * 0.35 + attentionHeat * 0.2, 0, 1.25);
  }

  private pickWeightedIndex(weights: readonly number[]): number {
    if (weights.length === 0) return 0;
    const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
    if (total <= 0) return 0;
    let roll = this.rng.next() * total;
    for (let i = 0; i < weights.length; i++) {
      roll -= Math.max(0, weights[i] ?? 0);
      if (roll <= 0) return i;
    }
    return weights.length - 1;
  }

  private advanceCadenceBurst(
    realDtSec: number,
    sessionProfile: SessionSimProfile,
    flowStrength: number,
    regimeBehavior: TokenMarketBehavior
  ): boolean {
    this.cadenceBurstLeftMs = Math.max(0, this.cadenceBurstLeftMs - realDtSec * 1000);
    if (this.cadenceBurstLeftMs > 0) return true;
    if (this.phase === 'DEAD' || this.migrationFreezeLeftMs > 0) return false;

    const triggerChance =
      regimeBehavior.cadenceBurstChance
      * clamp(sessionProfile.tempoMul, 0.75, 1.5)
      * clamp(0.8 + Math.max(0, flowStrength) * 0.75 + Math.max(0, this.attention - 1) * 0.22, 0.75, 1.7)
      * realDtSec;
    if (this.rng.next() >= triggerChance) return false;

    const minMs = regimeBehavior.cadenceBurstDurationMinSec * 1000;
    const maxMs = regimeBehavior.cadenceBurstDurationMaxSec * 1000;
    this.cadenceBurstLeftMs = minMs + this.rng.next() * Math.max(0, maxMs - minMs);
    return true;
  }

  private executeSimBuyTrade(targetUsd: number, tsMs: number, actorGroup: TokenActorGroup = 'late_retail'): boolean {
    const grossInUsd = Math.max(0, Number.isFinite(targetUsd) ? targetUsd : 0);
    if (grossInUsd <= 0) return false;

    const walletId = this.pickWalletForBuy(actorGroup);

    if (!this.hasMigrated && this.phase !== 'MIGRATED') {
      this.sanitizeCurveState();
      const buy = this.executeCurveBuy(grossInUsd);
      if (buy.baseInUsd <= 0 || buy.tokensOut <= 0) return false;

      this.sanitizeCurveState();
      this.bondingProgress = this.getCurveProgress();
      this.lastPriceUsd = this.getCurvePriceUsd();
      this.lastMcapUsd = this.getCurveMcapUsd();
      this.lastCurveSwap = {
        direction: 'BUY',
        amountIn: buy.baseInUsd,
        amountOut: buy.tokensOut,
        simMs: this.simTimeMs,
      };
      this.applyWalletDelta(walletId, buy.tokensOut, tsMs);
      this.recordTradeTick(tsMs, buy.baseInUsd, 'BUY', walletId, buy.tokensOut);
      return true;
    }

    const buy = this.executeMigratedBuy(grossInUsd);
    if (buy.baseInNetUsd <= 0 || buy.tokensOut <= 0) return false;

    const mcapUsd = this.clampMcapUsd(buy.priceAfterUsd * SUPPLY);
    this.lastMcapUsd = mcapUsd;
    this.lastPriceUsd = mcapUsd / SUPPLY;
    this.lastCurveSwap = {
      direction: 'BUY',
      amountIn: buy.baseInNetUsd,
      amountOut: buy.tokensOut,
      simMs: this.simTimeMs,
    };
    this.applyWalletDelta(walletId, buy.tokensOut, tsMs);
    this.recordTradeTick(tsMs, buy.baseInNetUsd, 'BUY', walletId, buy.tokensOut);
    return true;
  }

  private executeSimSellTrade(targetUsd: number, tsMs: number, actorGroup: TokenActorGroup = 'panic_sellers'): boolean {
    const desiredUsd = Math.max(0, Number.isFinite(targetUsd) ? targetUsd : 0);
    if (desiredUsd <= 0) return false;

    const walletId = this.pickWalletForSell(actorGroup);
    if (!walletId) return false;

    const walletBal = this.ledger.get(walletId) ?? 0;
    if (walletBal <= CURVE_TOKEN_EPS) return false;

    const refPrice = Math.max(1e-12, this.lastPriceUsd);
    const tokenApprox = desiredUsd / refPrice;
    const jitter = 0.82 + this.rng.next() * 0.36;
    const tokenIn = Math.min(walletBal, Math.max(CURVE_TOKEN_EPS, tokenApprox * jitter));
    if (tokenIn <= CURVE_TOKEN_EPS) return false;

    if (!this.hasMigrated && this.phase !== 'MIGRATED') {
      this.sanitizeCurveState();
      const sell = this.executeCurveSell(tokenIn);
      if (sell.baseOutUsd <= 0 || sell.tokenIn <= 0) return false;

      this.sanitizeCurveState();
      this.bondingProgress = this.getCurveProgress();
      this.lastPriceUsd = this.getCurvePriceUsd();
      this.lastMcapUsd = this.getCurveMcapUsd();
      this.lastCurveSwap = {
        direction: 'SELL',
        amountIn: sell.tokenIn,
        amountOut: sell.baseOutUsd,
        simMs: this.simTimeMs,
      };
      this.applyWalletDelta(walletId, -sell.tokenIn, tsMs);
      this.recordTradeTick(tsMs, sell.baseOutUsd, 'SELL', walletId, sell.tokenIn);
      return true;
    }

    const sell = this.executeMigratedSell(tokenIn);
    if (sell.baseOutNetUsd <= 0 || sell.tokenIn <= 0) return false;

    const mcapUsd = this.clampMcapUsd(sell.priceAfterUsd * SUPPLY);
    this.lastMcapUsd = mcapUsd;
    this.lastPriceUsd = mcapUsd / SUPPLY;
    this.lastCurveSwap = {
      direction: 'SELL',
      amountIn: sell.tokenIn,
      amountOut: sell.baseOutNetUsd,
      simMs: this.simTimeMs,
    };
    this.applyWalletDelta(walletId, -sell.tokenIn, tsMs);
    this.recordTradeTick(tsMs, sell.baseOutNetUsd, 'SELL', walletId, sell.tokenIn);
    return true;
  }

  private createWalletId(prefix: string): string {
    this.walletSeq += 1;
    const suffix = Math.floor(this.rng.next() * 0xFFFFFF).toString(36);
    return `${prefix}_${this.walletSeq.toString(36)}${suffix}`;
  }

  private randomInitialSolBalance(walletId: string): number {
    if (walletId === 'you') return 120;
    if (walletId.startsWith('dv_')) return 6 + this.rng.next() * 60;
    if (walletId.startsWith('in_')) return 1.5 + this.rng.next() * 26;
    if (walletId.startsWith('sn_')) return 0.7 + this.rng.next() * 16;
    if (walletId.startsWith('se_')) return 0.9 + this.rng.next() * 20;
    if (walletId.startsWith('mc_')) return 0.2 + this.rng.next() * 14;
    if (walletId.startsWith('lr_')) return 0.05 + this.rng.next() * 8;
    if (walletId.startsWith('db_')) return 0.2 + this.rng.next() * 12;
    if (walletId.startsWith('ps_')) return 0.04 + this.rng.next() * 6;
    if (walletId.startsWith('g_')) return 0.05 + this.rng.next() * 45;
    if (walletId.startsWith('w_')) return 0.01 + this.rng.next() * 28;
    return 0.01 + this.rng.next() * 20;
  }

  private getOrCreateWalletProfile(walletId: string, tsMs: number): HolderWalletProfile {
    const existing = this.walletProfiles.get(walletId);
    if (existing) return existing;

    const profile: HolderWalletProfile = {
      firstSeenMs: tsMs,
      lastActiveMs: tsMs,
      solBalance: this.randomInitialSolBalance(walletId),
      boughtUsd: 0,
      boughtTokens: 0,
      soldUsd: 0,
      soldTokens: 0,
      avgBuyUsd: 0,
      avgSellUsd: 0,
      realizedPnlUsd: 0,
      openCostBasisUsd: 0,
    };
    this.walletProfiles.set(walletId, profile);
    return profile;
  }

  private recordWalletTradeStats(
    walletId: string,
    side: UserTradeSide,
    tokenAmount: number,
    notionalUsd: number,
    priceUsd: number,
    tsMs: number
  ): void {
    if (!walletId || !Number.isFinite(tokenAmount) || tokenAmount <= 0) return;
    if (!Number.isFinite(notionalUsd) || notionalUsd <= 0) return;

    const profile = this.getOrCreateWalletProfile(walletId, tsMs);
    profile.lastActiveMs = tsMs;
    this.walletLastActiveMs.set(walletId, tsMs);

    const notionalSol = notionalUsd / Math.max(1e-9, SOL_PRICE_USD);
    if (side === 'BUY') {
      profile.boughtUsd += notionalUsd;
      profile.boughtTokens += tokenAmount;
      profile.avgBuyUsd = profile.boughtTokens > 0 ? profile.boughtUsd / profile.boughtTokens : 0;
      profile.openCostBasisUsd += notionalUsd;
      profile.solBalance = Math.max(0, profile.solBalance - notionalSol);
      return;
    }

    const prevBalanceTokens = this.ledger.get(walletId) ?? 0;
    const preSellTokens = prevBalanceTokens + tokenAmount;
    const avgCost = preSellTokens > 0 ? profile.openCostBasisUsd / preSellTokens : priceUsd;
    const costOutUsd = Math.max(0, avgCost * tokenAmount);

    profile.soldUsd += notionalUsd;
    profile.soldTokens += tokenAmount;
    profile.avgSellUsd = profile.soldTokens > 0 ? profile.soldUsd / profile.soldTokens : 0;
    profile.realizedPnlUsd += (notionalUsd - costOutUsd);
    profile.openCostBasisUsd = Math.max(0, profile.openCostBasisUsd - costOutUsd);
    profile.solBalance += notionalSol;
  }

  private pickWalletForBuy(actorGroup: TokenActorGroup): string {
    const prefix = getActorWalletPrefix(actorGroup);
    const matching = this.getHolderWalletIdsByPrefixes([prefix], true);
    if (matching.length > 0 && this.rng.next() < getActorBuyReuseBias(actorGroup)) {
      return matching[Math.floor(this.rng.next() * matching.length)]!;
    }

    const holders = this.getHolderWalletIds(true);
    if (holders.length > 0 && this.rng.next() < 0.38) {
      return holders[Math.floor(this.rng.next() * holders.length)]!;
    }
    return this.createWalletId(prefix);
  }

  private pickWalletForSell(actorGroup: TokenActorGroup): string | null {
    const affinityHolders = this.getHolderWalletIdsByPrefixes(getActorSellAffinityPrefixes(actorGroup), true);
    const holders =
      affinityHolders.length > 0 && this.rng.next() < getActorSellReuseBias(actorGroup)
        ? affinityHolders
        : this.getHolderWalletIds(true);
    if (holders.length === 0) return null;

    let totalWeight = 0;
    const weighted: Array<{ walletId: string; weight: number }> = [];
    for (let i = 0; i < holders.length; i++) {
      const walletId = holders[i]!;
      const bal = this.ledger.get(walletId) ?? 0;
      if (bal <= CURVE_TOKEN_EPS) continue;
      const w = Math.sqrt(Math.max(1e-9, bal));
      weighted.push({ walletId, weight: w });
      totalWeight += w;
    }
    if (weighted.length === 0 || totalWeight <= 0) return null;

    let u = this.rng.next() * totalWeight;
    for (let i = 0; i < weighted.length; i++) {
      u -= weighted[i]!.weight;
      if (u <= 0) return weighted[i]!.walletId;
    }
    return weighted[weighted.length - 1]!.walletId;
  }

  private applyWalletDelta(walletId: string, deltaTokens: number, tsMs: number): void {
    if (!walletId || !Number.isFinite(deltaTokens) || deltaTokens === 0) return;
    const profile = this.getOrCreateWalletProfile(walletId, tsMs);
    const prev = this.ledger.get(walletId) ?? 0;
    const next = Math.max(0, prev + deltaTokens);
    if (next <= CURVE_TOKEN_EPS) this.ledger.delete(walletId);
    else this.ledger.set(walletId, next);
    profile.lastActiveMs = tsMs;
    this.walletLastActiveMs.set(walletId, tsMs);
  }

  private getHolderWalletIds(excludeUser = false): string[] {
    const out: string[] = [];
    for (const [walletId, bal] of this.ledger.entries()) {
      if (excludeUser && walletId === 'you') continue;
      if (bal <= CURVE_TOKEN_EPS) continue;
      if (bal * this.lastPriceUsd < HOLDER_DUST_USD) continue;
      out.push(walletId);
    }
    return out;
  }

  private getHolderWalletIdsByPrefixes(prefixes: string[], excludeUser = false): string[] {
    if (prefixes.length === 0) return this.getHolderWalletIds(excludeUser);
    const set = new Set(prefixes);
    return this.getHolderWalletIds(excludeUser).filter((walletId) => {
      const prefix = walletId.split('_')[0] ?? '';
      return set.has(prefix);
    });
  }

  private seedGenesisHolders(): void {
    // Keep launch baseline deterministic (2k mcap from generator).
    // Holders should be created by live market flow, not pre-launch simulated buys.
    return;
  }

  private getPhaseModel(): PhaseModel {
    if (this.phase === 'DEAD') {
      return {
        liquidityMul: 0.55,
        lambdaMul: 0.22,
        volMul: 0.3,
        attentionDecayPerSec: 0.08,
      };
    }
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
        liquidityMul: 1.8,
        lambdaMul: 0.82,
        volMul: 0.8,
        attentionDecayPerSec: 0.03,
      };
    }
    return {
      liquidityMul: 1.0,
      lambdaMul: 1.12,
      volMul: 1.0,
      attentionDecayPerSec: 0.021,
    };
  }

  private getSessionProfile(): SessionSimProfile {
    return SESSION_SIM_PROFILE[this.sessionBucket] ?? SESSION_SIM_PROFILE.OFF;
  }

  private advanceMarketRegime(
    realDtSec: number,
    sessionProfile: SessionSimProfile,
    flowStrength: number
  ): void {
    if (this.migrationShockLeftMs > 0) {
      this.migrationShockLeftMs = Math.max(0, this.migrationShockLeftMs - realDtSec * 1000);
      this.marketRegime = 'MIGRATION_SHOCK';
      if (this.migrationShockLeftMs <= 0 && this.migrationPostShockRegime) {
        this.marketRegime = this.migrationPostShockRegime;
        this.migrationPostShockRegime = null;
        this.marketRegimeTtlSec = clamp(
          (this.marketRegime === 'POST_MIGRATION_DISCOVERY' ? 10 : this.marketRegime === 'CHOP' ? 8 : 9)
          + this.rng.next() * 12,
          4,
          28
        );
      }
      return;
    }

    if (this.phase === 'DEAD') {
      this.marketRegime = this.deadUserReboundMs > 0 ? 'DEAD_BOUNCE' : 'BLEED_OUT';
    }

    this.marketRegimeTtlSec -= realDtSec;
    if (this.marketRegimeTtlSec > 0) return;
    this.rollMarketRegime(sessionProfile, flowStrength);
  }

  private rollMarketRegime(
    sessionProfile: SessionSimProfile = this.getSessionProfile(),
    flowStrength = this.getFlowStrength()
  ): void {
    const { regime, ttlSec } = rollNextMarketRegime(this.rng, {
      currentRegime: this.marketRegime,
      phase: this.phase,
      fate: this.meta.fate,
      simTimeMs: this.simTimeMs,
      lastMcapUsd: this.lastMcapUsd,
      changePct: this.getChangePct(),
      flowStrength,
      qualityScore: this.getDynamicQualityScore(flowStrength),
      hasEnteredFinal: this.hasEnteredFinal,
      inMigrationShock: this.migrationShockLeftMs > 0,
      sessionProfile,
    });
    this.marketRegime = regime;
    this.marketRegimeTtlSec = ttlSec;
  }

  private getMarketBehavior(flowStrength: number, sessionProfile: SessionSimProfile): TokenMarketBehavior {
    const behavior = getMarketBehavior(this.marketRegime, {
      qualityScore: this.getDynamicQualityScore(flowStrength),
      flowStrength,
      sessionProfile,
      phase: this.phase,
      changePct: this.getChangePct(),
    });

    if (this.migrationFreezeLeftMs > 0) {
      return {
        ...behavior,
        driftPerSec: 0,
        buyBias: clamp(behavior.buyBias, 0.42, 0.58),
        volMul: behavior.volMul * 0.35,
        lambdaMul: behavior.lambdaMul * 0.08,
        liquidityMul: behavior.liquidityMul * 1.1,
        tradeSizeMul: behavior.tradeSizeMul * 0.2,
        tradeSizeMinClipSol: Math.max(0.02, behavior.tradeSizeMinClipSol * 0.6),
        impactMul: behavior.impactMul * 0.4,
        tradeSigmaMul: behavior.tradeSigmaMul * 0.6,
        devSignalMul: 0,
        whaleChanceMul: 0,
        cadenceBurstChance: 0,
        cadenceBurstDurationMinSec: behavior.cadenceBurstDurationMinSec,
        cadenceBurstDurationMaxSec: behavior.cadenceBurstDurationMaxSec,
        cadenceBurstIntensity: 0,
        postMigrationBleedRetestChance: behavior.postMigrationBleedRetestChance,
        postMigrationBleedBounceChance: behavior.postMigrationBleedBounceChance,
        postMigrationBleedRejectionChance: behavior.postMigrationBleedRejectionChance,
        postMigrationBleedNoise: behavior.postMigrationBleedNoise,
      };
    }

    return behavior;
  }

  private getDevSignalChancePerSec(): number {
    if (this.devEventsUsed >= this.archetypeProfile.maxDevEvents) return 0;
    if (this.archetype === 'DOA') return 0.015;
    switch (this.marketRegime) {
      case 'LAUNCH_CHAOS':
        return 0.04;
      case 'FIRST_PUMP':
      case 'MIGRATION_SHOCK':
        return this.phase === 'MIGRATED' ? 0.05 : 0.08;
      case 'GRIND_UP':
      case 'POST_MIGRATION_DISCOVERY':
        return 0.03;
      case 'BLEED_OUT':
        return 0.05;
      case 'DEAD_BOUNCE':
        return 0.015;
      case 'CHOP':
      default:
        return 0.022;
    }
  }

  private getWhaleChance(
    inMigrationShock: boolean,
    sessionProfile: SessionSimProfile,
    behavior: TokenMarketBehavior
  ): number {
    let chance: number;
    if (inMigrationShock) chance = 0.028;
    else if (this.phase === 'MIGRATED') chance = 0.009;
    else if (this.phase === 'FINAL') chance = 0.011;
    else chance = 0.012;

    chance *= sessionProfile.whaleMul;
    chance *= behavior.whaleChanceMul;
    if (this.marketRegime === 'BLEED_OUT') chance *= sessionProfile.nukeChanceMul;
    return clamp(chance, 0, 0.16);
  }

  private buildDevFlow(
    candleTsMs: number,
    realDtSec: number,
    buyBias: number,
    isLaunchTick: boolean,
    allowSignals: boolean,
    devSignalMul: number
  ): {
    eventType: 'DEV_BUY' | 'DEV_SELL';
    externalFlow: { buyBoostUsd?: number; sellBoostUsd?: number };
    sizeUsd: number;
  } | null {
    const devPowerMul = this.getDevFlowPowerMul();

    // First visible dev action: seed buy that actually impacts price/volume.
    if (!this.emittedInitialDevBuy) {
      this.emittedInitialDevBuy = true;
      this.lastDevEventRealMs = candleTsMs;
      const sizeUsd = this.baseTradeSizeUsd * (3 + this.rng.next() * 3.5) * DEV_FLOW_SCALE * devPowerMul;
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
      const sizeUsd = this.baseTradeSizeUsd * (6 + this.rng.next() * 8) * DEV_FLOW_SCALE * devPowerMul;
      this.devEventsUsed += 1;
      return {
        eventType: 'DEV_SELL',
        externalFlow: { sellBoostUsd: sizeUsd },
        sizeUsd,
      };
    }

    if (isLaunchTick || !allowSignals) return null;

    if (candleTsMs - this.lastDevEventRealMs < 2500) return null;
    if (this.rng.next() >= this.getDevSignalChancePerSec() * devSignalMul * realDtSec) return null;

    const isBuy = this.rng.next() < buyBias;
    const sizeUsd = this.baseTradeSizeUsd * (2 + this.rng.next() * 6) * DEV_FLOW_SCALE * devPowerMul;
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
    if (this.phase === 'DEAD' || this.phase === 'MIGRATED') return null;
    if (this.phase === 'RUGGED') {
      this.phase = 'DEAD';
      return null;
    }

    if (this.hasMigrated) {
      this.phase = 'MIGRATED';
      return null;
    }

    if (!this.hasEnteredFinal && this.bondingProgress >= FINAL_PROGRESS) {
      this.hasEnteredFinal = true;
    }

    const migrationThresholdUsd = getMigrationThresholdUsd();
    const forcedCurveMigration = this.curveRealToken <= CURVE_TOKEN_EPS;
    const eligibleForMigration =
      this.lastMcapUsd >= migrationThresholdUsd
      && this.migrationEligibilityStreak >= MIN_MIGRATION_SUSTAIN_CANDLES;
    if ((eligibleForMigration || forcedCurveMigration) && !this.hasMigrated) {
      this.hasMigrated = true;
      this.phase = 'MIGRATED';
      this.preMigrationFlowStrength = this.getFlowStrength();
      this.migrationFreezeLeftMs = 2_000 + this.rng.next() * 2_000;
      this.migrationShockLeftMs = getMigrationShockDurationMs(this.rng);
      // Seed post-migration liquidity from curve reserves to avoid first-tick teleport.
      const handoffLiquidity = Math.max(5_000, (this.curveVirtualBase + this.curveRealBase) * 3);
      this.baseLiquidityUsd = Math.max(this.baseLiquidityUsd, handoffLiquidity);
      this.marketRegime = 'MIGRATION_SHOCK';
      this.marketRegimeTtlSec = Math.max(this.marketRegimeTtlSec, this.migrationShockLeftMs / 1000);
      const outcome = decideMigrationOutcome(this.rng, {
        qualityScore: this.getDynamicQualityScore(this.preMigrationFlowStrength),
        preMigrationStrength: this.preMigrationFlowStrength,
        currentFlowStrength: this.getFlowStrength(),
      });
      this.migrationPostShockRegime =
        outcome === 'CONTINUATION' ? 'POST_MIGRATION_DISCOVERY' :
        outcome === 'VIOLENT_CHOP' ? 'CHOP' :
        'BLEED_OUT';
      return {
        tokenId: this.meta.id,
        tMs: candleTsMs,
        type: 'MIGRATION',
        price: migrationThresholdUsd / SUPPLY,
        mcap: migrationThresholdUsd,
      };
    }

    this.phase = this.hasEnteredFinal ? 'FINAL' : 'NEW';

    if (this.simTimeMs >= this.fateTimeoutSimMs) {
      if (this.ruggedAtSimMs == null) {
        this.ruggedAtSimMs = this.simTimeMs;
      }
      if (this.lastMcapUsd <= MCAP_FLOOR_USD) {
        this.phase = 'DEAD';
        this.lastMcapUsd = MCAP_FLOOR_USD;
        this.lastPriceUsd = MCAP_FLOOR_USD / SUPPLY;
      }
    }
    return null;
  }

  getRuntime(): TokenRuntime {
    const mcap = this.lastMcapUsd;
    const stats = this.getFlowWindowTotals();
    const changePct = this.getChangePct();

    return {
      phase: this.phase,
      simTimeMs: this.simTimeMs,
      lastPriceUsd: this.lastPriceUsd,
      mcapUsd: mcap,
      liquidityUsd: mcap * 0.15,
      bondingCurvePct: Math.min(100, this.bondingProgress * 100),
      vol5mUsd: stats.vol5mUsd,
      buys5m: stats.buys5m,
      sells5m: stats.sells5m,
      changePct,
      priceAtSpawn: this.priceAtSpawn,
      ruggedAtSimMs: this.ruggedAtSimMs,
    };
  }

  getMarketSnapshot(topLimit = 60, tradeLimit = 120): MarketMicroSnapshot {
    const holders: HolderRow[] = [];
    for (const [walletId, balanceTokens] of this.ledger.entries()) {
      if (!Number.isFinite(balanceTokens) || balanceTokens <= CURVE_TOKEN_EPS) continue;
      const balanceUsd = balanceTokens * this.lastPriceUsd;
      if (!Number.isFinite(balanceUsd) || balanceUsd < HOLDER_DUST_USD) continue;
      const profile = this.getOrCreateWalletProfile(walletId, this.spawnRealMs);
      const unrealizedUsd = balanceUsd - profile.openCostBasisUsd;
      holders.push({
        walletId,
        solBalance: profile.solBalance,
        firstSeenMs: profile.firstSeenMs,
        balanceTokens,
        balanceUsd,
        boughtUsd: profile.boughtUsd,
        boughtTokens: profile.boughtTokens,
        avgBuyUsd: profile.avgBuyUsd,
        soldUsd: profile.soldUsd,
        soldTokens: profile.soldTokens,
        avgSellUsd: profile.avgSellUsd,
        unrealizedPnlUsd: unrealizedUsd,
        realizedPnlUsd: profile.realizedPnlUsd,
        remainingUsd: balanceUsd,
        lastActiveMs: profile.lastActiveMs,
      });
    }

    const lpTokens = (!this.hasMigrated && this.phase !== 'MIGRATED')
      ? Math.max(0, this.curveRealToken)
      : Math.max(0, this.getMigratedReserves().reserveToken);
    const lpBaseUsd = (!this.hasMigrated && this.phase !== 'MIGRATED')
      ? Math.max(0, this.curveRealBase)
      : Math.max(0, this.getMigratedReserves().reserveBaseUsd);
    const lpUsd = lpTokens * this.lastPriceUsd;
    if (Number.isFinite(lpUsd) && lpUsd >= HOLDER_DUST_USD && lpTokens > CURVE_TOKEN_EPS) {
      holders.push({
        walletId: 'LIQUIDITY POOL',
        isLiquidityPool: true,
        solBalance: lpBaseUsd / Math.max(1e-9, SOL_PRICE_USD),
        firstSeenMs: this.spawnRealMs,
        balanceTokens: lpTokens,
        balanceUsd: lpUsd,
        boughtUsd: 0,
        boughtTokens: 0,
        avgBuyUsd: 0,
        soldUsd: 0,
        soldTokens: 0,
        avgSellUsd: 0,
        unrealizedPnlUsd: 0,
        realizedPnlUsd: 0,
        remainingUsd: lpUsd,
        lastActiveMs: this.walletLastActiveMs.get('LIQUIDITY_POOL') ?? this.spawnRealMs,
      });
    }

    holders.sort((a, b) => b.balanceUsd - a.balanceUsd);
    const topHolders = holders.slice(0, Math.max(1, Math.min(HOLDERS_TOP_N, topLimit)));

    const recentTrades = this.tape
      .slice(-Math.max(1, tradeLimit))
      .slice()
      .sort((a, b) => b.tMs - a.tMs);

    return {
      holdersCount: holders.length,
      topHolders,
      recentTrades,
      updatedAtMs: Date.now(),
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
  getLastMcapUsd(): number { return this.lastMcapUsd; }
  getCurveDebugSnapshot(): CurveDebugSnapshot {
    const k = this.curveVirtualBase * this.curveVirtualToken;
    return {
      phase: this.phase,
      hasEnteredFinal: this.hasEnteredFinal,
      hasMigrated: this.hasMigrated,
      progressNowPct: this.bondingProgress * 100,
      rTok: this.curveRealToken,
      rTok0: this.curveInitialRealToken,
      vTok: this.curveVirtualToken,
      vBase: this.curveVirtualBase,
      rBase: this.curveRealBase,
      k,
      kDriftPct: this.curveKStart > 0 ? ((k - this.curveKStart) / this.curveKStart) * 100 : 0,
      invalidState: this.invalidCurveState,
      priceCurveUsd: this.getCurvePriceUsd(),
      mcapCurveUsd: this.getCurveMcapUsd(),
      feeBps: CURVE_FEE_BPS,
      lastSwap: this.lastCurveSwap,
    };
  }

  quoteUserTrade(side: UserTradeSide, amountIn: number, slippageBps: number): UserTradeQuote {
    if (this.phase === 'RUGGED') this.phase = 'DEAD';
    if (!Number.isFinite(amountIn) || amountIn <= 0) {
      return { ok: false, side, amountIn, reason: 'Invalid amount' };
    }
    const clampedSlippageBps = clamp(
      Number.isFinite(slippageBps) ? slippageBps : 100,
      0,
      10_000
    );

    const expectedOut = this.estimateOut(side, amountIn);
    if (!Number.isFinite(expectedOut) || expectedOut <= 0) {
      return { ok: false, side, amountIn, reason: 'No liquidity' };
    }
    const minOut = expectedOut * (1 - clampedSlippageBps / 10_000);
    return {
      ok: true,
      side,
      amountIn,
      expectedOut,
      minOut: Math.max(0, minOut),
      slippageBps: clampedSlippageBps,
      priceUsd: this.lastPriceUsd,
      mcapUsd: this.lastMcapUsd,
      feeBps: CURVE_FEE_BPS,
      quoteTsMs: Date.now(),
    };
  }

  submitUserTrade(req: UserTradeSubmitRequest): UserTradeSubmitResult {
    const side = req.side;
    const amountIn = req.amountIn;
    if (this.phase === 'RUGGED') this.phase = 'DEAD';
    if (!Number.isFinite(amountIn) || amountIn <= 0) {
      return { ok: false, side, amountIn, reason: 'Invalid amount' };
    }

    const quote = this.quoteUserTrade(side, amountIn, req.slippageBps);
    if (!quote.ok) {
      return { ok: false, side, amountIn, reason: quote.reason };
    }

    const submitMs = Date.now();
    const prioritySol = Math.max(0, Number.isFinite(req.prioritySol) ? (req.prioritySol as number) : 0);
    const txCostSol = Math.max(0, Number.isFinite(req.txCostSol) ? (req.txCostSol as number) : 0);
    const latencyMs = this.resolveLatencyMs(prioritySol, req.latencyMs);
    const execMs = submitMs + latencyMs;
    const id = `U${submitMs.toString(36)}${Math.floor(this.rng.next() * 1e6).toString(36)}`;

    this.pendingUserOrders.push({
      id,
      side,
      amountIn,
      slippageBps: quote.slippageBps,
      expectedOut: quote.expectedOut,
      minOut: quote.minOut,
      submitMs,
      execMs,
      prioritySol,
      txCostSol,
    });

    return {
      ok: true,
      tokenId: this.meta.id,
      orderId: id,
      side,
      amountIn,
      expectedOut: quote.expectedOut,
      minOut: quote.minOut,
      slippageBps: quote.slippageBps,
      submitMs,
      execMs,
      latencyMs,
      prioritySol,
      txCostSol,
    };
  }

  getPendingUserOrderStatus(orderId: string): UserTradeOrderStatus | null {
    for (let i = 0; i < this.pendingUserOrders.length; i++) {
      const pending = this.pendingUserOrders[i]!;
      if (pending.id !== orderId) continue;
      return {
        tokenId: this.meta.id,
        orderId: pending.id,
        side: pending.side,
        status: 'PENDING',
        amountIn: pending.amountIn,
        expectedOut: pending.expectedOut,
        minOut: pending.minOut,
        slippageBps: pending.slippageBps,
        submitMs: pending.submitMs,
        execMs: pending.execMs,
        prioritySol: pending.prioritySol,
        txCostSol: pending.txCostSol,
      };
    }
    return null;
  }

  drainUserTradeExecutions(): UserTradeExecutionNotice[] {
    if (this.userTradeExecutions.length === 0) return [];
    const out = this.userTradeExecutions.slice();
    this.userTradeExecutions = [];
    return out;
  }

  private resolveLatencyMs(prioritySol: number, latencyOverride?: number): number {
    if (Number.isFinite(latencyOverride) && latencyOverride! > 0) {
      return clamp(Math.round(latencyOverride as number), MIN_EFFECTIVE_LATENCY_MS, 5_000);
    }
    const base = MIN_USER_LATENCY_MS + this.rng.next() * (MAX_USER_LATENCY_MS - MIN_USER_LATENCY_MS);
    const priorityCutMs = prioritySol * PRIORITY_LATENCY_IMPACT_MS_PER_SOL;
    const latencyMs = base - priorityCutMs;
    return clamp(Math.round(latencyMs), MIN_EFFECTIVE_LATENCY_MS, MAX_USER_LATENCY_MS);
  }

  private processPendingUserTrades(nowMs: number): TokenChartEvent[] {
    if (this.pendingUserOrders.length === 0) return [];

    const due: PendingUserOrder[] = [];
    const remaining: PendingUserOrder[] = [];
    for (let i = 0; i < this.pendingUserOrders.length; i++) {
      const order = this.pendingUserOrders[i]!;
      if (order.execMs <= nowMs) due.push(order);
      else remaining.push(order);
    }
    this.pendingUserOrders = remaining;
    if (due.length === 0) return [];

    due.sort((a, b) => {
      if (b.prioritySol !== a.prioritySol) return b.prioritySol - a.prioritySol;
      if (a.execMs !== b.execMs) return a.execMs - b.execMs;
      return a.submitMs - b.submitMs;
    });

    const outEvents: TokenChartEvent[] = [];
    for (let i = 0; i < due.length; i++) {
      const order = due[i]!;
      const execTsMs = Math.max(order.execMs, nowMs);
      const actualQuote = this.quoteUserTrade(order.side, order.amountIn, order.slippageBps);
      if (!actualQuote.ok) {
        this.userTradeExecutions.push({
          tokenId: this.meta.id,
          orderId: order.id,
          status: 'FAILED',
          side: order.side,
          amountIn: order.amountIn,
          expectedOut: order.expectedOut,
          minOut: order.minOut,
          actualOut: 0,
          slippageBps: order.slippageBps,
          submitMs: order.submitMs,
          execMs: execTsMs,
          prioritySol: order.prioritySol,
          txCostSol: order.txCostSol,
          reason: actualQuote.reason,
        });
        continue;
      }
      if (actualQuote.expectedOut < order.minOut) {
        this.userTradeExecutions.push({
          tokenId: this.meta.id,
          orderId: order.id,
          status: 'FAILED',
          side: order.side,
          amountIn: order.amountIn,
          expectedOut: order.expectedOut,
          minOut: order.minOut,
          actualOut: actualQuote.expectedOut,
          slippageBps: order.slippageBps,
          submitMs: order.submitMs,
          execMs: execTsMs,
          prioritySol: order.prioritySol,
          txCostSol: order.txCostSol,
          reason: 'Slippage exceeded (minOut)',
        });
        continue;
      }

      const execution = this.executeUserTradeImmediate(order.side, order.amountIn, execTsMs);
      if (!execution.fill.ok) {
        this.userTradeExecutions.push({
          tokenId: this.meta.id,
          orderId: order.id,
          status: 'FAILED',
          side: order.side,
          amountIn: order.amountIn,
          expectedOut: order.expectedOut,
          minOut: order.minOut,
          actualOut: actualQuote.expectedOut,
          slippageBps: order.slippageBps,
          submitMs: order.submitMs,
          execMs: execTsMs,
          prioritySol: order.prioritySol,
          txCostSol: order.txCostSol,
          reason: execution.fill.reason,
        });
        continue;
      }

      const fill = execution.fill;
      const actualOut = fill.side === 'BUY' ? fill.filledToken : fill.filledSol;
      this.userTradeExecutions.push({
        tokenId: this.meta.id,
        orderId: order.id,
        status: 'FILLED',
        side: order.side,
        amountIn: order.amountIn,
        expectedOut: order.expectedOut,
        minOut: order.minOut,
        actualOut,
        slippageBps: order.slippageBps,
        submitMs: order.submitMs,
        execMs: execTsMs,
        prioritySol: order.prioritySol,
        txCostSol: order.txCostSol,
        fill,
      });
      if (execution.events.length > 0) outEvents.push(...execution.events);
    }

    return outEvents;
  }

  private estimateOut(side: UserTradeSide, amountIn: number): number {
    if (side === 'BUY') {
      if (!this.hasMigrated && this.phase !== 'MIGRATED') {
        const grossInUsd = amountIn * SOL_PRICE_USD;
        return this.estimateCurveBuyOut(grossInUsd).tokensOut;
      }
      const grossInUsd = amountIn * SOL_PRICE_USD;
      return this.executeMigratedBuy(grossInUsd).tokensOut;
    }

    if (!this.hasMigrated && this.phase !== 'MIGRATED') {
      return this.estimateCurveSellOut(amountIn).baseOutUsd / SOL_PRICE_USD;
    }
    return this.executeMigratedSell(amountIn).baseOutNetUsd / SOL_PRICE_USD;
  }

  private executeUserTradeImmediate(side: UserTradeSide, amount: number, tsMs: number): {
    fill: UserTradeFill;
    events: TokenChartEvent[];
  } {
    if (this.phase === 'RUGGED') this.phase = 'DEAD';
    if (!Number.isFinite(amount) || amount <= 0) {
      return {
        fill: { ok: false, side, requestedAmount: amount, reason: 'Invalid amount' },
        events: [],
      };
    }

    const priceBeforeUsd = this.lastPriceUsd;
    const mcapBeforeUsd = this.lastMcapUsd;
    const feeFactor = 1 - CURVE_FEE_BPS / 10_000;

    let filledSol = 0;
    let filledToken = 0;
    let filledUsd = 0;
    let feeUsd = 0;

    if (!this.hasMigrated && this.phase !== 'MIGRATED') {
      this.sanitizeCurveState();
      if (side === 'BUY') {
        const grossInUsd = amount * SOL_PRICE_USD;
        const buy = this.executeCurveBuy(grossInUsd);
        if (buy.baseInUsd <= 0 || buy.tokensOut <= 0) {
          return {
            fill: { ok: false, side, requestedAmount: amount, reason: 'No liquidity' },
            events: [],
          };
        }
        const grossUsedUsd = buy.baseInUsd / feeFactor;
        filledSol = grossUsedUsd / SOL_PRICE_USD;
        filledToken = buy.tokensOut;
        filledUsd = grossUsedUsd;
        feeUsd = Math.max(0, grossUsedUsd - buy.baseInUsd);
      } else {
        const sell = this.executeCurveSell(amount);
        if (sell.baseOutUsd <= 0 || sell.tokenIn <= 0) {
          return {
            fill: { ok: false, side, requestedAmount: amount, reason: 'No liquidity' },
            events: [],
          };
        }
        const grossOutUsd = sell.baseOutUsd / feeFactor;
        filledSol = sell.baseOutUsd / SOL_PRICE_USD;
        filledToken = sell.tokenIn;
        filledUsd = sell.baseOutUsd;
        feeUsd = Math.max(0, grossOutUsd - sell.baseOutUsd);
      }
      this.sanitizeCurveState();
      this.bondingProgress = this.getCurveProgress();
      this.lastPriceUsd = this.getCurvePriceUsd();
      this.lastMcapUsd = this.getCurveMcapUsd();
    } else {
      if (side === 'BUY') {
        const grossInUsd = amount * SOL_PRICE_USD;
        const buy = this.executeMigratedBuy(grossInUsd);
        if (buy.baseInGrossUsd <= 0 || buy.tokensOut <= 0) {
          return {
            fill: { ok: false, side, requestedAmount: amount, reason: 'No liquidity' },
            events: [],
          };
        }
        filledSol = buy.baseInGrossUsd / SOL_PRICE_USD;
        filledToken = buy.tokensOut;
        filledUsd = buy.baseInGrossUsd;
        feeUsd = Math.max(0, buy.baseInGrossUsd - buy.baseInNetUsd);
        const mcapUsd = this.clampMcapUsd(buy.priceAfterUsd * SUPPLY);
        this.lastMcapUsd = mcapUsd;
        this.lastPriceUsd = mcapUsd / SUPPLY;
      } else {
        const sell = this.executeMigratedSell(amount);
        if (sell.baseOutNetUsd <= 0 || sell.tokenIn <= 0) {
          return {
            fill: { ok: false, side, requestedAmount: amount, reason: 'No liquidity' },
            events: [],
          };
        }
        filledSol = sell.baseOutNetUsd / SOL_PRICE_USD;
        filledToken = sell.tokenIn;
        filledUsd = sell.baseOutNetUsd;
        feeUsd = Math.max(0, sell.baseOutGrossUsd - sell.baseOutNetUsd);
        const mcapUsd = this.clampMcapUsd(sell.priceAfterUsd * SUPPLY);
        this.lastMcapUsd = mcapUsd;
        this.lastPriceUsd = mcapUsd / SUPPLY;
      }
    }

    const priceAfterUsd = this.lastPriceUsd;
    const mcapAfterUsd = this.lastMcapUsd;
    const avgPriceUsd = filledToken > 0 ? (filledUsd / filledToken) : 0;
    const impactPct = priceBeforeUsd > 0
      ? ((priceAfterUsd - priceBeforeUsd) / priceBeforeUsd) * 100
      : 0;
    const notionalUsd = Math.max(0, filledUsd);
    const walletId = 'you';
    if (side === 'BUY') this.applyWalletDelta(walletId, filledToken, tsMs);
    else this.applyWalletDelta(walletId, -filledToken, tsMs);

    this.recordTradeTick(tsMs, notionalUsd, side, walletId, filledToken);

    const events: TokenChartEvent[] = [];
    const maybeMigrationEvent = this.updatePhase(tsMs);
    if (maybeMigrationEvent) events.push(maybeMigrationEvent);

    return {
      fill: {
        ok: true,
        side,
        requestedAmount: amount,
        filledSol,
        filledToken,
        filledUsd,
        feeUsd,
        avgPriceUsd,
        priceBeforeUsd,
        priceAfterUsd,
        impactPct,
        mcapBeforeUsd,
        mcapAfterUsd,
        tsMs,
      },
      events,
    };
  }

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
        initialRealTokenRatioMin: 0.9,
        initialRealTokenRatioMax: 0.98,
        virtualTokenLiquidityMulMin: 1.15,
        virtualTokenLiquidityMulMax: 1.4,
      };
    }
    if (archetype === 'SLOW_COOK') {
      return {
        lambdaMul: 0.9,
        volMul: 0.85,
        driftBiasPerSec: 0.0015,
        maxDevEvents: 3,
        initialRealTokenRatioMin: 0.72,
        initialRealTokenRatioMax: 0.9,
        virtualTokenLiquidityMulMin: 1.1,
        virtualTokenLiquidityMulMax: 1.35,
      };
    }
    if (archetype === 'CHAOS') {
      return {
        lambdaMul: 1.35,
        volMul: 1.4,
        driftBiasPerSec: 0.003,
        maxDevEvents: 5,
        initialRealTokenRatioMin: 0.42,
        initialRealTokenRatioMax: 0.62,
        virtualTokenLiquidityMulMin: 1.05,
        virtualTokenLiquidityMulMax: 1.2,
      };
    }
    return {
      lambdaMul: 1,
      volMul: 0.85,
      driftBiasPerSec: 0.0015,
      maxDevEvents: 3,
      initialRealTokenRatioMin: 0.52,
      initialRealTokenRatioMax: 0.74,
      virtualTokenLiquidityMulMin: 1.08,
      virtualTokenLiquidityMulMax: 1.28,
    };
  }

  private initCurveState(startMcapUsd: number): void {
    const initialRatio = this.archetypeProfile.initialRealTokenRatioMin
      + (this.archetypeProfile.initialRealTokenRatioMax - this.archetypeProfile.initialRealTokenRatioMin) * this.rng.next();
    const virtualMul = this.archetypeProfile.virtualTokenLiquidityMulMin
      + (this.archetypeProfile.virtualTokenLiquidityMulMax - this.archetypeProfile.virtualTokenLiquidityMulMin) * this.rng.next();
    const startPrice = Math.max(1e-12, startMcapUsd / SUPPLY);

    this.curveInitialRealToken = Math.max(CURVE_TOKEN_EPS, SUPPLY * clamp(initialRatio, 0.05, 0.99));
    this.curveRealToken = this.curveInitialRealToken;
    this.curveVirtualToken = Math.max(CURVE_TOKEN_EPS, this.curveInitialRealToken * Math.max(1.01, virtualMul));
    this.curveVirtualBase = Math.max(1, startPrice * this.curveVirtualToken);
    this.curveRealBase = Math.max(0, startMcapUsd * 0.02);
    this.curveKStart = this.curveVirtualBase * this.curveVirtualToken;
    this.invalidCurveState = false;
    this.bondingProgress = 0;
  }

  private getCurvePriceUsd(): number {
    return this.curveVirtualBase / Math.max(CURVE_TOKEN_EPS, this.curveVirtualToken);
  }

  private getCurveMcapUsd(): number {
    return this.clampMcapUsd(this.getCurvePriceUsd() * SUPPLY);
  }

  private getSoftMcapTargetUsd(): number {
    if (this.meta.fate === 'QUICK_RUG') return QUICK_RUG_SOFT_MCAP_USD;
    if (this.meta.fate === 'LONG_RUNNER') return LONG_RUNNER_SOFT_MCAP_USD;
    if (this.meta.fate === 'SHORT') return SHORT_SOFT_MCAP_USD;
    return NORMAL_SOFT_MCAP_USD;
  }

  private getMcapHeat(): number {
    const target = this.getSoftMcapTargetUsd();
    if (this.lastMcapUsd <= target) return 0;
    const over = (this.lastMcapUsd - target) / Math.max(1, target);
    return clamp(over / 0.75, 0, 3);
  }

  private getChangePct(): number {
    if (this.priceAtSpawn <= 0) return 0;
    return ((this.lastPriceUsd - this.priceAtSpawn) / this.priceAtSpawn) * 100;
  }

  private getFlowWindowTotals(): { vol5mUsd: number; buys5m: number; sells5m: number } {
    let vol5mUsd = 0;
    let buys5m = 0;
    let sells5m = 0;
    for (let i = 0; i < this.statWindow.length; i++) {
      vol5mUsd += this.statWindow[i]!.volUsd;
      buys5m += this.statWindow[i]!.buys;
      sells5m += this.statWindow[i]!.sells;
    }
    return { vol5mUsd, buys5m, sells5m };
  }

  private getFlowStrength(): number {
    const stats = this.getFlowWindowTotals();
    return computeFlowStrength({
      vol5mUsd: stats.vol5mUsd,
      buys5m: stats.buys5m,
      sells5m: stats.sells5m,
      mcapUsd: this.lastMcapUsd,
      changePct: this.getChangePct(),
    });
  }

  private getDynamicQualityScore(flowStrength = this.getFlowStrength()): number {
    const finalBoost = this.hasEnteredFinal ? 0.03 : 0;
    const migrationBoost = this.phase === 'MIGRATED' ? 0.04 : 0;
    const heatPenalty = this.getMcapHeat() * 0.07;
    return clamp(
      this.baseQualityScore
      + finalBoost
      + migrationBoost
      + Math.max(0, this.preMigrationFlowStrength) * 0.05
      + flowStrength * 0.08
      - heatPenalty,
      0.03,
      0.97
    );
  }

  private getRecentTradeStatsReal(windowMs: number, nowMs: number): { tx: number; buys: number; sells: number } {
    const cutoff = nowMs - windowMs;
    let tx = 0;
    let buys = 0;
    let sells = 0;
    for (let i = this.tape.length - 1; i >= 0; i--) {
      const trade = this.tape[i]!;
      if (trade.tMs < cutoff) break;
      tx += 1;
      if (trade.side === 'BUY') buys += 1;
      else sells += 1;
    }
    return { tx, buys, sells };
  }

  private getEligibleHolderCount(): number {
    return this.getHolderWalletIds(false).length;
  }

  private updateMigrationEligibility(nowMs: number): void {
    const secondBucket = Math.floor(nowMs / 1000);
    if (secondBucket === this.lastMigrationEligibilitySecond) return;
    this.lastMigrationEligibilitySecond = secondBucket;

    const migrationThresholdUsd = getMigrationThresholdUsd();
    const ageSec = (nowMs - this.spawnRealMs) / 1000;
    const tx60s = this.getRecentTradeStatsReal(60_000, nowMs).tx;
    const holders = this.getEligibleHolderCount();
    const aboveThreshold = this.lastMcapUsd >= migrationThresholdUsd;
    const eligible =
      aboveThreshold
      && ageSec >= MIN_MIGRATION_AGE_SEC
      && tx60s >= MIN_MIGRATION_TX_60S
      && holders >= MIN_MIGRATION_HOLDERS;

    if (eligible) this.migrationEligibilityStreak += 1;
    else this.migrationEligibilityStreak = 0;
  }

  private getFlowPowerMul(): number {
    if (this.meta.fate === 'QUICK_RUG') return 1.12;

    const ramp = 0.35 + 0.65 * clamp(this.simTimeMs / FLOW_WARMUP_SIM_MS, 0, 1);
    if (this.meta.fate === 'LONG_RUNNER') return 0.74 * ramp;
    if (this.meta.fate === 'NORMAL') return 0.54 * ramp;
    return 0.4 * ramp;
  }

  private getDevFlowPowerMul(): number {
    if (this.meta.fate === 'QUICK_RUG') return 1.2;

    const ramp = 0.4 + 0.6 * clamp(this.simTimeMs / DEV_WARMUP_SIM_MS, 0, 1);
    if (this.meta.fate === 'LONG_RUNNER') return 0.8 * ramp;
    if (this.meta.fate === 'NORMAL') return 0.65 * ramp;
    return 0.5 * ramp;
  }

  private clampMcapUsd(mcapUsd: number): number {
    return clamp(mcapUsd, MCAP_FLOOR_USD, MCAP_CAP_USD);
  }

  private getCurveProgress(): number {
    return clamp(1 - (this.curveRealToken / Math.max(CURVE_TOKEN_EPS, this.curveInitialRealToken)), 0, 1);
  }

  private estimateCurveBuyOut(grossBaseInUsd: number): { tokensOut: number; baseInUsedUsd: number } {
    if (!Number.isFinite(grossBaseInUsd) || grossBaseInUsd <= 0 || this.curveRealToken <= CURVE_TOKEN_EPS) {
      return { tokensOut: 0, baseInUsedUsd: 0 };
    }
    const feeFactor = 1 - CURVE_FEE_BPS / 10_000;
    const netBaseIn = grossBaseInUsd * feeFactor;
    if (netBaseIn <= 0) return { tokensOut: 0, baseInUsedUsd: 0 };

    const x = Math.max(CURVE_TOKEN_EPS, this.curveVirtualBase);
    const y = Math.max(CURVE_TOKEN_EPS, this.curveVirtualToken);
    const k = x * y;
    if (!Number.isFinite(k) || k <= 0) return { tokensOut: 0, baseInUsedUsd: 0 };

    const newX = x + netBaseIn;
    if (!Number.isFinite(newX) || newX <= CURVE_TOKEN_EPS) return { tokensOut: 0, baseInUsedUsd: 0 };
    const newY = k / newX;
    if (!Number.isFinite(newY)) return { tokensOut: 0, baseInUsedUsd: 0 };

    let tokensOut = y - newY;
    let netBaseUsed = netBaseIn;
    const maxTokensOut = Math.max(0, Math.min(this.curveRealToken, y - CURVE_TOKEN_EPS));
    tokensOut = clamp(tokensOut, 0, maxTokensOut);

    if (tokensOut > this.curveRealToken) {
      tokensOut = this.curveRealToken;
      const cappedY = y - tokensOut;
      const cappedX = k / Math.max(CURVE_TOKEN_EPS, cappedY);
      netBaseUsed = Math.max(0, cappedX - x);
    }
    if (tokensOut <= 0 || netBaseUsed <= 0) return { tokensOut: 0, baseInUsedUsd: 0 };

    const grossBaseUsed = netBaseUsed / feeFactor;
    return { tokensOut, baseInUsedUsd: grossBaseUsed };
  }

  private estimateCurveSellOut(tokenIn: number): { tokenIn: number; baseOutUsd: number } {
    if (!Number.isFinite(tokenIn) || tokenIn <= 0 || this.curveRealBase <= 0) {
      return { tokenIn: 0, baseOutUsd: 0 };
    }

    const cappedTokenIn = Math.min(tokenIn, this.curveInitialRealToken - this.curveRealToken);
    if (cappedTokenIn <= 0) return { tokenIn: 0, baseOutUsd: 0 };

    const feeFactor = 1 - CURVE_FEE_BPS / 10_000;
    const x = Math.max(CURVE_TOKEN_EPS, this.curveVirtualBase);
    const y = Math.max(CURVE_TOKEN_EPS, this.curveVirtualToken);
    const k = x * y;
    if (!Number.isFinite(k) || k <= 0) return { tokenIn: 0, baseOutUsd: 0 };

    const newY = y + cappedTokenIn;
    if (!Number.isFinite(newY) || newY <= CURVE_TOKEN_EPS) return { tokenIn: 0, baseOutUsd: 0 };
    const newX = k / newY;
    if (!Number.isFinite(newX)) return { tokenIn: 0, baseOutUsd: 0 };

    const grossBaseOut = Math.max(0, x - newX);
    let baseOut = grossBaseOut * feeFactor;
    if (baseOut <= 0) return { tokenIn: 0, baseOutUsd: 0 };
    if (baseOut > this.curveRealBase) baseOut = this.curveRealBase;
    if (baseOut <= 0) return { tokenIn: 0, baseOutUsd: 0 };

    return { tokenIn: cappedTokenIn, baseOutUsd: baseOut };
  }

  private executeCurveBuy(grossBaseInUsd: number): { baseInUsd: number; tokensOut: number } {
    if (!Number.isFinite(grossBaseInUsd) || grossBaseInUsd <= 0 || this.curveRealToken <= CURVE_TOKEN_EPS) {
      return { baseInUsd: 0, tokensOut: 0 };
    }

    const feeFactor = 1 - CURVE_FEE_BPS / 10_000;
    const netBaseIn = grossBaseInUsd * feeFactor;
    if (netBaseIn <= 0) return { baseInUsd: 0, tokensOut: 0 };

    const x = Math.max(CURVE_TOKEN_EPS, this.curveVirtualBase);
    const y = Math.max(CURVE_TOKEN_EPS, this.curveVirtualToken);
    const k = x * y;
    if (!Number.isFinite(k) || k <= 0) {
      this.invalidCurveState = true;
      return { baseInUsd: 0, tokensOut: 0 };
    }
    const newX = x + netBaseIn;
    if (!Number.isFinite(newX) || newX <= CURVE_TOKEN_EPS) {
      this.invalidCurveState = true;
      return { baseInUsd: 0, tokensOut: 0 };
    }
    const newY = k / newX;
    if (!Number.isFinite(newY)) {
      this.invalidCurveState = true;
      return { baseInUsd: 0, tokensOut: 0 };
    }
    let tokensOut = y - newY;
    let netBaseUsed = netBaseIn;
    const maxTokensOut = Math.max(0, Math.min(this.curveRealToken, y - CURVE_TOKEN_EPS));
    tokensOut = clamp(tokensOut, 0, maxTokensOut);

    if (tokensOut > this.curveRealToken) {
      tokensOut = this.curveRealToken;
      const cappedY = y - tokensOut;
      const cappedX = k / Math.max(CURVE_TOKEN_EPS, cappedY);
      netBaseUsed = Math.max(0, cappedX - x);
    }
    if (tokensOut <= 0 || netBaseUsed <= 0) return { baseInUsd: 0, tokensOut: 0 };

    this.curveVirtualBase = x + netBaseUsed;
    this.curveVirtualToken = Math.max(CURVE_TOKEN_EPS, y - tokensOut);
    this.curveRealToken = Math.max(0, this.curveRealToken - tokensOut);
    this.curveRealBase += netBaseUsed;
    return { baseInUsd: netBaseUsed, tokensOut };
  }

  private executeCurveSell(tokenIn: number): { tokenIn: number; baseOutUsd: number } {
    if (!Number.isFinite(tokenIn) || tokenIn <= 0 || this.curveRealBase <= 0) return { tokenIn: 0, baseOutUsd: 0 };

    const cappedTokenIn = Math.min(tokenIn, this.curveInitialRealToken - this.curveRealToken);
    if (cappedTokenIn <= 0) return { tokenIn: 0, baseOutUsd: 0 };

    const feeFactor = 1 - CURVE_FEE_BPS / 10_000;
    const x = Math.max(CURVE_TOKEN_EPS, this.curveVirtualBase);
    const y = Math.max(CURVE_TOKEN_EPS, this.curveVirtualToken);
    const k = x * y;
    if (!Number.isFinite(k) || k <= 0) {
      this.invalidCurveState = true;
      return { tokenIn: 0, baseOutUsd: 0 };
    }
    const newY = y + cappedTokenIn;
    if (!Number.isFinite(newY) || newY <= CURVE_TOKEN_EPS) {
      this.invalidCurveState = true;
      return { tokenIn: 0, baseOutUsd: 0 };
    }
    const newX = k / newY;
    if (!Number.isFinite(newX)) {
      this.invalidCurveState = true;
      return { tokenIn: 0, baseOutUsd: 0 };
    }
    const grossBaseOut = Math.max(0, x - newX);
    let baseOut = grossBaseOut * feeFactor;
    if (baseOut <= 0) return { tokenIn: 0, baseOutUsd: 0 };

    if (baseOut > this.curveRealBase) {
      baseOut = this.curveRealBase;
    }
    if (baseOut <= 0) return { tokenIn: 0, baseOutUsd: 0 };

    const grossUsed = baseOut / feeFactor;
    if (!Number.isFinite(grossUsed) || grossUsed <= 0) {
      this.invalidCurveState = true;
      return { tokenIn: 0, baseOutUsd: 0 };
    }
    this.curveVirtualBase = Math.max(CURVE_TOKEN_EPS, x - grossUsed);
    this.curveVirtualToken = y + cappedTokenIn;
    this.curveRealBase = Math.max(0, this.curveRealBase - baseOut);
    this.curveRealToken = Math.min(this.curveInitialRealToken, this.curveRealToken + cappedTokenIn);
    return { tokenIn: cappedTokenIn, baseOutUsd: baseOut };
  }

  private executeMigratedBuy(grossBaseInUsd: number): {
    baseInGrossUsd: number;
    baseInNetUsd: number;
    tokensOut: number;
    priceAfterUsd: number;
  } {
    if (!Number.isFinite(grossBaseInUsd) || grossBaseInUsd <= 0) {
      return { baseInGrossUsd: 0, baseInNetUsd: 0, tokensOut: 0, priceAfterUsd: this.lastPriceUsd };
    }

    const feeFactor = 1 - CURVE_FEE_BPS / 10_000;
    const netBaseIn = grossBaseInUsd * feeFactor;
    if (netBaseIn <= 0) {
      return { baseInGrossUsd: 0, baseInNetUsd: 0, tokensOut: 0, priceAfterUsd: this.lastPriceUsd };
    }

    const { reserveBaseUsd: x, reserveToken: y } = this.getMigratedReserves();
    const k = x * y;
    if (!Number.isFinite(k) || k <= 0) {
      return { baseInGrossUsd: 0, baseInNetUsd: 0, tokensOut: 0, priceAfterUsd: this.lastPriceUsd };
    }

    const newX = x + netBaseIn;
    const newY = k / newX;
    const tokensOut = Math.max(0, y - newY);
    const priceAfterUsd = newX / Math.max(CURVE_TOKEN_EPS, newY);
    if (!Number.isFinite(tokensOut) || !Number.isFinite(priceAfterUsd) || tokensOut <= 0) {
      return { baseInGrossUsd: 0, baseInNetUsd: 0, tokensOut: 0, priceAfterUsd: this.lastPriceUsd };
    }

    return {
      baseInGrossUsd: grossBaseInUsd,
      baseInNetUsd: netBaseIn,
      tokensOut,
      priceAfterUsd: Math.max(1e-12, priceAfterUsd),
    };
  }

  private executeMigratedSell(tokenIn: number): {
    tokenIn: number;
    baseOutGrossUsd: number;
    baseOutNetUsd: number;
    priceAfterUsd: number;
  } {
    if (!Number.isFinite(tokenIn) || tokenIn <= 0) {
      return { tokenIn: 0, baseOutGrossUsd: 0, baseOutNetUsd: 0, priceAfterUsd: this.lastPriceUsd };
    }

    const feeFactor = 1 - CURVE_FEE_BPS / 10_000;
    const { reserveBaseUsd: x, reserveToken: y } = this.getMigratedReserves();
    const k = x * y;
    if (!Number.isFinite(k) || k <= 0) {
      return { tokenIn: 0, baseOutGrossUsd: 0, baseOutNetUsd: 0, priceAfterUsd: this.lastPriceUsd };
    }

    const newY = y + tokenIn;
    const newX = k / newY;
    const baseOutGrossUsd = Math.max(0, x - newX);
    const baseOutNetUsd = baseOutGrossUsd * feeFactor;
    const priceAfterUsd = newX / Math.max(CURVE_TOKEN_EPS, newY);
    if (!Number.isFinite(baseOutNetUsd) || !Number.isFinite(priceAfterUsd) || baseOutNetUsd <= 0) {
      return { tokenIn: 0, baseOutGrossUsd: 0, baseOutNetUsd: 0, priceAfterUsd: this.lastPriceUsd };
    }

    return {
      tokenIn,
      baseOutGrossUsd,
      baseOutNetUsd,
      priceAfterUsd: Math.max(1e-12, priceAfterUsd),
    };
  }

  private getMigratedReserves(): { reserveBaseUsd: number; reserveToken: number } {
    const phaseModel = this.getPhaseModel();
    const referenceLiquidityUsd = Math.max(
      MIGRATED_LIQUIDITY_FLOOR_USD,
      this.baseLiquidityUsd * phaseModel.liquidityMul
    );
    const reserveBaseUsd = Math.max(1, referenceLiquidityUsd * 0.5);
    const reserveToken = Math.max(
      CURVE_TOKEN_EPS,
      reserveBaseUsd / Math.max(1e-12, this.lastPriceUsd)
    );
    return { reserveBaseUsd, reserveToken };
  }

  private recordTradeTick(
    candleTsMs: number,
    volumeUsd: number,
    side: UserTradeSide,
    walletId: string,
    tokenAmount: number
  ): void {
    this.aggr1s.pushTick(candleTsMs, this.lastPriceUsd, volumeUsd);
    this.aggr15s.pushTick(candleTsMs, this.lastPriceUsd, volumeUsd);
    this.aggr30s.pushTick(candleTsMs, this.lastPriceUsd, volumeUsd);
    this.aggr1m.pushTick(candleTsMs, this.lastPriceUsd, volumeUsd);
    this.mcapAggr1s.pushTick(candleTsMs, this.lastMcapUsd, volumeUsd);
    this.mcapAggr15s.pushTick(candleTsMs, this.lastMcapUsd, volumeUsd);
    this.mcapAggr30s.pushTick(candleTsMs, this.lastMcapUsd, volumeUsd);
    this.mcapAggr1m.pushTick(candleTsMs, this.lastMcapUsd, volumeUsd);

    this.statWindow.push({
      simMs: this.simTimeMs,
      volUsd: volumeUsd,
      buys: side === 'BUY' ? 1 : 0,
      sells: side === 'SELL' ? 1 : 0,
    });
    this.pruneStatWindow();

    this.recordWalletTradeStats(
      walletId,
      side,
      Math.max(0, tokenAmount),
      Math.max(0, volumeUsd),
      this.lastPriceUsd,
      candleTsMs
    );

    this.tape.push({
      id: `T${candleTsMs.toString(36)}${Math.floor(this.rng.next() * 1e7).toString(36)}`,
      tMs: candleTsMs,
      side,
      walletId,
      tokenAmount: Math.max(0, tokenAmount),
      notionalUsd: Math.max(0, volumeUsd),
      priceUsd: this.lastPriceUsd,
      mcapUsd: this.lastMcapUsd,
    });
    if (this.tape.length > TAPE_MAX_TRADES) {
      this.tape.splice(0, this.tape.length - TAPE_MAX_TRADES);
    }
  }

  private pruneStatWindow(): void {
    const cutoff = this.simTimeMs - this.WINDOW_SIM_MS;
    let i = 0;
    while (i < this.statWindow.length && this.statWindow[i]!.simMs < cutoff) i++;
    if (i > 0) this.statWindow.splice(0, i);
  }

  private sanitizeCurveState(): void {
    const valid =
      Number.isFinite(this.curveVirtualBase)
      && Number.isFinite(this.curveVirtualToken)
      && Number.isFinite(this.curveRealBase)
      && Number.isFinite(this.curveRealToken)
      && Number.isFinite(this.curveInitialRealToken);
    if (!valid) this.invalidCurveState = true;

    this.curveInitialRealToken = Math.max(CURVE_TOKEN_EPS, Number.isFinite(this.curveInitialRealToken) ? this.curveInitialRealToken : CURVE_TOKEN_EPS);
    this.curveVirtualToken = Math.max(CURVE_TOKEN_EPS, Number.isFinite(this.curveVirtualToken) ? this.curveVirtualToken : CURVE_TOKEN_EPS);
    this.curveVirtualBase = Math.max(CURVE_TOKEN_EPS, Number.isFinite(this.curveVirtualBase) ? this.curveVirtualBase : CURVE_TOKEN_EPS);
    this.curveRealBase = Math.max(0, Number.isFinite(this.curveRealBase) ? this.curveRealBase : 0);
    this.curveRealToken = clamp(
      Number.isFinite(this.curveRealToken) ? this.curveRealToken : 0,
      0,
      this.curveInitialRealToken
    );
  }
}
