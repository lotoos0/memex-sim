export type SessionBucket = 'EU' | 'NA' | 'OVERLAP' | 'OFF';
export type SessionSimProfile = {
  tempoMul: number;
  buyBiasShift: number;
  fakeoutChancePerSec: number;
  nukeChanceMul: number;
  whaleMul: number;
  impulseTtlMul: number;
};

const EU_START_MIN_UTC_PLUS_2 = 6 * 60;
const EU_END_MIN_UTC_PLUS_2 = 15 * 60;
const EU_FIXED_OFFSET_MINUTES = 2 * 60;
const NA_START_MIN_LOCAL = 8 * 60;
const NA_END_MIN_LOCAL = 17 * 60;
const NA_TZ = 'America/New_York';

const formatterByZone = new Map<string, Intl.DateTimeFormat>();

function getZoneFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterByZone.get(timeZone);
  if (cached) return cached;

  const created = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  formatterByZone.set(timeZone, created);
  return created;
}

function getZoneMinutes(nowMs: number, timeZone: string): number | null {
  try {
    const parts = getZoneFormatter(timeZone).formatToParts(nowMs);
    let hour = -1;
    let minute = -1;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      if (part.type === 'hour') hour = Number(part.value);
      if (part.type === 'minute') minute = Number(part.value);
    }
    if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || minute < 0) return null;
    return hour * 60 + minute;
  } catch {
    return null;
  }
}

function getFixedOffsetMinutes(nowMs: number, offsetMinutes: number): number | null {
  if (!Number.isFinite(nowMs) || !Number.isFinite(offsetMinutes)) return null;
  const shifted = new Date(nowMs + offsetMinutes * 60_000);
  const hour = shifted.getUTCHours();
  const minute = shifted.getUTCMinutes();
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function isInSessionWindow(localMinutes: number, startMin: number, endMin: number): boolean {
  return localMinutes >= startMin && localMinutes < endMin;
}

export function getSessionBucket(nowMs: number = Date.now()): SessionBucket {
  const euMinutes = getFixedOffsetMinutes(nowMs, EU_FIXED_OFFSET_MINUTES);
  const naMinutes = getZoneMinutes(nowMs, NA_TZ);
  if (euMinutes == null || naMinutes == null) return 'OFF';

  const euOpen = isInSessionWindow(euMinutes, EU_START_MIN_UTC_PLUS_2, EU_END_MIN_UTC_PLUS_2);
  const naOpen = isInSessionWindow(naMinutes, NA_START_MIN_LOCAL, NA_END_MIN_LOCAL);

  if (euOpen && naOpen) return 'OVERLAP';
  if (euOpen) return 'EU';
  if (naOpen) return 'NA';
  return 'OFF';
}

export const SESSION_BUCKET_LABEL: Record<SessionBucket, string> = {
  EU: 'EU',
  NA: 'NA',
  OVERLAP: 'EU + NA',
  OFF: 'OFF',
};

export const SESSION_SIM_PROFILE: Record<SessionBucket, SessionSimProfile> = {
  EU: {
    tempoMul: 0.78,
    buyBiasShift: -0.03,
    fakeoutChancePerSec: 0.11,
    nukeChanceMul: 0.8,
    whaleMul: 0.8,
    impulseTtlMul: 0.72,
  },
  NA: {
    tempoMul: 1.26,
    buyBiasShift: 0.015,
    fakeoutChancePerSec: 0.03,
    nukeChanceMul: 1.45,
    whaleMul: 1.3,
    impulseTtlMul: 1.12,
  },
  OVERLAP: {
    tempoMul: 1.42,
    buyBiasShift: 0.01,
    fakeoutChancePerSec: 0.045,
    nukeChanceMul: 1.2,
    whaleMul: 1.2,
    impulseTtlMul: 1.08,
  },
  OFF: {
    tempoMul: 0.62,
    buyBiasShift: -0.02,
    fakeoutChancePerSec: 0.08,
    nukeChanceMul: 0.9,
    whaleMul: 0.75,
    impulseTtlMul: 0.78,
  },
};
