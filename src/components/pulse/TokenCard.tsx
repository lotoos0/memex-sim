import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check,
  Copy,
  Feather,
  EyeOff,
  LoaderCircle,
  Star,
  Zap,
} from 'lucide-react';
import type { TokenState } from '../../tokens/types';
import {
  selectTokenAgeLabel,
  selectTokenTradeFlow60s,
  useTokenStore,
} from '../../store/tokenStore';
import { useTradingStore } from '../../store/tradingStore';
import { usePostStore, type TokenPost } from '../../store/postStore';
import { useFavoritesStore } from '../../store/favoritesStore';
import TokenAvatar from '../common/TokenAvatar';
import HoverTooltip from '../ui/HoverTooltip';
import TweetHoverCard from '../news/TweetHoverCard';
import './TokenCard.css';

const EMPTY_POSTS: TokenPost[] = [];
const COPY_FEEDBACK_MS = 1_200;
const compactNumber = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function fmtUsd(value: number): string {
  return `$${compactNumber.format(value)}`;
}

function fmtPct(value: number): string {
  const amount = Math.abs(value);
  return `${value >= 0 ? '+' : '-'}${amount >= 1_000 ? compactNumber.format(amount) : amount.toFixed(1)}%`;
}

function fmtSignedUsd(value: number): string {
  return `${value >= 0 ? '+' : '-'}${fmtPositionUsd(Math.abs(value))}`;
}

function fmtPositionUsd(value: number): string {
  return value < 1_000 ? `$${value.toFixed(2)}` : fmtUsd(value);
}

function fmtQuickBuyAmount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0.05';
  if (value >= 1) return value.toFixed(2).replace(/\.00$/, '');
  if (value >= 0.1)
    return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

export type PulseDisplayMode = 'comfortable' | 'dense';

interface Props {
  onHideToken: (tokenId: string) => void;
  token: TokenState;
  quickBuyAmount: number;
  quickBuyOptions: {
    slippagePct: number;
    prioritySol: number;
    bribeSol: number;
  };
  displayMode?: PulseDisplayMode;
}

