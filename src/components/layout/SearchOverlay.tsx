import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Clock3, LineChart, Search, Zap } from 'lucide-react';
import { useTokenStore } from '../../store/tokenStore';
import { useTradingStore } from '../../store/tradingStore';
import type { TokenState } from '../../tokens/types';

const HISTORY_STORAGE_KEY = 'memex:search:history:v1';
const SEARCH_CHIPS = ['pump', 'bonk', 'bags', 'usd1', 'og mode'] as const;
type SearchChip = (typeof SEARCH_CHIPS)[number];
type SortBy = 'time' | 'mcap' | 'volume1h';

interface Props {
  open: boolean;
  onClose: () => void;
}

function fmtUsd(v: number): string {
  if (!Number.isFinite(v)) return '$0';
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function shuffleSeeded<T>(items: T[], seed: number): T[] {
  const out = items.slice();
  let s = seed | 0;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) | 0;
    const j = Math.abs(s) % (i + 1);
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

function loadHistory(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v) => typeof v === 'string');
  } catch {
    return [];
  }
}

function shortName(token: TokenState): string {
  if (token.name.length <= 18) return token.name;
  return `${token.name.slice(0, 18)}...`;
}

export default function SearchOverlay({ open, onClose }: Props) {
  const navigate = useNavigate();
  const quickBuy = useTradingStore((s) => s.quickBuy);
  const setActiveToken = useTokenStore((s) => s.setActiveToken);
  const tokensById = useTokenStore((s) => s.tokensById);
  const tokens = useMemo(() => Object.values(tokensById), [tokensById]);

  const [query, setQuery] = useState('');
  const [chipFilters, setChipFilters] = useState<SearchChip[]>([]);
  const [graduatedOnly, setGraduatedOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>('time');
  const [historyIds, setHistoryIds] = useState<string[]>(() => loadHistory());
  const [seed, setSeed] = useState(() => Date.now());
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setSeed(Date.now());
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  const historyTokens = useMemo(() => {
    const byId = tokensById;
    return historyIds.map((id) => byId[id]).filter((t): t is TokenState => Boolean(t));
  }, [historyIds, tokensById]);

  const randomFallback = useMemo(() => {
    return shuffleSeeded(tokens, seed).slice(0, 12);
  }, [seed, tokens]);

  const hasActiveFilters = query.trim().length > 0 || chipFilters.length > 0 || graduatedOnly;

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const source = hasActiveFilters ? tokens : (historyTokens.length > 0 ? historyTokens : randomFallback);
    const out = source.filter((token) => {
      if (graduatedOnly && token.phase !== 'MIGRATED') return false;
      if (q) {
        const hay = `${token.name} ${token.ticker} ${token.id}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (chipFilters.length > 0) {
        const hay = `${token.name} ${token.ticker}`.toLowerCase();
        for (let i = 0; i < chipFilters.length; i++) {
          if (!hay.includes(chipFilters[i]!)) return false;
        }
      }
      return true;
    });

    out.sort((a, b) => {
      if (sortBy === 'mcap') return b.mcapUsd - a.mcapUsd;
      if (sortBy === 'volume1h') return b.vol5mUsd - a.vol5mUsd;
      return b.createdAtSimMs - a.createdAtSimMs;
    });
    return out.slice(0, 60);
  }, [chipFilters, graduatedOnly, hasActiveFilters, historyTokens, query, randomFallback, sortBy, tokens]);

  const addHistory = (tokenId: string) => {
    setHistoryIds((prev) => {
      const next = [tokenId, ...prev.filter((id) => id !== tokenId)].slice(0, 24);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(next));
      }
      return next;
    });
  };

  const openToken = (token: TokenState) => {
    addHistory(token.id);
    setActiveToken(token.id);
    navigate(`/token/${token.id}`);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[140] bg-black/50 px-4 py-8" onClick={onClose}>
      <div
        className="mx-auto flex h-[78vh] w-full max-w-[980px] flex-col overflow-hidden rounded-xl border border-ax-border bg-ax-surface shadow-2xl"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-ax-border px-3 py-2">
          <div className="flex items-center gap-2 overflow-x-auto">
            {SEARCH_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() =>
                  setChipFilters((prev) =>
                    prev.includes(chip) ? prev.filter((v) => v !== chip) : prev.concat([chip])
                  )
                }
                className={[
                  'rounded-md border px-2 py-1 text-[12px] capitalize',
                  chipFilters.includes(chip)
                    ? 'border-[#4f6dff88] bg-[#4f6dff22] text-[#9fb2ff]'
                    : 'border-ax-border bg-ax-surface2 text-ax-text-dim hover:text-ax-text',
                ].join(' ')}
              >
                {chip}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setGraduatedOnly((v) => !v)}
              className={[
                'rounded-md border px-2 py-1 text-[12px]',
                graduatedOnly
                  ? 'border-[#4f6dff88] bg-[#4f6dff22] text-[#9fb2ff]'
                  : 'border-ax-border bg-ax-surface2 text-ax-text-dim hover:text-ax-text',
              ].join(' ')}
            >
              Graduated
            </button>
            <span className="ml-2 text-[12px] text-ax-text-dim">Sort by</span>
            <button
              type="button"
              title="by time"
              onClick={() => setSortBy('time')}
              className={[
                'rounded p-1.5',
                sortBy === 'time' ? 'bg-[#2f5bff2c] text-[#89a4ff]' : 'text-ax-text-dim hover:text-ax-text',
              ].join(' ')}
            >
              <Clock3 size={14} />
            </button>
            <button
              type="button"
              title="sort result by Market Cap"
              onClick={() => setSortBy('mcap')}
              className={[
                'rounded p-1.5',
                sortBy === 'mcap' ? 'bg-[#2f5bff2c] text-[#89a4ff]' : 'text-ax-text-dim hover:text-ax-text',
              ].join(' ')}
            >
              <LineChart size={14} />
            </button>
            <button
              type="button"
              title="sort result by 1hr volume"
              onClick={() => setSortBy('volume1h')}
              className={[
                'rounded p-1.5',
                sortBy === 'volume1h' ? 'bg-[#2f5bff2c] text-[#89a4ff]' : 'text-ax-text-dim hover:text-ax-text',
              ].join(' ')}
            >
              <BarChart3 size={14} />
            </button>
          </div>
          <span className="rounded-full border border-ax-border px-2 py-0.5 text-[11px] text-ax-text-dim">Esc</span>
        </div>

        <div className="border-b border-ax-border px-3 py-2">
          <label className="relative block">
            <Search size={16} className="absolute left-1 top-1/2 -translate-y-1/2 text-ax-text-dim" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, ticker, or CA..."
              className="h-10 w-full bg-transparent pl-7 text-[22px] md:text-[34px] leading-none text-ax-text outline-none placeholder:text-ax-text-dim/70"
            />
          </label>
        </div>

        <div className="px-3 py-2 text-[12px] text-ax-text-dim">{hasActiveFilters ? 'Results' : 'History'}</div>

        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {results.length === 0 ? (
            <div className="flex h-24 items-center justify-center text-ax-text-dim">No tokens found.</div>
          ) : (
            <div className="space-y-1">
              {results.map((token) => (
                <div
                  key={token.id}
                  className="grid cursor-pointer grid-cols-[1fr_108px_108px_108px_122px] items-center gap-2 rounded-md px-2 py-2 hover:bg-ax-surface2"
                  onClick={() => openToken(token)}
                >
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-semibold text-ax-text">
                      {shortName(token)} <span className="font-normal text-ax-text-dim">{token.ticker}</span>
                    </div>
                    <div className="truncate text-[12px] text-ax-text-dim">{token.id}</div>
                  </div>
                  <div className="text-[13px] text-ax-text-dim">
                    MC <span className="text-ax-text">{fmtUsd(token.mcapUsd)}</span>
                  </div>
                  <div className="text-[13px] text-ax-text-dim">
                    V <span className="text-ax-text">{fmtUsd(token.vol5mUsd)}</span>
                  </div>
                  <div className="text-[13px] text-ax-text-dim">
                    L <span className="text-ax-text">{fmtUsd(token.liquidityUsd)}</span>
                  </div>
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      addHistory(token.id);
                      quickBuy(token.id, 0.22);
                    }}
                    className="h-9 rounded-full border border-[#6f8cff88] bg-[#4f6dff] text-[12px] font-semibold text-white inline-flex items-center justify-center gap-1.5 hover:bg-[#5b77ff]"
                  >
                    <Zap size={12} />
                    0.22 SOL
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
