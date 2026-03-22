import type { TokenState } from './types';

export const NEW_PAIRS_MAX_AGE_MS = 3 * 60_000;
export const NEW_PAIRS_MAX_ITEMS = 20;
export const FINAL_STRETCH_MIN_BONDING_PCT = 80;

export function getTokenAgeMs(token: Pick<TokenState, 'simTimeMs' | 'createdAtSimMs'>): number {
  if (!Number.isFinite(token.simTimeMs) || !Number.isFinite(token.createdAtSimMs)) return 0;
  return Math.max(0, token.simTimeMs - token.createdAtSimMs);
}

export function isNewPairsToken(token: TokenState): boolean {
  if (token.phase === 'MIGRATED') return false;
  return getTokenAgeMs(token) <= NEW_PAIRS_MAX_AGE_MS;
}

export function isFinalStretchToken(token: TokenState): boolean {
  if (token.phase === 'MIGRATED' || token.phase === 'DEAD' || token.phase === 'RUGGED') return false;
  return token.bondingCurvePct >= FINAL_STRETCH_MIN_BONDING_PCT && token.bondingCurvePct < 100;
}

export function isMigratedToken(token: TokenState): boolean {
  return token.phase === 'MIGRATED';
}
