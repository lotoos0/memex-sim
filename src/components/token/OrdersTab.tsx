import { useMemo } from 'react';
import { ListOrdered } from 'lucide-react';
import {
  selectQuickOrderPanelStateByTokenId,
  useTradingStore,
  type QuickLimitOrder,
  type QuickOrderAuditRow,
  type QuickPendingOrder,
} from '../../store/tradingStore';
import { usdToSol } from '../../store/walletStore';

type DisplayUnit = 'usd' | 'sol';
type AuditStatus = QuickOrderAuditRow['status'];

type GroupedAuditBlock = {
  limitOrderId: string;
  side: QuickOrderAuditRow['side'];
  requestedAmountSol: number;
  requestedTokenQty: number;
  limitPriceUsd: number;
  finalStatus: AuditStatus;
  latestTsMs: number;
  rows: QuickOrderAuditRow[];
};

const AUDIT_STATUS_ORDER: Record<AuditStatus, number> = {
  open: 0,
  triggered: 1,
  filled: 2,
  failed: 2,
  cancelled: 2,
};

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

function fmtTs(tsMs: number): string {
  if (!Number.isFinite(tsMs) || tsMs <= 0) return '-';
  return new Date(tsMs).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function fmtLimitPrice(limitPriceUsd: number): string {
  if (!Number.isFinite(limitPriceUsd) || limitPriceUsd <= 0) return '-';
  return limitPriceUsd >= 1 ? `$${limitPriceUsd.toFixed(4)}` : `$${limitPriceUsd.toExponential(4)}`;
}

function fmtRequested(row: Pick<QuickOrderAuditRow, 'side' | 'requestedAmountSol' | 'requestedTokenQty'>): string {
  return row.side === 'buy' ? `${fmtSol(row.requestedAmountSol)} SOL` : fmtQty(row.requestedTokenQty);
}

function statusClass(status: 'pending' | 'filled' | 'failed' | 'open' | 'cancelled' | 'triggered'): string {
  if (status === 'filled') return 'text-ax-green';
  if (status === 'failed') return 'text-ax-red';
  if (status === 'cancelled') return 'text-ax-text-dim';
  if (status === 'triggered') return 'text-[#7ea2ff]';
  if (status === 'open') return 'text-[#8ea0bf]';
  return 'text-[#7ea2ff]';
}

function statusChipClass(status: 'pending' | 'filled' | 'failed' | 'open' | 'cancelled' | 'triggered'): string {
  const base = 'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide';
  if (status === 'filled') return `${base} border-ax-green/30 bg-ax-green/10 text-ax-green`;
  if (status === 'failed') return `${base} border-ax-red/30 bg-ax-red/10 text-ax-red`;
  if (status === 'cancelled') return `${base} border-ax-border bg-ax-surface text-ax-text-dim`;
  if (status === 'triggered') return `${base} border-[#7ea2ff]/30 bg-[#7ea2ff]/10 text-[#7ea2ff]`;
  if (status === 'open') return `${base} border-ax-border bg-ax-surface text-[#8ea0bf]`;
  return `${base} border-[#7ea2ff]/30 bg-[#7ea2ff]/10 text-[#7ea2ff]`;
}

function getFinalAuditStatus(rows: QuickOrderAuditRow[]): AuditStatus {
  return [...rows].sort((a, b) => {
    const orderDelta = AUDIT_STATUS_ORDER[a.status] - AUDIT_STATUS_ORDER[b.status];
    if (orderDelta !== 0) return orderDelta;
    return a.tsMs - b.tsMs;
  })[rows.length - 1]?.status ?? 'open';
}

function groupAuditRows(rows: QuickOrderAuditRow[]): GroupedAuditBlock[] {
  const groups = new Map<string, QuickOrderAuditRow[]>();
  for (const row of rows) {
    const key = row.limitOrderId || row.id;
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  return Array.from(groups.entries())
    .map(([limitOrderId, groupRows]) => {
      const orderedRows = [...groupRows].sort((a, b) => {
        const orderDelta = AUDIT_STATUS_ORDER[a.status] - AUDIT_STATUS_ORDER[b.status];
        if (orderDelta !== 0) return orderDelta;
        return a.tsMs - b.tsMs;
      });
      const baseRow = orderedRows.find((row) => row.status === 'open') ?? orderedRows[0];
      const latestTsMs = orderedRows.reduce((maxTs, row) => Math.max(maxTs, row.tsMs), 0);
      return {
        limitOrderId,
        side: baseRow.side,
        requestedAmountSol: baseRow.requestedAmountSol,
        requestedTokenQty: baseRow.requestedTokenQty,
        limitPriceUsd: baseRow.limitPriceUsd,
        finalStatus: getFinalAuditStatus(orderedRows),
        latestTsMs,
        rows: orderedRows,
      };
    })
    .sort((a, b) => b.latestTsMs - a.latestTsMs);
}

export default function OrdersTab({ tokenId, displayUnit }: Props) {
  const panelStateSelector = useMemo(() => selectQuickOrderPanelStateByTokenId(tokenId), [tokenId]);
  const panelState = useTradingStore(panelStateSelector);
  const cancelQuickLimitOrder = useTradingStore((s) => s.cancelQuickLimitOrder);
  const groupedAuditBlocks = useMemo(() => groupAuditRows(panelState.auditRows), [panelState.auditRows]);

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
              <div className="text-[10px] text-ax-text-dim">Quick-native limit lifecycle grouped by order, latest first</div>
            </div>
            <div className="text-[10px] text-ax-text-dim">
              {groupedAuditBlocks.length} orders / {panelState.auditRows.length} events
            </div>
          </div>
          {!panelState.hasAuditHistory ? (
            <div className="px-3 py-4 text-center text-[11px] text-ax-text-dim">No limit lifecycle history yet.</div>
          ) : (
            <div className="space-y-2 px-3 py-2">
              {groupedAuditBlocks.map((block) => (
                <AuditTrailBlock
                  key={block.limitOrderId}
                  block={block}
                  fmtMoney={fmtMoney}
                />
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-ax-border bg-ax-surface2">
          <div className="flex items-center justify-between border-b border-ax-border px-3 py-2">
            <div>
              <div className="text-[12px] font-semibold text-ax-text">Pending Quick Orders</div>
              <div className="text-[10px] text-ax-text-dim">Submitted market or triggered limit executions waiting to settle</div>
            </div>
            <div className="text-[10px] text-ax-text-dim">{panelState.pendingOrders.length} pending</div>
          </div>
          {!panelState.hasPendingOrders ? (
            <div className="px-3 py-4 text-center text-[11px] text-ax-text-dim">No pending quick orders.</div>
          ) : (
            <div className="space-y-1 px-3 py-2">
              <div className="grid grid-cols-[58px_110px_110px_82px_82px_56px] gap-2 border-b border-ax-border pb-1 text-[10px] uppercase tracking-wide text-ax-text-dim">
                <span>Side</span>
                <span>Requested</span>
                <span>Expected</span>
                <span>Status</span>
                <span>ETA</span>
                <span>Age</span>
              </div>
              {panelState.pendingOrders.map((order) => (
                <PendingOrderRow
                  key={order.orderId}
                  order={order}
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

function AuditTrailBlock({
  block,
  fmtMoney,
}: {
  block: GroupedAuditBlock;
  fmtMoney: (usd: number) => string;
}) {
  return (
    <div className="rounded-lg border border-ax-border bg-ax-surface px-3 py-2">
      <div className="grid grid-cols-[56px_120px_110px_120px_1fr_64px] gap-2 border-b border-ax-border/60 pb-2 text-[11px]">
        <div className={block.side === 'buy' ? 'font-semibold text-ax-green' : 'font-semibold text-ax-red'}>
          {block.side.toUpperCase()}
        </div>
        <div className="text-ax-text">
          <div className="text-[10px] uppercase tracking-wide text-ax-text-dim">Requested</div>
          <div>{fmtRequested(block)}</div>
        </div>
        <div className="text-ax-text">
          <div className="text-[10px] uppercase tracking-wide text-ax-text-dim">Limit</div>
          <div>{fmtLimitPrice(block.limitPriceUsd)}</div>
        </div>
        <div className="text-ax-text">
          <div className="text-[10px] uppercase tracking-wide text-ax-text-dim">Final Status</div>
          <div className="mt-0.5">
            <span className={statusChipClass(block.finalStatus)}>{block.finalStatus}</span>
          </div>
        </div>
        <div className="text-ax-text">
          <div className="text-[10px] uppercase tracking-wide text-ax-text-dim">Order</div>
          <div className="font-mono text-[10px] text-ax-text-dim">{block.limitOrderId}</div>
        </div>
        <div className="text-right text-ax-text-dim">
          <div className="text-[10px] uppercase tracking-wide">Age</div>
          <div>{fmtAgo(block.latestTsMs)}</div>
        </div>
      </div>
      <div className="space-y-1 pt-2">
        {block.rows.map((row) => (
          <AuditTrailRow
            key={row.id}
            row={row}
            fmtMoney={fmtMoney}
          />
        ))}
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
  const requested = fmtRequested(row);
  const limit = fmtLimitPrice(row.limitPriceUsd);

  let detailPrimary = 'Limit accepted';
  let detailSecondary = `Fee ${fmtSol(row.txCostSol)} SOL`;

  if (row.status === 'triggered') {
    detailPrimary = `Expected ${fmtQty(row.expectedOut ?? 0)} / Min ${fmtQty(row.minOut ?? 0)}`;
    detailSecondary = row.executionOrderId ? `Exec ${row.executionOrderId}` : detailSecondary;
  } else if (row.status === 'filled') {
    detailPrimary = `Actual ${fmtQty(row.actualOut ?? 0)} / Expected ${fmtQty(row.expectedOut ?? 0)}`;
    detailSecondary = `${Number.isFinite(row.avgPriceUsd) ? fmtMoney(row.avgPriceUsd as number) : '-'} | Fee ${fmtSol(row.txCostSol)} SOL`;
  } else if (row.status === 'failed') {
    detailPrimary = row.reason ?? 'Execution failed';
    detailSecondary = `Expected ${fmtQty(row.expectedOut ?? 0)} / Min ${fmtQty(row.minOut ?? 0)}`;
  } else if (row.status === 'cancelled') {
    detailPrimary = 'Limit cancelled before trigger';
  }

  return (
    <div className="grid grid-cols-[56px_88px_110px_110px_1fr_128px] gap-2 border-b border-ax-border/40 py-1 text-[11px] last:border-b-0">
      <span className={row.side === 'buy' ? 'text-ax-green' : 'text-ax-red'}>{row.side.toUpperCase()}</span>
      <span>
        <span className={statusChipClass(row.status)}>{row.status}</span>
      </span>
      <span className="text-ax-text">{requested}</span>
      <span className="text-ax-text">{limit}</span>
      <span className="text-ax-text">
        <div>{detailPrimary}</div>
        <div className="text-[10px] text-ax-text-dim">{detailSecondary}</div>
      </span>
      <span className="text-right text-ax-text-dim">
        <div>{fmtAgo(row.tsMs)}</div>
        <div className="text-[10px]">{fmtTs(row.tsMs)}</div>
      </span>
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
      <span className="text-ax-text">{fmtLimitPrice(order.limitPriceUsd)}</span>
      <span>
        <span className={statusChipClass('pending')}>OPEN</span>
      </span>
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

function PendingOrderRow({ order }: { order: QuickPendingOrder }) {
  const requested =
    order.side === 'buy'
      ? `${fmtSol(order.sourceRequestedAmountSol ?? order.reservedSol)} SOL`
      : fmtQty(order.sourceRequestedTokenQty ?? order.reservedToken);
  const etaMs = Math.max(0, order.execMs - order.submitMs);

  return (
    <div className="grid grid-cols-[58px_110px_110px_82px_82px_56px] gap-2 border-b border-ax-border/40 py-1 text-[11px]">
      <span className={order.side === 'buy' ? 'text-ax-green' : 'text-ax-red'}>
        {order.side.toUpperCase()}
      </span>
      <span className="text-ax-text">{requested}</span>
      <span className="text-ax-text">
        {order.side === 'buy' ? fmtQty(order.expectedOut) : `${fmtSol(order.expectedOut)} SOL`}
      </span>
      <span>
        <span className={statusChipClass('pending')}>PENDING</span>
      </span>
      <span className="text-ax-text-dim">{Math.round(etaMs)}ms</span>
      <span className="text-ax-text-dim">{fmtAgo(order.submitMs)}</span>
    </div>
  );
}
