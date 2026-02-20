import { RNG } from '../engine/rng';

export type FlowRegime = 'IMPULSE' | 'PAUSE' | 'PULLBACK' | 'DUMP';

export interface MarketStepInput {
  dtSec: number;
  priceUsd: number;
  liquidityUsd: number;
  attention: number;
  baseLambda: number;
  baseTradeSizeUsd: number;
  tradeSigma: number;
  driftPerSec: number;
  volatilityPerSqrtSec: number;
  buyBias: number;
  impactK: number;
  whaleChance?: number;
  whaleMinMul?: number;
  whaleMaxMul?: number;
  maxWhaleUsd?: number;
  externalFlow?: {
    buyBoostUsd?: number;
    sellBoostUsd?: number;
  };
}

export interface MarketStepOutput {
  nextPriceUsd: number;
  volumeUsd: number;
  buys: number;
  sells: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function logNormal(rng: RNG, muLog: number, sigmaLog: number): number {
  return Math.exp(muLog + sigmaLog * rng.normal());
}

export function stepMarket(rng: RNG, input: MarketStepInput): MarketStepOutput {
  const dtSec = Math.max(1e-4, input.dtSec);
  const attention = clamp(input.attention, 0.05, 3);
  const liquidity = Math.max(1, input.liquidityUsd);

  const lambda = Math.max(0.05, input.baseLambda * attention);
  const nTrades = rng.poisson(lambda * dtSec);
  const tradeCount = Math.max(1, nTrades);

  const avgSize = Math.max(1, input.baseTradeSizeUsd);
  const sigma = Math.max(0.05, input.tradeSigma);
  const muLog = Math.log(avgSize) - 0.5 * sigma * sigma;

  let buyFlow = 0;
  let sellFlow = 0;
  let buys = 0;
  let sells = 0;

  const bias = clamp(input.buyBias, 0.02, 0.98);
  const whaleChance = clamp(input.whaleChance ?? 0.05, 0, 0.95);
  const whaleMinMul = Math.max(1, input.whaleMinMul ?? 10);
  const whaleMaxMul = Math.max(whaleMinMul, input.whaleMaxMul ?? 80);
  const maxWhaleUsd = Math.max(avgSize, input.maxWhaleUsd ?? avgSize * 120);
  for (let i = 0; i < tradeCount; i++) {
    let size = logNormal(rng, muLog, sigma);
    if (rng.next() < whaleChance) {
      const mul = whaleMinMul + (whaleMaxMul - whaleMinMul) * rng.next();
      size = Math.min(maxWhaleUsd, size * mul);
    }
    if (rng.next() < bias) {
      buys++;
      buyFlow += size;
    } else {
      sells++;
      sellFlow += size;
    }
  }

  const buyBoost = Math.max(0, input.externalFlow?.buyBoostUsd ?? 0);
  const sellBoost = Math.max(0, input.externalFlow?.sellBoostUsd ?? 0);
  buyFlow += buyBoost;
  sellFlow += sellBoost;
  if (buyBoost > 0) buys += 1;
  if (sellBoost > 0) sells += 1;

  const netFlow = buyFlow - sellFlow;
  const volumeUsd = buyFlow + sellFlow;

  const impact = (netFlow / liquidity) * input.impactK;
  const noise = Math.max(0, input.volatilityPerSqrtSec) * Math.sqrt(dtSec) * rng.normal();
  const dLog = input.driftPerSec * dtSec + impact + noise;
  const nextPriceUsd = Math.max(1e-12, input.priceUsd * Math.exp(dLog));
  return { nextPriceUsd, volumeUsd, buys, sells };
}
