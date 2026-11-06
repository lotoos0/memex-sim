import type { TokenChartEvent } from '../chart/tokenChartEvents';
import type { Candle } from '../engine/types';
import type { TokenPost } from '../store/postStore';
import type { TokenHolderRow, TokenMarketSnapshot, TokenSimTradeRow, TokenTradeFlowSnapshot } from '../store/tokenStore';
import type { QuickExecutionSnapshot, QuickLimitOrder, QuickOrderAuditRow, QuickPendingOrder, QuickPosition, QuickTrade } from '../store/tradingStore';
import type { TokenState } from '../tokens/types';
import { FINAL_STRETCH_MIN_BONDING_PCT } from '../tokens/tokenBuckets';
import { SOL, SUPPLY, TOKEN, outputFloor, type Order, type Spot } from './contracts';
import type { FactMap, Link, Post } from './events';
import type { Committed } from './kernel';
import { Ledger, type LedgerState } from './ledger';
import { progressPpm, reserves, spot, type Market } from './marketRules';
import { inputAmount, isPending } from './orders';
import { USER } from './world';

const SUPPLY_NUMBER = Number(SUPPLY / TOKEN);
export const sol = (value: bigint) => Number(value) / Number(SOL);
export const qty = (value: bigint) => Number(value) / Number(TOKEN);
export const usd = (value: bigint) => sol(value) * 150;
export const priceUsd = (value: Spot) => usd(value.quoteAtoms) / qty(value.tokenAtoms);
const SPAWN_PRICE = 30 * 150 / 1_073_000_000;

type Trader = {
  first: number; last: number; bought: number; sold: number; boughtTokens: number; soldTokens: number;
};
type MarketRead = {
  market: Market;
  link: Link | null;
  trades: TokenSimTradeRow[];
  events: TokenChartEvent[];
  traders: Record<string, Trader>;
  userTrades: QuickTrade[];
  userFills: Record<string, { output: number; avgPriceUsd: number }>;
  bars: Candle[];
};
export type V2Execution = QuickExecutionSnapshot & {
  v2Status: Order['status']; consumedInput: number; refundedInput: number;
};
export type V2Audit = QuickOrderAuditRow & { v2Status: Order['status'] };
type HotProjection = {
  markets: Record<string, MarketRead>;
  userOrders: Record<string, Order>;
  userPosts: Record<string, Post[]>;
  narrativePosts: Record<string, Post[]>;
  audit: Record<string, V2Audit[]>;
  finalized: Record<string, Order[]>;
};

function appendBar(rows: Candle[], time: number, value: number, volume: number, initial: number) {
  const last = rows[rows.length - 1];
  if (last?.time === time) {
    last.close = value;
    last.high = Math.max(last.high, value);
    last.low = Math.min(last.low, value);
    last.volume += volume;
  } else {
    const open = last?.close ?? initial;
    rows.push({ time, open, high: Math.max(open, value), low: Math.min(open, value), close: value, volume });
  }
}

function outputNumber(side: Order['intent']['side'], atoms: bigint | null) {
  return atoms === null ? 0 : side === 'BUY' ? qty(atoms) : sol(atoms);
}

export function executionLabel(value: QuickExecutionSnapshot | QuickOrderAuditRow, uppercase = false) {
  const status = (value as Partial<V2Execution>).v2Status;
  const label = status === 'PARTIAL_CLOSED' ? 'partial, closed'
    : status === 'EXPIRED' ? 'expired'
    : status === 'CANCELLED' ? 'cancelled'
    : value.status;
  return uppercase ? label.toUpperCase() : label;
}

// Recorded playback applies committed facts, including the original postings. No policies run here.
export class RecordedPlayback {
  readonly ledger: Ledger;
  readonly markets: Record<string, MarketRead>;
  readonly orders: Record<string, Order> = {};
  private readonly userOrders: Record<string, Order>;
  private readonly userPosts: Record<string, Post[]>;
  private readonly narrativePosts: Record<string, Post[]>;
  private readonly audit: Record<string, V2Audit[]>;
  private readonly finalized: Record<string, Order[]>;
  private cursor = 0;

  constructor(readonly epoch: number, private readonly hot = false, ledger?: LedgerState, view?: HotProjection) {
    this.ledger = new Ledger(ledger);
    this.markets = view?.markets ?? {};
    this.userOrders = view?.userOrders ?? {};
    this.userPosts = view?.userPosts ?? {};
    this.narrativePosts = view?.narrativePosts ?? {};
    this.audit = view?.audit ?? {};
    this.finalized = view?.finalized ?? {};
  }

