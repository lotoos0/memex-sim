import { create } from 'zustand';
import type { TokenMeta, TokenRuntime, TokenPhase, TokenState } from '../tokens/types';
import type { TokenChartEvent } from '../chart/tokenChartEvents';
import { MAX_EVENTS_PER_TOKEN } from '../chart/tokenChartEvents';
import type { SessionBucket } from '../market/session';

export interface TokenSimTradeRow {
  id: string;
  tMs: number;
  side: 'BUY' | 'SELL';
  walletId: string;
  tokenAmount: number;
  notionalUsd: number;
  priceUsd: number;
  mcapUsd: number;
}

export interface TokenHolderRow {
  walletId: string;
  isLiquidityPool?: boolean;
  solBalance: number;
  firstSeenMs: number;
  balanceTokens: number;
  balanceUsd: number;
  boughtUsd: number;
  boughtTokens: number;
  avgBuyUsd: number;
  soldUsd: number;
  soldTokens: number;
  avgSellUsd: number;
  unrealizedPnlUsd: number;
  realizedPnlUsd: number;
  remainingUsd: number;
  lastActiveMs: number;
}

export interface TokenMarketSnapshot {
  holdersCount: number;
  topHolders: TokenHolderRow[];
  recentTrades: TokenSimTradeRow[];
  updatedAtMs: number;
}

export interface TokenTradeFlowSnapshot {
  buys60s: number;
  sells60s: number;
  tx60s: number;
}

interface TokenStoreState {
  tokensById: Record<string, TokenState>;
  eventsByTokenId: Record<string, TokenChartEvent[]>;
  marketByTokenId: Record<string, TokenMarketSnapshot>;
  tradeFlowByTokenId: Record<string, TokenTradeFlowSnapshot>;
  activeTokenId: string | null;
  marketSessionBucket: SessionBucket;
  marketSessionBucketOverride: SessionBucket | null;

  addToken: (meta: TokenMeta, runtime: TokenRuntime) => void;
  updateToken: (id: string, runtime: TokenRuntime) => void;
  batchUpdateTokens: (updates: Record<string, TokenRuntime>) => void;
  setTokenMarketSnapshot: (tokenId: string, snapshot: TokenMarketSnapshot) => void;
  batchUpdateTokenMarketSnapshots: (updates: Record<string, TokenMarketSnapshot>) => void;
  batchUpdateTradeFlows: (updates: Record<string, TokenTradeFlowSnapshot>) => void;
  setMarketSessionBucket: (bucket: SessionBucket) => void;
  setMarketSessionBucketOverride: (bucket: SessionBucket | null) => void;
  removeToken: (id: string) => void;
  setActiveToken: (id: string | null) => void;
  pushTokenEvents: (tokenId: string, events: TokenChartEvent[]) => void;
}

export const useTokenStore = create<TokenStoreState>((set) => ({
  tokensById: {},
  eventsByTokenId: {},
  marketByTokenId: {},
  tradeFlowByTokenId: {},
  activeTokenId: null,
  marketSessionBucket: 'OFF',
  marketSessionBucketOverride: null,

  addToken: (meta, runtime) =>
    set((s) => ({ tokensById: { ...s.tokensById, [meta.id]: { ...meta, ...runtime } } })),

  updateToken: (id, runtime) =>
    set((s) => {
      const existing = s.tokensById[id];
      if (!existing) return s;
      return { tokensById: { ...s.tokensById, [id]: { ...existing, ...runtime } } };
    }),

  batchUpdateTokens: (updates) =>
    set((s) => {
      const next = { ...s.tokensById };
      for (const [id, runtime] of Object.entries(updates)) {
        if (next[id]) next[id] = { ...next[id]!, ...runtime };
      }
      return { tokensById: next };
    }),

  setTokenMarketSnapshot: (tokenId, snapshot) =>
    set((s) => ({
      marketByTokenId: {
        ...s.marketByTokenId,
        [tokenId]: snapshot,
      },
      tradeFlowByTokenId: {
        ...s.tradeFlowByTokenId,
        [tokenId]: computeTradeFlow60s(snapshot),
      },
    })),

  batchUpdateTokenMarketSnapshots: (updates) =>
    set((s) => {
      const next = { ...s.marketByTokenId };
      const nextFlow = { ...s.tradeFlowByTokenId };
      for (const [id, snapshot] of Object.entries(updates)) {
        if (!s.tokensById[id]) continue;
        next[id] = snapshot;
        nextFlow[id] = computeTradeFlow60s(snapshot);
      }
      return { marketByTokenId: next, tradeFlowByTokenId: nextFlow };
    }),

  batchUpdateTradeFlows: (updates) =>
    set((s) => {
      let changed = false;
      const nextFlow = { ...s.tradeFlowByTokenId };
      for (const [id, flow] of Object.entries(updates)) {
        if (!s.tokensById[id]) continue;
        const prev = nextFlow[id];
        if (
          prev
          && prev.buys60s === flow.buys60s
          && prev.sells60s === flow.sells60s
          && prev.tx60s === flow.tx60s
        ) continue;
        nextFlow[id] = flow;
        changed = true;
      }
      return changed ? { tradeFlowByTokenId: nextFlow } : s;
    }),

  setMarketSessionBucket: (bucket) =>
    set((s) => (s.marketSessionBucket === bucket ? s : { marketSessionBucket: bucket })),

  setMarketSessionBucketOverride: (bucket) =>
    set((s) => (s.marketSessionBucketOverride === bucket ? s : { marketSessionBucketOverride: bucket })),

  removeToken: (id) =>
    set((s) => {
      const nextTokens = { ...s.tokensById };
      delete nextTokens[id];
      const nextEvents = { ...s.eventsByTokenId };
      delete nextEvents[id];
      const nextMarket = { ...s.marketByTokenId };
      delete nextMarket[id];
      const nextFlow = { ...s.tradeFlowByTokenId };
      delete nextFlow[id];
      return {
        tokensById: nextTokens,
        eventsByTokenId: nextEvents,
        marketByTokenId: nextMarket,
        tradeFlowByTokenId: nextFlow,
      };
    }),

  setActiveToken: (id) => set({ activeTokenId: id }),

  pushTokenEvents: (tokenId, events) =>
    set((s) => {
      if (!events.length) return s;
      const prev = s.eventsByTokenId[tokenId] ?? [];
      const appended = prev.concat(events);
      const next =
        appended.length > MAX_EVENTS_PER_TOKEN
          ? appended.slice(appended.length - MAX_EVENTS_PER_TOKEN)
          : appended;
      return {
        eventsByTokenId: {
          ...s.eventsByTokenId,
          [tokenId]: next,
        },
      };
    }),
}));

