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
  size?: number;
}

export type DisplayOptions = {
  migration: boolean;
  devTrades: boolean;
  myTrades: boolean;
};

export const MAX_EVENTS_PER_TOKEN = 1000;

export function toChartTime(tMs: number): UTCTimestamp {
  return Math.floor(tMs / 1000) as UTCTimestamp;
}

function isVisibleByOptions(ev: TokenChartEvent, options: DisplayOptions): boolean {
  if (ev.type === 'MIGRATION') return options.migration;
  if (ev.type === 'DEV_BUY' || ev.type === 'DEV_SELL') return options.devTrades;
  return options.myTrades;
}

export function toSeriesMarkers(
  events: TokenChartEvent[],
  options: DisplayOptions,
  minTimeSec?: number
): SeriesMarker<Time>[] {
  const out: SeriesMarker<Time>[] = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]!;
    if (!isVisibleByOptions(ev, options)) continue;
    const tSec = Math.floor(ev.tMs / 1000);
    if (minTimeSec != null && tSec < minTimeSec) continue;
    if (!Number.isFinite(tSec)) continue;
    const t = toChartTime(ev.tMs);
    if (ev.type === 'MIGRATION') {
      out.push({ time: t, position: 'aboveBar', shape: 'circle', color: '#4c7dff', text: 'M' });
    } else if (ev.type === 'DEV_BUY') {
      out.push({ time: t, position: 'belowBar', shape: 'circle', color: '#00d4a1', text: 'DB' });
    } else if (ev.type === 'DEV_SELL') {
      out.push({ time: t, position: 'aboveBar', shape: 'circle', color: '#ff4d6a', text: 'DS' });
    } else if (ev.type === 'USER_BUY') {
      out.push({ time: t, position: 'belowBar', shape: 'arrowUp', color: '#00d4a1', text: 'B' });
    } else {
      out.push({ time: t, position: 'aboveBar', shape: 'arrowDown', color: '#ff4d6a', text: 'S' });
    }
  }
  return out;
}
