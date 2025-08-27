import type { Order, RiskLimits, Side, Position } from '../store/tradingStore';

export function validateRisk(o: Order, lastPrice: number, risk: RiskLimits, pos?: Position): { ok: boolean; reason?: string } {
  if (o.qty <= 0) return { ok: false, reason: 'qty<=0' };
  const px = o.price ?? lastPrice;
  const slPct = Math.abs(o.slPct ?? 0.01);
  const riskUsd = o.qty * slPct; // qty w USDT, uproszczone
  if (riskUsd > risk.maxRiskUsd) return { ok: false, reason: `risk>${risk.maxRiskUsd}` };

  // reduceOnly: nie zwiększaj ekspozycji
  if (o.reduceOnly) {
    if (!pos || pos.qty <= 0) return { ok: false, reason: 'reduceOnly-without-position' };
    const sameDir = (pos.side === o.side);
    if (sameDir) return { ok: false, reason: 'reduceOnly increases exposure' };
  }
  return { ok: true };
}

// bardzo prosty limiter
let windowCount = 0;
let windowStart = 0;
export function rateLimit(now: number, limitPerMin: number): boolean {
  if (now - windowStart > 60_000) { windowStart = now; windowCount = 0; }
  windowCount++;
  return windowCount <= limitPerMin;
}
