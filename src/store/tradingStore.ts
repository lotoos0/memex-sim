// src/store/tradingStore.ts
import { create } from 'zustand';
import type { Candle, Tick } from '../engine/types';
import { persistOrder, persistTrade, saveOrdersSnapshot, saveTradesSnapshot, savePositionHistorySnapshot, loadSnapshots } from '../sim/journal';
import { useTokenStore } from './tokenStore';
import { useWalletStore, solToUsd, usdToSol } from './walletStore';
import { registry } from '../tokens/registry';
import type { UserTradeExecutionNotice } from '../tokens/tokenSim';


/* --- podstawowe typy --- */
export type Side = 'buy' | 'sell';
export type OrdType = 'market' | 'limit' | 'ioc';
export type Mode = 'SIM' | 'LIVE';

/* --- preferencje wykresu --- */
export type ChartType = 'candles' | 'bars' | 'line' | 'area' | 'baseline';
export type Metric = 'price' | 'mcap';

/* --- modele --- */
export interface Order {
  id: string; ts: number; symbol: string;
  side: Side; type: OrdType;
  qty: number; price?: number;
  slPct?: number; tpPct?: number;
  slippagePct: number; reduceOnly?: boolean;
  status: 'new'|'partfilled'|'filled'|'canceled'|'rejected';
  trigger?: number;            // dla STOP-MARKET / STOP-LIMIT
}

export interface Position {
  symbol: string; side: Side; qty: number;
  entry: number; sl?: number; tp?: number;
  unrealized: number; fees: number;
}

export interface QuickPosition {
  tokenId: string;
  qty: number;
  avgEntryUsd: number;
  costBasisUsd: number;
  boughtUsd: number;
  soldUsd: number;
  realizedPnlUsd: number;
  updatedAtMs: number;
}

export interface QuickTrade {
  id: string;
  tokenId: string;
  side: Side;
  qty: number;
  priceUsd: number;
  mcapUsd?: number;
  notionalUsd: number;
  feeUsd: number;
  tsMs: number;
}

export interface Trade { id: string; orderId: string; price: number; qty: number; fee: number; ts: number; side: Side }
export interface Preset { id: string; label: string; qtyPct: number; slPct?: number; tpPct?: number; }
export interface RiskLimits { maxRiskUsd: number; maxOrdersPerMinute: number; maxLeverage?: number; }
export interface QuickTradeOptions {
  slippagePct?: number;
  prioritySol?: number;
  bribeSol?: number;
}
export interface QuickTradeResult {
  ok: boolean;
  reason?: string;
  submitted?: boolean;
  orderId?: string;
  expectedOut?: number;
  minOut?: number;
  slippageBps?: number;
  prioritySol?: number;
  bribeSol?: number;
  txCostSol?: number;
  etaMs?: number;
}

interface PendingQuickOrder {
  orderId: string;
  tokenId: string;
  side: Side;
  reservedSol: number;
  reservedToken: number;
  expectedOut: number;
  minOut: number;
  txCostSol: number;
  prioritySol: number;
  bribeSol: number;
  submitMs: number;
  execMs: number;
}

export interface QuickExecutionSnapshot {
  tokenId: string;
  orderId: string;
  side: Side;
  status: 'filled' | 'failed';
  expectedOut: number;
  minOut: number;
  actualOut: number;
  avgPriceUsd?: number;
  impactPct?: number;
  priceBeforeUsd?: number;
  priceAfterUsd?: number;
  reason?: string;
  tsMs: number;
}

type Ghost = { price: number } | null;

type PosAcc = { side: Side; openTs: number; lots: { qty:number; price:number; ts:number }[]; fees:number };
export interface PositionHistory {
  id: string; symbol: string; side: Side;
  size: number; entryAvg: number; exitAvg: number;
  notional: number; pnl: number; fees: number;
  openTs: number; closeTs: number; durationSec: number;
}

const QUICK_BASE_TX_FEE_SOL = 0.000005;

function makeId(): string {
  return 'O' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}

