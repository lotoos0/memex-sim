import { RNG } from '../engine/rng';
import type { Candle } from '../engine/types';
import { useTokenStore } from '../store/tokenStore';
import { generateToken, getFateTimeoutSimMs, getStartingMcapUsd } from './generator';
import { TokenSim, type MarketMicroSnapshot, type UserTradeExecutionNotice, type UserTradeOrderStatus, type UserTradeQuote, type UserTradeSide, type UserTradeSubmitRequest, type UserTradeSubmitResult } from './tokenSim';
import type { TokenFate, TokenPhase, TokenState } from './types';
import { getSessionBucket } from '../market/session';
import { publishRegistryFeed } from './registryFeedPublisher';
import { RegistryNarrativeRelay } from './registryNarrative';
import { RegistryExecutionRelay, type TradeExecutionCallback } from './registryExecutionRelay';
import { isFinalStretchToken, isMigratedToken, isNewPairsToken } from './tokenBuckets';
import { SIM_TIME_MULTIPLIER } from './types';

const TICK_MS = 200;
const FEED_PUBLISH_MS = 1000;
const SPAWN_INTERVAL_MIN_MS = 8_000;
const SPAWN_INTERVAL_MAX_MS = 16_000;
const TARGET_NEW_PAIRS = 8;
const TARGET_FINAL_STRETCH = 3;
const TARGET_MIGRATED = 2;
const TARGET_DEAD_WEAK = 2;
const MIN_TOTAL_LIVE = 11;
const INITIAL_REGISTRY_SIM_TIME_MS = 2 * 60 * 60_000;
const FRESH_BOOTSTRAP_AGE_RANGE_MS: [number, number] = [10_000, 110_000];
const FINAL_BOOTSTRAP_AGE_RANGE_MS: [number, number] = [8 * 60_000, 22 * 60_000];
const MIGRATED_BOOTSTRAP_AGE_RANGE_MS: [number, number] = [18 * 60_000, 95 * 60_000];
const WEAK_DEAD_BOOTSTRAP_AGE_RANGE_MS: [number, number] = [14 * 60_000, 120 * 60_000];
export type ChartMetric = 'mcap' | 'price';
export type ChartCallback = (candles: Candle[], lastValue: number) => void;

type BootstrapBucket = 'newPairs' | 'finalStretch' | 'migrated' | 'weakDead';

class TokenRegistry {
  private tokens = new Map<string, TokenSim>();
  private rng = new RNG(Date.now() & 0xffffffff);
  private executions = new RegistryExecutionRelay();
  private narrative = new RegistryNarrativeRelay();

  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private feedHandle: ReturnType<typeof setInterval> | null = null;
  private spawnHandle: ReturnType<typeof setTimeout> | null = null;

  private chartCb: ChartCallback | null = null;
  private activeTfSec = 1;
  private activeMetric: ChartMetric = 'mcap';

  private phaseByTokenId = new Map<string, TokenPhase>();
  private registrySimTimeMs = INITIAL_REGISTRY_SIM_TIME_MS;

