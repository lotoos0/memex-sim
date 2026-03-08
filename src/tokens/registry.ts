import { RNG } from '../engine/rng';
import type { Candle } from '../engine/types';
import { useTokenStore } from '../store/tokenStore';
import { generateToken, getFateTimeoutSimMs, getStartingMcapUsd } from './generator';
import { TokenSim, type MarketMicroSnapshot, type UserTradeExecutionNotice, type UserTradeOrderStatus, type UserTradeQuote, type UserTradeSide, type UserTradeSubmitRequest, type UserTradeSubmitResult } from './tokenSim';
import type { TokenPhase } from './types';
import { getSessionBucket } from '../market/session';
import { publishRegistryFeed } from './registryFeedPublisher';
import { RegistryNarrativeRelay } from './registryNarrative';
import { RegistryExecutionRelay, type TradeExecutionCallback } from './registryExecutionRelay';

const TICK_MS = 200;
const FEED_PUBLISH_MS = 1000;
const SPAWN_INTERVAL_MS = 40_000;
const MAX_NEW = 5;
const MAX_FINAL = 5;
const MAX_MIGRATED = 5;
const INITIAL_TOKENS = 12;
export type ChartMetric = 'mcap' | 'price';
export type ChartCallback = (candles: Candle[], lastValue: number) => void;

class TokenRegistry {
  private tokens = new Map<string, TokenSim>();
  private rng = new RNG(Date.now() & 0xffffffff);
  private executions = new RegistryExecutionRelay();
  private narrative = new RegistryNarrativeRelay();

  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private feedHandle: ReturnType<typeof setInterval> | null = null;
  private spawnHandle: ReturnType<typeof setInterval> | null = null;

  private chartCb: ChartCallback | null = null;
  private activeTfSec = 1;
  private activeMetric: ChartMetric = 'mcap';

  private phaseByTokenId = new Map<string, TokenPhase>();

  start(): void {
    if (this.tickHandle) return;

    this.spawnBatch(INITIAL_TOKENS);
    this.updateMarketSessionBucket();

    this.tickHandle = setInterval(() => {
      const realDtSec = TICK_MS / 1000;
      const sessionBucket = this.resolveMarketSessionBucket(Date.now());
      useTokenStore.getState().setMarketSessionBucket(sessionBucket);

      for (const [id, sim] of this.tokens) {
        const events = sim.tick(realDtSec, sessionBucket);
        if (events.length > 0) {
          useTokenStore.getState().pushTokenEvents(id, events);
        }

        const executions = sim.drainUserTradeExecutions();
        if (executions.length > 0) {
          this.executions.process(id, sim, executions);
        }

        const prevPhase = this.phaseByTokenId.get(id);
        const nextPhase = sim.getPhase();
        if (prevPhase && prevPhase !== nextPhase) {
          this.narrative.processPhaseChange(sim, nextPhase);
        }
        this.phaseByTokenId.set(id, nextPhase);

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
      this.updateMarketSessionBucket();
      this.publishFeed();
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
    this.executions.clear();
    this.phaseByTokenId.clear();
    this.narrative.clear();
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
      this.executions.onSubmitAccepted(result);
    }
    return result;
  }

  getTradeOrderStatus(orderId: string): UserTradeOrderStatus | null {
    return this.executions.getOrderStatus(orderId);
  }

  subscribeTradeExecutions(cb: TradeExecutionCallback): () => void {
    return this.executions.subscribe(cb);
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
    this.narrative.registerToken(meta.id);

    const runtime = sim.getRuntime();
    useTokenStore.getState().addToken(meta, runtime);
    this.narrative.emitLaunch(sim);
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
    publishRegistryFeed(this.tokens, (_tokenId, sim, market) => {
      this.narrative.processMarketSnapshot(sim, market);
    });
  }

  private updateMarketSessionBucket(): void {
    const bucket = this.resolveMarketSessionBucket(Date.now());
    useTokenStore.getState().setMarketSessionBucket(bucket);
  }

  private resolveMarketSessionBucket(nowMs: number): ReturnType<typeof getSessionBucket> {
    const override = useTokenStore.getState().marketSessionBucketOverride;
    if (override) return override;
    return getSessionBucket(nowMs);
  }
}

export const registry = new TokenRegistry();
