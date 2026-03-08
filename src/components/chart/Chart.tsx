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
import HoverTooltip from '../ui/HoverTooltip';

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
type Metric = 'mcap' | 'price';
type LineVisual = {
  title: string;
  color: string;
  lineStyle: LineStyle;
  lineWidth: 1 | 2 | 3 | 4;
};
type HoverSnapshot = {
  timeLabel: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

const AVG_COST_BASIS_LINE: LineVisual = {
  title: 'Avg Buy',
  color: '#67c23acc',
  lineStyle: LineStyle.Dotted,
  lineWidth: 1,
};
const AVG_EXIT_PRICE_LINE: LineVisual = {
  title: 'Avg Sell',
  color: '#d67b43cc',
  lineStyle: LineStyle.Dotted,
  lineWidth: 1,
};
const MIGRATION_LINE: LineVisual = {
  title: 'Migration',
  color: '#4c7dffdd',
  lineStyle: LineStyle.Dashed,
  lineWidth: 2,
};
const DISPLAY_OPTION_META: Array<{
  key: keyof DisplayOptions;
  label: string;
  accentClass: string;
}> = [
  { key: 'migration', label: 'Migration', accentClass: 'text-[#7ea2ff]' },
  { key: 'devTrades', label: 'Dev Trades', accentClass: 'text-[#00d4a1]' },
  { key: 'myTrades', label: 'My Trades', accentClass: 'text-[#f5c542]' },
];

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

function fmtMetricValue(metric: Metric, value: number | null | undefined): string {
  const safeValue = Number.isFinite(value) ? (value as number) : 0;
  return metric === 'mcap' ? `$${fmtCompact(safeValue)}` : `$${fmtPrice(safeValue)}`;
}

function fmtCrosshairTime(time: Time | undefined): string {
  if (time == null) return '-';
  if (typeof time === 'number') {
    return new Date(time * 1000).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }
  if (typeof time === 'string') return time;
  if (typeof time === 'object' && 'year' in time && 'month' in time && 'day' in time) {
    const month = String(time.month).padStart(2, '0');
    const day = String(time.day).padStart(2, '0');
    return `${time.year}-${month}-${day}`;
  }
  return '-';
}

interface Props {
  tokenId: string;
}

export default function Chart({ tokenId }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const displayMenuRef = useRef<HTMLDivElement>(null);
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
  const [hoverSnapshot, setHoverSnapshot] = useState<HoverSnapshot | null>(null);
  const [showDisplayOptions, setShowDisplayOptions] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [displayOptions, setDisplayOptions] = useState<DisplayOptions>({
    migration: true,
    devTrades: true,
    myTrades: true,
  });

  const priceFormatter = useMemo(() => (metric === 'mcap' ? fmtCompact : fmtPrice), [metric]);
  const enabledDisplayOptionCount = useMemo(
    () => DISPLAY_OPTION_META.reduce((count, option) => count + (displayOptions[option.key] ? 1 : 0), 0),
    [displayOptions]
  );
  const linePills = useMemo(() => {
    const values = {
      avgBuy: metric === 'mcap' ? avgEntryMcap : avgEntryPrice,
      avgSell: metric === 'mcap' ? avgSellMcap : avgSellPrice,
      migration: metric === 'mcap' ? migrationMcap : migrationPrice,
    };

    return [
      { key: 'avgBuy', label: 'Avg Buy', color: AVG_COST_BASIS_LINE.color, value: values.avgBuy },
      { key: 'avgSell', label: 'Avg Sell', color: AVG_EXIT_PRICE_LINE.color, value: values.avgSell },
      { key: 'migration', label: 'Migration', color: MIGRATION_LINE.color, value: values.migration },
    ].filter((item) => Number.isFinite(item.value) && (item.value ?? 0) > 0);
  }, [metric, avgEntryMcap, avgEntryPrice, avgSellMcap, avgSellPrice, migrationMcap, migrationPrice]);

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
    (key: PriceLineKey, nextPrice: number | null | undefined, options: LineVisual) => {
      const series = candleSeriesRef.current;
      if (!series) return;
      const safePrice = Number.isFinite(nextPrice) && (nextPrice ?? 0) > 0 ? (nextPrice as number) : null;
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
        lineStyle: options.lineStyle,
        lineWidth: options.lineWidth,
      });
    },
    []
  );

  const applyDefaultViewport = useCallback((totalBars: number) => {
    const chart = chartRef.current;
    if (!chart) return;

    if (totalBars <= 0) {
      chart.timeScale().fitContent();
      chart.priceScale('right').applyOptions({ autoScale: true });
      return;
    }

    const visibleBars = totalBars <= 24 ? Math.max(14, totalBars + 4) : totalBars <= 90 ? Math.min(72, totalBars + 8) : 140;
    const rightPad = totalBars <= 24 ? 3 : 6;
    chart.timeScale().setVisibleLogicalRange({
      from: Math.max(-6, totalBars - visibleBars),
      to: totalBars + rightPad,
    });
    chart.priceScale('right').applyOptions({ autoScale: true });
  }, []);

  const resetChartView = useCallback(() => {
    applyDefaultViewport(lastCandleCountRef.current);
  }, [applyDefaultViewport]);

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
    if (!showDisplayOptions) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (target && displayMenuRef.current?.contains(target)) return;
      setShowDisplayOptions(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowDisplayOptions(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [showDisplayOptions]);

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
        vertLines: { color: '#171a24' },
        horzLines: { color: '#171a24' },
      },
      crosshair: {
        mode: 0,
        vertLine: { color: '#616b7f', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#131722' },
        horzLine: { color: '#616b7f', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#131722' },
      },
      rightPriceScale: {
        borderColor: '#1e1e2e',
        textColor: '#6b7280',
        scaleMargins: { top: 0.08, bottom: 0.22 },
      },
      timeScale: {
        borderColor: '#1e1e2e',
        timeVisible: true,
        secondsVisible: true,
        rightOffset: 6,
        barSpacing: 7,
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
      priceLineVisible: false,
      lastValueVisible: true,
    });

    const volSeries = chart.addSeries(HistogramSeries, {
      color: '#00d4a136',
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
      priceLineVisible: false,
      lastValueVisible: false,
    });
    chart.priceScale('vol').applyOptions({
      scaleMargins: { top: 0.84, bottom: 0 },
      borderColor: '#1e1e2e',
    });

    const handleCrosshairMove = (param: {
      time?: Time;
      point?: { x: number; y: number };
      seriesData: Map<unknown, unknown>;
    }) => {
      const container = containerRef.current;
      const point = param.point;
      if (
        !container ||
        !point ||
        point.x < 0 ||
        point.y < 0 ||
        point.x > container.clientWidth ||
        point.y > container.clientHeight ||
        param.time == null
      ) {
        setHoverSnapshot(null);
        return;
      }

      const candleData = param.seriesData.get(candleSeries) as
        | { open?: number; high?: number; low?: number; close?: number }
        | undefined;
      if (!candleData) {
        setHoverSnapshot(null);
        return;
      }
      const volumeData = param.seriesData.get(volSeries) as { value?: number } | undefined;
      setHoverSnapshot({
        timeLabel: fmtCrosshairTime(param.time),
        open: Number(candleData.open ?? 0),
        high: Number(candleData.high ?? 0),
        low: Number(candleData.low ?? 0),
        close: Number(candleData.close ?? 0),
        volume: Number.isFinite(volumeData?.value) ? Number(volumeData?.value) : null,
      });
    };

    chart.subscribeCrosshairMove(handleCrosshairMove);

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
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volSeriesRef.current = null;
      markerApiRef.current = null;
      setHoverSnapshot(null);
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
      const candleData = candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));

      const volData = candles.map((c) => ({
        time: c.time as UTCTimestamp,
        value: c.volume,
        color: c.close >= c.open ? '#00d4a136' : '#ff4d6a36',
      }));

      if (candleData.length > 0) {
        lastCandleCountRef.current = candleData.length;
        cs.setData(candleData);
        vs.setData(volData);

        if (!initialized) {
          applyDefaultViewport(candleData.length);
          initialized = true;
        }
      }
    });

    return () => {
      registry.setChartCallback(null);
    };
  }, [tokenId, tfSec, metric, applyDefaultViewport]);

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
    <div ref={wrapperRef} className="relative flex h-full min-h-0 flex-col bg-ax-bg">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-ax-border bg-ax-surface px-3 py-1.5">
        <div className="flex items-center gap-1 rounded-md border border-ax-border bg-ax-surface2 px-1 py-1">
          <span className="px-1 text-[10px] font-semibold uppercase tracking-wide text-ax-text-dim">TF</span>
          {TF_OPTIONS.map((tf) => (
            <button
              key={tf.sec}
              onClick={() => setTfSec(tf.sec)}
              className={[
                'rounded px-2 py-0.5 text-[11px] transition-colors',
                tfSec === tf.sec
                  ? 'bg-ax-green text-ax-bg font-bold'
                  : 'text-ax-text-dim hover:text-ax-text',
              ].join(' ')}
            >
              {tf.label}
            </button>
          ))}
        </div>

        <div className="relative" ref={displayMenuRef}>
          <HoverTooltip
            label="Toggle visible marker categories. Markers are auto-condensed when events collide."
          >
            <button
              onClick={() => setShowDisplayOptions((v) => !v)}
              className={[
                'inline-flex items-center gap-2 rounded-md border px-2 py-1 text-[11px] transition-colors',
                showDisplayOptions || enabledDisplayOptionCount < DISPLAY_OPTION_META.length
                  ? 'border-[#7ea2ff55] bg-[#7ea2ff14] text-ax-text'
                  : 'border-ax-border bg-ax-surface2 text-ax-text-dim hover:text-ax-text',
              ].join(' ')}
            >
              <span className="font-semibold">Events</span>
              <span className="rounded bg-ax-surface px-1.5 py-0.5 text-[10px] text-ax-text-dim">
                {enabledDisplayOptionCount}/{DISPLAY_OPTION_META.length}
              </span>
            </button>
          </HoverTooltip>
          {showDisplayOptions && (
            <div className="absolute left-0 top-9 z-20 min-w-[220px] rounded border border-ax-border bg-ax-surface2 p-2 text-[11px] shadow-lg">
              <div className="mb-2 text-[10px] uppercase tracking-wide text-ax-text-dim">Marker categories</div>
              <div className="space-y-1">
                {DISPLAY_OPTION_META.map((option) => (
                  <label key={option.key} className="flex items-center justify-between gap-3 rounded px-2 py-1 hover:bg-ax-surface">
                    <span className={`font-medium ${option.accentClass}`}>{option.label}</span>
                    <input
                      type="checkbox"
                      checked={displayOptions[option.key]}
                      onChange={(e) => setDisplayOptions((state) => ({ ...state, [option.key]: e.target.checked }))}
                    />
                  </label>
                ))}
              </div>
              <div className="mt-2 border-t border-ax-border pt-2 text-[10px] text-ax-text-dim">
                Event markers are condensed by timestamp lane to reduce overlap.
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 rounded-md border border-ax-border bg-ax-surface2 px-1 py-1 text-[11px]">
          <span className="px-1 text-[10px] font-semibold uppercase tracking-wide text-ax-text-dim">Metric</span>
          <button
            onClick={() => setMetric('mcap')}
            className={metric === 'mcap' ? 'rounded bg-ax-surface px-2 py-0.5 font-semibold text-ax-text' : 'px-2 py-0.5 text-ax-text-dim hover:text-ax-text'}
          >
            MCAP
          </button>
          <button
            onClick={() => setMetric('price')}
            className={metric === 'price' ? 'rounded bg-ax-surface px-2 py-0.5 font-semibold text-ax-text' : 'px-2 py-0.5 text-ax-text-dim hover:text-ax-text'}
          >
            PRICE
          </button>
        </div>

        <button
          type="button"
          onClick={resetChartView}
          className="rounded-md border border-ax-border bg-ax-surface2 px-2 py-1 text-[11px] text-ax-text-dim transition-colors hover:text-ax-text"
        >
          Reset View
        </button>

        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {linePills.map((line) => (
            <div key={line.key} className="inline-flex items-center gap-1 rounded-md border border-ax-border bg-ax-surface2 px-2 py-1 text-[10px] text-ax-text-dim">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: line.color }} />
              <span>{line.label}</span>
              <span className="font-medium text-ax-text">{fmtMetricValue(metric, line.value)}</span>
            </div>
          ))}
          <div className="rounded-md border border-ax-border bg-ax-surface2 px-2 py-1 text-right">
            <div className="text-[10px] uppercase tracking-wide text-ax-text-dim">Live {metric === 'mcap' ? 'MCAP' : 'Price'}</div>
            <div className="font-mono text-xs font-semibold text-ax-text">{fmtMetricValue(metric, lastDisplay)}</div>
          </div>
          {hoverSnapshot && (
            <div className="rounded-md border border-ax-border bg-ax-surface2 px-2 py-1 text-right">
              <div className="text-[10px] uppercase tracking-wide text-ax-text-dim">Hover {hoverSnapshot.timeLabel}</div>
              <div className="font-mono text-[11px] text-ax-text">
                O {priceFormatter(hoverSnapshot.open)} H {priceFormatter(hoverSnapshot.high)} L {priceFormatter(hoverSnapshot.low)} C {priceFormatter(hoverSnapshot.close)}
              </div>
              <div className="text-[10px] text-ax-text-dim">Vol {fmtCompact(hoverSnapshot.volume ?? 0)}</div>
            </div>
          )}
        </div>
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
          <div className="border-t border-ax-border px-3 py-2 text-[10px] text-ax-text-dim">
            Session: {marketSessionBucket}
          </div>
        </div>
      )}
    </div>
  );
}
