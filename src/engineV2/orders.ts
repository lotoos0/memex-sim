import { BASE_FEE, BPS, assertSimTime, outputFloor, withOutputFloor, type Fill, type Intent, type Order, type Policy, type Spot } from './contracts';
import type { Ack, FactMap, TaskMap } from './events';
import type { Kernel } from './kernel';
import { Ledger, SWAP_COLLECTOR, TX_COLLECTOR, posting, type Posting } from './ledger';
import { handoff, progressPpm, quote, reserveAccount, reserves, spot, type Market, type Quote } from './marketRules';

export function inputAmount(intent: Intent) {
  return intent.side === 'BUY' ? intent.maxInputSol : intent.inputTokens;
}

export function transactionFee(intent: Intent) {
  return BASE_FEE + intent.priorityFeeSol + intent.bribeFeeSol;
}

function meetsTrigger(policy: Extract<Policy, { kind: 'TRIGGER_MARKET' }>, current: Spot) {
  const currentScaled = current.quoteAtoms * policy.price.tokenAtoms;
  const targetScaled = policy.price.quoteAtoms * current.tokenAtoms;
  return policy.trigger === 'LTE' ? currentScaled <= targetScaled : currentScaled >= targetScaled;
}

export function isPending(order: Order) {
  return order.status === 'OPEN' || order.status === 'QUEUED';
}

export class OrderBook {
  private readonly active = new Map<string, Set<string>>();

  constructor(
    private readonly kernel: Kernel<TaskMap, FactMap>,
    private readonly ledger: Ledger,
    readonly state: Record<string, Order>,
    private readonly markets: Record<string, Market>,
    private readonly latency: number,
    private readonly changed: (market: Market, traded: boolean) => void,
    private readonly canTrade: (agentId: string) => boolean,
  ) {
    const pending = Object.values(state).filter(isPending);
    pending.sort((a, b) => a.acceptedSeq < b.acceptedSeq ? -1 : 1);
    for (const order of pending) this.track(order);
  }

  private track(order: Order) {
    let set = this.active.get(order.intent.tokenId);
    if (!set) this.active.set(order.intent.tokenId, set = new Set());
    set.add(order.id);
    this.kernel.onRollback(() => {
      const pending = this.active.get(order.intent.tokenId);
      pending?.delete(order.id);
      if (!pending?.size) this.active.delete(order.intent.tokenId);
    });
  }

  private update(order: Order) {
    const tokenId = order.intent.tokenId;
    const pending = this.active.get(tokenId);
    if (!isPending(order) && pending?.delete(order.id)) {
      this.kernel.onRollback(() => {
        pending.add(order.id);
        this.active.set(tokenId, new Set([...pending].sort((a, b) =>
          this.state[a].acceptedSeq < this.state[b].acceptedSeq ? -1 : 1)));
      });
    }
    this.kernel.rememberProperty(this.state, order.id);
    this.state[order.id] = order;
    this.kernel.fact('OrderChanged', { order });
  }

