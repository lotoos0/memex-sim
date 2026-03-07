import { useMemo } from 'react';
import { ListOrdered } from 'lucide-react';
import {
  selectQuickOrderPanelStateByTokenId,
  useTradingStore,
  type QuickLimitOrder,
  type QuickOrderAuditRow,
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

function statusClass(status: 'pending' | 'filled' | 'failed' | 'open' | 'cancelled' | 'triggered'): string {
  if (status === 'filled') return 'text-ax-green';
  if (status === 'failed') return 'text-ax-red';
  if (status === 'cancelled') return 'text-[#f6c453]';
  if (status === 'triggered') return 'text-[#7ea2ff]';
  if (status === 'open') return 'text-[#8ea0bf]';
  return 'text-[#7ea2ff]';
}

export default function OrdersTab({ tokenId, displayUnit }: Props) {
  const panelStateSelector = useMemo(() => selectQuickOrderPanelStateByTokenId(tokenId), [tokenId]);
  const panelState = useTradingStore(panelStateSelector);
  const cancelQuickLimitOrder = useTradingStore((s) => s.cancelQuickLimitOrder);

  const fmtMoney = (usd: number): string =>
    displayUnit === 'usd' ? fmtUsd(usd) : `${fmtSol(usdToSol(usd))} SOL`;

  if (panelState.isEmpty) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="max-w-[420px] rounded-xl border border-ax-border bg-ax-surface2 px-5 py-4 text-center">
          <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full border border-ax-border bg-ax-surface">
            <ListOrdered size={15} className="text-ax-text-dim" />
          </div>
          <div className="text-sm font-semibold text-ax-text">No active quick orders</div>
          <div className="mt-1 text-[11px] text-ax-text-dim">
            Quick-native limit lifecycle and execution history for this token will show up here.
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
              <div className="text-[12px] font-semibold text-ax-text">Order Audit Trail</div>
              <div className="text-[10px] text-ax-text-dim">Quick-native limit lifecycle, latest first</div>
            </div>
            <div className="text-[10px] text-ax-text-dim">{panelState.auditRows.length} events</div>
          </div>
          {!panelState.hasAuditHistory ? (
            <div className="px-3 py-4 text-center text-[11px] text-ax-text-dim">No limit lifecycle history yet.</div>
          ) : (
            <div className="space-y-1 px-3 py-2">
              <div className="grid grid-cols-[56px_82px_110px_110px_1fr_56px] gap-2 border-b border-ax-border pb-1 text-[10px] uppercase tracking-wide text-ax-text-dim">
                <span>Side</span>
                <span>Status</span>
                <span>Requested</span>
                <span>Limit</span>
                <span>Details</span>
                <span>Age</span>
              </div>
              {panelState.auditRows.map((row) => (
                <AuditTrailRow
                  key={row.id}
                  row={row}
                  fmtMoney={fmtMoney}
                />
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-ax-border bg-ax-surface2">
          <div className="flex items-center justify-between border-b border-ax-border px-3 py-2">
            <div>
              <div className="text-[12px] font-semibold text-ax-text">Open Limit Orders</div>
              <div className="text-[10px] text-ax-text-dim">Active quick-native sim limits</div>
            </div>
            <div className="text-[10px] text-ax-text-dim">{panelState.limitOrders.length} open</div>
          </div>
          {!panelState.hasOpenLimitOrders ? (
            <div className="px-3 py-4 text-center text-[11px] text-ax-text-dim">No open limit orders.</div>
          ) : (
            <div className="space-y-1 px-3 py-2">
              <div className="grid grid-cols-[58px_110px_110px_82px_56px_72px] gap-2 border-b border-ax-border pb-1 text-[10px] uppercase tracking-wide text-ax-text-dim">
                <span>Side</span>
                <span>Requested</span>
                <span>Limit</span>
                <span>Status</span>
                <span>Age</span>
                <span></span>
              </div>
              {panelState.limitOrders.map((order) => (
                <LimitOrderRow
                  key={order.id}
                  order={order}
                  onCancel={() => cancelQuickLimitOrder(order.id)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-ax-border bg-ax-surface2">
          <div className="flex items-center justify-between border-b border-ax-border px-3 py-2">
            <div>
              <div className="text-[12px] font-semibold text-ax-text">Recent Executions</div>
              <div className="text-[10px] text-ax-text-dim">Quick execution notices, kept for raw fill detail</div>
            </div>
            <div className="text-[10px] text-ax-text-dim">{panelState.executions.length} rows</div>
          </div>

          {!panelState.hasExecutionHistory ? (
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
              {panelState.executions.map((execution) => (
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

function AuditTrailRow({
  row,
  fmtMoney,
}: {
  row: QuickOrderAuditRow;
  fmtMoney: (usd: number) => string;
}) {
  const requested = row.side === 'buy'
    ? `${fmtSol(row.requestedAmountSol)} SOL`
    : fmtQty(row.requestedTokenQty);
  const limit = row.limitPriceUsd > 0
    ? (row.limitPriceUsd >= 1 ? `$${row.limitPriceUsd.toFixed(4)}` : `$${row.limitPriceUsd.toExponential(4)}`)
    : '-';

  let detailPrimary = 'Limit accepted';
  let detailSecondary = `Fee ${fmtSol(row.txCostSol)} SOL`;

  if (row.status === 'triggered') {
    detailPrimary = `Expected ${fmtQty(row.expectedOut ?? 0)} / Min ${fmtQty(row.minOut ?? 0)}`;
    detailSecondary = row.executionOrderId ? `Exec ${row.executionOrderId}` : detailSecondary;
  } else if (row.status === 'filled') {
    detailPrimary = `Actual ${fmtQty(row.actualOut ?? 0)} / Expected ${fmtQty(row.expectedOut ?? 0)}`;
    detailSecondary = `${Number.isFinite(row.avgPriceUsd) ? fmtMoney(row.avgPriceUsd as number) : '-'} · Fee ${fmtSol(row.txCostSol)} SOL`;
  } else if (row.status === 'failed') {
    detailPrimary = row.reason ?? 'Execution failed';
    detailSecondary = `Expected ${fmtQty(row.expectedOut ?? 0)} / Min ${fmtQty(row.minOut ?? 0)}`;
  } else if (row.status === 'cancelled') {
    detailPrimary = 'Limit cancelled before trigger';
  }

  return (
    <div className="grid grid-cols-[56px_82px_110px_110px_1fr_56px] gap-2 border-b border-ax-border/40 py-1 text-[11px]">
      <span className={row.side === 'buy' ? 'text-ax-green' : 'text-ax-red'}>
        {row.side.toUpperCase()}
      </span>
      <span className={statusClass(row.status)}>{row.status.toUpperCase()}</span>
      <span className="text-ax-text">{requested}</span>
      <span className="text-ax-text">{limit}</span>
      <span className="text-ax-text">
        <div>{detailPrimary}</div>
        <div className="text-[10px] text-ax-text-dim">{detailSecondary}</div>
      </span>
      <span className="text-ax-text-dim">{fmtAgo(row.tsMs)}</span>
    </div>
  );
}

function LimitOrderRow({ order, onCancel }: { order: QuickLimitOrder; onCancel: () => void }) {
  return (
    <div className="grid grid-cols-[58px_110px_110px_82px_56px_72px] gap-2 border-b border-ax-border/40 py-1 text-[11px]">
      <span className={order.side === 'buy' ? 'text-ax-green' : 'text-ax-red'}>
        {order.side.toUpperCase()}
      </span>
      <span className="text-ax-text">
        {order.side === 'buy' ? `${fmtSol(order.amountSol)} SOL` : fmtQty(order.tokenQty)}
      </span>
      <span className="text-ax-text">
        {order.limitPriceUsd >= 1 ? `$${order.limitPriceUsd.toFixed(4)}` : `$${order.limitPriceUsd.toExponential(4)}`}
      </span>
      <span className={statusClass('pending')}>OPEN</span>
      <span className="text-ax-text-dim">{fmtAgo(order.createdAtMs)}</span>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-ax-border px-2 py-0.5 text-[10px] text-ax-text-dim transition-colors hover:text-ax-text"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
