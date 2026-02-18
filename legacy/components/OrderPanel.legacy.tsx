/* eslint-disable @typescript-eslint/no-unused-vars */
// src/components/OrderPanel.tsx
import { useMemo, useState, useEffect } from 'react';
import { useTradingStore, Side, OrdType, Order, Position } from '../store/tradingStore';
import { validateRisk, rateLimit } from '../sim/risk';

export default function OrderPanel() {
  // global state
  //const mode          = useTradingStore(s => s.mode);
  //const setMode       = useTradingStore(s => s.setMode);
  const reduceOnly    = useTradingStore(s => s.reduceOnly);
  const setReduceOnly = (v: boolean) => useTradingStore.setState({ reduceOnly: v });
  const lastPrice     = useTradingStore(s => s.lastPrice);
  const risk          = useTradingStore(s => s.risk);
  const symbol        = useTradingStore(s => s.symbol);

  // LIMIT UI state w store
  const orderType     = useTradingStore(s => s.orderTypeUI);
  const setOrderType  = useTradingStore(s => s.setOrderTypeUI);
  const limitTarget   = useTradingStore(s => s.limitTarget);          // przechowywany jako PRICE
  const setLT         = useTradingStore(s => s.setLimitTarget);
  const metric        = useTradingStore(s => s.metric);               // price | mcap
  const supply        = useTradingStore(s => s.supply);

  const pos = useTradingStore(s => {
    for (let i = 0; i < s.positions.length; i++) if (s.positions[i].symbol === s.symbol) return s.positions[i];
    return undefined;
  });
  const placeOrder = useTradingStore(s => s.placeOrder);

  // lokalny UI
  const [side, setSide] = useState<Side>('buy');
  const [adv, setAdv] = useState<boolean>(false);

  const [amount, setAmount] = useState<number>(100);
  const [slip, setSlip] = useState<number>(0.05);
  const [slPct, setSlPct] = useState<number>(1.0);
  const [tpPct, setTpPct] = useState<number>(2.0);

  const [limitStr, setLimitStr] = useState<string>('');

  const [err, setErr] = useState<string>('');
  const [lockedUntil, setLockedUntil] = useState<number>(0);
  const disabled = Date.now() < lockedUntil;

  const lp = lastPrice || 0;

  // podsumowanie na przycisku
  const orderSummary = useMemo(() => {
    const pr = orderType === 'limit' ? limitTarget : undefined; // zawsze PRICE
    return { t: orderType as OrdType, pr };
  }, [orderType, limitTarget]);

  useEffect(() => {
    if (limitTarget == null) { setLimitStr(''); return; }
    const disp = pxToDisplay(limitTarget, metric, supply);
    setLimitStr(fmtLimit(disp));
  }, [limitTarget, metric, supply]);


  function fail(msg: string) { setErr(msg); setLockedUntil(Date.now() + 2000); }

  const submit = () => {
    if (disabled) return;

    const kind: { type: OrdType; price?: number } =
      orderType === 'limit'
        ? { type: 'limit', price: (limitTarget ?? lp) }
        : { type: 'market' };

    const candidate: Order = {
      id: 'tmp', ts: Date.now(), symbol,
      side, type: kind.type, qty: amount, price: kind.price,
      slPct: slPct / 100, tpPct: tpPct / 100,
      slippagePct: slip, reduceOnly,
      status: 'new',
    };

    if (!rateLimit(Date.now(), risk.maxOrdersPerMinute)) return fail('rate-limit');
    const check = validateRisk(candidate, lp, risk, pos as Position | undefined);
    if (!check.ok) return fail(check.reason || 'risk');

    placeOrder({
      side, type: kind.type, qty: amount, price: kind.price,
      slPct: slPct / 100, tpPct: tpPct / 100, slippagePct: slip, reduceOnly,
    });
    setErr('');
  };

  const BAL = 1000;
  const setPct = (p: number) => setAmount(Math.max(0, Math.round(BAL * p)));

  // helpers
  const fmtTarget = (p?: number) => {
    if (p == null) return '';
    if (metric === 'mcap') return (p * supply / 1000).toFixed(1) + 'K';
    if (p >= 1) return p.toFixed(3);
    if (p >= 0.1) return p.toFixed(4);
    if (p >= 0.01) return p.toFixed(5);
    return p.toFixed(6);
  };

  const inputLimitDisplay = (() => {
    const p = limitTarget ?? lp;
    return metric === 'price' ? p : p * supply;
  })();

  const pxToDisplay = (px: number, metric: string, supply: number) =>
    metric === 'mcap' ? px * supply : px;
  const displayToPx = (d: number, metric: string, supply: number) =>
    metric === 'mcap' ? d / supply : d;

  // ile miejsc po przecinku
  function fmtLimit(d: number) {
    if (d >= 1) return d.toFixed(3);
    if (d >= 0.1) return d.toFixed(4);
    return d.toFixed(5);
  }

  

  return (
    <section id="controls" className="panel ax">
      {/* KPIs */}
      <div className="kpis">
        <div><span>5m Vol</span><b>$80.4K</b></div>
        <div><span>Buys</span><b className="up">261 / $44.2K</b></div>
        <div><span>Sells</span><b className="down">169 / $36.2K</b></div>
        <div><span>Net Vol</span><b className="up">+$7.9K</b></div>
      </div>

      {/* Buy/Sell segment */}
      <div className="seg ax">
        <button className={'pill buy ' + (side==='buy'?'on':'')} onClick={()=>setSide('buy')}>Buy</button>
        <button className={'pill sell ' + (side==='sell'?'on':'')} onClick={()=>setSide('sell')}>Sell</button>
        <button className="drop">▾</button>
      </div>

      {/* Tabs */}
      <div className="tabs ax">
        <button className={orderType==='market'?'on':''} onClick={()=>setOrderType('market')}>Market</button>
        <button className={orderType==='limit'?'on':''}  onClick={()=>setOrderType('limit')}>Limit</button>
        <button className={adv?'on':''} onClick={()=>setAdv(!adv)}>Adv.</button>
        <div className="spacer" />
        <button className="mini">①</button>
        <button className="mini">≣</button>
      </div>

      {/* Amount */}
      <div className="field ax">
        <label>AMOUNT</label>
        <div className="input ax">
          <input type="number" value={amount} onChange={e=>setAmount(Number(e.target.value||0))}/>
          <button className="unit">% </button>
          <button className="unit">≡</button>
        </div>
        <div className="chips ax">
          <button onClick={()=>setPct(0.25)}>25</button>
          <button onClick={()=>setPct(0.38)}>38</button>
          <button onClick={()=>setPct(0.55)}>55</button>
          <button onClick={()=>setPct(1)}>100</button>
          <button className="unit">% </button>
        </div>
        <div className="row ax">
          <span className="muted">⚙ 50%</span>
          <span className="muted">⚠ 0.01</span>
          <span className="muted">⚠ 0.03</span>
          <span className="muted">⚠ 0.1</span>
          <span className="muted">⏻ Off</span>
        </div>
      </div>

      {/* LIMIT price input */}
      {orderType === 'limit' && (
        <div className="field ax">
          <label>LIMIT PRICE</label>
          <div className="input ax limit">
            <input
              type="text"
              inputMode="decimal"
              value={limitStr}
              onChange={(e) => {
                const raw = e.target.value.replace(',', '.');
                setLimitStr(raw);
                const num = parseFloat(raw);
                if (!Number.isNaN(num)) setLT(displayToPx(num, metric, supply));
              }}
              onBlur={() => {
                if (limitTarget != null) {
                  const disp = pxToDisplay(limitTarget, metric, supply);
                  setLimitStr(fmtLimit(disp));
                }
              }}
              maxLength={14}
            />
            <button
              className="unit btn"
              onClick={() => setLT(displayToPx(lastPrice || 0, metric, supply))}
            >
              @Last
            </button>
            <button className="unit btn" onClick={() => { setLT(NaN); setLimitStr(''); }}>
              ×
            </button>
          </div>
        </div>
      )}


      {/* Advanced */}
      <label className="checkbox ax">
        <input type="checkbox" checked={adv} onChange={e=>setAdv(e.target.checked)} />
        <span>Advanced Trading Strategy</span>
      </label>

      {adv && (
        <div className="dual">
          <div className="field small">
            <label>SL %</label>
            <div className="input"><input type="number" step="0.01" value={slPct} onChange={e=>setSlPct(Number(e.target.value||0))}/></div>
          </div>
          <div className="field small">
            <label>TP %</label>
            <div className="input"><input type="number" step="0.01" value={tpPct} onChange={e=>setTpPct(Number(e.target.value||0))}/></div>
          </div>
        </div>
      )}

      {/* Primary */}
      <button
        className={'primary pill big elev ' + side}
        disabled={disabled}
        onClick={submit}
      >
        {side==='buy' ? 'Buy' : 'Sell'} {symbol.split('/')[0]}
        <span className="sub">
          {orderSummary.t.toUpperCase()}
          {orderSummary.pr != null ? ' @ ' + fmtTarget(orderSummary.pr) : ''}
        </span>
      </button>

      {/* Mini KPIs + ReduceOnly */}
      <MiniStats />
      <div className="row ax">
        <label className="toggle"><input type="checkbox" checked={reduceOnly} onChange={e=>setReduceOnly(e.target.checked)}/> Reduce-Only</label>
        <div className="spacer" />
        <button className="chip" onClick={()=>useTradingStore.getState().closePct(0.25)}>Close 25%</button>
        <button className="chip" onClick={()=>useTradingStore.getState().closePct(0.5)}>50%</button>
        <button className="chip" onClick={()=>useTradingStore.getState().closePct(1)}>100%</button>
      </div>

      {/* Presets */}
      <div className="presets ax">
        <button>PRESET 1</button>
        <button>PRESET 2</button>
        <button className="on">PRESET 3</button>
      </div>

      {/* Token Info cards (mock) */}
      <div className="cards ax">
        <Card k="10.35%" t="Top 10 H." />
        <Card k="0%" t="Dev H." />
        <Card k="1.02%" t="Snipers H." />
        <Card k="0.03%" t="Insiders" />
        <Card k="16.65%" t="Bundlers" warn />
        <Card k="100%" t="LP Burned" good />
      </div>

      <div className="cards ax small">
        <Card k="2395" t="Holders" />
        <Card k="2230" t="Pro Traders" />
        <Card k="Paid" t="Dex Paid" good />
      </div>

      {err && <div className="error">Error: {err}</div>}
    </section>
  );
}

function MiniStats() {
  const pos = useTradingStore(s => {
    for (let i = 0; i < s.positions.length; i++) if (s.positions[i].symbol === s.symbol) return s.positions[i];
    return undefined;
  });
  return (
    <div className="mini-kpis ax">
      <div><span>Bought</span><b>{pos ? (pos.side==='buy'?pos.qty.toFixed(2):'0') : '0'}</b></div>
      <div><span>Sold</span><b>{pos ? (pos.side==='sell'?pos.qty.toFixed(2):'0') : '0'}</b></div>
      <div><span>Holding</span><b>{pos ? pos.qty.toFixed(2) : '0'}</b></div>
      <div><span>PnL</span><b className={(pos && pos.unrealized>=0)?'up':'down'}>{pos ? pos.unrealized.toFixed(2) : '+0.00'}</b></div>
    </div>
  );
}

function Card({k,t,good,warn}:{k:string;t:string;good?:boolean;warn?:boolean}) {
  return (
    <div className={'card '+(good?'good':'')+(warn?' warn':'')}>
      <div className="k">{k}</div>
      <div className="t">{t}</div>
    </div>
  );
}


