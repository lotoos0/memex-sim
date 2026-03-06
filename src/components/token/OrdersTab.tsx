import { useMemo } from 'react';
import { Clock3, ListOrdered } from 'lucide-react';
import {
  selectQuickExecutionHistoryByTokenId,
  useTradingStore,
  type QuickPendingOrder,
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

function fmtEta(tsMs: number): string {
  if (!Number.isFinite(tsMs) || tsMs <= 0) return '-';
  const dMs = Math.max(0, tsMs - Date.now());
  if (dMs < 1_000) return `${Math.round(dMs)}ms`;
  return `${Math.round(dMs / 1_000)}s`;
}

function statusClass(status: 'pending' | 'filled' | 'failed'): string {
  if (status === 'filled') return 'text-ax-green';
  if (status === 'failed') return 'text-ax-red';
  return 'text-[#7ea2ff]';
}

export default function OrdersTab({ tokenId, displayUnit }: Props) {
  const pendingById = useTradingStore((s) => s.pendingQuickOrdersById);
  const executionHistory = useTradingStore(selectQuickExecutionHistoryByTokenId(tokenId));

  const fmtMoney = (usd: number): string =>
    displayUnit === 'usd' ? fmtUsd(usd) : `${fmtSol(usdToSol(usd))} SOL`;

  const pendingOrders = useMemo(
    () =>
      Object.values(pendingById)
        .filter((order) => order.tokenId === tokenId)
        .sort((a, b) => b.submitMs - a.submitMs),
    [pendingById, tokenId]
  );

  if (pendingOrders.length === 0 && executionHistory.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="max-w-[420px] rounded-xl border border-ax-border bg-ax-surface2 px-5 py-4 text-center">
          <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full border border-ax-border bg-ax-surface">
            <ListOrdered size={15} className="text-ax-text-dim" />
          </div>
          <div className="text-sm font-semibold text-ax-text">No active quick orders</div>
          <div className="mt-1 text-[11px] text-ax-text-dim">
            Quick market submits and execution attempts for this token will show up here.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto pr-1">
      <div className="space-y-3">
        <div className="rounded-xl border border-ax-border bg-ax-surface2">
          <div className="flex items-center justify-between border-b border-ax-border px-3 py-2">
            <div>
              <div className="text-[12px] font-semibold text-ax-text">Active Quick Orders</div>
              <div className="text-[10px] text-ax-text-dim">Pending submissions only</div>
            </div>
            <div className="text-[10px] text-ax-text-dim">{pendingOrders.length} pending</div>
          </div>
          {pendingOrders.length === 0 ? (
            <div className="px-3 py-4 text-center text-[11px] text-ax-text-dim">No active quick orders.</div>
          ) : (
            <div className="space-y-1 px-3 py-2">
              <div className="grid grid-cols-[58px_110px_110px_110px_76px_54px] gap-2 border-b border-ax-border pb-1 text-[10px] uppercase tracking-wide text-ax-text-dim">
                <span>Side</span>
                <span>Requested</span>
                <span>Expected</span>
                <span>Min Out</span>
                <span>Status</span>
                <span>ETA</span>
              </div>
              {pendingOrders.map((order) => (
                <PendingRow key={order.orderId} order={order} />
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-ax-border bg-ax-surface2">
          <div className="flex items-center justify-between border-b border-ax-border px-3 py-2">
            <div>
              <div className="text-[12px] font-semibold text-ax-text">Recent Executions</div>
              <div className="text-[10px] text-ax-text-dim">Quick execution notices, latest first</div>
            </div>
            <div className="text-[10px] text-ax-text-dim">{executionHistory.length} rows</div>
          </div>

          {executionHistory.length === 0 ? (
            <div className="px-3 py-4 text-center text-[11px] text-ax-text-dim">No execution history yet.</div>
          ) : (
            <div className="space-y-1 px-3 py-2">
              <div className="grid grid-cols-[58px_92px_92px_82px_68px_1fr_56px] gap-2 border-b border-ax-border pb-1 text-[10px] uppercase tracking-wide text-ax-text-dim">
                <span>Side</span>
                <span>Requested</span>
                <span>Actual</span>
                <span>Expected</span>
                <span>Status</span>
                <span>Price / Cost</span>
                <span>Age</span>
              </div>
              {executionHistory
                .slice()
                .reverse()
                .map((execution) => (
                  <div
                    key={`${execution.orderId}-${execution.tsMs}`}
                    className="grid grid-cols-[58px_92px_92px_82px_68px_1fr_56px] gap-2 border-b border-ax-border/40 py-1 text-[11px]"
                  >
                    <span className={execution.side === 'buy' ? 'text-ax-green' : 'text-ax-red'}>
                      {execution.side.toUpperCase()}
                    </span>
                    <span className="text-ax-text">
                      {execution.side === 'buy'
                        ? `${fmtSol(execution.amountIn)} SOL`
                        : fmtQty(execution.amountIn)}
                    </span>
                    <span className="text-ax-text">{fmtQty(execution.actualOut)}</span>
                    <span className="text-ax-text">{fmtQty(execution.expectedOut)}</span>
                    <span className={statusClass(execution.status)}>{execution.status.toUpperCase()}</span>
                    <span className="text-ax-text">
                      <div>{Number.isFinite(execution.avgPriceUsd) ? fmtMoney(execution.avgPriceUsd as number) : '-'}</div>
                      <div className="text-[10px] text-ax-text-dim">Fee {fmtSol(execution.txCostSol)} SOL</div>
                    </span>
                    <span className="text-ax-text-dim">{fmtAgo(execution.tsMs)}</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PendingRow({ order }: { order: QuickPendingOrder }) {
  return (
    <div className="grid grid-cols-[58px_110px_110px_110px_76px_54px] gap-2 border-b border-ax-border/40 py-1 text-[11px]">
      <span className={order.side === 'buy' ? 'text-ax-green' : 'text-ax-red'}>
        {order.side.toUpperCase()}
      </span>
      <span className="text-ax-text">
        {order.side === 'buy' ? `${fmtSol(order.reservedSol)} SOL` : fmtQty(order.reservedToken)}
      </span>
      <span className="text-ax-text">{fmtQty(order.expectedOut)}</span>
      <span className="text-ax-text">{fmtQty(order.minOut)}</span>
      <span className={statusClass('pending')}>PENDING</span>
      <span className="inline-flex items-center gap-1 text-ax-text-dim">
        <Clock3 size={11} />
        {fmtEta(order.execMs)}
      </span>
    </div>
  );
}
