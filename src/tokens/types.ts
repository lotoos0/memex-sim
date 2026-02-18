// ============================================================
// TOKEN CONTRACTS — frozen, do not change without updating all consumers
// ============================================================

export type TokenFate = 'QUICK_RUG' | 'SHORT' | 'NORMAL' | 'LONG_RUNNER';
export type TokenPhase = 'NEW' | 'FINAL' | 'MIGRATED' | 'RUGGED' | 'DEAD';

export interface TokenMetrics {
  topHoldersPct: number;
  devHoldingsPct: number;
  snipersPct: number;
  lpBurnedPct: number;
  insidersPct: number;
  bundlersPct: number;
}

/** Static metadata — never changes after spawn */
export interface TokenMeta {
  id: string;
  name: string;
  ticker: string;
  logoColor: string;   // hex color for logo placeholder
  supply: number;      // always SUPPLY constant
  createdAtSimMs: number;
  fate: TokenFate;
  metrics: TokenMetrics;
}

/** Live runtime values — changes on every tick */
export interface TokenRuntime {
  phase: TokenPhase;
  simTimeMs: number;
  lastPriceUsd: number;
  mcapUsd: number;
  liquidityUsd: number;
  bondingCurvePct: number;
  vol5mUsd: number;
  buys5m: number;
  sells5m: number;
  changePct: number;
  priceAtSpawn: number;
  ruggedAtSimMs: number | null;
}

export type TokenState = TokenMeta & TokenRuntime;

// ============================================================
// Global constants
// ============================================================
export const SUPPLY = 1_000_000_000;
export const MIGRATION_THRESHOLD_USD = 69_000;
export const MCAP_FLOOR_USD = 2_000;
// Keep a high ceiling to avoid visible "flat-top" clamping on chart.
export const MCAP_CAP_USD = 10_000_000;
export const SIM_TIME_MULTIPLIER = 60;
export const SOL_PRICE_USD = 150;
