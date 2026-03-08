import type { RNG } from '../engine/rng';
import type { TokenFate, TokenPhase } from './types';
import type { TokenMarketRegime } from './tokenMarketRegimes';

export type TokenActorGroup =
  | 'dev'
  | 'insiders'
  | 'snipers'
  | 'smart_early_buyers'
  | 'momentum_chasers'
  | 'late_retail'
  | 'dip_buyers'
  | 'panic_sellers';

export type TokenActorMixEntry = {
  group: TokenActorGroup;
  weight: number;
};

export type TokenActorOverlay = {
  buyBoostUsd: number;
  sellBoostUsd: number;
  buyMix: TokenActorMixEntry[];
  sellMix: TokenActorMixEntry[];
};

export type TokenActorContext = {
  regime: TokenMarketRegime;
  phase: TokenPhase;
  fate: TokenFate;
  simTimeMs: number;
  qualityScore: number;
  flowStrength: number;
  changePct: number;
  progressToMigration: number;
  baseTradeSizeUsd: number;
  hasEnteredFinal: boolean;
  hasDevBuySignal: boolean;
  hasDevSellSignal: boolean;
};

type ActorProfile = {
  walletPrefix: string;
  buyReuseBias: number;
  sellReuseBias: number;
  sellAffinity: TokenActorGroup[];
};

