import { useTokenStore } from '../store/tokenStore';
import type { MarketMicroSnapshot, TokenSim } from './tokenSim';

export function publishRegistryFeed(
  tokens: Map<string, TokenSim>,
  onSnapshot?: (tokenId: string, sim: TokenSim, market: MarketMicroSnapshot) => void
): void {
  const updates: Record<string, ReturnType<TokenSim['getRuntime']>> = {};
  const marketUpdates: Record<string, MarketMicroSnapshot> = {};

  for (const [tokenId, sim] of tokens) {
    updates[tokenId] = sim.getRuntime();
    // Dormant births do not rebuild holder lists every second.
    if (!sim.takeMarketDirty()) continue;
    const market = sim.getMarketSnapshot();
    marketUpdates[tokenId] = market;
    onSnapshot?.(tokenId, sim, market);
  }

  const store = useTokenStore.getState();
  store.batchUpdateTokens(updates);
  if (Object.keys(marketUpdates).length > 0) {
    store.batchUpdateTokenMarketSnapshots(marketUpdates);
  }
}
