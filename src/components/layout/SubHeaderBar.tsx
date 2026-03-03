export default function SubHeaderBar() {
  return (
    <div className="sticky top-[60px] z-40 h-10 shrink-0 border-b border-ax-border bg-ax-surface2/85 backdrop-blur-sm">
      <div className="mx-auto flex h-full w-full max-w-[1800px] items-center justify-between px-3">
        <div className="flex items-center gap-2 text-[11px] text-ax-text-dim">
          <span className="rounded border border-ax-border bg-ax-surface px-2 py-1">Open Positions (0)</span>
          <span className="rounded border border-ax-border bg-ax-surface px-2 py-1">Watchlist (0)</span>
        </div>
        <span className="text-[11px] text-ax-text-dim">SubHeaderBar placeholder</span>
      </div>
    </div>
  );
}