const ACTOR_PROFILES: Record<TokenActorGroup, ActorProfile> = {
  dev: {
    walletPrefix: 'dv',
    buyReuseBias: 0.88,
    sellReuseBias: 0.95,
    sellAffinity: ['dev'],
  },
  insiders: {
    walletPrefix: 'in',
    buyReuseBias: 0.74,
    sellReuseBias: 0.9,
    sellAffinity: ['insiders', 'smart_early_buyers', 'snipers'],
  },
  snipers: {
    walletPrefix: 'sn',
    buyReuseBias: 0.56,
    sellReuseBias: 0.9,
    sellAffinity: ['snipers', 'insiders'],
  },
  smart_early_buyers: {
    walletPrefix: 'se',
    buyReuseBias: 0.72,
    sellReuseBias: 0.82,
    sellAffinity: ['smart_early_buyers', 'insiders', 'dip_buyers'],
  },
  momentum_chasers: {
    walletPrefix: 'mc',
    buyReuseBias: 0.44,
    sellReuseBias: 0.7,
    sellAffinity: ['momentum_chasers', 'late_retail'],
  },
  late_retail: {
    walletPrefix: 'lr',
    buyReuseBias: 0.3,
    sellReuseBias: 0.58,
    sellAffinity: ['late_retail', 'momentum_chasers', 'panic_sellers'],
  },
  dip_buyers: {
    walletPrefix: 'db',
    buyReuseBias: 0.68,
    sellReuseBias: 0.76,
    sellAffinity: ['dip_buyers', 'smart_early_buyers', 'late_retail'],
  },
  panic_sellers: {
    walletPrefix: 'ps',
    buyReuseBias: 0.18,
    sellReuseBias: 0.82,
    sellAffinity: ['panic_sellers', 'late_retail', 'momentum_chasers', 'dip_buyers'],
  },
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function addWeight(target: Partial<Record<TokenActorGroup, number>>, group: TokenActorGroup, weight: number): void {
  if (!Number.isFinite(weight) || weight <= 0) return;
  target[group] = (target[group] ?? 0) + weight;
}

function toMix(target: Partial<Record<TokenActorGroup, number>>): TokenActorMixEntry[] {
  const entries = Object.entries(target)
    .filter(([, weight]) => Number.isFinite(weight) && weight > 0)
    .map(([group, weight]) => ({ group: group as TokenActorGroup, weight: weight as number }));
  if (entries.length === 0) return [];

  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  return entries
    .map((entry) => ({ group: entry.group, weight: entry.weight / Math.max(1e-6, total) }))
    .sort((a, b) => b.weight - a.weight);
}

function sumWeights(target: Partial<Record<TokenActorGroup, number>>): number {
  let total = 0;
  for (const weight of Object.values(target)) {
    if (Number.isFinite(weight) && weight > 0) total += weight;
  }
  return total;
}

export function getActorWalletPrefix(group: TokenActorGroup): string {
  return ACTOR_PROFILES[group].walletPrefix;
}

export function getActorBuyReuseBias(group: TokenActorGroup): number {
  return ACTOR_PROFILES[group].buyReuseBias;
}

export function getActorSellReuseBias(group: TokenActorGroup): number {
  return ACTOR_PROFILES[group].sellReuseBias;
}

export function getActorSellAffinityPrefixes(group: TokenActorGroup): string[] {
  return ACTOR_PROFILES[group].sellAffinity.map((entry) => ACTOR_PROFILES[entry].walletPrefix);
}

export function pickActorGroup(
  rng: RNG,
  mix: TokenActorMixEntry[],
  fallback: TokenActorGroup
): TokenActorGroup {
  if (mix.length === 0) return fallback;

  let u = rng.next();
  for (let i = 0; i < mix.length; i++) {
    u -= mix[i]!.weight;
    if (u <= 0) return mix[i]!.group;
  }
  return mix[mix.length - 1]!.group;
}

export function computeActorOverlay(rng: RNG, context: TokenActorContext): TokenActorOverlay {
  const buyWeights: Partial<Record<TokenActorGroup, number>> = {};
  const sellWeights: Partial<Record<TokenActorGroup, number>> = {};

  const ageSec = context.simTimeMs / 1000;
  const weakToken = context.qualityScore < 0.42 || context.fate === 'QUICK_RUG';
  const strongToken = context.qualityScore > 0.68 && context.fate !== 'QUICK_RUG';
  const nearMigration = context.progressToMigration >= 0.72 || context.hasEnteredFinal;
  const strongBreakout = context.flowStrength > 0.18 && context.changePct > 28;
  const failedMove = context.flowStrength < -0.08 || context.changePct < -14;
  const contestedRange = Math.abs(context.flowStrength) < 0.12;

  if (ageSec < 100) {
    addWeight(buyWeights, 'dev', context.hasDevBuySignal ? 1.2 : 0.35);
    addWeight(buyWeights, 'insiders', weakToken ? 0.44 : 0.58);
    addWeight(buyWeights, 'snipers', weakToken ? 0.78 : 0.64);
    addWeight(buyWeights, 'smart_early_buyers', strongToken ? 0.82 : 0.48);
  }

  if (context.regime === 'FIRST_PUMP') {
    addWeight(buyWeights, 'momentum_chasers', 0.7 + Math.max(0, context.flowStrength) * 0.55);
    addWeight(buyWeights, 'late_retail', strongBreakout ? 0.46 : 0.24);
    addWeight(sellWeights, 'snipers', 0.7 + Math.max(0, context.changePct) / 160);
    addWeight(sellWeights, 'insiders', weakToken ? 0.7 : 0.44);
    addWeight(sellWeights, 'smart_early_buyers', 0.2 + Math.max(0, context.changePct) / 260);
  }

  if (context.regime === 'CHOP') {
    addWeight(buyWeights, 'dip_buyers', contestedRange ? 0.62 : 0.42);
    addWeight(buyWeights, 'smart_early_buyers', strongToken ? 0.28 : 0.16);
    addWeight(sellWeights, 'panic_sellers', failedMove ? 0.58 : 0.28);
    addWeight(sellWeights, 'late_retail', 0.18);
  }

  if (context.regime === 'BLEED_OUT') {
    addWeight(sellWeights, 'panic_sellers', weakToken ? 1.1 : 0.82);
    addWeight(sellWeights, 'insiders', weakToken ? 0.56 : 0.34);
    addWeight(sellWeights, 'snipers', 0.28);
    addWeight(buyWeights, 'dip_buyers', strongToken ? 0.26 : 0.08);
  }

  if (context.regime === 'GRIND_UP') {
    addWeight(buyWeights, 'smart_early_buyers', strongToken ? 0.54 : 0.28);
    addWeight(buyWeights, 'momentum_chasers', 0.36 + Math.max(0, context.flowStrength) * 0.4);
    addWeight(sellWeights, 'smart_early_buyers', 0.16);
    addWeight(sellWeights, 'insiders', 0.22);
  }

  if (nearMigration) {
    addWeight(buyWeights, 'late_retail', strongToken ? 0.28 : 0.44);
    addWeight(sellWeights, 'insiders', weakToken ? 0.72 : 0.4);
    addWeight(sellWeights, 'panic_sellers', weakToken ? 0.68 : 0.3);
    addWeight(sellWeights, 'snipers', 0.22);
  }

  if (context.hasDevSellSignal) {
    addWeight(sellWeights, 'dev', 1.0);
  }

  const buyMix = toMix(buyWeights);
  const sellMix = toMix(sellWeights);

  const buyPressure = sumWeights(buyWeights);
  const sellPressure = sumWeights(sellWeights);
  const baseOverlayUsd = context.baseTradeSizeUsd * (0.3 + rng.next() * 0.28);

  const buyBoostUsd = baseOverlayUsd * buyPressure * (0.8 + rng.next() * 0.35);
  const sellBoostUsd = baseOverlayUsd * sellPressure * (0.8 + rng.next() * 0.35);

  return {
    buyBoostUsd: Math.max(0, buyBoostUsd),
    sellBoostUsd: Math.max(0, sellBoostUsd),
    buyMix,
    sellMix,
  };
}