/* --- store --- */
type Store = {
  realizedBySymbol: Record<string, number>;
  positionHistory: PositionHistory[];
  posAcc: Record<string, PosAcc>;
  mode: Mode;
  symbol: string;
  lastPrice: number;
  tfSec: number;
  tfLeft: number;

  orderTypeUI: OrdType;
  limitTarget?: number | null;                // w JEDNOSTCE CENY (nie MCAP)
  setOrderTypeUI: (t: OrdType) => void;
  setLimitTarget: (p: number | null) => void;

  hydrateFromDB: () => Promise<void>;

  ticks: Tick[];
  candles: Candle[];

  orders: Order[];
  positions: Position[];
  trades: Trade[];
  quickPositionsByTokenId: Record<string, QuickPosition>;
  quickTradesByTokenId: Record<string, QuickTrade[]>;
  pendingQuickOrdersById: Record<string, PendingQuickOrder>;
  lastQuickExecutionByTokenId: Record<string, QuickExecutionSnapshot>;
  presets: Preset[];
  risk: RiskLimits;
  feeBps: number;
  slippagePct: number;
  reduceOnly: boolean;

  ghost: Ghost;
  resetViewSignal: number;

  // preferencje wykresu
  chartType: ChartType;
  metric: Metric;
  showSMA20: boolean;
  showSMA50: boolean;
  supply: number;

  setMode: (m: Mode) => void;
  setTfSec: (s: number) => void;
  setTfLeft: (s: number) => void;
  setGhost: (p: number | null) => void;
  resetView: () => void;

  setChartType: (t: ChartType) => void;
  setMetric: (m: Metric) => void;
  toggleSMA20: () => void;
  toggleSMA50: () => void;

  placeOrder: (partial: Partial<Order> & { side: Side; type: OrdType }) => Order;
  cancelOrder: (id: string) => void;
  closePct: (pct: number) => void;
  setSLTP: (levels: { sl?: number; tp?: number }) => void;
  applyPreset: (id: string) => void;
  quickBuy: (tokenId: string, amountSol: number, options?: QuickTradeOptions) => QuickTradeResult;
  quickSell: (tokenId: string, amountSol: number, options?: QuickTradeOptions) => QuickTradeResult;

  onPriceTick: (t: Tick, maybeCandle?: { mode: 'new'|'update'; candle: Candle }) => void;
};

