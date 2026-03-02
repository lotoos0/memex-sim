import { RNG } from '../engine/rng';
import type { Candle } from '../engine/types';
import { getTokenAvatarUrl } from '../lib/tokenAvatar';
import { usePostStore } from '../store/postStore';
import { useTokenStore } from '../store/tokenStore';
import { generateToken, getFateTimeoutSimMs, getStartingMcapUsd } from './generator';
import { TokenSim, type MarketMicroSnapshot, type UserTradeExecutionNotice, type UserTradeOrderStatus, type UserTradeQuote, type UserTradeSide, type UserTradeSubmitRequest, type UserTradeSubmitResult } from './tokenSim';
import type { TokenPhase } from './types';
import type { NarrativeEvent, NarrativePost, TokenNarrativeState } from '../narrative/narrativeTypes';
import { applyNarrativeEvent, createTokenNarrativeState } from '../narrative/tokenNarrative';

const TICK_MS = 200;
const FEED_PUBLISH_MS = 1000;
const SPAWN_INTERVAL_MS = 40_000;
const RUGGED_LINGER_MS = 90_000;
const MAX_NEW = 5;
const MAX_FINAL = 5;
const MAX_MIGRATED = 5;
const INITIAL_TOKENS = 12;
const MAX_ORDER_SNAPSHOTS = 4_000;

export type ChartMetric = 'mcap' | 'price';
export type ChartCallback = (candles: Candle[], lastValue: number) => void;
export type TradeExecutionCallback = (execution: UserTradeExecutionNotice) => void;

class TokenRegistry {
  private tokens = new Map<string, TokenSim>();
  private rng = new RNG(Date.now() & 0xffffffff);
  private tradeOrders = new Map<string, UserTradeOrderStatus>();
  private tradeExecutionSubscribers = new Set<TradeExecutionCallback>();

  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private feedHandle: ReturnType<typeof setInterval> | null = null;
  private spawnHandle: ReturnType<typeof setInterval> | null = null;

  private chartCb: ChartCallback | null = null;
  private activeTfSec = 1;
  private activeMetric: ChartMetric = 'mcap';

  private ruggedAt = new Map<string, number>();
  private phaseByTokenId = new Map<string, TokenPhase>();
  private lastProcessedTradeMsByToken = new Map<string, number>();
  private narrativeByTokenId = new Map<string, TokenNarrativeState>();

  start(): void {
    if (this.tickHandle) return;

    this.spawnBatch(INITIAL_TOKENS);

    this.tickHandle = setInterval(() => {
      const realDtSec = TICK_MS / 1000;

      for (const [id, sim] of this.tokens) {
        const events = sim.tick(realDtSec);
        if (events.length > 0) {
          useTokenStore.getState().pushTokenEvents(id, events);
        }

        const executions = sim.drainUserTradeExecutions();
        if (executions.length > 0) {
          useTokenStore.getState().updateToken(id, sim.getRuntime());
          const simNowMs = sim.getSimTimeMs();
          for (let j = 0; j < executions.length; j++) {
            const execution = executions[j]!;
            this.tradeOrders.set(execution.orderId, execution);
            this.pruneTradeOrders();
            if (execution.status === 'FILLED') {
              usePostStore.getState().addSystemPost(
                id,
                `You ${execution.side} ${fmtUsdCompact(execution.fill.filledUsd)} @ ${fmtPrice(execution.fill.avgPriceUsd)}`,
                {
                  kind: 'TRADE',
                  tone: execution.side === 'BUY' ? 'buy' : 'sell',
                  author: 'you',
                  createdAtMs: simNowMs,
                }
              );
              useTokenStore.getState().pushTokenEvents(id, [{
                tokenId: id,
                tMs: execution.fill.tsMs,
                type: execution.side === 'BUY' ? 'USER_BUY' : 'USER_SELL',
                price: execution.fill.priceAfterUsd,
                mcap: execution.fill.mcapAfterUsd,
                size: execution.fill.filledToken,
              }]);
            }
            if (this.tradeExecutionSubscribers.size > 0) {
              for (const cb of this.tradeExecutionSubscribers) cb(execution);
            }
          }
        }

        const prevPhase = this.phaseByTokenId.get(id);
        const nextPhase = sim.getPhase();
        if (prevPhase && prevPhase !== nextPhase) {
          this.postPhaseChange(sim, prevPhase, nextPhase);
        }
        this.phaseByTokenId.set(id, nextPhase);

        if (sim.getPhase() === 'RUGGED' && !this.ruggedAt.has(id)) {
          this.ruggedAt.set(id, Date.now());
        }
      }

      const activeId = useTokenStore.getState().activeTokenId;
      if (this.chartCb && activeId) {
        const sim = this.tokens.get(activeId);
        if (sim) {
          if (this.activeMetric === 'mcap') {
            this.chartCb(sim.getCandles(this.activeTfSec, 'mcap'), sim.getLastMcapUsd());
          } else {
            this.chartCb(sim.getCandles(this.activeTfSec, 'price'), sim.getLastPriceUsd());
          }
        }
      }
    }, TICK_MS);

    this.feedHandle = setInterval(() => {
      this.publishFeed();
      this.cleanupDead();
    }, FEED_PUBLISH_MS);

    this.spawnHandle = setInterval(() => {
      this.maybeSpawn();
    }, SPAWN_INTERVAL_MS);
  }

