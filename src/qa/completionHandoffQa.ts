import { TokenSim, type UserTradeExecutionNotice } from '../tokens/tokenSim';
import { SUPPLY, type TokenMeta } from '../tokens/types';
import { registry } from '../tokens/registry';
import { useTokenStore } from '../store/tokenStore';
import type { TokenChartEvent } from '../chart/tokenChartEvents';
let checks = 0;
function assert(ok: boolean, label: string): asserts ok {
  checks++;
  if (!ok) throw new Error(label);
}
function near(a: number, b: number, label: string): void {
  assert(Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(b)), `${label}: ${a} vs ${b}`);
}
let now = 1_800_000_000_000;
const savedNow = Date.now;
const meta = (id: string): TokenMeta => ({ id, name: 'Completion QA', ticker: 'QA', logoColor: '#fff', imageUrl: '/token-images/bull-gold.webp',
  supply: SUPPLY, createdAtSimMs: 0, fate: 'NORMAL', metrics: { topHoldersPct: 10,
    devHoldingsPct: 2, snipersPct: 1, lpBurnedPct: 100, insidersPct: 1, bundlersPct: 1 } });
function fixture(id: string): TokenSim {
  const sim = new TokenSim(meta(id), 2000, 1_000_000);
  sim['curveVirtualBase'] = 1000;
  sim['curveVirtualToken'] = 100_000_000;
  sim['curveInitialRealToken'] = 10_000_000;
  sim['curveRealToken'] = 1000; // 99.99% sold, without a completed fill.
  sim['curveRealBase'] = 500;
  sim['curveKStart'] = 1000 * 100_000_000;
  sim['lastPriceUsd'] = 0.00001;
  sim['lastMcapUsd'] = 10000;
  sim['bondingProgress'] = sim['getCurveProgress']();
  return sim;
}
function snapshot(sim: TokenSim): string {
  return JSON.stringify({ curve: sim.getCurveDebugSnapshot(), tape: sim['tape'], ledger: [...sim['ledger']],
    profiles: [...sim['walletProfiles']], stats: sim['statWindow'], candles: [1,15,30,60].flatMap(tf => [sim.getCandles(tf), sim.getCandles(tf,'mcap')]) });
}
try {
  Date.now = () => now;
  const dust = fixture('completion-dust');
  dust['curveRealToken'] = 0.0000005;
  const dustFill = dust['executeUserTradeImmediate']('BUY', 1, now);
  assert(dustFill.fill.ok && dust.getPhase() === 'MIGRATED', 'positive sub-EPS inventory can complete');
  assert(dust.getCurveDebugSnapshot().rTok === 0, 'dust completing fill empties reserve');
  const sim = fixture('completion-user');
  near(sim.getCurveDebugSnapshot().progressNowPct, 99.99, '99.99 percent');
  sim['lastMcapUsd'] = 100000;
  assert(sim['updatePhase'](now) === null && !sim.getCurveDebugSnapshot().hasMigrated, 'MCAP alone cannot migrate');
  sim['lastMcapUsd'] = 10000;
  sim['simTimeMs'] = 1_000_000; // The completing fill and fate deadline coincide.
  const before = sim.getCurveDebugSnapshot();
  const net = before.vBase * before.rTok / (before.vTok - before.rTok);
  const fill = sim['executeUserTradeImmediate']('BUY', 1, now);
  assert(fill.fill.ok, 'completing fill succeeds');
  const after = sim.getCurveDebugSnapshot();
  assert(after.rTok === 0 && after.hasMigrated && after.phase === 'MIGRATED', 'atomic handoff');
  near(fill.fill.filledUsd, net / 0.99, 'inverse cost with unchanged fee');
  near(after.k, before.k, 'completing curve K');
  near(after.priceCurveUsd, fill.fill.priceAfterUsd, 'no handoff teleport');
  assert(fill.events.length === 1 && fill.events[0]!.type === 'MIGRATION', 'one migration');
  near(fill.events[0]!.price!, fill.fill.priceAfterUsd, 'actual event price');
  near(fill.events[0]!.mcap!, fill.fill.mcapAfterUsd, 'actual event MCAP');
  assert(sim['updatePhase'](now) === null, 'idempotent phase update');
  const closed = snapshot(sim);
  assert(sim['executeCurveBuy'](100).tokensOut === 0, 'direct curve BUY closed');
  assert(sim['executeCurveSell'](10).tokenIn === 0, 'direct curve SELL closed');
  assert(snapshot(sim) === closed, 'closed helpers cannot mutate');
  const next = sim['executeUserTradeImmediate']('SELL', fill.fill.filledToken / 2, now);
  assert(next.fill.ok, 'next execution trades migrated immediately');
  assert(sim.getCurveDebugSnapshot().rTok === 0 && next.events.length === 0, 'SELL never reopens curve');
  const state = snapshot(sim);
  assert(!sim['executeUserTradeImmediate']('BUY', 1, now - 1).fill.ok, 'late rejected');
  assert(snapshot(sim) === state, 'late leaves all economic state unchanged');

  // Exercise real pending ordering, the existing relay and settlement callbacks.
  // The next engine execution must not begin before the prior notice and migration publication.
  for (const secondSide of ['BUY', 'SELL'] as const) {
    const pending = fixture(`completion-pending-${secondSide}`);
    pending['ledger'].set('you', 1000);
    useTokenStore.getState().addToken(pending.meta, pending.getRuntime());
    const first = pending.submitUserTrade({ side: 'BUY', amountIn: 1, slippageBps: 10000, latencyMs: 100 });
    const second = pending.submitUserTrade({ side: secondSide, amountIn: secondSide === 'BUY' ? 0.01 : 100,
      slippageBps: 10000, latencyMs: 100 });
    assert(first.ok && second.ok, `${secondSide} pending submission`);
    // Fix the same due timestamp; preserve the original submitted minOut.
    pending['pendingUserOrders'].forEach(order => { order.execMs = now + 100; });
    const originalMinOut = pending['pendingUserOrders'].map(order => order.minOut);
    const trace: string[] = [];
    const execute = pending['executeUserTradeImmediate'].bind(pending);
    pending['executeUserTradeImmediate'] = (side, amount, ts) => {
      trace.push(`execute:${side}:${pending.getPhase()}`);
      return execute(side, amount, ts);
    };
    const notices: UserTradeExecutionNotice[] = [];
    const migrations: TokenChartEvent[] = [];
    now += 100;
    pending.tick(0.1, 'OFF', notice => {
      notices.push(notice);
      registry['executions'].process(pending.meta.id, pending, [notice]);
      trace.push(`notice:${notice.side}:${notice.status}`);
    }, event => {
      migrations.push(event);
      useTokenStore.getState().pushTokenEvents(pending.meta.id, [event]);
      trace.push('migration');
    });
    assert(trace.slice(0,5).join('|') === `execute:BUY:NEW|notice:BUY:FILLED|migration|execute:${secondSide}:MIGRATED|notice:${secondSide}:FILLED`, `${secondSide} ordered publication: ${trace}`);
    assert(notices.length === 2 && migrations.length === 1, 'single notice and migration publication');
    notices.forEach((notice, i) => near(notice.minOut, originalMinOut[i]!, 'original minOut preserved'));
    assert(pending.drainUserTradeExecutions().length === 0, 'inline notices are not queued twice');
    const events = useTokenStore.getState().eventsByTokenId[pending.meta.id]!;
    assert(events.map(event => event.type).join('|') === `USER_BUY|MIGRATION|USER_${secondSide}`, 'store event insertion order');
  }

  const rejected = fixture('completion-slippage');
  const completing = rejected.submitUserTrade({ side: 'BUY', amountIn: 1, slippageBps: 10000, latencyMs: 100 });
  const strict = rejected.submitUserTrade({ side: 'BUY', amountIn: 0.00001, slippageBps: 0, latencyMs: 100 });
  assert(completing.ok && strict.ok, 'strict pending fixture');
  rejected['pendingUserOrders'].forEach(order => { order.execMs = now + 100; });
  let boundary = '';
  let failed = false;
  now += 100;
  rejected.tick(0.1, 'OFF', notice => {
    if (notice.status === 'FAILED') {
      failed = true;
      assert(notice.reason === 'Slippage exceeded (minOut)', 'actual venue respects original minOut');
      assert(snapshot(rejected) === boundary, 'slippage failure does not mutate economics');
    }
  }, () => { boundary = snapshot(rejected); });
  assert(failed, 'strict second order fails after completion reprice');

  const botTick = fixture('completion-bot-tick');
  const botTrace: string[] = [];
  botTick['executeMarketFlowAsTape'] = () => {
    assert(botTick['executeSimBuyTrade'](1000, now), 'bot tick completion');
    botTrace.push('first-return');
    assert(botTick.getPhase() === 'MIGRATED', 'next batch execution sees migrated');
    assert(botTick['executeSimBuyTrade'](1, now), 'next batch BUY available during shock');
    botTrace.push('next-return');
  };
  const botEvents = botTick.tick(0.1, 'OFF', undefined, () => { botTrace.push('migration'); });
  assert(botTrace.join('|') === 'migration|first-return|next-return', 'bot migration published before next execution');
  assert(botEvents.filter(event => event.type === 'MIGRATION').length === 1, 'one returned bot event');
  assert(botTick['botMigrationEvents'].length === 0, 'bot queue drained');

  const bot = fixture('completion-bot');
  const reference = bot['executeSimBuyTrade'](1000, now);
  assert(reference && bot.getPhase() === 'MIGRATED', 'bot completes before helper returns');
  assert(bot['botMigrationEvents'].length === 1, 'bot migration queued once');
  assert(bot['executeSimBuyTrade'](1, now), 'next bot BUY uses migrated venue');
  assert(bot['botMigrationEvents'].length === 1 && bot.getCurveDebugSnapshot().rTok === 0, 'bot batch no duplicate or reopened curve');
  console.log(`Completion handoff QA: ${checks} assertions PASS`);
} finally { Date.now = savedNow; }

