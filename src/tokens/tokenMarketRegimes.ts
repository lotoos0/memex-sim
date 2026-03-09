import { RNG } from '../engine/rng';
import type { SessionSimProfile } from '../market/session';
import type { TokenFate, TokenMetrics, TokenPhase } from './types';

export type TokenMarketRegime =
  | 'LAUNCH_CHAOS'
  | 'FIRST_PUMP'
  | 'CHOP'
  | 'GRIND_UP'
  | 'BLEED_OUT'
  | 'DEAD_BOUNCE'
  | 'MIGRATION_SHOCK'
  | 'POST_MIGRATION_DISCOVERY';

export type MigrationOutcome =
  | 'CONTINUATION'
  | 'VIOLENT_CHOP'
  | 'SELL_THE_NEWS';

export const MIGRATION_TARGET_SOL = 228;
export const SOL_PRICE_USD_REFERENCE = 150;
export const MIGRATION_SHOCK_CANDLES_MIN = 8;
export const MIGRATION_SHOCK_CANDLES_MAX = 20;
export const MIGRATION_SHOCK_VOLATILITY_MULTIPLIER = 2.45;
export const MIGRATION_SHOCK_WICKINESS_MULTIPLIER = 1.9;
export const MIGRATION_SHOCK_CONTINUATION_PENALTY = 0.18;
export const IMPACT_SATURATION_FLOOR_USD = 8_000;
export const LOW_LIQUIDITY_BOOST = 1.25;
export const HIGH_LIQUIDITY_DAMPING = 0.72;
export const MIN_MIGRATION_AGE_SEC = 90;
export const MIN_MIGRATION_TX_60S = 30;
export const MIN_MIGRATION_HOLDERS = 120;
export const MIN_MIGRATION_SUSTAIN_CANDLES = 8;
export const POST_MIGRATION_RETEST_CHANCE = 0.45;
export const POST_MIGRATION_REJECTION_CHANCE = 0.35;
export const POST_MIGRATION_PLATEAU_PENALTY = 0.3;
export const POST_MIGRATION_MEAN_REVERSION_CHANCE = 0.3;
export const POST_MIGRATION_OVEREXTENSION_PENALTY = 0.25;
export const TRADE_SIZE_BUCKETS_SOL = [0.02, 0.05, 0.1, 0.25, 0.5, 1.0, 1.5, 2.5] as const;
export const MIGRATION_APPROACH_FRICTION_START_PCT = 0.8;
export const MIGRATION_APPROACH_FRICTION_MAX = 0.35;
export const MICROBUST_CANDLES_MIN = 3;
export const MICROBUST_CANDLES_MAX = 6;
export const MICROBUST_RETRACE_CHANCE = 0.35;
export const MICROBUST_RETRACE_STRENGTH_PCT = 0.18;
export const MICROBUST_CONTINUATION_DECAY = 0.82;

export interface TokenMarketBehavior {
  driftPerSec: number;
  buyBias: number;
  volMul: number;
  lambdaMul: number;
  liquidityMul: number;
  tradeSizeMul: number;
  tradeSizeMinClipSol: number;
  tradeSizeBucketWeights: readonly number[];
  impactMul: number;
  maxNetImpactPctPerSec: number;
  regimeImpactMultiplier: number;
  tradeSigmaMul: number;
  wickinessMultiplier: number;
  devSignalMul: number;
  whaleChanceMul: number;
  maxBodyMovePct: number;
  postMigrationRetestChance: number;
  postMigrationRejectionChance: number;
  postMigrationPlateauPenalty: number;
  postMigrationMeanReversionChance: number;
  postMigrationOverextensionPenalty: number;
  cadenceBurstChance: number;
  cadenceBurstDurationMinSec: number;
  cadenceBurstDurationMaxSec: number;
  cadenceBurstIntensity: number;
  postMigrationBleedRetestChance: number;
  postMigrationBleedBounceChance: number;
  postMigrationBleedRejectionChance: number;
  postMigrationBleedNoise: number;
}

type MigrationOutcomeWeightSet = {
  continuation: number;
  chop: number;
  bleed: number;
};

