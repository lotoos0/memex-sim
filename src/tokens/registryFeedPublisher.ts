import { useTokenStore } from '../store/tokenStore';
import type { MarketMicroSnapshot, TokenSim } from './tokenSim';

export function publishRegistryFeed(
  tokens: Map<string, TokenSim>,
  onSnapshot?: (tokenId: string, sim: TokenSim, market: MarketMicroSnapshot) => void
): void {
  const updates: Record<string, ReturnType<TokenSim['getRuntime']>> = {};
  const marketUpdates: Record<string, MarketMicroSnapshot> = {};

  for (const [tokenId, sim] of tokens) {
    const runtime = sim.getRuntime();
    const market = sim.getMarketSnapshot();
    updates[tokenId] = runtime;
    marketUpdates[tokenId] = market;
    onSnapshot?.(tokenId, sim, market);
  }

  const store = useTokenStore.getState();
  store.batchUpdateTokens(updates);
  store.batchUpdateTokenMarketSnapshots(marketUpdates);
}