  admit(id: string, intent: Intent, policy: Policy, sequence: bigint): Ack {
    const reject = (reason: string) => {
      this.kernel.fact('AdmissionRejected', { intentId: id, agentId: intent.agentId, tokenId: intent.tokenId, reason });
      return { ok: false, reason };
    };
    const now = this.kernel.now;
    const market = this.markets[intent.tokenId];
    if (!market || market.terminalReason) return reject('MARKET_UNAVAILABLE');
    if (!this.canTrade(intent.agentId) || !Number.isSafeInteger(intent.expiresAt) || intent.expiresAt <= now
      || !Number.isSafeInteger(intent.decidedAt) || intent.decidedAt < 0 || intent.decidedAt > now
      || inputAmount(intent) <= 0n || intent.priorityFeeSol < 0n || intent.bribeFeeSol < 0n) return reject('INVALID_INTENT');
    const slippage = policy.slippageBps;
    if (slippage !== undefined && (!Number.isInteger(slippage) || slippage < 0 || slippage > 10_000)) {
      return reject('INVALID_SLIPPAGE');
    }
    const floor = outputFloor(intent);
    if (floor !== null && floor < 0n) return reject('INVALID_MIN_OUTPUT');
    if (policy.kind === 'TRIGGER_MARKET' && (floor !== null || policy.price.quoteAtoms <= 0n || policy.price.tokenAtoms <= 0n)) {
      return reject('INVALID_TRIGGER');
    }
    if (policy.kind === 'MARKET_IOC' && floor === null && slippage === undefined) return reject('MISSING_MIN_OUTPUT');
    const fee = transactionFee(intent);
    if (fee > intent.maxTransactionFeeSol) return reject('TRANSACTION_FEE_CAP');
    const sol = fee + (intent.side === 'BUY' ? intent.maxInputSol : 0n);
    const tokens = intent.side === 'SELL' ? intent.inputTokens : 0n;
    if (this.ledger.balance(intent.agentId).available < sol
      || this.ledger.balance(intent.agentId, intent.tokenId).available < tokens) return reject('INSUFFICIENT_FUNDS');
    const currentQuote = policy.kind === 'MARKET_IOC' ? quote(market, reserves(this.ledger, market), intent) : null;
    if (policy.kind === 'MARKET_IOC' && floor === null) {
      intent = withOutputFloor(intent, (currentQuote?.output ?? 0n) * (BPS - BigInt(slippage!)) / BPS);
    }
    const eligibleAt = policy.kind === 'MARKET_IOC' ? now + this.latency : null;
    if (eligibleAt !== null) assertSimTime(eligibleAt);
    const postings = [posting(intent.agentId, 'SOL', -sol, sol)];
    if (tokens > 0n) postings.push(posting(intent.agentId, intent.tokenId, -tokens, tokens));
    this.ledger.commit(postings);
    this.kernel.fact('LedgerChanged', { postings, issuance: null, position: null });
    const order: Order = {
      id, intentId: id, reservationId: id + '/escrow', intent, policy, status: eligibleAt === null ? 'OPEN' : 'QUEUED',
      acceptedAt: now, acceptedSeq: sequence, eligibleAt, finalizedAt: null, epochAtAdmission: market.epoch,
      expectedOut: currentQuote?.output ?? null, fee, feeScheduleVersion: 'fixed-1',
      chargedFee: 0n, consumed: 0n, refunded: 0n, reason: null,
    };
    this.track(order);
    this.update(order);
    this.kernel.schedule(intent.expiresAt, 0, 'Expire', { orderId: id });
    if (eligibleAt !== null) this.kernel.schedule(eligibleAt, 50, 'Execute', { orderId: id });
    else this.evaluate(market);
    this.changed(market, false);
    return { ok: true, orderId: id };
  }

  evaluate(market: Market) {
    const real = reserves(this.ledger, market);
    for (const id of this.active.get(market.tokenId) ?? []) {
      const order = this.state[id];
      if (order.status !== 'OPEN' || order.policy.kind !== 'TRIGGER_MARKET') continue;
      if (this.kernel.now >= order.intent.expiresAt) {
        this.finish(order, 'EXPIRED', 'EXPIRED', 0n);
        continue;
      }
      if (!meetsTrigger(order.policy, spot(market, real))) continue;
      const preview = quote(market, real, order.intent);
      if (!preview) {
        this.finish(order, 'REJECTED', 'TRIGGER_NO_QUOTE', 0n);
        continue;
      }
      const minimum = preview.output * (BPS - BigInt(order.policy.slippageBps)) / BPS;
      const eligibleAt = this.kernel.now + this.latency;
      assertSimTime(eligibleAt);
      this.update({
        ...order, intent: withOutputFloor(order.intent, minimum),
        status: 'QUEUED', eligibleAt, expectedOut: preview.output,
      });
      this.kernel.schedule(eligibleAt, 50, 'Execute', { orderId: id });
    }
  }

  cancel(id: string, agent: string): Ack {
    const order = this.state[id];
    if (!order || order.intent.agentId !== agent) return { ok: false, reason: 'UNKNOWN_ORDER' };
    if (!isPending(order)) return { ok: false, reason: 'ALREADY_FINAL', orderId: id };
    this.finish(order, 'CANCELLED', 'CANCELLED', 0n);
    return { ok: true, orderId: id };
  }

  expire(id: string) {
    const order = this.state[id];
    if (order && isPending(order)) this.finish(order, 'EXPIRED', 'EXPIRED', 0n);
  }

  close(tokenId: string) {
    for (const id of this.active.get(tokenId) ?? []) this.finish(this.state[id], 'CANCELLED', 'MARKET_TERMINAL', 0n);
  }

