import type { ReactNode } from 'react';
import { RefreshCcw } from 'lucide-react';
import type { QuickTradingUiState } from '../../store/tradingStore';
import {
  fmtSignedPct,
  formatMoneyByUnit,
  formatSignedMoneyByUnit,
  statTone,
  type TradingStatUnit,
} from './tradingUiFormatters';

function lifecycleLabel(uiState: QuickTradingUiState): string {
  if (uiState.lifecycleState === 'open') return 'Open Position';
  if (uiState.lifecycleState === 'closed') return 'Closed History';
  if (uiState.hasOpenLimitOrders || uiState.hasPendingOrders) return 'Orders Only';
  return 'No Position';
}

function executionLabel(uiState: QuickTradingUiState): string {
  if (!uiState.lastExecution) return 'No execution';
  return uiState.lastExecution.status === 'filled' ? 'Last execution filled' : 'Last execution failed';
}

function executionTone(uiState: QuickTradingUiState): string {
  if (!uiState.lastExecution) return 'text-ax-text-dim border-ax-border bg-ax-surface';
  return uiState.lastExecution.status === 'filled'
    ? 'text-ax-green border-ax-green/30 bg-ax-green/10'
    : 'text-ax-red border-ax-red/30 bg-ax-red/10';
}

export function TradingStateSummary({
  uiState,
  unit,
  compact = false,
  onToggleUnit,
}: {
  uiState: QuickTradingUiState;
  unit: TradingStatUnit;
  compact?: boolean;
  onToggleUnit?: () => void;
}) {
  const summary = uiState.summary;
  const pnlPct = summary.boughtUsd > 0 ? (summary.totalPnlUsd / summary.boughtUsd) * 100 : 0;
  const gridClass = compact ? 'grid grid-cols-3 gap-2 text-[11px]' : 'grid grid-cols-2 gap-2 text-[11px]';
  const valueClass = compact ? 'mt-1 text-[11px] font-semibold' : 'mt-1 text-[12px] font-semibold';

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[10px]">
        <span className="rounded-full border border-ax-border bg-ax-surface px-2 py-0.5 text-ax-text-dim">
          {lifecycleLabel(uiState)}
        </span>
        {uiState.hasOpenLimitOrders && (
          <span className="rounded-full border border-[#7ea2ff33] bg-[#7ea2ff12] px-2 py-0.5 text-[#7ea2ff]">
            {uiState.openLimitCount} open limit{uiState.openLimitCount === 1 ? '' : 's'}
          </span>
        )}
        {uiState.hasPendingOrders && (
          <span className="rounded-full border border-[#f5c54233] bg-[#f5c54212] px-2 py-0.5 text-[#f5c542]">
            {uiState.pendingOrderCount} pending
          </span>
        )}
        <span className={`rounded-full border px-2 py-0.5 ${executionTone(uiState)}`}>
          {executionLabel(uiState)}
        </span>
        {onToggleUnit && (
          <button
            type="button"
            onClick={onToggleUnit}
            className="ml-auto inline-flex items-center gap-1 rounded border border-ax-border bg-ax-surface px-2 py-0.5 text-ax-text-dim hover:text-ax-text"
          >
            <RefreshCcw size={10} />
            {unit.toUpperCase()}
          </button>
        )}
      </div>

      {uiState.isEmpty ? (
        <div className="rounded-md border border-ax-border bg-ax-bg/60 px-3 py-2 text-[11px] text-ax-text-dim">
          No position, no fills, and no active quick orders for this token yet.
        </div>
      ) : (
        <div className={gridClass}>
          <SummaryCard label="Holding" value={formatMoneyByUnit(summary.holdingUsd, unit)} valueClass={valueClass} />
          <SummaryCard label="Bought" value={formatMoneyByUnit(summary.boughtUsd, unit)} valueClass={valueClass} />
          <SummaryCard label="Sold" value={formatMoneyByUnit(summary.soldUsd, unit)} valueClass={valueClass} />
          <SummaryCard
            label="Realized"
            value={formatSignedMoneyByUnit(summary.realizedUsd, unit)}
            valueClass={`${valueClass} ${statTone(summary.realizedUsd)}`}
          />
          <SummaryCard
            label="Unrealized"
            value={formatSignedMoneyByUnit(summary.unrealizedUsd, unit)}
            valueClass={`${valueClass} ${statTone(summary.unrealizedUsd)}`}
          />
          <SummaryCard
            label={
              <span className="inline-flex items-center gap-1">
                <span>Total PnL</span>
                <span className="text-[10px] text-ax-text-dim">({fmtSignedPct(pnlPct)})</span>
              </span>
            }
            value={formatSignedMoneyByUnit(summary.totalPnlUsd, unit)}
            valueClass={`${valueClass} ${statTone(summary.totalPnlUsd)}`}
          />
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  valueClass,
}: {
  label: ReactNode;
  value: string;
  valueClass: string;
}) {
  return (
    <div className="rounded border border-ax-border bg-ax-bg/70 p-1.5">
      <div className="text-ax-text-dim">{label}</div>
      <div className={valueClass}>{value}</div>
    </div>
  );
}
