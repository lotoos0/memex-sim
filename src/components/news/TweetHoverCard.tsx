import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Heart, Leaf, MessageCircle, Repeat2 } from 'lucide-react';
import type { TokenPost } from '../../store/postStore';
import { deriveNewsStats, getNewsAuthorProfile } from '../../lib/newsAuthor';
import { getTokenAvatarUrl } from '../../lib/tokenAvatar';

interface Props {
  tokenId: string;
  ticker: string;
  news: TokenPost;
  simNowMs: number;
  trigger: ReactNode;
}

function fmtAgo(nowMs: number, ms: number): string {
  const d = Math.max(0, nowMs - ms);
  if (d < 60_000) return `${Math.max(1, Math.round(d / 1000))}s`;
  if (d < 3_600_000) return `${Math.round(d / 60_000)}m`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)}h`;
  return `${Math.round(d / 86_400_000)}d`;
}

export default function TweetHoverCard({ tokenId, ticker, news, simNowMs, trigger }: Props) {
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const fallbackAuthor = getNewsAuthorProfile(tokenId, ticker, news.author);
  const hasCustomAvatar = typeof news.authorAvatar === 'string'
    && (
      news.authorAvatar.startsWith('data:')
      || news.authorAvatar.startsWith('http://')
      || news.authorAvatar.startsWith('https://')
      || news.authorAvatar.startsWith('/')
    );
  const author = {
    name: news.authorName ?? fallbackAuthor.name,
    handle: news.authorHandle ?? fallbackAuthor.handle,
    avatarUrl: hasCustomAvatar ? news.authorAvatar! : fallbackAuthor.avatarUrl,
    joinedLabel: fallbackAuthor.joinedLabel,
    followers: fallbackAuthor.followers,
  };
  const stats = deriveNewsStats(news.id);
  const showImage = news.kind !== 'TRADE';

  const clearCloseTimer = () => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const openCard = () => {
    clearCloseTimer();
    if (!triggerRef.current || typeof window === 'undefined') return;
    const rect = triggerRef.current.getBoundingClientRect();
    const width = 320;
    const height = showImage ? 430 : 330;
    const pad = 8;

    let x = rect.left - width - 10;
    if (x < pad) x = Math.min(window.innerWidth - width - pad, rect.right + 10);
    if (x < pad) x = pad;

    let y = rect.top - 6;
    if (y + height > window.innerHeight - pad) y = window.innerHeight - height - pad;
    if (y < pad) y = pad;

    setPos({ x, y });
    setOpen(true);
  };

  const closeSoon = () => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      setPos(null);
      closeTimerRef.current = null;
    }, 100);
  };

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={openCard}
        onMouseLeave={closeSoon}
        className="inline-block"
      >
        {trigger}
      </span>

      {open && pos && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="fixed z-[175] w-[320px] rounded-2xl border border-[#4f6382] bg-[#0f1f34] shadow-2xl text-ax-text"
              style={{ left: pos.x, top: pos.y }}
              onMouseEnter={clearCloseTimer}
              onMouseLeave={closeSoon}
            >
              <div className="flex items-start gap-3 px-3 pt-3">
                <img
                  src={author.avatarUrl}
                  alt={author.name}
                  className="h-11 w-11 rounded-full border border-ax-border object-cover"
                  draggable={false}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[14px] font-semibold leading-none">{author.name}</div>
                      <div className="truncate text-[12px] text-[#8db1d8] leading-none inline-flex items-center gap-1">
                        <span>@{author.handle}</span>
                        <Leaf size={11} className="text-[#00d4a1]" />
                      </div>
                    </div>
                    <span className="text-[16px] text-ax-text-dim leading-none">X</span>
                  </div>
                </div>
              </div>

              <div className="mt-2 px-3 text-[11px] text-ax-text-dim flex items-center justify-between">
                <span>{author.joinedLabel}</span>
                <span>{author.followers} followers</span>
              </div>

              <div className="mt-2 border-t border-[#31425f] px-3 pt-2 pb-1">
                <p className="whitespace-pre-wrap text-[13px] leading-[1.35] text-[#dce8f7]">
                  {news.text}
                </p>
              </div>

              {showImage && (
                <div className="px-3 pb-2">
                  <img
                    src={getTokenAvatarUrl(`${tokenId}:news-image`)}
                    alt={`${ticker} news`}
                    className="h-[150px] w-full rounded-xl border border-ax-border object-cover"
                    draggable={false}
                  />
                </div>
              )}

              <div className="border-t border-[#31425f] px-3 py-2 flex items-center gap-3 text-[11px] text-[#9eb5d1]">
                <span className="inline-flex items-center gap-1"><MessageCircle size={14} />{stats.replies}</span>
                <span className="inline-flex items-center gap-1"><Repeat2 size={14} />{stats.reposts}</span>
                <span className="inline-flex items-center gap-1"><Heart size={14} />{stats.likes}</span>
                <span className="ml-auto text-ax-text-dim">{fmtAgo(simNowMs, news.createdAtMs)}</span>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
