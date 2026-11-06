import { createStore, type StoreApi } from 'zustand/vanilla';
import { getSessionBucket, type SessionBucket } from '../market/session';
import type { TokenMarketSnapshot, TokenTradeFlowSnapshot } from '../store/tokenStore';
import type { QuickTradeOptions, QuickTradeResult, Side } from '../store/tradingStore';
import type { ChartCallback, ChartMetric } from './registry';
import type { CurveDebugSnapshot } from './tokenSim';
import { toSimDtMs } from './simClock';
import { BASE_FEE, TOKEN, decimalAtoms, minAtoms, outputFloor, type Intent, type Policy } from '../engineV2/contracts';
import type { Command } from '../engineV2/events';
import { CURVE_TOKENS, quote, reserves, spot } from '../engineV2/marketRules';
import { RecordedPlayback, priceUsd, qty, sol } from '../engineV2/projections';
import { DEFAULT_WORLD, USER, World } from '../engineV2/world';

export class EngineV2Adapter {
  private readonly world = new World(DEFAULT_WORLD);
  private readonly playback = new RecordedPlayback(this.world.config.epochUtcMs);
  private activeTokenId: string | null = null;
  private timeframe = 1;
  private metric: ChartMetric = 'mcap';
  private chart: ChartCallback | null = null;
  private timer: number | null = null;
  private wallStart = 0;
  private simStart = 0;
  private commandOrdinal = 0;
  private revision = 0;
  private override: SessionBucket | null = null;
  private fault: string | null = null;
  readonly store: StoreApi<ReturnType<EngineV2Adapter['bundle']>>;

  constructor() {
    this.store = createStore(() => this.bundle());
  }

  get displayNowMs() { return this.world.config.epochUtcMs + this.world.now; }

  start = () => {
    if (this.timer !== null || this.fault !== null) return;
    this.wallStart = performance.now();
    this.simStart = this.world.now;
    this.world.advanceTo(this.simStart);
    this.publish();
    this.timer = window.setInterval(() => {
      const target = this.simStart + Math.floor(toSimDtMs(performance.now() - this.wallStart));
      // Catch up in bounded simulation-time slices after a background tab stall.
      try {
        this.world.advanceTo(Math.min(target, this.world.now + 1000));
      } catch (error) {
        this.stop();
        this.fault = error instanceof Error ? error.message : String(error);
      }
      this.publish();
    }, 200);
  };

  stop = () => {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  };

  setActiveTfSec = (timeframe: number) => { this.timeframe = timeframe; };
  setActiveMetric = (metric: ChartMetric) => { this.metric = metric; };
  setChartCallback = (cb: ChartCallback | null) => {
    this.chart = cb;
    this.publishChart();
  };

  private publishChart() {
    if (!this.chart || !this.activeTokenId) return;
    const token = this.store.getState().tokens.tokensById[this.activeTokenId];
    if (!token) return;
    const candles = this.playback.candles(token.id, this.timeframe, this.metric);
    this.chart(candles, this.metric === 'price' ? token.lastPriceUsd : token.mcapUsd);
  }

  migrationReference = (id: string) => {
    const reference = this.playback.markets[id]?.market.reference;
    return reference ? priceUsd(reference) * 1_000_000_000 : null;
  };

  curveDebug = (id: string): CurveDebugSnapshot | null => {
    const market = this.playback.markets[id]?.market;
    const token = this.store.getState().tokens.tokensById[id];
    if (!market || !token) return null;
    const real = reserves(this.playback.ledger, market);
    const current = spot(market, real);
    const vTok = qty(current.tokenAtoms);
    const vBase = sol(current.quoteAtoms);
    const k = vTok * vBase;
    return {
      phase: token.phase, progressNowPct: token.bondingCurvePct,
      hasEnteredFinal: token.bondingCurvePct >= 80, hasMigrated: market.epoch > 0,
      rTok: qty(real.tokens), rTok0: qty(CURVE_TOKENS), rBase: sol(real.sol), vTok, vBase, k,
      kDriftPct: market.epoch ? 0 : (k / (30 * 1_073_000_000) - 1) * 100,
      invalidState: false, priceCurveUsd: token.lastPriceUsd, mcapCurveUsd: token.mcapUsd, feeBps: 125, lastSwap: null,
    };
  };

  private setActive = (id: string | null) => {
    if (this.activeTokenId === id) return;
    this.activeTokenId = id;
    this.publish();
  };

  private setOverride = (override: SessionBucket | null) => {
    this.override = override;
    this.submit({ kind: 'session', override: override === 'OFF' ? 'quiet' : override ? 'busy' : null });
  };

  private post = (tokenId: string, body: string) => { this.submit({ kind: 'post', tokenId, body }); };

  private submit(command: Command) {
    if (this.fault) return { ok: false, reason: this.fault };
    const ack = this.world.submit('ui:' + ++this.commandOrdinal, command);
    this.publish();
    return ack;
  }

  private quickBuy = (tokenId: string, amount: number, options?: QuickTradeOptions) =>
    this.trade(tokenId, 'buy', amount, options);
  private quickSell = (tokenId: string, amount: number, options?: QuickTradeOptions) =>
    this.trade(tokenId, 'sell', amount, options);
  private placeQuickLimitOrder = (tokenId: string, side: Side, amount: number, limit: number, options?: QuickTradeOptions) =>
    this.trade(tokenId, side, amount, options, limit);
  private cancelQuickLimitOrder = (orderId: string) => this.submit({ kind: 'cancel', orderId, agentId: USER }).ok;

