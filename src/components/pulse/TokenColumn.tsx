import { useEffect, useMemo, useRef, useState } from 'react';
import { BadgeDollarSign, Bolt, Coins, Percent, SlidersHorizontal, X } from 'lucide-react';
import type { TokenState } from '../../tokens/types';
import solIcon from '../../assets/sol-fill.svg';
import TokenCard from './TokenCard';

type PresetId = 'P1' | 'P2' | 'P3';
type SideKey = 'buy' | 'sell';
type MevMode = 'off' | 'reduced' | 'secure';

type SideTradeSettings = {
  slippage: string;
  priority: string;
  bribe: string;
  autoFee: boolean;
  maxFee: string;
  mevMode: MevMode;
  rpc: string;
};

type PresetTradeSettings = { buy: SideTradeSettings; sell: SideTradeSettings };
type TradeSettingsMap = Record<PresetId, PresetTradeSettings>;

const PRESETS: PresetId[] = ['P1', 'P2', 'P3'];
const ACTIVE_PRESET_STORAGE_KEY = 'memex:instant-trade:active-preset';
const TRADE_SETTINGS_STORAGE_KEY = 'memex:instant-trade:trade-settings-v1';

const DEFAULT_TRADE_SETTINGS: TradeSettingsMap = {
  P1: {
    buy: { slippage: '50', priority: '0.0003', bribe: '0.0003', autoFee: false, maxFee: '0.1', mevMode: 'off', rpc: 'https://a.e.com' },
    sell: { slippage: '55', priority: '0.0001', bribe: '0.0001', autoFee: false, maxFee: '0.1', mevMode: 'off', rpc: 'https://a.e.com' },
  },
  P2: {
    buy: { slippage: '35', priority: '0.0002', bribe: '0.0002', autoFee: false, maxFee: '0.1', mevMode: 'off', rpc: 'https://a.e.com' },
    sell: { slippage: '35', priority: '0.0002', bribe: '0.0002', autoFee: false, maxFee: '0.1', mevMode: 'off', rpc: 'https://a.e.com' },
  },
  P3: {
    buy: { slippage: '20', priority: '0.03', bribe: '0.03', autoFee: false, maxFee: '0.1', mevMode: 'off', rpc: 'https://a.e.com' },
    sell: { slippage: '20', priority: '0.03', bribe: '0', autoFee: false, maxFee: '0.1', mevMode: 'off', rpc: 'https://a.e.com' },
  },
};

function amountStorageKey(title: string): string {
  return `memex:pulse:buy-amount:${title}`;
}

