import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  HistogramSeries,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesMarkersPluginApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { registry, type ChartMetric } from '../../tokens/registry';
import type { Candle } from '../../engine/types';
import { useTokenStore, selectMarketSessionBucket } from '../../store/tokenStore';
import {
  useTradingStore,
  selectAvgEntryPriceByTokenId,
  selectAvgEntryMcapByTokenId,
  selectAvgSellPriceByTokenId,
  selectAvgSellMcapByTokenId,
} from '../../store/tradingStore';
import type { TokenChartEvent } from '../../chart/tokenChartEvents';
import { toSeriesMarkers, type DisplayOptions } from '../../chart/tokenChartEvents';
import { SESSION_BUCKET_LABEL, type SessionBucket } from '../../market/session';

const TF_OPTIONS = [
  { label: '1s', sec: 1 },
  { label: '15s', sec: 15 },
  { label: '30s', sec: 30 },
  { label: '1m', sec: 60 },
];
const EMPTY_EVENTS: TokenChartEvent[] = [];
type PriceLineKey = 'avgBuy' | 'avgSell' | 'migration';
type PriceLineMap = Record<PriceLineKey, IPriceLine | null>;
type PriceLineValueMap = Record<PriceLineKey, number | null>;
const AVG_COST_BASIS_LINE = {
  title: 'Current Average Cost Basis',
  color: '#67c23a',
};
const AVG_EXIT_PRICE_LINE = {
  title: 'Current Average Exit Price',
  color: '#d67b43',
};
const MIGRATION_LINE = {
  title: 'Migration Price',
  color: '#4c7dffdd',
};
const SESSION_BUCKET_CLASS: Record<SessionBucket, string> = {
  EU: 'text-[#4fa7ff] bg-[#4fa7ff1c] border-[#4fa7ff55]',
  NA: 'text-[#ff8a3d] bg-[#ff8a3d1a] border-[#ff8a3d55]',
  OVERLAP: 'text-ax-green bg-[#00d4a118] border-[#00d4a155]',
  OFF: 'text-ax-text-dim bg-ax-bg border-ax-border',
};

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
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const markerApiRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLinesRef = useRef<PriceLineMap>({ avgBuy: null, avgSell: null, migration: null });
  const priceLineValuesRef = useRef<PriceLineValueMap>({ avgBuy: null, avgSell: null, migration: null });
  const lastCandleCountRef = useRef(0);

  const selectTokenEvents = useCallback(
    (s: ReturnType<typeof useTokenStore.getState>) => s.eventsByTokenId[tokenId] ?? EMPTY_EVENTS,
    [tokenId]
  );
  const selectAvgEntryPrice = useMemo(() => selectAvgEntryPriceByTokenId(tokenId), [tokenId]);
  const selectAvgEntryMcap = useMemo(() => selectAvgEntryMcapByTokenId(tokenId), [tokenId]);
  const selectAvgSellPrice = useMemo(() => selectAvgSellPriceByTokenId(tokenId), [tokenId]);
  const selectAvgSellMcap = useMemo(() => selectAvgSellMcapByTokenId(tokenId), [tokenId]);
  const tokenEvents = useTokenStore(selectTokenEvents);
  const marketSessionBucket = useTokenStore(selectMarketSessionBucket);
  const avgEntryPrice = useTradingStore(selectAvgEntryPrice);
  const avgEntryMcap = useTradingStore(selectAvgEntryMcap);
  const avgSellPrice = useTradingStore(selectAvgSellPrice);
  const avgSellMcap = useTradingStore(selectAvgSellMcap);
  const migrationPrice = useMemo(() => {
    for (let i = tokenEvents.length - 1; i >= 0; i--) {
      const ev = tokenEvents[i]!;
      if (ev.type !== 'MIGRATION') continue;
      if (!Number.isFinite(ev.price) || (ev.price ?? 0) <= 0) continue;
      return ev.price!;
    }
    return null;
  }, [tokenEvents]);
  const migrationMcap = useMemo(() => {
    for (let i = tokenEvents.length - 1; i >= 0; i--) {
      const ev = tokenEvents[i]!;
      if (ev.type !== 'MIGRATION') continue;
      if (!Number.isFinite(ev.mcap) || (ev.mcap ?? 0) <= 0) continue;
      return ev.mcap!;
    }
    return null;
  }, [tokenEvents]);

  const [tfSec, setTfSec] = useState(1);
  const [metric, setMetric] = useState<Metric>('mcap');
  const [lastMetricValue, setLastMetricValue] = useState<number | null>(null);
  const [showDisplayOptions, setShowDisplayOptions] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [displayOptions, setDisplayOptions] = useState<DisplayOptions>({
    migration: true,
    devTrades: true,
    myTrades: true,
  });

  const priceFormatter = useMemo(
    () => (metric === 'mcap' ? fmtCompact : fmtPrice),
    [metric]
  );

  const clearAllPriceLines = useCallback(() => {
    const series = candleSeriesRef.current;
    const keys: PriceLineKey[] = ['avgBuy', 'avgSell', 'migration'];
    if (series) {
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i]!;
        const line = priceLinesRef.current[key];
        if (!line) continue;
        series.removePriceLine(line);
        priceLinesRef.current[key] = null;
      }
    } else {
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i]!;
        priceLinesRef.current[key] = null;
      }
    }
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!;
      priceLineValuesRef.current[key] = null;
    }
  }, []);

  const upsertPriceLine = useCallback(
    (
      key: PriceLineKey,
      nextPrice: number | null | undefined,
      options: { title: string; color: string }
    ) => {
      const series = candleSeriesRef.current;
      if (!series) return;
      const safePrice =
        Number.isFinite(nextPrice) && (nextPrice ?? 0) > 0 ? (nextPrice as number) : null;
      const prevPrice = priceLineValuesRef.current[key];
      if (
        (safePrice == null && prevPrice == null) ||
        (safePrice != null && prevPrice != null && Math.abs(safePrice - prevPrice) < 1e-12)
      ) {
        return;
      }

      const prevLine = priceLinesRef.current[key];
      if (prevLine) {
        series.removePriceLine(prevLine);
        priceLinesRef.current[key] = null;
      }
      priceLineValuesRef.current[key] = safePrice;
      if (safePrice == null) return;

      priceLinesRef.current[key] = series.createPriceLine({
        price: safePrice,
        title: options.title,
        color: options.color,
        axisLabelVisible: true,
        lineVisible: true,
        lineStyle: LineStyle.LargeDashed,
        lineWidth: 2,
      });
    },
    []
  );
  const resetChartView = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const total = lastCandleCountRef.current;
    if (total > 0) {
      const visibleBars = 200;
      chart.timeScale().setVisibleLogicalRange({
        from: Math.max(-20, total - visibleBars),
        to: total + 8,
      });
    } else {
      chart.timeScale().fitContent();
    }
    chart.priceScale('right').applyOptions({ autoScale: true });
  }, []);

  const openContextMenuAt = useCallback((clientX: number, clientY: number) => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    const menuWidth = 210;
    const menuHeight = 44;
    const pad = 8;
    const rawX = clientX - rect.left;
    const rawY = clientY - rect.top;
    const x = Math.min(Math.max(pad, rawX), Math.max(pad, rect.width - menuWidth - pad));
    const y = Math.min(Math.max(pad, rawY), Math.max(pad, rect.height - menuHeight - pad));
    setContextMenu({ x, y });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onContextMenu = (e: globalThis.MouseEvent) => {
      e.preventDefault();
      openContextMenuAt(e.clientX, e.clientY);
    };

    // Capture makes this robust when chart internals stop event propagation.
    el.addEventListener('contextmenu', onContextMenu, true);
    return () => {
      el.removeEventListener('contextmenu', onContextMenu, true);
    };
  }, [openContextMenuAt]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (target && contextMenuRef.current?.contains(target)) return;
      close();
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', close);
    };
  }, [contextMenu]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || e.key.toLowerCase() !== 'r') return;
      e.preventDefault();
      resetChartView();
      setContextMenu(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [resetChartView]);

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
      clearAllPriceLines();
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volSeriesRef.current = null;
      markerApiRef.current = null;
    };
  }, [clearAllPriceLines]);

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
    registry.setActiveMetric(metric as ChartMetric);

    let initialized = false;

    registry.setChartCallback((candles: Candle[], metricValue: number) => {
      const chart = chartRef.current;
      const cs = candleSeriesRef.current;
      const vs = volSeriesRef.current;
      if (!chart || !cs || !vs) return;

      const safeMetricValue = Number.isFinite(metricValue) ? metricValue : 0;
      setLastMetricValue(safeMetricValue);
      const candleData = candles.map(c => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));

      const volData = candles.map(c => ({
        time: c.time as UTCTimestamp,
        value: c.volume,
        color: c.close >= c.open ? '#00d4a144' : '#ff4d6a44',
      }));

      if (candleData.length > 0) {
        lastCandleCountRef.current = candleData.length;
        // Always apply full snapshot: robust against skipped intervals/tab throttling.
        cs.setData(candleData);
        vs.setData(volData);

        if (!initialized) {
          // Stable default viewport: avoid giant candles on fresh token open.
          const total = candleData.length;
          const visibleBars = 200;
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
  }, [tokenId, tfSec, metric]);

  useEffect(() => {
    const markerApi = markerApiRef.current;
    if (!markerApi) return;

    const minTimeSec = Math.floor((Date.now() - 60 * 60 * 1000) / 1000);
    const markers = toSeriesMarkers(tokenEvents, displayOptions, minTimeSec);
    markerApi.setMarkers(markers);
  }, [tokenEvents, displayOptions]);

  useEffect(() => {
    clearAllPriceLines();
  }, [tokenId, clearAllPriceLines]);

  useEffect(() => {
    const avgBuyLine = metric === 'mcap' ? avgEntryMcap : avgEntryPrice;
    const avgSellLine = metric === 'mcap' ? avgSellMcap : avgSellPrice;
    const migrationLine = metric === 'mcap' ? migrationMcap : migrationPrice;
    upsertPriceLine('avgBuy', avgBuyLine, AVG_COST_BASIS_LINE);
    upsertPriceLine('avgSell', avgSellLine, AVG_EXIT_PRICE_LINE);
    upsertPriceLine('migration', migrationLine, MIGRATION_LINE);
  }, [
    metric,
    avgEntryPrice,
    avgEntryMcap,
    avgSellPrice,
    avgSellMcap,
    migrationPrice,
    migrationMcap,
    upsertPriceLine,
  ]);

  const lastDisplay = lastMetricValue ?? 0;

  return (
    <div ref={wrapperRef} className="relative flex flex-col h-full min-h-0 bg-ax-bg">
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

        {lastMetricValue !== null && (
          <span className="text-xs text-ax-text font-medium font-mono">
            {metric === 'mcap' ? '$' + fmtCompact(lastDisplay) : '$' + fmtPrice(lastDisplay)}
          </span>
        )}
        <span
          className={[
            'ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded border',
            SESSION_BUCKET_CLASS[marketSessionBucket],
          ].join(' ')}
        >
          {SESSION_BUCKET_LABEL[marketSessionBucket]}
        </span>
      </div>

      <div ref={containerRef} className="flex-1 min-h-0" />

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="absolute z-30 min-w-[210px] rounded border border-ax-border bg-ax-surface2 py-1 shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            className="flex w-full items-center justify-between px-3 py-2 text-left text-[12px] text-ax-text hover:bg-ax-surface"
            onClick={() => {
              resetChartView();
              setContextMenu(null);
            }}
          >
            <span>Reset chart view</span>
            <span className="text-[10px] text-ax-text-dim">Alt + R</span>
          </button>
        </div>
      )}
    </div>
  );
}
