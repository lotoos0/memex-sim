import { useMemo, useState } from 'react';
import { useTradingStore, Position, Side } from '../store/tradingStore';
import { downloadCSV, toCSV } from 'src/utils/csv';

type Tab = 'positions' | 'openOrders' | 'orders' | 'posHistory';


function fmtPx(x: number) {
  if (x >= 1) return x.toFixed(3);
  if (x >= 0.1) return x.toFixed(4);
  if (x >= 0.01) return x.toFixed(5);
  return x.toFixed(6);
}

export default function BottomPanel() {
  const [tab, setTab] = useState<Tab>('positions');

  const symbol   = useTradingStore(s => s.symbol);
  const last     = useTradingStore(s => s.lastPrice);
  const risk     = useTradingStore(s => s.risk);
  const positions= useTradingStore(s => s.positions);
  const orders   = useTradingStore(s => s.orders);
  const trades   = useTradingStore(s => s.trades);
  const realized = useTradingStore(s => s.realizedBySymbol);
  const closePct = useTradingStore(s => s.closePct);
  const place    = useTradingStore(s => s.placeOrder);
  const posHistory = useTradingStore(s => s.positionHistory);


  const maxLev = risk.maxLeverage ?? 1;

  const openOrders = useMemo(() => orders.filter(o => o.status === 'new'), [orders]);

  function liqPrice(p: Position): number {
    // uproszczone: brak MMR. long: entry*(1 - 1/lev), short: entry*(1 + 1/lev)
    if (maxLev <= 1) return p.side === 'buy' ? p.entry * 0.0 : p.entry * 999999; // praktycznie brak likwidacji
    return p.side === 'buy' ? p.entry * (1 - 1 / maxLev) : p.entry * (1 + 1 / maxLev);
  }

  function margin(p: Position): number {
    // isolated: notional / lev
    return (p.entry * p.qty) / Math.max(1, maxLev);
  }

  function roePct(p: Position): number {
    const m = margin(p);
    if (m <= 0) return 0;
    return (p.unrealized / m) * 100;
  }

  function reverse(p: Position) {
    const qty = p.qty * 2;
    const side: Side = p.side === 'buy' ? 'sell' : 'buy';
    place({ side, type: 'market', qty, reduceOnly: false });
  }

  return (
    <div className="bottom">
      <div className="tabbar" style={{display:'flex',alignItems:'center',gap:8}}>
        <div className="tabs">
          <button className={tab==='positions'?'on':''} onClick={()=>setTab('positions')}>Positions</button>
          <button className={tab==='openOrders'?'on':''} onClick={()=>setTab('openOrders')}>Open Orders</button>
          <button className={tab==='posHistory'?'on':''} onClick={()=>setTab('posHistory')}>Position History</button>
          <button className={tab==='orders'?'on':''} onClick={()=>setTab('orders')}>Order History</button>
          
        </div>
        <div style={{flex:1}} />
        <div className="muted" style={{fontSize:12}}>Mark: {fmtPx(last || 0)}</div>
      </div>

      {tab==='positions' && (
        <table className="grid">
          <thead>
            <tr>
              <th>Symbol</th><th>Side</th><th>Size</th><th>Liq. Price</th>
              <th>Margin</th><th>Entry Price</th><th>Mark Price</th>
              <th>Unreal. P&L (ROE)</th><th>Real. P&L</th><th></th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p,i)=>{
              const lp = liqPrice(p);
              const m  = margin(p);
              const roe = roePct(p);
              const rpnl = realized[p.symbol] ?? 0;
              return (
                <tr key={i}>
                  <td>{p.symbol}</td>
                  <td className={p.side==='buy'?'up':'down'}>{p.side}</td>
                  <td>{p.qty.toFixed(3)}</td>
                  <td>{fmtPx(lp)}</td>
                  <td>{m.toFixed(2)}</td>
                  <td>{fmtPx(p.entry)}</td>
                  <td>{fmtPx(last || 0)}</td>
                  <td className={p.unrealized>=0?'up':'down'}>
                    {p.unrealized.toFixed(2)} ({roe.toFixed(1)}%)
                  </td>
                  <td className={(rpnl)>=0?'up':'down'}>{rpnl.toFixed(2)}</td>
                  <td style={{whiteSpace:'nowrap'}}>
                    <button onClick={()=>closePct(0.25)}>Close 25%</button>{' '}
                    <button onClick={()=>closePct(0.5)}>50%</button>{' '}
                    <button onClick={()=>closePct(1)}>100%</button>{' '}
                    <button onClick={()=>reverse(p)}>Reverse</button>
                  </td>
                </tr>
              );
            })}
            {positions.length===0 && <tr><td colSpan={10} className="muted">No positions</td></tr>}
          </tbody>
        </table>
      )}

      {tab==='openOrders' && (
        <table className="grid">
          <thead><tr><th>Time</th><th>Side</th><th>Type</th><th>Qty</th><th>Price/Trigger</th><th>Status</th></tr></thead>
          <tbody>
            {openOrders.map((o)=>(
              <tr key={o.id}>
                <td>{new Date(o.ts).toLocaleTimeString()}</td>
                <td className={o.side==='buy'?'up':'down'}>{o.side}</td>
                <td>{o.type}</td>
                <td>{o.qty.toFixed(3)}</td>
                <td>{o.price!=null?fmtPx(o.price):(o.trigger!=null?('▲ '+fmtPx(o.trigger)):'—')}</td>
                <td>{o.status}</td>
              </tr>
            ))}
            {openOrders.length===0 && <tr><td colSpan={6} className="muted">No open orders</td></tr>}
          </tbody>
        </table>
      )}

      {tab==='posHistory' && (
  <table className="grid">
    <thead>
      <tr>
        <th>Symbol</th><th>Side</th><th>Opened</th><th>Closed</th>
        <th>Size</th><th>Entry Avg</th><th>Exit Avg</th>
        <th>Notional</th><th>P&L</th><th>Duration</th>
      </tr>
    </thead>
    <tbody>
      {posHistory.map(r=>(
        <tr key={r.id}>
          <td>{r.symbol}</td>
          <td className={r.side==='buy'?'up':'down'}>{r.side}</td>
          <td>{new Date(r.openTs).toLocaleTimeString()}</td>
          <td>{new Date(r.closeTs).toLocaleTimeString()}</td>
          <td>{r.size.toFixed(3)}</td>
          <td>{r.entryAvg.toFixed(6)}</td>
          <td>{r.exitAvg.toFixed(6)}</td>
          <td>{r.notional.toFixed(2)}</td>
          <td className={r.pnl>=0?'up':'down'}>{r.pnl.toFixed(2)}</td>
          <td>{r.durationSec}s</td>
        </tr>
      ))}
      {posHistory.length===0 && <tr><td colSpan={10} className="muted">No closed positions</td></tr>}
    </tbody>
  </table>
)}


      {tab==='orders' && (
        <table className="grid">
          <thead><tr><th>Time</th><th>Side</th><th>Type</th><th>Qty</th><th>Price</th><th>Status</th></tr></thead>
        <tbody>
          {orders.map((o)=>(
            <tr key={o.id}>
              <td>{new Date(o.ts).toLocaleTimeString()}</td>
              <td className={o.side==='buy'?'up':'down'}>{o.side}</td>
              <td>{o.type}</td>
              <td>{o.qty.toFixed(3)}</td>
              <td>{o.price!=null?fmtPx(o.price):'—'}</td>
              <td>{o.status}</td>
            </tr>
          ))}
          {orders.length===0 && <tr><td colSpan={6} className="muted">No orders</td></tr>}
        </tbody>
        </table>
      )}
    </div>
  );
}
