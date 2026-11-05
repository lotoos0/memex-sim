import { capPulseColumn, pulseColumnCandidates } from '../components/pulse/pulseColumns';
import { sortPulseTokensForBucket } from '../components/pulse/pulseSorts';
import { publishRegistryFeed } from '../tokens/registryFeedPublisher';
import { TokenSim } from '../tokens/tokenSim';
import { tradeFlowFromTrades, useTokenStore, TRADE_FLOW_WINDOW_MS } from '../store/tokenStore';
import { SUPPLY, type TokenMeta, type TokenState } from '../tokens/types';

// Rolling 60s flow must age out without a new holder snapshot, and Pulse caps
// apply after filter and sort so a later row can still reach the column.
const failures: string[] = [];
let checks = 0;

function check(condition: boolean, label: string): void {
  checks += 1;
  if (!condition) failures.push(label);
}

function runFlowWindow(): void {
  const trades = [
    { tMs: 1_000, side: 'BUY' as const },
    { tMs: 40_000, side: 'SELL' as const },
  ];
  const atStart = tradeFlowFromTrades(trades, 50_000);
  check(atStart.flow.buys60s === 1 && atStart.flow.sells60s === 1 && atStart.flow.tx60s === 2, `flow/both ${JSON.stringify(atStart.flow)}`);
  check(atStart.nextExpiryMs === 1_000 + TRADE_FLOW_WINDOW_MS, `flow/next-expiry ${atStart.nextExpiryMs}`);

  const afterFirst = tradeFlowFromTrades(trades, atStart.nextExpiryMs + 1);
  check(afterFirst.flow.buys60s === 0 && afterFirst.flow.sells60s === 1 && afterFirst.flow.tx60s === 1, `flow/first-aged ${JSON.stringify(afterFirst.flow)}`);
  check(afterFirst.nextExpiryMs === 40_000 + TRADE_FLOW_WINDOW_MS, `flow/second-expiry ${afterFirst.nextExpiryMs}`);

  const afterLast = tradeFlowFromTrades(trades, afterFirst.nextExpiryMs + 1);
  check(afterLast.flow.tx60s === 0 && afterLast.flow.buys60s === 0 && afterLast.flow.sells60s === 0, `flow/empty ${JSON.stringify(afterLast.flow)}`);
  check(afterLast.nextExpiryMs === Number.POSITIVE_INFINITY, 'flow/no-further-expiry');
  console.log('trade flow window: 2 -> 1 -> 0');
}

function meta(): TokenMeta {
  return {
    id: 'tok_flow_age',
    name: 'Flow',
    ticker: 'FLOW',
    logoColor: '#ffffff',
    imageUrl: null,
    supply: SUPPLY,
    createdAtSimMs: 0,
    fate: 'SHORT',
    metrics: {
      topHoldersPct: 10,
      devHoldingsPct: 1,
      snipersPct: 1,
      lpBurnedPct: 100,
      insidersPct: 1,
      bundlersPct: 1,
    },
  };
}

function runPublisherAgesFlow(): void {
  const previous = Date.now;
  let now = Date.UTC(2026, 9, 15, 12, 0, 0);
  Date.now = () => now;
  const sim = new TokenSim(meta(), 2_000, 60 * 60_000);
  sim.markStillbornLaunch();
  sim.enableDormantFastPath();
  const tokens = new Map([[sim.meta.id, sim]]);
  try {
    // Stillborn coins no longer print a dev buy. The flow window still needs one
    // tape row, so the fixture places its own fill and stays dormant afterward.
    const submitted = sim.submitUserTrade({ side: 'BUY', amountIn: 0.1, slippageBps: 10_000, latencyMs: 100 });
    check(submitted.ok, `publish/user-buy ${submitted.ok ? 'ok' : submitted.reason}`);
    if (submitted.ok) now = submitted.execMs;
    sim.tick(0.2, 'OFF');
    check(sim.getLaunchAudit().stillborn && sim.isDormant(), `publish/still-dormant stillborn=${sim.getLaunchAudit().stillborn} dormant=${sim.isDormant()}`);
    useTokenStore.getState().addToken(sim.meta, sim.getRuntime());
    publishRegistryFeed(tokens);
    const store = useTokenStore.getState();
    const snapshot = store.marketByTokenId[sim.meta.id];
    const flow = store.tradeFlowByTokenId[sim.meta.id];
    check(snapshot != null && (flow?.tx60s ?? 0) >= 1, `publish/has-flow tx=${flow?.tx60s ?? 0}`);
    const recentTrades = snapshot?.recentTrades ?? [];
    check(recentTrades.length > 0, `publish/has-trades n=${recentTrades.length}`);

    const publishedAt = snapshot?.updatedAtMs;
    const oldestMs = recentTrades.reduce((min, trade) => Math.min(min, trade.tMs), now);
    now = oldestMs + 30_000;
    publishRegistryFeed(tokens);
    const mid = useTokenStore.getState();
    check((mid.tradeFlowByTokenId[sim.meta.id]?.tx60s ?? 0) >= 1, `publish/still-inside tx=${mid.tradeFlowByTokenId[sim.meta.id]?.tx60s ?? 0}`);
    check(mid.marketByTokenId[sim.meta.id]?.updatedAtMs === publishedAt, 'publish/snapshot-held-at-30s');

    now = oldestMs + TRADE_FLOW_WINDOW_MS + 5;
    publishRegistryFeed(tokens);
    const late = useTokenStore.getState();
    const lateFlow = late.tradeFlowByTokenId[sim.meta.id];
    check(lateFlow?.tx60s === 0 && lateFlow.buys60s === 0 && lateFlow.sells60s === 0, `publish/aged-out ${JSON.stringify(lateFlow)}`);
    check(late.marketByTokenId[sim.meta.id]?.updatedAtMs === publishedAt, 'publish/snapshot-held-after-expiry');
    console.log(`publisher flow: start ${flow?.tx60s ?? 0}, aged out, snapshot stayed at ${publishedAt}`);
  } finally {
    Date.now = previous;
    useTokenStore.setState({
      tokensById: {},
      eventsByTokenId: {},
      marketByTokenId: {},
      tradeFlowByTokenId: {},
      activeTokenId: null,
    });
  }
}