export const useTradingStore = create<Store>((set, get) => ({
  mode: 'SIM',
  symbol: 'MEME/USDC',
  lastPrice: 0,
  tfSec: 1,
  tfLeft: 0,

  realizedBySymbol: {},
  positionHistory: [] as PositionHistory[],
  posAcc: {} as Record<string, PosAcc>,

  orderTypeUI: 'market',
  limitTarget: null,

  ticks: [],
  candles: [],

  orders: [],
  positions: [],
  trades: [],
  quickPositionsByTokenId: {},
  quickTradesByTokenId: {},
  pendingQuickOrdersById: {},
  lastQuickExecutionByTokenId: {},
  presets: [
    { id: 'p1', label: '0.10', qtyPct: 0.10, slPct: 0.01, tpPct: 0.02 },
    { id: 'p2', label: '0.20', qtyPct: 0.20, slPct: 0.015, tpPct: 0.03 },
    { id: 'p3', label: '0.45', qtyPct: 0.45, slPct: 0.02, tpPct: 0.05 },
  ],
  risk: { maxRiskUsd: 200, maxOrdersPerMinute: 20, maxLeverage: 3 },
  feeBps: 0.03,
  slippagePct: 0.05,
  reduceOnly: false,

  ghost: null,
  resetViewSignal: 0,

  // preferencje wykresu
  chartType: 'candles',
  metric: 'price',
  showSMA20: true,
  showSMA50: false,
  supply: 1_000_000_000, // stała do MCAP (price * supply)

    hydrateFromDB: async () => {
      const snap = await loadSnapshots();
      // posortuj malejąco po czasie
      const ord = [...snap.orders].sort((a,b)=>b.ts-a.ts).slice(0,2000);
      const trd = [...snap.trades].sort((a,b)=>b.ts-a.ts).slice(0,2000);
      const ph  = [...snap.positionHistory].sort((a,b)=>b.closeTs-a.closeTs).slice(0,2000);
      useTradingStore.setState({
        orders: ord, trades: trd, positionHistory: ph,
      });
    },

  setMode: (m) => set({ mode: m }),
  setTfSec: (s) => set({ tfSec: Math.max(1, Math.floor(s)) }),
  setTfLeft: (s) => set({ tfLeft: Math.max(0, Math.ceil(s)) }),
  setGhost: (p) => set({ ghost: p == null ? null : { price: p } }),
  resetView: () => set((st) => ({ resetViewSignal: st.resetViewSignal + 1 })),

  setChartType: (t) => set({ chartType: t }),
  setMetric: (m) => set({ metric: m }),
  toggleSMA20: () => set((s)=>({ showSMA20: !s.showSMA20 })),
  toggleSMA50: () => set((s)=>({ showSMA50: !s.showSMA50 })),

  setOrderTypeUI: (t) => set((s) => {
    // auto-domyślny target po przełączeniu na LIMIT
    if (t === 'limit' && s.limitTarget == null) {
      return { orderTypeUI: t, limitTarget: s.lastPrice || 0 };
    }
    // wyczyść target gdy wychodzisz z LIMIT
    if (t !== 'limit') return { orderTypeUI: t, limitTarget: null };
    return { orderTypeUI: t };
  }),

  setLimitTarget: (p) => set({ limitTarget: p }),


  applyPreset: () => ({}),

  quickBuy: (tokenId, amountSol, options) => {
    const st = get();
    if (!Number.isFinite(amountSol) || amountSol <= 0) {
      return { ok: false, reason: 'Invalid amount' };
    }

    const token = useTokenStore.getState().tokensById[tokenId];
    if (!token || token.phase === 'DEAD' || token.phase === 'RUGGED') {
      return { ok: false, reason: 'Token unavailable' };
    }

    const slippagePct = Number.isFinite(options?.slippagePct)
      ? (options?.slippagePct as number)
      : st.slippagePct;
    const slippageBps = slippagePctToBps(slippagePct);
    const prioritySol = Math.max(0, Number(options?.prioritySol ?? 0));
    const bribeSol = Math.max(0, Number(options?.bribeSol ?? 0));
    const effectivePrioritySol = prioritySol + bribeSol;
    const txCostSol = QUICK_BASE_TX_FEE_SOL + prioritySol + bribeSol;

    const wallet = useWalletStore.getState();
    const totalSolNeeded = amountSol + txCostSol;
    if (!wallet.deductSol(totalSolNeeded)) {
      return { ok: false, reason: 'Insufficient SOL' };
    }

    const quote = registry.quoteTrade(tokenId, 'BUY', amountSol, slippageBps);
    if (!quote.ok) {
      wallet.addSol(totalSolNeeded);
      return { ok: false, reason: quote.reason };
    }

    const submit = registry.submitTrade(tokenId, {
      side: 'BUY',
      amountIn: amountSol,
      slippageBps,
      prioritySol: effectivePrioritySol,
      txCostSol,
    });
    if (!submit.ok) {
      wallet.addSol(totalSolNeeded);
      return { ok: false, reason: submit.reason };
    }

    const pending: PendingQuickOrder = {
      orderId: submit.orderId,
      tokenId,
      side: 'buy',
      reservedSol: amountSol,
      reservedToken: 0,
      expectedOut: submit.expectedOut,
      minOut: submit.minOut,
      txCostSol,
      prioritySol,
      bribeSol,
      submitMs: submit.submitMs,
      execMs: submit.execMs,
    };

    set((state) => ({
      pendingQuickOrdersById: {
        ...state.pendingQuickOrdersById,
        [submit.orderId]: pending,
      },
    }));

    return {
      ok: true,
      submitted: true,
      orderId: submit.orderId,
      expectedOut: submit.expectedOut,
      minOut: submit.minOut,
      slippageBps: submit.slippageBps,
      prioritySol,
      bribeSol,
      txCostSol: submit.txCostSol,
      etaMs: Math.max(0, submit.execMs - Date.now()),
    };
  },

  quickSell: (tokenId, amountSol, options) => {
    const st = get();
    if (!Number.isFinite(amountSol) || amountSol <= 0) {
      return { ok: false, reason: 'Invalid amount' };
    }

    const token = useTokenStore.getState().tokensById[tokenId];
    if (!token || token.phase === 'DEAD' || token.phase === 'RUGGED') {
      return { ok: false, reason: 'Token unavailable' };
    }

    const priceUsd = token.lastPriceUsd;
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) return { ok: false, reason: 'Price unavailable' };

    const prevPos = st.quickPositionsByTokenId[tokenId];
    if (!prevPos || prevPos.qty <= 0) return { ok: false, reason: 'No position' };

    const alreadyReservedQty = sumReservedSellQty(st.pendingQuickOrdersById, tokenId);
    const availableQty = Math.max(0, prevPos.qty - alreadyReservedQty);
    if (availableQty <= 0) return { ok: false, reason: 'Position locked by pending sells' };

    const targetUsd = solToUsd(amountSol);
    const qtyToSell = Math.min(availableQty, targetUsd / priceUsd);
    if (!Number.isFinite(qtyToSell) || qtyToSell <= 0) return { ok: false, reason: 'Nothing to sell' };

    const slippagePct = Number.isFinite(options?.slippagePct)
      ? (options?.slippagePct as number)
      : st.slippagePct;
    const slippageBps = slippagePctToBps(slippagePct);
    const prioritySol = Math.max(0, Number(options?.prioritySol ?? 0));
    const bribeSol = Math.max(0, Number(options?.bribeSol ?? 0));
    const effectivePrioritySol = prioritySol + bribeSol;
    const txCostSol = QUICK_BASE_TX_FEE_SOL + prioritySol + bribeSol;

    const wallet = useWalletStore.getState();
    if (!wallet.deductSol(txCostSol)) return { ok: false, reason: 'Insufficient SOL for tx fee' };

    const quote = registry.quoteTrade(tokenId, 'SELL', qtyToSell, slippageBps);
    if (!quote.ok) {
      wallet.addSol(txCostSol);
      return { ok: false, reason: quote.reason };
    }

    const submit = registry.submitTrade(tokenId, {
      side: 'SELL',
      amountIn: qtyToSell,
      slippageBps,
      prioritySol: effectivePrioritySol,
      txCostSol,
    });
    if (!submit.ok) {
      wallet.addSol(txCostSol);
      return { ok: false, reason: submit.reason };
    }

    const pending: PendingQuickOrder = {
      orderId: submit.orderId,
      tokenId,
      side: 'sell',
      reservedSol: 0,
      reservedToken: qtyToSell,
      expectedOut: submit.expectedOut,
      minOut: submit.minOut,
      txCostSol,
      prioritySol,
      bribeSol,
      submitMs: submit.submitMs,
      execMs: submit.execMs,
    };

    set((state) => ({
      pendingQuickOrdersById: {
        ...state.pendingQuickOrdersById,
        [submit.orderId]: pending,
      },
    }));

    return {
      ok: true,
      submitted: true,
      orderId: submit.orderId,
      expectedOut: submit.expectedOut,
      minOut: submit.minOut,
      slippageBps: submit.slippageBps,
      prioritySol,
      bribeSol,
      txCostSol: submit.txCostSol,
      etaMs: Math.max(0, submit.execMs - Date.now()),
    };
  },

  placeOrder: (partial) => {
    const st = get();
    const id = makeId();
    const ord: Order = {
      id,
      ts: Date.now(),
      symbol: st.symbol,
      side: partial.side,
      type: partial.type,
      qty: partial.qty ?? 0,
      price: partial.price,
      slPct: partial.slPct,
      tpPct: partial.tpPct,
      slippagePct: partial.slippagePct ?? st.slippagePct,
      reduceOnly: partial.reduceOnly ?? st.reduceOnly,
      status: 'new',
      trigger: partial.trigger,
    };
    const orders = st.orders.concat([ord]);
    set({ orders });
    set({ orders: [...orders].sort((a,b)=>b.ts-a.ts).slice(0,2000) });
    saveOrdersSnapshot(get().orders).catch(()=>{});
    persistOrder(ord);
    return ord;
  },

  cancelOrder: (id) => set((st) => {
    const arr = st.orders.slice();
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].id === id) { arr[i] = { ...arr[i], status: 'canceled' }; break; }
    }
    return { orders: arr };
  }),

  closePct: (pct) => {
    const st = get();
    let pos: Position | undefined = undefined;
    for (let i = 0; i < st.positions.length; i++) {
      if (st.positions[i].symbol === st.symbol) { pos = st.positions[i]; break; }
    }
    if (!pos || pos.qty <= 0) return;
    const closeQty = Math.max(0, Math.min(pos.qty, pos.qty * pct));
    const side: Side = pos.side === 'buy' ? 'sell' : 'buy';
    get().placeOrder({ side, type: 'market', qty: closeQty, reduceOnly: true });
  },

  setSLTP: ({ sl, tp }) => set((st) => {
    const arr = st.positions.slice();
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].symbol === st.symbol) {
        arr[i] = { ...arr[i], sl: sl != null ? sl : arr[i].sl, tp: tp != null ? tp : arr[i].tp };
        break;
      }
    }
    return { positions: arr };
  }),

  onPriceTick: (tk, maybeCandle) => {
    const st = get();
    const price = tk.p;
    const feePct = st.feeBps / 10000;

    let orders = st.orders.slice();
    let trades = st.trades.slice();
    let positions = st.positions.slice();

    let positionHistory = st.positionHistory.slice();
    let posAcc: Record<string, PosAcc> = { ...st.posAcc };

    // fill + stop logic
    for (let i = 0; i < orders.length; i++) {
      const o = orders[i];
      if (o.status !== 'new') continue;

      const triggered = (o.trigger == null) || (o.side === 'buy' ? (price >= o.trigger) : (price <= o.trigger));
      // market 
      if ((o.type === 'market' || o.type === 'ioc') && triggered) {
        const slipMul = o.side === 'buy' ? (1 + o.slippagePct / 100) : (1 - o.slippagePct / 100);
        const fillPrice = price * slipMul;
        const qty = o.qty;
        const fee = qty * feePct;

        const tr: Trade = { id: makeId(), orderId: o.id, price: fillPrice, qty, fee, ts: tk.t, side: o.side };
        trades.push(tr); persistTrade(tr);
        const activeTokenId = useTokenStore.getState().activeTokenId;
        if (activeTokenId) {
          useTokenStore.getState().pushTokenEvents(activeTokenId, [{
            tokenId: activeTokenId,
            tMs: tk.t,
            type: o.side === 'buy' ? 'USER_BUY' : 'USER_SELL',
            price: fillPrice,
            size: qty,
          }]);
        }

        const res = applyFillWithRealized(positions, st.symbol, o.side, qty, fillPrice, fee);
        positions = res.positions;

        const cur = st.realizedBySymbol[st.symbol] ?? 0;
        st.realizedBySymbol[st.symbol] = cur + res.realizedDelta;

        ({ posAcc, positionHistory } = recordFillForHistory(
          posAcc, positionHistory, st.symbol, o.side, qty, fillPrice, fee, tk.t
        ));

        orders[i] = { ...o, status: 'filled', price: o.price != null ? o.price : fillPrice };

        continue;
      } else if ((o.type === 'market' || o.type === 'ioc') && !triggered) {
        continue; // STOP-MARKET czeka
      }
      // limit
      if (o.type === 'limit') {
        if (o.trigger != null && !triggered) continue;
        if ((o.side === 'buy' && price <= (o.price || 0)) ||
            (o.side === 'sell' && price >= (o.price || 0))) {
          const fee = o.qty * feePct;
          const px = o.price || price;

          const tr: Trade = { id: makeId(), orderId: o.id, price: px, qty: o.qty, fee, ts: tk.t, side: o.side };
          trades.push(tr); persistTrade(tr);
          const activeTokenId = useTokenStore.getState().activeTokenId;
          if (activeTokenId) {
            useTokenStore.getState().pushTokenEvents(activeTokenId, [{
              tokenId: activeTokenId,
              tMs: tk.t,
              type: o.side === 'buy' ? 'USER_BUY' : 'USER_SELL',
              price: px,
              size: o.qty,
            }]);
          }

          const res = applyFillWithRealized(positions, st.symbol, o.side, o.qty, px, fee);
          positions = res.positions;

          const cur = st.realizedBySymbol[st.symbol] ?? 0;
          st.realizedBySymbol[st.symbol] = cur + res.realizedDelta;

          ({ posAcc, positionHistory } = recordFillForHistory(
            posAcc, positionHistory, st.symbol, o.side, o.qty, px, fee, tk.t
          ));

          orders[i] = { ...o, status: 'filled' };
        }
      }
    }

    // SL/TP + PnL live
    const newPositions: Position[] = [];
    for (let j = 0; j < positions.length; j++) {
      const p = positions[j];
      let closed = false;
      if (p.side === 'buy') {
        if (p.sl != null && price <= p.sl) closed = true;
        if (p.tp != null && price >= p.tp) closed = true;
      } else {
        if (p.sl != null && price >= p.sl) closed = true;
        if (p.tp != null && price <= p.tp) closed = true;
      }
      const unreal = (p.side === 'buy' ? (price - p.entry) : (p.entry - price)) * p.qty - p.fees;
      if (!closed) newPositions.push({ ...p, unrealized: unreal });
    }

    // świece
    let candles = st.candles;
    if (maybeCandle) {
      const mode = maybeCandle.mode;
      const c = maybeCandle.candle;
      if (mode === 'new') candles = candles.concat([c]).slice(-3000);
      else if (candles.length) candles = candles.slice(0, -1).concat([c]);
    }

    // sorty + limity
    orders = orders.sort((a,b)=>b.ts-a.ts).slice(0,2000);
    trades = trades.sort((a,b)=>b.ts-a.ts).slice(0,2000);
    positionHistory = positionHistory.sort((a,b)=>b.closeTs-a.closeTs).slice(0,2000);


    set({
      lastPrice: price,
      ticks: st.ticks.concat([tk]).slice(-200000),
      orders,
      trades,
      positions: newPositions,
      candles,
      realizedBySymbol: st.realizedBySymbol,
      positionHistory,
      posAcc,
    });

    saveOrdersSnapshot(orders).catch(()=>{});
    saveTradesSnapshot(trades).catch(()=>{});
    savePositionHistorySnapshot(positionHistory).catch(()=>{});
  },
}));