  private finish(
    order: Order, status: Order['status'], reason: string | null, fee: bigint, result?: Quote,
    marketPostings: readonly Posting[] = [],
  ) {
    const { intent } = order;
    const { agentId: account, tokenId, side } = intent;
    const reservedInput = inputAmount(intent);
    const consumed = result ? (side === 'BUY' ? result.gross : result.tokenAtoms) : 0n;
    const refund = reservedInput - consumed;
    const balance = this.ledger.balance(account, tokenId);
    const oldQuantity = balance.available + balance.reserved;
    if (refund < 0n || (side === 'SELL' && consumed > oldQuantity)) throw new Error('Invalid settlement inventory');
    const buy = side === 'BUY';
    const postings = [
      posting(account, 'SOL', order.fee - fee + (buy ? refund : result?.net ?? 0n), -(order.fee + (buy ? reservedInput : 0n))),
      posting(TX_COLLECTOR, 'SOL', fee),
      ...marketPostings,
    ];
    if (!buy || result) postings.push(posting(account, tokenId, buy ? result!.tokenAtoms : refund, buy ? 0n : -reservedInput));
    if (result) postings.push(posting(SWAP_COLLECTOR, 'SOL', result.swapFee));
    this.ledger.commit(postings);
    if (fee > 0n || result) {
      this.ledger.recordCost(account, tokenId, side, fee, result?.tokenAtoms, buy ? result?.gross : result?.net, oldQuantity);
    }
    this.kernel.fact('LedgerChanged', {
      postings, issuance: null,
      position: fee > 0n || result ? { account, tokenId, value: this.ledger.position(account, tokenId) } : null,
    });
    this.update({ ...order, status, reason, consumed, refunded: refund, chargedFee: fee, finalizedAt: this.kernel.now });
  }

  execute(id: string) {
    const order = this.state[id];
    if (!order || order.status !== 'QUEUED') return;
    if (this.kernel.now >= order.intent.expiresAt) return this.expire(id);
    const { intent } = order;
    const market = this.markets[intent.tokenId];
    if (market.terminalReason) return this.finish(order, 'CANCELLED', 'MARKET_TERMINAL', 0n);
    const real = reserves(this.ledger, market);
    const result = quote(market, real, intent);
    const floor = outputFloor(intent);
    if (floor === null) throw new Error('Queued order has no min output');
    if (!result || result.output < floor) return this.finish(order, 'REJECTED', result ? 'SLIPPAGE' : 'DUST_OR_LIQUIDITY', order.fee);

    const buy = intent.side === 'BUY';
    const reserve = reserveAccount(market);
    const completing = market.mechanism.kind === 'CURVE' && result.reservesAfter.tokens === 0n;
    const migration = completing ? handoff(this.ledger, market, result) : null;
    const postings = [
      posting(reserve, 'SOL', buy ? result.net : -result.gross),
      posting(reserve, intent.tokenId, buy ? -result.tokenAtoms : result.tokenAtoms),
      ...(migration?.postings ?? []),
    ];
    const next: Market = {
      ...market,
      mechanism: completing ? { kind: 'POOL' } : market.mechanism.kind === 'CURVE'
        ? { kind: 'CURVE', virtualSol: result.spotAfter.quoteAtoms, virtualTokens: result.spotAfter.tokenAtoms }
        : market.mechanism,
      epoch: market.epoch + (completing ? 1 : 0),
      reference: completing ? result.spotAfter : market.reference,
      migratedAt: completing ? this.kernel.now : market.migratedAt,
    };
    this.finish(order, result.partial ? 'PARTIAL_CLOSED' : 'FILLED', null, order.fee, result, postings);
    const fill: Fill = {
      orderId: id, intentId: order.intentId, agentId: intent.agentId, tokenId: intent.tokenId, side: intent.side,
      at: this.kernel.now, tokenAtoms: result.tokenAtoms, quoteAtomsExFee: buy ? result.net : result.gross,
      walletSwapQuoteSol: buy ? result.gross : result.net, swapFeeSol: result.swapFee,
      transactionFeeSol: order.fee, marketEpoch: market.epoch, spotAfter: result.spotAfter, evidence: intent.evidence,
    };
    const executed = this.kernel.fact('TradeExecuted', {
      fill, before: real, after: result.reservesAfter,
      progressBefore: progressPpm(market, real), progressAfter: progressPpm(market, result.reservesAfter),
    });
    const feedback = migration ? this.kernel.fact('MarketMigrated', {
      tokenId: market.tokenId, fromEpoch: market.epoch, toEpoch: next.epoch,
      reference: result.spotAfter, pool: migration.reserves,
    }, executed) : executed;
    this.changed(next, true);
    this.evaluate(next);
    return feedback;
  }
}
