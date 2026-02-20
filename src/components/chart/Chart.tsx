import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesMarkersPluginApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { registry } from '../../tokens/registry';
import type { Candle } from '../../engine/types';
import { useTokenStore } from '../../store/tokenStore';
import type { TokenChartEvent } from '../../chart/tokenChartEvents';
import { toSeriesMarkers, type DisplayOptions } from '../../chart/tokenChartEvents';

const TF_OPTIONS = [
  { label: '1s', sec: 1 },
  { label: '15s', sec: 15 },
  { label: '30s', sec: 30 },
  { label: '1m', sec: 60 },
];
const EMPTY_EVENTS: TokenChartEvent[] = [];

type Metric = 'mcap' | 'price';

function fmtPrice(v: number): string {
  if (!Number.isFinite(v)) return '0.0000';
  if (v >= 1) return v.toFixed(4);
  if (v >= 0.01) return v.toFixed(6);
  if (v >= 0.0001) return v.toFixed(8);
  return v.toExponential(4);
}

function fmtCompact(v: number): string {
  if (!Number.isFinite(v)) return '0';
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}

interface Props {
  tokenId: string;
}

export default function Chart({ tokenId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const markerApiRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  const token = useTokenStore(s => s.tokensById[tokenId]);
  const selectTokenEvents = useCallback(
    (s: ReturnType<typeof useTokenStore.getState>) => s.eventsByTokenId[tokenId] ?? EMPTY_EVENTS,
    [tokenId]
  );
  const tokenEvents = useTokenStore(selectTokenEvents);
  const supply = token?.supply ?? 1_000_000_000;

  const [tfSec, setTfSec] = useState(15);
  const [metric, setMetric] = useState<Metric>('mcap');
  const [lastPriceUsd, setLastPriceUsd] = useState<number | null>(null);
  const [showDisplayOptions, setShowDisplayOptions] = useState(false);
  const [displayOptions, setDisplayOptions] = useState<DisplayOptions>({
    migration: true,
    devTrades: true,
    myTrades: true,
  });

  const priceFormatter = useMemo(
    () => (metric === 'mcap' ? fmtCompact : fmtPrice),
    [metric]
  );

  const metricFactor = metric === 'mcap' ? supply : 1;

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: '#0a0a0f' },
        textColor: '#6b7280',
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontSize: 11,
      },
      localization: {
        priceFormatter,
      },
      grid: {
        vertLines: { color: '#1e1e2e' },
        horzLines: { color: '#1e1e2e' },
      },
      crosshair: {
        vertLine: { color: '#4b5563', width: 1, style: 3 },
        horzLine: { color: '#4b5563', width: 1, style: 3 },
      },
      rightPriceScale: {
        borderColor: '#1e1e2e',
        textColor: '#6b7280',
        scaleMargins: { top: 0.06, bottom: 0.2 },
      },
      timeScale: {
        borderColor: '#1e1e2e',
        timeVisible: true,
        secondsVisible: true,
        rightOffset: 8,
        barSpacing: 8,
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale: { mouseWheel: true, pinch: true },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#00d4a1',
      downColor: '#ff4d6a',
      borderUpColor: '#00d4a1',
      borderDownColor: '#ff4d6a',
      wickUpColor: '#00d4a1',
      wickDownColor: '#ff4d6a',
    });

    const volSeries = chart.addSeries(HistogramSeries, {
      color: '#00d4a144',
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
    });
    chart.priceScale('vol').applyOptions({
      scaleMargins: { top: 0.84, bottom: 0 },
      borderColor: '#1e1e2e',
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volSeriesRef.current = volSeries;
    markerApiRef.current = createSeriesMarkers(candleSeries);

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.resize(containerRef.current.clientWidth, containerRef.current.clientHeight);
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volSeriesRef.current = null;
      markerApiRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const cs = candleSeriesRef.current;
    if (!chart || !cs) return;

    chart.applyOptions({ localization: { priceFormatter } });
    cs.applyOptions({
      priceFormat:
        metric === 'mcap'
          ? { type: 'price', precision: 2, minMove: 0.01 }
          : { type: 'price', precision: 8, minMove: 0.00000001 },
    });
  }, [metric, priceFormatter]);

  useEffect(() => {
    registry.setActiveTfSec(tfSec);

    let initialized = false;

    registry.setChartCallback((candles: Candle[], priceUsd: number) => {
      const chart = chartRef.current;
      const cs = candleSeriesRef.current;
      const vs = volSeriesRef.current;
      if (!chart || !cs || !vs) return;

      const safePrice = Number.isFinite(priceUsd) ? priceUsd : 0;
      setLastPriceUsd(safePrice);

      const f = metricFactor;
      const candleData = candles.map(c => ({
        time: c.time as UTCTimestamp,
        open: c.open * f,
        high: c.high * f,
        low: c.low * f,
        close: c.close * f,
      }));

      const volData = candles.map(c => ({
        time: c.time as UTCTimestamp,
        value: c.volume,
        color: c.close >= c.open ? '#00d4a144' : '#ff4d6a44',
      }));

      if (candleData.length > 0) {
        // Always apply full snapshot: robust against skipped intervals/tab throttling.
        cs.setData(candleData);
        vs.setData(volData);

        if (!initialized) {
          // Stable default viewport: avoid giant candles on fresh token open.
          const total = candleData.length;
          const visibleBars = 120;
          chart.timeScale().setVisibleLogicalRange({
            from: Math.max(-20, total - visibleBars),
            to: total + 8,
          });
          initialized = true;
        }
      }
    });

    return () => {
      registry.setChartCallback(null);
    };
  }, [tokenId, tfSec, metricFactor]);

  useEffect(() => {
    const markerApi = markerApiRef.current;
    if (!markerApi) return;

    const minTimeSec = Math.floor((Date.now() - 60 * 60 * 1000) / 1000);
    const markers = toSeriesMarkers(tokenEvents, displayOptions, minTimeSec);
    markerApi.setMarkers(markers);
  }, [tokenEvents, displayOptions]);

  const lastDisplay = (lastPriceUsd ?? 0) * metricFactor;

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-ax-bg">
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-ax-border bg-ax-surface shrink-0">
        <div className="flex items-center gap-0.5">
          {TF_OPTIONS.map(tf => (
            <button
              key={tf.sec}
              onClick={() => setTfSec(tf.sec)}
              className={[
                'px-2 py-0.5 rounded text-[11px] transition-colors',
                tfSec === tf.sec
                  ? 'bg-ax-green text-ax-bg font-bold'
                  : 'text-ax-text-dim hover:text-ax-text',
              ].join(' ')}
            >
              {tf.label}
            </button>
          ))}
        </div>

        <div className="h-3 w-px bg-ax-border" />

        <div className="relative">
          <button
            onClick={() => setShowDisplayOptions(v => !v)}
            className="text-[11px] text-ax-text-dim hover:text-ax-text"
          >
            Display Options
          </button>
          {showDisplayOptions && (
            <div className="absolute top-6 left-0 z-20 min-w-[170px] rounded border border-ax-border bg-ax-surface2 p-2 text-[11px] shadow-lg">
              <label className="flex items-center gap-2 py-1 text-ax-text-dim">
                <input
                  type="checkbox"
                  checked={displayOptions.migration && displayOptions.devTrades && displayOptions.myTrades}
                  onChange={(e) => setDisplayOptions({
                    migration: e.target.checked,
                    devTrades: e.target.checked,
                    myTrades: e.target.checked,
                  })}
                />
                Show All Bubbles
              </label>
              <label className="flex items-center gap-2 py-1 text-ax-text-dim">
                <input
                  type="checkbox"
                  checked={displayOptions.migration}
                  onChange={(e) => setDisplayOptions((s) => ({ ...s, migration: e.target.checked }))}
                />
                Migration
              </label>
              <label className="flex items-center gap-2 py-1 text-ax-text-dim">
                <input
                  type="checkbox"
                  checked={displayOptions.devTrades}
                  onChange={(e) => setDisplayOptions((s) => ({ ...s, devTrades: e.target.checked }))}
                />
                Dev Trades
              </label>
              <label className="flex items-center gap-2 py-1 text-ax-text-dim">
                <input
                  type="checkbox"
                  checked={displayOptions.myTrades}
                  onChange={(e) => setDisplayOptions((s) => ({ ...s, myTrades: e.target.checked }))}
                />
                My Trades
              </label>
            </div>
          )}
        </div>

        <div className="h-3 w-px bg-ax-border" />

        <div className="flex items-center gap-1 text-[11px]">
          <button
            onClick={() => setMetric('mcap')}
            className={metric === 'mcap' ? 'text-ax-text font-semibold' : 'text-ax-text-dim hover:text-ax-text'}
          >
            MCAP
          </button>
          <span className="text-ax-text-dim">/</span>
          <button
            onClick={() => setMetric('price')}
            className={metric === 'price' ? 'text-ax-text font-semibold' : 'text-ax-text-dim hover:text-ax-text'}
          >
            PRICE
          </button>
        </div>

        <div className="h-3 w-px bg-ax-border" />

        {lastPriceUsd !== null && (
          <span className="text-xs text-ax-text font-medium font-mono">
            {metric === 'mcap' ? '$' + fmtCompact(lastDisplay) : '$' + fmtPrice(lastDisplay)}
          </span>
        )}
      </div>

      <div ref={containerRef} className="flex-1 min-h-0" />
    </div>
  );
}
