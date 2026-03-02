import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getTokenAvatarUrl } from '../../lib/tokenAvatar';
import ImagePreviewDialog from './ImagePreviewDialog';

type PreviewMode = 'none' | 'click' | 'hover';

interface Props {
  tokenId: string;
  label: string;
  size?: number;
  className?: string;
  previewMode?: PreviewMode;
}

export default function TokenAvatar({
  tokenId,
  label,
  size = 28,
  className = '',
  previewMode = 'none',
}: Props) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [openPreview, setOpenPreview] = useState(false);
  const [hoverPreview, setHoverPreview] = useState<{ x: number; y: number } | null>(null);
  const src = useMemo(() => getTokenAvatarUrl(tokenId), [tokenId]);

  useEffect(() => {
    if (!hoverPreview) return;
    const close = () => setHoverPreview(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [hoverPreview]);

  const openHoverPreview = () => {
    if (!triggerRef.current || typeof window === 'undefined') return;
    const rect = triggerRef.current.getBoundingClientRect();
    const previewSize = 220;
    const gap = 8;
    const pad = 8;

    let x = rect.left;
    if (x + previewSize > window.innerWidth - pad) x = window.innerWidth - previewSize - pad;
    if (x < pad) x = pad;

    let y = rect.bottom + gap;
    if (y + previewSize > window.innerHeight - pad) {
      y = Math.max(pad, rect.top - previewSize - gap);
    }
    setHoverPreview({ x, y });
  };

  if (previewMode === 'none') {
    return (
      <img
        src={src}
        alt={label}
        width={size}
        height={size}
        className={`rounded-md border border-ax-border/80 object-cover ${className}`}
        draggable={false}
      />
    );
  }

  if (previewMode === 'hover') {
    return (
      <>
        <button
          ref={triggerRef}
          type="button"
          onMouseEnter={openHoverPreview}
          onMouseLeave={() => setHoverPreview(null)}
          onClick={(ev) => ev.stopPropagation()}
          className="rounded-md border border-ax-border/80 hover:border-[#6f8cff88] transition-colors"
          title="Token avatar"
        >
          <img
            src={src}
            alt={label}
            width={size}
            height={size}
            className={`rounded-md object-cover ${className}`}
            draggable={false}
          />
        </button>
        {hoverPreview &&
          typeof document !== 'undefined' &&
          createPortal(
            <div
              className="pointer-events-none fixed z-[170] rounded-xl border border-ax-border bg-ax-surface p-1.5 shadow-2xl"
              style={{ left: hoverPreview.x, top: hoverPreview.y }}
            >
              <img
                src={src}
                alt={`${label} preview`}
                width={210}
                height={210}
                className="h-[210px] w-[210px] rounded-lg object-cover"
                draggable={false}
              />
            </div>,
            document.body
          )}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={(ev) => {
          ev.stopPropagation();
          setOpenPreview(true);
        }}
        className="rounded-md border border-ax-border/80 hover:border-[#6f8cff88] transition-colors"
        title="Open avatar preview"
      >
        <img
          src={src}
          alt={label}
          width={size}
          height={size}
          className={`rounded-md object-cover ${className}`}
          draggable={false}
        />
      </button>
      <ImagePreviewDialog
        open={openPreview}
        src={src}
        alt={label}
        onClose={() => setOpenPreview(false)}
      />
    </>
  );
}