/* --- pomocnicze --- */

function applyFillWithRealized(
  positions: Position[],
  symbol: string,
  side: Side,
  qty: number,
  price: number,
  fee: number
): { positions: Position[]; realizedDelta: number } {
  let idx = -1;
  for (let i = 0; i < positions.length; i++) if (positions[i].symbol === symbol) { idx = i; break; }

  if (idx === -1) {
    return { positions: positions.concat([{ symbol, side, qty, entry: price, unrealized: 0, fees: fee }]), realizedDelta: -fee };
  }

  const p = positions[idx];

  if (p.side !== side) {
    const closeQty = Math.min(p.qty, qty);
    const remain   = p.qty - closeQty;
    const realized = (p.side === 'buy'
      ? (price - p.entry) * closeQty
      : (p.entry - price) * closeQty) - fee;

    let out = positions.slice();
    if (remain > 0) {
      out[idx] = { ...p, qty: remain, fees: p.fees };
    } else {
      out.splice(idx, 1);
      const openQty = qty - closeQty;
      if (openQty > 0) {
        out = out.concat([{ symbol, side, qty: openQty, entry: price, unrealized: 0, fees: 0 }]);
      }
    }
    return { positions: out, realizedDelta: realized };
  }

  const newQty = p.qty + qty;
  const newEntry = (p.entry * p.qty + price * qty) / newQty;
  const out2 = positions.slice();
  out2[idx] = { ...p, qty: newQty, entry: newEntry, fees: p.fees + fee };
  return { positions: out2, realizedDelta: -fee };
}

