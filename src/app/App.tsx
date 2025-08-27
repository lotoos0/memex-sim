// src/app/App.tsx
import { useEffect } from 'react';
import Chart from '../components/Chart';
import OrderPanel from '../components/OrderPanel';
import Toolbar from '../components/Toolbar';
import BottomPanel from '../components/BottomPanel';
import { useTradingStore } from '../store/tradingStore';
import usePriceFeed from '../hooks/usePriceFeed';
import ChartTopbar from '../components/ChartTopbar';

function fmt(s?: number) {
  const t = Math.max(0, Math.ceil(s ?? 0));
  const m = Math.floor(t / 60);
  const ss = t % 60 < 10 ? '0' + (t % 60) : '' + (t % 60);
  return `${m}:${ss}`;
}

export default function App() {
  // hydracja z IndexedDB po montażu
  const hydrateFromDB = useTradingStore(s => s.hydrateFromDB);
  useEffect(() => {
    hydrateFromDB().catch(() => {});
  }, [hydrateFromDB]);

  // start feedu
  usePriceFeed();

  // selektory
  const mode     = useTradingStore(s => s.mode);
  const setMode  = useTradingStore(s => s.setMode);
  const resetView= useTradingStore(s => s.resetView);
  const symbol   = useTradingStore(s => s.symbol);
  const lastPrice= useTradingStore(s => s.lastPrice);
  const tfSec    = useTradingStore(s => s.tfSec);
  const tfLeft   = useTradingStore(s => s.tfLeft);

  return (
    <div id="app">
      <header id="topbar">
        <div className="metric"><span>Symbol</span><strong>{symbol}</strong></div>
        <div className="metric"><span>Price</span><strong>{lastPrice ? (lastPrice / 1000).toFixed(2) + 'K' : '–'}</strong></div>
        <div className="metric">
          <span>Mode</span>
          <strong><button onClick={() => setMode(mode === 'SIM' ? 'LIVE' : 'SIM')}>{mode}</button></strong>
        </div>
        <div className="metric"><span>Candle</span><strong>{fmt(tfLeft)} / {tfSec || 1}s</strong></div>
        <div className="metric"><span>View</span><strong><button onClick={resetView}>Reset View</button></strong></div>
      </header>

      <main id="main">
        <nav id="rail"><Toolbar /></nav>
        <section id="chart-wrap">
          <ChartTopbar />
          <div id="chart"><Chart /></div>
        </section>
        <aside id="sidebar"><OrderPanel /></aside>
        <section id="bottom"><BottomPanel /></section>
      </main>
    </div>
  );
}
