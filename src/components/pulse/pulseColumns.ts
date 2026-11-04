import type { TokenState } from '../../tokens/types';
import { isFinalStretchToken, isMigratedToken } from '../../tokens/tokenBuckets';

export type PulseDisplayColumn = 'newPairs' | 'finalStretch' | 'migrated';

/** Column membership before the user's filter, sort, and render cap. */
export function pulseColumnCandidates(tokens: readonly TokenState[], column: PulseDisplayColumn): TokenState[] {
  if (column === 'finalStretch') return tokens.filter(isFinalStretchToken);
  if (column === 'migrated') return tokens.filter(isMigratedToken);
  return tokens.filter((token) => token.phase !== 'MIGRATED');
}

/**
 * Render cap for an already filtered and sorted column.
 * The cap is last so a mcap filter or a volume sort can still see rows
 * that would have lost a pre-sort slice.
 */
export function capPulseColumn<T>(rows: readonly T[], limit: number): T[] {
  if (rows.length <= limit) return rows.slice();
  return rows.slice(0, limit);
}
