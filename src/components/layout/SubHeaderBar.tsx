import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LineChart, Star } from 'lucide-react';
import HoverTooltip from '../ui/HoverTooltip';
import { useFavoritesStore } from '../../store/favoritesStore';
import { useTokenStore } from '../../store/tokenStore';
import { useTradingStore } from '../../store/tradingStore';
import SubHeaderTokenPill from './SubHeaderTokenPill';

const PREVIEW_LIMIT = 5;

function shortId(id: string): string {
  if (id.length <= 10) return id;
  return `${id.slice(0, 4)}...${id.slice(-4)}`;
}

type SubHeaderMode = 'open' | 'watchlist';

function iconButtonClass(active: boolean): string {
  return [
    'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border transition-colors',
    active
      ? 'border-[#4f6dff77] bg-[#4f6dff1f] text-[#8fa2ff]'
      : 'border-ax-border bg-ax-surface text-ax-text-dim hover:text-ax-text',
  ].join(' ');
}

export default function SubHeaderBar() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<SubHeaderMode>('open');
  const favoriteIds = useFavoritesStore((s) => s.favoriteIds);
  const quickPositionsByTokenId = useTradingStore((s) => s.quickPositionsByTokenId);
  const tokensById = useTokenStore((s) => s.tokensById);
  const setActiveToken = useTokenStore((s) => s.setActiveToken);

  const openTokenIds = useMemo(() => {
    const rows = Object.entries(quickPositionsByTokenId)
      .filter(([tokenId, position]) => {
        if ((position?.qty ?? 0) <= 0) return false;
        const token = tokensById[tokenId];
        if (!token) return false;
        return token.phase !== 'DEAD' && token.phase !== 'RUGGED';
      })
      .sort((a, b) => (b[1]?.updatedAtMs ?? 0) - (a[1]?.updatedAtMs ?? 0));
    return rows.map(([tokenId]) => tokenId);
  }, [quickPositionsByTokenId, tokensById]);

  useEffect(() => {
    if (mode === 'open' && openTokenIds.length === 0 && favoriteIds.length > 0) {
      setMode('watchlist');
      return;
    }
    if (mode === 'watchlist' && favoriteIds.length === 0 && openTokenIds.length > 0) {
      setMode('open');
    }
  }, [favoriteIds.length, mode, openTokenIds.length]);

  const favoritePreviewIds = useMemo(
    () => favoriteIds.slice(0, PREVIEW_LIMIT),
    [favoriteIds]
  );
  const openPreviewIds = useMemo(
    () => openTokenIds.slice(0, PREVIEW_LIMIT),
    [openTokenIds]
  );

  const openToken = (tokenId: string) => {
    if (!tokenId) return;
    setActiveToken(tokenId);
    navigate(`/token/${tokenId}`);
  };

  const openPreview = useMemo(() => {
    return openPreviewIds.map((tokenId) => {
      const token = tokensById[tokenId];
      const position = quickPositionsByTokenId[tokenId];
      const label = token?.ticker || token?.name || shortId(tokenId);
      const avgEntry = position?.avgEntryUsd;
      const markPrice = token?.lastPriceUsd;
      const pnlPct = Number.isFinite(avgEntry) && Number.isFinite(markPrice) && (avgEntry ?? 0) > 0
        ? (((markPrice as number) / (avgEntry as number)) - 1) * 100
        : null;
      return {
        tokenId,
        label,
        qty: position?.qty ?? null,
        pnlPct,
      };
    });
  }, [openPreviewIds, quickPositionsByTokenId, tokensById]);

  const favoritePreview = useMemo(() => {
    return favoritePreviewIds.map((tokenId) => {
      const token = tokensById[tokenId];
      const label = token?.ticker || token?.name || shortId(tokenId);
      return { tokenId, label, qty: null, pnlPct: null };
    });
  }, [favoritePreviewIds, tokensById]);

  const activeLabel = mode === 'open' ? `Active Positions (${openTokenIds.length})` : `Watchlist (${favoriteIds.length})`;
  const activeEmptyLabel = mode === 'open' ? 'No open positions' : 'No favorites yet';
  const activeRows = mode === 'open' ? openPreview : favoritePreview;

  return (
    <div className="sticky top-[60px] z-40 h-10 shrink-0 border-b border-ax-border bg-ax-surface2/85 backdrop-blur-sm">
      <div className="mx-auto flex h-full w-full max-w-[1800px] items-center gap-2 overflow-hidden px-3">
        <div className="flex shrink-0 items-center gap-1 border-r border-ax-border pr-2">
          <HoverTooltip label={`Active Positions (${openTokenIds.length})`}>
            <button
              type="button"
              className={iconButtonClass(mode === 'open')}
              onClick={() => setMode('open')}
              aria-label="Active Positions"
            >
              <LineChart size={13} />
            </button>
          </HoverTooltip>
          <HoverTooltip label={`Watchlist (${favoriteIds.length})`}>
            <button
              type="button"
              className={iconButtonClass(mode === 'watchlist')}
              onClick={() => setMode('watchlist')}
              aria-label="Watchlist"
            >
              <Star size={13} fill={mode === 'watchlist' ? 'currentColor' : 'none'} />
            </button>
          </HoverTooltip>
        </div>

        <div className="shrink-0 text-[11px] text-ax-text-dim">{activeLabel}</div>

        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto no-scrollbar">
          {activeRows.length === 0 ? (
            <span className="text-[11px] text-ax-text-dim">{activeEmptyLabel}</span>
          ) : (
            activeRows.map((item) => (
              <SubHeaderTokenPill
                key={`${mode}-${item.tokenId}`}
                tokenId={item.tokenId}
                name={item.label}
                remainingQty={mode === 'open' ? item.qty : undefined}
                pnlPct={mode === 'open' ? item.pnlPct : undefined}
                showPositionMetrics={mode === 'open'}
                onClick={() => openToken(item.tokenId)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
