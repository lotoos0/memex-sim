import { runMarketBehaviorBaseline, defaultBaselineConfig } from './marketBehaviorBaseline';
import { measurePath, summarizePaths } from './marketBehaviorMetrics';

function near(actual: number | null, expected: number, label: string): void {
  if (actual === null || Math.abs(actual - expected) > 1e-9) throw new Error(label);
}
const path = measurePath({ startMs: 0, endMs: 5000, initialPriceUsd: 100, prints: [
  { ageMs: 100, priceUsd: 110, quoteUsd: 10, side: 'BUY' },
  { ageMs: 1000, priceUsd: 88, quoteUsd: 20, side: 'SELL' },
  { ageMs: 4100, priceUsd: 110, quoteUsd: 30, side: 'BUY' },
] });
near(path.maxDrawdownPct, 20, 'peak-to-trough drawdown');
near(path.buyCountShare, 2 / 3, 'count share');
near(path.buyVolumeShare, 2 / 3, 'volume share');
near(path.tradesPerSec, 0.6, 'frequency includes silence');
near(path.emptySecondBins, 3, 'right-closed boundary and empty seconds');
near(path.impulsesPct[0]!, 10, 'first impulse');
near(path.impulsesPct[1]!, 25, 'reclaim impulse');
near(path.correctionsPct[0]!, 20, 'correction');
near(path.directionChanges, 2, 'direction changes');
const empty = measurePath({ startMs: 0, endMs: 5000, initialPriceUsd: 100, prints: [] });
near(empty.emptySecondShare, 1, 'quiet path');
if (empty.buyCountShare !== null) throw new Error('No trades is not zero buy share');
const total = summarizePaths([path, empty]);
near(total.tradesPerSec, 0.3, 'exposure-weighted frequency');
near(total.maxDrawdownPct.p50, 10, 'interpolated quantile');
const zero = measurePath({ startMs: 1000, endMs: 1000, initialPriceUsd: 100,
  prints: [{ ageMs: 1000, priceUsd: 99, quoteUsd: 1, side: 'SELL' }] });
near(zero.emptySecondBins, 0, 'equal-time zero-duration observation');
const from80 = measurePath({ startMs: 1000, endMs: 5000, initialPriceUsd: 100, prints: [
  { ageMs: 2000, priceUsd: 60, quoteUsd: 10, side: 'SELL' },
  { ageMs: 4000, priceUsd: 120, quoteUsd: 20, side: 'BUY' },
] });
near(from80.maxDrawdownPct, 40, 'full path retains retreat below entry');
near(from80.returnPct, 20, 'full path retains reclaim');
near(from80.durationSec, 4, 'time since first passage');
let rejected = false;
try {
  measurePath({ startMs: 0, endMs: 5000, initialPriceUsd: 100, prints: [
    { ageMs: 2000, priceUsd: 60, quoteUsd: 10, side: 'SELL' },
    { ageMs: 1000, priceUsd: 120, quoteUsd: 20, side: 'BUY' },
  ] });
} catch { rejected = true; }
if (!rejected) throw new Error('Metrics accepted out-of-order prints');

const config = { ...defaultBaselineConfig, seeds: ['order-A', 'order-B'], tokensPerSeed: 3, horizonSec: 5 };
const before = Date.now;
const first = runMarketBehaviorBaseline(config);
const second = runMarketBehaviorBaseline(config);
if (Date.now !== before) throw new Error('Harness leaked mocked Date.now');
if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error('Repeated invocation differs');
const reversed = runMarketBehaviorBaseline({ ...config, seeds: config.seeds.slice().reverse() });
for (const token of first.tokens) {
  if (JSON.stringify(token) !== JSON.stringify(reversed.tokens.find(row => row.tokenId === token.tokenId))) {
    throw new Error(`Seed order dependency ${token.tokenId}`);
  }
}
console.log('Market behavior metrics QA: PASS (known paths, silence, equal times, determinism, seed order)');
