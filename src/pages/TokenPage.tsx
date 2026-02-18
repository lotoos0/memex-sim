import { useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useTokenStore, selectActiveToken } from '../store/tokenStore';
import Chart from '../components/chart/Chart';
import TradeSidebar from '../components/token/TradeSidebar';
import BottomTabs from '../components/token/BottomTabs';

function fmtUsd(v: number): string {
  if (!Number.isFinite(v)) return '$0';
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function fmtPrice(v: number): string {
  if (!Number.isFinite(v)) return '0.0000';
  if (v >= 1) return v.toFixed(4);
  if (v >= 0.01) return v.toFixed(6);
  return v.toExponential(4);
}

export default function TokenPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const setActive = useTokenStore(s => s.setActiveToken);
  const token = useTokenStore(selectActiveToken);

  useEffect(() => {
    if (id) setActive(id);
    return () => setActive(null);
  }, [id, setActive]);

  useEffect(() => {
    if (token && token.phase === 'DEAD') navigate('/');
  }, [token, navigate]);

  if (!token) {
    return (
      <div className="flex flex-1 items-center justify-center text-ax-text-dim text-sm">
        Token not found.
        <Link to="/" className="text-ax-green ml-2 hover:underline">Back to Pulse</Link>
      </div>
    );
  }

  const isRugged = token.phase === 'RUGGED';

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-ax-bg">
      <div className="flex items-center gap-4 px-4 py-2 border-b border-ax-border bg-ax-surface shrink-0">
        <button onClick={() => navigate('/')} className="text-ax-text-dim hover:text-ax-text transition-colors">
          <ArrowLeft size={14} />
        </button>

        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
          style={{ backgroundColor: token.logoColor + '33', color: token.logoColor, border: `1px solid ${token.logoColor}55` }}
        >
          {token.ticker.slice(0, 2)}
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-ax-text">{token.ticker}</span>
            {isRugged && (
              <span className="text-[10px] font-bold text-ax-red bg-ax-red-dim px-1.5 py-0.5 rounded">
                RUGGED
              </span>
            )}
            <span className="text-ax-text-dim text-xs">{token.name}</span>
          </div>

          <div className="h-4 w-px bg-ax-border" />
          <span className="text-sm font-bold text-ax-text">${fmtPrice(token.lastPriceUsd)}</span>
          <span className={`text-xs font-medium ${token.changePct >= 0 ? 'text-ax-green' : 'text-ax-red'}`}>
            {token.changePct >= 0 ? '+' : ''}{token.changePct.toFixed(2)}%
          </span>
        </div>

        <div className="flex items-center gap-4 ml-4 text-xs text-ax-text-dim">
          <span>MC <span className="text-ax-text font-medium">{fmtUsd(token.mcapUsd)}</span></span>
          <span>Liq <span className="text-ax-text font-medium">{fmtUsd(token.liquidityUsd)}</span></span>
          <span>
            B.Curve{' '}
            <span className={token.bondingCurvePct > 80 ? 'text-ax-yellow font-bold' : 'text-ax-text font-medium'}>
              {token.bondingCurvePct.toFixed(1)}%
            </span>
          </span>
          <span>5m Vol <span className="text-ax-text font-medium">{fmtUsd(token.vol5mUsd)}</span></span>
          <span>
            <span className="text-ax-green">{token.buys5m}B</span>
            {' / '}
            <span className="text-ax-red">{token.sells5m}S</span>
          </span>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 xl:flex-row flex-col">
        <div className="flex flex-col flex-1 min-h-0">
          <Chart tokenId={token.id} />
          <BottomTabs />
        </div>
        <TradeSidebar token={token} />
      </div>
    </div>
  );
}
