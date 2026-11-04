import { RNG } from '../engine/rng';
import type { Candle } from '../engine/types';
import { useTokenStore } from '../store/tokenStore';
import { useTradingStore } from '../store/tradingStore';
import { usePostStore } from '../store/postStore';
import { releaseTokenAvatar } from '../lib/tokenAvatar';
import { generateToken, getFateTimeoutSimMs, getStartingMcapUsd } from './generator';
import { pickFreshLaunchFate, rollStillbornLaunch } from './freshLaunch';
import { TokenSim, type UserTradeOrderStatus, type UserTradeQuote, type UserTradeSide, type UserTradeSubmitRequest, type UserTradeSubmitResult } from './tokenSim';
import type { TokenFate, TokenPhase, TokenState } from './types';
import { getSessionBucket } from '../market/session';
import { expectedLaunches } from '../market/launchRate';
import { publishRegistryFeed } from './registryFeedPublisher';
import { RegistryNarrativeRelay } from './registryNarrative';
import { RegistryExecutionRelay, type TradeExecutionCallback } from './registryExecutionRelay';
import { isFinalStretchToken, isMigratedToken, isNewPairsToken } from './tokenBuckets';
import { collectProtectedTokenIds, MAX_REGISTRY_TOKENS, planEvictions, type EvictionCandidate } from './registryEviction';
import { toSimDtMs } from './simClock';

const TICK_MS = 200;
const FEED_PUBLISH_MS = 1000;
const EVICT_INTERVAL_SIM_MS = 2_000;
const TARGET_NEW_PAIRS = 10;
const TARGET_FINAL_STRETCH = 3;
const TARGET_MIGRATED = 2;
const TARGET_DEAD_WEAK = 2;
const INITIAL_REGISTRY_SIM_TIME_MS = 2 * 60 * 60_000;
const MIN_STEP_WALL_MS = 50;
const MAX_STEP_WALL_MS = 1_500;
const FRESH_BOOTSTRAP_AGE_RANGE_MS: [number, number] = [10_000, 110_000];
const FINAL_BOOTSTRAP_AGE_RANGE_MS: [number, number] = [8 * 60_000, 22 * 60_000];
const MIGRATED_BOOTSTRAP_AGE_RANGE_MS: [number, number] = [18 * 60_000, 95 * 60_000];
const WEAK_DEAD_BOOTSTRAP_AGE_RANGE_MS: [number, number] = [14 * 60_000, 120 * 60_000];
export type ChartMetric = 'mcap' | 'price';
export type ChartCallback = (candles: Candle[], lastValue: number) => void;

type BootstrapBucket = 'newPairs' | 'finalStretch' | 'migrated' | 'weakDead';

export class TokenRegistry {
  private tokens = new Map<string, TokenSim>();
  private rng = new RNG(Date.now() & 0xffffffff);
  private executions = new RegistryExecutionRelay();
  private narrative = new RegistryNarrativeRelay();

  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private feedHandle: ReturnType<typeof setInterval> | null = null;

  private chartCb: ChartCallback | null = null;
  private activeTfSec = 1;
  private activeMetric: ChartMetric = 'mcap';

  private phaseByTokenId = new Map<string, TokenPhase>();
  private registrySimTimeMs = INITIAL_REGISTRY_SIM_TIME_MS;
  private sessionOpen = false;
  private lastAdvanceRealMs = 0;
  private evictInSimMs = EVICT_INTERVAL_SIM_MS;
  private lastAdvanceMs = 0;
  private spawnedFresh = 0;

  start(): void {
    if (this.tickHandle) return;
    if (!this.sessionOpen) this.openSession();

    this.tickHandle = setInterval(() => {
      this.advance(TICK_MS);
    }, TICK_MS);

    this.feedHandle = setInterval(() => {
      this.updateMarketSessionBucket();
      this.publishFeed();
    }, FEED_PUBLISH_MS);
  }

  /** Bootstrap without timers so a headless harness can call `advance`. */
  beginHeadless(): void {
    if (this.sessionOpen) return;
    this.openSession();
  }

  stop(): void {
    if (this.tickHandle) clearInterval(this.tickHandle);
    if (this.feedHandle) clearInterval(this.feedHandle);
    this.tickHandle = this.feedHandle = null;
    this.sessionOpen = false;
    this.tokens.clear();
    this.executions.clear();
    this.phaseByTokenId.clear();
    this.narrative.clear();
    this.registrySimTimeMs = INITIAL_REGISTRY_SIM_TIME_MS;
    this.lastAdvanceRealMs = 0;
    this.evictInSimMs = EVICT_INTERVAL_SIM_MS;
    this.spawnedFresh = 0;
  }

  get size(): number {
    return this.tokens.size;
  }

  get freshSpawnCount(): number {
    return this.spawnedFresh;
  }

