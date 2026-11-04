import { tradeFlowFromTrades, useTokenStore, type TokenTradeFlowSnapshot } from '../store/tokenStore';
import type { MarketMicroSnapshot, TokenSim } from './tokenSim';

export function publishRegistryFeed(
  tokens: Map<string, TokenSim>,
  onSnapshot?: (tokenId: string, sim: TokenSim, market: MarketMicroSnapshot) => void
): void {
  const nowMs = Date.now();
  const store = useTokenStore.getState();
  const updates: Record<string, ReturnType<TokenSim['getRuntime']>> = {};
  const marketUpdates: Record<string, MarketMicroSnapshot> = {};
  const flowUpdates: Record<string, TokenTradeFlowSnapshot> = {};

  for (const [tokenId, sim] of tokens) {
    updates[tokenId] = sim.getRuntime();
    // Holder lists stay put while a coin is quiet. The 60s buy/sell counts
    // still move when the oldest trade in that window ages out.
    if (sim.takeMarketDirty()) {
      const market = sim.getMarketSnapshot();
      marketUpdates[tokenId] = market;
      sim.armTradeFlowExpiry(tradeFlowFromTrades(market.recentTrades, market.updatedAtMs).nextExpiryMs);
      onSnapshot?.(tokenId, sim, market);
      continue;
    }
    if (!sim.tradeFlowDue(nowMs)) continue;
    const existing = store.marketByTokenId[tokenId];
    const rolled = tradeFlowFromTrades(existing?.recentTrades ?? [], nowMs);
    flowUpdates[tokenId] = rolled.flow;
    sim.armTradeFlowExpiry(rolled.nextExpiryMs);
  }

  store.batchUpdateTokens(updates);
  if (Object.keys(marketUpdates).length > 0) {
    store.batchUpdateTokenMarketSnapshots(marketUpdates);
  }
  if (Object.keys(flowUpdates).length > 0) {
    store.batchUpdateTradeFlows(flowUpdates);
  }
}
