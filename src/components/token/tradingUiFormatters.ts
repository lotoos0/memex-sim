import { usdToSol } from '../../store/walletStore';

export type TradingStatUnit = 'usd' | 'sol';

export function fmtUsd(v: number): string {
  if (!Number.isFinite(v)) return '$0';
  const a = Math.abs(v);
  if (a >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
}

export function fmtSol(v: number): string {
  if (!Number.isFinite(v)) return '0';
  const a = Math.abs(v);
  if (a >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  if (a >= 1) return v.toFixed(3);
  if (a >= 0.01) return v.toFixed(4);
  return v.toFixed(6);
}

export function fmtPriceUsd(v: number | null | undefined): string {
  if (!Number.isFinite(v ?? NaN) || (v ?? 0) <= 0) return '-';
  const price = v as number;
  if (price >= 1) return `$${price.toFixed(4)}`;
  if (price >= 0.01) return `$${price.toFixed(6)}`;
  return `$${price.toExponential(4)}`;
}

export function fmtQty(v: number): string {
  if (!Number.isFinite(v)) return '0';
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  if (a >= 1) return v.toFixed(2);
  return v.toFixed(6);
}

export function fmtSignedPct(v: number): string {
  if (!Number.isFinite(v)) return '0.00%';
  const sign = v >= 0 ? '+' : '-';
  return `${sign}${Math.abs(v).toFixed(2)}%`;
}

export function fmtAgo(tsMs: number): string {
  if (!Number.isFinite(tsMs) || tsMs <= 0) return '-';
  const dMs = Math.max(0, Date.now() - tsMs);
  if (dMs < 1_000) return `${Math.round(dMs)}ms`;
  if (dMs < 60_000) return `${Math.round(dMs / 1_000)}s`;
  if (dMs < 3_600_000) return `${Math.round(dMs / 60_000)}m`;
  return `${Math.round(dMs / 3_600_000)}h`;
}

export function statTone(v: number): string {
  if (!Number.isFinite(v) || Math.abs(v) < 1e-9) return 'text-ax-text';
  return v >= 0 ? 'text-ax-green' : 'text-ax-red';
}

export function sideTone(side: 'buy' | 'sell'): string {
  return side === 'buy' ? 'text-ax-green' : 'text-ax-red';
}

export function statusTone(status: 'filled' | 'failed'): string {
  return status === 'filled' ? 'text-ax-green' : 'text-ax-red';
}

export function formatMoneyByUnit(usd: number, unit: TradingStatUnit): string {
  return unit === 'usd' ? fmtUsd(usd) : `${fmtSol(usdToSol(usd))} SOL`;
}

export function formatSignedMoneyByUnit(usd: number, unit: TradingStatUnit): string {
  if (!Number.isFinite(usd)) return unit === 'usd' ? '$0' : '0 SOL';
  const sign = usd >= 0 ? '+' : '-';
  return `${sign}${formatMoneyByUnit(Math.abs(usd), unit)}`;
}
