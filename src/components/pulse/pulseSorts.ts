import type { TokenTradeFlowSnapshot } from '../../store/tokenStore';
import type { TokenState } from '../../tokens/types';
import type { PulseBucketKey } from './pulseFilters';

export type PulseBucketSortMode = 'flow60s' | 'vol' | 'mc' | 'age';
export type PulseSortsByBucket = Record<PulseBucketKey, PulseBucketSortMode>;

type TradeFlowLookup = Record<string, TokenTradeFlowSnapshot | undefined>;

export const PULSE_SORT_MODE_LABELS: Record<PulseBucketSortMode, string> = {
  flow60s: 'Flow60s',
  vol: 'Vol',
  mc: 'MC',
  age: 'Age',
};

export function getPulseBucketDefaultSort(bucket: PulseBucketKey): PulseBucketSortMode {
  if (bucket === 'newPairs') return 'age';
  if (bucket === 'finalStretch') return 'flow60s';
  return 'vol';
}

export function createDefaultPulseSortsByBucket(): PulseSortsByBucket {
  return {
    newPairs: getPulseBucketDefaultSort('newPairs'),
    finalStretch: getPulseBucketDefaultSort('finalStretch'),
    migrated: getPulseBucketDefaultSort('migrated'),
  };
}

export function sanitizePulseSortsByBucket(input: Partial<PulseSortsByBucket> | null | undefined): PulseSortsByBucket {
  const defaults = createDefaultPulseSortsByBucket();
  if (!input) return defaults;
  return {
    newPairs: sanitizePulseSortMode(input.newPairs, defaults.newPairs),
    finalStretch: sanitizePulseSortMode(input.finalStretch, defaults.finalStretch),
    migrated: sanitizePulseSortMode(input.migrated, defaults.migrated),
  };
}

export function sortPulseTokensForBucket(
  tokens: TokenState[],
  _bucket: PulseBucketKey,
  sortMode: PulseBucketSortMode,
  tradeFlowByTokenId: TradeFlowLookup
): TokenState[] {
  const next = tokens.slice();
  next.sort((left, right) => comparePulseTokens(left, right, sortMode, tradeFlowByTokenId));
  return next;
}

export function getTokenAgeMinutes(token: TokenState): number {
  if (!Number.isFinite(token.createdAtSimMs) || !Number.isFinite(token.simTimeMs)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (token.simTimeMs - token.createdAtSimMs) / 60_000);
}

function sanitizePulseSortMode(value: PulseBucketSortMode | undefined, fallback: PulseBucketSortMode): PulseBucketSortMode {
  if (value === 'flow60s' || value === 'vol' || value === 'mc' || value === 'age') return value;
  return fallback;
}

function comparePulseTokens(
  left: TokenState,
  right: TokenState,
  sortMode: PulseBucketSortMode,
  tradeFlowByTokenId: TradeFlowLookup
): number {
  if (sortMode === 'age') {
    const ageCmp = compareAsc(getTokenAgeMinutes(left), getTokenAgeMinutes(right));
    if (ageCmp !== 0) return ageCmp;
    return (
      compareDesc(getFlowTx(left.id, tradeFlowByTokenId), getFlowTx(right.id, tradeFlowByTokenId))
      || compareDesc(safeNumber(left.vol5mUsd), safeNumber(right.vol5mUsd))
      || compareDesc(safeNumber(left.mcapUsd), safeNumber(right.mcapUsd))
      || compareIds(left.id, right.id)
    );
  }

  if (sortMode === 'flow60s') {
    return (
      compareDesc(getFlowTx(left.id, tradeFlowByTokenId), getFlowTx(right.id, tradeFlowByTokenId))
      || compareDesc(getFlowBuys(left.id, tradeFlowByTokenId), getFlowBuys(right.id, tradeFlowByTokenId))
      || compareDesc(safeNumber(left.vol5mUsd), safeNumber(right.vol5mUsd))
      || compareDesc(safeNumber(left.mcapUsd), safeNumber(right.mcapUsd))
      || compareIds(left.id, right.id)
    );
  }

  if (sortMode === 'vol') {
    return (
      compareDesc(safeNumber(left.vol5mUsd), safeNumber(right.vol5mUsd))
      || compareDesc(getFlowTx(left.id, tradeFlowByTokenId), getFlowTx(right.id, tradeFlowByTokenId))
      || compareDesc(safeNumber(left.mcapUsd), safeNumber(right.mcapUsd))
      || compareIds(left.id, right.id)
    );
  }

  return (
    compareDesc(safeNumber(left.mcapUsd), safeNumber(right.mcapUsd))
    || compareDesc(safeNumber(left.vol5mUsd), safeNumber(right.vol5mUsd))
    || compareDesc(getFlowTx(left.id, tradeFlowByTokenId), getFlowTx(right.id, tradeFlowByTokenId))
    || compareIds(left.id, right.id)
  );
}

function compareDesc(left: number, right: number): number {
  return right - left;
}

function compareAsc(left: number, right: number): number {
  return left - right;
}

function compareIds(left: string, right: string): number {
  return left.localeCompare(right);
}

function safeNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function getFlowSnapshot(tokenId: string, tradeFlowByTokenId: TradeFlowLookup): TokenTradeFlowSnapshot | undefined {
  return tradeFlowByTokenId[tokenId];
}

function getFlowTx(tokenId: string, tradeFlowByTokenId: TradeFlowLookup): number {
  return safeNumber(getFlowSnapshot(tokenId, tradeFlowByTokenId)?.tx60s ?? 0);
}

function getFlowBuys(tokenId: string, tradeFlowByTokenId: TradeFlowLookup): number {
  return safeNumber(getFlowSnapshot(tokenId, tradeFlowByTokenId)?.buys60s ?? 0);
}
