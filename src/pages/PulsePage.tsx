import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SlidersHorizontal } from 'lucide-react';
import { useTokenStore } from '../store/tokenStore';
import TokenColumn, { type PulseColumnFilters } from '../components/pulse/TokenColumn';
import PulseFiltersModal from '../components/pulse/PulseFiltersModal';
import {
  createDefaultPulseFiltersByBucket,
  parseFilterNumber,
  sanitizePulseFiltersByBucket,
  type PulseBucketKey,
  type PulseBucketTokenFilters,
  type PulseFiltersByBucket,
} from '../components/pulse/pulseFilters';
import type { TokenState } from '../tokens/types';

type ColumnKey = 'newPairs' | 'finalStretch' | 'migrated';
type PulseDisplayMode = 'comfortable' | 'dense';
type CompiledPulseBucketFilters = { [K in keyof PulseBucketTokenFilters]: number | null };

const DISPLAY_MODE_STORAGE_KEY = 'memex:pulse:display-mode';
const PULSE_FILTERS_STORAGE_KEY = 'memex:pulse:filters:v1';

const DEFAULT_COLUMN_FILTERS: Record<ColumnKey, PulseColumnFilters> = {
  newPairs: { newPairs: true, finalStretch: false, migrated: false },
  finalStretch: { newPairs: false, finalStretch: true, migrated: false },
  migrated: { newPairs: false, finalStretch: false, migrated: true },
};

function loadDisplayMode(): PulseDisplayMode {
  if (typeof window === 'undefined') return 'comfortable';
  const raw = window.localStorage.getItem(DISPLAY_MODE_STORAGE_KEY);
  if (raw === 'dense' || raw === 'comfortable') return raw;
  return 'comfortable';
}

function loadPulseFilters(): PulseFiltersByBucket {
  if (typeof window === 'undefined') return createDefaultPulseFiltersByBucket();
  try {
    const raw = window.localStorage.getItem(PULSE_FILTERS_STORAGE_KEY);
    if (!raw) return createDefaultPulseFiltersByBucket();
    return sanitizePulseFiltersByBucket(JSON.parse(raw) as Partial<PulseFiltersByBucket>);
  } catch {
    return createDefaultPulseFiltersByBucket();
  }
}

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

function compilePulseBucketFilters(filters: PulseBucketTokenFilters): CompiledPulseBucketFilters {
  return {
    minMC: parseFilterNumber(filters.minMC),
    maxMC: parseFilterNumber(filters.maxMC),
    minLiq: parseFilterNumber(filters.minLiq),
    maxLiq: parseFilterNumber(filters.maxLiq),
    minVol: parseFilterNumber(filters.minVol),
    maxVol: parseFilterNumber(filters.maxVol),
    minTx60s: parseFilterNumber(filters.minTx60s),
    maxTx60s: parseFilterNumber(filters.maxTx60s),
    minBuys60s: parseFilterNumber(filters.minBuys60s),
    maxBuys60s: parseFilterNumber(filters.maxBuys60s),
    minSells60s: parseFilterNumber(filters.minSells60s),
    maxSells60s: parseFilterNumber(filters.maxSells60s),
    maxAgeMinutes: parseFilterNumber(filters.maxAgeMinutes),
    maxTopHoldersPct: parseFilterNumber(filters.maxTopHoldersPct),
    maxDevHoldingPct: parseFilterNumber(filters.maxDevHoldingPct),
    maxSnipersPct: parseFilterNumber(filters.maxSnipersPct),
    maxInsidersPct: parseFilterNumber(filters.maxInsidersPct),
    maxBundlePct: parseFilterNumber(filters.maxBundlePct),
  };
}

function passesMinMax(value: number, min: number | null, max: number | null): boolean {
  if (min != null && value < min) return false;
  if (max != null && value > max) return false;
  return true;
}

function tokenMatchesPulseFilters(
  token: TokenState,
  flow: { buys60s?: number; sells60s?: number; tx60s?: number } | undefined,
  filters: CompiledPulseBucketFilters
): boolean {
  const tx60s = flow?.tx60s ?? 0;
  const buys60s = flow?.buys60s ?? 0;
  const sells60s = flow?.sells60s ?? 0;
  const ageMinutes = Number.isFinite(token.createdAtSimMs)
    ? Math.max(0, (token.simTimeMs - token.createdAtSimMs) / 60_000)
    : Number.POSITIVE_INFINITY;

  if (!passesMinMax(token.mcapUsd, filters.minMC, filters.maxMC)) return false;
  if (!passesMinMax(token.liquidityUsd, filters.minLiq, filters.maxLiq)) return false;
  if (!passesMinMax(token.vol5mUsd, filters.minVol, filters.maxVol)) return false;
  if (!passesMinMax(tx60s, filters.minTx60s, filters.maxTx60s)) return false;
  if (!passesMinMax(buys60s, filters.minBuys60s, filters.maxBuys60s)) return false;
  if (!passesMinMax(sells60s, filters.minSells60s, filters.maxSells60s)) return false;
  if (filters.maxAgeMinutes != null && ageMinutes > filters.maxAgeMinutes) return false;
  if (filters.maxTopHoldersPct != null && token.metrics.topHoldersPct > filters.maxTopHoldersPct) return false;
  if (filters.maxDevHoldingPct != null && token.metrics.devHoldingsPct > filters.maxDevHoldingPct) return false;
  if (filters.maxSnipersPct != null && token.metrics.snipersPct > filters.maxSnipersPct) return false;
  if (filters.maxInsidersPct != null && token.metrics.insidersPct > filters.maxInsidersPct) return false;
  if (filters.maxBundlePct != null && token.metrics.bundlersPct > filters.maxBundlePct) return false;
  return true;
}

