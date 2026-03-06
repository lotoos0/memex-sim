import { useMemo } from 'react';
import { Activity, Clock3, Wallet } from 'lucide-react';
import { useTokenStore } from '../../store/tokenStore';
import {
  selectLastQuickExecutionByTokenId,
  selectQuickPositionSummaryByTokenId,
  useTradingStore,
} from '../../store/tradingStore';
import { usdToSol } from '../../store/walletStore';

type DisplayUnit = 'usd' | 'sol';

interface Props {
  tokenId: string;
  displayUnit: DisplayUnit;
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

function fmtPrice(v: number | null | undefined): string {
  if (!Number.isFinite(v ?? NaN) || (v ?? 0) <= 0) return '-';
  const price = v as number;
  if (price >= 1) return `$${price.toFixed(4)}`;
  if (price >= 0.01) return `$${price.toFixed(6)}`;
  return `$${price.toExponential(4)}`;
}

function fmtQty(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '0';
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(2)}K`;
  if (v >= 1) return v.toFixed(3);
  return v.toFixed(6);
}

function fmtAgo(tsMs: number): string {
  if (!Number.isFinite(tsMs) || tsMs <= 0) return '-';
  const dMs = Math.max(0, Date.now() - tsMs);
  if (dMs < 1_000) return `${Math.round(dMs)}ms`;
  if (dMs < 60_000) return `${Math.round(dMs / 1_000)}s`;
  if (dMs < 3_600_000) return `${Math.round(dMs / 60_000)}m`;
  return `${Math.round(dMs / 3_600_000)}h`;
}

function statTone(v: number): string {
  if (!Number.isFinite(v) || Math.abs(v) < 1e-9) return 'text-ax-text';
  return v >= 0 ? 'text-ax-green' : 'text-ax-red';
}

function executionStatusTone(status: 'filled' | 'failed'): string {
  return status === 'filled' ? 'text-ax-green' : 'text-ax-red';
}

export default function PositionsTab({ tokenId, displayUnit }: Props) {
  const token = useTokenStore((s) => s.tokensById[tokenId] ?? null);
  const positionSummarySelector = useMemo(
    () => selectQuickPositionSummaryByTokenId(tokenId, token?.lastPriceUsd ?? 0),
    [token?.lastPriceUsd, tokenId]
  );
  const summary = useTradingStore(positionSummarySelector);
  const lastExecution = useTradingStore(selectLastQuickExecutionByTokenId(tokenId));

  const fmtMoney = (usd: number): string =>
    displayUnit === 'usd' ? fmtUsd(usd) : `${fmtSol(usdToSol(usd))} SOL`;
  const fmtSignedMoney = (usd: number): string => {
    if (!Number.isFinite(usd)) return displayUnit === 'usd' ? '$0' : '0 SOL';
    const sign = usd >= 0 ? '+' : '-';
    return `${sign}${fmtMoney(Math.abs(usd))}`;
  };

  if (!summary.hasOpenPosition && !summary.hasHistory) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="max-w-[420px] rounded-xl border border-ax-border bg-ax-surface2 px-5 py-4 text-center">
          <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full border border-ax-border bg-ax-surface">
            <Wallet size={15} className="text-ax-text-dim" />
          </div>
          <div className="text-sm font-semibold text-ax-text">No quick position yet</div>
          <div className="mt-1 text-[11px] text-ax-text-dim">
            Buy this token once and this tab will show remaining size, PnL and recent fills from quick flow.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto pr-1">
      <div className="space-y-3">
        <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
          <PositionStat
            label={summary.hasOpenPosition ? 'Remaining' : 'Closed Size'}
            value={fmtQty(summary.qty)}
            subValue={summary.hasOpenPosition ? fmtMoney(summary.holdingUsd) : '0'}
          />
          <PositionStat
            label="Avg Buy"
            value={fmtPrice(summary.avgBuyPriceUsd)}
            subValue={summary.boughtUsd ? fmtMoney(summary.boughtUsd) : '-'}
          />
          <PositionStat
            label="Avg Sell"
            value={fmtPrice(summary.avgSellPriceUsd)}
            subValue={summary.soldUsd ? fmtMoney(summary.soldUsd) : '-'}
          />
          <PositionStat
            label="Realized"
            value={fmtSignedMoney(summary.realizedUsd)}
            valueClassName={statTone(summary.realizedUsd)}
            subValue={summary.soldUsd ? `Sold ${fmtMoney(summary.soldUsd)}` : '-'}
          />
          <PositionStat
            label="Unrealized"
            value={fmtSignedMoney(summary.unrealizedUsd)}
            valueClassName={statTone(summary.unrealizedUsd)}
            subValue={summary.hasOpenPosition ? `Cost ${fmtMoney(summary.costBasisUsd)}` : '-'}
          />
          <PositionStat
            label="Total PnL"
            value={fmtSignedMoney(summary.totalPnlUsd)}
            valueClassName={statTone(summary.totalPnlUsd)}
            subValue={summary.updatedAtMs > 0 ? `Updated ${fmtAgo(summary.updatedAtMs)}` : '-'}
          />
        </div>

        <div className="grid gap-3 xl:grid-cols-[1.5fr_1fr]">
          <div className="rounded-xl border border-ax-border bg-ax-surface2">
            <div className="flex items-center justify-between border-b border-ax-border px-3 py-2">
              <div>
                <div className="text-[12px] font-semibold text-ax-text">Recent Fills</div>
                <div className="text-[10px] text-ax-text-dim">Quick executions only</div>
              </div>
              <div className="text-[10px] text-ax-text-dim">{summary.tradesCount} total</div>
            </div>

            {summary.recentFills.length === 0 ? (
              <div className="px-3 py-5 text-center text-[11px] text-ax-text-dim">
                No fills yet.
              </div>
            ) : (
              <div className="space-y-1 px-3 py-2">
                <div className="grid grid-cols-[54px_92px_92px_88px_1fr_50px] gap-2 border-b border-ax-border pb-1 text-[10px] uppercase tracking-wide text-ax-text-dim">
                  <span>Side</span>
                  <span>Qty</span>
                  <span>Price</span>
                  <span>Notional</span>
                  <span>MC</span>
                  <span>Age</span>
                </div>
                {summary.recentFills.map((trade) => (
                  <div
                    key={trade.id}
                    className="grid grid-cols-[54px_92px_92px_88px_1fr_50px] gap-2 border-b border-ax-border/40 py-1 text-[11px]"
                  >
                    <span className={trade.side === 'buy' ? 'text-ax-green' : 'text-ax-red'}>
                      {trade.side.toUpperCase()}
                    </span>
                    <span className="text-ax-text">{fmtQty(trade.qty)}</span>
                    <span className="text-ax-text">{fmtPrice(trade.priceUsd)}</span>
                    <span className="text-ax-text">{fmtMoney(trade.notionalUsd)}</span>
                    <span className="text-ax-text">{fmtMoney(trade.mcapUsd ?? 0)}</span>
                    <span className="text-ax-text-dim">{fmtAgo(trade.tsMs)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="rounded-xl border border-ax-border bg-ax-surface2">
              <div className="flex items-center justify-between border-b border-ax-border px-3 py-2">
                <div>
                  <div className="text-[12px] font-semibold text-ax-text">Execution Snapshot</div>
                  <div className="text-[10px] text-ax-text-dim">Last quick order result</div>
                </div>
                <Activity size={13} className="text-ax-text-dim" />
              </div>
              {lastExecution ? (
                <div className="space-y-2 px-3 py-3 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-ax-text-dim">Status</span>
                    <span className={executionStatusTone(lastExecution.status)}>
                      {lastExecution.status.toUpperCase()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-ax-text-dim">Side</span>
                    <span className={lastExecution.side === 'buy' ? 'text-ax-green' : 'text-ax-red'}>
                      {lastExecution.side.toUpperCase()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-ax-text-dim">Expected Out</span>
                    <span className="text-ax-text">{fmtQty(lastExecution.expectedOut)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-ax-text-dim">Actual Out</span>
                    <span className="text-ax-text">{fmtQty(lastExecution.actualOut)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-ax-text-dim">Avg Price</span>
                    <span className="text-ax-text">{fmtPrice(lastExecution.avgPriceUsd)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-ax-text-dim">Impact</span>
                    <span className="text-ax-text">
                      {Number.isFinite(lastExecution.impactPct) ? `${(lastExecution.impactPct as number).toFixed(2)}%` : '-'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-ax-text-dim">Seen</span>
                    <span className="inline-flex items-center gap-1 text-ax-text-dim">
                      <Clock3 size={11} />
                      {fmtAgo(lastExecution.tsMs)}
                    </span>
                  </div>
                  {lastExecution.reason ? (
                    <div className="rounded-lg border border-ax-border bg-ax-surface px-2 py-1.5 text-[10px] text-ax-text-dim">
                      {lastExecution.reason}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="px-3 py-5 text-center text-[11px] text-ax-text-dim">
                  No execution snapshot yet.
                </div>
              )}
            </div>

            <div className="rounded-xl border border-ax-border bg-ax-surface2 px-3 py-3">
              <div className="text-[12px] font-semibold text-ax-text">
                {summary.hasOpenPosition ? 'Open Position' : 'Closed Summary'}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                <SummaryRow label="Token" value={token?.ticker ?? tokenId} />
                <SummaryRow label="Last Price" value={fmtPrice(token?.lastPriceUsd ?? 0)} />
                <SummaryRow label="Bought" value={fmtMoney(summary.boughtUsd)} />
                <SummaryRow label="Sold" value={fmtMoney(summary.soldUsd)} />
                <SummaryRow label="Cost Basis" value={fmtMoney(summary.costBasisUsd)} />
                <SummaryRow label="Remaining Qty" value={fmtQty(summary.qty)} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PositionStat({
  label,
  value,
  subValue,
  valueClassName,
}: {
  label: string;
  value: string;
  subValue?: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-xl border border-ax-border bg-ax-surface2 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-ax-text-dim">{label}</div>
      <div className={['mt-1 text-[13px] font-semibold', valueClassName ?? 'text-ax-text'].join(' ')}>
        {value}
      </div>
      <div className="mt-1 text-[10px] text-ax-text-dim">{subValue ?? '-'}</div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-ax-border bg-ax-surface px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-ax-text-dim">{label}</div>
      <div className="mt-0.5 text-[11px] font-medium text-ax-text">{value}</div>
    </div>
  );
}
