import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  BadgeDollarSign,
  Bot,
  Check,
  Coins,
  Percent,
  Pencil,
  Settings,
  X,
} from 'lucide-react';
import type { TokenState } from '../../tokens/types';
import { selectQuickPositionSummaryByTokenId, useTradingStore } from '../../store/tradingStore';
import { usdToSol, useWalletStore } from '../../store/walletStore';

type Pos = { x: number; y: number };
type DragState = { pointerId: number; dx: number; dy: number } | null;
type PresetId = 'P1' | 'P2' | 'P3';
type SideKey = 'buy' | 'sell';
type MevMode = 'off' | 'reduced' | 'secure';

type PresetQuickValues = { buy: string[]; sell: string[] };
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

interface Props {
  token: TokenState;
  open: boolean;
  onClose: () => void;
}

const PANEL_POS_STORAGE_KEY = 'memex:instant-trade:panel-pos';
const ACTIVE_PRESET_STORAGE_KEY = 'memex:instant-trade:active-preset';
const QUICK_VALUES_STORAGE_KEY = 'memex:instant-trade:quick-values-v1';
const TRADE_SETTINGS_STORAGE_KEY = 'memex:instant-trade:trade-settings-v1';

const DEFAULT_QUICK_VALUES: Record<PresetId, PresetQuickValues> = {
  P1: { buy: ['0.1', '0.5', '1', '5'], sell: ['10', '25', '50', '100'] },
  P2: { buy: ['0.01', '0.1', '0.5', '1'], sell: ['10', '25', '50', '100'] },
  P3: { buy: ['0.00001', '0.0001', '0.001', '1'], sell: ['10', '25', '50', '100'] },
};

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

let topZIndex = 95;

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
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