  stop(): void {
    if (this.tickHandle) clearInterval(this.tickHandle);
    if (this.feedHandle) clearInterval(this.feedHandle);
    if (this.spawnHandle) clearInterval(this.spawnHandle);
    this.tickHandle = this.feedHandle = this.spawnHandle = null;
    this.tokens.clear();
    this.ruggedAt.clear();
    this.tradeOrders.clear();
    this.phaseByTokenId.clear();
    this.lastProcessedTradeMsByToken.clear();
    this.narrativeByTokenId.clear();
  }

  setChartCallback(cb: ChartCallback | null): void {
    this.chartCb = cb;
  }

  setActiveTfSec(tfSec: number): void {
    this.activeTfSec = tfSec;
  }

  setActiveMetric(metric: ChartMetric): void {
    this.activeMetric = metric;
  }

  getTokenSim(id: string): TokenSim | undefined {
    return this.tokens.get(id);
  }

  quoteTrade(tokenId: string, side: UserTradeSide, amountIn: number, slippageBps: number): UserTradeQuote {
    const sim = this.tokens.get(tokenId);
    if (!sim) {
      return { ok: false, side, amountIn, reason: 'Token unavailable' };
    }
    return sim.quoteUserTrade(side, amountIn, slippageBps);
  }

  submitTrade(tokenId: string, req: UserTradeSubmitRequest): UserTradeSubmitResult {
    const sim = this.tokens.get(tokenId);
    if (!sim) {
      return { ok: false, side: req.side, amountIn: req.amountIn, reason: 'Token unavailable' };
    }

    const result = sim.submitUserTrade(req);
    if (result.ok) {
      this.tradeOrders.set(result.orderId, {
        tokenId: result.tokenId,
        orderId: result.orderId,
        side: result.side,
        status: 'PENDING',
        amountIn: result.amountIn,
        expectedOut: result.expectedOut,
        minOut: result.minOut,
        slippageBps: result.slippageBps,
        submitMs: result.submitMs,
        execMs: result.execMs,
        prioritySol: result.prioritySol,
        txCostSol: result.txCostSol,
      });
      this.pruneTradeOrders();
    }
    return result;
  }

  getTradeOrderStatus(orderId: string): UserTradeOrderStatus | null {
    return this.tradeOrders.get(orderId) ?? null;
  }

  subscribeTradeExecutions(cb: TradeExecutionCallback): () => void {
    this.tradeExecutionSubscribers.add(cb);
    return () => {
      this.tradeExecutionSubscribers.delete(cb);
    };
  }

  private spawnBatch(count: number): void {
    for (let i = 0; i < count; i++) this.spawnToken();
  }

  private spawnToken(): void {
    const counts = this.phaseCounts();
    if (counts.new >= MAX_NEW && counts.final >= MAX_FINAL && counts.migrated >= MAX_MIGRATED) return;

    const meta = generateToken(this.rng, 0);
    const startMcap = getStartingMcapUsd(meta.fate, this.rng);
    const fateMsMs = getFateTimeoutSimMs(meta.fate, this.rng);

    const sim = new TokenSim(meta, startMcap, fateMsMs);
    this.tokens.set(meta.id, sim);
    this.phaseByTokenId.set(meta.id, sim.getPhase());
    this.lastProcessedTradeMsByToken.set(meta.id, 0);
    this.narrativeByTokenId.set(meta.id, createTokenNarrativeState(meta.id));

    const runtime = sim.getRuntime();
    useTokenStore.getState().addToken(meta, runtime);

    this.emitNarrative({
      kind: 'TOKEN_LAUNCH',
      tokenId: meta.id,
      simNowMs: runtime.simTimeMs,
      tokenName: meta.name,
      tokenSymbol: meta.ticker,
      priceUsd: runtime.lastPriceUsd,
      mcapUsd: runtime.mcapUsd,
    });
  }

