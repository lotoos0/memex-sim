import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pencil, RefreshCcw } from 'lucide-react';
import type { TokenState } from '../../tokens/types';
import {
  selectLastQuickExecutionByTokenId,
  selectQuickPositionSummaryByTokenId,
  useTradingStore,
} from '../../store/tradingStore';
import { usdToSol } from '../../store/walletStore';

interface Props {
  token: TokenState;
  floating?: boolean;
}

function fmtUsd(v: number): string {
  if (!Number.isFinite(v)) return '$0';
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function fmtSol(v: number): string {
  if (!Number.isFinite(v)) return '0 SOL';
  const a = Math.abs(v);
  if (a >= 1e3) return `${(v / 1e3).toFixed(2)}K SOL`;
  if (a >= 1) return `${v.toFixed(3)} SOL`;
  if (a >= 0.01) return `${v.toFixed(4)} SOL`;
  return `${v.toFixed(6)} SOL`;
}

function fmtSignedPct(v: number): string {
  if (!Number.isFinite(v)) return '+0.00%';
  const sign = v >= 0 ? '+' : '-';
  return `${sign}${Math.abs(v).toFixed(2)}%`;
}

function fmtPriceUsd(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '$0';
  if (v >= 1) return `$${v.toFixed(4)}`;
  if (v >= 0.01) return `$${v.toFixed(6)}`;
  return `$${v.toExponential(4)}`;
}

function fmtQty(v: number): string {
  if (!Number.isFinite(v)) return '0';
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  if (a >= 1) return v.toFixed(2);
  return v.toFixed(6);
}

type Side = 'buy' | 'sell';
type OrderType = 'market' | 'limit';
type StatUnit = 'usd' | 'sol';

const PRESET_STORAGE_KEY = 'dex.quick_amount_presets_v1';
const DEFAULT_PRESETS = ['0.1', '0.5', '1', '5'];

function normalizePresetValue(raw: string): string | null {
  const normalized = raw.trim().replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  if (parsed >= 1) return parsed.toString();
  return parsed.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

function loadPresetValues(): string[] {
  if (typeof window === 'undefined') return DEFAULT_PRESETS;
  try {
    const raw = window.localStorage.getItem(PRESET_STORAGE_KEY);
    if (!raw) return DEFAULT_PRESETS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== DEFAULT_PRESETS.length) return DEFAULT_PRESETS;
    const next = parsed.map((v: unknown) => normalizePresetValue(String(v ?? '')));
    if (next.some(v => v == null)) return DEFAULT_PRESETS;
    return next as string[];
  } catch {
    return DEFAULT_PRESETS;
  }
}

export default function TradeSidebar({ token, floating = false }: Props) {
  const [side, setSide] = useState<Side>('buy');
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [amount, setAmount] = useState('0.10');
  const [editingPresets, setEditingPresets] = useState(false);
  const [presetValues, setPresetValues] = useState<string[]>(() => loadPresetValues());
  const [statUnit, setStatUnit] = useState<StatUnit>('usd');
  const [displayMovingPnlPct, setDisplayMovingPnlPct] = useState(0);
  const pctAnimRef = useRef<number | null>(null);
  const pctValueRef = useRef(0);
  const safePrice = Number.isFinite(token.lastPriceUsd) ? token.lastPriceUsd : 0;
  const [limitPrice, setLimitPrice] = useState(safePrice.toFixed(8));
  const [advanced, setAdvanced] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [slippagePct, setSlippagePct] = useState('1.0');
  const [prioritySol, setPrioritySol] = useState('0');
  const [bribeSol, setBribeSol] = useState('0');
  const [lastQuote, setLastQuote] = useState<{
    side: Side;
    expectedOut: number;
    minOut: number;
    etaMs: number;
  } | null>(null);
  const quickBuy = useTradingStore(s => s.quickBuy);
  const quickSell = useTradingStore(s => s.quickSell);
  const placeQuickLimitOrder = useTradingStore(s => s.placeQuickLimitOrder);
  const quickPositionSummarySelector = useMemo(
    () => selectQuickPositionSummaryByTokenId(token.id, safePrice),
    [safePrice, token.id]
  );
  const quickPositionSummary = useTradingStore(quickPositionSummarySelector);
  const lastExecution = useTradingStore(
    useMemo(
      () => selectLastQuickExecutionByTokenId(token.id),
      [token.id]
    )
  );

  useEffect(() => {
    setLimitPrice(safePrice.toFixed(8));
  }, [safePrice, token.id]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presetValues));
  }, [presetValues]);

  const ctaLabel = useMemo(() => {
    const ticker = token.ticker || 'TOKEN';
    if (orderType === 'limit') {
      return side === 'buy' ? `Place Buy Limit` : `Place Sell Limit`;
    }
    return side === 'buy' ? `Buy ${ticker}` : `Sell ${ticker}`;
  }, [orderType, side, token.ticker]);

  const holdingUsd = quickPositionSummary.holdingUsd;
  const unrealizedUsd = quickPositionSummary.unrealizedUsd;
  const realizedUsd = quickPositionSummary.realizedUsd;
  const totalPnlUsd = quickPositionSummary.totalPnlUsd;
  const openCostUsd = quickPositionSummary.costBasisUsd;
  const totalBoughtUsd = quickPositionSummary.boughtUsd;
  const positionQty = quickPositionSummary.qty;
  const movingPnlPct =
    positionQty > 0 && openCostUsd > 0
      ? (unrealizedUsd / openCostUsd) * 100
      : totalBoughtUsd > 0
        ? (totalPnlUsd / totalBoughtUsd) * 100
        : 0;
  const formatByUnit = (usd: number): string =>
    statUnit === 'usd' ? fmtUsd(usd) : fmtSol(usdToSol(usd));

  const handleSubmit = () => {
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setLastQuote(null);
      setStatusText('Invalid amount');
      return;
    }
    const parsedSlippage = Number(slippagePct);
    if (!Number.isFinite(parsedSlippage) || parsedSlippage < 0) {
      setLastQuote(null);
      setStatusText('Invalid slippage');
      return;
    }
    const parsedPriority = Number(prioritySol);
    if (!Number.isFinite(parsedPriority) || parsedPriority < 0) {
      setLastQuote(null);
      setStatusText('Invalid priority');
      return;
    }
    const parsedBribe = Number(bribeSol);
    if (!Number.isFinite(parsedBribe) || parsedBribe < 0) {
      setLastQuote(null);
      setStatusText('Invalid bribe');
      return;
    }
    if (orderType === 'limit') {
      const parsedLimitPrice = Number(limitPrice);
      if (!Number.isFinite(parsedLimitPrice) || parsedLimitPrice <= 0) {
        setLastQuote(null);
        setStatusText('Invalid limit price');
        return;
      }
      const limitResult = placeQuickLimitOrder(token.id, side, parsedAmount, parsedLimitPrice, {
        slippagePct: parsedSlippage,
        prioritySol: parsedPriority,
        bribeSol: parsedBribe,
      });
      if (!limitResult.ok) {
        setLastQuote(null);
        setStatusText(limitResult.reason ?? 'Limit rejected');
        return;
      }
      setLastQuote(null);
      setStatusText(`Limit order placed @ ${fmtPriceUsd(parsedLimitPrice)}`);
      return;
    }
    const result = side === 'buy'
      ? quickBuy(token.id, parsedAmount, { slippagePct: parsedSlippage, prioritySol: parsedPriority, bribeSol: parsedBribe })
      : quickSell(token.id, parsedAmount, { slippagePct: parsedSlippage, prioritySol: parsedPriority, bribeSol: parsedBribe });
    if (!result.ok) {
      setLastQuote(null);
      setStatusText(result.reason ?? 'Trade rejected');
      return;
    }
    const etaMs = Number.isFinite(result.etaMs) ? (result.etaMs as number) : 0;
    setStatusText(`Order submitted (${Math.max(0, Math.round(etaMs))} ms)`);
    if (Number.isFinite(result.expectedOut) && Number.isFinite(result.minOut)) {
      setLastQuote({
        side,
        expectedOut: result.expectedOut as number,
        minOut: result.minOut as number,
        etaMs,
      });
    } else {
      setLastQuote(null);
    }
  };

  useEffect(() => {
    const target = Number.isFinite(movingPnlPct) ? movingPnlPct : 0;
    if (pctAnimRef.current != null) {
      cancelAnimationFrame(pctAnimRef.current);
      pctAnimRef.current = null;
    }
    const start = pctValueRef.current;
    const delta = target - start;
    if (Math.abs(delta) < 0.005) {
      pctValueRef.current = target;
      setDisplayMovingPnlPct(target);
      return;
    }

    const durationMs = 420;
    const startTs = performance.now();

    const tick = (ts: number) => {
      const t = Math.min(1, (ts - startTs) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = start + delta * eased;
      pctValueRef.current = next;
      setDisplayMovingPnlPct(next);
      if (t < 1) {
        pctAnimRef.current = requestAnimationFrame(tick);
      } else {
        pctAnimRef.current = null;
      }
    };

    pctAnimRef.current = requestAnimationFrame(tick);
    return () => {
      if (pctAnimRef.current != null) {
        cancelAnimationFrame(pctAnimRef.current);
        pctAnimRef.current = null;
      }
    };
  }, [movingPnlPct]);

  return (
    <aside className={floating ? 'w-full bg-transparent' : 'w-full xl:w-[300px] 2xl:w-[326px] shrink-0 border-l border-ax-border bg-ax-surface'}>
      <div className="p-3 space-y-3">
        <div className="flex rounded-md border border-ax-border overflow-hidden">
          <button
            onClick={() => setSide('buy')}
            className={[
              'flex-1 py-2 text-xs font-semibold transition-colors',
              side === 'buy' ? 'bg-ax-green text-ax-bg' : 'text-ax-text-dim hover:text-ax-text',
            ].join(' ')}
          >
            Buy
          </button>
          <button
            onClick={() => setSide('sell')}
            className={[
              'flex-1 py-2 text-xs font-semibold transition-colors',
              side === 'sell' ? 'bg-ax-red text-white' : 'text-ax-text-dim hover:text-ax-text',
            ].join(' ')}
          >
            Sell
          </button>
        </div>

        <div className="rounded-md border border-ax-border bg-ax-bg/70 p-2 space-y-2">
          <div className="flex items-center justify-between text-[10px]">
            <div className="flex gap-1">
              <button
                onClick={() => setOrderType('market')}
                className={orderType === 'market' ? 'text-ax-text font-semibold' : 'text-ax-text-dim'}
              >
                Market
              </button>
              <button
                onClick={() => setOrderType('limit')}
                className={orderType === 'limit' ? 'text-ax-text font-semibold' : 'text-ax-text-dim'}
              >
                Limit
              </button>
              <span className="text-ax-text-dim">Adv.</span>
            </div>
            <span className="text-ax-text-dim">1 SOL = $150</span>
          </div>

          <div className="space-y-1">
            <label className="block text-[10px] text-ax-text-dim">Amount (SOL)</label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full h-8 rounded border border-ax-border bg-ax-surface2 px-2 text-xs outline-none focus:border-ax-green"
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <label className="block text-[10px] text-ax-text-dim">Slippage %</label>
              <input
                value={slippagePct}
                onChange={(e) => setSlippagePct(e.target.value)}
                className="w-full h-8 rounded border border-ax-border bg-ax-surface2 px-2 text-xs outline-none focus:border-ax-green"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-[10px] text-ax-text-dim">Priority (SOL)</label>
              <input
                value={prioritySol}
                onChange={(e) => setPrioritySol(e.target.value)}
                className="w-full h-8 rounded border border-ax-border bg-ax-surface2 px-2 text-xs outline-none focus:border-ax-green"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-[10px] text-ax-text-dim">Bribe (SOL)</label>
              <input
                value={bribeSol}
                onChange={(e) => setBribeSol(e.target.value)}
                className="w-full h-8 rounded border border-ax-border bg-ax-surface2 px-2 text-xs outline-none focus:border-ax-green"
              />
            </div>
          </div>

          {orderType === 'limit' && (
            <div className="space-y-1">
              <label className="block text-[10px] text-ax-text-dim">Limit Price (USD)</label>
              <input
                value={limitPrice}
                onChange={(e) => setLimitPrice(e.target.value)}
                className="w-full h-8 rounded border border-ax-border bg-ax-surface2 px-2 text-xs outline-none focus:border-ax-green"
              />
            </div>
          )}

          <div className="grid grid-cols-4 gap-1">
            {presetValues.map((value, idx) => (
              <div key={idx}>
                {editingPresets ? (
                  <input
                    value={value}
                    onChange={(e) => {
                      const next = [...presetValues];
                      next[idx] = e.target.value;
                      setPresetValues(next);
                    }}
                    onBlur={() => {
                      setPresetValues((current) => {
                        const next = [...current];
                        next[idx] = normalizePresetValue(current[idx] ?? '') ?? DEFAULT_PRESETS[idx]!;
                        return next;
                      });
                    }}
                    className="h-7 w-full rounded border border-ax-green/40 bg-ax-surface2 px-1.5 text-[11px] text-ax-green outline-none focus:border-ax-green"
                  />
                ) : (
                  <button
                    onClick={() => setAmount(value)}
                    className="h-7 w-full rounded border border-ax-green/40 bg-ax-green-dim text-[11px] text-ax-green"
                  >
                    {value}
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="flex justify-end">
            <button
              onClick={() => {
                if (editingPresets) {
                  setPresetValues((current) =>
                    current.map((value, idx) => normalizePresetValue(value) ?? DEFAULT_PRESETS[idx]!)
                  );
                }
                setEditingPresets((v) => !v);
              }}
              className={[
                'inline-flex h-6 items-center gap-1 rounded border px-2 text-[10px] transition-colors',
                editingPresets
                  ? 'border-ax-green/60 text-ax-green bg-ax-green-dim'
                  : 'border-ax-border text-ax-text-dim hover:text-ax-text',
              ].join(' ')}
              title="Edit quick amount values"
            >
              <Pencil size={11} />
              {editingPresets ? 'Done' : 'Edit'}
            </button>
          </div>

          <label className="flex items-center gap-2 text-[11px] text-ax-text-dim">
            <input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} />
            Advanced Trading Strategy
          </label>
        </div>

        <button
          onClick={handleSubmit}
          className={[
            'w-full h-11 rounded-full font-bold text-sm',
            side === 'buy' ? 'bg-ax-green text-ax-bg' : 'bg-ax-red text-white',
          ].join(' ')}
        >
          {ctaLabel}
        </button>
        {statusText && (
          <div className="text-[11px] text-ax-text-dim px-1">{statusText}</div>
        )}
        {lastQuote && (
          <div className="grid grid-cols-2 gap-2 text-[11px] px-1">
            <div className="rounded border border-ax-border bg-ax-bg/70 p-1.5">
              <div className="text-ax-text-dim">Expected Out</div>
              <div className="text-ax-text font-medium">
                {lastQuote.side === 'buy'
                  ? `${fmtQty(lastQuote.expectedOut)} ${token.ticker}`
                  : fmtSol(lastQuote.expectedOut)}
              </div>
            </div>
            <div className="rounded border border-ax-border bg-ax-bg/70 p-1.5">
              <div className="text-ax-text-dim">Min Out</div>
              <div className="text-ax-text font-medium">
                {lastQuote.side === 'buy'
                  ? `${fmtQty(lastQuote.minOut)} ${token.ticker}`
                  : fmtSol(lastQuote.minOut)}
              </div>
            </div>
          </div>
        )}
        {lastExecution && (
          <div className="grid grid-cols-2 gap-2 text-[11px] px-1">
            <div className="rounded border border-ax-border bg-ax-bg/70 p-1.5">
              <div className="text-ax-text-dim">Status</div>
              <div className={lastExecution.status === 'filled' ? 'text-ax-green font-medium' : 'text-ax-red font-medium'}>
                {lastExecution.status === 'filled' ? 'Filled' : `Failed${lastExecution.reason ? `: ${lastExecution.reason}` : ''}`}
              </div>
            </div>
            <div className="rounded border border-ax-border bg-ax-bg/70 p-1.5">
              <div className="text-ax-text-dim">Actual Out</div>
              <div className="text-ax-text font-medium">
                {lastExecution.side === 'buy'
                  ? `${fmtQty(lastExecution.actualOut)} ${token.ticker}`
                  : fmtSol(lastExecution.actualOut)}
              </div>
            </div>
            {lastExecution.status === 'filled' && (
              <>
                <div className="rounded border border-ax-border bg-ax-bg/70 p-1.5">
                  <div className="text-ax-text-dim">Avg Price</div>
                  <div className="text-ax-text font-medium">{fmtPriceUsd(lastExecution.avgPriceUsd ?? 0)}</div>
                </div>
                <div className="rounded border border-ax-border bg-ax-bg/70 p-1.5">
                  <div className="text-ax-text-dim">Impact</div>
                  <div className={(lastExecution.impactPct ?? 0) >= 0 ? 'text-ax-green font-medium' : 'text-ax-red font-medium'}>
                    {fmtSignedPct(lastExecution.impactPct ?? 0)}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        <div className="grid grid-cols-4 gap-2 text-[11px]">
          <MiniStat label="Bought" value={formatByUnit(quickPositionSummary.boughtUsd)} />
          <MiniStat label="Sold" value={formatByUnit(quickPositionSummary.soldUsd)} />
          <MiniStat label="Holding" value={formatByUnit(holdingUsd)} />
          <MiniStat
            label={(
              <span className="inline-flex items-center gap-1">
                <span>PnL</span>
                <button
                  type="button"
                  onClick={() => setStatUnit((u) => (u === 'usd' ? 'sol' : 'usd'))}
                  title={statUnit === 'usd' ? 'Switch to SOL' : 'Switch to USD'}
                  className="inline-flex h-3.5 w-3.5 items-center justify-center rounded text-ax-green hover:bg-ax-green-dim"
                >
                  <RefreshCcw size={10} />
                </button>
              </span>
            )}
            value={`${totalPnlUsd >= 0 ? '+' : '-'}${formatByUnit(Math.abs(totalPnlUsd))} (${fmtSignedPct(displayMovingPnlPct)})`}
            good={totalPnlUsd >= 0}
          />
        </div>

        <div className="rounded-md border border-ax-border bg-ax-bg/70 p-2">
          <div className="text-xs font-semibold text-ax-text mb-2">Token Info</div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <MetricCard label="Top 10 H." value={`${token.metrics.topHoldersPct}%`} warn={token.metrics.topHoldersPct > 35} />
            <MetricCard label="Dev H." value={`${token.metrics.devHoldingsPct}%`} />
            <MetricCard label="Snipers H." value={`${token.metrics.snipersPct}%`} warn={token.metrics.snipersPct > 20} />
            <MetricCard label="Bundlers" value={`${token.metrics.bundlersPct}%`} warn={token.metrics.bundlersPct > 25} />
            <MetricCard label="Insiders" value={`${token.metrics.insidersPct}%`} />
            <MetricCard label="LP Burned" value={`${token.metrics.lpBurnedPct}%`} good={token.metrics.lpBurnedPct >= 90} />
          </div>
        </div>

        <div className="rounded-md border border-ax-border bg-ax-bg/70 p-2 text-[11px] text-ax-text-dim">
          <div className="flex justify-between"><span>5m Vol</span><span className="text-ax-text">{fmtUsd(token.vol5mUsd)}</span></div>
          <div className="flex justify-between"><span>Buys</span><span className="text-ax-green">{token.buys5m}</span></div>
          <div className="flex justify-between"><span>Sells</span><span className="text-ax-red">{token.sells5m}</span></div>
        </div>
      </div>
    </aside>
  );
}

function MiniStat({ label, value, good }: { label: ReactNode; value: string; good?: boolean }) {
  return (
    <div className="rounded border border-ax-border bg-ax-bg/70 p-1.5">
      <div className="text-ax-text-dim">{label}</div>
      <div className={good ? 'text-ax-green font-semibold' : 'text-ax-text'}>{value}</div>
    </div>
  );
}

function MetricCard({ label, value, warn, good }: { label: string; value: string; warn?: boolean; good?: boolean }) {
  return (
    <div className="rounded border border-ax-border bg-ax-surface2 px-2 py-1.5">
      <div className={good ? 'text-ax-green font-semibold' : warn ? 'text-ax-red font-semibold' : 'text-ax-text'}>
        {value}
      </div>
      <div className="text-ax-text-dim">{label}</div>
    </div>
  );
}