export default function TokenCard({
  onHideToken,
  token,
  quickBuyAmount,
  quickBuyOptions,
  displayMode = 'comfortable',
}: Props) {
  const navigate = useNavigate();
  const setActive = useTokenStore((s) => s.setActiveToken);
  const ageLabel = useTokenStore(
    useMemo(() => selectTokenAgeLabel(token.id), [token.id]),
  );
  const flow = useTokenStore(
    useMemo(() => selectTokenTradeFlow60s(token.id), [token.id]),
  );
  const quickPosition = useTradingStore(
    useCallback((s) => s.quickPositionsByTokenId[token.id] ?? null, [token.id]),
  );
  const quickBuy = useTradingStore((s) => s.quickBuy);
  const latestNews = usePostStore(
    useCallback(
      (s) => {
        const rows = s.postsByTokenId[token.id] ?? EMPTY_POSTS;
        for (let i = rows.length - 1; i >= 0; i--) {
          if (rows[i]!.kind !== 'USER') return rows[i]!;
        }
        return rows[rows.length - 1] ?? null;
      },
      [token.id],
    ),
  );
  const isFavorite = useFavoritesStore((s) =>
    Boolean(s.favoritesById[token.id]),
  );
  const toggleFavorite = useFavoritesStore((s) => s.toggleFavorite);
  const [isBuying, setIsBuying] = useState(false);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'err'>('idle');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const buyTimerRef = useRef<number | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  const detailsRef = useRef<HTMLDivElement | null>(null);
  const detailsId = useId();
  const dense = displayMode === 'dense';
  const isDead = token.phase === 'DEAD' || token.phase === 'RUGGED';
  const hasOpenPosition = (quickPosition?.qty ?? 0) > 0;
  const holdingUsd = hasOpenPosition
    ? quickPosition!.qty * token.lastPriceUsd
    : 0;
  const unrealizedUsd = hasOpenPosition
    ? holdingUsd - quickPosition!.costBasisUsd
    : 0;
  const unrealizedPct =
    hasOpenPosition && quickPosition!.costBasisUsd > 0
      ? (unrealizedUsd / quickPosition!.costBasisUsd) * 100
      : null;
  const pnlLabel = unrealizedPct === null ? '—' : fmtPct(unrealizedPct);
  const pnlTitle = `Unrealized position PnL: ${fmtSignedUsd(unrealizedUsd)} (${pnlLabel}). Current value: ${fmtPositionUsd(holdingUsd)}. Cost basis: ${fmtPositionUsd(quickPosition?.costBasisUsd ?? 0)}.`;
  const stageLabel =
    token.phase === 'MIGRATED'
      ? 'Migrated'
      : isDead
        ? token.phase === 'RUGGED'
          ? 'Rugged'
          : 'Dead'
        : `${dense ? '' : 'Curve '}${token.bondingCurvePct.toFixed(0)}%`;
  const stageTitle =
    token.phase === 'MIGRATED'
      ? 'Migrated: bonding curve completed'
      : isDead
        ? `${stageLabel} token`
        : `Bonding curve progress: ${token.bondingCurvePct.toFixed(1)}%`;
  const copyLabel =
    copyState === 'ok'
      ? 'Copied token ID'
      : copyState === 'err'
        ? 'Copy failed'
        : 'Copy token ID';

  const handleClick = () => {
    setActive(token.id);
    navigate(`/token/${token.id}`);
  };

  const handleQuickBuy = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const result = quickBuy(token.id, quickBuyAmount, quickBuyOptions);
    setBuyError(result.ok ? null : (result.reason ?? 'Buy failed'));
    setIsBuying(result.ok);
    if (buyTimerRef.current !== null) window.clearTimeout(buyTimerRef.current);
    buyTimerRef.current = window.setTimeout(() => {
      setIsBuying(false);
      setBuyError(null);
      buyTimerRef.current = null;
    }, 1_000);
  };

  const handleCopyId = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(token.id);
      setCopyState('ok');
    } catch {
      setCopyState('err');
    }
    if (copyTimerRef.current !== null)
      window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => {
      setCopyState('idle');
      copyTimerRef.current = null;
    }, COPY_FEEDBACK_MS);
  };

  const positionDetails = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const panel = detailsRef.current;
    if (!panel) return;
    panel.style.left = `${Math.max(8, Math.min(rect.right - 260, window.innerWidth - 268))}px`;
    panel.style.top = `${Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 228))}px`;
  };

  useEffect(() => {
    if (!detailsOpen) return;
    const close = () => detailsRef.current?.hidePopover();
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [detailsOpen]);

  useEffect(
    () => () => {
      if (buyTimerRef.current !== null)
        window.clearTimeout(buyTimerRef.current);
      if (copyTimerRef.current !== null)
        window.clearTimeout(copyTimerRef.current);
    },
    [],
  );

  const quickBuyButton = (
    <button
      type="button"
      onClick={handleQuickBuy}
      disabled={isBuying}
      className="pulse-token-card__buy"
      aria-label={
        buyError ?? `Quick buy ${fmtQuickBuyAmount(quickBuyAmount)} SOL`
      }
      title={
        buyError ??
        `Quick buy ${fmtQuickBuyAmount(quickBuyAmount)} simulated SOL`
      }
      aria-busy={isBuying}
    >
      {isBuying ? (
        <LoaderCircle size={12} className="animate-spin" />
      ) : (
        <Zap size={12} />
      )}
      <span>
        {buyError ? 'Failed' : `${fmtQuickBuyAmount(quickBuyAmount)} SOL`}
      </span>
    </button>
  );

  const activity = (
    <div className="pulse-token-card__activity">
      <span
        title={`Volume (5 minutes): $${token.vol5mUsd.toLocaleString('en-US')}`}
      >
        <span className="pulse-token-card__muted">
          {dense ? 'V' : 'Vol 5m'}
        </span>{' '}
        {fmtUsd(token.vol5mUsd)}
      </span>
      <span
        title={`Transactions (60 seconds): ${flow.tx60s.toLocaleString('en-US')}`}
      >
        <span className="pulse-token-card__muted">
          {dense ? 'TX' : 'TX 60s'}
        </span>{' '}
        {compactNumber.format(flow.tx60s)}
      </span>
      <span
        title={`Buys / sells (60 seconds): ${flow.buys60s.toLocaleString('en-US')} / ${flow.sells60s.toLocaleString('en-US')}`}
      >
        <span className="text-ax-green">
          {compactNumber.format(flow.buys60s)}B
        </span>
        <span className="pulse-token-card__muted">/</span>
        <span className="text-ax-red">
          {compactNumber.format(flow.sells60s)}S
        </span>
      </span>
    </div>
  );

  const stage = dense ? (
    <button
      type="button"
      className="pulse-token-card__stage-label"
      popoverTarget={detailsId}
      onClick={positionDetails}
      title={`${stageTitle}. Open token details and model metrics.`}
      aria-label={`${stageTitle}. Token details`}
    >
      {stageLabel}
    </button>
  ) : (
    <span title={stageTitle}>{stageLabel}</span>
  );

  return (
    <div
      onClick={handleClick}
      data-token-id={token.id}
      data-display-mode={displayMode}
      className={`pulse-token-card pulse-token-card--${displayMode}${isDead ? ' pulse-token-card--dead' : ''}`}
    >
      <div className="pulse-token-card__header">
        <div className="pulse-token-card__avatar">
          <TokenAvatar
            tokenId={token.id}
            imageUrl={token.imageUrl}
            label={`${token.ticker} avatar`}
            size={dense ? 22 : 30}
            previewMode="hover"
          />
        </div>
        <button
          type="button"
          className="pulse-token-card__identity"
          onClick={(event) => {
            event.stopPropagation();
            handleClick();
          }}
          title={`${token.ticker} · ${token.name} · Open token page`}
          aria-label={`Open token page: ${token.ticker}`}
        >
          <span className="pulse-token-card__title">
            <span className="pulse-token-card__ticker">{token.ticker}</span>
            {!dense && (
              <span
                className="pulse-token-card__mcap"
                title={`Market cap: $${token.mcapUsd.toLocaleString('en-US')}`}
              >
                {fmtUsd(token.mcapUsd)}
              </span>
            )}
          </span>
          <span className="pulse-token-card__subtitle">
            {!dense && token.name !== token.ticker && (
              <span className="pulse-token-card__name" title={token.name}>
                {token.name}
              </span>
            )}
            <span
              className="pulse-token-card__age"
              title="Token age (simulation time)"
            >
              {ageLabel}
            </span>
          </span>
        </button>
        {dense && (
          <span
            className="pulse-token-card__mcap"
            title={`Market cap: $${token.mcapUsd.toLocaleString('en-US')}`}
          >
            {fmtUsd(token.mcapUsd)}
          </span>
        )}
        <span
          className={`pulse-token-card__change ${token.changePct >= 0 ? 'text-ax-green' : 'text-ax-red'}`}
          title={`Price change since launch: ${token.changePct.toFixed(1)}%`}
        >
          {fmtPct(token.changePct)}
        </span>
        {dense && hasOpenPosition && (
          <span
            className={`pulse-token-card__position-badge ${unrealizedUsd >= 0 ? 'text-ax-green' : 'text-ax-red'}`}
            title={pnlTitle}
          >
            P {pnlLabel}
          </span>
        )}
        <span className="pulse-token-card__hide">
          <HoverTooltip label="Hide Token">
            <button
              type="button"
              className="pulse-token-card__icon"
              aria-label="Hide Token"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onHideToken(token.id);
              }}
            >
              <EyeOff size={13} />
            </button>
          </HoverTooltip>
        </span>
        <button
          type="button"
          className={`pulse-token-card__icon${isFavorite ? ' pulse-token-card__icon--favorite' : ''}`}
          onClick={(event) => {
            event.stopPropagation();
            toggleFavorite(token.id);
          }}
          aria-pressed={isFavorite}
          aria-label={isFavorite ? 'Remove from watchlist' : 'Add to watchlist'}
          title="Watchlist"
        >
          <Star size={13} fill={isFavorite ? 'currentColor' : 'none'} />
        </button>
        <div
          className="pulse-token-card__news"
          onClick={(event) => event.stopPropagation()}
        >
          {latestNews ? (
            <TweetHoverCard
              tokenId={token.id}
              ticker={token.ticker}
              imageUrl={token.imageUrl}
              news={latestNews}
              simNowMs={token.simTimeMs}
              trigger={
                <button
                  type="button"
                  className="pulse-token-card__icon"
                  aria-label="Preview token news"
                  title="Preview token news"
                  onClick={(event) => event.stopPropagation()}
                >
                  <Feather size={13} />
                </button>
              }
            />
          ) : (
            <button
              type="button"
              className="pulse-token-card__icon"
              disabled
              aria-label="No news yet"
              title="No news yet"
            >
              <Feather size={13} />
            </button>
          )}
        </div>
      </div>
      {dense ? (
        <div className="pulse-token-card__dense-bottom">
          {activity}
          {stage}
          {quickBuyButton}
        </div>
      ) : (
        <>
          {activity}
          <div className="pulse-token-card__bottom">
            <button
              type="button"
              className="pulse-token-card__risk"
              popoverTarget={detailsId}
              onClick={positionDetails}
              aria-label="Token details and model metrics"
              title="Static model parameters assigned at launch. Open token details."
            >
              <span>
                Top H.{' '}
                <b
                  className={
                    token.metrics.topHoldersPct > 50 ? 'text-ax-red' : ''
                  }
                >
                  {token.metrics.topHoldersPct}%
                </b>
              </span>
              <span>
                Dev{' '}
                <b
                  className={
                    token.metrics.devHoldingsPct > 5 ? 'text-ax-yellow' : ''
                  }
                >
                  {token.metrics.devHoldingsPct}%
                </b>
              </span>
              <span>
                LP{' '}
                <b
                  className={
                    token.metrics.lpBurnedPct < 50
                      ? 'text-ax-red'
                      : 'text-ax-green'
                  }
                >
                  {token.metrics.lpBurnedPct}%
                </b>
              </span>
            </button>
            {quickBuyButton}
          </div>
          <div className="pulse-token-card__stage">
            {stage}
            {!isDead && token.phase !== 'MIGRATED' && (
              <div
                className="pulse-token-card__track"
                role="progressbar"
                aria-label="Bonding curve progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={token.bondingCurvePct}
              >
                <div
                  style={{
                    width: `${token.bondingCurvePct}%`,
                    backgroundColor:
                      token.bondingCurvePct > 80
                        ? 'var(--color-ax-yellow)'
                        : 'var(--color-ax-green)',
                  }}
                />
              </div>
            )}
          </div>
          {hasOpenPosition && (
            <div className="pulse-token-card__position" title={pnlTitle}>
              <span>Value {fmtPositionUsd(holdingUsd)}</span>
              <span
                className={unrealizedUsd >= 0 ? 'text-ax-green' : 'text-ax-red'}
              >
                PnL {fmtSignedUsd(unrealizedUsd)} ({pnlLabel})
              </span>
            </div>
          )}
        </>
      )}
      <div
        ref={detailsRef}
        id={detailsId}
        popover="auto"
        className="pulse-token-card-details"
        onToggle={(event) => setDetailsOpen(event.newState === 'open')}
        onClick={(event) => event.stopPropagation()}
      >
        <strong>{stageTitle}</strong>
        <span>Liquidity {fmtUsd(token.liquidityUsd)}</span>
        <span>
          Top H. {token.metrics.topHoldersPct}% · Dev{' '}
          {token.metrics.devHoldingsPct}% · LP {token.metrics.lpBurnedPct}%
        </span>
        <small>Static model parameters assigned at launch.</small>
        <div className="pulse-token-card-details__actions">
          <button type="button" onClick={handleCopyId}>
            {copyState === 'ok' ? <Check size={13} /> : <Copy size={13} />}
            {copyLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
