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

export interface TokenMarketBehavior {
  driftPerSec: number;
  buyBias: number;
  volMul: number;
  lambdaMul: number;
  liquidityMul: number;
  tradeSizeMul: number;
  impactMul: number;
  tradeSigmaMul: number;
  devSignalMul: number;
  whaleChanceMul: number;
}

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
  const phaseBoost = context.phase === 'FINAL' ? 1.08 : context.phase === 'MIGRATED' ? 0.96 : 1;
  const discoveryTailwind = clamp(context.changePct / 220, -0.25, 0.25);

  switch (regime) {
    case 'LAUNCH_CHAOS':
      return {
        driftPerSec: 0.004 + strength * 0.012,
        buyBias: clamp(0.5 + strength * 0.12 + quality * 0.04, 0.28, 0.72),
        volMul: 1.45,
        lambdaMul: 1.5 * phaseBoost,
        liquidityMul: 0.92,
        tradeSizeMul: 1.22,
        impactMul: 1.16,
        tradeSigmaMul: 1.35,
        devSignalMul: 1.1,
        whaleChanceMul: 1.05,
      };
    case 'FIRST_PUMP':
      return {
        driftPerSec: 0.022 + strength * 0.018 + quality * 0.008,
        buyBias: clamp(0.61 + strength * 0.1 + quality * 0.05, 0.46, 0.86),
        volMul: 1.1,
        lambdaMul: 1.45 * phaseBoost,
        liquidityMul: 0.98,
        tradeSizeMul: 1.12,
        impactMul: 1.08,
        tradeSigmaMul: 1.08,
        devSignalMul: 1.18,
        whaleChanceMul: 1.12,
      };
    case 'CHOP':
      return {
        driftPerSec: strength * 0.004 + discoveryTailwind * 0.008,
        buyBias: clamp(0.5 + strength * 0.05, 0.4, 0.6),
        volMul: 0.92,
        lambdaMul: 1.0 * phaseBoost,
        liquidityMul: 1.05,
        tradeSizeMul: 0.96,
        impactMul: 0.92,
        tradeSigmaMul: 1.18,
        devSignalMul: 0.92,
        whaleChanceMul: 0.9,
      };
    case 'GRIND_UP':
      return {
        driftPerSec: 0.012 + quality * 0.01 + Math.max(0, strength) * 0.014,
        buyBias: clamp(0.56 + quality * 0.08 + strength * 0.06, 0.46, 0.8),
        volMul: 0.74,
        lambdaMul: 1.08 * phaseBoost,
        liquidityMul: 1.18,
        tradeSizeMul: 1.02,
        impactMul: 0.82,
        tradeSigmaMul: 0.8,
        devSignalMul: 0.95,
        whaleChanceMul: 0.86,
      };
    case 'BLEED_OUT':
      return {
        driftPerSec: -0.01 - Math.max(0, -strength) * 0.018 - (1 - quality) * 0.008,
        buyBias: clamp(0.43 + strength * 0.05 - (1 - quality) * 0.08, 0.18, 0.54),
        volMul: 0.82,
        lambdaMul: 0.88 * phaseBoost,
        liquidityMul: 0.9,
        tradeSizeMul: 0.92,
        impactMul: 0.94,
        tradeSigmaMul: 0.86,
        devSignalMul: 0.72,
        whaleChanceMul: 0.95,
      };
    case 'DEAD_BOUNCE':
      return {
        driftPerSec: 0.007 + Math.max(0, strength) * 0.01,
        buyBias: clamp(0.57 + strength * 0.05, 0.48, 0.72),
        volMul: 0.72,
        lambdaMul: 0.65,
        liquidityMul: 0.72,
        tradeSizeMul: 0.84,
        impactMul: 1.04,
        tradeSigmaMul: 0.95,
        devSignalMul: 0.35,
        whaleChanceMul: 0.45,
      };
    case 'MIGRATION_SHOCK':
      return {
        driftPerSec: strength * 0.016,
        buyBias: clamp(0.5 + strength * 0.08, 0.28, 0.72),
        volMul: 1.95,
        lambdaMul: 2.05 * phaseBoost,
        liquidityMul: 0.62,
        tradeSizeMul: 1.3,
        impactMul: 1.22,
        tradeSigmaMul: 1.5,
        devSignalMul: 1.25,
        whaleChanceMul: 1.45,
      };
    case 'POST_MIGRATION_DISCOVERY':
      return {
        driftPerSec: 0.008 + quality * 0.012 + Math.max(0, strength) * 0.012,
        buyBias: clamp(0.54 + quality * 0.08 + strength * 0.08, 0.42, 0.82),
        volMul: 0.95,
        lambdaMul: 1.02,
        liquidityMul: 1.32,
        tradeSizeMul: 1.06,
        impactMul: 0.88,
        tradeSigmaMul: 0.92,
        devSignalMul: 1.04,
        whaleChanceMul: 1.05,
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

  if (context.simTimeMs < 70_000) {
    const earlyRegime = context.flowStrength > 0.18 || context.changePct > 30 ? 'FIRST_PUMP' : 'LAUNCH_CHAOS';
    return withTtl(rng, earlyRegime, context.sessionProfile);
  }

  const breakoutBias = context.flowStrength + context.qualityScore * 0.55;
  const decayBias = (1 - context.qualityScore) * 0.55 + Math.max(0, -context.flowStrength);
  const fakeout = context.sessionProfile.fakeoutChancePerSec * clamp(context.sessionProfile.tempoMul, 0.7, 1.6) * 18;
  const current = context.currentRegime;

  if (current === 'GRIND_UP' || current === 'FIRST_PUMP') {
    if (rng.next() < fakeout) return withTtl(rng, rng.next() < 0.55 ? 'CHOP' : 'BLEED_OUT', context.sessionProfile);
    if (breakoutBias > 0.62) return withTtl(rng, 'GRIND_UP', context.sessionProfile);
    if (decayBias > 0.55) return withTtl(rng, 'BLEED_OUT', context.sessionProfile);
    return withTtl(rng, 'CHOP', context.sessionProfile);
  }

  if (current === 'BLEED_OUT') {
    if (context.flowStrength > 0.2 && context.qualityScore > 0.55) {
      return withTtl(rng, rng.next() < 0.45 ? 'CHOP' : 'FIRST_PUMP', context.sessionProfile);
    }
    return withTtl(rng, 'BLEED_OUT', context.sessionProfile);
  }

  if (current === 'CHOP') {
    if (breakoutBias > 0.72) return withTtl(rng, rng.next() < 0.6 ? 'FIRST_PUMP' : 'GRIND_UP', context.sessionProfile);
    if (decayBias > 0.62) return withTtl(rng, 'BLEED_OUT', context.sessionProfile);
    return withTtl(rng, 'CHOP', context.sessionProfile);
  }

  if (current === 'LAUNCH_CHAOS') {
    if (context.flowStrength > 0.24 || context.changePct > 45) return withTtl(rng, 'FIRST_PUMP', context.sessionProfile);
    if (decayBias > 0.52) return withTtl(rng, 'BLEED_OUT', context.sessionProfile);
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
  const continuationScore = input.qualityScore * 0.55 + Math.max(0, input.preMigrationStrength) * 0.25 + Math.max(0, input.currentFlowStrength) * 0.2;
  const bleedScore = (1 - input.qualityScore) * 0.45 + Math.max(0, -input.preMigrationStrength) * 0.25 + Math.max(0, -input.currentFlowStrength) * 0.3;
  const chopScore = Math.max(0.2, 1 - Math.abs(input.currentFlowStrength) * 0.65) * 0.8;
  const total = continuationScore + bleedScore + chopScore;
  const roll = rng.next() * total;

  if (roll < continuationScore) return 'CONTINUATION';
  if (roll < continuationScore + chopScore) return 'VIOLENT_CHOP';
  return 'SELL_THE_NEWS';
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
