import { usePostStore } from '../store/postStore';
import { useTokenStore } from '../store/tokenStore';
import type {
  TokenSim,
  UserTradeExecutionNotice,
  UserTradeOrderStatus,
  UserTradeSubmitResult,
} from './tokenSim';

const MAX_ORDER_SNAPSHOTS = 4_000;

export type TradeExecutionCallback = (execution: UserTradeExecutionNotice) => void;

export class RegistryExecutionRelay {
  private tradeOrders = new Map<string, UserTradeOrderStatus>();
  private subscribers = new Set<TradeExecutionCallback>();

  onSubmitAccepted(result: Extract<UserTradeSubmitResult, { ok: true }>): void {
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

  process(tokenId: string, sim: TokenSim, executions: UserTradeExecutionNotice[]): void {
    if (executions.length === 0) return;

    useTokenStore.getState().updateToken(tokenId, sim.getRuntime());
    const simNowMs = sim.getSimTimeMs();

    for (let i = 0; i < executions.length; i++) {
      const execution = executions[i]!;
      this.tradeOrders.set(execution.orderId, execution);
      this.pruneTradeOrders();

      if (execution.status === 'FILLED') {
        usePostStore.getState().addSystemPost(
          tokenId,
          `You ${execution.side} ${fmtUsdCompact(execution.fill.filledUsd)} @ ${fmtPrice(execution.fill.avgPriceUsd)}`,
          {
            kind: 'TRADE',
            tone: execution.side === 'BUY' ? 'buy' : 'sell',
            author: 'you',
            createdAtMs: simNowMs,
          }
        );

        useTokenStore.getState().pushTokenEvents(tokenId, [{
          tokenId,
          tMs: execution.fill.tsMs,
          type: execution.side === 'BUY' ? 'USER_BUY' : 'USER_SELL',
          price: execution.fill.priceAfterUsd,
          mcap: execution.fill.mcapAfterUsd,
          size: execution.fill.filledToken,
        }]);
      }

      if (this.subscribers.size > 0) {
        for (const cb of this.subscribers) cb(execution);
      }
    }
  }

  getOrderStatus(orderId: string): UserTradeOrderStatus | null {
    return this.tradeOrders.get(orderId) ?? null;
  }

  subscribe(cb: TradeExecutionCallback): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  clear(): void {
    this.tradeOrders.clear();
    this.subscribers.clear();
  }

  private pruneTradeOrders(): void {
    while (this.tradeOrders.size > MAX_ORDER_SNAPSHOTS) {
      const firstKey = this.tradeOrders.keys().next().value;
      if (typeof firstKey !== 'string') break;
      this.tradeOrders.delete(firstKey);
    }
  }
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
