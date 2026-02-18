import { RNG } from '../engine/rng';
import { TokenSim } from './tokenSim';
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

export type ChartCallback = (candles: Candle[], priceUsd: number) => void;

// ── Registry ──────────────────────────────────────────────
class TokenRegistry {
  private tokens = new Map<string, TokenSim>();
  private rng = new RNG(Date.now() & 0xFFFFFFFF);

  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private feedHandle: ReturnType<typeof setInterval> | null = null;
  private spawnHandle: ReturnType<typeof setInterval> | null = null;

  // Chart callback for active token (set by Chart component)
  private chartCb: ChartCallback | null = null;
  private activeTfSec = 60; // default 1m

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
        sim.tick(realDtSec);

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
          this.chartCb(sim.getCandles(this.activeTfSec), sim.getLastPriceUsd());
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
  }

  setChartCallback(cb: ChartCallback | null): void {
    this.chartCb = cb;
  }

  setActiveTfSec(tfSec: number): void {
    this.activeTfSec = tfSec;
  }

  getTokenSim(id: string): TokenSim | undefined {
    return this.tokens.get(id);
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
    for (const [id, sim] of this.tokens) {
      updates[id] = sim.getRuntime();
    }
    useTokenStore.getState().batchUpdateTokens(updates);
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

    // Trim migrated column (keep MAX_MIGRATED newest by mcap)
    const migrated = [...this.tokens.entries()]
      .filter(([, s]) => s.getPhase() === 'MIGRATED')
      .sort(([, a], [, b]) => b.getLastPriceUsd() - a.getLastPriceUsd());
    if (migrated.length > MAX_MIGRATED) {
      const toRemove = migrated.slice(MAX_MIGRATED);
      for (const [id] of toRemove) {
        this.tokens.delete(id);
        useTokenStore.getState().removeToken(id);
      }
    }
  }
}

// Singleton
export const registry = new TokenRegistry();