export const selectByPhase = (phase: TokenPhase) => (s: TokenStoreState) =>
  Object.values(s.tokensById)
    .filter((t) => t.phase === phase)
    .sort((a, b) => b.mcapUsd - a.mcapUsd);

export const selectActiveToken = (s: TokenStoreState) =>
  s.activeTokenId ? s.tokensById[s.activeTokenId] : null;

export const selectTokenMarketSnapshot = (tokenId: string) => (s: TokenStoreState) =>
  s.marketByTokenId[tokenId] ?? null;

export const selectTokenTradeFlow60s = (tokenId: string) => (s: TokenStoreState): TokenTradeFlowSnapshot =>
  s.tradeFlowByTokenId[tokenId] ?? EMPTY_TRADE_FLOW;

export const selectTokenAgeLabel = (tokenId: string) => (s: TokenStoreState): string => {
  const token = s.tokensById[tokenId];
  if (!token) return '0s';
  return formatTokenAgeLabel(token.simTimeMs, token.createdAtSimMs);
};

export const selectMarketSessionBucket = (s: TokenStoreState) => s.marketSessionBucket;
export const selectMarketSessionBucketOverride = (s: TokenStoreState) => s.marketSessionBucketOverride;

export const TRADE_FLOW_WINDOW_MS = 60_000;
const EMPTY_TRADE_FLOW: TokenTradeFlowSnapshot = Object.freeze({ buys60s: 0, sells60s: 0, tx60s: 0 });

export type TradeFlowRoll = {
  flow: TokenTradeFlowSnapshot;
  /**
   * Last `nowMs` at which the oldest in-window trade is still counted.
   * The next millisecond drops it. Infinity when the window is empty.
   */
  nextExpiryMs: number;
};

/** Count buys and sells in the last 60s of `nowMs`, and when the next one ages out. */
export function tradeFlowFromTrades(
  trades: readonly { tMs: number; side: 'BUY' | 'SELL' }[],
  nowMs: number,
): TradeFlowRoll {
  const cutoff = nowMs - TRADE_FLOW_WINDOW_MS;
  let buys = 0;
  let sells = 0;
  let oldestMs = Number.POSITIVE_INFINITY;
  for (let i = 0; i < trades.length; i++) {
    const trade = trades[i]!;
    if (!(trade.tMs >= cutoff)) continue;
    if (trade.tMs < oldestMs) oldestMs = trade.tMs;
    if (trade.side === 'BUY') buys += 1;
    else sells += 1;
  }
  const tx = buys + sells;
  if (tx === 0) return { flow: EMPTY_TRADE_FLOW, nextExpiryMs: Number.POSITIVE_INFINITY };
  return {
    flow: { buys60s: buys, sells60s: sells, tx60s: tx },
    nextExpiryMs: oldestMs + TRADE_FLOW_WINDOW_MS,
  };
}

function computeTradeFlow60s(snapshot: TokenMarketSnapshot): TokenTradeFlowSnapshot {
  return tradeFlowFromTrades(snapshot.recentTrades ?? [], snapshot.updatedAtMs).flow;
}

function formatTokenAgeLabel(simTimeMs: number, createdAtSimMs: number): string {
  const ageMs = Math.max(0, simTimeMs - createdAtSimMs);
  const ageSec = Math.floor(ageMs / 1000);
  if (ageSec < 60) return `${ageSec}s`;
  if (ageSec < 3600) return `${Math.floor(ageSec / 60)}m`;
  return `${Math.floor(ageSec / 3600)}h`;
}