function recordFillForHistory(
  posAcc: Record<string, PosAcc>,
  history: PositionHistory[],
  symbol: string, side: Side, qty: number, price: number, fee: number, ts: number
){
  const acc = posAcc[symbol];
  if (!acc) {
    posAcc[symbol] = { side, openTs: ts, lots: [{ qty, price, ts }], fees: fee };
    return { posAcc, positionHistory: history };
  }
  if (acc.side === side) {
    acc.lots.push({ qty, price, ts }); acc.fees += fee; posAcc[symbol] = acc;
    return { posAcc, positionHistory: history };
  }
  // closing against existing lots
  let remaining = qty, closedQty = 0, entryNotional = 0, exitNotional = 0;
  const openQtyBefore = acc.lots.reduce((s,l)=>s+l.qty,0);
  while (remaining > 1e-12 && acc.lots.length) {
    const lot = acc.lots[0];
    const use = Math.min(lot.qty, remaining);
    closedQty += use;
    entryNotional += lot.price * use;
    exitNotional  += price * use;
    lot.qty -= use; remaining -= use;
    if (lot.qty <= 1e-12) acc.lots.shift();
  }
  const sideOpen = acc.side;
  const pnlGross = sideOpen === 'buy'
    ? (exitNotional - entryNotional)
    : (entryNotional - exitNotional);
  const allocOpenFees = openQtyBefore>0 ? acc.fees * Math.min(1, closedQty/openQtyBefore) : 0;
  const pnlNet = pnlGross - allocOpenFees - fee;
  // jeśli całkowicie zamknięta sekwencja -> zapis do historii
  if (acc.lots.length === 0) {
    const entryAvg = closedQty>0 ? entryNotional/closedQty : 0;
    const exitAvg  = closedQty>0 ? exitNotional/closedQty : 0;
    history = history.concat([{
      id: 'PH' + ts.toString(36),
      symbol, side: sideOpen, size: closedQty,
      entryAvg, exitAvg, notional: entryNotional,
      pnl: pnlNet, fees: allocOpenFees + fee,
      openTs: acc.openTs, closeTs: ts, durationSec: Math.max(0, Math.round((ts-acc.openTs)/1000)),
    }]);
    // jeśli over-close → rozpocznij nową sekwencję po drugiej stronie
    if (remaining > 1e-12) {
      posAcc[symbol] = { side, openTs: ts, lots: [{ qty: remaining, price, ts }], fees: 0 };
    } else {
      delete posAcc[symbol];
    }
  } else {
    // częściowe zamknięcie; zaktualizuj fees proporcjonalnie
    acc.fees = Math.max(0, acc.fees - allocOpenFees);
    posAcc[symbol] = acc;
    // over-close → zacznij nową sekwencję
    if (remaining > 1e-12) {
      posAcc[symbol] = { side, openTs: ts, lots: [{ qty: remaining, price, ts }], fees: 0 };
    }
  }
  return { posAcc, positionHistory: history };
}

