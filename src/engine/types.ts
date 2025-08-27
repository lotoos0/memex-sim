export type Regime = 'bull' | 'bear' | 'range' | 'mania' | 'rugRisk';

export interface Tick {
  t: number;     // unix ms
  p: number;     // price
  v: number;     // volume
}

export interface Candle {
  time: number;  // unix sec
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type EventType = 'CT_Hype' | 'Dev_Rug_Rumor' | 'Listing_Tier3';

export interface SimEvent {
  id: string;
  time: number;       // unix ms
  type: EventType;
  text: string;
  impact: number;     // [-0.4, 0.4] multiplicative jump factor - 1
  volBoost: number;   // multiplier > 0
  halfLifeSec: number;
}

export interface EventImpactSummary {
  priceJumpMul: number;  // multiplicative jump on price on this tick
  muBoost: number;       // additive drift boost this tick (decaying)
  volBoost: number;      // multiplicative vol/volume boost this tick (decaying)
  newEvents: SimEvent[]; // events created this tick
}

export interface EnginesConfig {
  startPrice?: number; // NEW
  initial: { price: number; liquidityK: number; supply: number; feesBps: number; bondingCurvePct: number };
  regimes: Record<Regime, { mu: number; sigma: number; lambda: number; kappa: number; eventRate: number }>;
  transitions: Record<Regime, Array<{ to: Regime; p: number }>>;
  transitionCheckSec: number;
  eventDefs: Record<EventType, { impactMean: number; impactStd: number; volBoost: number; muBoost: number; halfLifeSec: number }>;
}
