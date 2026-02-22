import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useTokenStore, selectActiveToken } from '../store/tokenStore';
import Chart from '../components/chart/Chart';
import TradeSidebar from '../components/token/TradeSidebar';
import BottomTabs from '../components/token/BottomTabs';
import InstantTradePanel from '../components/floating/InstantTradePanel';
import { registry } from '../tokens/registry';
import type { CurveDebugSnapshot } from '../tokens/tokenSim';
import { useTradingStore, type QuickTrade } from '../store/tradingStore';

const EMPTY_QUICK_TRADES: QuickTrade[] = [];
const INSTANT_TRADE_ENABLED_STORAGE_KEY = 'memex:instant-trade:enabled';

function fmtUsd(v: number): string {
  if (!Number.isFinite(v)) return '$0';
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function fmtPrice(v: number): string {
  if (!Number.isFinite(v)) return '0.0000';
  if (v >= 1) return v.toFixed(4);
  if (v >= 0.01) return v.toFixed(6);
  return v.toExponential(4);
}

function fmtDebug(v: number): string {
  if (!Number.isFinite(v)) return '0';
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(3)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(3)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(3)}K`;
  if (a >= 1) return v.toFixed(4);
  return v.toExponential(4);
}

function fmtSignedUsd(v: number): string {
  const sign = v >= 0 ? '+' : '-';
  return `${sign}${fmtUsd(Math.abs(v))}`;
}

export default function TokenPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const setActive = useTokenStore(s => s.setActiveToken);
  const token = useTokenStore(selectActiveToken);
  const selectQuickPosition = useMemo(
    () => (s: ReturnType<typeof useTradingStore.getState>) => (id ? (s.quickPositionsByTokenId[id] ?? null) : null),
    [id]
  );
  const selectTokenTrades = useMemo(
    () => (s: ReturnType<typeof useTradingStore.getState>) => (id ? (s.quickTradesByTokenId[id] ?? EMPTY_QUICK_TRADES) : EMPTY_QUICK_TRADES),
    [id]
  );
  const quickPosition = useTradingStore(selectQuickPosition);
  const quickTrades = useTradingStore(selectTokenTrades);
  const isDev = import.meta.env.DEV;
  const debugFromQuery = useMemo(() => {
    if (!isDev) return false;
    return new URLSearchParams(location.search).get('debug') === 'curve';
  }, [isDev, location.search]);
  const [showCurveDebug, setShowCurveDebug] = useState(debugFromQuery);
  const [instantTradeEnabled, setInstantTradeEnabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(INSTANT_TRADE_ENABLED_STORAGE_KEY) === '1';
  });
  const [curveDebug, setCurveDebug] = useState<CurveDebugSnapshot | null>(null);

  useEffect(() => {
    if (debugFromQuery) setShowCurveDebug(true);
  }, [debugFromQuery]);

  useEffect(() => {
    if (id) setActive(id);
    return () => setActive(null);
  }, [id, setActive]);

  useEffect(() => {
    if (token && token.phase === 'DEAD') navigate('/');
  }, [token, navigate]);

  useEffect(() => {
    if (!isDev || !showCurveDebug || !id) {
      setCurveDebug(null);
      return;
    }
    const update = () => {
      const sim = registry.getTokenSim(id);
      setCurveDebug(sim ? sim.getCurveDebugSnapshot() : null);
    };
    update();
    const handle = setInterval(update, 250);
    return () => clearInterval(handle);
  }, [id, isDev, showCurveDebug]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(
      INSTANT_TRADE_ENABLED_STORAGE_KEY,
      instantTradeEnabled ? '1' : '0'
    );
  }, [instantTradeEnabled]);

  if (!token) {
    return (
      <div className="flex flex-1 items-center justify-center text-ax-text-dim text-sm">
        Token not found.
        <Link to="/" className="text-ax-green ml-2 hover:underline">Back to Pulse</Link>
      </div>
    );
  }

  const isRugged = token.phase === 'RUGGED';
  const positionQty = quickPosition?.qty ?? 0;
  const hasOpenPosition = positionQty > 0;
  const holdingUsd = hasOpenPosition ? positionQty * token.lastPriceUsd : 0;
  const unrealizedUsd = hasOpenPosition ? holdingUsd - (quickPosition?.costBasisUsd ?? 0) : 0;
  const recentTrades = quickTrades.slice(-3).reverse();

  return (
    <div className="flex flex-col bg-ax-bg min-h-full pb-[26vh]">
      <div className="flex items-center gap-4 px-4 py-2 border-b border-ax-border bg-ax-surface shrink-0">
        <button onClick={() => navigate('/')} className="text-ax-text-dim hover:text-ax-text transition-colors">
          <ArrowLeft size={14} />
        </button>

        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
          style={{ backgroundColor: token.logoColor + '33', color: token.logoColor, border: `1px solid ${token.logoColor}55` }}
        >
          {token.ticker.slice(0, 2)}
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-ax-text">{token.ticker}</span>
            {isRugged && (
              <span className="text-[10px] font-bold text-ax-red bg-ax-red-dim px-1.5 py-0.5 rounded">
                RUGGED
              </span>
            )}
            <span className="text-ax-text-dim text-xs">{token.name}</span>
          </div>

          <div className="h-4 w-px bg-ax-border" />
          <span className="text-sm font-bold text-ax-text">${fmtPrice(token.lastPriceUsd)}</span>
          <span className={`text-xs font-medium ${token.changePct >= 0 ? 'text-ax-green' : 'text-ax-red'}`}>
            {token.changePct >= 0 ? '+' : ''}{token.changePct.toFixed(2)}%
          </span>
        </div>

        <div className="flex items-center gap-4 ml-4 text-xs text-ax-text-dim">
          <span>MC <span className="text-ax-text font-medium">{fmtUsd(token.mcapUsd)}</span></span>
          <span>Liq <span className="text-ax-text font-medium">{fmtUsd(token.liquidityUsd)}</span></span>
          <span>
            B.Curve{' '}
            <span className={token.bondingCurvePct > 80 ? 'text-ax-yellow font-bold' : 'text-ax-text font-medium'}>
              {token.bondingCurvePct.toFixed(1)}%
            </span>
          </span>
          <span>5m Vol <span className="text-ax-text font-medium">{fmtUsd(token.vol5mUsd)}</span></span>
          <span>
            <span className="text-ax-green">{token.buys5m}B</span>
            {' / '}
            <span className="text-ax-red">{token.sells5m}S</span>
          </span>
        </div>

        {isDev && (
          <button
            onClick={() => setShowCurveDebug(v => !v)}
            className={[
              'ml-auto text-[11px] px-2 py-1 rounded border transition-colors',
              showCurveDebug
                ? 'border-ax-green text-ax-green bg-[#00d4a118]'
                : 'border-ax-border text-ax-text-dim hover:text-ax-text',
            ].join(' ')}
          >
            Curve Debug
          </button>
        )}
      </div>

      <div className="px-4 py-2 border-b border-ax-border bg-ax-surface2 text-xs">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-ax-text-dim">
          <span>
            Position{' '}
            <span className="text-ax-text font-medium">
              {hasOpenPosition ? `${positionQty.toFixed(0)} ${token.ticker}` : 'none'}
            </span>
          </span>
          <span>
            Avg Entry{' '}
            <span className="text-ax-text font-medium">
              {hasOpenPosition ? `$${fmtPrice(quickPosition!.avgEntryUsd)}` : '-'}
            </span>
          </span>
          <span>
            Holding <span className="text-ax-text font-medium">{hasOpenPosition ? fmtUsd(holdingUsd) : '$0'}</span>
          </span>
          <span>
            uPnL{' '}
            <span className={unrealizedUsd >= 0 ? 'text-ax-green font-medium' : 'text-ax-red font-medium'}>
              {hasOpenPosition ? fmtSignedUsd(unrealizedUsd) : '$0'}
            </span>
          </span>
          <span>
            Realized{' '}
            <span className={(quickPosition?.realizedPnlUsd ?? 0) >= 0 ? 'text-ax-green font-medium' : 'text-ax-red font-medium'}>
              {fmtSignedUsd(quickPosition?.realizedPnlUsd ?? 0)}
            </span>
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-ax-text-dim">
          {recentTrades.length === 0 ? (
            <span>No trades yet.</span>
          ) : (
            recentTrades.map((trade) => (
              <span key={trade.id} className="rounded border border-ax-border px-2 py-0.5 bg-ax-bg/50">
                <span className={trade.side === 'buy' ? 'text-ax-green' : 'text-ax-red'}>
                  {trade.side === 'buy' ? 'B' : 'S'}
                </span>
                {' '}
                {fmtUsd(trade.notionalUsd)} @ ${fmtPrice(trade.priceUsd)}
              </span>
            ))
          )}
        </div>
      </div>

      {isDev && showCurveDebug && curveDebug && (
        <div className="px-4 py-2 border-b border-ax-border bg-ax-surface2 text-[11px] font-mono text-ax-text-dim grid grid-cols-2 lg:grid-cols-5 gap-x-4 gap-y-1">
          <span>phase: <span className="text-ax-text">{curveDebug.phase}</span></span>
          <span>progressNow: <span className="text-ax-text">{curveDebug.progressNowPct.toFixed(2)}%</span></span>
          <span>latches: <span className="text-ax-text">{curveDebug.hasEnteredFinal ? 'F' : '-'} / {curveDebug.hasMigrated ? 'M' : '-'}</span></span>
          <span>rTok/rTok0: <span className="text-ax-text">{fmtDebug(curveDebug.rTok)} / {fmtDebug(curveDebug.rTok0)}</span></span>
          <span>vTok: <span className="text-ax-text">{fmtDebug(curveDebug.vTok)}</span></span>

          <span>vBase: <span className="text-ax-text">{fmtDebug(curveDebug.vBase)}</span></span>
          <span>rBase: <span className="text-ax-text">{fmtDebug(curveDebug.rBase)}</span></span>
          <span>k: <span className="text-ax-text">{fmtDebug(curveDebug.k)}</span></span>
          <span>kDrift: <span className={Math.abs(curveDebug.kDriftPct) > 0.5 ? 'text-ax-red' : 'text-ax-text'}>{curveDebug.kDriftPct.toFixed(4)}%</span></span>
          <span>invalid: <span className={curveDebug.invalidState ? 'text-ax-red' : 'text-ax-green'}>{curveDebug.invalidState ? 'yes' : 'no'}</span></span>
          <span>priceCurve: <span className="text-ax-text">${fmtDebug(curveDebug.priceCurveUsd)}</span></span>
          <span>mcapCurve: <span className="text-ax-text">${fmtDebug(curveDebug.mcapCurveUsd)}</span></span>

          <span>feeBps: <span className="text-ax-text">{curveDebug.feeBps}</span></span>
          <span className="col-span-1 lg:col-span-4">
            lastSwap:{' '}
            <span className="text-ax-text">
              {curveDebug.lastSwap
                ? `${curveDebug.lastSwap.direction} in=${fmtDebug(curveDebug.lastSwap.amountIn)} out=${fmtDebug(curveDebug.lastSwap.amountOut)} @${Math.round(curveDebug.lastSwap.simMs)}ms`
                : 'none'}
            </span>
          </span>
        </div>
      )}

      <div className="flex xl:flex-row flex-col">
        <div className="flex flex-col flex-1 min-h-[640px]">
          <div className="h-[54vh] min-h-[360px]">
            <Chart tokenId={token.id} />
          </div>
          <BottomTabs
            tokenId={token.id}
            instantTradeEnabled={instantTradeEnabled}
            onToggleInstantTrade={() => setInstantTradeEnabled((v) => !v)}
          />
        </div>
        <TradeSidebar token={token} />
      </div>

      <InstantTradePanel
        token={token}
        open={instantTradeEnabled}
        onClose={() => setInstantTradeEnabled(false)}
      />
    </div>
  );
}
