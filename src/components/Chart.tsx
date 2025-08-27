import { useMemo, useEffect, useRef } from 'react';
import {
  createChart,
  CandlestickSeries, 
  BarSeries, 
  LineSeries,
  AreaSeries,
  BaselineSeries, 
  HistogramSeries,
  MouseEventParams,
  type IChartApi, type UTCTimestamp, type ISeriesApi, type IPriceLine,
} from 'lightweight-charts';
import { useTradingStore } from '../store/tradingStore';
import type { Candle } from '../engine/types';
import { LineStyle } from 'lightweight-charts';


function fmtPrice(v: number): string {
  const x = Math.abs(v);
  if (x >= 1) return v.toFixed(2);
  if (x >= 0.1) return v.toFixed(3);
  if (x >= 0.01) return v.toFixed(4);
  return v.toFixed(6);
}
function fmtKMB(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e12) return (v/1e12).toFixed(2)+'T';
  if (a >= 1e9)  return (v/1e9).toFixed(2)+'B';
  if (a >= 1e6)  return (v/1e6).toFixed(2)+'M';
  if (a >= 1e3)  return (v/1e3).toFixed(2)+'K';
  return v.toFixed(2);
}


type AnyPriceSeries =
  | ISeriesApi<'Candlestick'>
  | ISeriesApi<'Bar'>
  | ISeriesApi<'Line'>
  | ISeriesApi<'Area'>
  | ISeriesApi<'Baseline'>;

