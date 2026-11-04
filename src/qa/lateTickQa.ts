import { CandleAggregator } from '../engine/aggregator';
import { TokenSim } from '../tokens/tokenSim';
import { SUPPLY, type TokenMeta } from '../tokens/types';
import { registry } from '../tokens/registry';
import { useTokenStore } from '../store/tokenStore';
import { useTradingStore } from '../store/tradingStore';
import { useWalletStore } from '../store/walletStore';

// Standalone regression; the pre-fix characterization is preserved in commit 174c078.
const failures: string[] = [];
let contractChecks = 0;
let integrationChecks = 0;
function check(group: 'contract' | 'integration', condition: boolean, label: string): void {
  if (group === 'contract') contractChecks++;
  else integrationChecks++;
  if (!condition) failures.push(`${group}/${label}`);
}

for (const tf of [1, 15, 30, 60]) {
  const base = 1_800_000_000_000;
  const span = tf * 1000;
  const label = `${tf}s`;
  const chronological = new CandleAggregator(tf);
  const first = chronological.pushTick(base + 100, 10, 2);
  const second = chronological.pushTick(base + 300, 14, 3);
  check('contract', first.mode === 'new' && second.mode === 'update', `${label}/chronological-accepted`);
  const equal = chronological.pushTick(base + 300, 8, 4);
  const equalAgain = chronological.pushTick(base + 300, 12, 5);
  check('contract', equal.mode === 'update' && equalAgain.mode === 'update'
    && chronological.getSeries()[0]!.close === 12, `${label}/equal-time-insertion-order`);
  const sparse = chronological.pushTick(base + 5 * span + 100, 20, 6);
  check('contract', sparse.mode === 'new' && chronological.getSeries().length === 2
    && sparse.candle.time === (base / 1000) + 5 * tf, `${label}/sparse-no-synthetic-buckets`);
  check('contract', sparse.mode !== 'rejected' && sparse.candle.open === 12 && sparse.candle.high === 20
    && sparse.candle.low === 12 && sparse.candle.close === 20, `${label}/continuity-open-preserved`);
  check('contract', chronological.getSeries().reduce((sum, c) => sum + c.volume, 0) === 20,
    `${label}/chronological-volume-once`);

  for (const previousBucket of [false, true]) {
    const aggregator = new CandleAggregator(tf);
    aggregator.pushTick(base + 100, 10, 2);
    if (previousBucket) aggregator.pushTick(base + span + 300, 20, 3);
    else aggregator.pushTick(base + 300, 20, 3);
    // getSeries copies only the array. Clone each candle before testing mutation.
    const before = aggregator.getSeries().map((c) => ({ ...c }));
    const scenario = `${label}/late-${previousBucket ? 'previous' : 'same'}-bucket`;
    const result = aggregator.pushTick(base + 200, 1, 7);
    const after = aggregator.getSeries();
    check('contract', typeof result === 'object' && result !== null
      && 'mode' in result && result.mode === 'rejected'
      && 'reason' in result && result.reason === 'late', `${scenario}/explicit-rejection`);
    check('contract', JSON.stringify(after) === JSON.stringify(before), `${scenario}/all-OHLCV-unchanged`);
    // Rejection must not lower the watermark: 250 is still older than accepted 300.
    const afterFirst = JSON.stringify(after);
    aggregator.pushTick(base + 250, 2, 11);
    check('contract', JSON.stringify(aggregator.getSeries()) === afterFirst,
      `${scenario}/rejection-does-not-lower-watermark`);
  }

  chronological.reset();
  check('contract', chronological.getSeries().length === 0, `${label}/reset-clears-series`);
  const restarted = chronological.pushTick(base - span, 7, 9);
  check('contract', restarted.mode === 'new' && chronological.getSeries().length === 1
    && restarted.candle.time === base / 1000 - tf && restarted.candle.open === 7
    && restarted.candle.close === 7 && restarted.candle.volume === 9, `${label}/reset-allows-earlier-time`);
}
// The same stream must produce identical decisions for both metrics and every TF.
const fanout = [1, 15, 30, 60].flatMap((tf) => [new CandleAggregator(tf), new CandleAggregator(tf)]);
for (const [time, accepted] of [[100, true], [300, true], [200, false], [300, true],
  [300_000, true], [400, false]] as const) {
  const decisions = fanout.map((a, i) => a.pushTick(time, i % 2 === 0 ? 10 : 10_000, 2).mode !== 'rejected');
  check('integration', decisions.every((decision) => decision === accepted), `eight-aggregators/${time}`);
}
for (const a of fanout) a.reset();
check('integration', fanout.every((a) => a.pushTick(0, 10, 2).mode === 'new'), 'eight-aggregators/reset');

