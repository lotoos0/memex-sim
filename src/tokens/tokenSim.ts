import { RNG } from '../engine/rng';
import { CandleAggregator } from '../engine/aggregator';
import type { TokenMeta, TokenRuntime, TokenPhase } from './types';
import {
  SUPPLY, MCAP_FLOOR_USD, MCAP_CAP_USD, SIM_TIME_MULTIPLIER, SOL_PRICE_USD,
} from './types';
import { stepMarket, type FlowRegime } from './marketModel';
import type { TokenChartEvent } from '../chart/tokenChartEvents';
import { SESSION_SIM_PROFILE, getSessionBucket, type SessionBucket, type SessionSimProfile } from '../market/session';

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
  migrationChaosChance: number;
  deathSpiralChance: number;
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
const MIGRATE_PROGRESS = 1.0;
const CURVE_FEE_BPS = 100;
const CURVE_TOKEN_EPS = 1e-6;
const POST_MIGRATION_WARMUP_MS = 1_500;
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
  private postMigrationWarmupMs = 0;
  private deathSpiralLeftMs = 0;
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
    this.rollRegime(this.getSessionProfile());

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
    if (this.phase === 'RUGGED' || this.phase === 'DEAD') {
      if (this.pendingUserOrders.length > 0) {
        const nowMs = Date.now();
        for (let i = 0; i < this.pendingUserOrders.length; i++) {
          const order = this.pendingUserOrders[i]!;
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
            execMs: nowMs,
            prioritySol: order.prioritySol,
            txCostSol: order.txCostSol,
            reason: 'Token unavailable',
          });
        }
        this.pendingUserOrders = [];
      }
      return [];
    }

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

    this.advanceRegime(realDtSec, sessionProfile);
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
    let effectiveBuyBias = clamp(regimeBuyBias + sessionProfile.buyBiasShift, 0.14, 0.86);
    const inPostMigrationWarmup = this.phase === 'MIGRATED' && this.postMigrationWarmupMs > 0;

    lambdaMul *= this.archetypeProfile.lambdaMul;
    volMul *= this.archetypeProfile.volMul;
    lambdaMul *= sessionProfile.tempoMul;
    volMul *= Math.max(0.6, 0.9 + (sessionProfile.tempoMul - 1) * 0.45);

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
    if (inPostMigrationWarmup) {
      this.postMigrationWarmupMs = Math.max(0, this.postMigrationWarmupMs - realDtSec * 1000);
      volMul *= 0.5;
      lambdaMul *= 0.9;
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

    const heatRatio = mcapHeat / (1 + mcapHeat);
    const sessionTradeSizeMul = 0.6 + sessionProfile.tempoMul * 0.4;
    const tradeSizeMul = Math.max(0.12, flowPowerMul * (1 - 0.45 * heatRatio) * sessionTradeSizeMul);
    const impactMul = Math.max(
      0.45,
      (0.75 + 0.25 * flowPowerMul - 0.2 * heatRatio) * (0.78 + 0.28 * sessionProfile.whaleMul)
    );

    const liquidityUsd = this.baseLiquidityUsd * liquidityMul;
    const candleTsMs = nowMs;
    const isLaunchTick = !this.emittedInitialDevBuy;
    const devFlow = this.buildDevFlow(
      candleTsMs,
      realDtSec,
      effectiveBuyBias,
      isLaunchTick,
      !inPostMigrationWarmup
    );
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
      baseTradeSizeUsd: this.baseTradeSizeUsd * tradeSizeMul,
      tradeSigma: this.tradeSigma,
      driftPerSec,
      volatilityPerSqrtSec: isLaunchTick ? 0 : this.baseVol * volMul,
      buyBias: effectiveBuyBias,
      impactK: this.impactK * impactMul,
      whaleChance: (isLaunchTick || inPostMigrationWarmup) ? 0 : this.getWhaleChance(inMigrationChaos, sessionProfile),
      externalFlow: devFlow?.externalFlow,
    });

    this.executeMarketFlowAsTape({
      candleTsMs,
      realDtSec,
      targetBuyUsd: market.buyUsd,
      targetSellUsd: market.sellUsd,
      expectedNextPriceUsd: market.nextPriceUsd,
      previousPriceUsd: prevPriceUsd,
    });

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
  }): void {
    const targetBuyUsd = Math.max(0, Number.isFinite(input.targetBuyUsd) ? input.targetBuyUsd : 0);
    const targetSellUsd = Math.max(0, Number.isFinite(input.targetSellUsd) ? input.targetSellUsd : 0);
    const totalUsd = targetBuyUsd + targetSellUsd;
    if (totalUsd <= 1e-6) {
      this.recordPassiveTick(input.candleTsMs);
      return;
    }

    const targetTrades = clamp(
      Math.round(6 + Math.sqrt(totalUsd / Math.max(25, this.baseTradeSizeUsd)) * 6 + this.rng.next() * 8),
      4,
      40
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

    const buyParts = this.splitNotional(targetBuyUsd, buyTrades);
    const sellParts = this.splitNotional(targetSellUsd, sellTrades);
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
        if (this.executeSimBuyTrade(targetUsd, tsMs)) executedTrades += 1;
        continue;
      }

      const targetUsd = sellParts[sellIdx++] ?? 0;
      const sellOk = this.executeSimSellTrade(targetUsd, tsMs);
      if (sellOk) {
        executedTrades += 1;
        continue;
      }
      // If inventory is exhausted, keep tape alive by converting the slot to a small buy.
      if (targetUsd > 0 && this.executeSimBuyTrade(targetUsd * (0.65 + this.rng.next() * 0.35), tsMs)) {
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
        if (this.executeSimBuyTrade(steeringNotional, steeringTs)) executedTrades += 1;
      } else if (this.executeSimSellTrade(steeringNotional, steeringTs)) {
        executedTrades += 1;
      }
    }

    if (executedTrades === 0) {
      this.recordPassiveTick(input.candleTsMs);
    }
  }

  private splitNotional(totalUsd: number, parts: number): number[] {
    if (!Number.isFinite(totalUsd) || totalUsd <= 0 || parts <= 0) return [];
    if (parts === 1) return [totalUsd];
    const weights: number[] = [];
    let sum = 0;
    for (let i = 0; i < parts; i++) {
      const w = 0.35 + this.rng.next() * 1.35;
      weights.push(w);
      sum += w;
    }
    if (sum <= 0) return [totalUsd];

    const out: number[] = [];
    let used = 0;
    for (let i = 0; i < parts - 1; i++) {
      const v = totalUsd * (weights[i]! / sum);
      out.push(v);
      used += v;
    }
    out.push(Math.max(0, totalUsd - used));
    return out;
  }

  private executeSimBuyTrade(targetUsd: number, tsMs: number): boolean {
    const grossInUsd = Math.max(0, Number.isFinite(targetUsd) ? targetUsd : 0);
    if (grossInUsd <= 0) return false;

    const walletId = this.pickWalletForBuy();

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

  private executeSimSellTrade(targetUsd: number, tsMs: number): boolean {
    const desiredUsd = Math.max(0, Number.isFinite(targetUsd) ? targetUsd : 0);
    if (desiredUsd <= 0) return false;

    const walletId = this.pickWalletForSell();
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

  private pickWalletForBuy(): string {
    const holders = this.getHolderWalletIds(true);
    if (holders.length > 0 && this.rng.next() < 0.74) {
      return holders[Math.floor(this.rng.next() * holders.length)]!;
    }
    return this.createWalletId('w');
  }

  private pickWalletForSell(): string | null {
    const holders = this.getHolderWalletIds(true);
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

  private seedGenesisHolders(): void {
    // Keep launch baseline deterministic (2k mcap from generator).
    // Holders should be created by live market flow, not pre-launch simulated buys.
    return;
  }

  private recordPassiveTick(candleTsMs: number): void {
    this.aggr1s.pushTick(candleTsMs, this.lastPriceUsd, 0);
    this.aggr15s.pushTick(candleTsMs, this.lastPriceUsd, 0);
    this.aggr30s.pushTick(candleTsMs, this.lastPriceUsd, 0);
    this.aggr1m.pushTick(candleTsMs, this.lastPriceUsd, 0);
    this.mcapAggr1s.pushTick(candleTsMs, this.lastMcapUsd, 0);
    this.mcapAggr15s.pushTick(candleTsMs, this.lastMcapUsd, 0);
    this.mcapAggr30s.pushTick(candleTsMs, this.lastMcapUsd, 0);
    this.mcapAggr1m.pushTick(candleTsMs, this.lastMcapUsd, 0);
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

  private getSessionProfile(): SessionSimProfile {
    return SESSION_SIM_PROFILE[this.sessionBucket] ?? SESSION_SIM_PROFILE.OFF;
  }

  private advanceRegime(realDtSec: number, sessionProfile: SessionSimProfile): void {
    if (
      this.regime === 'IMPULSE'
      && sessionProfile.fakeoutChancePerSec > 0
      && this.rng.next() < sessionProfile.fakeoutChancePerSec * realDtSec
    ) {
      this.regime = this.rng.next() < 0.82 ? 'PULLBACK' : 'DUMP';
      this.regimeTtlSec = 1 + this.rng.next() * 4;
      return;
    }
    this.regimeTtlSec -= realDtSec;
    if (this.regimeTtlSec <= 0) this.rollRegime(sessionProfile);
  }

  private rollRegime(sessionProfile: SessionSimProfile = this.getSessionProfile()): void {
    const u = this.rng.next();
    if (this.archetype === 'DOA') {
      this.regime = u < 0.12 ? 'IMPULSE' : u < 0.75 ? 'PAUSE' : 'DUMP';
      this.regimeTtlSec = 4 + this.rng.next() * 18;
      this.applySessionRegimeTtl(sessionProfile);
      return;
    }
    if (this.archetype === 'SLOW_COOK') {
      this.regime = u < 0.2 ? 'IMPULSE' : u < 0.62 ? 'PAUSE' : u < 0.93 ? 'PULLBACK' : 'DUMP';
      this.regimeTtlSec = 5 + this.rng.next() * 16;
      this.applySessionRegimeTtl(sessionProfile);
      return;
    }
    if (this.archetype === 'CHAOS') {
      this.regime = u < 0.3 ? 'IMPULSE' : u < 0.42 ? 'PAUSE' : u < 0.75 ? 'PULLBACK' : 'DUMP';
      this.regimeTtlSec = 2 + this.rng.next() * 10;
      this.applySessionRegimeTtl(sessionProfile);
      return;
    }
    if (this.phase === 'MIGRATED') {
      this.regime = u < 0.15 ? 'IMPULSE' : u < 0.65 ? 'PAUSE' : u < 0.92 ? 'PULLBACK' : 'DUMP';
      this.regimeTtlSec = 4 + this.rng.next() * 14;
      this.applySessionRegimeTtl(sessionProfile);
      return;
    }
    if (this.phase === 'FINAL') {
      this.regime = u < 0.22 ? 'IMPULSE' : u < 0.48 ? 'PAUSE' : u < 0.85 ? 'PULLBACK' : 'DUMP';
      this.regimeTtlSec = 3 + this.rng.next() * 12;
      this.applySessionRegimeTtl(sessionProfile);
      return;
    }
    this.regime = u < 0.4 ? 'IMPULSE' : u < 0.72 ? 'PAUSE' : u < 0.92 ? 'PULLBACK' : 'DUMP';
    this.regimeTtlSec = 2 + this.rng.next() * 9;
    this.applySessionRegimeTtl(sessionProfile);
  }

  private applySessionRegimeTtl(sessionProfile: SessionSimProfile): void {
    if (this.regime === 'IMPULSE') {
      this.regimeTtlSec *= sessionProfile.impulseTtlMul;
    }
    this.regimeTtlSec = clamp(this.regimeTtlSec, 1.2, 36);
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

  private getWhaleChance(inMigrationChaos: boolean, sessionProfile: SessionSimProfile): number {
    let chance: number;
    if (inMigrationChaos) chance = this.regime === 'IMPULSE' ? 0.04 : this.regime === 'DUMP' ? 0.035 : 0.025;
    else if (this.phase === 'MIGRATED') chance = this.regime === 'IMPULSE' ? 0.012 : this.regime === 'PAUSE' ? 0.006 : 0.009;
    else if (this.phase === 'FINAL') chance = this.regime === 'IMPULSE' ? 0.014 : this.regime === 'PAUSE' ? 0.007 : 0.011;
    else chance = this.regime === 'IMPULSE' ? 0.015 : this.regime === 'PAUSE' ? 0.008 : 0.012;

    chance *= sessionProfile.whaleMul;
    if (this.regime === 'DUMP') chance *= sessionProfile.nukeChanceMul;
    return clamp(chance, 0, 0.16);
  }

  private buildDevFlow(
    candleTsMs: number,
    realDtSec: number,
    buyBias: number,
    isLaunchTick: boolean,
    allowSignals: boolean
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
    if (this.rng.next() >= this.getDevSignalChancePerSec() * realDtSec) return null;

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

    if ((this.bondingProgress >= MIGRATE_PROGRESS || this.curveRealToken <= CURVE_TOKEN_EPS) && !this.hasMigrated) {
      const sessionProfile = this.getSessionProfile();
      this.hasMigrated = true;
      this.phase = 'MIGRATED';
      this.postMigrationWarmupMs = POST_MIGRATION_WARMUP_MS;
      // Seed post-migration liquidity from curve reserves to avoid first-tick teleport.
      const handoffLiquidity = Math.max(5_000, (this.curveVirtualBase + this.curveRealBase) * 3);
      this.baseLiquidityUsd = Math.max(this.baseLiquidityUsd, handoffLiquidity);
      this.rollRegime(sessionProfile);
      const migrationChaosChance = clamp(this.archetypeProfile.migrationChaosChance * sessionProfile.nukeChanceMul, 0, 0.98);
      if (this.rng.next() < migrationChaosChance) {
        this.postMigrationChaosLeftMs = 8_000 + this.rng.next() * 17_000;
      } else {
        this.postMigrationChaosLeftMs = 0;
      }
      const deathSpiralChance = clamp(this.archetypeProfile.deathSpiralChance * sessionProfile.nukeChanceMul, 0, 0.98);
      if (this.rng.next() < deathSpiralChance) {
        this.deathSpiralLeftMs = 5_000 + this.rng.next() * 15_000;
      } else {
        this.deathSpiralLeftMs = 0;
      }
      return {
        tokenId: this.meta.id,
        tMs: candleTsMs,
        type: 'MIGRATION',
        price: this.lastPriceUsd,
        mcap: this.lastMcapUsd,
      };
    }

    this.phase = this.hasEnteredFinal ? 'FINAL' : 'NEW';

    if (this.simTimeMs >= this.fateTimeoutSimMs) {
      this.phase = 'DEAD';
      this.ruggedAtSimMs = this.simTimeMs;
      this.lastMcapUsd = MCAP_FLOOR_USD;
      this.lastPriceUsd = MCAP_FLOOR_USD / SUPPLY;
      this.recordPassiveTick(candleTsMs);
    }
    return null;
  }

  getRuntime(): TokenRuntime {
    const mcap = this.lastMcapUsd;
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
    if (this.phase === 'RUGGED' || this.phase === 'DEAD') {
      return { ok: false, side, amountIn, reason: 'Token unavailable' };
    }
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
    if (this.phase === 'RUGGED' || this.phase === 'DEAD') {
      return { ok: false, side, amountIn, reason: 'Token unavailable' };
    }
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
    if (this.phase === 'RUGGED' || this.phase === 'DEAD') {
      return {
        fill: { ok: false, side, requestedAmount: amount, reason: 'Token unavailable' },
        events: [],
      };
    }
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
        initialRealTokenRatioMin: 0.72,
        initialRealTokenRatioMax: 0.9,
        virtualTokenLiquidityMulMin: 1.1,
        virtualTokenLiquidityMulMax: 1.35,
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
        initialRealTokenRatioMin: 0.42,
        initialRealTokenRatioMax: 0.62,
        virtualTokenLiquidityMulMin: 1.05,
        virtualTokenLiquidityMulMax: 1.2,
        migrationChaosChance: 0.8,
        deathSpiralChance: 0.28,
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
      migrationChaosChance: 0.15,
      deathSpiralChance: 0.08,
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

  private getFlowPowerMul(): number {
    if (this.meta.fate === 'QUICK_RUG') return 1.35;

    const ramp = 0.35 + 0.65 * clamp(this.simTimeMs / FLOW_WARMUP_SIM_MS, 0, 1);
    if (this.meta.fate === 'LONG_RUNNER') return 0.82 * ramp;
    if (this.meta.fate === 'NORMAL') return 0.68 * ramp;
    return 0.55 * ramp;
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