  hotCheckpoint(): HotProjection {
    return { markets: this.markets, userOrders: this.userOrders, userPosts: this.userPosts,
      narrativePosts: this.narrativePosts, audit: this.audit, finalized: this.finalized };
  }

  append(log: readonly Committed<FactMap>[], now: number) {
    if (this.consume(log, now, 0) !== log.length) throw new Error('Recording extends beyond the batch clock');
    if (this.hot) this.compact(now);
  }

  read(log: readonly Committed<FactMap>[], now: number) {
    this.cursor = this.consume(log, now, this.cursor);
  }

  private consume(log: readonly Committed<FactMap>[], now: number, cursor: number) {
    while (cursor < log.length && log[cursor].key.at <= now) {
      const first = cursor;
      const commitId = log[first].commitId;
      do {
        const fact = log[cursor];
        if (fact.factOrdinal !== cursor - first || fact.schemaVersion !== 1) {
          throw new Error('Invalid recorded commit');
        }
        this.apply(fact);
        cursor++;
      } while (log[cursor]?.commitId === commitId);
    }
    return cursor;
  }

  private compact(now: number) {
    const cutoff = this.epoch + now - 300_000;
    for (const [id, market] of Object.entries(this.markets)) {
      let remove = 0;
      while (remove < market.trades.length - 120 && market.trades[remove].tMs < cutoff) remove++;
      if (remove) market.trades.splice(0, remove);
      if (market.bars.length > 3600) market.bars.splice(0, market.bars.length - 3600);
      if (market.userTrades.length > 200) market.userTrades.splice(0, market.userTrades.length - 200);
      if (market.events.length > 1000) {
        const migration = market.events.find(event => event.type === 'MIGRATION');
        market.events = market.events.slice(-999);
        if (migration && !market.events.includes(migration)) market.events.unshift(migration);
      }
      const orders = this.finalized[id];
      if (orders && orders.length > 100) {
        for (const order of orders.splice(0, orders.length - 100)) delete market.userFills[order.id];
      }
      const audit = this.audit[id];
      if (audit && audit.length > 100) audit.splice(0, audit.length - 100);
      const posts = this.userPosts[id];
      if (posts && posts.length > 220) posts.splice(0, posts.length - 220);
    }
  }