function slippagePctToBps(slippagePct: number): number {
  if (!Number.isFinite(slippagePct)) return 100;
  return Math.max(0, Math.min(10_000, Math.round(slippagePct * 100)));
}

function sumReservedSellQty(pending: Record<string, PendingQuickOrder>, tokenId: string): number {
  let qty = 0;
  for (const p of Object.values(pending)) {
    if (p.tokenId !== tokenId) continue;
    if (p.side !== 'sell') continue;
    qty += p.reservedToken;
  }
  return qty;
}

function applyQuickTradeExecution(execution: UserTradeExecutionNotice): void {
  const st = useTradingStore.getState();
  const pending = st.pendingQuickOrdersById[execution.orderId];
  if (!pending) return;

  const nextPending = { ...st.pendingQuickOrdersById };
  delete nextPending[execution.orderId];

  const side: Side = execution.side === 'BUY' ? 'buy' : 'sell';
  const nextLastExec: QuickExecutionSnapshot = execution.status === 'FILLED'
    ? {
      tokenId: execution.tokenId,
      orderId: execution.orderId,
      side,
      status: 'filled',
      expectedOut: execution.expectedOut,
      minOut: execution.minOut,
      actualOut: execution.actualOut,
      avgPriceUsd: execution.fill.avgPriceUsd,
      impactPct: execution.fill.impactPct,
      priceBeforeUsd: execution.fill.priceBeforeUsd,
      priceAfterUsd: execution.fill.priceAfterUsd,
      tsMs: execution.fill.tsMs,
    }
    : {
      tokenId: execution.tokenId,
      orderId: execution.orderId,
      side,
      status: 'failed',
      expectedOut: execution.expectedOut,
      minOut: execution.minOut,
      actualOut: execution.actualOut,
      reason: execution.reason,
      tsMs: execution.execMs,
    };

  const nextLastByToken = {
    ...st.lastQuickExecutionByTokenId,
    [execution.tokenId]: nextLastExec,
  };

  if (execution.status === 'FAILED') {
    if (pending.reservedSol > 0) {
      useWalletStore.getState().addSol(pending.reservedSol);
    }
    useTradingStore.setState({
      pendingQuickOrdersById: nextPending,
      lastQuickExecutionByTokenId: nextLastByToken,
    });
    return;
  }

  const fill = execution.fill;
  const nextQuickTradesByTokenId = { ...st.quickTradesByTokenId };
  const prevTokenTrades = nextQuickTradesByTokenId[execution.tokenId] ?? [];

  if (side === 'buy') {
    const refundSol = Math.max(0, pending.reservedSol - fill.filledSol);
    if (refundSol > 0) useWalletStore.getState().addSol(refundSol);

    const prevPos = st.quickPositionsByTokenId[execution.tokenId];
    const prevQty = prevPos?.qty ?? 0;
    const prevCost = prevPos?.costBasisUsd ?? 0;
    const nextQty = prevQty + fill.filledToken;
    const nextCost = prevCost + fill.filledUsd;
    const nextAvg = nextQty > 0 ? nextCost / nextQty : 0;
    const nextPos: QuickPosition = {
      tokenId: execution.tokenId,
      qty: nextQty,
      avgEntryUsd: nextAvg,
      costBasisUsd: nextCost,
      boughtUsd: (prevPos?.boughtUsd ?? 0) + fill.filledUsd,
      soldUsd: prevPos?.soldUsd ?? 0,
      realizedPnlUsd: prevPos?.realizedPnlUsd ?? 0,
      updatedAtMs: fill.tsMs,
    };

    const quickTrade: QuickTrade = {
      id: makeId(),
      tokenId: execution.tokenId,
      side: 'buy',
      qty: fill.filledToken,
      priceUsd: fill.avgPriceUsd,
      mcapUsd: fill.mcapAfterUsd,
      notionalUsd: fill.filledUsd,
      feeUsd: fill.feeUsd,
      tsMs: fill.tsMs,
    };
    nextQuickTradesByTokenId[execution.tokenId] = prevTokenTrades.concat([quickTrade]);

    useTradingStore.setState({
      pendingQuickOrdersById: nextPending,
      lastQuickExecutionByTokenId: nextLastByToken,
      quickPositionsByTokenId: {
        ...st.quickPositionsByTokenId,
        [execution.tokenId]: nextPos,
      },
      quickTradesByTokenId: nextQuickTradesByTokenId,
    });
    return;
  }

  const prevPos = st.quickPositionsByTokenId[execution.tokenId];
  const prevQty = prevPos?.qty ?? 0;
  const filledQty = Math.max(0, Math.min(prevQty, fill.filledToken));
  const proceedsUsd = fill.filledUsd;
  const costPortionUsd = filledQty > 0 && prevPos ? prevPos.avgEntryUsd * filledQty : 0;
  const realizedPnlUsd = proceedsUsd - costPortionUsd;
  const nextQtyRaw = prevQty - filledQty;
  const nextQty = nextQtyRaw <= 1e-9 ? 0 : nextQtyRaw;
  const nextCost = nextQty > 0 && prevPos ? Math.max(0, prevPos.costBasisUsd - costPortionUsd) : 0;
  const nextAvg = nextQty > 0 ? nextCost / nextQty : 0;
  const nextPos: QuickPosition = {
    tokenId: execution.tokenId,
    qty: nextQty,
    avgEntryUsd: nextAvg,
    costBasisUsd: nextCost,
    boughtUsd: prevPos?.boughtUsd ?? 0,
    soldUsd: (prevPos?.soldUsd ?? 0) + proceedsUsd,
    realizedPnlUsd: (prevPos?.realizedPnlUsd ?? 0) + realizedPnlUsd,
    updatedAtMs: fill.tsMs,
  };

  const quickTrade: QuickTrade = {
    id: makeId(),
    tokenId: execution.tokenId,
    side: 'sell',
    qty: fill.filledToken,
    priceUsd: fill.avgPriceUsd,
    mcapUsd: fill.mcapAfterUsd,
    notionalUsd: proceedsUsd,
    feeUsd: fill.feeUsd,
    tsMs: fill.tsMs,
  };
  nextQuickTradesByTokenId[execution.tokenId] = prevTokenTrades.concat([quickTrade]);

  useWalletStore.getState().addSol(fill.filledSol);
  useWalletStore.getState().addPnl(usdToSol(realizedPnlUsd));

  useTradingStore.setState({
    pendingQuickOrdersById: nextPending,
    lastQuickExecutionByTokenId: nextLastByToken,
    quickPositionsByTokenId: {
      ...st.quickPositionsByTokenId,
      [execution.tokenId]: nextPos,
    },
    quickTradesByTokenId: nextQuickTradesByTokenId,
  });
}

