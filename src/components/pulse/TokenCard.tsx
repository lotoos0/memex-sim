import { useNavigate } from 'react-router-dom';
import type { TokenState } from '../../tokens/types';
import { useTokenStore } from '../../store/tokenStore';

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

interface Props {
  token: TokenState;
}

export default function TokenCard({ token }: Props) {
  const navigate = useNavigate();
  const setActive = useTokenStore(s => s.setActiveToken);

  const isRugged = token.phase === 'RUGGED';

  const handleClick = () => {
    if (isRugged) return;
    setActive(token.id);
    navigate(`/token/${token.id}`);
  };

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
        {/* Logo */}
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
          style={{ backgroundColor: token.logoColor + '33', color: token.logoColor, border: `1px solid ${token.logoColor}44` }}
        >
          {token.ticker.slice(0, 2)}
        </div>

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

        <div className="text-right shrink-0">
          <div className={`text-xs font-bold ${token.changePct >= 0 ? 'text-ax-green' : 'text-ax-red'}`}>
            {fmtPct(token.changePct)}
          </div>
          <div className="text-ax-text-dim text-[10px]">{fmtAge(token.simTimeMs)}</div>
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
    </div>
  );
}
