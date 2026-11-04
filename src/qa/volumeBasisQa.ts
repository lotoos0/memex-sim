import { RNG } from '../engine/rng';
import { TokenSim, type UserTradeFill } from '../tokens/tokenSim';
import { SOL_PRICE_USD, SUPPLY, type TokenMeta } from '../tokens/types';
import { registry } from '../tokens/registry';
import { publishRegistryFeed } from '../tokens/registryFeedPublisher';
import { useTokenStore } from '../store/tokenStore';
import { useTradingStore } from '../store/tradingStore';
import { useWalletStore } from '../store/walletStore';

// Diagnostic, not a CI gate. Private fixture access adds no production seam.
// Market volume is compared separately from propagation and known economic diagnostics.
type Group = 'integrity' | 'candidate' | 'model' | 'wallet' | 'settlement';
const counts: Record<Group, number> = { integrity: 0, candidate: 0, model: 0, wallet: 0, settlement: 0 };
const failures: Array<{ group: Group; label: string }> = [];
const traces: unknown[] = [];
const singleSwapEconomics: unknown[] = [];
const base = 1_800_000_000_000;
const feeFactor = 0.99; // Existing 100 bps model, independently specified.
let now = base;
function check(group: Group, condition: boolean, label: string): void {
  counts[group]++;
  if (!condition) failures.push({ group, label });
}
function near(group: Group, actual: number, expected: number, label: string): void {
  check(group, Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-8 * Math.max(1, Math.abs(expected)),
    `${label}: actual=${actual}, expected=${expected}`);
}
function fixture(condition: boolean, label: string): asserts condition {
  if (!condition) throw new Error(`Invalid fixture: ${label}`);
}
function create(id: string, migrated = false): TokenSim {
  const meta: TokenMeta = {
    id, name: 'Volume Basis QA', ticker: 'VOL', logoColor: '#ffffff', supply: SUPPLY,
    createdAtSimMs: 0, fate: 'NORMAL', metrics: { topHoldersPct: 10, devHoldingsPct: 2,
      snipersPct: 1, lpBurnedPct: 100, insidersPct: 1, bundlersPct: 1 },
  };
  const sim = new TokenSim(meta, 10_000, 1_000_000);
  sim['curveVirtualBase'] = 1_000;
  sim['curveVirtualToken'] = 100_000_000;
  sim['curveRealBase'] = 500;
  sim['curveInitialRealToken'] = 100_000_000;
  sim['curveRealToken'] = 90_000_000;
  sim['curveKStart'] = 1_000 * 100_000_000;
  sim['lastPriceUsd'] = 0.00001;
  sim['lastMcapUsd'] = 10_000;
  sim['ledger'].set('you', 20_000_000);
  sim['ledger'].set('ps_volume_fixture', 20_000_000);
  if (migrated) {
    sim['hasMigrated'] = true;
    sim['phase'] = 'MIGRATED';
  }
  return sim;
}
function snapshot(sim: TokenSim): string {
  return JSON.stringify({ curve: sim.getCurveDebugSnapshot(), tape: sim['tape'], stats: sim['statWindow'],
    ledger: [...sim['ledger']], profiles: [...sim['walletProfiles']],
    candles: [1, 15, 30, 60].flatMap((tf) => [sim.getCandles(tf), sim.getCandles(tf, 'mcap')]) });
}
function verifyProjection(sim: TokenSim, expected: Array<{ tMs: number; quote: number; legacyVolume?: number }>, label: string): void {
  const recorded = sim['tape'].reduce((sum, row) => sum + row.notionalUsd, 0);
  const quote = expected.reduce((sum, row) => sum + row.quote, 0);
  near('integrity', sim['tape'].length, expected.length, `${label}/one-row-per-execution`);
  near('integrity', sim['statWindow'].length, expected.length, `${label}/one-stat-per-execution`);
  near('integrity', sim.getRuntime().vol5mUsd, recorded, `${label}/runtime-propagation`);
  near('candidate', sim.getRuntime().vol5mUsd, quote, `${label}/runtime-exchanged-quote`);
  near('integrity', sim.getRuntime().buys5m + sim.getRuntime().sells5m, expected.length, `${label}/counts-once`);
  for (const tf of [1, 15, 30, 60]) {
    const buckets = new Map<number, number>();
    for (const row of expected) {
      const time = Math.floor(row.tMs / (tf * 1000)) * tf;
      buckets.set(time, (buckets.get(time) ?? 0) + row.quote);
    }
    for (const metric of ['price', 'mcap'] as const) {
      const candles = sim.getCandles(tf, metric);
      near('integrity', candles.reduce((sum, c) => sum + c.volume, 0), recorded, `${label}/${tf}/${metric}/propagation-once`);
      for (const candle of candles) near('candidate', candle.volume, buckets.get(candle.time) ?? 0,
        `${label}/${tf}/${metric}/${candle.time}/exchanged-quote`);
    }
  }
}
function execute(sim: TokenSim, actor: 'user' | 'bot', side: 'BUY' | 'SELL', amount: number,
  expected: Array<{ tMs: number; quote: number; legacyVolume?: number }>, label: string): UserTradeFill | undefined {
  const before = sim.getCurveDebugSnapshot();
  const migrated = sim['hasMigrated'];
  // Migrated reserves are synthesized per call, not persistent balances.
  // Capture only the execution context; solve constant product independently below.
  const reserves = migrated ? sim['getMigratedReserves'](side) : undefined;
  const profilesBefore = new Map([...sim['walletProfiles']].map(([id, p]) =>
    [id, { boughtUsd: p.boughtUsd, soldUsd: p.soldUsd }]));
  const start = sim['tape'].length;
  let fill: UserTradeFill | undefined;
  if (actor === 'user') {
    fill = sim['executeUserTradeImmediate'](side, amount, now).fill;
    fixture(fill.ok, label);
  } else fixture(side === 'BUY' ? sim['executeSimBuyTrade'](amount, now)
    : sim['executeSimSellTrade'](amount, now), label);
  fixture(sim['tape'].length === start + 1, `${label}/one execution`);
  const row = sim['tape'][start]!;
  const after = sim.getCurveDebugSnapshot();
  const x = reserves?.reserveBaseUsd ?? before.vBase;
  const y = reserves?.reserveToken ?? before.vTok;
  const idealQuote = side === 'BUY' ? x * row.tokenAmount / (y - row.tokenAmount)
    : x * row.tokenAmount / (y + row.tokenAmount);
  const quote = migrated ? idealQuote : Math.abs(after.vBase - before.vBase);
  const walletQuote = side === 'BUY' ? quote / feeFactor : quote * feeFactor;
  const fee = Math.abs(walletQuote - quote);
  if (!migrated) {
    near('model', Math.abs(after.vBase - before.vBase), idealQuote, `${label}/virtual-quote-vs-K-oracle`);
    near('model', after.vBase * after.vTok, before.vBase * before.vTok, `${label}/constant-product`);
    near('model', Math.abs(after.rBase - before.rBase), side === 'BUY' ? quote : quote * feeFactor,
      `${label}/real-reserve-current-model`);
  }
  if (fill?.ok) {
    near('integrity', fill.filledUsd, walletQuote, `${label}/wallet-gross-buy-net-sell`);
    near('integrity', fill.feeUsd, fee, `${label}/execution-fee`);
    near('integrity', fill.filledSol * SOL_PRICE_USD, fill.filledUsd, `${label}/fill-SOL-USD`);
  }
  near('candidate', row.notionalUsd, quote, `${label}/tape-exchanged-quote`);
  near('candidate', sim['statWindow'][start]!.volUsd, quote, `${label}/stat-exchanged-quote`);
  const profile = sim['walletProfiles'].get(row.walletId)!;
  fixture(profile !== undefined, `${label}/wallet profile`);
  const profileField = side === 'BUY' ? 'boughtUsd' : 'soldUsd';
  near('wallet', profile[profileField] - (profilesBefore.get(row.walletId)?.[profileField] ?? 0),
    walletQuote, `${label}/holder-profile-wallet-notional`);
  expected.push({ tMs: row.tMs, quote,
    legacyVolume: fill?.ok ? fill.filledUsd : side === 'BUY' ? quote : walletQuote });
  if (!label.startsWith('mixed/')) {
    singleSwapEconomics.push({ label, initialCurve: before, reserveContext: reserves ?? null,
      finalCurve: after, fill: fill ?? null, ledger: [...sim['ledger']],
      profiles: [...sim['walletProfiles']], price: sim.getLastPriceUsd(),
      mcap: sim.getLastMcapUsd(), phase: sim.getPhase(), swap: sim['lastCurveSwap'],
      trade: { tMs: row.tMs, side: row.side, walletId: row.walletId,
        tokenAmount: row.tokenAmount, priceUsd: row.priceUsd, mcapUsd: row.mcapUsd },
      rng: JSON.parse(JSON.stringify(sim['rng'])) });
  }
  verifyProjection(sim, expected, label);
  traces.push({ label, tokens: row.tokenAmount, exchangedQuote: quote, walletQuote, fee,
    recordedVolume: row.notionalUsd, fillUsd: fill?.ok ? fill.filledUsd : null,
    virtualQuoteDelta: migrated ? null : Math.abs(after.vBase - before.vBase),
    realQuoteDelta: migrated ? null : Math.abs(after.rBase - before.rBase) });
  return fill;
}

