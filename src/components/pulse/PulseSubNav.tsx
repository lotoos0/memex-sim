import { Activity, LineChart, Star } from 'lucide-react';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import HoverTooltip from '../ui/HoverTooltip';
import { useFavoritesStore } from '../../store/favoritesStore';
import { useTradingStore } from '../../store/tradingStore';
import { useTokenStore } from '../../store/tokenStore';

export type PulseView = 'pulse' | 'watchlist' | 'positions';

export function sanitizePulseView(raw: string | null): PulseView {
  if (raw === 'watchlist' || raw === 'positions') return raw;
  return 'pulse';
}

function viewButtonClass(active: boolean): string {
  return [
    'inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors',
    active
      ? 'border-[#4f6dff77] bg-[#4f6dff1f] text-[#8fa2ff]'
      : 'border-ax-border bg-ax-surface2 text-ax-text-dim hover:text-ax-text',
  ].join(' ');
}

export default function PulseSubNav() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = sanitizePulseView(searchParams.get('view'));
  const favoriteCount = useFavoritesStore((s) => s.favoriteIds.length);
  const quickPositionsByTokenId = useTradingStore((s) => s.quickPositionsByTokenId);
  const tokensById = useTokenStore((s) => s.tokensById);
  const positionCount = useMemo(() => {
    const rows = Object.entries(quickPositionsByTokenId);
    let open = 0;
    for (let i = 0; i < rows.length; i++) {
      const [tokenId, position] = rows[i]!;
      if ((position?.qty ?? 0) <= 0) continue;
      const token = tokensById[tokenId];
      if (!token) continue;
      if (token.phase === 'DEAD' || token.phase === 'RUGGED') continue;
      open += 1;
    }
    return open;
  }, [quickPositionsByTokenId, tokensById]);

  const setView = (nextView: PulseView) => {
    const next = new URLSearchParams(searchParams);
    next.set('view', nextView);
    setSearchParams(next, { replace: true });
  };

  const title = useMemo(() => {
    if (view === 'watchlist') return `Watchlist (${favoriteCount})`;
    if (view === 'positions') return `Active Positions (${positionCount})`;
    return 'Pulse';
  }, [favoriteCount, positionCount, view]);

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-ax-border bg-ax-surface2/70 px-2 py-1.5">
      <div className="flex items-center gap-1">
        <HoverTooltip label="Pulse">
          <button
            type="button"
            className={viewButtonClass(view === 'pulse')}
            onClick={() => setView('pulse')}
            aria-label="Pulse"
          >
            <Activity size={14} />
          </button>
        </HoverTooltip>
        <HoverTooltip label={`Active Positions (${positionCount})`}>
          <button
            type="button"
            className={viewButtonClass(view === 'positions')}
            onClick={() => setView('positions')}
            aria-label="Active Positions"
          >
            <LineChart size={14} />
          </button>
        </HoverTooltip>
        <HoverTooltip label={`Watchlist (${favoriteCount})`}>
          <button
            type="button"
            className={viewButtonClass(view === 'watchlist')}
            onClick={() => setView('watchlist')}
            aria-label="Watchlist"
          >
            <Star size={14} />
          </button>
        </HoverTooltip>
      </div>
      <span className="text-[11px] font-medium text-ax-text-dim">{title}</span>
    </div>
  );
}
