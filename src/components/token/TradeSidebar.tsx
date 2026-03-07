import { useEffect, useMemo, useState } from 'react';
import { Pencil } from 'lucide-react';
import type { TokenState } from '../../tokens/types';
import {
  selectQuickTradingUiStateByTokenId,
  useTradingStore,
} from '../../store/tradingStore';
import {
  TradingStateSummary,
  fmtPriceUsd,
  fmtQty,
  fmtSignedPct,
  sideTone,
  statusTone,
  fmtUsd,
  type TradingStatUnit,
} from './tradingUiShared';

interface Props {
  token: TokenState;
  floating?: boolean;
}

type Side = 'buy' | 'sell';
type OrderType = 'market' | 'limit';

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
    if (next.some((v) => v == null)) return DEFAULT_PRESETS;
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
  const [statUnit, setStatUnit] = useState<TradingStatUnit>('usd');
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
  const quickBuy = useTradingStore((s) => s.quickBuy);
  const quickSell = useTradingStore((s) => s.quickSell);
  const placeQuickLimitOrder = useTradingStore((s) => s.placeQuickLimitOrder);
  const quickTradingUiStateSelector = useMemo(
    () => selectQuickTradingUiStateByTokenId(token.id, safePrice),
    [safePrice, token.id]
  );
  const quickTradingUiState = useTradingStore(quickTradingUiStateSelector);

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
      return side === 'buy' ? 'Place Buy Limit' : 'Place Sell Limit';
    }
    return side === 'buy' ? `Buy ${ticker}` : `Sell ${ticker}`;
  }, [orderType, side, token.ticker]);

  const positionSummary = quickTradingUiState.summary;
  const lastExecution = quickTradingUiState.lastExecution;

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
    const result =
      side === 'buy'
        ? quickBuy(token.id, parsedAmount, {
            slippagePct: parsedSlippage,
            prioritySol: parsedPriority,
            bribeSol: parsedBribe,
          })
        : quickSell(token.id, parsedAmount, {
            slippagePct: parsedSlippage,
            prioritySol: parsedPriority,
            bribeSol: parsedBribe,
          });
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

  return (
    <aside className={floating ? 'w-full bg-transparent' : 'w-full xl:w-[300px] 2xl:w-[326px] shrink-0 border-l border-ax-border bg-ax-surface'}>
      <div className="space-y-3 p-3">
        <div className="flex overflow-hidden rounded-md border border-ax-border">
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

        <div className="space-y-2 rounded-md border border-ax-border bg-ax-bg/70 p-2">
          <div className="flex items-center justify-between text-[10px]">
            <div className="flex gap-2">
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
              className="h-8 w-full rounded border border-ax-border bg-ax-surface2 px-2 text-xs outline-none focus:border-ax-green"
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <label className="block text-[10px] text-ax-text-dim">Slippage %</label>
              <input
                value={slippagePct}
                onChange={(e) => setSlippagePct(e.target.value)}
                className="h-8 w-full rounded border border-ax-border bg-ax-surface2 px-2 text-xs outline-none focus:border-ax-green"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-[10px] text-ax-text-dim">Priority (SOL)</label>
              <input
                value={prioritySol}
                onChange={(e) => setPrioritySol(e.target.value)}
                className="h-8 w-full rounded border border-ax-border bg-ax-surface2 px-2 text-xs outline-none focus:border-ax-green"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-[10px] text-ax-text-dim">Bribe (SOL)</label>
              <input
                value={bribeSol}
                onChange={(e) => setBribeSol(e.target.value)}
                className="h-8 w-full rounded border border-ax-border bg-ax-surface2 px-2 text-xs outline-none focus:border-ax-green"
              />
            </div>
          </div>

          {orderType === 'limit' && (
            <div className="space-y-1">
              <label className="block text-[10px] text-ax-text-dim">Limit Price (USD)</label>
              <input
                value={limitPrice}
                onChange={(e) => setLimitPrice(e.target.value)}
                className="h-8 w-full rounded border border-ax-border bg-ax-surface2 px-2 text-xs outline-none focus:border-ax-green"
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

          <div className="flex justify-between">
            <label className="flex items-center gap-2 text-[11px] text-ax-text-dim">
              <input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} />
              Advanced Trading Strategy
            </label>
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
                  ? 'border-ax-green/60 bg-ax-green-dim text-ax-green'
                  : 'border-ax-border text-ax-text-dim hover:text-ax-text',
              ].join(' ')}
              title="Edit quick amount values"
            >
              <Pencil size={11} />
              {editingPresets ? 'Done' : 'Edit'}
            </button>
          </div>
        </div>

        <button
          onClick={handleSubmit}
          className={[
            'h-11 w-full rounded-full text-sm font-bold',
            side === 'buy' ? 'bg-ax-green text-ax-bg' : 'bg-ax-red text-white',
          ].join(' ')}
        >
          {ctaLabel}
        </button>

        {statusText && <div className="px-1 text-[11px] text-ax-text-dim">{statusText}</div>}

        {lastQuote && (
          <div className="grid grid-cols-2 gap-2 px-1 text-[11px]">
            <div className="rounded border border-ax-border bg-ax-bg/70 p-1.5">
              <div className="text-ax-text-dim">Expected Out</div>
              <div className="font-medium text-ax-text">
                {lastQuote.side === 'buy' ? `${fmtQty(lastQuote.expectedOut)} ${token.ticker}` : `${lastQuote.expectedOut.toFixed(4)} SOL`}
              </div>
            </div>
            <div className="rounded border border-ax-border bg-ax-bg/70 p-1.5">
              <div className="text-ax-text-dim">Min Out</div>
              <div className="font-medium text-ax-text">
                {lastQuote.side === 'buy' ? `${fmtQty(lastQuote.minOut)} ${token.ticker}` : `${lastQuote.minOut.toFixed(4)} SOL`}
              </div>
            </div>
          </div>
        )}

        <TradingStateSummary
          uiState={quickTradingUiState}
          unit={statUnit}
          onToggleUnit={() => setStatUnit((u) => (u === 'usd' ? 'sol' : 'usd'))}
        />

        <div className="grid grid-cols-3 gap-2 text-[11px]">
          <MiniStat label="Remaining Qty" value={fmtQty(positionSummary.qty)} />
          <MiniStat label="Avg Buy" value={fmtPriceUsd(positionSummary.avgBuyPriceUsd)} />
          <MiniStat label="Avg Sell" value={fmtPriceUsd(positionSummary.avgSellPriceUsd)} />
        </div>

        {lastExecution && (
          <div className="grid grid-cols-2 gap-2 px-1 text-[11px]">
            <div className="rounded border border-ax-border bg-ax-bg/70 p-1.5">
              <div className="text-ax-text-dim">Last Execution</div>
              <div className={`${statusTone(lastExecution.status)} font-medium`}>
                {lastExecution.status === 'filled' ? 'Filled' : `Failed${lastExecution.reason ? `: ${lastExecution.reason}` : ''}`}
              </div>
            </div>
            <div className="rounded border border-ax-border bg-ax-bg/70 p-1.5">
              <div className="text-ax-text-dim">Side</div>
              <div className={`${sideTone(lastExecution.side)} font-medium`}>{lastExecution.side.toUpperCase()}</div>
            </div>
            <div className="rounded border border-ax-border bg-ax-bg/70 p-1.5">
              <div className="text-ax-text-dim">Actual Out</div>
              <div className="font-medium text-ax-text">
                {lastExecution.side === 'buy' ? `${fmtQty(lastExecution.actualOut)} ${token.ticker}` : `${lastExecution.actualOut.toFixed(4)} SOL`}
              </div>
            </div>
            <div className="rounded border border-ax-border bg-ax-bg/70 p-1.5">
              <div className="text-ax-text-dim">Impact</div>
              <div className={(lastExecution.impactPct ?? 0) >= 0 ? 'font-medium text-ax-green' : 'font-medium text-ax-red'}>
                {fmtSignedPct(lastExecution.impactPct ?? 0)}
              </div>
            </div>
          </div>
        )}

        <div className="rounded-md border border-ax-border bg-ax-bg/70 p-2">
          <div className="mb-2 text-xs font-semibold text-ax-text">Token Info</div>
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

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-ax-border bg-ax-bg/70 p-1.5">
      <div className="text-ax-text-dim">{label}</div>
      <div className="text-ax-text">{value}</div>
    </div>
  );
}

function MetricCard({ label, value, warn, good }: { label: string; value: string; warn?: boolean; good?: boolean }) {
  return (
    <div className="rounded border border-ax-border bg-ax-surface2 px-2 py-1.5">
      <div className={good ? 'font-semibold text-ax-green' : warn ? 'font-semibold text-ax-red' : 'text-ax-text'}>
        {value}
      </div>
      <div className="text-ax-text-dim">{label}</div>
    </div>
  );
}
