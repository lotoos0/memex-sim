import { create } from 'zustand';

export type TokenPostKind = 'SYSTEM' | 'TRADE' | 'USER';
export type TokenPostTone = 'neutral' | 'buy' | 'sell' | 'warn';
export type TokenPostTopic = 'launch' | 'buy' | 'sell' | 'migration' | 'rug' | 'chart' | 'meta';
export type TokenPostImportance = 'minor' | 'major';

export interface TokenPost {
  id: string;
  tokenId: string;
  kind: TokenPostKind;
  tone: TokenPostTone;
  author: string;
  authorName?: string;
  authorHandle?: string;
  authorAvatar?: string;
  text: string;
  createdAtMs: number;
  simNowMs?: number;
  topic?: TokenPostTopic;
  importance?: TokenPostImportance;
  tags?: string[];
}

interface PostStoreState {
  postsByTokenId: Record<string, TokenPost[]>;
  addSystemPost: (tokenId: string, text: string, options?: { kind?: TokenPostKind; tone?: TokenPostTone; author?: string; createdAtMs?: number }) => void;
  addUserPost: (tokenId: string, text: string, author?: string, options?: { createdAtMs?: number }) => void;
  appendPosts: (tokenId: string, posts: TokenPost[]) => void;
  clearTokenPosts: (tokenId: string) => void;
}

const MAX_POSTS_PER_TOKEN = 220;

function makeId(): string {
  return `P${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function trimText(text: string): string {
  return text.trim().slice(0, 360);
}

function normalizePost(row: TokenPost): TokenPost | null {
  const safeText = trimText(row.text);
  if (!safeText) return null;
  return {
    ...row,
    text: safeText,
    id: row.id || makeId(),
    createdAtMs: Number.isFinite(row.createdAtMs) ? row.createdAtMs : Date.now(),
  };
}

export const usePostStore = create<PostStoreState>((set) => ({
  postsByTokenId: {},

  addSystemPost: (tokenId, text, options) =>
    set((state) => {
      const safeText = trimText(text);
      if (!safeText) return state;
      const prev = state.postsByTokenId[tokenId] ?? [];
      const next: TokenPost = {
        id: makeId(),
        tokenId,
        kind: options?.kind ?? 'SYSTEM',
        tone: options?.tone ?? 'neutral',
        author: options?.author ?? 'system',
        text: safeText,
        createdAtMs: options?.createdAtMs ?? Date.now(),
      };
      return {
        postsByTokenId: {
          ...state.postsByTokenId,
          [tokenId]: prev.concat([next]).slice(-MAX_POSTS_PER_TOKEN),
        },
      };
    }),

  addUserPost: (tokenId, text, author = 'you', options) =>
    set((state) => {
      const safeText = trimText(text);
      if (!safeText) return state;
      const prev = state.postsByTokenId[tokenId] ?? [];
      const next: TokenPost = {
        id: makeId(),
        tokenId,
        kind: 'USER',
        tone: 'neutral',
        author,
        text: safeText,
        createdAtMs: options?.createdAtMs ?? Date.now(),
      };
      return {
        postsByTokenId: {
          ...state.postsByTokenId,
          [tokenId]: prev.concat([next]).slice(-MAX_POSTS_PER_TOKEN),
        },
      };
    }),

  appendPosts: (tokenId, posts) =>
    set((state) => {
      if (!posts.length) return state;
      const prev = state.postsByTokenId[tokenId] ?? [];
      const seen = new Set(prev.map((p) => p.id));
      const next = prev.slice();

      for (let i = 0; i < posts.length; i++) {
        const normalized = normalizePost(posts[i]!);
        if (!normalized) continue;
        if (normalized.tokenId !== tokenId) continue;
        if (seen.has(normalized.id)) continue;
        seen.add(normalized.id);
        next.push(normalized);
      }

      if (next.length === prev.length) return state;

      next.sort((a, b) => a.createdAtMs - b.createdAtMs);
      return {
        postsByTokenId: {
          ...state.postsByTokenId,
          [tokenId]: next.slice(-MAX_POSTS_PER_TOKEN),
        },
      };
    }),

  clearTokenPosts: (tokenId) =>
    set((state) => {
      if (!state.postsByTokenId[tokenId]) return state;
      const next = { ...state.postsByTokenId };
      delete next[tokenId];
      return { postsByTokenId: next };
    }),
}));