const tradeBridgeKey = '__dex_quick_trade_bridge_installed__';
const bridgeGlobal = globalThis as unknown as Record<string, boolean | undefined>;
if (!bridgeGlobal[tradeBridgeKey]) {
  bridgeGlobal[tradeBridgeKey] = true;
  registry.subscribeTradeExecutions((execution) => {
    applyQuickTradeExecution(execution);
  });
}

export const selectQuickPositionByTokenId = (tokenId: string) =>
  (s: ReturnType<typeof useTradingStore.getState>): QuickPosition | null =>
    s.quickPositionsByTokenId[tokenId] ?? null;

export const selectLastQuickExecutionByTokenId = (tokenId: string) =>
  (s: ReturnType<typeof useTradingStore.getState>): QuickExecutionSnapshot | null =>
    s.lastQuickExecutionByTokenId[tokenId] ?? null;

export const selectAvgEntryPriceByTokenId = (tokenId: string) =>
  (s: ReturnType<typeof useTradingStore.getState>): number | null => {
    const trades = s.quickTradesByTokenId[tokenId] ?? [];
    let buyQty = 0;
    let buyNotional = 0;
    for (let i = 0; i < trades.length; i++) {
      const t = trades[i]!;
      if (t.side !== 'buy') continue;
      if (!Number.isFinite(t.qty) || !Number.isFinite(t.priceUsd)) continue;
      if (t.qty <= 0 || t.priceUsd <= 0) continue;
      buyQty += t.qty;
      buyNotional += t.qty * t.priceUsd;
    }
    if (buyQty > 0) return buyNotional / buyQty;

    const p = s.quickPositionsByTokenId[tokenId];
    if (!p || !Number.isFinite(p.avgEntryUsd) || p.avgEntryUsd <= 0) return null;
    return p.avgEntryUsd;
  };

