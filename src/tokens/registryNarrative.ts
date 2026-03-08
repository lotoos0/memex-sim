import { getTokenAvatarUrl } from '../lib/tokenAvatar';
import type { TokenPost } from '../store/postStore';
import { usePostStore } from '../store/postStore';
import type { NarrativeEvent, NarrativePost, TokenNarrativeState } from '../narrative/narrativeTypes';
import { applyNarrativeEvent, createTokenNarrativeState } from '../narrative/tokenNarrative';
import type { TokenPhase } from './types';
import type { MarketMicroSnapshot, TokenSim } from './tokenSim';

export class RegistryNarrativeRelay {
  private lastProcessedTradeMsByToken = new Map<string, number>();
  private narrativeByTokenId = new Map<string, TokenNarrativeState>();

  registerToken(tokenId: string): void {
    this.lastProcessedTradeMsByToken.set(tokenId, 0);
    this.narrativeByTokenId.set(tokenId, createTokenNarrativeState(tokenId));
  }

  clear(): void {
    this.lastProcessedTradeMsByToken.clear();
    this.narrativeByTokenId.clear();
  }

  emitLaunch(sim: TokenSim): void {
    const runtime = sim.getRuntime();
    this.emit({
      kind: 'TOKEN_LAUNCH',
      tokenId: sim.meta.id,
      simNowMs: runtime.simTimeMs,
      tokenName: sim.meta.name,
      tokenSymbol: sim.meta.ticker,
      priceUsd: runtime.lastPriceUsd,
      mcapUsd: runtime.mcapUsd,
    });
  }

  processMarketSnapshot(sim: TokenSim, snapshot: MarketMicroSnapshot): void {
    const trades = snapshot.recentTrades ?? [];
    if (trades.length === 0) return;

    const tokenId = sim.meta.id;
    const prevSeen = this.lastProcessedTradeMsByToken.get(tokenId) ?? 0;
    let maxSeen = prevSeen;
    let biggest: (typeof trades)[number] | null = null;
    const threshold = bigTradeThresholdUsd(sim.getLastMcapUsd());

    for (let i = 0; i < trades.length; i++) {
      const tr = trades[i]!;
      if (!Number.isFinite(tr.tMs)) continue;
      if (tr.tMs > maxSeen) maxSeen = tr.tMs;
      if (tr.tMs <= prevSeen) continue;
      if (tr.notionalUsd < threshold) continue;
      if (!biggest || tr.notionalUsd > biggest.notionalUsd) biggest = tr;
    }

    if (maxSeen > prevSeen) this.lastProcessedTradeMsByToken.set(tokenId, maxSeen);
    if (!biggest) return;

    this.emit({
      kind: biggest.side === 'BUY' ? 'BIG_BUY' : 'BIG_SELL',
      tokenId,
      simNowMs: sim.getSimTimeMs(),
      tokenName: sim.meta.name,
      tokenSymbol: sim.meta.ticker,
      usd: biggest.notionalUsd,
      priceUsd: biggest.priceUsd,
      mcapUsd: biggest.mcapUsd,
      impact: threshold > 0 ? biggest.notionalUsd / threshold : 1,
    });
  }

  processPhaseChange(sim: TokenSim, nextPhase: TokenPhase): void {
    if (nextPhase !== 'MIGRATED' && nextPhase !== 'RUGGED' && nextPhase !== 'DEAD') return;
    this.emit({
      kind: nextPhase === 'MIGRATED' ? 'TOKEN_MIGRATION' : 'TOKEN_RUG',
      tokenId: sim.meta.id,
      simNowMs: sim.getSimTimeMs(),
      tokenName: sim.meta.name,
      tokenSymbol: sim.meta.ticker,
      mcapUsd: sim.getLastMcapUsd(),
    });
  }

  private emit(event: NarrativeEvent): void {
    const existingState =
      this.narrativeByTokenId.get(event.tokenId) ?? createTokenNarrativeState(event.tokenId);
    const out = applyNarrativeEvent(event, existingState);
    this.narrativeByTokenId.set(event.tokenId, out.state);
    if (out.posts.length === 0) return;
    usePostStore.getState().appendPosts(event.tokenId, out.posts.map(mapNarrativePost));
  }
}

function mapNarrativePost(post: NarrativePost): TokenPost {
  return {
    id: post.id,
    tokenId: post.tokenId,
    kind: post.kind,
    tone: post.tone,
    author: post.authorHandle,
    authorName: post.authorName,
    authorHandle: post.authorHandle,
    authorAvatar: getTokenAvatarUrl(`author:${post.authorId}`),
    text: post.text,
    createdAtMs: post.simNowMs,
    simNowMs: post.simNowMs,
    topic: post.topic,
    importance: post.importance,
    tags: post.tags,
  };
}

function bigTradeThresholdUsd(mcapUsd: number): number {
  const raw = mcapUsd * 0.002;
  return Math.max(200, Math.min(1500, raw));
}
