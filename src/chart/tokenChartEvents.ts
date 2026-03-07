import type { SeriesMarker, Time, UTCTimestamp } from 'lightweight-charts';

export type TokenChartEventType =
  | 'MIGRATION'
  | 'DEV_BUY'
  | 'DEV_SELL'
  | 'USER_BUY'
  | 'USER_SELL';

export interface TokenChartEvent {
  tokenId: string;
  tMs: number;
  type: TokenChartEventType;
  price?: number;
  mcap?: number;
  size?: number;
}

export type DisplayOptions = {
  migration: boolean;
  devTrades: boolean;
  myTrades: boolean;
};

export const MAX_EVENTS_PER_TOKEN = 1000;

type MarkerVisual = {
  position: 'aboveBar' | 'belowBar';
  shape: 'circle' | 'arrowUp' | 'arrowDown';
  color: string;
  text: string;
};

type MarkerBucket = {
  time: UTCTimestamp;
  position: 'aboveBar' | 'belowBar';
  events: TokenChartEvent[];
};

export function toChartTime(tMs: number): UTCTimestamp {
  return Math.floor(tMs / 1000) as UTCTimestamp;
}

function isVisibleByOptions(ev: TokenChartEvent, options: DisplayOptions): boolean {
  if (ev.type === 'MIGRATION') return options.migration;
  if (ev.type === 'DEV_BUY' || ev.type === 'DEV_SELL') return options.devTrades;
  return options.myTrades;
}

function getMarkerVisual(ev: TokenChartEvent): MarkerVisual {
  if (ev.type === 'MIGRATION') {
    return { position: 'aboveBar', shape: 'circle', color: '#4c7dff', text: 'M' };
  }
  if (ev.type === 'DEV_BUY') {
    return { position: 'belowBar', shape: 'circle', color: '#00d4a1', text: 'DB' };
  }
  if (ev.type === 'DEV_SELL') {
    return { position: 'aboveBar', shape: 'circle', color: '#ff4d6a', text: 'DS' };
  }
  if (ev.type === 'USER_BUY') {
    return { position: 'belowBar', shape: 'arrowUp', color: '#00d4a1', text: 'B' };
  }
  return { position: 'aboveBar', shape: 'arrowDown', color: '#ff4d6a', text: 'S' };
}

function markerPriority(ev: TokenChartEvent): number {
  if (ev.type === 'MIGRATION') return 5;
  if (ev.type === 'DEV_SELL' || ev.type === 'DEV_BUY') return 4;
  if (ev.type === 'USER_SELL' || ev.type === 'USER_BUY') return 3;
  return 0;
}

function collapseBucket(bucket: MarkerBucket): SeriesMarker<Time> {
  const lead = [...bucket.events].sort((a, b) => markerPriority(b) - markerPriority(a))[0]!;
  const visual = getMarkerVisual(lead);
  const extraCount = bucket.events.length - 1;
  return {
    time: bucket.time,
    position: bucket.position,
    shape: visual.shape,
    color: visual.color,
    text: extraCount > 0 ? `${visual.text}+${extraCount}` : visual.text,
  };
}

export function toSeriesMarkers(
  events: TokenChartEvent[],
  options: DisplayOptions,
  minTimeSec?: number
): SeriesMarker<Time>[] {
  const buckets = new Map<string, MarkerBucket>();

  for (let i = 0; i < events.length; i++) {
    const ev = events[i]!;
    if (!isVisibleByOptions(ev, options)) continue;
    const tSec = Math.floor(ev.tMs / 1000);
    if (minTimeSec != null && tSec < minTimeSec) continue;
    if (!Number.isFinite(tSec)) continue;
    const time = toChartTime(ev.tMs);
    const visual = getMarkerVisual(ev);
    const key = `${time}:${visual.position}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.events.push(ev);
    } else {
      buckets.set(key, {
        time,
        position: visual.position,
        events: [ev],
      });
    }
  }

  return Array.from(buckets.values())
    .sort((a, b) => Number(a.time) - Number(b.time))
    .map(collapseBucket);
}