export const selectAvgSellPriceByTokenId = (tokenId: string) =>
  (s: ReturnType<typeof useTradingStore.getState>): number | null => {
    const trades = s.quickTradesByTokenId[tokenId] ?? [];
    let sellQty = 0;
    let sellNotional = 0;
    for (let i = 0; i < trades.length; i++) {
      const t = trades[i]!;
      if (t.side !== 'sell') continue;
      if (!Number.isFinite(t.qty) || !Number.isFinite(t.priceUsd)) continue;
      if (t.qty <= 0 || t.priceUsd <= 0) continue;
      sellQty += t.qty;
      sellNotional += t.qty * t.priceUsd;
    }
    if (sellQty <= 0) return null;
    return sellNotional / sellQty;
  };

export const selectAvgEntryMcapByTokenId = (tokenId: string) =>
  (s: ReturnType<typeof useTradingStore.getState>): number | null => {
    const trades = s.quickTradesByTokenId[tokenId] ?? [];
    let buyUsdWeight = 0;
    let buyMcapWeighted = 0;
    for (let i = 0; i < trades.length; i++) {
      const t = trades[i]!;
      if (t.side !== 'buy') continue;
      if (!Number.isFinite(t.qty) || t.qty <= 0) continue;
      if (!Number.isFinite(t.priceUsd) || t.priceUsd <= 0) continue;
      if (!Number.isFinite(t.mcapUsd) || (t.mcapUsd ?? 0) <= 0) continue;
      const usdWeight = t.qty * t.priceUsd;
      if (!Number.isFinite(usdWeight) || usdWeight <= 0) continue;
      buyUsdWeight += usdWeight;
      buyMcapWeighted += usdWeight * (t.mcapUsd as number);
    }
    if (buyUsdWeight <= 0) return null;
    return buyMcapWeighted / buyUsdWeight;
  };

export const selectAvgSellMcapByTokenId = (tokenId: string) =>
  (s: ReturnType<typeof useTradingStore.getState>): number | null => {
    const trades = s.quickTradesByTokenId[tokenId] ?? [];
    let sellUsdWeight = 0;
    let sellMcapWeighted = 0;
    for (let i = 0; i < trades.length; i++) {
      const t = trades[i]!;
      if (t.side !== 'sell') continue;
      if (!Number.isFinite(t.qty) || t.qty <= 0) continue;
      if (!Number.isFinite(t.priceUsd) || t.priceUsd <= 0) continue;
      if (!Number.isFinite(t.mcapUsd) || (t.mcapUsd ?? 0) <= 0) continue;
      const usdWeight = t.qty * t.priceUsd;
      if (!Number.isFinite(usdWeight) || usdWeight <= 0) continue;
      sellUsdWeight += usdWeight;
      sellMcapWeighted += usdWeight * (t.mcapUsd as number);
    }
    if (sellUsdWeight <= 0) return null;
    return sellMcapWeighted / sellUsdWeight;
  };