const originalNow = Date.now;
const base = 1_800_000_000_000;
let now = base;
function create(id: string): TokenSim {
  const meta: TokenMeta = {
    id, name: 'Late Tick QA', ticker: 'LATE', logoColor: '#ffffff', imageUrl: null,
    supply: SUPPLY, createdAtSimMs: 0, fate: 'NORMAL',
    metrics: { topHoldersPct: 10, devHoldingsPct: 2, snipersPct: 1,
      lpBurnedPct: 100, insidersPct: 1, bundlersPct: 1 },
  };
  return new TokenSim(meta, 5_000, 1_000_000);
}
// Snapshot economics, tape, stats and all eight series, not mutable references.
function snapshot(sim: TokenSim): string {
  return JSON.stringify({ curve: sim.getCurveDebugSnapshot(), phase: sim.getPhase(),
    price: sim.getLastPriceUsd(), swap: sim['lastCurveSwap'], ledger: [...sim['ledger']],
    profiles: [...sim['walletProfiles']], active: [...sim['walletLastActiveMs']],
    rng: sim['rng'], tape: sim['tape'], stats: sim['statWindow'],
    candles: [1, 15, 30, 60].flatMap((tf) => [sim.getCandles(tf), sim.getCandles(tf, 'mcap')]) });
}
function volumesAgree(sim: TokenSim): boolean {
  const tape = sim['tape'].reduce((sum, row) => sum + row.notionalUsd, 0);
  const stats = sim['statWindow'].reduce((sum, row) => sum + row.volUsd, 0);
  return Math.abs(tape - stats) < 1e-9 && [1, 15, 30, 60].every((tf) =>
    (['price', 'mcap'] as const).every((metric) =>
      Math.abs(sim.getCandles(tf, metric).reduce((sum, row) => sum + row.volume, 0) - tape) < 1e-9));
}
try {
  Date.now = () => now;
  for (const migrated of [false, true]) {
    const sim = create(`late-${migrated}`);
    if (migrated) {
      // Isolate both execution branches; no migration mechanics are changed.
      sim['hasMigrated'] = true;
      sim['phase'] = 'MIGRATED';
    }
    for (const cutoff of [base, base + 300]) {
      if (cutoff > base) {
        const seed = sim['executeUserTradeImmediate']('BUY', 0.1, cutoff);
        check('integration', seed.fill.ok, `${migrated}/seed-user`);
        check('integration', sim['executeSimBuyTrade'](15, cutoff), `${migrated}/seed-bot`);
      }
      for (const path of ['user-buy', 'user-sell', 'bot-buy', 'bot-sell'] as const) {
        const before = snapshot(sim);
        const result = path === 'bot-buy' ? sim['executeSimBuyTrade'](15, cutoff - 1)
          : path === 'bot-sell' ? sim['executeSimSellTrade'](1, cutoff - 1)
          : sim['executeUserTradeImmediate'](path === 'user-buy' ? 'BUY' : 'SELL', 0.1, cutoff - 1).fill.ok;
        check('integration', !result, `${migrated}/${cutoff}/${path}/rejected-before-swap`);
        check('integration', snapshot(sim) === before, `${migrated}/${cutoff}/${path}/no-mutation`);
        check('integration', volumesAgree(sim), `${migrated}/${cutoff}/${path}/tape-candle-stats`);
      }
    }
    for (const path of ['user-buy', 'user-sell', 'bot-buy', 'bot-sell'] as const) {
      const result = path === 'bot-buy' ? sim['executeSimBuyTrade'](15, base + 300)
        : path === 'bot-sell' ? sim['executeSimSellTrade'](1, base + 300)
        : sim['executeUserTradeImmediate'](path === 'user-buy' ? 'BUY' : 'SELL', 0.1, base + 300).fill.ok;
      check('integration', result, `${migrated}/${path}/equal-time-accepted`);
      check('integration', volumesAgree(sim), `${migrated}/${path}/accepted-volume-once`);
    }
  }

  // Force the pending-order failure branch with a future accepted bot trade.
  const sim = create('late-refund');
  registry['tokens'].set(sim.meta.id, sim);
  useTokenStore.getState().addToken(sim.meta, sim.getRuntime());
  useWalletStore.setState({ solBalance: 1_000 });
  const submit = useTradingStore.getState().quickBuy(sim.meta.id, 0.1, { slippagePct: 100 });
  if (!submit.ok) throw new Error('Invalid fixture: pending BUY');
  const pending = Object.values(useTradingStore.getState().pendingQuickOrdersById)
    .find((order) => order.tokenId === sim.meta.id);
  if (!pending) throw new Error('Invalid fixture: reserved BUY');
  check('integration', sim['executeSimBuyTrade'](15, pending.execMs + 100), 'refund/future-bot-trade');
  const before = snapshot(sim);
  now = pending.execMs;
  sim['processPendingUserTrades'](now);
  const notices = sim.drainUserTradeExecutions();
  check('integration', notices.length === 1 && notices[0]!.status === 'FAILED'
    && notices[0]!.reason === 'Late trade timestamp', 'refund/failed-notice');
  check('integration', snapshot(sim) === before && volumesAgree(sim), 'refund/no-economic-mutation');
  registry['executions'].process(sim.meta.id, sim, notices);
  check('integration', Math.abs(useWalletStore.getState().solBalance - (1_000 - pending.txCostSol)) < 1e-9,
    'refund/reservation-returned-tx-cost-retained');
  check('integration', !useTradingStore.getState().pendingQuickOrdersById[pending.orderId], 'refund/pending-cleared');
  check('integration', !useTradingStore.getState().quickPositionsByTokenId[sim.meta.id], 'refund/no-position');
  registry['tokens'].delete(sim.meta.id);
} finally {
  Date.now = originalNow;
}
for (const failure of failures) console.error(`FAIL ${failure}`);
console.log(`SIM contract: ${contractChecks - failures.filter((f) => f.startsWith('contract/')).length}/${contractChecks} passed`);
console.log(`SIM integration: ${integrationChecks - failures.filter((f) => f.startsWith('integration/')).length}/${integrationChecks} passed`);
if (failures.length) throw new Error(`Late tick QA: ${failures.length} failures`);
