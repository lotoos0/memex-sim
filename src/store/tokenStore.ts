import { create } from 'zustand';
import type { TokenMeta, TokenRuntime, TokenPhase, TokenState } from '../tokens/types';
import type { TokenChartEvent } from '../chart/tokenChartEvents';
import { MAX_EVENTS_PER_TOKEN } from '../chart/tokenChartEvents';

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

interface TokenStoreState {
  tokensById: Record<string, TokenState>;
  eventsByTokenId: Record<string, TokenChartEvent[]>;
  marketByTokenId: Record<string, TokenMarketSnapshot>;
  activeTokenId: string | null;

  addToken: (meta: TokenMeta, runtime: TokenRuntime) => void;
  updateToken: (id: string, runtime: TokenRuntime) => void;
  batchUpdateTokens: (updates: Record<string, TokenRuntime>) => void;
  setTokenMarketSnapshot: (tokenId: string, snapshot: TokenMarketSnapshot) => void;
  batchUpdateTokenMarketSnapshots: (updates: Record<string, TokenMarketSnapshot>) => void;
  removeToken: (id: string) => void;
  setActiveToken: (id: string | null) => void;
  pushTokenEvents: (tokenId: string, events: TokenChartEvent[]) => void;
}

export const useTokenStore = create<TokenStoreState>((set) => ({
  tokensById: {},
  eventsByTokenId: {},
  marketByTokenId: {},
  activeTokenId: null,

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
    })),

  batchUpdateTokenMarketSnapshots: (updates) =>
    set((s) => {
      const next = { ...s.marketByTokenId };
      for (const [id, snapshot] of Object.entries(updates)) {
        if (!s.tokensById[id]) continue;
        next[id] = snapshot;
      }
      return { marketByTokenId: next };
    }),

  removeToken: (id) =>
    set((s) => {
      const nextTokens = { ...s.tokensById };
      delete nextTokens[id];
      const nextEvents = { ...s.eventsByTokenId };
      delete nextEvents[id];
      const nextMarket = { ...s.marketByTokenId };
      delete nextMarket[id];
      return { tokensById: nextTokens, eventsByTokenId: nextEvents, marketByTokenId: nextMarket };
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