  get lastTickCostMs(): number {
    return this.lastAdvanceMs;
  }

  forEachToken(fn: (sim: TokenSim) => void): void {
    for (const sim of this.tokens.values()) fn(sim);
  }

  hasToken(id: string): boolean {
    return this.tokens.has(id);
  }

  /**
   * One simulation step. Births are a Poisson draw on this step's sim dt
   * at the UTC-hour launch rate, so 200 ms and 1 s callbacks share a mean.
   */
  advance(fallbackWallDtMs: number): void {
    if (!this.sessionOpen) return;
    const nowMs = Date.now();
    const measuredMs = this.lastAdvanceRealMs > 0 ? nowMs - this.lastAdvanceRealMs : fallbackWallDtMs;
    this.lastAdvanceRealMs = nowMs;
    const wallDtMs = clampStep(measuredMs > 0 ? measuredMs : fallbackWallDtMs);
    const simDtMs = toSimDtMs(wallDtMs);
    this.registrySimTimeMs += simDtMs;

    const sessionBucket = this.resolveMarketSessionBucket(nowMs);
    useTokenStore.getState().setMarketSessionBucket(sessionBucket);
    this.spawnPoisson(simDtMs, nowMs);

    const realDtSec = wallDtMs / 1000;
    const started = performance.now();
    for (const [id, sim] of this.tokens) {
      const events = sim.tick(realDtSec, sessionBucket,
        (execution) => this.executions.process(id, sim, [execution]),
        (event) => useTokenStore.getState().pushTokenEvents(id, [event]));
      if (events.length > 0) {
        useTokenStore.getState().pushTokenEvents(id, events.filter((event) => event.type !== 'MIGRATION'));
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
    this.lastAdvanceMs = performance.now() - started;

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

    this.evictInSimMs -= simDtMs;
    // A peak minute can add two births between the regular sweeps. Sweep early
    // so the hard cap holds on the tick that crosses it.
    if (this.evictInSimMs <= 0 || this.tokens.size >= MAX_REGISTRY_TOKENS - 16) {
      this.evictInSimMs = EVICT_INTERVAL_SIM_MS;
      this.evictDormant();
    }
  }

  protected onFreshTokenSpawned(sim: TokenSim, nowMs: number): void {
    void sim;
    void nowMs;
  }

  protected onTokenEvicted(sim: TokenSim): void {
    void sim;
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

  private openSession(): void {
    this.sessionOpen = true;
    this.registrySimTimeMs = INITIAL_REGISTRY_SIM_TIME_MS;
    this.lastAdvanceRealMs = Date.now();
    this.evictInSimMs = EVICT_INTERVAL_SIM_MS;
    this.spawnedFresh = 0;
    this.bootstrapLifecycleBuckets();
    this.updateMarketSessionBucket();
  }

  private bootstrapLifecycleBuckets(): void {
    for (let i = 0; i < TARGET_NEW_PAIRS; i++) this.spawnBootstrapToken('newPairs');
    for (let i = 0; i < TARGET_FINAL_STRETCH; i++) this.spawnBootstrapToken('finalStretch');
    for (let i = 0; i < TARGET_MIGRATED; i++) this.spawnBootstrapToken('migrated');
    for (let i = 0; i < TARGET_DEAD_WEAK; i++) this.spawnBootstrapToken('weakDead');
  }

  private spawnPoisson(simDtMs: number, nowMs: number): void {
    const births = this.rng.poisson(expectedLaunches(nowMs, simDtMs / 1000));
    for (let i = 0; i < births; i++) this.spawnFreshToken(nowMs);
  }

  private evictDormant(): void {
    const protectedIds = this.protectedTokenIds();
    const candidates: EvictionCandidate[] = [];
    for (const sim of this.tokens.values()) {
      const token = this.toTokenState(sim);
      candidates.push({
        id: token.id,
        ageMs: sim.getAgeMs(),
        phase: token.phase,
        bondingCurvePct: token.bondingCurvePct,
        dormant: sim.isDormant(),
        finalStretch: isFinalStretchToken(token),
      });
    }
    const doomed = planEvictions(candidates, protectedIds);
    for (let i = 0; i < doomed.length; i++) this.evictToken(doomed[i]!);
  }

  private protectedTokenIds(): Set<string> {
    const trading = useTradingStore.getState();
    const positionQtyByTokenId: Record<string, number> = {};
    const positions = trading.quickPositionsByTokenId;
    for (const id of Object.keys(positions)) {
      positionQtyByTokenId[id] = positions[id]?.qty ?? 0;
    }
    const openOrderTokenIds: string[] = [];
    const limits = trading.quickLimitOrdersById;
    for (const id of Object.keys(limits)) {
      const order = limits[id];
      if (order) openOrderTokenIds.push(order.tokenId);
    }
    const pending = trading.pendingQuickOrdersById;
    for (const id of Object.keys(pending)) {
      const order = pending[id];
      if (order) openOrderTokenIds.push(order.tokenId);
    }
    const simPendingTokenIds: string[] = [];
    for (const [id, sim] of this.tokens) {
      if (sim.hasPendingUserTrade()) simPendingTokenIds.push(id);
    }
    return collectProtectedTokenIds({
      activeTokenId: useTokenStore.getState().activeTokenId,
      positionQtyByTokenId,
      openOrderTokenIds,
      simPendingTokenIds,
    });
  }

  private evictToken(id: string): void {
    const sim = this.tokens.get(id);
    if (!sim) return;
    if (this.protectedTokenIds().has(id)) return;
    this.tokens.delete(id);
    this.phaseByTokenId.delete(id);
    this.narrative.forgetToken(id);
    this.executions.forgetToken(id);
    useTokenStore.getState().removeToken(id);
    usePostStore.getState().clearTokenPosts(id);
    releaseTokenAvatar(id);
    this.onTokenEvicted(sim);
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

  private spawnFreshToken(nowMs: number): void {
    const createdAtSimMs = this.registrySimTimeMs;
    const fate = pickFreshLaunchFate(this.rng);
    const meta = generateToken(this.rng, createdAtSimMs, fate);
    const startMcap = getStartingMcapUsd(meta.fate, this.rng);
    const fateMsMs = getFateTimeoutSimMs(meta.fate, this.rng);
    const sim = new TokenSim(meta, startMcap, fateMsMs);
    if (rollStillbornLaunch(this.rng)) sim.markStillbornLaunch();
    this.spawnedFresh += 1;
    this.registerSim(sim, true);
    this.onFreshTokenSpawned(sim, nowMs);
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
      const sim = this.buildBootstrappedToken(ageMs, fate, bucket);
      if (this.matchesBootstrapBucket(bucket, sim)) return sim;
    }
    return this.buildBootstrappedToken(
      this.rollBootstrapAge('newPairs'),
      this.pickBootstrapFate(['SHORT', 'NORMAL']),
      'newPairs',
    );
  }

  private buildBootstrappedToken(ageMs: number, fate: TokenFate, bucket: BootstrapBucket): TokenSim {
    const createdAtSimMs = this.registrySimTimeMs;
    const meta = generateToken(this.rng, createdAtSimMs, fate);
    const startMcap = getStartingMcapUsd(meta.fate, this.rng);
    const fateMsMs = getFateTimeoutSimMs(meta.fate, this.rng);
    const sim = new TokenSim(meta, startMcap, fateMsMs);
    const sessionBucket = this.resolveMarketSessionBucket(Date.now());
    const minAge = this.bootstrapMinAge(bucket);
    sim.bootstrapAdvance(ageMs, sessionBucket, () => {
      if (this.bootstrapImpossible(bucket, sim)) return true;
      const age = sim.getSimTimeMs() - sim.meta.createdAtSimMs;
      return age >= minAge && this.matchesBootstrapBucket(bucket, sim);
    });
    const age = sim.getSimTimeMs() - sim.meta.createdAtSimMs;
    sim.meta.createdAtSimMs = Math.max(0, this.registrySimTimeMs - age);
    return sim;
  }

  private bootstrapMinAge(bucket: BootstrapBucket): number {
    switch (bucket) {
      case 'newPairs':
        return FRESH_BOOTSTRAP_AGE_RANGE_MS[0];
      case 'finalStretch':
        return FINAL_BOOTSTRAP_AGE_RANGE_MS[0];
      case 'migrated':
        return MIGRATED_BOOTSTRAP_AGE_RANGE_MS[0];
      case 'weakDead':
        return WEAK_DEAD_BOOTSTRAP_AGE_RANGE_MS[0];
    }
  }

  private bootstrapImpossible(bucket: BootstrapBucket, sim: TokenSim): boolean {
    const phase = sim.getPhase();
    if (bucket === 'weakDead') return phase === 'MIGRATED';
    if (bucket === 'migrated') return phase === 'DEAD' || phase === 'RUGGED';
    return phase === 'MIGRATED' || phase === 'DEAD' || phase === 'RUGGED';
  }

  private registerSim(sim: TokenSim, emitLaunch: boolean): void {
    this.tokens.set(sim.meta.id, sim);
    this.phaseByTokenId.set(sim.meta.id, sim.getPhase());
    this.narrative.registerToken(sim.meta.id);
    sim.enableDormantFastPath();

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

function clampStep(ms: number): number {
  if (!Number.isFinite(ms)) return MIN_STEP_WALL_MS;
  return Math.max(MIN_STEP_WALL_MS, Math.min(MAX_STEP_WALL_MS, ms));
}

export const registry = new TokenRegistry();
