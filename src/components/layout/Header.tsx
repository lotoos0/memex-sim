import { Link } from 'react-router-dom';
import { useWalletStore, solToUsd } from '../../store/walletStore';

export default function Header() {
  const solBalance = useWalletStore(s => s.solBalance);
  const pnl = useWalletStore(s => s.realizedPnlSol);

  return (
    <header className="flex items-center justify-between px-4 h-11 border-b border-ax-border bg-ax-surface shrink-0">
      <Link to="/" className="flex items-center gap-2 text-ax-text hover:text-ax-green transition-colors">
        <span className="text-ax-green font-bold text-sm tracking-widest">MEMEX</span>
        <span className="text-ax-text-dim text-xs">sim</span>
      </Link>

      <nav className="hidden md:flex items-center gap-5 text-xs text-ax-text-dim">
        <span className="opacity-60">Discover</span>
        <Link to="/" className="text-ax-text hover:text-ax-green transition-colors">Pulse</Link>
        <span className="opacity-60">Trackers</span>
        <span className="opacity-60">Perpetuals</span>
        <span className="opacity-60">Portfolio</span>
      </nav>

      <div className="flex items-center gap-3 text-xs">
        <div className="flex items-center gap-1.5 rounded-full border border-ax-border bg-ax-bg px-2.5 py-1">
          <span className="text-ax-text-dim">PnL</span>
          <span className={pnl >= 0 ? 'text-ax-green' : 'text-ax-red'}>
            {pnl >= 0 ? '+' : ''}{pnl.toFixed(4)} SOL
          </span>
        </div>
        <div className="h-3 w-px bg-ax-border" />
        <div className="flex items-center gap-1.5 bg-ax-surface2 px-2.5 py-1 rounded-full border border-ax-border">
          <span className="text-ax-text-dim">SOL</span>
          <span className="text-ax-text font-medium">{solBalance.toFixed(4)}</span>
          <span className="text-ax-text-dim">${solToUsd(solBalance).toFixed(0)}</span>
        </div>
      </div>
    </header>
  );
}