export interface TokenMarketTransitionContext {
  currentRegime: TokenMarketRegime;
  phase: TokenPhase;
  fate: TokenFate;
  simTimeMs: number;
  lastMcapUsd: number;
  changePct: number;
  flowStrength: number;
  qualityScore: number;
  hasEnteredFinal: boolean;
  inMigrationShock: boolean;
  sessionProfile: SessionSimProfile;
}

const DEFAULT_TTL_RANGE_BY_REGIME: Record<TokenMarketRegime, [number, number]> = {
  LAUNCH_CHAOS: [4, 10],
  FIRST_PUMP: [4, 12],
  CHOP: [6, 18],
  GRIND_UP: [8, 22],
  BLEED_OUT: [8, 24],
  DEAD_BOUNCE: [4, 10],
  MIGRATION_SHOCK: [6, 18],
  POST_MIGRATION_DISCOVERY: [7, 24],
};

const MIGRATION_OUTCOME_WEIGHTS: Record<'weak' | 'average' | 'strong', MigrationOutcomeWeightSet> = {
  weak: {
    continuation: 0.05,
    chop: 0.28,
    bleed: 0.67,
  },
  average: {
    continuation: 0.12,
    chop: 0.58,
    bleed: 0.3,
  },
  strong: {
    continuation: 0.3,
    chop: 0.45,
    bleed: 0.25,
  },
};