  start(): void {
    if (this.tickHandle) return;

    this.registrySimTimeMs = INITIAL_REGISTRY_SIM_TIME_MS;
    this.bootstrapLifecycleBuckets();
    this.updateMarketSessionBucket();

    this.tickHandle = setInterval(() => {
      const realDtSec = TICK_MS / 1000;
      this.registrySimTimeMs += realDtSec * SIM_TIME_MULTIPLIER * 1000;
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

    this.scheduleNextSpawn();
  }

  stop(): void {
    if (this.tickHandle) clearInterval(this.tickHandle);
    if (this.feedHandle) clearInterval(this.feedHandle);
    if (this.spawnHandle) clearTimeout(this.spawnHandle);
    this.tickHandle = this.feedHandle = this.spawnHandle = null;
    this.tokens.clear();
    this.executions.clear();
    this.phaseByTokenId.clear();
    this.narrative.clear();
    this.registrySimTimeMs = INITIAL_REGISTRY_SIM_TIME_MS;
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

  private bootstrapLifecycleBuckets(): void {
    for (let i = 0; i < TARGET_NEW_PAIRS; i++) this.spawnBootstrapToken('newPairs');
    for (let i = 0; i < TARGET_FINAL_STRETCH; i++) this.spawnBootstrapToken('finalStretch');
    for (let i = 0; i < TARGET_MIGRATED; i++) this.spawnBootstrapToken('migrated');
    for (let i = 0; i < TARGET_DEAD_WEAK; i++) this.spawnBootstrapToken('weakDead');
  }

  private maybeSpawn(): void {
    const counts = this.bucketCounts();
    const liveTotal = counts.newPairs + counts.finalStretch + counts.migrated;
    if (counts.newPairs < TARGET_NEW_PAIRS) {
      this.spawnFreshToken();
      if (counts.newPairs + 1 < TARGET_NEW_PAIRS) {
        this.spawnFreshToken();
      }
    } else if (liveTotal < MIN_TOTAL_LIVE) {
      this.spawnFreshToken();
    }
    this.scheduleNextSpawn();
  }

  private bucketCounts(): { newPairs: number; finalStretch: number; migrated: number; weakDead: number } {
    let newPairs = 0;
    let finalStretch = 0;
    let migrated = 0;
    let weakDead = 0;
    for (const sim of this.tokens.values()) {
      const token = this.toTokenState(sim);
      if (isNewPairsToken(token)) newPairs += 1;
      else if (isFinalStretchToken(token)) finalStretch += 1;
      else if (isMigratedToken(token)) migrated += 1;
      else if (token.phase === 'DEAD' || token.phase === 'RUGGED') weakDead += 1;
    }
    return { newPairs, finalStretch, migrated, weakDead };
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

  private scheduleNextSpawn(): void {
    if (this.spawnHandle) clearTimeout(this.spawnHandle);
    const delayMs = SPAWN_INTERVAL_MIN_MS + this.rng.next() * (SPAWN_INTERVAL_MAX_MS - SPAWN_INTERVAL_MIN_MS);
    this.spawnHandle = setTimeout(() => this.maybeSpawn(), delayMs);
  }

  private spawnFreshToken(): void {
    const createdAtSimMs = this.registrySimTimeMs;
    const fate = this.pickBootstrapFate(['SHORT', 'NORMAL', 'LONG_RUNNER']);
    const meta = generateToken(this.rng, createdAtSimMs, fate);
    const startMcap = getStartingMcapUsd(meta.fate, this.rng);
    const fateMsMs = getFateTimeoutSimMs(meta.fate, this.rng);
    const sim = new TokenSim(meta, startMcap, fateMsMs);
    this.registerSim(sim, true);
  }

  private spawnBootstrapToken(bucket: BootstrapBucket): void {
    const sim = this.buildSimForBootstrapBucket(bucket);
    this.registerSim(sim, bucket === 'newPairs');
  }

  private buildSimForBootstrapBucket(bucket: BootstrapBucket): TokenSim {
    const attempts = 14;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const ageMs = this.rollBootstrapAge(bucket);
      const fate = this.pickBootstrapFate(this.getBootstrapFates(bucket));
      const sim = this.buildBootstrappedToken(ageMs, fate);
      if (this.matchesBootstrapBucket(bucket, sim)) return sim;
    }
    return this.buildBootstrappedToken(this.rollBootstrapAge('newPairs'), this.pickBootstrapFate(['SHORT', 'NORMAL']));
  }

  private buildBootstrappedToken(ageMs: number, fate: TokenFate): TokenSim {
    const createdAtSimMs = Math.max(0, this.registrySimTimeMs - ageMs);
    const meta = generateToken(this.rng, createdAtSimMs, fate);
    const startMcap = getStartingMcapUsd(meta.fate, this.rng);
    const fateMsMs = getFateTimeoutSimMs(meta.fate, this.rng);
    const sim = new TokenSim(meta, startMcap, fateMsMs);
    const sessionBucket = this.resolveMarketSessionBucket(Date.now());
    sim.bootstrapAdvance(ageMs, sessionBucket);
    return sim;
  }

  private registerSim(sim: TokenSim, emitLaunch: boolean): void {
    this.tokens.set(sim.meta.id, sim);
    this.phaseByTokenId.set(sim.meta.id, sim.getPhase());
    this.narrative.registerToken(sim.meta.id);

    const runtime = sim.getRuntime();
    useTokenStore.getState().addToken(sim.meta, runtime);
    if (emitLaunch) this.narrative.emitLaunch(sim);
  }

  private matchesBootstrapBucket(bucket: BootstrapBucket, sim: TokenSim): boolean {
    const token = this.toTokenState(sim);
    switch (bucket) {
      case 'newPairs':
        return isNewPairsToken(token);
      case 'finalStretch':
        return isFinalStretchToken(token);
      case 'migrated':
        return isMigratedToken(token);
      case 'weakDead':
        return token.phase === 'DEAD' || token.phase === 'RUGGED';
    }
  }

  private toTokenState(sim: TokenSim): TokenState {
    return { ...sim.meta, ...sim.getRuntime() };
  }

  private rollBootstrapAge(bucket: BootstrapBucket): number {
    switch (bucket) {
      case 'newPairs':
        return this.rollRange(FRESH_BOOTSTRAP_AGE_RANGE_MS);
      case 'finalStretch':
        return this.rollRange(FINAL_BOOTSTRAP_AGE_RANGE_MS);
      case 'migrated':
        return this.rollRange(MIGRATED_BOOTSTRAP_AGE_RANGE_MS);
      case 'weakDead':
        return this.rollRange(WEAK_DEAD_BOOTSTRAP_AGE_RANGE_MS);
    }
  }

  private getBootstrapFates(bucket: BootstrapBucket): TokenFate[] {
    switch (bucket) {
      case 'newPairs':
        return ['SHORT', 'NORMAL', 'LONG_RUNNER'];
      case 'finalStretch':
        return ['NORMAL', 'LONG_RUNNER'];
      case 'migrated':
        return ['NORMAL', 'LONG_RUNNER'];
      case 'weakDead':
        return ['QUICK_RUG', 'SHORT'];
    }
  }

  private pickBootstrapFate(options: readonly TokenFate[]): TokenFate {
    return options[Math.floor(this.rng.next() * options.length)] ?? 'NORMAL';
  }

  private rollRange([min, max]: [number, number]): number {
    return min + this.rng.next() * Math.max(0, max - min);
  }
}

export const registry = new TokenRegistry();