export default function Chart() {
  const ref = useRef<HTMLDivElement>(null);
  const containerRef = ref; // Alias for containerRef to fix missing reference
  const originalScroll = useRef<{ mouseWheel: boolean; pressedMouseMove: boolean; horzTouchDrag: boolean; vertTouchDrag: boolean } | null>(null);
  const api = useRef<IChartApi | null>(null);
  const sPrice = useRef<AnyPriceSeries | null>(null);
  const sVol = useRef<ReturnType<IChartApi['addSeries']> | null>(null);
  const sSMA20 = useRef<ISeriesApi<'Line'> | null>(null);
  const sSMA50 = useRef<ISeriesApi<'Line'> | null>(null);
  const priceLine = useRef<IPriceLine | null>(null);
  const ghostLine = useRef<IPriceLine | null>(null);
  const didInitialFit = useRef(false);

  // store
  const candles = useTradingStore(s => s.candles);
  const lastPrice = useTradingStore(s => s.lastPrice);
  const tfLeft = useTradingStore(s => s.tfLeft);
  const tfSec = useTradingStore(s => s.tfSec);
  const resetSignal = useTradingStore(s => s.resetViewSignal);
  const ghost = useTradingStore(s => s.ghost);
  const pos = useTradingStore(s => {
    for (let i = 0; i < s.positions.length; i++) if (s.positions[i].symbol === s.symbol) return s.positions[i];
    return undefined;
  });

  // settings
  const setSLTP = useTradingStore(s => s.setSLTP);
  const chartType = useTradingStore(s => s.chartType);
  const showSMA20 = useTradingStore(s => s.showSMA20);
  const showSMA50 = useTradingStore(s => s.showSMA50);
  const metric = useTradingStore(s => s.metric);
  const supply = useTradingStore(s => s.supply);

  // order type + limit target
  const ordType  = useTradingStore(s => s.orderTypeUI);
  const setLT    = useTradingStore(s => s.setLimitTarget);
  const limitT   = useTradingStore(s => s.limitTarget);
  const symbol    = useTradingStore(s => s.symbol);
  const limitLine = useRef<IPriceLine | null>(null);
  const slLine    = useRef<IPriceLine|null>(null);
  const tpLine    = useRef<IPriceLine|null>(null);
  const positions = useTradingStore(s => s.positions);

  // stan dragowania
  const dragging = useRef<{ kind:'limit'|'sl'|'tp'; y0:number }|null>(null);


  // przemapowane świece wg metryki
  // (przy mcap mnożymy close/open/high/low przez supply)
  const mappedCandles = useMemo(() => {
    const f = metric === 'price' ? 1 : supply;
      return candles.map(c => ({
        time: c.time as UTCTimestamp,
        open: c.open * f,
        high: c.high * f,
        low:  c.low  * f,
        close:c.close* f,
        vol:  c.volume,
      }));
  }, [candles, metric, supply]);

  // helpers
  function factor() { return metric === 'price' ? 1 : supply; }

  // prosta średnia z ostatnich len świec
  function sma(src: Candle[], len: number) {
    const out: { time: UTCTimestamp; value: number }[] = [];
    const f = metric === 'price' ? 1 : supply;
    let sum = 0;
    for (let i = 0; i < src.length; i++) {
      sum += src[i].close * f;
      if (i >= len) sum -= src[i - len].close * f;
      if (i >= len - 1) out.push({ time: src[i].time as UTCTimestamp, value: sum / len });
    }
    return out;
}

  // create price series of given type
  function createPrice(type: string): AnyPriceSeries | null {
    if (!api.current) return null;
    const ch = api.current;
    if (type === 'candles') return ch.addSeries(CandlestickSeries, {
      upColor:'#2ecc71',downColor:'#e74c3c',borderUpColor:'#2ecc71',borderDownColor:'#e74c3c',wickUpColor:'#2ecc71',wickDownColor:'#e74c3c',
    });
    if (type === 'bars') return ch.addSeries(BarSeries, {
      upColor:'#2ecc71',downColor:'#e74c3c', thinBars:false,
    });
    if (type === 'line') return ch.addSeries(LineSeries, { lineWidth:2 });
    if (type === 'area') return ch.addSeries(AreaSeries, { lineWidth:2 });
    return ch.addSeries(BaselineSeries, { baseValue: { type:'price', price: 0 } });
  }

  // przeliczanie ceny <-> wyświetlanie wg metryki
  function pxToDisplay(price: number, metric: 'price'|'mcap', supply: number) {
    return metric === 'mcap' ? price * supply : price;
  }
  function displayToPx(display: number, metric: 'price'|'mcap', supply: number) {
    return metric === 'mcap' ? display / Math.max(1, supply) : display;
  }

  // Move disablePan and enablePan to component scope so they are accessible everywhere
  function disablePan() {
    if (!api.current || !originalScroll.current) return;
    api.current.applyOptions({ handleScroll: { ...originalScroll.current, pressedMouseMove: false } });
  }
  function enablePan() {
    if (!api.current || !originalScroll.current) return;
    api.current.applyOptions({ handleScroll: originalScroll.current });
  }

  // END Helpers  

  useEffect(() => {
    if (!api.current) return;
      const pf = metric === 'price'
        ? (val: number) => fmtPrice(val)
        : (val: number) => fmtKMB(val); // oś dla MarketCap
    api.current.applyOptions({ localization: { priceFormatter: pf } });
  }, [metric, supply]);

  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      layout: { background: { color: '#0f141a' }, textColor: '#c7d1db' },
      grid: { vertLines: { color: '#0f141a' }, horzLines: { color: '#1b222c' } },
      rightPriceScale: { borderColor: '#1b222c' },
      timeScale: { borderColor: '#1b222c', secondsVisible: true, timeVisible: true },
      crosshair: { mode: 0 },
    });

    if (!originalScroll.current) {
      originalScroll.current = { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true };
      chart.applyOptions({ handleScroll: originalScroll.current });
    }

    api.current = chart;

    sPrice.current = createPrice('candles');

    sVol.current = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' }, priceScaleId: '', color: '#6b7a8a',
    });
    chart.priceScale('')?.applyOptions({ scaleMargins: { top: 0.8, bottom: 0 }, borderColor: '#1b222c' });

    // overlay lines
    sSMA20.current = chart.addSeries(LineSeries, { lineWidth:1 });
    sSMA50.current = chart.addSeries(LineSeries, { lineWidth:1 });

    // resize
    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: ref.current!.clientWidth, height: ref.current!.clientHeight });
    });
    ro.observe(ref.current);

    return () => { ro.disconnect(); api.current = null; };
  }, []);

  // handle chart type or metric change → recreate price series
  // efekt: zmiana typu wykresu LUB metryki => przeutwórz serię + formatter
  useEffect(() => {
    if (!api.current) return;

    // 1) ustaw formatter osi wg metryki
    const pf = (metric === 'price') ? (val: number) => fmtPrice(val)
                                    : (val: number) => fmtKMB(val);
    api.current.applyOptions({ localization: { priceFormatter: pf } });

    // 2) odtwórz serię cenową, żeby nie zostały stare opcje
    if (sPrice.current) api.current.removeSeries(sPrice.current);
    sPrice.current = createPrice(chartType);

    // 3) przemapuj całe dane świec z bieżącym mnożnikiem
    if (sPrice.current) sPrice.current.setData(mappedCandles);
    api.current?.timeScale().fitContent();

    // 4) przerysuj SMA (jeśli używasz)
    if (sSMA20.current) sSMA20.current.setData(showSMA20 ? sma(candles, 20) : []);
    if (sSMA50.current) sSMA50.current.setData(showSMA50 ? sma(candles, 50) : []);


    // 5) zrestartuj linie (last, ghost, entry/sl/tp)
    if (priceLine.current && sPrice.current) { sPrice.current.removePriceLine(priceLine.current); priceLine.current = null; }
    if (ghostLine.current && sPrice.current) { sPrice.current.removePriceLine(ghostLine.current); ghostLine.current = null; }
    if (limitLine.current && sPrice.current) {
      sPrice.current.removePriceLine(limitLine.current);
      limitLine.current = null;
    }


    const f = (metric === 'price') ? 1 : supply;
    if (sPrice.current) {
      const lp = lastPrice || 0;
      priceLine.current = sPrice.current.createPriceLine({
        price: lp * f, color:'#6b7a8a', lineWidth:1, axisLabelVisible:true,
        title: '⏱ ' + fmt(tfLeft) + ' / ' + (tfSec || 1) + 's',
      });
      if (ghost && ghost.price) {
        ghostLine.current = sPrice.current.createPriceLine({
          price: ghost.price * f, color:'#6b7a8a', lineWidth:1, axisLabelVisible:true, title:'Ghost',
        });
      }
    }

    // 6) dopasuj widok
    api.current.timeScale().fitContent();

    fitBoth();
    lastMetricRef.current = metric;
  }, [chartType, metric, supply]);   // <= ważne


  // set data on updates
  useEffect(() => {
    if (!sPrice.current || !sVol.current) return;

    // cena / mcap z mappedCandles
    if (chartType === 'candles' || chartType === 'bars') {
      sPrice.current.setData(
        mappedCandles.map(c => ({
          time: c.time,
          open: c.open, high: c.high, low: c.low, close: c.close,
        }))
      );
    } else {
      sPrice.current.setData(
        mappedCandles.map(c => ({ time: c.time, value: c.close }))
      );
    }

    // jeżeli przed chwilą przełączyliśmy metrykę, dociśnij autoskalę
    if (lastMetricRef.current !== metric) {
      fitBoth();
      lastMetricRef.current = metric;
    }

    // wolumen bez zmian
    sVol.current.setData(
      mappedCandles.map(c => ({
        time: c.time,
        value: c.vol,
        color: c.close >= c.open ? '#2ecc71' : '#e74c3c',
      }))
    );

    // SMA licz z oryginalnych świec, mnożenie robi sma()
    if (sSMA20.current) sSMA20.current.setData(showSMA20 ? sma(candles, 20) : []);
    if (sSMA50.current) sSMA50.current.setData(showSMA50 ? sma(candles, 50) : []);

    if (!didInitialFit.current && candles.length > 5) {
      fitBoth();
      //api.current?.timeScale().fitContent();
      didInitialFit.current = true;
    }
  }, [mappedCandles, candles, showSMA20, showSMA50, chartType, metric]);


  // live price line + timer
  useEffect(() => {
    if (!sPrice.current) return;
    const f = metric === 'price' ? 1 : supply;
    if (priceLine.current) sPrice.current.removePriceLine(priceLine.current);
    priceLine.current = sPrice.current.createPriceLine({
      price: (lastPrice || 0) * f,
      color:'#6b7a8a', lineWidth:1, axisLabelVisible:true,
      title:'⏱ ' + fmt(tfLeft) + ' / ' + (tfSec || 1) + 's',
    });
  }, [lastPrice, tfLeft, tfSec, metric, supply]);

  // ghost line
  useEffect(() => {
    if (!sPrice.current) return;
    const f = metric === 'price' ? 1 : supply;
    if (ghostLine.current) sPrice.current.removePriceLine(ghostLine.current);
    if (ghost?.price)
      ghostLine.current = sPrice.current.createPriceLine({
        price: ghost.price * f, color:'#6b7a8a', lineWidth:1, axisLabelVisible:true, title:'Ghost'
      });
  }, [ghost?.price, metric, supply]);

  // limit order line
  useEffect(() => {
    if (!sPrice.current) return;
    const sp = sPrice.current;

    // usuń starą
    if (limitLine.current) { sp.removePriceLine(limitLine.current); limitLine.current = null; }

    // rysuj tylko dla LIMIT i gdy jest target
    if (ordType !== 'limit' || limitT == null) return;

    const f = metric === 'price' ? 1 : supply; // price↔mcap
    limitLine.current = sp.createPriceLine({
      price: limitT * f,
      color: '#f1c40f',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: 'Limit Order Target',
    });
  }, [ordType, limitT, metric, supply, chartType]);

  // Rysowanie i aktualizacja linii LIMIT 
  useEffect(() => {
    if (!sPrice.current) return;
    const sp = sPrice.current;
    // usuń poprzednią
    if (limitLine.current) { sp.removePriceLine(limitLine.current); limitLine.current = null; }
    // rysuj tylko gdy LIMIT on + target jest
    if (ordType !== 'limit' || limitT == null) return;
    const display = pxToDisplay(limitT, metric, supply);
    limitLine.current = sp.createPriceLine({
      price: display,
      color: '#f1c40f',
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: 'Limit Order Target',
    });
  }, [ordType, limitT, metric, supply, chartType]);

  // SL/TP lines for current position
  useEffect(() => {
    if (!sPrice.current) return;
      const sp = sPrice.current;

    // znajdź pozycję dla symbolu
    const pos = positions.find(p => p.symbol === symbol);
    // clear stare
    if (slLine.current) { sp.removePriceLine(slLine.current); slLine.current = null; }
    if (tpLine.current) { sp.removePriceLine(tpLine.current); tpLine.current = null; }
      if (!pos) return;

    if (pos.sl != null) {
      slLine.current = sp.createPriceLine({
        price: pxToDisplay(pos.sl, metric, supply),
        color: '#e74c3c',
        lineStyle: LineStyle.Dashed,
        lineWidth: 1,
        axisLabelVisible: true,
        title: 'SL',
      });
    }
    if (pos.tp != null) {
      tpLine.current = sp.createPriceLine({
        price: pxToDisplay(pos.tp, metric, supply),
        color: '#2ecc71',
        lineStyle: LineStyle.Dashed,
        lineWidth: 1,
        axisLabelVisible: true,
        title: 'TP',
      });
    }
  }, [positions, symbol, metric, supply, chartType]);



  // entry / SL / TP
  const plEntry = useRef<IPriceLine|null>(null);
  const plSL = useRef<IPriceLine|null>(null);
  const plTP = useRef<IPriceLine|null>(null);
  const lastMetricRef = useRef<'price'|'mcap'>('price');

    function fitBoth() {
    if (!api.current || !sPrice.current) return;
    api.current.timeScale().fitContent();                    // X
    sPrice.current.priceScale().applyOptions({      // Y
     autoScale: true,
    });
  }

  useEffect(() => {
    if (!sPrice.current) return;
    const sp = sPrice.current;
    if (plEntry.current) sp.removePriceLine(plEntry.current);
    if (plSL.current) sp.removePriceLine(plSL.current);
    if (plTP.current) sp.removePriceLine(plTP.current);

    if (pos) {
      const f = factor();
      plEntry.current = sp.createPriceLine({
        price: pos.entry * f, color: pos.side === 'buy' ? '#2ecc71' : '#e74c3c', lineWidth: 1, title: 'Entry',
      });
      if (pos.sl != null) plSL.current = sp.createPriceLine({ price: pos.sl * f, color: '#e74c3c', lineWidth: 1, title: 'SL' });
      if (pos.tp != null) plTP.current = sp.createPriceLine({ price: pos.tp * f, color: '#2ecc71', lineWidth: 1, title: 'TP' });
    }
  }, [pos && pos.entry, pos && pos.sl, pos && pos.tp, pos && pos.side, metric, chartType]);

  // Alt/Shift LPM → SL/TP
  useEffect(() => {
    if (!api.current || !sPrice.current) return;
    const chart = api.current;
    const onClick = (param: MouseEventParams) => {
      if (!param?.point) return;
      if (!sPrice.current) return;
      const display = sPrice.current.coordinateToPrice(param.point.y);
      if (display == null) return;
      const px = displayToPx(display as number, metric, supply);

      // Use the global MouseEvent from window.event
      const mouseEvent = window.event as MouseEvent | undefined;
      if (mouseEvent?.altKey)   { setSLTP({ sl: px }); return; }
      if (mouseEvent?.shiftKey) { setSLTP({ tp: px }); return; }
      if (ordType === 'limit') { setLT(px); }
    };
    chart.subscribeClick(onClick);
    return () => chart.unsubscribeClick(onClick);
  }, [ordType, metric, supply, setLT, setSLTP]);


  // drag&drop linii LIMIT, SL, TP
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !api.current || !sPrice.current) return; 

    const hitPx = 12; // większy hitbox
    const sp: AnyPriceSeries | null = sPrice.current; 

    function priceOfLine(line: IPriceLine | null): number | undefined {
      if (!line) return undefined;
      // Use IPriceLine type and access options via the public API
      const opt = (typeof line.options === 'function' ? line.options() : (line as IPriceLine & { _options?: { price?: number } })._options);
      return opt?.price as number | undefined;
    }
    function nearLineY(line: IPriceLine | null, y: number) {
      const price = priceOfLine(line);
      if (price == null) return false;
      if (!sp) return false;
      const yy = sp.priceToCoordinate(price);
      return yy != null && Math.abs(yy - y) <= hitPx;
    } 

    const onDown = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const y = e.clientY - rect.top; 

      // priorytet SL/TP potem LIMIT
      if (nearLineY(slLine.current, y)) { dragging.current = { kind:'sl', y0:y }; e.preventDefault(); e.stopPropagation(); disablePan(); el.style.cursor = 'ns-resize'; return; }
      if (nearLineY(tpLine.current, y)) { dragging.current = { kind:'tp', y0:y }; e.preventDefault(); e.stopPropagation(); disablePan(); el.style.cursor = 'ns-resize'; return; }
      if (nearLineY(limitLine.current, y)) { dragging.current = { kind:'limit', y0:y }; e.preventDefault(); e.stopPropagation(); disablePan(); el.style.cursor = 'ns-resize'; return; }
    };  

    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const y = e.clientY - rect.top; 

      // podmień kursor gdy jesteś blisko linii, nawet bez drag
      if (!dragging.current) {
        if (nearLineY(slLine.current, y) || nearLineY(tpLine.current, y) || nearLineY(limitLine.current, y)) {
          el.style.cursor = 'ns-resize';
        } else {
          el.style.cursor = '';
        }
        return;
      } 

      // drag aktywny
      const display = sp.coordinateToPrice(y);
      if (display == null) return;
      const px = displayToPx(display as number, metric, supply);  

      if (dragging.current.kind === 'limit') setLT(px);
      else if (dragging.current.kind === 'sl') setSLTP({ sl: px });
      else if (dragging.current.kind === 'tp') setSLTP({ tp: px });
    };  

    const endDrag = () => {
      if (dragging.current) {
        dragging.current = null;
        enablePan();
        el.style.cursor = '';
      }
    };  

    el.addEventListener('mousedown', onDown, { passive: false });
    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('mouseup', endDrag, { passive: true }); 

    return () => {
      el.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', endDrag);
    };
  }, [metric, supply, setLT, setSLTP]);


  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onCtx = (e: MouseEvent) => {
      e.preventDefault();
      if (ordType === 'limit') setLT(null);
    };
    el.addEventListener('contextmenu', onCtx);
    return () => el.removeEventListener('contextmenu', onCtx);
  }, [ordType, setLT]);

  // reset view
  useEffect(() => { fitBoth(); }, [resetSignal]);

  return <div style={{ width:'100%', height:'100%', position:'relative' }} ref={ref} />;
}

function fmt(s?: number) {
  const t = Math.max(0, Math.ceil(s || 0));
  const m = Math.floor(t / 60);
  const ss = t % 60 < 10 ? '0' + (t % 60) : '' + (t % 60);
  return m + ':' + ss;
}