  private trade(tokenId: string, side: Side, amount: number, options?: QuickTradeOptions, limit?: number): QuickTradeResult {
    const market = this.world.state.markets[tokenId];
    if (!market || market.terminalReason) return { ok: false, reason: 'Market unavailable' };
    const input = decimalAtoms(String(amount), 9);
    const priority = decimalAtoms(String(options?.prioritySol ?? 0), 9);
    const bribe = decimalAtoms(String(options?.bribeSol ?? 0), 9);
    const slippageBps = Math.round((options?.slippagePct ?? 5) * 100);
    if (!input || priority === null || bribe === null || !Number.isFinite(slippageBps)) {
      return { ok: false, reason: 'Invalid amount or fee' };
    }
    const real = reserves(this.world.ledger, market);
    const current = spot(market, real);
    const base = {
      tokenId, agentId: USER, decidedAt: this.world.now, expiresAt: this.world.now + (limit === undefined ? 15_000 : 86_400_000),
      evidence: [], priorityFeeSol: priority, bribeFeeSol: bribe, maxTransactionFeeSol: BASE_FEE + priority + bribe,
    };
    const intent: Intent = side === 'buy'
      ? { ...base, side: 'BUY', maxInputSol: input, minOutputTokens: null }
      : {
          ...base, side: 'SELL',
          inputTokens: minAtoms(this.world.ledger.balance(USER, tokenId).available, input * current.tokenAtoms / current.quoteAtoms),
          minOutputSol: null,
        };
    let policy: Policy = { kind: 'MARKET_IOC', slippageBps };
    if (limit !== undefined) {
      // The legacy input supplies USD per token. Convert its decimal representation to an exact ratio.
      const atoms = decimalAtoms(String(limit), 15);
      if (!atoms) return { ok: false, reason: 'Invalid trigger price' };
      const limitSpot = { quoteAtoms: atoms, tokenAtoms: 150n * TOKEN * 1_000_000n };
      policy = { kind: 'TRIGGER_MARKET', trigger: side === 'buy' ? 'LTE' : 'GTE', price: limitSpot, slippageBps };
    }
    const preview = quote(market, real, intent);
    const ack = this.submit({ kind: 'submit', intent, policy });
    if (!ack.ok || !ack.orderId) return { ok: false, reason: ack.reason?.replace(/_/g, ' ').toLowerCase() ?? 'Order rejected' };
    const order = this.world.state.orders[ack.orderId];
    const output = side === 'buy' ? qty : sol;
    return {
      ok: true, submitted: order.status === 'QUEUED', orderId: order.id,
      expectedOut: output(order.expectedOut ?? preview?.output ?? 0n), minOut: output(outputFloor(order.intent) ?? 0n),
      slippageBps, prioritySol: sol(priority), bribeSol: sol(bribe), txCostSol: sol(order.fee),
      etaMs: order.eligibleAt === null ? undefined : Math.max(0, order.eligibleAt - this.world.now),
    };
  }

  private bundle() {
    const now = this.world.now;
    const tokensById = Object.fromEntries(Object.keys(this.playback.markets).map(id => [id, this.playback.token(id, now)]));
    const eventsByTokenId = Object.fromEntries(Object.entries(this.playback.markets).map(([id, read]) => [id, read.events.slice()]));
    const postsByTokenId = Object.fromEntries(Object.keys(tokensById).map(id => [id, this.playback.posts(id)]));
    const marketByTokenId: Record<string, TokenMarketSnapshot> = {};
    const tradeFlowByTokenId: Record<string, TokenTradeFlowSnapshot> = {};
    for (const [id, token] of Object.entries(tokensById)) {
      const { snapshot, flow } = this.playback.market(id, token.lastPriceUsd, now);
      marketByTokenId[id] = snapshot;
      tradeFlowByTokenId[id] = flow;
    }
    const realized = Object.values(this.playback.ledger.state.positions[USER] ?? {})
      .reduce((sum, position) => sum + position.realized, 0n);
    return {
      sessionId: 'engine-v2:' + this.world.kernel.manifest.configHash,
      revision: this.revision,
      fault: this.fault,
      tokens: {
        tokensById, eventsByTokenId, marketByTokenId, tradeFlowByTokenId, activeTokenId: this.activeTokenId,
        marketSessionBucket: this.override ?? getSessionBucket(this.displayNowMs), marketSessionBucketOverride: this.override,
        setActiveToken: this.setActive, setMarketSessionBucketOverride: this.setOverride,
      },
      posts: { postsByTokenId, addUserPost: this.post },
      wallet: { solBalance: sol(this.playback.ledger.balance(USER).available), realizedPnlSol: sol(realized) },
      trading: {
        ...this.playback.trading(),
        quickBuy: this.quickBuy, quickSell: this.quickSell,
        placeQuickLimitOrder: this.placeQuickLimitOrder, cancelQuickLimitOrder: this.cancelQuickLimitOrder,
      },
    };
  }

  private publish() {
    this.playback.read(this.world.kernel.log, this.world.now);
    this.revision++;
    this.store.setState(this.bundle(), true);
    this.publishChart();
  }
}
