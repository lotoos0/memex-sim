import { useEffect, useMemo, useState } from 'react';
import { ArrowUpDown, Table2, Zap } from 'lucide-react';
import { useTokenStore } from '../../store/tokenStore';
import { usdToSol } from '../../store/walletStore';
import TokenFeed from './TokenFeed';
import PositionsTab from './PositionsTab';

const TABS = ['Trades', 'Feed', 'Positions', 'Orders', 'Holders', 'Top Traders', 'Dev Tokens'] as const;
const BOTTOM_TAB_STORAGE_KEY = 'memex:token:bottom-tab:v1';
const BOTTOM_UNIT_STORAGE_KEY = 'memex:token:bottom-unit:v1';

interface Props {
  tokenId: string;
  instantTradeEnabled: boolean;
  onToggleInstantTrade: () => void;
  tradesTableEnabled: boolean;
  onToggleTradesTable: () => void;
}

function fmtUsd(v: number): string {
  if (!Number.isFinite(v)) return '$0';
  const a = Math.abs(v);
  if (a >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
}

function fmtSol(v: number): string {
  if (!Number.isFinite(v)) return '0';
  const a = Math.abs(v);
  if (a >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  if (a >= 1) return v.toFixed(3);
  return v.toFixed(4);
}

function fmtAgo(tsMs: number): string {
  if (!Number.isFinite(tsMs) || tsMs <= 0) return '-';
  const dMs = Math.max(0, Date.now() - tsMs);
  if (dMs < 1_000) return `${Math.round(dMs)}ms`;
  if (dMs < 60_000) return `${Math.round(dMs / 1_000)}s`;
  return `${Math.round(dMs / 60_000)}m`;
}

function shortWallet(id: string): string {
  if (!id) return '-';
  if (id === 'LIQUIDITY POOL') return id;
  if (id.length <= 10) return id;
  return `${id.slice(0, 4)}...${id.slice(-4)}`;
}

function isBottomTab(v: string): v is (typeof TABS)[number] {
  return (TABS as readonly string[]).includes(v);
}

export default function BottomTabs({
  tokenId,
  instantTradeEnabled,
  onToggleInstantTrade,
  tradesTableEnabled,
  onToggleTradesTable,
}: Props) {
  const [active, setActive] = useState<(typeof TABS)[number]>(() => {
    if (typeof window === 'undefined') return 'Positions';
    const raw = window.localStorage.getItem(BOTTOM_TAB_STORAGE_KEY);
    if (!raw) return 'Positions';
    return isBottomTab(raw) ? raw : 'Positions';
  });
  const [pnlMode, setPnlMode] = useState<'unrealized' | 'realized'>('unrealized');
  const [pnlSortDir, setPnlSortDir] = useState<'desc' | 'asc'>('desc');
  const [displayUnit, setDisplayUnit] = useState<'usd' | 'sol'>(() => {
    if (typeof window === 'undefined') return 'usd';
    return window.localStorage.getItem(BOTTOM_UNIT_STORAGE_KEY) === 'sol' ? 'sol' : 'usd';
  });
  const market = useTokenStore((s) => s.marketByTokenId[tokenId] ?? null);

  const fmtMoney = (usd: number): string =>
    displayUnit === 'usd' ? fmtUsd(usd) : `${fmtSol(usdToSol(usd))} SOL`;
  const fmtSignedMoney = (usd: number): string => {
    if (!Number.isFinite(usd)) return displayUnit === 'usd' ? '$0' : '0 SOL';
    const sign = usd >= 0 ? '+' : '-';
    return `${sign}${fmtMoney(Math.abs(usd))}`;
  };

  const topTraders = useMemo(() => {
    const rows = market?.recentTrades ?? [];
    const byWallet = new Map<string, { buyUsd: number; sellUsd: number; trades: number }>();
    for (let i = 0; i < rows.length; i++) {
      const tr = rows[i]!;
      const cur = byWallet.get(tr.walletId) ?? { buyUsd: 0, sellUsd: 0, trades: 0 };
      if (tr.side === 'BUY') cur.buyUsd += tr.notionalUsd;
      else cur.sellUsd += tr.notionalUsd;
      cur.trades += 1;
      byWallet.set(tr.walletId, cur);
    }
    return [...byWallet.entries()]
      .map(([walletId, v]) => ({
        walletId,
        buyUsd: v.buyUsd,
        sellUsd: v.sellUsd,
        netUsd: v.buyUsd - v.sellUsd,
        trades: v.trades,
      }))
      .sort((a, b) => Math.abs(b.netUsd) - Math.abs(a.netUsd))
      .slice(0, 20);
  }, [market?.recentTrades]);

  const holders = market?.topHolders ?? [];
  const trades = market?.recentTrades ?? [];
  const displayHolders = useMemo(() => {
    const dir = pnlSortDir === 'desc' ? -1 : 1;
    return holders.slice().sort((a, b) => {
      if (a.isLiquidityPool && !b.isLiquidityPool) return -1;
      if (!a.isLiquidityPool && b.isLiquidityPool) return 1;
      const aPnl = pnlMode === 'unrealized' ? a.unrealizedPnlUsd : a.realizedPnlUsd;
      const bPnl = pnlMode === 'unrealized' ? b.unrealizedPnlUsd : b.realizedPnlUsd;
      const byPnl = (aPnl - bPnl) * dir;
      if (Math.abs(byPnl) > 1e-9) return byPnl;
      return b.remainingUsd - a.remainingUsd;
    });
  }, [holders, pnlMode, pnlSortDir]);
  const totalPoolTokens = useMemo(
    () => displayHolders.reduce((sum, row) => sum + Math.max(0, row.balanceTokens), 0),
    [displayHolders]
  );
  const holdersTabLabel = `Holders(${market?.holdersCount ?? 0})`;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(BOTTOM_TAB_STORAGE_KEY, active);
  }, [active]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(BOTTOM_UNIT_STORAGE_KEY, displayUnit);
  }, [displayUnit]);

  return (
    <section className="h-[460px] md:h-[520px] border-t border-ax-border bg-ax-surface shrink-0">
      <div className="h-8 border-b border-ax-border px-3 flex items-center gap-4 text-[11px]">
        {TABS.map((tab) => {
          const label = tab === 'Holders' ? holdersTabLabel : tab;
          return (
          <button
            key={tab}
            onClick={() => setActive(tab)}
            className={[
              'h-8 border-b transition-colors',
              active === tab ? 'border-ax-text text-ax-text font-semibold' : 'border-transparent text-ax-text-dim hover:text-ax-text',
            ].join(' ')}
          >
            {label}
          </button>
          );
        })}
        <div className="ml-auto flex items-center">
          <button
            onClick={() => setDisplayUnit((u) => (u === 'usd' ? 'sol' : 'usd'))}
            className="mr-2 inline-flex h-6 items-center gap-1 rounded border border-ax-border px-2.5 text-[11px] text-ax-text-dim transition-colors hover:text-ax-text"
            title="Toggle USD / SOL"
          >
            <ArrowUpDown size={11} />
            {displayUnit === 'usd' ? 'USD' : 'SOL'}
          </button>
          <button
            onClick={onToggleTradesTable}
            className={[
              'mr-2 inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[11px] transition-colors',
              tradesTableEnabled
                ? 'border-[#2f5bff] bg-[#2f5bff1a] text-[#7ea2ff]'
                : 'border-ax-border text-ax-text-dim hover:text-ax-text',
            ].join(' ')}
          >
            <Table2 size={11} />
            Trades Table
          </button>
          <button
            onClick={onToggleInstantTrade}
            className={[
              'inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[11px] transition-colors',
              instantTradeEnabled
                ? 'border-[#2f5bff] bg-[#2f5bff1a] text-[#7ea2ff]'
                : 'border-ax-border text-ax-text-dim hover:text-ax-text',
            ].join(' ')}
          >
            <Zap size={11} />
            Instant Trade
          </button>
        </div>
      </div>

      <div className="h-[calc(100%-32px)] px-3 py-2 text-[11px] text-ax-text-dim">
        {active === 'Trades' && (
          <div className="h-full overflow-auto space-y-1 pr-1">
            <div className="grid grid-cols-[84px_58px_1fr_72px_56px] gap-2 border-b border-ax-border pb-1 text-[10px] uppercase tracking-wide">
              <span>Amount</span>
              <span>Price</span>
              <span>Wallet</span>
              <span>MC</span>
              <span>Age</span>
            </div>
            {trades.length === 0 ? (
              <div className="h-[92px] flex items-center justify-center text-ax-text-dim/80">No simulated trades yet.</div>
            ) : (
              trades.slice(0, 120).map((tr) => (
                <div key={tr.id} className="grid grid-cols-[84px_58px_1fr_72px_56px] gap-2 py-0.5">
                  <span className={tr.side === 'BUY' ? 'text-ax-green' : 'text-ax-red'}>{fmtMoney(tr.notionalUsd)}</span>
                  <span className="text-ax-text">
                    {displayUnit === 'usd' ? `$${tr.priceUsd.toFixed(4)}` : `${fmtSol(usdToSol(tr.priceUsd))} SOL`}
                  </span>
                  <span className="text-ax-text">{shortWallet(tr.walletId)}</span>
                  <span className="text-ax-text">{fmtMoney(tr.mcapUsd)}</span>
                  <span>{fmtAgo(tr.tMs)}</span>
                </div>
              ))
            )}
          </div>
        )}

        {active === 'Feed' && (
          <TokenFeed tokenId={tokenId} />
        )}

        {active === 'Holders' && (
          <div className="h-full overflow-auto pr-1">
            <div className="min-w-[1080px] space-y-1">
              <div className="sticky top-0 z-20 grid grid-cols-[26px_160px_210px_220px_220px_160px_170px_92px] gap-2 border-b border-ax-border bg-ax-surface pb-1 text-[10px] uppercase tracking-wide">
                <span>#</span>
                <span>Wallet</span>
                <span>SOL Balance (Last Active)</span>
                <span>Bought</span>
                <span>Sold</span>
                <span className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPnlMode((m) => (m === 'unrealized' ? 'realized' : 'unrealized'))}
                    className="text-ax-text hover:text-white transition-colors"
                    title="Toggle U.PnL / R.PnL"
                  >
                    {pnlMode === 'unrealized' ? 'U. PnL' : 'R. PnL'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPnlSortDir((s) => (s === 'desc' ? 'asc' : 'desc'))}
                    className="text-ax-text-dim hover:text-ax-text transition-colors"
                    title="Toggle sort direction"
                  >
                    {pnlSortDir === 'desc' ? 'v' : '^'}
                  </button>
                </span>
                <span>Remaining</span>
                <span>Held</span>
              </div>
              <div className="flex items-center justify-between text-[10px] uppercase tracking-wide pb-1 pt-0.5">
                <span className="text-ax-text-dim">Leaderboard</span>
                <span>{market ? `${market.holdersCount} holders` : '0 holders'}</span>
              </div>
              {displayHolders.length === 0 ? (
                <div className="h-[92px] flex items-center justify-center text-ax-text-dim/80">No holders snapshot yet.</div>
              ) : (
                displayHolders.map((h, idx) => {
                  const heldPctRaw = totalPoolTokens > 0
                    ? (h.balanceTokens / totalPoolTokens) * 100
                    : 0;
                  const heldPct = Math.max(0, Math.min(100, heldPctRaw));
                  const pnlValue = pnlMode === 'unrealized' ? h.unrealizedPnlUsd : h.realizedPnlUsd;
                  return (
                    <div
                      key={`${h.walletId}-${idx}`}
                      className="grid grid-cols-[26px_160px_210px_220px_220px_160px_170px_92px] gap-2 py-0.5 border-b border-ax-border/40"
                    >
                      <span className="text-ax-text-dim">{idx + 1}</span>
                      <span className={h.isLiquidityPool ? 'text-ax-text font-semibold' : 'text-ax-text font-medium'}>
                        {shortWallet(h.walletId)}
                      </span>
                      <span className="text-ax-text">
                        <span className="text-ax-text">{fmtSol(h.solBalance)} SOL</span>
                        <span className="text-ax-text-dim"> ({fmtAgo(h.lastActiveMs)})</span>
                      </span>
                      <span className="text-ax-green">
                        {fmtMoney(h.boughtUsd)}
                      </span>
                      <span className="text-ax-red">
                        {fmtMoney(h.soldUsd)}
                      </span>
                      <span className={pnlValue >= 0 ? 'text-ax-green' : 'text-ax-red'}>
                        {fmtSignedMoney(pnlValue)}
                      </span>
                      <span className="text-ax-text">
                        <div className="flex items-center gap-2">
                          <span>{fmtMoney(h.remainingUsd)}</span>
                          <span className="inline-flex rounded border border-ax-border bg-ax-surface2 px-1.5 py-[1px] text-[10px] text-ax-text-dim">
                            {heldPct.toFixed(2)}%
                          </span>
                        </div>
                        <div className="mt-1 h-1 w-full overflow-hidden rounded bg-ax-border/80">
                          <div
                            className="h-full bg-[#4f6dff]"
                            style={{ width: `${heldPct}%` }}
                          />
                        </div>
                      </span>
                      <span className="text-[#5f86ff]">{fmtAgo(h.firstSeenMs)}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {active === 'Top Traders' && (
          <div className="h-full overflow-auto space-y-1 pr-1">
            <div className="grid grid-cols-[1fr_84px_84px_84px_48px] gap-2 border-b border-ax-border pb-1 text-[10px] uppercase tracking-wide">
              <span>Wallet</span>
              <span>Buy</span>
              <span>Sell</span>
              <span>Net</span>
              <span>#</span>
            </div>
            {topTraders.length === 0 ? (
              <div className="h-[92px] flex items-center justify-center text-ax-text-dim/80">No activity yet.</div>
            ) : (
              topTraders.map((tr) => (
                <div key={tr.walletId} className="grid grid-cols-[1fr_84px_84px_84px_48px] gap-2 py-0.5">
                  <span className="text-ax-text">{shortWallet(tr.walletId)}</span>
                  <span className="text-ax-green">{fmtMoney(tr.buyUsd)}</span>
                  <span className="text-ax-red">{fmtMoney(tr.sellUsd)}</span>
                  <span className={tr.netUsd >= 0 ? 'text-ax-green' : 'text-ax-red'}>{fmtSignedMoney(tr.netUsd)}</span>
                  <span className="text-ax-text">{tr.trades}</span>
                </div>
              ))
            )}
          </div>
        )}

        {active === 'Positions' && (
          <PositionsTab tokenId={tokenId} displayUnit={displayUnit} />
        )}

        {(active === 'Orders' || active === 'Dev Tokens') && (
          <div className="h-full flex items-center justify-center text-ax-text-dim/80">
            {active} panel is queued in next slice.
          </div>
        )}
      </div>
    </section>
  );
}
