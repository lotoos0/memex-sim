import { useState } from 'react';

const TABS = ['Trades', 'Positions', 'Orders', 'Holders', 'Top Traders', 'Dev Tokens'] as const;

export default function BottomTabs() {
  const [active, setActive] = useState<(typeof TABS)[number]>('Positions');

  return (
    <section className="h-[160px] border-t border-ax-border bg-ax-surface shrink-0">
      <div className="h-8 border-b border-ax-border px-3 flex items-center gap-4 text-[11px]">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActive(tab)}
            className={[
              'h-8 border-b transition-colors',
              active === tab ? 'border-ax-text text-ax-text font-semibold' : 'border-transparent text-ax-text-dim hover:text-ax-text',
            ].join(' ')}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="h-[calc(100%-32px)] px-3 py-2 text-[11px] text-ax-text-dim">
        <div className="grid grid-cols-6 gap-2 border-b border-ax-border pb-1">
          <span>Token</span>
          <span>Bought</span>
          <span>Sold</span>
          <span>Remaining</span>
          <span>PnL</span>
          <span>Actions</span>
        </div>
        <div className="h-full flex items-center justify-center text-ax-text-dim/80">
          {active} panel is queued in next slice.
        </div>
      </div>
    </section>
  );
}
