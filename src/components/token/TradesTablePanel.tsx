import { useMemo, useState } from 'react';
import { Funnel, RefreshCcw, User } from 'lucide-react';
import { useTokenStore } from '../../store/tokenStore';
import { useTradingStore, type QuickTrade } from '../../store/tradingStore';

const SOL_PRICE_USD = 150;
const EMPTY_QUICK_TRADES: QuickTrade[] = [];

interface Props {
  tokenId: string;
}

type PanelTradeRow = {
  id: string;
  tMs: number;
  side: 'BUY' | 'SELL';
  walletId: string;
  amountUsd: number;
  mcapUsd: number;
};

function fmtAmount(v: number): string {
  if (!Number.isFinite(v)) return '0';
  const a = Math.abs(v);
  if (a >= 1e3) return (v / 1e3).toFixed(2) + 'K';
  if (a >= 1) return v.toFixed(3);
  return v.toFixed(4);
}

function fmtUsd(v: number): string {
  if (!Number.isFinite(v)) return '$0';
  const a = Math.abs(v);
  if (a >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
  return '$' + v.toFixed(0);
}

function fmtAgo(tsMs: number): string {
  if (!Number.isFinite(tsMs) || tsMs <= 0) return '-';
  const dMs = Math.max(0, Date.now() - tsMs);
  if (dMs < 60_000) return Math.round(dMs / 1000) + 's';
  if (dMs < 3_600_000) return Math.round(dMs / 60_000) + 'm';
  return Math.round(dMs / 3_600_000) + 'h';
}

function shortWallet(id: string): string {
  if (!id) return '-';
  if (id === 'you') return 'YOU';
  if (id.length <= 8) return id;
  return id.slice(0, 4) + id.slice(-2);
}

export default function TradesTablePanel({ tokenId }: Props) {
  const [showYouOnly, setShowYouOnly] = useState(false);
  const [amountMode, setAmountMode] = useState<'usd' | 'sol'>('usd');
  const [ageSortDir, setAgeSortDir] = useState<'desc' | 'asc'>('asc');
  const [pauseOnHover, setPauseOnHover] = useState(false);
  const [frozenRows, setFrozenRows] = useState<PanelTradeRow[] | null>(null);
  const market = useTokenStore((s) => s.marketByTokenId[tokenId] ?? null);
  const yourTrades = useTradingStore(
    useMemo(
      () => (s: ReturnType<typeof useTradingStore.getState>) => s.quickTradesByTokenId[tokenId] ?? EMPTY_QUICK_TRADES,
      [tokenId]
    )
  );

  const liveRows = useMemo<PanelTradeRow[]>(() => {
    const src = market?.recentTrades ?? [];
    if (showYouOnly) {
      return yourTrades
        .map<PanelTradeRow>((tr) => ({
          id: 'you-' + tr.id,
          tMs: tr.tsMs,
          side: tr.side === 'buy' ? 'BUY' : 'SELL',
          walletId: 'you',
          amountUsd: tr.notionalUsd,
          mcapUsd: tr.mcapUsd ?? 0,
        }))
        .sort((a, b) => b.tMs - a.tMs);
    }
    return src
      .map<PanelTradeRow>((tr) => ({
        id: tr.id,
        tMs: tr.tMs,
        side: tr.side,
        walletId: tr.walletId,
        amountUsd: tr.notionalUsd,
        mcapUsd: tr.mcapUsd,
      }))
      .sort((a, b) => b.tMs - a.tMs);
  }, [market?.recentTrades, showYouOnly, yourTrades]);

  const rows = useMemo(() => {
    const base = pauseOnHover && frozenRows ? frozenRows : liveRows;
    const sorted = base.slice().sort((a, b) => (
      ageSortDir === 'desc' ? a.tMs - b.tMs : b.tMs - a.tMs
    ));
    return sorted.slice(0, 400);
  }, [ageSortDir, frozenRows, liveRows, pauseOnHover]);

  return (
    <aside
      className="hidden xl:flex w-[248px] 2xl:w-[290px] shrink-0 border-l border-ax-border bg-ax-surface2/80 flex-col"
      onMouseEnter={() => {
        setPauseOnHover(true);
        setFrozenRows(liveRows);
      }}
      onMouseLeave={() => {
        setPauseOnHover(false);
        setFrozenRows(null);
      }}
    >
      <div className="h-8 border-b border-ax-border px-2.5 flex items-center gap-2 text-[11px]">
        <button className="inline-flex items-center gap-1 text-ax-text">
          <Funnel size={11} />
          DEV
        </button>
        <button className="inline-flex items-center gap-1 text-ax-text-dim hover:text-ax-text">
          <Funnel size={11} />
          TRACKED
        </button>
        <button
          onClick={() => setShowYouOnly((v) => !v)}
          className={[
            'inline-flex items-center gap-1',
            showYouOnly ? 'text-ax-text' : 'text-ax-text-dim hover:text-ax-text',
          ].join(' ')}
        >
          <User size={11} />
          YOU
        </button>
      </div>

      <div className="grid grid-cols-[72px_72px_1fr_48px] gap-2 px-2.5 py-1 border-b border-ax-border text-[10px] uppercase tracking-wide text-ax-text-dim">
        <button
          type="button"
          onClick={() => setAmountMode((m) => (m === 'usd' ? 'sol' : 'usd'))}
          className="inline-flex items-center gap-1 text-left hover:text-ax-text transition-colors"
          title="Toggle Amount USD/SOL"
        >
          <span>Amount</span>
          <RefreshCcw size={10} />
        </button>
        <span>MC</span>
        <span>Trader</span>
        <button
          type="button"
          onClick={() => setAgeSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
          className="inline-flex items-center gap-1 text-left hover:text-ax-text transition-colors"
          title="Toggle Age Sort"
        >
          <span>Age</span>
          <span>{ageSortDir === 'desc' ? 'v' : '^'}</span>
        </button>
      </div>

      <div className="flex-1 overflow-auto px-2.5 py-1 text-[11px]">
        {rows.length === 0 ? (
          <div className="h-full flex items-center justify-center text-ax-text-dim/70">No trades yet.</div>
        ) : (
          rows.map((tr) => (
            <div key={tr.id} className="grid grid-cols-[72px_72px_1fr_48px] gap-2 py-0.5 border-b border-ax-border/20">
              <span className={tr.side === 'BUY' ? 'text-ax-green' : 'text-ax-red'}>
                {amountMode === 'usd'
                  ? fmtUsd(tr.amountUsd)
                  : fmtAmount(tr.amountUsd / SOL_PRICE_USD) + ' SOL'}
              </span>
              <span className="text-ax-text">{fmtUsd(tr.mcapUsd)}</span>
              <span className={tr.walletId === 'you' ? 'text-ax-yellow' : 'text-ax-text'}>
                {shortWallet(tr.walletId)}
              </span>
              <span className="text-ax-text-dim">{fmtAgo(tr.tMs)}</span>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
