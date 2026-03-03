import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { useWalletStore, solToUsd } from '../../store/walletStore';
import SearchOverlay from './SearchOverlay';

export default function Header() {
  const solBalance = useWalletStore(s => s.solBalance);
  const pnl = useWalletStore(s => s.realizedPnlSol);
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <>
      <header
        className="sticky top-0 z-50 flex items-center justify-between px-5 h-[60px] border-b border-ax-border bg-ax-surface shrink-0"
        style={{ fontFamily: 'Segoe UI, Inter, ui-sans-serif, system-ui, sans-serif' }}
      >
        <div className="flex items-center gap-8 min-w-0">
          <Link to="/" className="flex items-center gap-2 text-ax-text hover:text-ax-green transition-colors shrink-0">
            <span className="text-ax-green font-bold text-xl tracking-[0.22em] leading-none">MEMEX</span>
            <span className="text-ax-text-dim text-sm">sim</span>
          </Link>

          <nav className="hidden md:flex items-center gap-2 text-[14px] font-semibold text-ax-text-dim">
            <span className="rounded-md border border-transparent px-2.5 py-1 hover:border-[#2b3552] hover:bg-[#171d30] hover:text-ax-text transition-colors cursor-default">Discover</span>
            <Link to="/" className="rounded-md border border-[#2f5bff44] bg-[#2f5bff18] px-2.5 py-1 text-ax-text hover:border-[#3d6bff77] hover:bg-[#2f5bff24] transition-colors">Pulse</Link>
            <span className="rounded-md border border-transparent px-2.5 py-1 hover:border-[#2b3552] hover:bg-[#171d30] hover:text-ax-text transition-colors cursor-default">Trackers</span>
            <span className="rounded-md border border-transparent px-2.5 py-1 hover:border-[#2b3552] hover:bg-[#171d30] hover:text-ax-text transition-colors cursor-default">Perpetuals</span>
            <span className="rounded-md border border-transparent px-2.5 py-1 hover:border-[#2b3552] hover:bg-[#171d30] hover:text-ax-text transition-colors cursor-default">Portfolio</span>
          </nav>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="hidden lg:flex w-[250px] items-center gap-2 rounded-full border border-ax-border bg-ax-bg px-3 py-1.5 text-left transition-colors hover:border-[#7d8596] hover:bg-[#f4f6fa14]"
          >
            <Search size={14} className="text-ax-text-dim shrink-0" />
            <span className="text-[12px] text-ax-text-dim">Search by token or CA...</span>
          </button>
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
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}
