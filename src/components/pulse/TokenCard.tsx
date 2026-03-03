import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Feather, LoaderCircle, Star, Zap } from 'lucide-react';
import type { TokenState } from '../../tokens/types';
import { useTokenStore } from '../../store/tokenStore';
import { useTradingStore } from '../../store/tradingStore';
import { usePostStore, type TokenPost } from '../../store/postStore';
import { useFavoritesStore } from '../../store/favoritesStore';
import TokenAvatar from '../common/TokenAvatar';
import TweetHoverCard from '../news/TweetHoverCard';
import HoverTooltip from '../ui/HoverTooltip';

const EMPTY_POSTS: TokenPost[] = [];

function fmtUsd(v: number): string {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function fmtAge(simMs: number): string {
  const s = simMs / 1000;
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

function fmtPct(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

function fmtSignedUsd(v: number): string {
  const sign = v >= 0 ? '+' : '-';
  const abs = Math.abs(v);
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtQuickBuyAmount(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '0.05';
  if (v >= 1) return v.toFixed(2).replace(/\.00$/, '');
  if (v >= 0.1) return v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

interface Props {
  token: TokenState;
  quickBuyAmount: number;
  quickBuyOptions: {
    slippagePct: number;
    prioritySol: number;
    bribeSol: number;
  };
}

export default function TokenCard({ token, quickBuyAmount, quickBuyOptions }: Props) {
  const navigate = useNavigate();
  const setActive = useTokenStore(s => s.setActiveToken);
  const selectQuickPosition = useCallback(
    (s: ReturnType<typeof useTradingStore.getState>) => s.quickPositionsByTokenId[token.id] ?? null,
    [token.id]
  );
  const quickPosition = useTradingStore(selectQuickPosition);
  const quickBuy = useTradingStore(s => s.quickBuy);
  const selectLatestNews = useCallback(
    (s: ReturnType<typeof usePostStore.getState>) => {
      const rows = s.postsByTokenId[token.id] ?? EMPTY_POSTS;
      for (let i = rows.length - 1; i >= 0; i--) {
        const post = rows[i]!;
        if (post.kind === 'USER') continue;
        return post;
      }
      return rows.length > 0 ? rows[rows.length - 1]! : null;
    },
    [token.id]
  );
  const latestNews = usePostStore(selectLatestNews);
  const isFavorite = useFavoritesStore((s) => Boolean(s.favoritesById[token.id]));
  const toggleFavorite = useFavoritesStore((s) => s.toggleFavorite);
  const [isBuying, setIsBuying] = useState(false);
  const buyTimerRef = useRef<number | null>(null);

  const isRugged = token.phase === 'RUGGED';
  const hasOpenPosition = (quickPosition?.qty ?? 0) > 0;
  const holdingUsd = hasOpenPosition ? (quickPosition!.qty * token.lastPriceUsd) : 0;
  const unrealizedUsd = hasOpenPosition ? holdingUsd - quickPosition!.costBasisUsd : 0;

  const handleClick = () => {
    if (isRugged) return;
    setActive(token.id);
    navigate(`/token/${token.id}`);
  };

  const handleQuickBuy = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (isRugged) return;
    quickBuy(token.id, quickBuyAmount, quickBuyOptions);
    setIsBuying(true);
    if (buyTimerRef.current != null) window.clearTimeout(buyTimerRef.current);
    buyTimerRef.current = window.setTimeout(() => {
      setIsBuying(false);
      buyTimerRef.current = null;
    }, 1_000);
  };

  const handleToggleFavorite = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    toggleFavorite(token.id);
  };

  useEffect(() => {
    return () => {
      if (buyTimerRef.current != null) {
        window.clearTimeout(buyTimerRef.current);
      }
    };
  }, []);

  return (
    <div
      onClick={handleClick}
      className={[
        'flex flex-col gap-1 p-2.5 rounded border cursor-pointer transition-all',
        'hover:border-ax-border hover:bg-ax-surface2',
        isRugged
          ? 'border-ax-red/30 bg-ax-red-dim opacity-60 cursor-default'
          : 'border-ax-border/50 bg-ax-surface',
      ].join(' ')}
    >
      {/* Row 1: logo + name + age + change */}
      <div className="flex items-center gap-2">
        <TokenAvatar
          tokenId={token.id}
          label={`${token.ticker} avatar`}
          size={30}
          className="h-[30px] w-[30px]"
          previewMode="hover"
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <span className={`font-bold text-xs truncate ${isRugged ? 'text-ax-red' : 'text-ax-text'}`}>
              {token.ticker}
            </span>
            {isRugged && (
              <span className="text-[10px] text-ax-red font-bold">RUGGED</span>
            )}
          </div>
          <div className="text-ax-text-dim text-[10px] truncate">{token.name}</div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <HoverTooltip label="Watchlist">
            <button
              type="button"
              onClick={handleToggleFavorite}
              aria-label={isFavorite ? 'Remove from watchlist' : 'Add to watchlist'}
              className={[
                'inline-flex h-6 w-6 items-center justify-center rounded-md border transition-colors',
                isFavorite
                  ? 'border-[#f5c54288] bg-[#f5c5421f] text-[#f5c542]'
                  : 'border-ax-border bg-ax-surface2 text-ax-text-dim hover:text-ax-text',
              ].join(' ')}
            >
              <Star size={13} fill={isFavorite ? 'currentColor' : 'none'} />
            </button>
          </HoverTooltip>
          <div className="text-right">
            <div className={`text-xs font-bold ${token.changePct >= 0 ? 'text-ax-green' : 'text-ax-red'}`}>
              {fmtPct(token.changePct)}
            </div>
            <div className="text-ax-text-dim text-[10px]">{fmtAge(token.simTimeMs)}</div>
          </div>
        </div>
      </div>

      {/* Row 2: V + MC */}
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-ax-text-dim">
          V <span className="text-ax-text">{fmtUsd(token.vol5mUsd)}</span>
        </span>
        <span className="text-ax-text-dim">
          MC <span className="text-ax-text">{fmtUsd(token.mcapUsd)}</span>
        </span>
        <span className="text-ax-text-dim">
          <span className="text-ax-green">{token.buys5m}B</span>
          {' / '}
          <span className="text-ax-red">{token.sells5m}S</span>
        </span>
      </div>

      {/* Row 3: metrics */}
      <div className="flex items-center gap-2 text-[10px] text-ax-text-dim">
        <span>
          <span className={token.metrics.topHoldersPct > 50 ? 'text-ax-red' : 'text-ax-text-dim'}>
            {token.metrics.topHoldersPct}%
          </span>
          {' '}Top H.
        </span>
        <span>
          <span className={token.metrics.devHoldingsPct > 5 ? 'text-ax-yellow' : 'text-ax-text-dim'}>
            {token.metrics.devHoldingsPct}%
          </span>
          {' '}Dev
        </span>
        <span>
          <span className={token.metrics.lpBurnedPct < 50 ? 'text-ax-red' : 'text-ax-green'}>
            {token.metrics.lpBurnedPct}%
          </span>
          {' '}LP
        </span>
      </div>

      {/* Bonding curve bar */}
      <div className="h-0.5 rounded-full bg-ax-border overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${token.bondingCurvePct}%`,
            backgroundColor: token.bondingCurvePct > 80 ? '#f5c542' : token.phase === 'RUGGED' ? '#ff4d6a' : '#00d4a1',
          }}
        />
      </div>

      <div className="text-[10px]">
        {latestNews ? (
          <TweetHoverCard
            tokenId={token.id}
            ticker={token.ticker}
            news={latestNews}
            simNowMs={token.simTimeMs}
            trigger={(
              <div className="inline-flex h-4.5 w-4.5 items-center justify-center rounded border border-[#2d5f53] bg-[#0f2320] text-[#00d4a1]">
                <Feather size={10} className="shrink-0" />
              </div>
            )}
          />
        ) : (
          <span className="text-ax-text-dim">No news yet.</span>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        {hasOpenPosition ? (
          <span className={[
            'text-[10px] font-medium',
            unrealizedUsd >= 0 ? 'text-ax-green' : 'text-ax-red',
          ].join(' ')}>
            Pos {quickPosition!.qty.toFixed(0)} | {fmtSignedUsd(unrealizedUsd)}
          </span>
        ) : (
          <span className="text-[10px] text-ax-text-dim">No position</span>
        )}

        <div className="flex items-center gap-1">
          <button
            onClick={handleQuickBuy}
            disabled={isBuying}
            className="h-8 min-w-[132px] px-3 rounded-md border border-[#6f8cff88] bg-[#4f6dff] text-[11px] text-white font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-[#5c79ff] transition-colors"
          >
            {isBuying ? (
              <LoaderCircle size={14} className="animate-spin" />
            ) : (
              <>
                <Zap size={12} />
                {fmtQuickBuyAmount(quickBuyAmount)} SOL
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
