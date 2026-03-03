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

type IntensityScale = {
  count: number;
  maxAmountUsd: number;
  logP50: number;
  logDen: number;
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

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const t = pos - lo;
  const loV = sorted[lo]!;
  const hiV = sorted[hi]!;
  return loV + (hiV - loV) * t;
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
  const activeRows = pauseOnHover && frozenRows ? frozenRows : liveRows;

  const rows = useMemo(() => {
    const sorted = activeRows.slice().sort((a, b) => (
      ageSortDir === 'desc' ? a.tMs - b.tMs : b.tMs - a.tMs
    ));
    return sorted.slice(0, 400);
  }, [activeRows, ageSortDir]);
  const intensityScale = useMemo<IntensityScale>(() => {
    const windowRows = activeRows.slice(0, 200);
    const amounts = windowRows
      .map((r) => r.amountUsd)
      .filter((v) => Number.isFinite(v) && v > 0)
      .sort((a, b) => a - b);

    if (amounts.length === 0) {
      return {
        count: 0,
        maxAmountUsd: 1,
        logP50: 0,
        logDen: 1,
      };
    }

    const maxAmountUsd = amounts[amounts.length - 1]!;
    const p50 = Math.max(1e-9, quantile(amounts, 0.5));
    const rawP95 = Math.max(p50 * 1.01, quantile(amounts, 0.95));
    const logP50 = Math.log10(p50);
    const logDen = Math.max(0.05, Math.log10(rawP95) - logP50);

    return {
      count: amounts.length,
      maxAmountUsd,
      logP50,
      logDen,
    };
  }, [activeRows]);

  const tradeIntensity = (amountUsd: number): number => {
    const safeAmount = Math.max(1e-9, Number.isFinite(amountUsd) ? amountUsd : 0);
    if (intensityScale.count < 20) {
      return clamp01(Math.pow(safeAmount / Math.max(1, intensityScale.maxAmountUsd), 0.65));
    }
    const tLog = (Math.log10(safeAmount) - intensityScale.logP50) / intensityScale.logDen;
    return clamp01(tLog);
  };

  const rowVisual = (tr: PanelTradeRow): { background: string; blurPx: number; widthPct: number } => {
    const t = tradeIntensity(tr.amountUsd);
    const alpha = 0.18;
    const blurPx = 6;
    const widthPct = 10 + t * 90;
    if (tr.side === 'BUY') {
      return {
        background: `linear-gradient(90deg, rgba(0,212,161,${alpha}) 0%, rgba(0,212,161,${alpha * 0.65}) 70%, rgba(0,212,161,0) 100%)`,
        blurPx,
        widthPct,
      };
    }
    return {
      background: `linear-gradient(90deg, rgba(255,77,106,${alpha}) 0%, rgba(255,77,106,${alpha * 0.65}) 70%, rgba(255,77,106,0) 100%)`,
      blurPx,
      widthPct,
    };
  };

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
          rows.map((tr) => {
            const visual = rowVisual(tr);
            return (
              <div key={tr.id} className="relative isolate overflow-hidden border-b border-ax-border/20">
                <div
                  className="pointer-events-none absolute inset-0"
                  style={{
                    background: visual.background,
                    filter: `blur(${visual.blurPx}px)`,
                    transform: 'scale(1.02)',
                    width: `${visual.widthPct}%`,
                  }}
                />
                <div className="relative z-10 grid grid-cols-[72px_72px_1fr_48px] gap-2 py-0.5">
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
              </div>
            );
          })
        )}
      </div>
      {pauseOnHover && (
        <div className="h-6 border-t border-[#2f5bff66] bg-[#0d1326b8] backdrop-blur-md px-2.5 text-[11px] text-[#5f86ff] flex items-center justify-center shadow-[0_-8px_18px_rgba(18,33,66,0.45)]">
          || Paused
        </div>
      )}
    </aside>
  );
}
