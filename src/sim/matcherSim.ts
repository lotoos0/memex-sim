import type { Order, Side } from '../store/tradingStore';

export function marketFillPrice(side: Side, lastPrice: number, slippagePct: number): number {
  return side === 'buy' ? lastPrice * (1 + slippagePct / 100) : lastPrice * (1 - slippagePct / 100);
}

export function canLimitFill(o: Order, lastPrice: number): boolean {
  if (o.type !== 'limit' || o.price == null) return false;
  if (o.side === 'buy') return lastPrice <= o.price;
  return lastPrice >= o.price;
}
