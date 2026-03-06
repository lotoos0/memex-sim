export type PulseBucketKey = 'newPairs' | 'finalStretch' | 'migrated';

export interface PulseBucketTokenFilters {
  minMC: string;
  maxMC: string;
  minLiq: string;
  maxLiq: string;
  minVol: string;
  maxVol: string;
  minTx60s: string;
  maxTx60s: string;
  minBuys60s: string;
  maxBuys60s: string;
  minSells60s: string;
  maxSells60s: string;
  maxAgeMinutes: string;
  maxTopHoldersPct: string;
  maxDevHoldingPct: string;
  maxSnipersPct: string;
  maxInsidersPct: string;
  maxBundlePct: string;
}

export type PulseFiltersByBucket = Record<PulseBucketKey, PulseBucketTokenFilters>;

export const PULSE_BUCKET_ORDER: PulseBucketKey[] = ['newPairs', 'finalStretch', 'migrated'];

export const PULSE_BUCKET_LABELS: Record<PulseBucketKey, string> = {
  newPairs: 'New Pairs',
  finalStretch: 'Final Stretch',
  migrated: 'Migrated',
};

export function createDefaultPulseBucketFilters(): PulseBucketTokenFilters {
  return {
    minMC: '',
    maxMC: '',
    minLiq: '',
    maxLiq: '',
    minVol: '',
    maxVol: '',
    minTx60s: '',
    maxTx60s: '',
    minBuys60s: '',
    maxBuys60s: '',
    minSells60s: '',
    maxSells60s: '',
    maxAgeMinutes: '',
    maxTopHoldersPct: '',
    maxDevHoldingPct: '',
    maxSnipersPct: '',
    maxInsidersPct: '',
    maxBundlePct: '',
  };
}

export function createDefaultPulseFiltersByBucket(): PulseFiltersByBucket {
  return {
    newPairs: createDefaultPulseBucketFilters(),
    finalStretch: createDefaultPulseBucketFilters(),
    migrated: createDefaultPulseBucketFilters(),
  };
}

export function sanitizePulseBucketFilters(input: Partial<PulseBucketTokenFilters> | null | undefined): PulseBucketTokenFilters {
  const defaults = createDefaultPulseBucketFilters();
  if (!input) return defaults;
  const next = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof PulseBucketTokenFilters)[]) {
    const raw = input[key];
    next[key] = typeof raw === 'string' ? raw : '';
  }
  return next;
}

export function sanitizePulseFiltersByBucket(input: Partial<PulseFiltersByBucket> | null | undefined): PulseFiltersByBucket {
  const defaults = createDefaultPulseFiltersByBucket();
  if (!input) return defaults;
  return {
    newPairs: sanitizePulseBucketFilters(input.newPairs),
    finalStretch: sanitizePulseBucketFilters(input.finalStretch),
    migrated: sanitizePulseBucketFilters(input.migrated),
  };
}

export function countActivePulseBucketFilters(filters: PulseBucketTokenFilters): number {
  let count = 0;
  for (const value of Object.values(filters)) {
    if (value.trim() !== '') count += 1;
  }
  return count;
}

export function parseFilterNumber(raw: string): number | null {
  const normalized = raw.trim().replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}
