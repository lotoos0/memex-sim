import type { TokenPhase } from './types';

/** How many non-migrated births to retain so New Pairs can keep scrolling. */
export const NEWEST_NON_MIGRATED_RETAINED = 48;
/** Displayed New Pairs length. The hard cap will not drop these before anything else. */
export const NEWEST_NON_MIGRATED_PROTECTED = 20;
export const MAX_MIGRATED_RETAINED = 24;
export const MAX_FINAL_STRETCH_RETAINED = 12;
/** A coin that is still printing can graduate. After this age a quiet one is not required. */
export const ACTIVE_RETAIN_AGE_MS = 30 * 60_000;
export const MAX_REGISTRY_TOKENS = 360;

export type EvictionCandidate = {
  id: string;
  ageMs: number;
  phase: TokenPhase;
  bondingCurvePct: number;
  dormant: boolean;
  finalStretch: boolean;
};

export function isHeldQuantity(qty: number | null | undefined): boolean {
  return qty != null && Number.isFinite(qty) && qty > 1e-8;
}

export function collectProtectedTokenIds(input: {
  activeTokenId: string | null;
  positionQtyByTokenId: Readonly<Record<string, number>>;
  openOrderTokenIds: readonly string[];
  simPendingTokenIds: readonly string[];
}): Set<string> {
  const protectedIds = new Set<string>();
  if (input.activeTokenId) protectedIds.add(input.activeTokenId);
  const quantities = input.positionQtyByTokenId;
  for (const id of Object.keys(quantities)) {
    if (isHeldQuantity(quantities[id])) protectedIds.add(id);
  }
  for (let i = 0; i < input.openOrderTokenIds.length; i++) protectedIds.add(input.openOrderTokenIds[i]!);
  for (let i = 0; i < input.simPendingTokenIds.length; i++) protectedIds.add(input.simPendingTokenIds[i]!);
  return protectedIds;
}

/**
 * Ids that can leave the registry. A protected id is never returned.
 * Keep the newest births, coins that are still trading, and a bounded
 * Final Stretch / Migrated set for the Pulse columns.
 */
export function planEvictions(
  tokens: readonly EvictionCandidate[],
  protectedIds: ReadonlySet<string>,
): string[] {
  const keep = new Set<string>(protectedIds);

  const newest = tokens
    .filter((token) => token.phase !== 'MIGRATED')
    .sort((a, b) => a.ageMs - b.ageMs);
  const newestKeep = newest.slice(0, NEWEST_NON_MIGRATED_RETAINED);
  for (let i = 0; i < newestKeep.length; i++) keep.add(newestKeep[i]!.id);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.dormant) continue;
    if (token.phase === 'DEAD' || token.phase === 'RUGGED') continue;
    if (token.ageMs <= ACTIVE_RETAIN_AGE_MS) keep.add(token.id);
  }

  const finals = tokens
    .filter((token) => token.finalStretch)
    .sort((a, b) => b.bondingCurvePct - a.bondingCurvePct)
    .slice(0, MAX_FINAL_STRETCH_RETAINED);
  for (let i = 0; i < finals.length; i++) keep.add(finals[i]!.id);

  const migrated = tokens
    .filter((token) => token.phase === 'MIGRATED')
    .sort((a, b) => a.ageMs - b.ageMs)
    .slice(0, MAX_MIGRATED_RETAINED);
  for (let i = 0; i < migrated.length; i++) keep.add(migrated[i]!.id);

  const evict: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (!keep.has(token.id)) evict.push(token.id);
  }

  const keptCount = tokens.length - evict.length;
  if (keptCount <= MAX_REGISTRY_TOKENS) return evict;

  const displayFloor = new Set<string>();
  const floor = newest.slice(0, NEWEST_NON_MIGRATED_PROTECTED);
  for (let i = 0; i < floor.length; i++) displayFloor.add(floor[i]!.id);

  const overflow = keptCount - MAX_REGISTRY_TOKENS;
  const sacrificial = tokens
    .filter((token) => keep.has(token.id) && !protectedIds.has(token.id) && !displayFloor.has(token.id))
    .sort((a, b) => {
      if (a.dormant !== b.dormant) return a.dormant ? -1 : 1;
      return b.ageMs - a.ageMs;
    });

  const extra = Math.min(overflow, sacrificial.length);
  for (let i = 0; i < extra; i++) evict.push(sacrificial[i]!.id);
  return evict;
}
