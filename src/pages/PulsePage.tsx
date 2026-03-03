import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PulseSubNav, { sanitizePulseView } from '../components/pulse/PulseSubNav';
import { useTokenStore } from '../store/tokenStore';
import { useFavoritesStore } from '../store/favoritesStore';
import { useTradingStore } from '../store/tradingStore';
import TokenColumn, { type PulseColumnFilters } from '../components/pulse/TokenColumn';
import type { TokenState } from '../tokens/types';

type ColumnKey = 'newPairs' | 'finalStretch' | 'migrated';

const DEFAULT_COLUMN_FILTERS: Record<ColumnKey, PulseColumnFilters> = {
  newPairs: { newPairs: true, finalStretch: false, migrated: false },
  finalStretch: { newPairs: false, finalStretch: true, migrated: false },
  migrated: { newPairs: false, finalStretch: false, migrated: true },
};

function withDead(
  filters: PulseColumnFilters,
  buckets: {
    newPairs: TokenState[];
    finalStretch: TokenState[];
    migrated: TokenState[];
    deadLow: TokenState[];
    deadHigh: TokenState[];
  }
): TokenState[] {
  const out: TokenState[] = [];
  if (filters.newPairs) out.push(...buckets.newPairs, ...buckets.deadLow);
  if (filters.finalStretch) out.push(...buckets.finalStretch, ...buckets.deadHigh);
  if (filters.migrated) out.push(...buckets.migrated);
  return out.sort((a, b) => b.mcapUsd - a.mcapUsd);
}

export default function PulsePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = sanitizePulseView(searchParams.get('view'));
  const tokensById = useTokenStore(s => s.tokensById);
  const favoriteIds = useFavoritesStore((s) => s.favoriteIds);
  const quickPositionsByTokenId = useTradingStore((s) => s.quickPositionsByTokenId);
  const [columnFilters, setColumnFilters] = useState<Record<ColumnKey, PulseColumnFilters>>(
    DEFAULT_COLUMN_FILTERS
  );

  useEffect(() => {
    const raw = searchParams.get('view');
    if (raw === null || raw === 'pulse' || raw === 'watchlist' || raw === 'positions') return;
    const next = new URLSearchParams(searchParams);
    next.set('view', 'pulse');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const buckets = useMemo(() => {
    const all = Object.values(tokensById);
    const byMcapDesc = (a: (typeof all)[number], b: (typeof all)[number]) => b.mcapUsd - a.mcapUsd;
    return {
      newPairs: all.filter(t => t.phase === 'NEW').sort(byMcapDesc),
      finalStretch: all.filter(t => t.phase === 'FINAL').sort(byMcapDesc),
      migrated: all.filter(t => t.phase === 'MIGRATED').sort(byMcapDesc),
      deadLow: all.filter(t => (t.phase === 'DEAD' || t.phase === 'RUGGED') && t.mcapUsd < 30_000).sort(byMcapDesc),
      deadHigh: all.filter(t => (t.phase === 'DEAD' || t.phase === 'RUGGED') && t.mcapUsd >= 30_000).sort(byMcapDesc),
    };
  }, [tokensById]);

  const newPairs = useMemo(
    () => withDead(columnFilters.newPairs, buckets),
    [buckets, columnFilters.newPairs]
  );
  const finalStretch = useMemo(
    () => withDead(columnFilters.finalStretch, buckets),
    [buckets, columnFilters.finalStretch]
  );
  const migrated = useMemo(
    () => withDead(columnFilters.migrated, buckets),
    [buckets, columnFilters.migrated]
  );
  const watchlistTokens = useMemo(() => {
    const out: TokenState[] = [];
    for (let i = 0; i < favoriteIds.length; i++) {
      const id = favoriteIds[i]!;
      const token = tokensById[id];
      if (!token) continue;
      out.push(token);
    }
    return out;
  }, [favoriteIds, tokensById]);
  const positionsTokens = useMemo(() => {
    const rows = Object.entries(quickPositionsByTokenId);
    const out: Array<{ token: TokenState; updatedAtMs: number }> = [];
    for (let i = 0; i < rows.length; i++) {
      const [tokenId, pos] = rows[i]!;
      if ((pos?.qty ?? 0) <= 0) continue;
      const token = tokensById[tokenId];
      if (!token) continue;
      if (token.phase === 'DEAD' || token.phase === 'RUGGED') continue;
      out.push({ token, updatedAtMs: pos.updatedAtMs ?? 0 });
    }
    out.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
    return out.map((row) => row.token);
  }, [quickPositionsByTokenId, tokensById]);

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-hidden px-3 pt-3 pb-3">
      <PulseSubNav />
      {view === 'pulse' && (
        <div className="flex flex-1 gap-3 overflow-hidden">
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
      )}
      {view === 'watchlist' && (
        <div className="flex flex-1 min-h-0">
          <TokenColumn
            title="Watchlist"
            tokens={watchlistTokens}
            accent="#f5c542"
            filters={{ newPairs: true, finalStretch: true, migrated: true }}
            onFiltersChange={() => {}}
            filtersEnabled={false}
          />
        </div>
      )}
      {view === 'positions' && (
        <div className="flex flex-1 min-h-0">
          <TokenColumn
            title="Active Positions"
            tokens={positionsTokens}
            accent="#4fa7ff"
            filters={{ newPairs: true, finalStretch: true, migrated: true }}
            onFiltersChange={() => {}}
            filtersEnabled={false}
          />
        </div>
      )}
    </div>
  );
}