export default function PulsePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get('view');
  const tokensById = useTokenStore(s => s.tokensById);
  const tradeFlowByTokenId = useTokenStore(s => s.tradeFlowByTokenId);
  const [displayMode, setDisplayMode] = useState<PulseDisplayMode>(() => loadDisplayMode());
  const [filtersModalOpen, setFiltersModalOpen] = useState(false);
  const [pulseFiltersByBucket, setPulseFiltersByBucket] = useState<PulseFiltersByBucket>(() => loadPulseFilters());
  const [columnFilters, setColumnFilters] = useState<Record<ColumnKey, PulseColumnFilters>>(
    DEFAULT_COLUMN_FILTERS
  );

  useEffect(() => {
    if (!view || view === 'pulse') return;
    const next = new URLSearchParams(searchParams);
    next.set('view', 'pulse');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, view]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(DISPLAY_MODE_STORAGE_KEY, displayMode);
  }, [displayMode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(PULSE_FILTERS_STORAGE_KEY, JSON.stringify(pulseFiltersByBucket));
  }, [pulseFiltersByBucket]);

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

  const compiledFiltersByBucket = useMemo<Record<PulseBucketKey, CompiledPulseBucketFilters>>(
    () => ({
      newPairs: compilePulseBucketFilters(pulseFiltersByBucket.newPairs),
      finalStretch: compilePulseBucketFilters(pulseFiltersByBucket.finalStretch),
      migrated: compilePulseBucketFilters(pulseFiltersByBucket.migrated),
    }),
    [pulseFiltersByBucket]
  );

  const filterTokensForBucket = (bucket: PulseBucketKey, rows: TokenState[]) =>
    rows.filter((token) => tokenMatchesPulseFilters(token, tradeFlowByTokenId[token.id], compiledFiltersByBucket[bucket]));

  const newPairs = useMemo(
    () => filterTokensForBucket('newPairs', withDead(columnFilters.newPairs, buckets)),
    [buckets, columnFilters.newPairs, compiledFiltersByBucket, tradeFlowByTokenId]
  );
  const finalStretch = useMemo(
    () => filterTokensForBucket('finalStretch', withDead(columnFilters.finalStretch, buckets)),
    [buckets, columnFilters.finalStretch, compiledFiltersByBucket, tradeFlowByTokenId]
  );
  const migrated = useMemo(
    () => filterTokensForBucket('migrated', withDead(columnFilters.migrated, buckets)),
    [buckets, columnFilters.migrated, compiledFiltersByBucket, tradeFlowByTokenId]
  );

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-hidden px-3 pt-3 pb-3">
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setFiltersModalOpen(true)}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-ax-border bg-ax-surface2/70 px-3 text-[11px] font-semibold text-ax-text transition-colors hover:bg-ax-surface2"
        >
          <SlidersHorizontal size={13} className="text-[#8fa2ff]" />
          Filters
        </button>

        <div className="inline-flex items-center gap-1 rounded-md border border-ax-border bg-ax-surface2/70 px-1 py-1">
          <span className="px-2 text-[11px] font-medium text-ax-text-dim">Display</span>
          <button
            type="button"
            onClick={() => setDisplayMode('comfortable')}
            className={[
              'h-7 rounded px-2.5 text-[11px] font-semibold transition-colors',
              displayMode === 'comfortable'
                ? 'bg-[#4f6dff2f] text-[#8fa2ff]'
                : 'text-ax-text-dim hover:text-ax-text',
            ].join(' ')}
          >
            Comfortable
          </button>
          <button
            type="button"
            onClick={() => setDisplayMode('dense')}
            className={[
              'h-7 rounded px-2.5 text-[11px] font-semibold transition-colors',
              displayMode === 'dense'
                ? 'bg-[#4f6dff2f] text-[#8fa2ff]'
                : 'text-ax-text-dim hover:text-ax-text',
            ].join(' ')}
          >
            Dense
          </button>
        </div>
      </div>
      <div className="flex flex-1 gap-3 overflow-hidden">
        <TokenColumn
          title="New Pairs"
          tokens={newPairs}
          accent="#00d4a1"
          filters={columnFilters.newPairs}
          onFiltersChange={(next) => setColumnFilters((prev) => ({ ...prev, newPairs: next }))}
          filtersEnabled={false}
          displayMode={displayMode}
        />
        <TokenColumn
          title="Final Stretch"
          tokens={finalStretch}
          accent="#f5c542"
          filters={columnFilters.finalStretch}
          onFiltersChange={(next) => setColumnFilters((prev) => ({ ...prev, finalStretch: next }))}
          filtersEnabled={false}
          displayMode={displayMode}
        />
        <TokenColumn
          title="Migrated"
          tokens={migrated}
          accent="#6c63ff"
          filters={columnFilters.migrated}
          onFiltersChange={(next) => setColumnFilters((prev) => ({ ...prev, migrated: next }))}
          filtersEnabled={false}
          displayMode={displayMode}
        />
      </div>

      <PulseFiltersModal
        open={filtersModalOpen}
        value={pulseFiltersByBucket}
        onClose={() => setFiltersModalOpen(false)}
        onApply={(next) => {
          setPulseFiltersByBucket(next);
          setFiltersModalOpen(false);
        }}
      />
    </div>
  );
}