  private apply(fact: Committed<FactMap>) {
    switch (fact.kind) {
      case 'LedgerChanged': {
        const { postings, issuance, position } = fact.payload;
        this.ledger.commit(postings, issuance ?? undefined);
        if (position) (this.ledger.state.positions[position.account] ??= {})[position.tokenId] = position.value;
        break;
      }
      case 'TokenLaunched': {
        const { market, link } = fact.payload;
        this.markets[market.tokenId] = { market, link, trades: [], events: [], traders: {}, userTrades: [], userFills: {}, bars: [] };
        break;
      }
      case 'MarketUpdated':
        this.markets[fact.payload.market.tokenId].market = fact.payload.market;
        break;
      case 'SocialPublished': {
        const { post, tokenId } = fact.payload;
        if (tokenId) (this.userPosts[tokenId] ??= []).push(post);
        else (this.narrativePosts[post.narrativeId] ??= []).push(post);
        break;
      }
      case 'OrderChanged': {
        const { order } = fact.payload;
        const { intent, policy } = order;
        if (!this.hot) this.orders[order.id] = order;
        if (intent.agentId !== USER) break;
        if (this.hot && !isPending(order)) delete this.userOrders[order.id];
        else this.userOrders[order.id] = order;
        if (order.finalizedAt !== null) (this.finalized[intent.tokenId] ??= []).push(order);
        if (policy.kind === 'TRIGGER_MARKET') {
          const side = intent.side === 'BUY' ? 'buy' : 'sell';
          const status = order.status === 'OPEN' ? 'open' : order.status === 'QUEUED' ? 'triggered'
            : order.status === 'FILLED' || order.status === 'PARTIAL_CLOSED' ? 'filled'
            : order.status === 'REJECTED' ? 'failed' : 'cancelled';
          (this.audit[intent.tokenId] ??= []).push({
            id: fact.id, tokenId: intent.tokenId, limitOrderId: order.id, side, status, v2Status: order.status,
            ...(order.eligibleAt === null ? {} : { executionOrderId: order.id }), limitPriceUsd: priceUsd(policy.price),
            requestedAmountSol: intent.side === 'BUY' ? sol(intent.maxInputSol) : 0,
            requestedTokenQty: intent.side === 'SELL' ? qty(intent.inputTokens) : 0,
            expectedOut: outputNumber(intent.side, order.expectedOut), minOut: outputNumber(intent.side, outputFloor(intent)),
            txCostSol: sol(order.chargedFee), ...(order.reason === null ? {} : { reason: order.reason }), tsMs: this.epoch + fact.key.at,
          });
        }
        break;
      }
      case 'TradeExecuted': {
        const { fill } = fact.payload;
        const read = this.markets[fill.tokenId];
        const price = priceUsd(fill.spotAfter);
        const amount = qty(fill.tokenAtoms);
        const volume = usd(fill.quoteAtomsExFee);
        const tMs = this.epoch + fill.at;
        const mcap = price * SUPPLY_NUMBER;
        if (this.hot) appendBar(read.bars, Math.floor(tMs / 1000), mcap, volume, SPAWN_PRICE * SUPPLY_NUMBER);
        read.trades.push({
          id: fact.id, tMs, side: fill.side, walletId: fill.agentId, tokenAmount: amount,
          notionalUsd: volume, priceUsd: volume / amount, mcapUsd: mcap,
        });
        const trader = read.traders[fill.agentId] ??= { first: tMs, last: tMs, bought: 0, sold: 0, boughtTokens: 0, soldTokens: 0 };
        const walletQuote = usd(fill.walletSwapQuoteSol);
        const side = fill.side === 'BUY' ? 'buy' : 'sell';
        trader.last = tMs;
        if (side === 'buy') {
          trader.bought += walletQuote;
          trader.boughtTokens += amount;
        } else {
          trader.sold += walletQuote;
          trader.soldTokens += amount;
        }
        if (fill.agentId === USER) {
          read.userTrades.push({
            id: fact.id, tokenId: fill.tokenId, side, qty: amount, priceUsd: walletQuote / amount,
            notionalUsd: walletQuote, feeUsd: usd(fill.swapFeeSol), mcapUsd: mcap, tsMs: tMs,
          });
          read.userFills[fill.orderId] = {
            output: side === 'buy' ? amount : sol(fill.walletSwapQuoteSol), avgPriceUsd: walletQuote / amount,
          };
          read.events.push({ tokenId: fill.tokenId, tMs, type: side === 'buy' ? 'USER_BUY' : 'USER_SELL', price, mcap });
        }
        break;
      }
      case 'MarketMigrated': {
        const { tokenId, reference } = fact.payload;
        const price = priceUsd(reference);
        this.markets[tokenId].events.push({
          tokenId, tMs: this.epoch + fact.key.at, type: 'MIGRATION', price, mcap: price * SUPPLY_NUMBER,
        });
        break;
      }
    }
  }

  candles(tokenId: string, tfSec: number, metric: 'price' | 'mcap'): Candle[] {
    if (this.hot) {
      const result: Candle[] = [];
      const divisor = metric === 'price' ? SUPPLY_NUMBER : 1;
      for (const bar of this.markets[tokenId]?.bars ?? []) {
        const time = Math.floor(bar.time / tfSec) * tfSec;
        const last = result[result.length - 1];
        if (last?.time === time) {
          last.high = Math.max(last.high, bar.high / divisor);
          last.low = Math.min(last.low, bar.low / divisor);
          last.close = bar.close / divisor;
          last.volume += bar.volume;
        } else result.push({ time, open: bar.open / divisor, high: bar.high / divisor,
          low: bar.low / divisor, close: bar.close / divisor, volume: bar.volume });
      }
      return result;
    }
    const trades = this.markets[tokenId]?.trades ?? [];
    const rows: Candle[] = [];
    let previous = metric === 'price' ? SPAWN_PRICE : SPAWN_PRICE * SUPPLY_NUMBER;
    for (const trade of trades) {
      const time = Math.floor(trade.tMs / 1000 / tfSec) * tfSec;
      const value = metric === 'price' ? trade.mcapUsd / SUPPLY_NUMBER : trade.mcapUsd;
      const last = rows[rows.length - 1];
      if (last?.time === time) {
        last.close = value;
        last.high = Math.max(last.high, value);
        last.low = Math.min(last.low, value);
        last.volume += trade.notionalUsd;
      } else {
        rows.push({ time, open: previous, high: Math.max(previous, value), low: Math.min(previous, value), close: value, volume: trade.notionalUsd });
      }
      previous = value;
    }
    return rows;
  }