  private maybeSpawn(): void {
    const counts = this.phaseCounts();
    const total = counts.new + counts.final;
    if (total < MAX_NEW + MAX_FINAL) this.spawnToken();
  }

  private phaseCounts(): { new: number; final: number; migrated: number } {
    let newC = 0;
    let finalC = 0;
    let migratedC = 0;
    for (const sim of this.tokens.values()) {
      switch (sim.getPhase()) {
        case 'NEW':
          newC += 1;
          break;
        case 'FINAL':
          finalC += 1;
          break;
        case 'MIGRATED':
          migratedC += 1;
          break;
      }
    }
    return { new: newC, final: finalC, migrated: migratedC };
  }

  private publishFeed(): void {
    const updates: Record<string, ReturnType<TokenSim['getRuntime']>> = {};
    const marketUpdates: Record<string, MarketMicroSnapshot> = {};

    for (const [id, sim] of this.tokens) {
      const runtime = sim.getRuntime();
      const market = sim.getMarketSnapshot();
      updates[id] = runtime;
      marketUpdates[id] = market;
      this.processBigTradeNarrative(sim, market, runtime.simTimeMs);
    }

    const store = useTokenStore.getState();
    store.batchUpdateTokens(updates);
    store.batchUpdateTokenMarketSnapshots(marketUpdates);
  }

  private cleanupDead(): void {
    const now = Date.now();
    for (const [id, rugTime] of this.ruggedAt) {
      if (now - rugTime > RUGGED_LINGER_MS) {
        this.tokens.delete(id);
        this.ruggedAt.delete(id);
        this.phaseByTokenId.delete(id);
        this.lastProcessedTradeMsByToken.delete(id);
        this.narrativeByTokenId.delete(id);
        usePostStore.getState().clearTokenPosts(id);
        useTokenStore.getState().removeToken(id);
        setTimeout(() => this.maybeSpawn(), 1000);
      }
    }
  }

  private pruneTradeOrders(): void {
    while (this.tradeOrders.size > MAX_ORDER_SNAPSHOTS) {
      const firstKey = this.tradeOrders.keys().next().value;
      if (typeof firstKey !== 'string') break;
      this.tradeOrders.delete(firstKey);
    }
  }

  private processBigTradeNarrative(
    sim: TokenSim,
    snapshot: MarketMicroSnapshot,
    simNowMs: number
  ): void {
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

    this.emitNarrative({
      kind: biggest.side === 'BUY' ? 'BIG_BUY' : 'BIG_SELL',
      tokenId,
      simNowMs,
      tokenName: sim.meta.name,
      tokenSymbol: sim.meta.ticker,
      usd: biggest.notionalUsd,
      priceUsd: biggest.priceUsd,
      mcapUsd: biggest.mcapUsd,
      impact: threshold > 0 ? biggest.notionalUsd / threshold : 1,
    });
  }

  private postPhaseChange(sim: TokenSim, _prevPhase: TokenPhase, nextPhase: TokenPhase): void {
    if (nextPhase !== 'MIGRATED' && nextPhase !== 'RUGGED') return;
    this.emitNarrative({
      kind: nextPhase === 'MIGRATED' ? 'TOKEN_MIGRATION' : 'TOKEN_RUG',
      tokenId: sim.meta.id,
      simNowMs: sim.getSimTimeMs(),
      tokenName: sim.meta.name,
      tokenSymbol: sim.meta.ticker,
      mcapUsd: sim.getLastMcapUsd(),
    });
  }

  private emitNarrative(event: NarrativeEvent): void {
    const existingState = this.narrativeByTokenId.get(event.tokenId) ?? createTokenNarrativeState(event.tokenId);
    const out = applyNarrativeEvent(event, existingState);
    this.narrativeByTokenId.set(event.tokenId, out.state);
    if (out.posts.length === 0) return;
    usePostStore.getState().appendPosts(event.tokenId, out.posts.map((post) => this.mapNarrativePost(post)));
  }

  private mapNarrativePost(post: NarrativePost) {
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
}

function bigTradeThresholdUsd(mcapUsd: number): number {
  const raw = mcapUsd * 0.002;
  return Math.max(200, Math.min(1500, raw));
}

function fmtUsdCompact(v: number): string {
  if (!Number.isFinite(v)) return '$0';
  const a = Math.abs(v);
  if (a >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function fmtPrice(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '$0';
  if (v >= 1) return `$${v.toFixed(4)}`;
  if (v >= 0.01) return `$${v.toFixed(6)}`;
  return `$${v.toExponential(3)}`;
}

export const registry = new TokenRegistry();
