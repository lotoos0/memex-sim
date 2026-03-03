import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type PersistedFavoritesState = {
  favoritesById?: Record<string, true>;
  favoriteIds?: string[];
  favorites?: string[];
};

type FavoritesStoreState = {
  favoritesById: Record<string, true>;
  favoriteIds: string[];
  toggleFavorite: (tokenId: string) => void;
  isFavorite: (tokenId: string) => boolean;
  clearFavorites: () => void;
};

function normalizePersistedFavorites(input: PersistedFavoritesState | null | undefined): {
  favoritesById: Record<string, true>;
  favoriteIds: string[];
} {
  const idsFromList = Array.isArray(input?.favoriteIds)
    ? input!.favoriteIds!
    : Array.isArray(input?.favorites)
      ? input!.favorites!
      : [];
  const idsFromMap = input?.favoritesById ? Object.keys(input.favoritesById) : [];

  const seen = new Set<string>();
  const favoriteIds: string[] = [];
  for (let i = 0; i < idsFromList.length; i++) {
    const id = idsFromList[i];
    if (typeof id !== 'string') continue;
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    favoriteIds.push(trimmed);
  }
  for (let i = 0; i < idsFromMap.length; i++) {
    const id = idsFromMap[i];
    if (typeof id !== 'string') continue;
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    favoriteIds.push(trimmed);
  }

  const favoritesById: Record<string, true> = {};
  for (let i = 0; i < favoriteIds.length; i++) {
    favoritesById[favoriteIds[i]!] = true;
  }
  return { favoritesById, favoriteIds };
}

export const useFavoritesStore = create<FavoritesStoreState>()(
  persist(
    (set, get) => ({
      favoritesById: {},
      favoriteIds: [],

      toggleFavorite: (tokenId: string) =>
        set((state) => {
          const nextId = typeof tokenId === 'string' ? tokenId.trim() : '';
          if (!nextId) return state;

          if (state.favoritesById[nextId]) {
            const nextById = { ...state.favoritesById };
            delete nextById[nextId];
            return {
              favoritesById: nextById,
              favoriteIds: state.favoriteIds.filter((id) => id !== nextId),
            };
          }

          const nextById = {
            ...state.favoritesById,
            [nextId]: true as const,
          };
          const nextIds = state.favoriteIds.includes(nextId)
            ? state.favoriteIds
            : [nextId, ...state.favoriteIds];
          return {
            favoritesById: nextById,
            favoriteIds: nextIds,
          };
        }),

      isFavorite: (tokenId: string) => {
        const nextId = typeof tokenId === 'string' ? tokenId.trim() : '';
        if (!nextId) return false;
        return Boolean(get().favoritesById[nextId]);
      },

      clearFavorites: () =>
        set({
          favoritesById: {},
          favoriteIds: [],
        }),
    }),
    {
      name: 'favorites:v1',
      version: 1,
      partialize: (state) => ({
        favoritesById: state.favoritesById,
        favoriteIds: state.favoriteIds,
      }),
      migrate: (persistedState) =>
        normalizePersistedFavorites((persistedState ?? null) as PersistedFavoritesState | null),
    }
  )
);

export const selectFavoriteIds = (s: FavoritesStoreState) => s.favoriteIds;