  token(tokenId: string, now: number): TokenState & { availability: string } {
    const { market, trades, traders } = this.markets[tokenId];
    const real = reserves(this.ledger, market);
    const current = priceUsd(spot(market, real));
    const progress = progressPpm(market, real) / 10_000;
    const holdings = Object.keys(traders).map(id => this.quantity(id, tokenId)).sort((a, b) => b - a);
    const dev = this.quantity(market.creatorId, tokenId);
    let buys5m = 0;
    let sells5m = 0;
    let vol5mUsd = 0;
    for (let i = trades.length - 1; i >= 0 && trades[i].tMs >= this.epoch + now - 300_000; i--) {
      const trade = trades[i];
      vol5mUsd += trade.notionalUsd;
      if (trade.side === 'BUY') buys5m++;
      else sells5m++;
    }
    return {
      id: tokenId, name: market.name, ticker: market.ticker, logoColor: '#4d769f', imageUrl: null,
      supply: SUPPLY_NUMBER, createdAtSimMs: market.launchedAt, fate: 'NORMAL',
      metrics: {
        topHoldersPct: holdings.slice(0, 10).reduce((sum, amount) => sum + amount, 0) / SUPPLY_NUMBER * 100,
        devHoldingsPct: dev / SUPPLY_NUMBER * 100, snipersPct: 0, lpBurnedPct: 0, insidersPct: 0, bundlersPct: 0,
      },
      phase: market.terminalReason ? 'DEAD' : market.epoch > 0 ? 'MIGRATED' : progress >= FINAL_STRETCH_MIN_BONDING_PCT ? 'FINAL' : 'NEW',
      availability: market.terminalReason ?? market.activity,
      simTimeMs: now, lastPriceUsd: current, mcapUsd: current * SUPPLY_NUMBER, liquidityUsd: usd(real.sol),
      bondingCurvePct: progress, vol5mUsd, buys5m, sells5m, changePct: (current / SPAWN_PRICE - 1) * 100,
      priceAtSpawn: SPAWN_PRICE, ruggedAtSimMs: null,
    };
  }

  private quantity(account: string, tokenId: string) {
    const balance = this.ledger.balance(account, tokenId);
    return qty(balance.available + balance.reserved);
  }

  market(tokenId: string, price: number, now: number): { snapshot: TokenMarketSnapshot; flow: TokenTradeFlowSnapshot } {
    const { trades, traders } = this.markets[tokenId];
    const holders: TokenHolderRow[] = [];
    for (const [id, stats] of Object.entries(traders)) {
      const balanceTokens = this.quantity(id, tokenId);
      const position = this.ledger.position(id, tokenId);
      holders.push({
        walletId: id, solBalance: sol(this.ledger.balance(id).available), firstSeenMs: stats.first, lastActiveMs: stats.last,
        balanceTokens, balanceUsd: balanceTokens * price, boughtUsd: stats.bought, soldUsd: stats.sold,
        boughtTokens: stats.boughtTokens, soldTokens: stats.soldTokens,
        avgBuyUsd: stats.boughtTokens ? stats.bought / stats.boughtTokens : 0,
        avgSellUsd: stats.soldTokens ? stats.sold / stats.soldTokens : 0,
        unrealizedPnlUsd: balanceTokens * price - usd(position.basis), realizedPnlUsd: usd(position.realized),
        remainingUsd: usd(position.basis),
      });
    }
    holders.sort((a, b) => b.balanceTokens - a.balanceTokens);
    let buys60s = 0;
    let sells60s = 0;
    const updatedAtMs = this.epoch + now;
    for (let i = trades.length - 1; i >= 0 && trades[i].tMs >= updatedAtMs - 60_000; i--) {
      if (trades[i].side === 'BUY') buys60s++;
      else sells60s++;
    }
    return {
      snapshot: {
        holdersCount: holders.filter(row => row.balanceTokens > 0).length, topHolders: holders,
        recentTrades: trades.slice(-120), updatedAtMs,
      },
      flow: { buys60s, sells60s, tx60s: buys60s + sells60s },
    };
  }

  posts(tokenId: string): TokenPost[] {
    const link = this.markets[tokenId].link;
    const rows = this.userPosts[tokenId]?.slice() ?? [];
    if (link) rows.push(...(this.narrativePosts[link.narrativeId] ?? []));
    return rows.sort((a, b) => a.publishedAt - b.publishedAt).slice(-220).map(post => ({
      id: post.id, tokenId, kind: post.authorId === 'Player' ? 'USER' : 'SYSTEM',
      tone: 'neutral', author: post.authorId, text: post.body, createdAtMs: post.publishedAt, simNowMs: post.publishedAt,
      topic: 'launch', tags: ['Simulated'], sourcePostId: link?.sourcePostId ?? null,
    }));
  }

