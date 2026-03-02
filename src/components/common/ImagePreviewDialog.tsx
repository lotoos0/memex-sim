import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface Props {
  open: boolean;
  src: string;
  alt: string;
  onClose: () => void;
}

export default function ImagePreviewDialog({ open, src, alt, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[145] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="relative max-h-[80vh] max-w-[80vh] rounded-xl border border-ax-border bg-ax-surface p-2 shadow-2xl"
        onClick={(ev) => ev.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-2 top-2 z-10 rounded border border-ax-border bg-ax-surface2 p-1 text-ax-text-dim hover:text-ax-text"
          title="Close"
        >
          <X size={14} />
        </button>
        <img
          src={src}
          alt={alt}
          className="block h-auto max-h-[72vh] w-auto max-w-[72vh] rounded-lg"
          draggable={false}
        />
      </div>
    </div>,
    document.body
  );
}
