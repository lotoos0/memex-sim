// src/store/tradingStore.ts
import { create } from 'zustand';
import type { Candle, Tick } from '../engine/types';
import { persistOrder, persistTrade, saveOrdersSnapshot, saveTradesSnapshot, savePositionHistorySnapshot } from '../sim/journal';
import { useTokenStore } from './tokenStore';
import { useWalletStore, solToUsd, usdToSol } from './walletStore';
import { registry } from '../tokens/registry';
import type { UserTradeExecutionNotice } from '../tokens/tokenSim';


/* --- podstawowe typy --- */
export type Side = 'buy' | 'sell';
export type OrdType = 'market' | 'limit' | 'ioc';

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

export interface QuickPendingOrder {
  orderId: string;
  tokenId: string;
  side: Side;
  sourceLimitOrderId?: string;
  sourceLimitPriceUsd?: number;
  sourceRequestedAmountSol?: number;
  sourceRequestedTokenQty?: number;
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

export interface QuickLimitOrder {
  id: string;
  tokenId: string;
  side: Side;
  limitPriceUsd: number;
  amountSol: number;
  tokenQty: number;
  reservedSol: number;
  txCostSol: number;
  slippageBps: number;
  prioritySol: number;
  bribeSol: number;
  status: 'open';
  createdAtMs: number;
}

export interface QuickExecutionSnapshot {
  tokenId: string;
  orderId: string;
  side: Side;
  status: 'filled' | 'failed';
  amountIn: number;
  expectedOut: number;
  minOut: number;
  actualOut: number;
  submitMs: number;
  execMs: number;
  txCostSol: number;
  avgPriceUsd?: number;
  impactPct?: number;
  priceBeforeUsd?: number;
  priceAfterUsd?: number;
  reason?: string;
  tsMs: number;
}

export type QuickOrderAuditStatus = 'open' | 'cancelled' | 'triggered' | 'filled' | 'failed';

export interface QuickOrderAuditRow {
  id: string;
  tokenId: string;
  limitOrderId: string;
  executionOrderId?: string;
  side: Side;
  status: QuickOrderAuditStatus;
  limitPriceUsd: number;
  requestedAmountSol: number;
  requestedTokenQty: number;
  expectedOut?: number;
  minOut?: number;
  actualOut?: number;
  txCostSol: number;
  avgPriceUsd?: number;
  reason?: string;
  tsMs: number;
}

export interface QuickPositionSummary {
  tokenId: string;
  qty: number;
  avgBuyPriceUsd: number | null;
  avgSellPriceUsd: number | null;
  boughtUsd: number;
  soldUsd: number;
  costBasisUsd: number;
  realizedUsd: number;
  holdingUsd: number;
  unrealizedUsd: number;
  totalPnlUsd: number;
  updatedAtMs: number;
  hasOpenPosition: boolean;
  hasHistory: boolean;
  tradesCount: number;
  recentFills: QuickTrade[];
}

export interface QuickOrderPanelState {
  tokenId: string;
  auditRows: QuickOrderAuditRow[];
  limitOrders: QuickLimitOrder[];
  pendingOrders: QuickPendingOrder[];
  executions: QuickExecutionSnapshot[];
  hasAuditHistory: boolean;
  hasOpenLimitOrders: boolean;
  hasPendingOrders: boolean;
  hasExecutionHistory: boolean;
  isEmpty: boolean;
}

const EMPTY_QUICK_TRADES: QuickTrade[] = [];
const EMPTY_QUICK_EXECUTIONS: QuickExecutionSnapshot[] = [];
const EMPTY_PENDING_QUICK_ORDERS: QuickPendingOrder[] = [];
const EMPTY_QUICK_LIMIT_ORDERS: QuickLimitOrder[] = [];
const EMPTY_QUICK_ORDER_AUDIT: QuickOrderAuditRow[] = [];

type PosAcc = { side: Side; openTs: number; lots: { qty:number; price:number; ts:number }[]; fees:number };
export interface PositionHistory {
  id: string; symbol: string; side: Side;
  size: number; entryAvg: number; exitAvg: number;
  notional: number; pnl: number; fees: number;
  openTs: number; closeTs: number; durationSec: number;
}

const QUICK_BASE_TX_FEE_SOL = 0.000005;
const QUICK_ORDER_AUDIT_MAX_ROWS = 80;

function makeId(): string {
  return 'O' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}

function makeQuickOrderAuditId(limitOrderId: string, status: QuickOrderAuditStatus, tsMs: number): string {
  return `${limitOrderId}:${status}:${tsMs}`;
}

/* --- store --- */
type Store = {
  realizedBySymbol: Record<string, number>;
  positionHistory: PositionHistory[];
  posAcc: Record<string, PosAcc>;
  // Legacy symbol-centric engine retained only for internal isolation and `legacy/`.
  // Active UI must stay on the quick-native API below.
  symbol: string;
  lastPrice: number;
  ticks: Tick[];
  candles: Candle[];

  orders: Order[];
  positions: Position[];
  trades: Trade[];
  // Quick token-centric trading used by the active UI.
  quickPositionsByTokenId: Record<string, QuickPosition>;
  quickTradesByTokenId: Record<string, QuickTrade[]>;
  quickLimitOrdersById: Record<string, QuickLimitOrder>;
  pendingQuickOrdersById: Record<string, QuickPendingOrder>;
  lastQuickExecutionByTokenId: Record<string, QuickExecutionSnapshot>;
  quickExecutionHistoryByTokenId: Record<string, QuickExecutionSnapshot[]>;
  quickOrderAuditByTokenId: Record<string, QuickOrderAuditRow[]>;
  presets: Preset[];
  risk: RiskLimits;
  feeBps: number;
  slippagePct: number;
  reduceOnly: boolean;

  // Legacy-only public methods kept only while the isolated symbol engine remains.
  placeOrder: (partial: Partial<Order> & { side: Side; type: OrdType }) => Order;
  cancelOrder: (id: string) => void;

  // Quick-native public API used by the active UI.
  placeQuickLimitOrder: (tokenId: string, side: Side, amountSol: number, limitPriceUsd: number, options?: QuickTradeOptions) => QuickTradeResult;
  cancelQuickLimitOrder: (orderId: string) => boolean;
  quickBuy: (tokenId: string, amountSol: number, options?: QuickTradeOptions) => QuickTradeResult;
  quickSell: (tokenId: string, amountSol: number, options?: QuickTradeOptions) => QuickTradeResult;

  // Legacy symbol engine tick bridge retained for internal journal/runtime behavior.
  onPriceTick: (t: Tick, maybeCandle?: { mode: 'new'|'update'; candle: Candle }) => void;
};

export const useTradingStore = create<Store>((set, get) => ({
  symbol: 'MEME/USDC',
  lastPrice: 0,

  realizedBySymbol: {},
  positionHistory: [] as PositionHistory[],
  posAcc: {} as Record<string, PosAcc>,

  ticks: [],
  candles: [],

  orders: [],
  positions: [],
  trades: [],
  quickPositionsByTokenId: {},
  quickTradesByTokenId: {},
  quickLimitOrdersById: {},
  pendingQuickOrdersById: {},
  lastQuickExecutionByTokenId: {},
  quickExecutionHistoryByTokenId: {},
  quickOrderAuditByTokenId: {},
  presets: [
    { id: 'p1', label: '0.10', qtyPct: 0.10, slPct: 0.01, tpPct: 0.02 },
    { id: 'p2', label: '0.20', qtyPct: 0.20, slPct: 0.015, tpPct: 0.03 },
    { id: 'p3', label: '0.45', qtyPct: 0.45, slPct: 0.02, tpPct: 0.05 },
  ],
  risk: { maxRiskUsd: 200, maxOrdersPerMinute: 20, maxLeverage: 3 },
  feeBps: 0.03,
  slippagePct: 0.05,
  reduceOnly: false,

  // Quick-native order/position flow used by active src/ UI.
  placeQuickLimitOrder: (tokenId, side, amountSol, limitPriceUsd, options) => {
    const st = get();
    if (!Number.isFinite(amountSol) || amountSol <= 0) {
      return { ok: false, reason: 'Invalid amount' };
    }
    if (!Number.isFinite(limitPriceUsd) || limitPriceUsd <= 0) {
      return { ok: false, reason: 'Invalid limit price' };
    }

    const token = useTokenStore.getState().tokensById[tokenId];
    if (!token) {
      return { ok: false, reason: 'Token unavailable' };
    }

    const slippagePct = Number.isFinite(options?.slippagePct)
      ? (options?.slippagePct as number)
      : st.slippagePct;
    const slippageBps = slippagePctToBps(slippagePct);
    const prioritySol = Math.max(0, Number(options?.prioritySol ?? 0));
    const bribeSol = Math.max(0, Number(options?.bribeSol ?? 0));
    const txCostSol = QUICK_BASE_TX_FEE_SOL + prioritySol + bribeSol;
    const createdAtMs = Date.now();

    if (side === 'buy') {
      const totalSolNeeded = amountSol + txCostSol;
      if (!useWalletStore.getState().deductSol(totalSolNeeded)) {
        return { ok: false, reason: 'Insufficient SOL' };
      }

      const orderId = makeId();
      const order: QuickLimitOrder = {
        id: orderId,
        tokenId,
        side,
        limitPriceUsd,
        amountSol,
        tokenQty: 0,
        reservedSol: amountSol,
        txCostSol,
        slippageBps,
        prioritySol,
        bribeSol,
        status: 'open',
        createdAtMs,
      };

      set((state) => ({
        quickLimitOrdersById: {
          ...state.quickLimitOrdersById,
          [orderId]: order,
        },
        quickOrderAuditByTokenId: appendQuickOrderAuditRow(state.quickOrderAuditByTokenId, {
          id: makeQuickOrderAuditId(orderId, 'open', createdAtMs),
          tokenId,
          limitOrderId: orderId,
          side,
          status: 'open',
          limitPriceUsd,
          requestedAmountSol: amountSol,
          requestedTokenQty: 0,
          txCostSol,
          tsMs: createdAtMs,
        }),
      }));
      maybeTriggerQuickLimitOrders();
      return { ok: true, orderId };
    }

    const priceUsd = token.lastPriceUsd;
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) return { ok: false, reason: 'Price unavailable' };

    const prevPos = st.quickPositionsByTokenId[tokenId];
    if (!prevPos || prevPos.qty <= 0) return { ok: false, reason: 'No position' };

    const availableQty = Math.max(
      0,
      prevPos.qty - getReservedSellQty(st.pendingQuickOrdersById, st.quickLimitOrdersById, tokenId)
    );
    if (availableQty <= 0) return { ok: false, reason: 'Position locked by open sells' };

    const targetUsd = solToUsd(amountSol);
    const qtyToSell = Math.min(availableQty, targetUsd / priceUsd);
    if (!Number.isFinite(qtyToSell) || qtyToSell <= 0) return { ok: false, reason: 'Nothing to sell' };

    if (!useWalletStore.getState().deductSol(txCostSol)) {
      return { ok: false, reason: 'Insufficient SOL for tx fee' };
    }

    const orderId = makeId();
    const order: QuickLimitOrder = {
      id: orderId,
      tokenId,
      side,
      limitPriceUsd,
      amountSol,
      tokenQty: qtyToSell,
      reservedSol: 0,
      txCostSol,
      slippageBps,
      prioritySol,
      bribeSol,
      status: 'open',
      createdAtMs,
    };

    set((state) => ({
      quickLimitOrdersById: {
        ...state.quickLimitOrdersById,
        [orderId]: order,
      },
      quickOrderAuditByTokenId: appendQuickOrderAuditRow(state.quickOrderAuditByTokenId, {
        id: makeQuickOrderAuditId(orderId, 'open', createdAtMs),
        tokenId,
        limitOrderId: orderId,
        side,
        status: 'open',
        limitPriceUsd,
        requestedAmountSol: amountSol,
        requestedTokenQty: qtyToSell,
        txCostSol,
        tsMs: createdAtMs,
      }),
    }));
    maybeTriggerQuickLimitOrders();
    return { ok: true, orderId };
  },

  cancelQuickLimitOrder: (orderId) => {
    const order = get().quickLimitOrdersById[orderId];
    if (!order) return false;
    const cancelledAtMs = Date.now();

    const refundSol = order.reservedSol + order.txCostSol;
    if (refundSol > 0) {
      useWalletStore.getState().addSol(refundSol);
    }

    set((state) => {
      if (!state.quickLimitOrdersById[orderId]) return state;
      const next = { ...state.quickLimitOrdersById };
      delete next[orderId];
      return {
        quickLimitOrdersById: next,
        quickOrderAuditByTokenId: appendQuickOrderAuditRow(state.quickOrderAuditByTokenId, {
          id: makeQuickOrderAuditId(order.id, 'cancelled', cancelledAtMs),
          tokenId: order.tokenId,
          limitOrderId: order.id,
          side: order.side,
          status: 'cancelled',
          limitPriceUsd: order.limitPriceUsd,
          requestedAmountSol: order.amountSol,
          requestedTokenQty: order.tokenQty,
          txCostSol: order.txCostSol,
          tsMs: cancelledAtMs,
        }),
      };
    });
    return true;
  },

  quickBuy: (tokenId, amountSol, options) => {
    const st = get();
    if (!Number.isFinite(amountSol) || amountSol <= 0) {
      return { ok: false, reason: 'Invalid amount' };
    }

    const token = useTokenStore.getState().tokensById[tokenId];
    if (!token) {
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

    const pending: QuickPendingOrder = {
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
    if (!token) {
      return { ok: false, reason: 'Token unavailable' };
    }

    const priceUsd = token.lastPriceUsd;
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) return { ok: false, reason: 'Price unavailable' };

    const prevPos = st.quickPositionsByTokenId[tokenId];
    if (!prevPos || prevPos.qty <= 0) return { ok: false, reason: 'No position' };

    const alreadyReservedQty = getReservedSellQty(st.pendingQuickOrdersById, st.quickLimitOrdersById, tokenId);
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

    const pending: QuickPendingOrder = {
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

  // Legacy symbol-centric engine kept only for internal isolation and journal compatibility.
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
        continue;
      }

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

    let candles = st.candles;
    if (maybeCandle) {
      const mode = maybeCandle.mode;
      const c = maybeCandle.candle;
      if (mode === 'new') candles = candles.concat([c]).slice(-3000);
      else if (candles.length) candles = candles.slice(0, -1).concat([c]);
    }

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

function getReservedSellQty(
  pending: Record<string, QuickPendingOrder>,
  limitOrders: Record<string, QuickLimitOrder>,
  tokenId: string
): number {
  let qty = 0;
  for (const p of Object.values(pending)) {
    if (p.tokenId !== tokenId) continue;
    if (p.side !== 'sell') continue;
    qty += p.reservedToken;
  }
  for (const order of Object.values(limitOrders)) {
    if (order.tokenId !== tokenId) continue;
    if (order.side !== 'sell') continue;
    if (order.status !== 'open') continue;
    qty += order.tokenQty;
  }
  return qty;
}

function shouldTriggerQuickLimitOrder(order: QuickLimitOrder, currentPriceUsd: number): boolean {
  if (!Number.isFinite(currentPriceUsd) || currentPriceUsd <= 0) return false;
  if (!Number.isFinite(order.limitPriceUsd) || order.limitPriceUsd <= 0) return false;
  return order.side === 'buy'
    ? currentPriceUsd <= order.limitPriceUsd
    : currentPriceUsd >= order.limitPriceUsd;
}

function triggerQuickLimitOrder(orderId: string): void {
  const st = useTradingStore.getState();
  const order = st.quickLimitOrdersById[orderId];
  if (!order || order.status !== 'open') return;

  const side = order.side === 'buy' ? 'BUY' : 'SELL';
  const amountIn = order.side === 'buy' ? order.amountSol : order.tokenQty;
  if (!Number.isFinite(amountIn) || amountIn <= 0) return;

  const quote = registry.quoteTrade(order.tokenId, side, amountIn, order.slippageBps);
  if (!quote.ok) return;

  const submit = registry.submitTrade(order.tokenId, {
    side,
    amountIn,
    slippageBps: order.slippageBps,
    prioritySol: order.prioritySol + order.bribeSol,
    txCostSol: order.txCostSol,
  });
  if (!submit.ok) return;

  const pending: QuickPendingOrder = {
    orderId: submit.orderId,
    tokenId: order.tokenId,
    side: order.side,
    sourceLimitOrderId: order.id,
    sourceLimitPriceUsd: order.limitPriceUsd,
    sourceRequestedAmountSol: order.amountSol,
    sourceRequestedTokenQty: order.tokenQty,
    reservedSol: order.side === 'buy' ? order.reservedSol : 0,
    reservedToken: order.side === 'sell' ? order.tokenQty : 0,
    expectedOut: submit.expectedOut,
    minOut: submit.minOut,
    txCostSol: order.txCostSol,
    prioritySol: order.prioritySol,
    bribeSol: order.bribeSol,
    submitMs: submit.submitMs,
    execMs: submit.execMs,
  };

  useTradingStore.setState((state) => {
    if (!state.quickLimitOrdersById[orderId]) return state;
    const nextLimitOrders = { ...state.quickLimitOrdersById };
    delete nextLimitOrders[orderId];
    return {
      quickLimitOrdersById: nextLimitOrders,
      pendingQuickOrdersById: {
        ...state.pendingQuickOrdersById,
        [submit.orderId]: pending,
      },
      quickOrderAuditByTokenId: appendQuickOrderAuditRow(state.quickOrderAuditByTokenId, {
        id: makeQuickOrderAuditId(order.id, 'triggered', submit.submitMs),
        tokenId: order.tokenId,
        limitOrderId: order.id,
        executionOrderId: submit.orderId,
        side: order.side,
        status: 'triggered',
        limitPriceUsd: order.limitPriceUsd,
        requestedAmountSol: order.amountSol,
        requestedTokenQty: order.tokenQty,
        expectedOut: submit.expectedOut,
        minOut: submit.minOut,
        txCostSol: order.txCostSol,
        tsMs: submit.submitMs,
      }),
    };
  });
}

function maybeTriggerQuickLimitOrders(): void {
  const st = useTradingStore.getState();
  const openOrders = Object.values(st.quickLimitOrdersById);
  if (openOrders.length === 0) return;

  const tokenState = useTokenStore.getState();
  for (const order of openOrders) {
    if (order.status !== 'open') continue;
    const priceUsd = tokenState.tokensById[order.tokenId]?.lastPriceUsd ?? 0;
    if (!shouldTriggerQuickLimitOrder(order, priceUsd)) continue;
    triggerQuickLimitOrder(order.id);
  }
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
      amountIn: execution.amountIn,
      expectedOut: execution.expectedOut,
      minOut: execution.minOut,
      actualOut: execution.actualOut,
      submitMs: execution.submitMs,
      execMs: execution.execMs,
      txCostSol: execution.txCostSol,
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
      amountIn: execution.amountIn,
      expectedOut: execution.expectedOut,
      minOut: execution.minOut,
      actualOut: execution.actualOut,
      submitMs: execution.submitMs,
      execMs: execution.execMs,
      txCostSol: execution.txCostSol,
      reason: execution.reason,
      tsMs: execution.execMs,
    };

  const nextLastByToken = {
    ...st.lastQuickExecutionByTokenId,
    [execution.tokenId]: nextLastExec,
  };
  const prevExecHistory = st.quickExecutionHistoryByTokenId[execution.tokenId] ?? EMPTY_QUICK_EXECUTIONS;
  const nextExecHistoryByToken = {
    ...st.quickExecutionHistoryByTokenId,
    [execution.tokenId]: prevExecHistory.concat([nextLastExec]).slice(-20),
  };
  const nextAuditByToken = pending.sourceLimitOrderId
    ? appendQuickOrderAuditRow(st.quickOrderAuditByTokenId, {
      id: makeQuickOrderAuditId(
        pending.sourceLimitOrderId,
        execution.status === 'FILLED' ? 'filled' : 'failed',
        nextLastExec.tsMs
      ),
      tokenId: execution.tokenId,
      limitOrderId: pending.sourceLimitOrderId,
      executionOrderId: execution.orderId,
      side,
      status: execution.status === 'FILLED' ? 'filled' : 'failed',
      limitPriceUsd: pending.sourceLimitPriceUsd ?? 0,
      requestedAmountSol: pending.sourceRequestedAmountSol ?? 0,
      requestedTokenQty: pending.sourceRequestedTokenQty ?? 0,
      expectedOut: execution.expectedOut,
      minOut: execution.minOut,
      actualOut: execution.actualOut,
      txCostSol: execution.txCostSol,
      avgPriceUsd: execution.status === 'FILLED' ? execution.fill.avgPriceUsd : undefined,
      reason: execution.status === 'FAILED' ? execution.reason : undefined,
      tsMs: nextLastExec.tsMs,
    })
    : st.quickOrderAuditByTokenId;

  if (execution.status === 'FAILED') {
    if (pending.reservedSol > 0) {
      useWalletStore.getState().addSol(pending.reservedSol);
    }
    useTradingStore.setState({
      pendingQuickOrdersById: nextPending,
      lastQuickExecutionByTokenId: nextLastByToken,
      quickExecutionHistoryByTokenId: nextExecHistoryByToken,
      quickOrderAuditByTokenId: nextAuditByToken,
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
      quickExecutionHistoryByTokenId: nextExecHistoryByToken,
      quickOrderAuditByTokenId: nextAuditByToken,
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
    quickExecutionHistoryByTokenId: nextExecHistoryByToken,
    quickOrderAuditByTokenId: nextAuditByToken,
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

const limitBridgeKey = '__dex_quick_limit_bridge_installed__';
if (!bridgeGlobal[limitBridgeKey]) {
  bridgeGlobal[limitBridgeKey] = true;
  useTokenStore.subscribe((state, prevState) => {
    if (state.marketByTokenId === prevState.marketByTokenId) return;
    maybeTriggerQuickLimitOrders();
  });
}

export const selectQuickPositionByTokenId = (tokenId: string) =>
  (s: ReturnType<typeof useTradingStore.getState>): QuickPosition | null =>
    s.quickPositionsByTokenId[tokenId] ?? null;

export const selectQuickTradesByTokenId = (tokenId: string) =>
  (s: ReturnType<typeof useTradingStore.getState>): QuickTrade[] =>
    getQuickTradesForToken(s, tokenId);

export const selectQuickOpenLimitOrdersByTokenId = (tokenId: string) =>
  {
    let prevLimitMap: ReturnType<typeof useTradingStore.getState>['quickLimitOrdersById'] | null = null;
    let prevRows: QuickLimitOrder[] = EMPTY_QUICK_LIMIT_ORDERS;
    return (s: ReturnType<typeof useTradingStore.getState>): QuickLimitOrder[] => {
      if (s.quickLimitOrdersById === prevLimitMap) return prevRows;
      prevLimitMap = s.quickLimitOrdersById;
      prevRows = getQuickOpenLimitOrdersForToken(s, tokenId);
      return prevRows;
    };
  };

export const selectQuickPendingOrdersByTokenId = (tokenId: string) =>
  {
    let prevPendingMap: ReturnType<typeof useTradingStore.getState>['pendingQuickOrdersById'] | null = null;
    let prevRows: QuickPendingOrder[] = EMPTY_PENDING_QUICK_ORDERS;
    return (s: ReturnType<typeof useTradingStore.getState>): QuickPendingOrder[] => {
      if (s.pendingQuickOrdersById === prevPendingMap) return prevRows;
      prevPendingMap = s.pendingQuickOrdersById;
      prevRows = getQuickPendingOrdersForToken(s, tokenId);
      return prevRows;
    };
  };

export const selectLastQuickExecutionByTokenId = (tokenId: string) =>
  (s: ReturnType<typeof useTradingStore.getState>): QuickExecutionSnapshot | null =>
    s.lastQuickExecutionByTokenId[tokenId] ?? null;

export const selectQuickExecutionHistoryByTokenId = (tokenId: string) =>
  (s: ReturnType<typeof useTradingStore.getState>): QuickExecutionSnapshot[] =>
    getQuickExecutionHistoryForToken(s, tokenId);

export const selectQuickOrderAuditRowsByTokenId = (tokenId: string) =>
  {
    let prevAuditMap: ReturnType<typeof useTradingStore.getState>['quickOrderAuditByTokenId'] | null = null;
    let prevRows: QuickOrderAuditRow[] = EMPTY_QUICK_ORDER_AUDIT;
    return (s: ReturnType<typeof useTradingStore.getState>): QuickOrderAuditRow[] => {
      if (s.quickOrderAuditByTokenId === prevAuditMap) return prevRows;
      prevAuditMap = s.quickOrderAuditByTokenId;
      prevRows = getQuickOrderAuditRowsForToken(s, tokenId);
      return prevRows;
    };
  };

export const selectQuickPositionSummaryByTokenId = (tokenId: string, currentPriceUsd: number) =>
  {
    let prevPosition: QuickPosition | null | undefined = undefined;
    let prevTrades: QuickTrade[] | undefined = undefined;
    let prevPriceUsd: number | undefined = undefined;
    let prevSummary: QuickPositionSummary | null = null;
    return (s: ReturnType<typeof useTradingStore.getState>): QuickPositionSummary => {
      const position = s.quickPositionsByTokenId[tokenId] ?? null;
      const trades = getQuickTradesForToken(s, tokenId);
      if (
        prevSummary &&
        position === prevPosition &&
        trades === prevTrades &&
        prevPriceUsd === currentPriceUsd
      ) {
        return prevSummary;
      }
      prevPosition = position;
      prevTrades = trades;
      prevPriceUsd = currentPriceUsd;
      prevSummary = buildQuickPositionSummary(position, trades, tokenId, currentPriceUsd);
      return prevSummary;
    };
  };

export const selectQuickOrderPanelStateByTokenId = (tokenId: string) =>
  {
    let prevAuditMap: ReturnType<typeof useTradingStore.getState>['quickOrderAuditByTokenId'] | null = null;
    let prevLimitMap: ReturnType<typeof useTradingStore.getState>['quickLimitOrdersById'] | null = null;
    let prevPendingMap: ReturnType<typeof useTradingStore.getState>['pendingQuickOrdersById'] | null = null;
    let prevExecutionHistory: QuickExecutionSnapshot[] | undefined = undefined;
    let prevState: QuickOrderPanelState | null = null;
    return (s: ReturnType<typeof useTradingStore.getState>): QuickOrderPanelState => {
      const executionHistory = getQuickExecutionHistoryForToken(s, tokenId);
      if (
        prevState &&
        s.quickOrderAuditByTokenId === prevAuditMap &&
        s.quickLimitOrdersById === prevLimitMap &&
        s.pendingQuickOrdersById === prevPendingMap &&
        executionHistory === prevExecutionHistory
      ) {
        return prevState;
      }
      const auditRows = getQuickOrderAuditRowsForToken(s, tokenId);
      const limitOrders = getQuickOpenLimitOrdersForToken(s, tokenId);
      const pendingOrders = getQuickPendingOrdersForToken(s, tokenId);
      const executions = executionHistory.length > 0 ? executionHistory.slice().reverse() : EMPTY_QUICK_EXECUTIONS;
      prevAuditMap = s.quickOrderAuditByTokenId;
      prevLimitMap = s.quickLimitOrdersById;
      prevPendingMap = s.pendingQuickOrdersById;
      prevExecutionHistory = executionHistory;
      prevState = {
        tokenId,
        auditRows,
        limitOrders,
        pendingOrders,
        executions,
        hasAuditHistory: auditRows.length > 0,
        hasOpenLimitOrders: limitOrders.length > 0,
        hasPendingOrders: pendingOrders.length > 0,
        hasExecutionHistory: executions.length > 0,
        isEmpty: auditRows.length === 0 && limitOrders.length === 0 && pendingOrders.length === 0 && executions.length === 0,
      };
      return prevState;
    };
  };

export const selectAvgEntryPriceByTokenId = (tokenId: string) =>
  (s: ReturnType<typeof useTradingStore.getState>): number | null => {
    const trades = getQuickTradesForToken(s, tokenId);
    const avg = getAvgTradePrice(trades, 'buy');
    if (avg != null) return avg;

    const p = s.quickPositionsByTokenId[tokenId];
    if (!p || !Number.isFinite(p.avgEntryUsd) || p.avgEntryUsd <= 0) return null;
    return p.avgEntryUsd;
  };

export const selectAvgSellPriceByTokenId = (tokenId: string) =>
  (s: ReturnType<typeof useTradingStore.getState>): number | null =>
    getAvgTradePrice(getQuickTradesForToken(s, tokenId), 'sell');

export const selectAvgEntryMcapByTokenId = (tokenId: string) =>
  (s: ReturnType<typeof useTradingStore.getState>): number | null => {
    const trades = getQuickTradesForToken(s, tokenId);
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
    const trades = getQuickTradesForToken(s, tokenId);
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

function getQuickTradesForToken(
  s: ReturnType<typeof useTradingStore.getState>,
  tokenId: string
): QuickTrade[] {
  return s.quickTradesByTokenId[tokenId] ?? EMPTY_QUICK_TRADES;
}

function appendQuickOrderAuditRow(
  rowsByToken: Record<string, QuickOrderAuditRow[]>,
  row: QuickOrderAuditRow
): Record<string, QuickOrderAuditRow[]> {
  const prevRows = rowsByToken[row.tokenId] ?? EMPTY_QUICK_ORDER_AUDIT;
  return {
    ...rowsByToken,
    [row.tokenId]: [row, ...prevRows].slice(0, QUICK_ORDER_AUDIT_MAX_ROWS),
  };
}

function getQuickExecutionHistoryForToken(
  s: ReturnType<typeof useTradingStore.getState>,
  tokenId: string
): QuickExecutionSnapshot[] {
  return s.quickExecutionHistoryByTokenId[tokenId] ?? EMPTY_QUICK_EXECUTIONS;
}

function getQuickOrderAuditRowsForToken(
  s: ReturnType<typeof useTradingStore.getState>,
  tokenId: string
): QuickOrderAuditRow[] {
  return s.quickOrderAuditByTokenId[tokenId] ?? EMPTY_QUICK_ORDER_AUDIT;
}

function getQuickOpenLimitOrdersForToken(
  s: ReturnType<typeof useTradingStore.getState>,
  tokenId: string
): QuickLimitOrder[] {
  const values = Object.values(s.quickLimitOrdersById);
  if (values.length === 0) return EMPTY_QUICK_LIMIT_ORDERS;
  const rows = values
    .filter((order) => order.tokenId === tokenId && order.status === 'open')
    .sort((a, b) => b.createdAtMs - a.createdAtMs);
  return rows.length > 0 ? rows : EMPTY_QUICK_LIMIT_ORDERS;
}

function getQuickPendingOrdersForToken(
  s: ReturnType<typeof useTradingStore.getState>,
  tokenId: string
): QuickPendingOrder[] {
  const values = Object.values(s.pendingQuickOrdersById);
  if (values.length === 0) return EMPTY_PENDING_QUICK_ORDERS;
  const rows = values
    .filter((order) => order.tokenId === tokenId)
    .sort((a, b) => b.submitMs - a.submitMs);
  return rows.length > 0 ? rows : EMPTY_PENDING_QUICK_ORDERS;
}

function getAvgTradePrice(trades: QuickTrade[], side: Side): number | null {
  let qty = 0;
  let notional = 0;
  for (let i = 0; i < trades.length; i++) {
    const t = trades[i]!;
    if (t.side !== side) continue;
    if (!Number.isFinite(t.qty) || !Number.isFinite(t.priceUsd)) continue;
    if (t.qty <= 0 || t.priceUsd <= 0) continue;
    qty += t.qty;
    notional += t.qty * t.priceUsd;
  }
  if (qty <= 0) return null;
  return notional / qty;
}

function buildQuickPositionSummary(
  position: QuickPosition | null,
  trades: QuickTrade[],
  tokenId: string,
  currentPriceUsd: number
): QuickPositionSummary {
  const qty = position?.qty ?? 0;
  const boughtUsd = position?.boughtUsd ?? 0;
  const soldUsd = position?.soldUsd ?? 0;
  const costBasisUsd = position?.costBasisUsd ?? 0;
  const realizedUsd = position?.realizedPnlUsd ?? 0;
  const safePriceUsd = Number.isFinite(currentPriceUsd) && currentPriceUsd > 0 ? currentPriceUsd : 0;
  const holdingUsd = qty > 0 ? qty * safePriceUsd : 0;
  const unrealizedUsd = qty > 0 ? holdingUsd - costBasisUsd : 0;
  const avgBuyPriceUsd = getAvgTradePrice(trades, 'buy') ?? (position?.avgEntryUsd ?? null);
  const avgSellPriceUsd = getAvgTradePrice(trades, 'sell');
  return {
    tokenId,
    qty,
    avgBuyPriceUsd,
    avgSellPriceUsd,
    boughtUsd,
    soldUsd,
    costBasisUsd,
    realizedUsd,
    holdingUsd,
    unrealizedUsd,
    totalPnlUsd: realizedUsd + unrealizedUsd,
    updatedAtMs: position?.updatedAtMs ?? 0,
    hasOpenPosition: qty > 0,
    hasHistory: trades.length > 0,
    tradesCount: trades.length,
    recentFills: trades.slice(-8).reverse(),
  };
}

