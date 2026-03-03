import type { ReactNode } from 'react';

type HoverTooltipProps = {
  label: string;
  children: ReactNode;
};

export default function HoverTooltip({ label, children }: HoverTooltipProps) {
  return (
    <div className="group relative inline-flex">
      {children}
      <div
        role="tooltip"
        className={[
          'pointer-events-none absolute left-1/2 top-full z-50 mt-2 -translate-x-1/2',
          'whitespace-nowrap rounded-md border border-ax-border bg-ax-surface px-2 py-1',
          'text-[11px] font-medium text-ax-text shadow-[0_8px_24px_rgba(0,0,0,0.35)]',
          'opacity-0 transition-opacity duration-150 group-hover:opacity-100',
        ].join(' ')}
      >
        {label}
      </div>
    </div>
  );
}
