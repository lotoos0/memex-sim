import { create } from 'zustand';
import type { TokenMeta, TokenRuntime, TokenPhase, TokenState } from '../tokens/types';

interface TokenStoreState {
  tokensById: Record<string, TokenState>;
  activeTokenId: string | null;

  addToken: (meta: TokenMeta, runtime: TokenRuntime) => void;
  updateToken: (id: string, runtime: TokenRuntime) => void;
  batchUpdateTokens: (updates: Record<string, TokenRuntime>) => void;
  removeToken: (id: string) => void;
  setActiveToken: (id: string | null) => void;
}

export const useTokenStore = create<TokenStoreState>((set) => ({
  tokensById: {},
  activeTokenId: null,

  addToken: (meta, runtime) =>
    set(s => ({ tokensById: { ...s.tokensById, [meta.id]: { ...meta, ...runtime } } })),

  updateToken: (id, runtime) =>
    set(s => {
      const existing = s.tokensById[id];
      if (!existing) return s;
      return { tokensById: { ...s.tokensById, [id]: { ...existing, ...runtime } } };
    }),

  batchUpdateTokens: (updates) =>
    set(s => {
      const next = { ...s.tokensById };
      for (const [id, runtime] of Object.entries(updates)) {
        if (next[id]) next[id] = { ...next[id]!, ...runtime };
      }
      return { tokensById: next };
    }),

  removeToken: (id) =>
    set(s => {
      const next = { ...s.tokensById };
      delete next[id];
      return { tokensById: next };
    }),

  setActiveToken: (id) => set({ activeTokenId: id }),
}));

// ── Selectors ──────────────────────────────────────────────
export const selectByPhase = (phase: TokenPhase) => (s: TokenStoreState) =>
  Object.values(s.tokensById)
    .filter(t => t.phase === phase)
    .sort((a, b) => b.mcapUsd - a.mcapUsd);

export const selectActiveToken = (s: TokenStoreState) =>
  s.activeTokenId ? s.tokensById[s.activeTokenId] : null;
