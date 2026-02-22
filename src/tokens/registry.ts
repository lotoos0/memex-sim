import { RNG } from '../engine/rng';
import {
  TokenSim,
  type MarketMicroSnapshot,
  type UserTradeExecutionNotice,
  type UserTradeOrderStatus,
  type UserTradeQuote,
  type UserTradeSide,
  type UserTradeSubmitRequest,
  type UserTradeSubmitResult,
} from './tokenSim';
import { generateToken, getStartingMcapUsd, getFateTimeoutSimMs } from './generator';
import type { Candle } from '../engine/types';
import { useTokenStore } from '../store/tokenStore';

// ── Config ────────────────────────────────────────────────
const TICK_MS            = 200;    // real ms — engine tick interval
const FEED_PUBLISH_MS    = 1000;   // real ms — store update for feed
const SPAWN_INTERVAL_MS  = 40_000; // real ms — new token spawn
const RUGGED_LINGER_MS   = 90_000; // real ms — rugged token stays visible
const MAX_NEW            = 5;
const MAX_FINAL          = 5;
const MAX_MIGRATED       = 5;
const INITIAL_TOKENS     = 12;
const MAX_ORDER_SNAPSHOTS = 4_000;

export type ChartMetric = 'mcap' | 'price';
export type ChartCallback = (candles: Candle[], lastValue: number) => void;
export type TradeExecutionCallback = (execution: UserTradeExecutionNotice) => void;

// ── Registry ──────────────────────────────────────────────
class TokenRegistry {
  private tokens = new Map<string, TokenSim>();
  private rng = new RNG(Date.now() & 0xFFFFFFFF);
  private tradeOrders = new Map<string, UserTradeOrderStatus>();
  private tradeExecutionSubscribers = new Set<TradeExecutionCallback>();

  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private feedHandle: ReturnType<typeof setInterval> | null = null;
  private spawnHandle: ReturnType<typeof setInterval> | null = null;

  // Chart callback for active token (set by Chart component)
  private chartCb: ChartCallback | null = null;
  private activeTfSec = 1; // default 1s
  private activeMetric: ChartMetric = 'mcap';

  // Track when each token rugged (real time) for cleanup
  private ruggedAt = new Map<string, number>();

  // ── Public API ────────────────────────────────────────

  start(): void {
    if (this.tickHandle) return; // already running

    this.spawnBatch(INITIAL_TOKENS);

    // Engine tick loop (200ms real)
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
          for (let j = 0; j < executions.length; j++) {
            const execution = executions[j]!;
            this.tradeOrders.set(execution.orderId, execution);
            this.pruneTradeOrders();
            if (execution.status === 'FILLED') {
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

        // Track rug time for cleanup
        if (sim.getPhase() === 'RUGGED' && !this.ruggedAt.has(id)) {
          this.ruggedAt.set(id, Date.now());
        }
      }

      // Push candles + price to active chart (bypass Zustand, direct callback)
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

    // Feed publish (1s real)
    this.feedHandle = setInterval(() => {
      this.publishFeed();
      this.cleanupDead();
    }, FEED_PUBLISH_MS);

    // Spawn loop
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

  // ── Private ───────────────────────────────────────────

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

    // Add to Zustand
    useTokenStore.getState().addToken(meta, sim.getRuntime());
  }

  private maybeSpawn(): void {
    const counts = this.phaseCounts();
    const total = counts.new + counts.final;
    if (total < MAX_NEW + MAX_FINAL) this.spawnToken();
  }

  private phaseCounts() {
    let newC = 0, finalC = 0, migratedC = 0;
    for (const sim of this.tokens.values()) {
      switch (sim.getPhase()) {
        case 'NEW':      newC++; break;
        case 'FINAL':    finalC++; break;
        case 'MIGRATED': migratedC++; break;
      }
    }
    return { new: newC, final: finalC, migrated: migratedC };
  }

  private publishFeed(): void {
    const updates: Record<string, ReturnType<TokenSim['getRuntime']>> = {};
    const marketUpdates: Record<string, MarketMicroSnapshot> = {};
    for (const [id, sim] of this.tokens) {
      updates[id] = sim.getRuntime();
      marketUpdates[id] = sim.getMarketSnapshot();
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
        useTokenStore.getState().removeToken(id);
        // Spawn replacement
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
}

// Singleton
export const registry = new TokenRegistry();
