import { useMemo, useState } from 'react';
import { useTokenStore } from '../store/tokenStore';
import TokenColumn, { type PulseColumnFilters } from '../components/pulse/TokenColumn';
import type { TokenState } from '../tokens/types';

type ColumnKey = 'newPairs' | 'finalStretch' | 'migrated';

const DEFAULT_COLUMN_FILTERS: Record<ColumnKey, PulseColumnFilters> = {
  newPairs: { newPairs: true, finalStretch: false, migrated: false },
  finalStretch: { newPairs: false, finalStretch: true, migrated: false },
  migrated: { newPairs: false, finalStretch: false, migrated: true },
};

function withRugged(
  filters: PulseColumnFilters,
  buckets: {
    newPairs: TokenState[];
    finalStretch: TokenState[];
    migrated: TokenState[];
    ruggedLow: TokenState[];
    ruggedHigh: TokenState[];
  }
): TokenState[] {
  const out: TokenState[] = [];
  if (filters.newPairs) out.push(...buckets.newPairs, ...buckets.ruggedLow);
  if (filters.finalStretch) out.push(...buckets.finalStretch, ...buckets.ruggedHigh);
  if (filters.migrated) out.push(...buckets.migrated);
  return out.sort((a, b) => b.mcapUsd - a.mcapUsd);
}

export default function PulsePage() {
  const tokensById = useTokenStore(s => s.tokensById);
  const [columnFilters, setColumnFilters] = useState<Record<ColumnKey, PulseColumnFilters>>(
    DEFAULT_COLUMN_FILTERS
  );

  const buckets = useMemo(() => {
    const all = Object.values(tokensById);
    const byMcapDesc = (a: (typeof all)[number], b: (typeof all)[number]) => b.mcapUsd - a.mcapUsd;
    return {
      newPairs: all.filter(t => t.phase === 'NEW').sort(byMcapDesc),
      finalStretch: all.filter(t => t.phase === 'FINAL').sort(byMcapDesc),
      migrated: all.filter(t => t.phase === 'MIGRATED').sort(byMcapDesc),
      ruggedLow: all.filter(t => t.phase === 'RUGGED' && t.mcapUsd < 30_000).sort(byMcapDesc),
      ruggedHigh: all.filter(t => t.phase === 'RUGGED' && t.mcapUsd >= 30_000).sort(byMcapDesc),
    };
  }, [tokensById]);

  const newPairs = useMemo(
    () => withRugged(columnFilters.newPairs, buckets),
    [buckets, columnFilters.newPairs]
  );
  const finalStretch = useMemo(
    () => withRugged(columnFilters.finalStretch, buckets),
    [buckets, columnFilters.finalStretch]
  );
  const migrated = useMemo(
    () => withRugged(columnFilters.migrated, buckets),
    [buckets, columnFilters.migrated]
  );

  return (
    <div className="flex flex-1 gap-3 overflow-hidden px-3 pt-5 pb-3">
      <TokenColumn
        title="New Pairs"
        tokens={newPairs}
        accent="#00d4a1"
        filters={columnFilters.newPairs}
        onFiltersChange={(next) => setColumnFilters((prev) => ({ ...prev, newPairs: next }))}
      />
      <TokenColumn
        title="Final Stretch"
        tokens={finalStretch}
        accent="#f5c542"
        filters={columnFilters.finalStretch}
        onFiltersChange={(next) => setColumnFilters((prev) => ({ ...prev, finalStretch: next }))}
      />
      <TokenColumn
        title="Migrated"
        tokens={migrated}
        accent="#6c63ff"
        filters={columnFilters.migrated}
        onFiltersChange={(next) => setColumnFilters((prev) => ({ ...prev, migrated: next }))}
      />
    </div>
  );
}
