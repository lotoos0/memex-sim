import { useEffect, useMemo, useState } from 'react';
import type { TokenState } from '../../tokens/types';
import { useTradingStore } from '../../store/tradingStore';

interface Props {
  token: TokenState;
}

function fmtUsd(v: number): string {
  if (!Number.isFinite(v)) return '$0';
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

type Side = 'buy' | 'sell';
type OrderType = 'market' | 'limit';

export default function TradeSidebar({ token }: Props) {
  const [side, setSide] = useState<Side>('buy');
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [amount, setAmount] = useState('0.10');
  const safePrice = Number.isFinite(token.lastPriceUsd) ? token.lastPriceUsd : 0;
  const [limitPrice, setLimitPrice] = useState(safePrice.toFixed(8));
  const [advanced, setAdvanced] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const quickBuy = useTradingStore(s => s.quickBuy);
  const quickSell = useTradingStore(s => s.quickSell);
  const quickPosition = useTradingStore(
    useMemo(
      () => (s: ReturnType<typeof useTradingStore.getState>) => s.quickPositionsByTokenId[token.id] ?? null,
      [token.id]
    )
  );

  useEffect(() => {
    setLimitPrice(safePrice.toFixed(8));
  }, [safePrice, token.id]);

  const ctaLabel = useMemo(() => {
    const ticker = token.ticker || 'TOKEN';
    return side === 'buy' ? `Buy ${ticker}` : `Sell ${ticker}`;
  }, [side, token.ticker]);

  const holdingUsd = (quickPosition?.qty ?? 0) * safePrice;
  const unrealizedUsd = (quickPosition?.qty ?? 0) > 0
    ? holdingUsd - (quickPosition?.costBasisUsd ?? 0)
    : 0;

  const handleSubmit = () => {
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setStatusText('Invalid amount');
      return;
    }
    if (orderType === 'limit') {
      setStatusText('Limit mode is queued. Use Market for now.');
      return;
    }
    const result = side === 'buy'
      ? quickBuy(token.id, parsedAmount)
      : quickSell(token.id, parsedAmount);
    if (!result.ok) {
      setStatusText(result.reason ?? 'Trade rejected');
      return;
    }
    setStatusText(`${side === 'buy' ? 'Bought' : 'Sold'} ${parsedAmount.toFixed(3)} SOL`);
  };

  return (
    <aside className="w-full xl:w-[326px] shrink-0 border-l border-ax-border bg-ax-surface">
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
            {['0.0155', '0.1111', '0.22', '0.45'].map((v) => (
              <button
                key={v}
                onClick={() => setAmount(v)}
                className="h-7 rounded border border-ax-green/40 bg-ax-green-dim text-[11px] text-ax-green"
              >
                {v}
              </button>
            ))}
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

        <div className="grid grid-cols-4 gap-2 text-[11px]">
          <MiniStat label="Bought" value={fmtUsd(quickPosition?.boughtUsd ?? 0)} />
          <MiniStat label="Sold" value={fmtUsd(quickPosition?.soldUsd ?? 0)} />
          <MiniStat label="Holding" value={fmtUsd(holdingUsd)} />
          <MiniStat
            label="PnL"
            value={`${unrealizedUsd >= 0 ? '+' : '-'}${fmtUsd(Math.abs(unrealizedUsd))}`}
            good={unrealizedUsd >= 0}
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

function MiniStat({ label, value, good }: { label: string; value: string; good?: boolean }) {
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