  trading() {
    const quickPositionsByTokenId: Record<string, QuickPosition> = {};
    const quickTradesByTokenId: Record<string, QuickTrade[]> = {};
    const quickLimitOrdersById: Record<string, QuickLimitOrder> = {};
    const pendingQuickOrdersById: Record<string, QuickPendingOrder> = {};
    const lastQuickExecutionByTokenId: Record<string, V2Execution> = {};
    const quickExecutionHistoryByTokenId: Record<string, V2Execution[]> = {};
    const quickOrderAuditByTokenId: Record<string, V2Audit[]> = {};
    for (const [tokenId, read] of Object.entries(this.markets)) {
      quickTradesByTokenId[tokenId] = read.userTrades.slice();
      const position = this.ledger.state.positions[USER]?.[tokenId];
      const orders = this.finalized[tokenId] ?? [];
      if (position) {
        const amount = this.quantity(USER, tokenId);
        quickPositionsByTokenId[tokenId] = {
          tokenId, qty: amount, avgEntryUsd: amount > 0 ? usd(position.basis) / amount : 0,
          costBasisUsd: usd(position.basis), boughtUsd: usd(position.bought), soldUsd: usd(position.sold),
          realizedPnlUsd: usd(position.realized), updatedAtMs: this.epoch + (orders[orders.length - 1]?.finalizedAt ?? 0),
        };
      }
      const executions = orders.slice(-100).map((order): V2Execution => {
        const result = read.userFills[order.id];
        return {
          tokenId, orderId: order.id, side: order.intent.side === 'BUY' ? 'buy' : 'sell',
          status: result ? 'filled' : 'failed', v2Status: order.status,
          amountIn: order.intent.side === 'BUY' ? sol(inputAmount(order.intent)) : qty(inputAmount(order.intent)),
          consumedInput: order.intent.side === 'BUY' ? sol(order.consumed) : qty(order.consumed),
          refundedInput: order.intent.side === 'BUY' ? sol(order.refunded) : qty(order.refunded),
          expectedOut: outputNumber(order.intent.side, order.expectedOut),
          minOut: outputNumber(order.intent.side, outputFloor(order.intent)), actualOut: result?.output ?? 0,
          submitMs: this.epoch + order.acceptedAt, execMs: this.epoch + order.finalizedAt!,
          tsMs: this.epoch + order.finalizedAt!, txCostSol: sol(order.chargedFee),
          avgPriceUsd: result?.avgPriceUsd, reason: order.reason ?? undefined,
        };
      });
      quickExecutionHistoryByTokenId[tokenId] = executions;
      if (executions.length) lastQuickExecutionByTokenId[tokenId] = executions[executions.length - 1];
      quickOrderAuditByTokenId[tokenId] = (this.audit[tokenId] ?? []).slice(-100);
    }
    for (const order of Object.values(this.userOrders)) {
      const { intent, policy } = order;
      const side = intent.side === 'BUY' ? 'buy' : 'sell';
      const reservedSol = intent.side === 'BUY' ? sol(intent.maxInputSol) : 0;
      const reservedToken = intent.side === 'SELL' ? qty(intent.inputTokens) : 0;
      const fees = { txCostSol: sol(order.fee), prioritySol: sol(intent.priorityFeeSol), bribeSol: sol(intent.bribeFeeSol) };
      if (order.status === 'OPEN' && policy.kind === 'TRIGGER_MARKET') {
        quickLimitOrdersById[order.id] = {
          id: order.id, tokenId: intent.tokenId, side, status: 'open', limitPriceUsd: priceUsd(policy.price),
          amountSol: reservedSol, tokenQty: reservedToken, reservedSol, slippageBps: policy.slippageBps,
          ...fees, createdAtMs: this.epoch + order.acceptedAt,
        };
      } else if (order.status === 'QUEUED') {
        pendingQuickOrdersById[order.id] = {
          orderId: order.id, tokenId: intent.tokenId, side, reservedSol, reservedToken,
          sourceLimitOrderId: policy.kind === 'TRIGGER_MARKET' ? order.id : undefined,
          sourceLimitPriceUsd: policy.kind === 'TRIGGER_MARKET' ? priceUsd(policy.price) : undefined,
          expectedOut: outputNumber(intent.side, order.expectedOut), minOut: outputNumber(intent.side, outputFloor(intent)),
          ...fees, submitMs: this.epoch + order.acceptedAt, execMs: this.epoch + order.eligibleAt!,
        };
      }
    }
    return {
      quickPositionsByTokenId, quickTradesByTokenId, quickLimitOrdersById, pendingQuickOrdersById,
      lastQuickExecutionByTokenId, quickExecutionHistoryByTokenId, quickOrderAuditByTokenId,
    };
  }
}
