import { useEffect, useState, type ReactNode } from 'react';
import { RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import {
  countActivePulseBucketFilters,
  createDefaultPulseBucketFilters,
  PULSE_BUCKET_LABELS,
  PULSE_BUCKET_ORDER,
  type PulseBucketKey,
  type PulseBucketTokenFilters,
  type PulseFiltersByBucket,
} from './pulseFilters';

type Props = {
  open: boolean;
  value: PulseFiltersByBucket;
  initialBucket?: PulseBucketKey;
  onClose: () => void;
  onApply: (next: PulseFiltersByBucket) => void;
};

type FilterFieldProps = {
  label: string;
  minKey?: keyof PulseBucketTokenFilters;
  maxKey?: keyof PulseBucketTokenFilters;
  singleKey?: keyof PulseBucketTokenFilters;
  value: PulseBucketTokenFilters;
  onChange: (key: keyof PulseBucketTokenFilters, next: string) => void;
};

type FilterFieldDescriptor = {
  label: string;
  minKey?: keyof PulseBucketTokenFilters;
  maxKey?: keyof PulseBucketTokenFilters;
  singleKey?: keyof PulseBucketTokenFilters;
};

const METRIC_FIELDS: Array<FilterFieldDescriptor> = [
  { label: 'Market Cap ($)', minKey: 'minMC', maxKey: 'maxMC' },
  { label: 'Liquidity ($)', minKey: 'minLiq', maxKey: 'maxLiq' },
  { label: 'Volume ($)', minKey: 'minVol', maxKey: 'maxVol' },
  { label: 'Txns (60s)', minKey: 'minTx60s', maxKey: 'maxTx60s' },
  { label: 'Buys (60s)', minKey: 'minBuys60s', maxKey: 'maxBuys60s' },
  { label: 'Sells (60s)', minKey: 'minSells60s', maxKey: 'maxSells60s' },
  { label: 'Age (minutes)', singleKey: 'maxAgeMinutes' },
];

const AUDIT_FIELDS: Array<FilterFieldDescriptor> = [
  { label: 'Top Holders %', singleKey: 'maxTopHoldersPct' },
  { label: 'Dev Holding %', singleKey: 'maxDevHoldingPct' },
  { label: 'Snipers %', singleKey: 'maxSnipersPct' },
  { label: 'Insiders %', singleKey: 'maxInsidersPct' },
  { label: 'Bundle %', singleKey: 'maxBundlePct' },
];

export default function PulseFiltersModal({ open, value, initialBucket = 'newPairs', onClose, onApply }: Props) {
  const [activeBucket, setActiveBucket] = useState<PulseBucketKey>('newPairs');
  const [draft, setDraft] = useState<PulseFiltersByBucket>(value);

  useEffect(() => {
    if (!open) return;
    setActiveBucket(initialBucket);
    setDraft(value);
  }, [initialBucket, open, value]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  const activeFilters = draft[activeBucket];

  const updateField = (key: keyof PulseBucketTokenFilters, next: string) => {
    setDraft((current) => ({
      ...current,
      [activeBucket]: {
        ...current[activeBucket],
        [key]: next,
      },
    }));
  };

  const resetCurrentTab = () => {
    setDraft((current) => ({
      ...current,
      [activeBucket]: createDefaultPulseBucketFilters(),
    }));
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex h-[min(760px,calc(100vh-40px))] w-[min(720px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl border border-ax-border bg-[#11131b] shadow-[0_28px_120px_rgba(0,0,0,0.55)]"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-ax-border px-4 py-3">
          <div className="inline-flex items-center gap-2">
            <SlidersHorizontal size={15} className="text-[#8fa2ff]" />
            <span className="text-sm font-semibold text-ax-text">Filters</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ax-text-dim transition-colors hover:bg-ax-surface2 hover:text-ax-text"
            aria-label="Close filters"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-ax-border px-4 py-3">
          {PULSE_BUCKET_ORDER.map((bucket) => {
            const activeCount = countActivePulseBucketFilters(draft[bucket]);
            const isActive = bucket === activeBucket;
            return (
              <button
                key={bucket}
                type="button"
                onClick={() => setActiveBucket(bucket)}
                className={[
                  'inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-colors',
                  isActive
                    ? 'border-[#6e83ff55] bg-[#6e83ff20] text-[#d7deff]'
                    : 'border-transparent bg-transparent text-ax-text-dim hover:bg-ax-surface2 hover:text-ax-text',
                ].join(' ')}
              >
                <span>{PULSE_BUCKET_LABELS[bucket]}</span>
                <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[#4f6dff] px-1.5 text-[11px] text-white">
                  {activeCount}
                </span>
              </button>
            );
          })}
        </div>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-4 py-4 md:grid-cols-2">
          <FilterSection title="$ Metrics">
            {METRIC_FIELDS.map((field) => (
              <FilterField
                key={field.label}
                label={field.label}
                minKey={field.minKey}
                maxKey={field.maxKey}
                singleKey={field.singleKey}
                value={activeFilters}
                onChange={updateField}
              />
            ))}
          </FilterSection>

          <FilterSection title="Audit">
            {AUDIT_FIELDS.map((field) => (
              <FilterField
                key={field.label}
                label={field.label}
                minKey={field.minKey}
                maxKey={field.maxKey}
                singleKey={field.singleKey}
                value={activeFilters}
                onChange={updateField}
              />
            ))}
          </FilterSection>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-ax-border px-4 py-3">
          <button
            type="button"
            onClick={resetCurrentTab}
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-ax-border bg-ax-surface px-4 text-sm font-semibold text-ax-text transition-colors hover:bg-ax-surface2"
          >
            <RotateCcw size={14} />
            Reset current tab
          </button>

          <button
            type="button"
            onClick={() => onApply(draft)}
            className="inline-flex h-11 items-center rounded-xl bg-[#4f6dff] px-5 text-sm font-bold text-white transition-colors hover:bg-[#5f7dff]"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

function FilterSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-ax-border bg-[#131722] p-4">
      <div className="mb-4 text-sm font-semibold text-ax-text">{title}</div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function FilterField({ label, minKey, maxKey, singleKey, value, onChange }: FilterFieldProps) {
  if (singleKey) {
    return (
      <label className="block">
        <span className="mb-1.5 block text-[12px] text-ax-text-dim">{label}</span>
        <input
          value={value[singleKey]}
          onChange={(ev) => onChange(singleKey, ev.target.value)}
          placeholder="Max"
          className="h-11 w-full rounded-xl border border-ax-border bg-[#10141f] px-3 text-sm text-ax-text outline-none transition-colors placeholder:text-ax-text-dim/50 focus:border-[#657cff]"
        />
      </label>
    );
  }

  return (
    <div>
      <div className="mb-1.5 text-[12px] text-ax-text-dim">{label}</div>
      <div className="grid grid-cols-2 gap-2">
        <input
          value={minKey ? value[minKey] : ''}
          onChange={(ev) => minKey && onChange(minKey, ev.target.value)}
          placeholder="Min"
          className="h-11 rounded-xl border border-ax-border bg-[#10141f] px-3 text-sm text-ax-text outline-none transition-colors placeholder:text-ax-text-dim/50 focus:border-[#657cff]"
        />
        <input
          value={maxKey ? value[maxKey] : ''}
          onChange={(ev) => maxKey && onChange(maxKey, ev.target.value)}
          placeholder="Max"
          className="h-11 rounded-xl border border-ax-border bg-[#10141f] px-3 text-sm text-ax-text outline-none transition-colors placeholder:text-ax-text-dim/50 focus:border-[#657cff]"
        />
      </div>
    </div>
  );
}