const TRADE_SIZE_WEIGHTS_BY_REGIME: Record<TokenMarketRegime, readonly number[]> = {
  LAUNCH_CHAOS: [0.04, 0.14, 0.2, 0.24, 0.2, 0.12, 0.04, 0.02],
  FIRST_PUMP: [0.03, 0.12, 0.2, 0.25, 0.22, 0.12, 0.04, 0.02],
  CHOP: [0.08, 0.2, 0.24, 0.22, 0.16, 0.07, 0.02, 0.01],
  GRIND_UP: [0.05, 0.15, 0.22, 0.24, 0.19, 0.1, 0.04, 0.01],
  BLEED_OUT: [0.1, 0.24, 0.24, 0.2, 0.14, 0.06, 0.015, 0.005],
  DEAD_BOUNCE: [0.16, 0.28, 0.24, 0.17, 0.1, 0.04, 0.01, 0],
  MIGRATION_SHOCK: [0.02, 0.08, 0.16, 0.24, 0.24, 0.16, 0.07, 0.03],
  POST_MIGRATION_DISCOVERY: [0.03, 0.1, 0.18, 0.24, 0.22, 0.14, 0.06, 0.03],
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function computeBaseQualityScore(fate: TokenFate, metrics: TokenMetrics): number {
  const fateBase =
    fate === 'LONG_RUNNER' ? 0.82 :
    fate === 'NORMAL' ? 0.62 :
    fate === 'SHORT' ? 0.42 :
    0.16;

  const holderScore = 1
    - clamp((metrics.topHoldersPct - 16) / 52, 0, 1) * 0.28
    - clamp(metrics.devHoldingsPct / 20, 0, 1) * 0.18
    - clamp(metrics.snipersPct / 30, 0, 1) * 0.15
    - clamp(metrics.bundlersPct / 10, 0, 1) * 0.08
    - clamp(metrics.insidersPct / 15, 0, 1) * 0.08
    + clamp((metrics.lpBurnedPct - 40) / 60, 0, 1) * 0.17;

  return clamp(fateBase * 0.65 + holderScore * 0.35, 0.05, 0.95);
}

export function computeFlowStrength(input: {
  vol5mUsd: number;
  buys5m: number;
  sells5m: number;
  mcapUsd: number;
  changePct: number;
}): number {
  const volRatio = input.mcapUsd > 0 ? input.vol5mUsd / Math.max(1, input.mcapUsd) : 0;
  const directional = (input.buys5m - input.sells5m) / Math.max(1, input.buys5m + input.sells5m);
  const priceImpulse = clamp(input.changePct / 160, -1, 1);
  const volumeHeat = clamp(volRatio / 2.2, 0, 1);
  return clamp(directional * 0.45 + priceImpulse * 0.35 + volumeHeat * 0.2, -1, 1);
}

export function getMarketBehavior(
  regime: TokenMarketRegime,
  context: Pick<TokenMarketTransitionContext, 'qualityScore' | 'flowStrength' | 'sessionProfile' | 'phase' | 'changePct'>
): TokenMarketBehavior {
  const strength = context.flowStrength;
  const quality = context.qualityScore;
  const phaseBoost = context.phase === 'FINAL' ? 0.94 : context.phase === 'MIGRATED' ? 0.96 : 1;
  const discoveryTailwind = clamp(context.changePct / 220, -0.25, 0.25);

  switch (regime) {
    case 'LAUNCH_CHAOS':
      return {
        driftPerSec: 0.0015 + strength * 0.008,
        buyBias: clamp(0.47 + strength * 0.08 + quality * 0.03, 0.26, 0.67),
        volMul: 1.28,
        lambdaMul: 1.24 * phaseBoost,
        liquidityMul: 0.92,
        tradeSizeMul: 1.06,
        tradeSizeMinClipSol: 0.05,
        tradeSizeBucketWeights: TRADE_SIZE_WEIGHTS_BY_REGIME.LAUNCH_CHAOS,
        impactMul: 1.01,
        maxNetImpactPctPerSec: 0.46,
        regimeImpactMultiplier: 0.98,
        tradeSigmaMul: 1.22,
        wickinessMultiplier: 1.35,
        devSignalMul: 1.1,
        whaleChanceMul: 0.96,
        maxBodyMovePct: 0.45,
        postMigrationRetestChance: 0,
        postMigrationRejectionChance: 0,
        postMigrationPlateauPenalty: 0,
        postMigrationMeanReversionChance: 0,
        postMigrationOverextensionPenalty: 0,
        cadenceBurstChance: 0.24,
        cadenceBurstDurationMinSec: 2,
        cadenceBurstDurationMaxSec: 5,
        cadenceBurstIntensity: 0.82,
        postMigrationBleedRetestChance: 0,
        postMigrationBleedBounceChance: 0,
        postMigrationBleedRejectionChance: 0,
        postMigrationBleedNoise: 0,
      };
    case 'FIRST_PUMP':
      return {
        driftPerSec: 0.012 + strength * 0.011 + quality * 0.004,
        buyBias: clamp(0.56 + strength * 0.065 + quality * 0.035, 0.42, 0.77),
        volMul: 0.94,
        lambdaMul: 1.18 * phaseBoost,
        liquidityMul: 0.98,
        tradeSizeMul: 1.0,
        tradeSizeMinClipSol: 0.05,
        tradeSizeBucketWeights: TRADE_SIZE_WEIGHTS_BY_REGIME.FIRST_PUMP,
        impactMul: 0.97,
        maxNetImpactPctPerSec: 0.34,
        regimeImpactMultiplier: 0.95,
        tradeSigmaMul: 0.98,
        wickinessMultiplier: 1.15,
        devSignalMul: 1.08,
        whaleChanceMul: 0.98,
        maxBodyMovePct: 0.35,
        postMigrationRetestChance: 0,
        postMigrationRejectionChance: 0,
        postMigrationPlateauPenalty: 0,
        postMigrationMeanReversionChance: 0,
        postMigrationOverextensionPenalty: 0,
        cadenceBurstChance: 0.2,
        cadenceBurstDurationMinSec: 2,
        cadenceBurstDurationMaxSec: 4,
        cadenceBurstIntensity: 0.74,
        postMigrationBleedRetestChance: 0,
        postMigrationBleedBounceChance: 0,
        postMigrationBleedRejectionChance: 0,
        postMigrationBleedNoise: 0,
      };
    case 'CHOP':
      return {
        driftPerSec: strength * 0.002 + discoveryTailwind * 0.006,
        buyBias: clamp(0.49 + strength * 0.035, 0.38, 0.59),
        volMul: 0.88,
        lambdaMul: 0.96 * phaseBoost,
        liquidityMul: 1.08,
        tradeSizeMul: 0.92,
        tradeSizeMinClipSol: 0.04,
        tradeSizeBucketWeights: TRADE_SIZE_WEIGHTS_BY_REGIME.CHOP,
        impactMul: 0.88,
        maxNetImpactPctPerSec: 0.12,
        regimeImpactMultiplier: 0.94,
        tradeSigmaMul: 1.12,
        wickinessMultiplier: 1.4,
        devSignalMul: 0.84,
        whaleChanceMul: 0.84,
        maxBodyMovePct: 0.12,
        postMigrationRetestChance: 0,
        postMigrationRejectionChance: 0,
        postMigrationPlateauPenalty: 0,
        postMigrationMeanReversionChance: 0,
        postMigrationOverextensionPenalty: 0,
        cadenceBurstChance: 0.13,
        cadenceBurstDurationMinSec: 2,
        cadenceBurstDurationMaxSec: 4,
        cadenceBurstIntensity: 0.5,
        postMigrationBleedRetestChance: 0,
        postMigrationBleedBounceChance: 0,
        postMigrationBleedRejectionChance: 0,
        postMigrationBleedNoise: 0,
      };
    case 'GRIND_UP':
      return {
        driftPerSec: 0.007 + quality * 0.006 + Math.max(0, strength) * 0.008,
        buyBias: clamp(0.525 + quality * 0.055 + strength * 0.045, 0.44, 0.72),
        volMul: 0.68,
        lambdaMul: 0.94 * phaseBoost,
        liquidityMul: 1.16,
        tradeSizeMul: 0.96,
        tradeSizeMinClipSol: 0.05,
        tradeSizeBucketWeights: TRADE_SIZE_WEIGHTS_BY_REGIME.GRIND_UP,
        impactMul: 0.74,
        maxNetImpactPctPerSec: 0.15,
        regimeImpactMultiplier: 0.9,
        tradeSigmaMul: 0.74,
        wickinessMultiplier: 1.1,
        devSignalMul: 0.86,
        whaleChanceMul: 0.78,
        maxBodyMovePct: 0.18,
        postMigrationRetestChance: 0,
        postMigrationRejectionChance: 0,
        postMigrationPlateauPenalty: 0,
        postMigrationMeanReversionChance: 0,
        postMigrationOverextensionPenalty: 0,
        cadenceBurstChance: 0.09,
        cadenceBurstDurationMinSec: 2,
        cadenceBurstDurationMaxSec: 3,
        cadenceBurstIntensity: 0.38,
        postMigrationBleedRetestChance: 0,
        postMigrationBleedBounceChance: 0,
        postMigrationBleedRejectionChance: 0,
        postMigrationBleedNoise: 0,
      };
    case 'BLEED_OUT':
      return {
        driftPerSec: -0.015 - Math.max(0, -strength) * 0.022 - (1 - quality) * 0.012,
        buyBias: clamp(0.39 + strength * 0.04 - (1 - quality) * 0.11, 0.14, 0.5),
        volMul: 0.78,
        lambdaMul: 0.8 * phaseBoost,
        liquidityMul: 0.86,
        tradeSizeMul: 0.88,
        tradeSizeMinClipSol: 0.03,
        tradeSizeBucketWeights: TRADE_SIZE_WEIGHTS_BY_REGIME.BLEED_OUT,
        impactMul: 0.88,
        maxNetImpactPctPerSec: 0.16,
        regimeImpactMultiplier: 0.96,
        tradeSigmaMul: 0.8,
        wickinessMultiplier: 1.2,
        devSignalMul: 0.62,
        whaleChanceMul: 0.88,
        maxBodyMovePct: 0.16,
        postMigrationRetestChance: 0,
        postMigrationRejectionChance: 0,
        postMigrationPlateauPenalty: 0,
        postMigrationMeanReversionChance: 0,
        postMigrationOverextensionPenalty: 0,
        cadenceBurstChance: 0.06,
        cadenceBurstDurationMinSec: 2,
        cadenceBurstDurationMaxSec: 4,
        cadenceBurstIntensity: 0.3,
        postMigrationBleedRetestChance: 0.24,
        postMigrationBleedBounceChance: 0.18,
        postMigrationBleedRejectionChance: 0.34,
        postMigrationBleedNoise: 0.65,
      };
    case 'DEAD_BOUNCE':
      return {
        driftPerSec: 0.007 + Math.max(0, strength) * 0.01,
        buyBias: clamp(0.57 + strength * 0.05, 0.48, 0.72),
        volMul: 0.72,
        lambdaMul: 0.65,
        liquidityMul: 0.72,
        tradeSizeMul: 0.84,
        tradeSizeMinClipSol: 0.025,
        tradeSizeBucketWeights: TRADE_SIZE_WEIGHTS_BY_REGIME.DEAD_BOUNCE,
        impactMul: 1.04,
        maxNetImpactPctPerSec: 0.14,
        regimeImpactMultiplier: 0.94,
        tradeSigmaMul: 0.95,
        wickinessMultiplier: 1.1,
        devSignalMul: 0.35,
        whaleChanceMul: 0.45,
        maxBodyMovePct: 0.14,
        postMigrationRetestChance: 0,
        postMigrationRejectionChance: 0,
        postMigrationPlateauPenalty: 0,
        postMigrationMeanReversionChance: 0,
        postMigrationOverextensionPenalty: 0,
        cadenceBurstChance: 0.04,
        cadenceBurstDurationMinSec: 1.5,
        cadenceBurstDurationMaxSec: 3,
        cadenceBurstIntensity: 0.24,
        postMigrationBleedRetestChance: 0,
        postMigrationBleedBounceChance: 0,
        postMigrationBleedRejectionChance: 0,
        postMigrationBleedNoise: 0,
      };
    case 'MIGRATION_SHOCK':
      return {
        driftPerSec: strength * 0.009,
        buyBias: clamp(0.5 + strength * 0.04, 0.34, 0.66),
        volMul: MIGRATION_SHOCK_VOLATILITY_MULTIPLIER,
        lambdaMul: 2.3 * phaseBoost,
        liquidityMul: 0.55,
        tradeSizeMul: 1.38,
        tradeSizeMinClipSol: 0.1,
        tradeSizeBucketWeights: TRADE_SIZE_WEIGHTS_BY_REGIME.MIGRATION_SHOCK,
        impactMul: 1.34,
        maxNetImpactPctPerSec: 0.32,
        regimeImpactMultiplier: 1.1,
        tradeSigmaMul: MIGRATION_SHOCK_WICKINESS_MULTIPLIER,
        wickinessMultiplier: 1.75,
        devSignalMul: 1.35,
        whaleChanceMul: 1.6,
        maxBodyMovePct: 0.28,
        postMigrationRetestChance: POST_MIGRATION_RETEST_CHANCE,
        postMigrationRejectionChance: POST_MIGRATION_REJECTION_CHANCE,
        postMigrationPlateauPenalty: POST_MIGRATION_PLATEAU_PENALTY,
        postMigrationMeanReversionChance: POST_MIGRATION_MEAN_REVERSION_CHANCE,
        postMigrationOverextensionPenalty: POST_MIGRATION_OVEREXTENSION_PENALTY,
        cadenceBurstChance: 0.18,
        cadenceBurstDurationMinSec: 2,
        cadenceBurstDurationMaxSec: 5,
        cadenceBurstIntensity: 0.86,
        postMigrationBleedRetestChance: 0,
        postMigrationBleedBounceChance: 0,
        postMigrationBleedRejectionChance: 0,
        postMigrationBleedNoise: 0,
      };
    case 'POST_MIGRATION_DISCOVERY':
      return {
        driftPerSec: 0.008 + quality * 0.012 + Math.max(0, strength) * 0.012,
        buyBias: clamp(0.54 + quality * 0.08 + strength * 0.08, 0.42, 0.82),
        volMul: 0.95,
        lambdaMul: 1.02,
        liquidityMul: 1.32,
        tradeSizeMul: 1.06,
        tradeSizeMinClipSol: 0.05,
        tradeSizeBucketWeights: TRADE_SIZE_WEIGHTS_BY_REGIME.POST_MIGRATION_DISCOVERY,
        impactMul: 0.88,
        maxNetImpactPctPerSec: 0.2,
        regimeImpactMultiplier: 0.98,
        tradeSigmaMul: 0.92,
        wickinessMultiplier: 1.3,
        devSignalMul: 1.04,
        whaleChanceMul: 1.05,
        maxBodyMovePct: 0.2,
        postMigrationRetestChance: POST_MIGRATION_RETEST_CHANCE * 0.9,
        postMigrationRejectionChance: POST_MIGRATION_REJECTION_CHANCE * 0.8,
        postMigrationPlateauPenalty: POST_MIGRATION_PLATEAU_PENALTY,
        postMigrationMeanReversionChance: POST_MIGRATION_MEAN_REVERSION_CHANCE,
        postMigrationOverextensionPenalty: POST_MIGRATION_OVEREXTENSION_PENALTY,
        cadenceBurstChance: 0.14,
        cadenceBurstDurationMinSec: 2,
        cadenceBurstDurationMaxSec: 4,
        cadenceBurstIntensity: 0.56,
        postMigrationBleedRetestChance: 0.16,
        postMigrationBleedBounceChance: 0.12,
        postMigrationBleedRejectionChance: 0.18,
        postMigrationBleedNoise: 0.35,
      };
  }
}

export function rollNextMarketRegime(
  rng: RNG,
  context: TokenMarketTransitionContext
): { regime: TokenMarketRegime; ttlSec: number } {
  if (context.inMigrationShock || context.currentRegime === 'MIGRATION_SHOCK') {
    return withTtl(rng, 'MIGRATION_SHOCK', context.sessionProfile);
  }

  if (context.phase === 'DEAD') {
    return withTtl(rng, context.flowStrength > 0.08 ? 'DEAD_BOUNCE' : 'BLEED_OUT', context.sessionProfile);
  }

  if (context.phase === 'MIGRATED') {
    const migratedRegime = pickMigratedRegime(rng, context);
    return withTtl(rng, migratedRegime, context.sessionProfile);
  }

  if (context.simTimeMs < 85_000) {
    if (context.flowStrength > 0.34 && context.changePct > 55 && context.qualityScore > 0.56) {
      return withTtl(rng, 'FIRST_PUMP', context.sessionProfile);
    }
    if ((1 - context.qualityScore) * 0.5 + Math.max(0, -context.flowStrength) > 0.42) {
      return withTtl(rng, 'BLEED_OUT', context.sessionProfile);
    }
    return withTtl(rng, context.simTimeMs < 32_000 ? 'LAUNCH_CHAOS' : 'CHOP', context.sessionProfile);
  }

  const breakoutBias = context.flowStrength + context.qualityScore * 0.55;
  const decayBias = (1 - context.qualityScore) * 0.55 + Math.max(0, -context.flowStrength);
  const fakeout = context.sessionProfile.fakeoutChancePerSec * clamp(context.sessionProfile.tempoMul, 0.7, 1.6) * 24;
  const current = context.currentRegime;

  if (current === 'GRIND_UP' || current === 'FIRST_PUMP') {
    if (rng.next() < fakeout) return withTtl(rng, rng.next() < 0.42 ? 'CHOP' : 'BLEED_OUT', context.sessionProfile);
    if (breakoutBias > 0.82 && context.qualityScore > 0.62 && context.flowStrength > 0.18) {
      return withTtl(rng, 'GRIND_UP', context.sessionProfile);
    }
    if (decayBias > 0.48 || context.flowStrength < -0.08) return withTtl(rng, 'BLEED_OUT', context.sessionProfile);
    return withTtl(rng, 'CHOP', context.sessionProfile);
  }

  if (current === 'BLEED_OUT') {
    if (context.flowStrength > 0.32 && context.qualityScore > 0.7 && rng.next() < 0.22) {
      return withTtl(rng, 'CHOP', context.sessionProfile);
    }
    return withTtl(rng, 'BLEED_OUT', context.sessionProfile);
  }

  if (current === 'CHOP') {
    if (breakoutBias > 0.9 && context.qualityScore > 0.64 && context.flowStrength > 0.22) {
      return withTtl(rng, rng.next() < 0.78 ? 'FIRST_PUMP' : 'GRIND_UP', context.sessionProfile);
    }
    if (decayBias > 0.52 || context.flowStrength < -0.12) return withTtl(rng, 'BLEED_OUT', context.sessionProfile);
    return withTtl(rng, 'CHOP', context.sessionProfile);
  }

  if (current === 'LAUNCH_CHAOS') {
    if (context.flowStrength > 0.36 && context.changePct > 58 && context.qualityScore > 0.58) {
      return withTtl(rng, 'FIRST_PUMP', context.sessionProfile);
    }
    if (decayBias > 0.46 || context.flowStrength < -0.06) return withTtl(rng, 'BLEED_OUT', context.sessionProfile);
    return withTtl(rng, 'CHOP', context.sessionProfile);
  }

  return withTtl(rng, breakoutBias > decayBias ? 'CHOP' : 'BLEED_OUT', context.sessionProfile);
}

export function decideMigrationOutcome(
  rng: RNG,
  input: {
    qualityScore: number;
    preMigrationStrength: number;
    currentFlowStrength: number;
  }
): MigrationOutcome {
  const combinedStrength =
    input.qualityScore * 0.45
    + Math.max(0, input.preMigrationStrength) * 0.32
    + Math.max(0, input.currentFlowStrength) * 0.23
    - Math.max(0, -input.preMigrationStrength) * 0.18
    - Math.max(0, -input.currentFlowStrength) * 0.12;

  const band =
    combinedStrength >= 0.68 ? 'strong' :
    combinedStrength >= 0.4 ? 'average' :
    'weak';

  const base = MIGRATION_OUTCOME_WEIGHTS[band];
  const continuationScore = Math.max(
    0.02,
    base.continuation
    + (input.qualityScore - 0.62) * 0.08
    + Math.max(0, input.preMigrationStrength - 0.28) * 0.12
    + Math.max(0, input.currentFlowStrength - 0.2) * 0.08
    - MIGRATION_SHOCK_CONTINUATION_PENALTY
  );
  const bleedScore = Math.max(
    0.08,
    base.bleed
    + Math.max(0, 0.55 - input.qualityScore) * 0.18
    + Math.max(0, -input.preMigrationStrength) * 0.22
    + Math.max(0, -input.currentFlowStrength) * 0.14
  );
  const chopScore = Math.max(
    0.12,
    base.chop
    + Math.max(0, 0.18 - Math.abs(input.currentFlowStrength)) * 0.2
    + Math.max(0, 0.12 - Math.abs(input.preMigrationStrength)) * 0.12
  );

  const total = continuationScore + chopScore + bleedScore;
  const roll = rng.next() * total;

  if (roll < continuationScore) return 'CONTINUATION';
  if (roll < continuationScore + chopScore) return 'VIOLENT_CHOP';
  return 'SELL_THE_NEWS';
}

export function getMigrationThresholdUsd(): number {
  return MIGRATION_TARGET_SOL * SOL_PRICE_USD_REFERENCE;
}

export function getMigrationShockDurationMs(rng: RNG): number {
  const candles =
    MIGRATION_SHOCK_CANDLES_MIN
    + Math.floor(rng.next() * (MIGRATION_SHOCK_CANDLES_MAX - MIGRATION_SHOCK_CANDLES_MIN + 1));
  return candles * 1000;
}

function pickMigratedRegime(rng: RNG, context: TokenMarketTransitionContext): TokenMarketRegime {
  const qualityTailwind = context.qualityScore + Math.max(0, context.flowStrength) * 0.6;
  const fadePressure = (1 - context.qualityScore) + Math.max(0, -context.flowStrength) * 0.7;

  if (qualityTailwind > 0.88 && rng.next() < 0.72) return 'POST_MIGRATION_DISCOVERY';
  if (fadePressure > 0.95 && rng.next() < 0.7) return 'BLEED_OUT';
  return 'CHOP';
}

function withTtl(
  rng: RNG,
  regime: TokenMarketRegime,
  sessionProfile: SessionSimProfile
): { regime: TokenMarketRegime; ttlSec: number } {
  const [minTtl, maxTtl] = DEFAULT_TTL_RANGE_BY_REGIME[regime];
  let ttlSec = minTtl + (maxTtl - minTtl) * rng.next();
  if (regime === 'FIRST_PUMP' || regime === 'GRIND_UP' || regime === 'MIGRATION_SHOCK') {
    ttlSec *= sessionProfile.impulseTtlMul;
  }
  return {
    regime,
    ttlSec: clamp(ttlSec, 1.5, 36),
  };
}
