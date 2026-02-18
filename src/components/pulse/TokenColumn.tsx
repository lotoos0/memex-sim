import type { TokenState } from '../../tokens/types';
import TokenCard from './TokenCard';

interface Props {
  title: string;
  tokens: TokenState[];
  accent?: string;
}

export default function TokenColumn({ title, tokens, accent = '#00d4a1' }: Props) {
  return (
    <div className="flex flex-col flex-1 min-w-0 border-r border-ax-border last:border-r-0">
      {/* Column header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-ax-border bg-ax-surface shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: accent }} />
          <span className="text-xs font-bold text-ax-text">{title}</span>
          <span className="text-[10px] text-ax-text-dim bg-ax-surface2 px-1.5 py-0.5 rounded">
            {tokens.length}
          </span>
        </div>
        <span className="text-[10px] text-ax-text-dim">MC ▼</span>
      </div>

      {/* Token list */}
      <div className="flex flex-col gap-1.5 p-2 overflow-y-auto flex-1">
        {tokens.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-ax-text-dim text-xs opacity-50">
            No tokens
          </div>
        ) : (
          tokens.map(token => (
            <TokenCard key={token.id} token={token} />
          ))
        )}
      </div>
    </div>
  );
}