function token(id: string, phase: TokenState['phase'], mcapUsd: number, vol5mUsd: number, ageMs: number): TokenState {
  return {
    id,
    name: id,
    ticker: id.slice(0, 6),
    logoColor: '#fff',
    imageUrl: null,
    supply: SUPPLY,
    createdAtSimMs: 0,
    simTimeMs: ageMs,
    fate: 'NORMAL',
    phase,
    lastPriceUsd: mcapUsd / SUPPLY,
    mcapUsd,
    liquidityUsd: 1,
    bondingCurvePct: phase === 'MIGRATED' ? 100 : phase === 'FINAL' ? 90 : 1,
    vol5mUsd,
    buys5m: 0,
    sells5m: 0,
    changePct: 0,
    priceAtSpawn: 1,
    ruggedAtSimMs: null,
    metrics: {
      topHoldersPct: 10,
      devHoldingsPct: 1,
      snipersPct: 1,
      lpBurnedPct: 100,
      insidersPct: 1,
      bundlersPct: 1,
    },
  };
}

function runPulseCapAfterFilter(): void {
  const migrated: TokenState[] = [];
  for (let i = 0; i < 24; i++) {
    migrated.push(token(`mig-${i}`, 'MIGRATED', 100_000 - i * 1_000, i, i * 1_000));
  }
  // Highest volume is the lowest mcap, outside a top-20-by-mcap slice.
  migrated.push(token('quiet-match', 'MIGRATED', 4_000, 50_000, 99_000));
  const candidates = pulseColumnCandidates(migrated, 'migrated');
  const slicedFirst = candidates
    .slice()
    .sort((a, b) => b.mcapUsd - a.mcapUsd)
    .slice(0, 20)
    .filter((row) => row.mcapUsd <= 5_000);
  const filtered = candidates.filter((row) => row.mcapUsd <= 5_000);
  const shown = capPulseColumn(sortPulseTokensForBucket(filtered, 'migrated', 'vol', {}), 20);
  check(slicedFirst.length === 0, `pulse/pre-slice-drops-match n=${slicedFirst.length}`);
  check(shown.some((row) => row.id === 'quiet-match'), `pulse/migrated-keeps-match ids=${shown.map((row) => row.id).join(',')}`);
  check(shown[0]?.id === 'quiet-match', 'pulse/vol-sort-puts-match-first');

  const births: TokenState[] = [];
  for (let i = 0; i < 20; i++) births.push(token(`new-${i}`, 'NEW', 3_000, 1, i * 1_000));
  births.push(token('older-active', 'NEW', 3_000, 80_000, 120_000));
  const newestFirst = pulseColumnCandidates(births, 'newPairs')
    .slice()
    .sort((a, b) => a.simTimeMs - b.simTimeMs)
    .slice(0, 20);
  const byFlow = capPulseColumn(
    sortPulseTokensForBucket(pulseColumnCandidates(births, 'newPairs'), 'newPairs', 'vol', {}),
    20,
  );
  check(!newestFirst.some((row) => row.id === 'older-active'), 'pulse/newest-slice-hides-older');
  check(byFlow.some((row) => row.id === 'older-active'), 'pulse/new-pairs-vol-keeps-older');
  console.log(`pulse cap: migrated shown ${shown.length}, new pairs include older-active=${byFlow.some((row) => row.id === 'older-active')}`);
}

runFlowWindow();
runPublisherAgesFlow();
runPulseCapAfterFilter();

for (const failure of failures) console.error(`FAIL ${failure}`);
console.log(`Feed and Pulse QA: ${checks - failures.length}/${checks} checks passed`);
if (failures.length > 0) {
  throw new Error(`Feed and Pulse QA: ${failures.length} failures`);
}
