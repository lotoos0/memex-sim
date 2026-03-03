import HoverTooltip from '../ui/HoverTooltip';
import { getTokenAvatarUrl } from '../../lib/tokenAvatar';

function fmtQty(qty: number | null | undefined): string {
  if (!Number.isFinite(qty) || (qty ?? 0) <= 0) return '--';
  const value = qty as number;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  if (value >= 1) return value.toFixed(2);
  return value.toFixed(4);
}

function fmtPct(pnlPct: number | null | undefined): string {
  if (!Number.isFinite(pnlPct)) return '--';
  const value = pnlPct as number;
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function pnlClass(pnlPct: number | null | undefined): string {
  if (!Number.isFinite(pnlPct)) return 'text-ax-text-dim';
  return (pnlPct as number) >= 0 ? 'text-ax-green' : 'text-ax-red';
}

type SubHeaderTokenPillProps = {
  tokenId: string;
  name: string;
  onClick: () => void;
  remainingQty?: number | null;
  pnlPct?: number | null;
  showPositionMetrics?: boolean;
};

export default function SubHeaderTokenPill({
  tokenId,
  name,
  onClick,
  remainingQty,
  pnlPct,
  showPositionMetrics = false,
}: SubHeaderTokenPillProps) {
  const avatarSrc = getTokenAvatarUrl(tokenId);
  const remaining = fmtQty(remainingQty);
  const pnl = fmtPct(pnlPct);
  const pnlToneClass = pnlClass(pnlPct);

  const tooltipContent = showPositionMetrics ? (
    <div className="grid min-w-[260px] grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-1">
      <img src={avatarSrc} alt={`${name} avatar`} className="h-7 w-7 rounded-md border border-ax-border/80 object-cover" />
      <div className="text-[10px] text-ax-text-dim">Token</div>
      <div className="text-[10px] text-ax-text-dim">Remaining</div>
      <div className="text-[10px] text-ax-text-dim">PnL%</div>
      <div />
      <div className="truncate text-[11px] font-semibold text-ax-text">{name}</div>
      <div className="text-right text-[11px] text-ax-text">{remaining}</div>
      <div className={`text-right text-[11px] font-semibold ${pnlToneClass}`}>{pnl}</div>
    </div>
  ) : (
    <div className="flex items-center gap-2">
      <img src={avatarSrc} alt={`${name} avatar`} className="h-6 w-6 rounded-md border border-ax-border/80 object-cover" />
      <span className="text-[11px] text-ax-text">{name}</span>
    </div>
  );

  return (
    <HoverTooltip content={tooltipContent}>
      <button
        type="button"
        onClick={onClick}
        className={[
          'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-ax-border bg-ax-surface px-2',
          'text-[11px] text-ax-text transition-colors hover:border-[#5d6e95] hover:bg-ax-surface2',
        ].join(' ')}
      >
        <img src={avatarSrc} alt="" className="h-4 w-4 rounded-sm border border-ax-border/80 object-cover" />
        <span className="max-w-[90px] truncate">{name}</span>
        {showPositionMetrics && (
          <>
            <span className="h-3 w-px bg-ax-border" />
            <span className="text-ax-text-dim">{remaining}</span>
            <span className={`font-semibold ${pnlToneClass}`}>{pnl}</span>
          </>
        )}
      </button>
    </HoverTooltip>
  );
}