const originalNow = Date.now;
const originalRandom = Math.random;
const idRng = new RNG('volume-basis-qa-ids');
try {
  Date.now = () => now;
  Math.random = () => idRng.next();
  for (const migrated of [false, true]) for (const actor of ['user', 'bot'] as const) {
    for (const side of ['BUY', 'SELL'] as const) {
      const label = `${migrated ? 'post' : 'pre'}/${actor}/${side}`;
      execute(create(label, migrated), actor, side, actor === 'user' ? (side === 'BUY' ? 0.1 : 1_000_000) : 15,
        [], label);
    }
  }
  for (const actor of ['user', 'bot'] as const) {
    const sim = create(`exhaustion-${actor}`);
    sim['curveRealToken'] = 10_000_000;
    const grossNeeded = 1_000 * 10_000_000 / 90_000_000 / feeFactor;
    const fill = execute(sim, actor, 'BUY', actor === 'user' ? grossNeeded * 3 / SOL_PRICE_USD : grossNeeded * 3,
      [], `exhaustion/${actor}`);
    near('integrity', sim['tape'][0]!.tokenAmount, 10_000_000, `${actor}/capped-output`);
    if (fill?.ok) near('integrity', fill.filledUsd, grossNeeded, 'exhaustion/unused-input-not-charged');
  }
  const partial = create('partial-sell');
  const partialFill = execute(partial, 'user', 'SELL', 20_000_000, [], 'partial/user/SELL');
  fixture(partialFill?.ok === true, 'partial SELL');
  near('integrity', partialFill.filledToken, 10_000_000, 'partial/only-available-tokens-filled');

  // Distinguish reserve-model inconsistency from a mere volume convention choice.
  const cashCap = create('cash-cap');
  cashCap['curveRealBase'] = 1;
  execute(cashCap, 'user', 'SELL', 1_000_000, [], 'cash-cap/user/SELL');

  const mixed = create('mixed');
  const expected: Array<{ tMs: number; quote: number; legacyVolume?: number }> = [];
  for (const actor of ['user', 'bot'] as const) for (const side of ['BUY', 'SELL'] as const) {
    now += 61_000;
    execute(mixed, actor, side, actor === 'user' ? (side === 'BUY' ? 0.1 : 100_000) : 1,
      expected, `mixed/${actor}/${side}`);
  }
  for (const path of ['user-buy', 'user-sell', 'bot-buy', 'bot-sell'] as const) {
    const before = snapshot(mixed);
    const ok = path === 'bot-buy' ? mixed['executeSimBuyTrade'](15, now - 1)
      : path === 'bot-sell' ? mixed['executeSimSellTrade'](1, now - 1)
      : mixed['executeUserTradeImmediate'](path === 'user-buy' ? 'BUY' : 'SELL', 0.1, now - 1).fill.ok;
    check('integrity', !ok && snapshot(mixed) === before, `late/${path}/zero-additional-volume`);
  }
  const before = snapshot(mixed);
  check('integrity', !mixed['executeUserTradeImmediate']('BUY', 0, now).fill.ok
    && snapshot(mixed) === before, 'invalid-fill/zero-additional-volume');

  useTokenStore.getState().addToken(mixed.meta, mixed.getRuntime());
  publishRegistryFeed(new Map([[mixed.meta.id, mixed]]));
  near('integrity', useTokenStore.getState().tokensById[mixed.meta.id].vol5mUsd,
    mixed.getRuntime().vol5mUsd, 'published/runtime-volume');
  near('integrity', useTokenStore.getState().marketByTokenId[mixed.meta.id].recentTrades
    .reduce((sum, row) => sum + row.notionalUsd, 0), mixed.getRuntime().vol5mUsd, 'published/tape-volume');
  // Compare bases on one fixed execution trace, without compensating production flow.
  const marketStats = mixed['statWindow'].map((row) => ({ ...row }));
  const marketStrength = mixed['getFlowStrength']();
  const marketActivity = mixed['getSyntheticTradeActivityFactor']();
  for (let i = 0; i < expected.length; i++) mixed['statWindow'][i]!.volUsd = expected[i]!.legacyVolume!;
  const legacyStrength = mixed['getFlowStrength']();
  const legacyActivity = mixed['getSyntheticTradeActivityFactor']();
  mixed['statWindow'] = marketStats;
  check('model', marketStrength !== legacyStrength && marketActivity !== legacyActivity,
    'market-basis/changes-model-input');
  traces.push({ label: 'feedback-experiment', legacyStrength, marketStrength, legacyActivity, marketActivity });


  const capped = create('exhaustion-refund');
  capped['curveRealToken'] = 10_000_000;
  registry['tokens'].set(capped.meta.id, capped);
  useTokenStore.getState().addToken(capped.meta, capped.getRuntime());
  useWalletStore.setState({ solBalance: 1_000 });
  fixture(useTradingStore.getState().quickBuy(capped.meta.id, 3, { slippagePct: 0 }).ok, 'capped pending BUY');
  const reserved = Object.values(useTradingStore.getState().pendingQuickOrdersById)
    .find((p) => p.tokenId === capped.meta.id);
  fixture(reserved !== undefined, 'capped reservation');
  now = reserved.execMs;
  capped['processPendingUserTrades'](now);
  const cappedNotices = capped.drainUserTradeExecutions();
  fixture(cappedNotices.length === 1 && cappedNotices[0]!.status === 'FILLED', 'capped fill');
  const cappedFill = cappedNotices[0].fill;
  const usedNet = 1_000 * 10_000_000 / 90_000_000;
  near('integrity', cappedFill.filledUsd, usedNet / feeFactor, 'capped/charged-only-used-gross');
  registry['executions'].process(capped.meta.id, capped, cappedNotices);
  near('integrity', useWalletStore.getState().solBalance,
    1_000 - usedNet / feeFactor / SOL_PRICE_USD - reserved.txCostSol, 'capped/refund-unused-budget');
  near('integrity', useTradingStore.getState().quickPositionsByTokenId[capped.meta.id].costBasisUsd,
    usedNet / feeFactor, 'capped/position-keeps-wallet-cost');
  near('integrity', useTradingStore.getState().quickTradesByTokenId[capped.meta.id][0]!.notionalUsd,
    usedNet / feeFactor, 'capped/your-trades-keeps-wallet-cost');
  verifyProjection(capped, [{ tMs: cappedFill.tsMs, quote: usedNet }], 'capped/settled');
  registry['tokens'].delete(capped.meta.id);

  const roundTrip = create('wallet-round-trip');
  registry['tokens'].set(roundTrip.meta.id, roundTrip);
  useTokenStore.getState().addToken(roundTrip.meta, roundTrip.getRuntime());
  useWalletStore.setState({ solBalance: 1_000, realizedPnlSol: 0 });
  let paidUsd = 0;
  let boughtTokens = 0;
  let transactionCosts = 0;
  for (const side of ['BUY', 'SELL'] as const) {
    const submit = side === 'BUY'
      ? useTradingStore.getState().quickBuy(roundTrip.meta.id, 0.1, { slippagePct: 100 })
      : useTradingStore.getState().quickSell(roundTrip.meta.id, 0.05, { slippagePct: 100 });
    fixture(submit.ok, `round-trip/${side}/submit`);
    const order = Object.values(useTradingStore.getState().pendingQuickOrdersById)
      .find((p) => p.tokenId === roundTrip.meta.id);
    fixture(order !== undefined, `round-trip/${side}/pending`);
    now = order.execMs;
    roundTrip['processPendingUserTrades'](now);
    const executions = roundTrip.drainUserTradeExecutions();
    fixture(executions.length === 1 && executions[0]!.status === 'FILLED', `round-trip/${side}/fill`);
    const fill = executions[0].fill;
    transactionCosts += order.txCostSol;
    registry['executions'].process(roundTrip.meta.id, roundTrip, executions);
    const position = useTradingStore.getState().quickPositionsByTokenId[roundTrip.meta.id];
    const trades = useTradingStore.getState().quickTradesByTokenId[roundTrip.meta.id];
    near('settlement', trades[trades.length - 1]!.notionalUsd, fill.filledUsd, `${side}/Your-Trades-wallet-basis`);
    near('settlement', trades[trades.length - 1]!.feeUsd, fill.feeUsd, `${side}/Your-Trades-fee`);
    if (side === 'BUY') {
      paidUsd = fill.filledUsd;
      boughtTokens = fill.filledToken;
      near('settlement', position.costBasisUsd, paidUsd, 'BUY/cost-is-gross-wallet');
      near('settlement', useWalletStore.getState().solBalance,
        1_000 - fill.filledSol - transactionCosts, 'BUY/wallet-settlement');
    } else {
      const soldCost = paidUsd * fill.filledToken / boughtTokens;
      near('settlement', position.costBasisUsd, paidUsd - soldCost, 'SELL/remaining-cost');
      near('settlement', position.realizedPnlUsd, fill.filledUsd - soldCost, 'SELL/PnL-net-proceeds');
      near('settlement', useWalletStore.getState().realizedPnlSol,
        (fill.filledUsd - soldCost) / SOL_PRICE_USD, 'SELL/wallet-PnL');
      near('settlement', useWalletStore.getState().solBalance,
        1_000 - paidUsd / SOL_PRICE_USD + fill.filledSol - transactionCosts, 'SELL/wallet-settlement');
    }
  }
  registry['tokens'].delete(roundTrip.meta.id);

  // Real pending-order failure and refund, after another trade worsens the quote.
  const failed = create('failed-refund');
  registry['tokens'].set(failed.meta.id, failed);
  useTokenStore.getState().addToken(failed.meta, failed.getRuntime());
  useWalletStore.setState({ solBalance: 1_000 });
  fixture(useTradingStore.getState().quickBuy(failed.meta.id, 0.1, { slippagePct: 0 }).ok, 'pending BUY');
  const pending = Object.values(useTradingStore.getState().pendingQuickOrdersById)
    .find((p) => p.tokenId === failed.meta.id);
  fixture(pending !== undefined, 'reserved BUY');
  fixture(failed['executeSimBuyTrade'](100, now), 'worsen pending price');
  const beforeFailed = snapshot(failed);
  now = pending.execMs;
  failed['processPendingUserTrades'](now);
  const notices = failed.drainUserTradeExecutions();
  fixture(notices.length === 1 && notices[0]!.status === 'FAILED', 'slippage FAILED');
  check('integrity', snapshot(failed) === beforeFailed, 'FAILED/zero-additional-volume');
  registry['executions'].process(failed.meta.id, failed, notices);
  near('integrity', useWalletStore.getState().solBalance, 1_000 - pending.txCostSol, 'FAILED/refund-excludes-tx-cost');
  check('integrity', !useTradingStore.getState().pendingQuickOrdersById[pending.orderId], 'FAILED/pending-cleared');
  registry['tokens'].delete(failed.meta.id);
} finally {
  Date.now = originalNow;
  Math.random = originalRandom;
}
console.log(`ECONOMICS ${JSON.stringify(singleSwapEconomics)}`);
console.log(`TRACES ${JSON.stringify(traces)}`);
for (const failure of failures) console.error(`FAIL ${failure.group}/${failure.label}`);
for (const group of ['integrity', 'candidate', 'model', 'wallet', 'settlement'] as const) {
  const failed = failures.filter((f) => f.group === group).length;
  console.log(`Volume basis ${group}: ${counts[group] - failed}/${counts[group]} passed; ${failed} discrepancies`);
}
if (failures.length) throw new Error(`Volume basis diagnostic: ${failures.length} discrepancies (not a CI gate)`);
