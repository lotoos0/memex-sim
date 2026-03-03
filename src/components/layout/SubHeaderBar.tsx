import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
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

export default function SubHeaderBar() {
  const navigate = useNavigate();
  const favoriteIds = useFavoritesStore((s) => s.favoriteIds);
  const quickPositionsByTokenId = useTradingStore((s) => s.quickPositionsByTokenId);
  const tokensById = useTokenStore((s) => s.tokensById);
  const setActiveToken = useTokenStore((s) => s.setActiveToken);

  const openTokenIds = useMemo(() => {
    const rows = Object.entries(quickPositionsByTokenId)
      .filter(([, position]) => (position?.qty ?? 0) > 0)
      .sort((a, b) => (b[1]?.updatedAtMs ?? 0) - (a[1]?.updatedAtMs ?? 0));
    return rows.map(([tokenId]) => tokenId);
  }, [quickPositionsByTokenId]);

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
      return { tokenId, label };
    });
  }, [favoritePreviewIds, tokensById]);

  const onSectionClick = (section: 'open' | 'watchlist') => {
    if (import.meta.env.DEV) {
      // Placeholder for Krok 3 drawer launch.
      console.info(`[SubHeaderBar] ${section} section clicked`);
    }
  };

  return (
    <div className="sticky top-[60px] z-40 h-11 shrink-0 border-b border-ax-border bg-ax-surface2/85 backdrop-blur-sm">
      <div className="mx-auto flex h-full w-full max-w-[1800px] items-center gap-3 overflow-hidden px-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          <HoverTooltip label="Active Positions">
            <button
              type="button"
              onClick={() => onSectionClick('open')}
              className="shrink-0 rounded border border-ax-border bg-ax-surface px-2 py-1 text-[11px] font-medium text-ax-text-dim hover:text-ax-text"
            >
              Open ({openTokenIds.length})
            </button>
          </HoverTooltip>
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto no-scrollbar">
            {openPreviewIds.length === 0 ? (
              <span className="text-[11px] text-ax-text-dim">No open positions</span>
            ) : (
              openPreview.map((item) => {
                return (
                  <SubHeaderTokenPill
                    key={`open-${item.tokenId}`}
                    tokenId={item.tokenId}
                    name={item.label}
                    remainingQty={item.qty}
                    pnlPct={item.pnlPct}
                    showPositionMetrics
                    onClick={() => openToken(item.tokenId)}
                  />
                );
              })
            )}
          </div>
        </div>

        <div className="h-5 w-px shrink-0 bg-ax-border" />

        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          <HoverTooltip label="Watchlist">
            <button
              type="button"
              onClick={() => onSectionClick('watchlist')}
              className="shrink-0 rounded border border-ax-border bg-ax-surface px-2 py-1 text-[11px] font-medium text-ax-text-dim hover:text-ax-text"
            >
              Fav ({favoriteIds.length})
            </button>
          </HoverTooltip>
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto no-scrollbar">
            {favoritePreviewIds.length === 0 ? (
              <span className="text-[11px] text-ax-text-dim">No favorites yet</span>
            ) : (
              favoritePreview.map((item) => {
                return (
                  <SubHeaderTokenPill
                    key={`fav-${item.tokenId}`}
                    tokenId={item.tokenId}
                    name={item.label}
                    onClick={() => openToken(item.tokenId)}
                  />
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