function loadObject<T>(key: string, fallback: T): T {
  if (!isBrowser()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function fmtUsd(v: number): string {
  if (!Number.isFinite(v)) return '$0';
  const a = Math.abs(v);
  if (a >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function fmtSol(v: number): string {
  if (!Number.isFinite(v)) return '0';
  const a = Math.abs(v);
  if (a >= 100) return v.toFixed(1);
  if (a >= 1) return v.toFixed(3);
  if (a >= 0.01) return v.toFixed(4);
  return v.toFixed(6);
}

function mevLabel(mode: MevMode): string {
  if (mode === 'reduced') return 'Reduced';
  if (mode === 'secure') return 'Secure';
  return 'Off';
}

function loadPreset(): PresetId {
  if (!isBrowser()) return 'P1';
  const raw = window.localStorage.getItem(ACTIVE_PRESET_STORAGE_KEY);
  if (raw === 'P1' || raw === 'P2' || raw === 'P3') return raw;
  return 'P1';
}

export default function InstantTradePanel({ token, open, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<DragState>(null);
  const [zIndex, setZIndex] = useState(() => ++topZIndex);
  const [activePreset, setActivePreset] = useState<PresetId>(() => loadPreset());
  const [quickValues, setQuickValues] = useState<Record<PresetId, PresetQuickValues>>(() =>
    loadObject(QUICK_VALUES_STORAGE_KEY, DEFAULT_QUICK_VALUES)
  );
  const [tradeSettings, setTradeSettings] = useState<TradeSettingsMap>(() =>
    loadObject(TRADE_SETTINGS_STORAGE_KEY, DEFAULT_TRADE_SETTINGS)
  );
  const [editingQuickValues, setEditingQuickValues] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsPreset, setSettingsPreset] = useState<PresetId>('P1');
  const [settingsSide, setSettingsSide] = useState<SideKey>('buy');
  const [buySelected, setBuySelected] = useState(parseNumeric(DEFAULT_QUICK_VALUES.P1.buy[0]!) ?? 0.1);
  const [advancedEnabled, setAdvancedEnabled] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);

  const quickBuy = useTradingStore((s) => s.quickBuy);
  const quickSell = useTradingStore((s) => s.quickSell);
  const solBalance = useWalletStore((s) => s.solBalance);
  const quickPositionSummarySelector = useMemo(
    () => selectQuickPositionSummaryByTokenId(token.id, Number.isFinite(token.lastPriceUsd) ? token.lastPriceUsd : 0),
    [token.id, token.lastPriceUsd]
  );
  const quickPositionSummary = useTradingStore(quickPositionSummarySelector);

  const defaultPos = useMemo<Pos>(() => {
    if (!isBrowser()) return { x: 96, y: 140 };
    return { x: 96, y: Math.max(80, window.innerHeight - 470) };
  }, []);
  const [pos, setPos] = useState<Pos>(() => loadObject(PANEL_POS_STORAGE_KEY, defaultPos));

  const activeQuick = quickValues[activePreset];
  const activeSettings = tradeSettings[activePreset];
  const buySettings = activeSettings.buy;
  const sellSettings = activeSettings.sell;

  const safePrice = Number.isFinite(token.lastPriceUsd) ? token.lastPriceUsd : 0;
  const positionQty = quickPositionSummary.qty;
  const holdingUsd = quickPositionSummary.holdingUsd;
  const boughtUsd = quickPositionSummary.boughtUsd;
  const soldUsd = quickPositionSummary.soldUsd;
  const realizedUsd = quickPositionSummary.realizedUsd;
  const unrealizedUsd = quickPositionSummary.unrealizedUsd;
  const totalPnlUsd = quickPositionSummary.totalPnlUsd;
  const pnlPct = boughtUsd > 0 ? (totalPnlUsd / boughtUsd) * 100 : 0;

  const clampToViewport = useCallback((raw: Pos): Pos => {
    if (!isBrowser()) return raw;
    const margin = 8;
    const rect = panelRef.current?.getBoundingClientRect();
    const width = rect?.width ?? 326;
    const height = rect?.height ?? 500;
    return {
      x: clamp(raw.x, margin, Math.max(margin, window.innerWidth - width - margin)),
      y: clamp(raw.y, margin, Math.max(margin, window.innerHeight - height - margin)),
    };
  }, []);

  const bringToFront = useCallback(() => {
    topZIndex += 1;
    setZIndex(topZIndex);
  }, []);

  const onHeaderPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-panel-control="true"]')) return;
      const rect = panelRef.current?.getBoundingClientRect();
      if (!rect) return;
      bringToFront();
      setDragState({
        pointerId: e.pointerId,
        dx: e.clientX - rect.left,
        dy: e.clientY - rect.top,
      });
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [bringToFront]
  );

  const onHeaderPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragState || e.pointerId !== dragState.pointerId) return;
      setPos(clampToViewport({ x: e.clientX - dragState.dx, y: e.clientY - dragState.dy }));
    },
    [dragState, clampToViewport]
  );

  const onHeaderPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragState || e.pointerId !== dragState.pointerId) return;
      setDragState(null);
    },
    [dragState]
  );

  useEffect(() => {
    if (!open || !isBrowser()) return;
    setPos((prev) => clampToViewport(prev));
    const onResize = () => setPos((prev) => clampToViewport(prev));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open, clampToViewport]);

  useEffect(() => {
    if (!isBrowser()) return;
    window.localStorage.setItem(PANEL_POS_STORAGE_KEY, JSON.stringify(pos));
  }, [pos]);

  useEffect(() => {
    if (!isBrowser()) return;
    window.localStorage.setItem(ACTIVE_PRESET_STORAGE_KEY, activePreset);
  }, [activePreset]);

  useEffect(() => {
    if (!isBrowser()) return;
    window.localStorage.setItem(QUICK_VALUES_STORAGE_KEY, JSON.stringify(quickValues));
  }, [quickValues]);

  useEffect(() => {
    if (!isBrowser()) return;
    window.localStorage.setItem(TRADE_SETTINGS_STORAGE_KEY, JSON.stringify(tradeSettings));
  }, [tradeSettings]);

  useEffect(() => {
    const first = parseNumeric(activeQuick.buy[0] ?? '');
    setBuySelected(first ?? 0.1);
  }, [activeQuick.buy]);

  const openSettings = useCallback((preset: PresetId) => {
    setSettingsPreset(preset);
    setSettingsSide('buy');
    setShowSettings(true);
  }, []);

  const onPresetClick = useCallback((preset: PresetId) => {
    if (preset === activePreset) {
      openSettings(preset);
      return;
    }
    setActivePreset(preset);
    setStatusText(null);
  }, [activePreset, openSettings]);

  const handleQuickBuy = useCallback((amountSol: number) => {
    const slippage = parseNumeric(buySettings.slippage, true) ?? 1;
    const priority = parseNumeric(buySettings.priority, true) ?? 0;
    const bribe = parseNumeric(buySettings.bribe, true) ?? 0;
    const result = quickBuy(token.id, amountSol, {
      slippagePct: slippage,
      prioritySol: priority,
      bribeSol: bribe,
    });
    if (!result.ok) {
      setStatusText(result.reason ?? 'Buy rejected');
      return;
    }
    if (result.submitted) {
      setStatusText(`Buy submitted (${Math.max(0, Math.round(result.etaMs ?? 0))} ms)`);
      return;
    }
    setStatusText(`Buy submitted`);
  }, [buySettings.bribe, buySettings.priority, buySettings.slippage, quickBuy, token.id]);

  const handleQuickSellPct = useCallback((pct: number) => {
    if (!Number.isFinite(pct) || pct <= 0) return;
    if (positionQty <= 0 || holdingUsd <= 0) {
      setStatusText('No position to sell');
      return;
    }
    const targetUsd = holdingUsd * (Math.min(100, pct) / 100);
    const slippage = parseNumeric(sellSettings.slippage, true) ?? 1;
    const priority = parseNumeric(sellSettings.priority, true) ?? 0;
    const bribe = parseNumeric(sellSettings.bribe, true) ?? 0;
    const result = quickSell(token.id, usdToSol(targetUsd), {
      slippagePct: slippage,
      prioritySol: priority,
      bribeSol: bribe,
    });
    if (!result.ok) {
      setStatusText(result.reason ?? 'Sell rejected');
      return;
    }
    if (result.submitted) {
      setStatusText(`Sell submitted (${Math.max(0, Math.round(result.etaMs ?? 0))} ms)`);
      return;
    }
    setStatusText(`Sell submitted`);
  }, [holdingUsd, positionQty, quickSell, sellSettings.bribe, sellSettings.priority, sellSettings.slippage, token.id]);

  const updateQuickValue = useCallback((side: SideKey, index: number, raw: string) => {
    setQuickValues((current) => {
      const preset = current[activePreset];
      const next = [...preset[side]];
      next[index] = raw;
      return { ...current, [activePreset]: { ...preset, [side]: next } };
    });
  }, [activePreset]);

  const normalizeQuickValue = useCallback((side: SideKey, index: number) => {
    setQuickValues((current) => {
      const preset = current[activePreset];
      const fallback = DEFAULT_QUICK_VALUES[activePreset][side][index]!;
      const raw = preset[side][index] ?? fallback;
      const normalized = normalizeNumber(raw, fallback, side === 'sell' ? 100 : undefined);
      const next = [...preset[side]];
      next[index] = normalized;
      return { ...current, [activePreset]: { ...preset, [side]: next } };
    });
  }, [activePreset]);

  const finalizeQuickValues = useCallback(() => {
    setQuickValues((current) => {
      const preset = current[activePreset];
      return {
        ...current,
        [activePreset]: {
          buy: preset.buy.map((v, i) => normalizeNumber(v, DEFAULT_QUICK_VALUES[activePreset].buy[i]!)),
          sell: preset.sell.map((v, i) => normalizeNumber(v, DEFAULT_QUICK_VALUES[activePreset].sell[i]!, 100)),
        },
      };
    });
  }, [activePreset]);

  const updateSetting = useCallback(<K extends keyof SideTradeSettings>(
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
  }, [settingsPreset]);

  const normalizeSetting = useCallback((side: SideKey, key: keyof SideTradeSettings) => {
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
  }, [settingsPreset]);

  if (!open || !isBrowser()) return null;

  const modal = tradeSettings[settingsPreset][settingsSide];

  return createPortal(
    <>
      <div
        ref={panelRef}
        className="fixed left-0 top-0 hidden xl:block"
        style={{ width: 326, transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`, zIndex }}
        onPointerDown={bringToFront}
      >
        <div className="overflow-hidden rounded-xl border border-ax-border bg-ax-surface/95 shadow-2xl backdrop-blur">
          <div
            className="flex cursor-grab items-center gap-1 border-b border-ax-border bg-ax-bg/80 px-2 py-2 touch-none active:cursor-grabbing"
            onPointerDown={onHeaderPointerDown}
            onPointerMove={onHeaderPointerMove}
            onPointerUp={onHeaderPointerUp}
            onPointerCancel={onHeaderPointerUp}
          >
            {(['P1', 'P2', 'P3'] as const).map((preset) => (
              <button
                key={preset}
                data-panel-control="true"
                onClick={() => onPresetClick(preset)}
                className={[
                  'rounded px-2 py-0.5 text-[12px] font-semibold',
                  activePreset === preset ? 'text-[#5f86ff]' : 'text-ax-text-dim hover:text-ax-text',
                ].join(' ')}
              >
                {preset}
              </button>
            ))}

            <button
              data-panel-control="true"
              onClick={() => {
                if (editingQuickValues) finalizeQuickValues();
                setEditingQuickValues((v) => !v);
              }}
              className={[
                'ml-1 rounded p-1 hover:bg-ax-surface2',
                editingQuickValues ? 'text-[#5f86ff]' : 'text-ax-text-dim hover:text-ax-text',
              ].join(' ')}
              title={editingQuickValues ? 'Save quick values' : 'Edit quick values'}
            >
              {editingQuickValues ? <Check size={12} /> : <Pencil size={12} />}
            </button>

            <button
              data-panel-control="true"
              onClick={() => openSettings(activePreset)}
              className="ml-auto rounded p-1 text-ax-text-dim hover:bg-ax-surface2 hover:text-ax-text"
            >
              <Settings size={12} />
            </button>

            <button
              data-panel-control="true"
              className="rounded p-1 text-ax-text-dim hover:bg-ax-surface2 hover:text-ax-text"
              onClick={onClose}
            >
              <X size={12} />
            </button>
          </div>

          <div className="space-y-3 p-3 text-ax-text">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-ax-text-dim">Buy</span>
              <span className="inline-flex items-center gap-1 text-[11px] text-ax-text-dim">
                <Coins size={12} className="text-[#6ee7f0]" />
                {fmtSol(solBalance)}
              </span>
            </div>

            <div className="grid grid-cols-4 gap-2">
              {activeQuick.buy.map((value, idx) => {
                if (editingQuickValues) {
                  return (
                    <input
                      key={`buy-input-${idx}`}
                      value={value}
                      onChange={(e) => updateQuickValue('buy', idx, e.target.value)}
                      onBlur={() => normalizeQuickValue('buy', idx)}
                      className="h-9 w-full rounded-full border border-[#0cc7a0aa] bg-ax-surface2 px-3 text-[11px] font-semibold text-[#25e8c2] outline-none"
                    />
                  );
                }
                const parsed = parseNumeric(value);
                return (
                  <button
                    key={`buy-btn-${idx}`}
                    onClick={() => {
                      if (parsed == null) return;
                      setBuySelected(parsed);
                      handleQuickBuy(parsed);
                    }}
                    className={[
                      'h-9 rounded-full border text-[11px] font-semibold',
                      parsed != null && Math.abs(buySelected - parsed) < 1e-12
                        ? 'border-[#0cc7a0] bg-[#0cc7a022] text-[#25e8c2]'
                        : 'border-[#0cc7a0aa] text-[#25e8c2] hover:bg-[#0cc7a012]',
                    ].join(' ')}
                  >
                    {value}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between text-[11px] text-ax-text-dim">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1"><Percent size={12} />{buySettings.slippage}%</span>
                <span className="inline-flex items-center gap-1 text-ax-yellow"><BadgeDollarSign size={12} />{buySettings.priority}</span>
                <span className="inline-flex items-center gap-1 text-ax-yellow"><Coins size={12} />{buySettings.bribe}</span>
                <span className="inline-flex items-center gap-1"><Bot size={12} />{mevLabel(buySettings.mevMode)}</span>
              </div>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-ax-border bg-transparent"
                  checked={advancedEnabled}
                  onChange={(e) => setAdvancedEnabled(e.target.checked)}
                />
                Adv.
              </label>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-ax-text-dim">Sell</span>
              <span className="inline-flex items-center gap-1 text-[11px] text-ax-text-dim">
                {positionQty.toFixed(0)} {token.ticker} | {fmtUsd(holdingUsd)}
              </span>
            </div>

            <div className="grid grid-cols-4 gap-2">
              {activeQuick.sell.map((value, idx) => {
                if (editingQuickValues) {
                  return (
                    <input
                      key={`sell-input-${idx}`}
                      value={value}
                      onChange={(e) => updateQuickValue('sell', idx, e.target.value)}
                      onBlur={() => normalizeQuickValue('sell', idx)}
                      className="h-9 w-full rounded-full border border-[#da3d7d99] bg-ax-surface2 px-3 text-[11px] font-semibold text-[#f04d93] outline-none"
                    />
                  );
                }
                const parsed = parseNumeric(value);
                return (
                  <button
                    key={`sell-btn-${idx}`}
                    onClick={() => parsed != null && handleQuickSellPct(parsed)}
                    className="h-9 rounded-full border border-[#da3d7d99] text-[11px] font-semibold text-[#f04d93] hover:bg-[#f04d9312]"
                  >
                    {value}%
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between text-[11px] text-ax-text-dim">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1"><Percent size={12} />{sellSettings.slippage}%</span>
                <span className="inline-flex items-center gap-1 text-ax-yellow"><BadgeDollarSign size={12} />{sellSettings.priority}</span>
                <span className="inline-flex items-center gap-1 text-ax-yellow"><Coins size={12} />{sellSettings.bribe}</span>
                <span className="inline-flex items-center gap-1"><Bot size={12} />{mevLabel(sellSettings.mevMode)}</span>
              </div>
              <span className="text-[#f04d93]">Sell Init.</span>
            </div>

            <div className="grid grid-cols-4 gap-2 border-t border-ax-border pt-2 text-[11px]">
              <div className="text-center text-[#25e8c2]">{fmtUsd(boughtUsd)}</div>
              <div className="text-center text-[#f04d93]">{fmtUsd(soldUsd)}</div>
              <div className="text-center text-ax-text-dim">{fmtUsd(holdingUsd)}</div>
              <div className={['text-center', totalPnlUsd >= 0 ? 'text-[#25e8c2]' : 'text-[#f04d93]'].join(' ')}>
                {totalPnlUsd >= 0 ? '+' : '-'}{fmtUsd(Math.abs(totalPnlUsd))} ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(0)}%)
              </div>
            </div>

            {statusText && (
              <div className="rounded border border-ax-border bg-ax-bg/50 px-2 py-1 text-[11px] text-ax-text-dim">
                {statusText}
              </div>
            )}
          </div>
        </div>
      </div>

      {showSettings && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45">
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
                {(['P1', 'P2', 'P3'] as const).map((preset) => (
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
    </>,
    document.body
  );
}