function parsePositive(raw: string): number | null {
  const normalized = raw.trim().replace(',', '.');
  if (!normalized) return null;
  const n = Number(normalized);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function parseNumeric(raw: string, allowZero = false): number | null {
  const normalized = raw.trim().replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  if (allowZero ? parsed < 0 : parsed <= 0) return null;
  return parsed;
}

function normalizeNumber(raw: string, fallback: string, max?: number, allowZero = false): string {
  const parsed = parseNumeric(raw, allowZero);
  if (parsed == null) return fallback;
  const safe = max == null ? parsed : Math.min(max, parsed);
  return safe.toString();
}

function formatAmount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0.05';
  if (n >= 1) return n.toFixed(2).replace(/\.00$/, '');
  if (n >= 0.1) return n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

function loadObject<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function loadPreset(): PresetId {
  if (typeof window === 'undefined') return 'P1';
  const raw = window.localStorage.getItem(ACTIVE_PRESET_STORAGE_KEY);
  if (raw === 'P1' || raw === 'P2' || raw === 'P3') return raw;
  return 'P1';
}

export interface PulseColumnFilters {
  newPairs: boolean;
  finalStretch: boolean;
  migrated: boolean;
}

interface Props {
  title: string;
  tokens: TokenState[];
  accent?: string;
  filters: PulseColumnFilters;
  onFiltersChange: (next: PulseColumnFilters) => void;
}

export default function TokenColumn({
  title,
  tokens,
  accent = '#00d4a1',
  filters,
  onFiltersChange,
}: Props) {
  const [showFilters, setShowFilters] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [activePreset, setActivePreset] = useState<PresetId>(() => loadPreset());
  const [settingsPreset, setSettingsPreset] = useState<PresetId>('P1');
  const [settingsSide, setSettingsSide] = useState<SideKey>('buy');
  const [tradeSettings, setTradeSettings] = useState<TradeSettingsMap>(() =>
    loadObject(TRADE_SETTINGS_STORAGE_KEY, DEFAULT_TRADE_SETTINGS)
  );
  const [quickBuyAmount, setQuickBuyAmount] = useState<number>(() => {
    if (typeof window === 'undefined') return 0.05;
    const parsed = parsePositive(window.localStorage.getItem(amountStorageKey(title)) ?? '');
    return parsed ?? 0.05;
  });
  const [amountInput, setAmountInput] = useState<string>(() => formatAmount(quickBuyAmount));

  const filtersRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(amountStorageKey(title), formatAmount(quickBuyAmount));
  }, [quickBuyAmount, title]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(ACTIVE_PRESET_STORAGE_KEY, activePreset);
  }, [activePreset]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(TRADE_SETTINGS_STORAGE_KEY, JSON.stringify(tradeSettings));
  }, [tradeSettings]);

  useEffect(() => {
    const onPointerDown = (ev: PointerEvent) => {
      if (!filtersRef.current) return;
      const target = ev.target as Node | null;
      if (target && filtersRef.current.contains(target)) return;
      setShowFilters(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, []);

  const commitAmount = () => {
    const parsed = parsePositive(amountInput);
    if (parsed == null) {
      setAmountInput(formatAmount(quickBuyAmount));
      return;
    }
    setQuickBuyAmount(parsed);
    setAmountInput(formatAmount(parsed));
  };

  const onPresetClick = (preset: PresetId) => {
    if (preset === activePreset) {
      setSettingsPreset(preset);
      setSettingsSide('buy');
      setShowSettings(true);
      return;
    }
    setActivePreset(preset);
  };

  const toggleFilter = (key: keyof PulseColumnFilters) => {
    const next: PulseColumnFilters = {
      ...filters,
      [key]: !filters[key],
    };
    if (!next.newPairs && !next.finalStretch && !next.migrated) return;
    onFiltersChange(next);
  };

  const updateSetting = <K extends keyof SideTradeSettings>(
    side: SideKey,
    key: K,
    value: SideTradeSettings[K]
  ) => {
    setTradeSettings((current) => {
      const preset = current[settingsPreset];
      return {
        ...current,
        [settingsPreset]: {
          ...preset,
          [side]: {
            ...preset[side],
            [key]: value,
          },
        },
      };
    });
  };

  const normalizeSetting = (side: SideKey, key: keyof SideTradeSettings) => {
    setTradeSettings((current) => {
      const preset = current[settingsPreset];
      const fallback = DEFAULT_TRADE_SETTINGS[settingsPreset][side];
      const s = { ...preset[side] };
      if (key === 'slippage') s.slippage = normalizeNumber(s.slippage, fallback.slippage, 100);
      if (key === 'priority') s.priority = normalizeNumber(s.priority, fallback.priority, undefined, true);
      if (key === 'bribe') s.bribe = normalizeNumber(s.bribe, fallback.bribe, undefined, true);
      if (key === 'maxFee') s.maxFee = normalizeNumber(s.maxFee, fallback.maxFee, undefined, true);
      if (key === 'rpc') s.rpc = (s.rpc || fallback.rpc).trim() || fallback.rpc;
      return { ...current, [settingsPreset]: { ...preset, [side]: s } };
    });
  };

  const buySettings = tradeSettings[activePreset].buy;
  const quickBuyOptions = useMemo(() => ({
    slippagePct: parseNumeric(buySettings.slippage, true) ?? 1,
    prioritySol: parseNumeric(buySettings.priority, true) ?? 0,
    bribeSol: parseNumeric(buySettings.bribe, true) ?? 0,
  }), [buySettings.bribe, buySettings.priority, buySettings.slippage]);

  const modal = tradeSettings[settingsPreset][settingsSide];

  return (
    <div className="flex flex-col flex-1 min-w-0 rounded-lg border border-ax-border bg-ax-surface shadow-[0_0_0_1px_rgba(24,30,51,0.22)] overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-ax-border bg-ax-surface2/45 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: accent }} />
          <span className="text-[13px] font-semibold text-ax-text truncate">{title}</span>
          <span className="text-[10px] text-ax-text-dim bg-ax-surface px-1.5 py-0.5 rounded shrink-0">
            {tokens.length}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <div className="h-7 rounded-full border border-ax-border bg-ax-surface px-2 inline-flex items-center gap-1.5">
            <Bolt size={11} className="text-[#6f8dff]" />
            <input
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              onBlur={commitAmount}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitAmount();
                }
              }}
              className="w-12 bg-transparent text-[11px] text-ax-text outline-none"
            />
            <img src={solIcon} alt="SOL" className="h-3.5 w-3.5" />
          </div>

          <div className="h-7 rounded-full border border-ax-border bg-ax-surface px-1 inline-flex items-center">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => onPresetClick(preset)}
                className={[
                  'h-5 px-1.5 rounded text-[10px] transition-colors',
                  activePreset === preset
                    ? 'text-[#6f8dff] bg-[#6f8dff20]'
                    : 'text-ax-text-dim hover:text-ax-text',
                ].join(' ')}
              >
                {preset}
              </button>
            ))}
          </div>

          <div className="relative" ref={filtersRef}>
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              className="relative h-7 w-7 rounded border border-ax-border bg-ax-surface inline-flex items-center justify-center text-ax-text-dim hover:text-ax-text"
              title="Column filters"
            >
              <SlidersHorizontal size={12} />
              <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-[#4f6dff]" />
            </button>
            {showFilters && (
              <div className="absolute right-0 top-8 z-30 min-w-[142px] rounded border border-ax-border bg-ax-surface p-2 shadow-lg text-[11px]">
                <label className="flex items-center gap-2 py-1">
                  <input
                    type="checkbox"
                    checked={filters.newPairs}
                    onChange={() => toggleFilter('newPairs')}
                  />
                  <span className="text-ax-text">New Pairs</span>
                </label>
                <label className="flex items-center gap-2 py-1">
                  <input
                    type="checkbox"
                    checked={filters.finalStretch}
                    onChange={() => toggleFilter('finalStretch')}
                  />
                  <span className="text-ax-text">Final Stretch</span>
                </label>
                <label className="flex items-center gap-2 py-1">
                  <input
                    type="checkbox"
                    checked={filters.migrated}
                    onChange={() => toggleFilter('migrated')}
                  />
                  <span className="text-ax-text">Migrated</span>
                </label>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 p-2 overflow-y-auto flex-1 bg-ax-bg/35">
        {tokens.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-ax-text-dim text-xs opacity-50">
            No tokens
          </div>
        ) : (
          tokens.map((token) => (
            <TokenCard
              key={token.id}
              token={token}
              quickBuyAmount={quickBuyAmount}
              quickBuyOptions={quickBuyOptions}
            />
          ))
        )}
      </div>

      {showSettings && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-3">
          <div className="w-[380px] rounded-xl border border-ax-border bg-ax-surface shadow-2xl">
            <div className="flex items-center justify-between border-b border-ax-border px-4 py-3">
              <span className="text-sm font-semibold text-ax-text">Trading Settings</span>
              <button
                onClick={() => setShowSettings(false)}
                className="rounded p-1 text-ax-text-dim hover:bg-ax-surface2 hover:text-ax-text"
              >
                <X size={14} />
              </button>
            </div>

            <div className="space-y-4 p-4">
              <div className="grid grid-cols-3 gap-2 rounded-lg border border-ax-border p-1">
                {PRESETS.map((preset) => (
                  <button
                    key={`settings-${preset}`}
                    onClick={() => setSettingsPreset(preset)}
                    className={[
                      'h-8 rounded text-xs font-semibold',
                      settingsPreset === preset ? 'bg-[#2f5bff33] text-[#6f8fff]' : 'text-ax-text-dim hover:text-ax-text',
                    ].join(' ')}
                  >
                    PRESET {preset.slice(1)}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2 rounded-lg border border-ax-border p-1">
                <button
                  onClick={() => setSettingsSide('buy')}
                  className={[
                    'h-8 rounded text-sm font-semibold',
                    settingsSide === 'buy' ? 'bg-[#0cc7a022] text-[#25e8c2]' : 'text-ax-text-dim hover:text-ax-text',
                  ].join(' ')}
                >
                  Buy Settings
                </button>
                <button
                  onClick={() => setSettingsSide('sell')}
                  className={[
                    'h-8 rounded text-sm font-semibold',
                    settingsSide === 'sell' ? 'bg-[#f04d931f] text-[#f04d93]' : 'text-ax-text-dim hover:text-ax-text',
                  ].join(' ')}
                >
                  Sell Settings
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="rounded border border-ax-border bg-ax-surface2 px-2 py-2">
                  <input
                    value={modal.slippage}
                    onChange={(e) => updateSetting(settingsSide, 'slippage', e.target.value)}
                    onBlur={() => normalizeSetting(settingsSide, 'slippage')}
                    className="h-8 w-full bg-transparent text-center text-[18px] font-semibold text-ax-text outline-none"
                  />
                  <div className="mt-1 inline-flex items-center gap-1 text-[11px] uppercase tracking-wide text-ax-text-dim"><Percent size={11} />Slippage</div>
                </div>
                <div className="rounded border border-ax-border bg-ax-surface2 px-2 py-2">
                  <input
                    value={modal.priority}
                    onChange={(e) => updateSetting(settingsSide, 'priority', e.target.value)}
                    onBlur={() => normalizeSetting(settingsSide, 'priority')}
                    className="h-8 w-full bg-transparent text-center text-[18px] font-semibold text-ax-text outline-none"
                  />
                  <div className="mt-1 inline-flex items-center gap-1 text-[11px] uppercase tracking-wide text-ax-text-dim"><BadgeDollarSign size={11} />Priority</div>
                </div>
                <div className="rounded border border-ax-border bg-ax-surface2 px-2 py-2">
                  <input
                    value={modal.bribe}
                    onChange={(e) => updateSetting(settingsSide, 'bribe', e.target.value)}
                    onBlur={() => normalizeSetting(settingsSide, 'bribe')}
                    className="h-8 w-full bg-transparent text-center text-[18px] font-semibold text-ax-text outline-none"
                  />
                  <div className="mt-1 inline-flex items-center gap-1 text-[11px] uppercase tracking-wide text-ax-text-dim"><Coins size={11} />Bribe</div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <label className="inline-flex items-center gap-2 text-sm text-ax-text">
                  <input
                    type="checkbox"
                    checked={modal.autoFee}
                    onChange={(e) => updateSetting(settingsSide, 'autoFee', e.target.checked)}
                    className="h-4 w-4 rounded border-ax-border bg-transparent"
                  />
                  Auto Fee
                </label>
                <div className="flex-1 rounded-full border border-ax-border bg-ax-bg px-4 py-2">
                  <input
                    value={modal.maxFee}
                    onChange={(e) => updateSetting(settingsSide, 'maxFee', e.target.value)}
                    onBlur={() => normalizeSetting(settingsSide, 'maxFee')}
                    className="w-full bg-transparent text-sm text-ax-text outline-none"
                    placeholder="MAX FEE 0.1"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="inline-flex items-center gap-1 text-sm font-semibold text-ax-text">MEV Mode</div>
                <div className="grid grid-cols-3 gap-2 rounded-lg border border-ax-border p-1">
                  {(['off', 'reduced', 'secure'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => updateSetting(settingsSide, 'mevMode', mode)}
                      className={[
                        'h-8 rounded text-sm',
                        modal.mevMode === mode ? 'bg-[#2f5bff33] text-[#6f8fff]' : 'text-ax-text-dim hover:text-ax-text',
                      ].join(' ')}
                    >
                      {mode === 'off' ? 'Off' : mode === 'reduced' ? 'Reduced' : 'Secure'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-full border border-ax-border bg-ax-bg px-4 py-2">
                <input
                  value={modal.rpc}
                  onChange={(e) => updateSetting(settingsSide, 'rpc', e.target.value)}
                  onBlur={() => normalizeSetting(settingsSide, 'rpc')}
                  className="w-full bg-transparent text-sm text-ax-text-dim outline-none"
                  placeholder="RPC https://a.e.com"
                />
              </div>

              <button
                onClick={() => {
                  setActivePreset(settingsPreset);
                  setShowSettings(false);
                }}
                className="h-11 w-full rounded-full bg-[#4f6dff] text-sm font-bold text-white hover:bg-[#5f7dff]"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
