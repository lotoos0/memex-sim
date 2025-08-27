// src/components/ChartTopbar.tsx
import { useTradingStore, ChartType, Metric } from '../store/tradingStore';

export default function ChartTopbar() {
  const tfSec = useTradingStore(s=>s.tfSec);
  const setTfSec = useTradingStore(s=>s.setTfSec);
  const chartType = useTradingStore(s=>s.chartType);
  const setChartType = useTradingStore(s=>s.setChartType);
  const metric = useTradingStore(s=>s.metric);
  const setMetric = useTradingStore(s=>s.setMetric);
  const showSMA20 = useTradingStore(s=>s.showSMA20);
  const showSMA50 = useTradingStore(s=>s.showSMA50);
  const toggleSMA20 = useTradingStore(s=>s.toggleSMA20);
  const toggleSMA50 = useTradingStore(s=>s.toggleSMA50);

  const tfs = [1,5,15,30,60];

  const types: {k:ChartType;label:string}[] = [
    {k:'candles', label:'Candles'},
    {k:'bars', label:'Bars'},
    {k:'line', label:'Line'},
    {k:'area', label:'Area'},
    {k:'baseline', label:'Baseline'},
  ];

  return (
    <div className="chart-topbar">
      <div className="group">
        {tfs.map(t=>(
          <button key={t} className={tfSec===t?'on':''} onClick={()=>setTfSec(t)}>
            {t<60? `${t}s` : `${t/60}m`}
          </button>
        ))}
      </div>

      <div className="sep" />

      <div className="group">
        {types.map(t=>(
          <button key={t.k} className={chartType===t.k?'on':''} onClick={()=>setChartType(t.k)}>{t.label}</button>
        ))}
      </div>

      <div className="sep" />

      <div className="group">
        <button className={showSMA20?'on':''} onClick={toggleSMA20}>SMA 20</button>
        <button className={showSMA50?'on':''} onClick={toggleSMA50}>SMA 50</button>
      </div>

      <div className="sep" />

      <div className="group">
        <button className={metric==='price'?'on':''} onClick={()=>setMetric('price' as Metric)}>Price</button>
        <button className={metric==='mcap'?'on':''} onClick={()=>setMetric('mcap' as Metric)}>MarketCap</button>
      </div>
    </div>
  );
}
