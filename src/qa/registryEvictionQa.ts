import { usePostStore } from '../store/postStore';
import { useTokenStore } from '../store/tokenStore';
import { useTradingStore, type QuickLimitOrder, type QuickPosition } from '../store/tradingStore';
import { TokenRegistry } from '../tokens/registry';
import {
  collectProtectedTokenIds,
  isHeldQuantity,
  MAX_REGISTRY_TOKENS,
  planEvictions,
  type EvictionCandidate,
} from '../tokens/registryEviction';
import type { TokenSim } from '../tokens/tokenSim';

// Eviction may drop dormant births. It must not drop a held, ordered, or selected token.
const failures: string[] = [];
let checks = 0;

function check(condition: boolean, label: string): void {
  checks += 1;
  if (!condition) failures.push(label);
}

function candidate(id: string, ageMs: number, overrides: Partial<EvictionCandidate> = {}): EvictionCandidate {
  return {
    id,
    ageMs,
    phase: 'NEW',
    bondingCurvePct: 1,
    dormant: true,
    finalStretch: false,
    ...overrides,
  };
}

function runPurePlan(): void {
  const tokens: EvictionCandidate[] = [];
  for (let i = 0; i < 80; i++) {
    tokens.push(candidate(`old-${i}`, 10 * 60_000 + i));
  }
  for (let i = 0; i < 10; i++) {
    tokens.push(candidate(`new-${i}`, i * 100, { dormant: false }));
  }
  tokens.push(candidate('held', 30 * 60_000));
  tokens.push(candidate('ordered', 30 * 60_000));
  tokens.push(candidate('selected', 30 * 60_000));
  tokens.push(candidate('migrated', 40 * 60_000, { phase: 'MIGRATED', dormant: true }));
  tokens.push(candidate('final', 20 * 60_000, { finalStretch: true, bondingCurvePct: 90, dormant: true }));

  const protectedIds = collectProtectedTokenIds({
    activeTokenId: 'selected',
    positionQtyByTokenId: { held: 12, flat: 0 },
    openOrderTokenIds: ['ordered'],
    simPendingTokenIds: [],
  });
  check(protectedIds.has('held') && protectedIds.has('ordered') && protectedIds.has('selected'), 'protect/ids');
  check(!protectedIds.has('flat'), 'protect/flat-qty-not-held');
  check(!isHeldQuantity(0) && isHeldQuantity(0.01), 'protect/qty-threshold');

  const evict = new Set(planEvictions(tokens, protectedIds));
  check(!evict.has('held'), 'plan/keeps-position');
  check(!evict.has('ordered'), 'plan/keeps-open-order');
  check(!evict.has('selected'), 'plan/keeps-selected');
  check(!evict.has('migrated'), 'plan/keeps-migrated');
  check(!evict.has('final'), 'plan/keeps-final');
  check(!evict.has('new-0'), 'plan/keeps-newest');
  check(evict.has('old-70'), 'plan/drops-old-dormant');
  const survivors = tokens.length - evict.size;
  check(survivors <= MAX_REGISTRY_TOKENS, `plan/under-cap survivors=${survivors}`);
  console.log(`eviction plan: drop ${evict.size}, keep ${survivors}`);
}

function resetStores(): void {
  useTokenStore.setState({
    tokensById: {},
    eventsByTokenId: {},
    marketByTokenId: {},
    tradeFlowByTokenId: {},
    activeTokenId: null,
  });
  useTradingStore.setState({
    quickPositionsByTokenId: {},
    quickLimitOrdersById: {},
    pendingQuickOrdersById: {},
  });
  usePostStore.setState({ postsByTokenId: {} });
}

function dormantUnpinned(registry: TokenRegistry): TokenSim[] {
  const out: TokenSim[] = [];
  registry.forEachToken((sim) => {
    const runtime = sim.getRuntime();
    if (!sim.isDormant()) return;
    if (runtime.phase === 'MIGRATED') return;
    if (runtime.bondingCurvePct >= 80 && runtime.phase !== 'DEAD') return;
    out.push(sim);
  });
  return out;
}

function runRegistryPins(): void {
  const previous = Date.now;
  let now = Date.UTC(2026, 9, 15, 19, 0, 0);
  Date.now = () => now;
  const registry = new TokenRegistry();
  try {
    registry.beginHeadless();
    let pool = dormantUnpinned(registry);
    if (pool.length < 4) {
      for (let i = 0; i < 30; i++) {
        now += 1_000;
        registry.advance(1_000);
      }
      pool = dormantUnpinned(registry);
    }
    check(pool.length >= 4, `registry/dormant-pool n=${pool.length}`);
    if (pool.length < 4) return;

    const held = pool[0]!.meta.id;
    const ordered = pool[1]!.meta.id;
    const selected = pool[2]!.meta.id;
    const control = pool[3]!.meta.id;
    const position: QuickPosition = {
      tokenId: held,
      qty: 1_000,
      avgEntryUsd: 0.00001,
      costBasisUsd: 1,
      boughtUsd: 1,
      soldUsd: 0,
      realizedPnlUsd: 0,
      updatedAtMs: now,
    };
    const limit: QuickLimitOrder = {
      id: 'lim-pin',
      tokenId: ordered,
      side: 'buy',
      limitPriceUsd: 1,
      amountSol: 0.1,
      tokenQty: 0,
      reservedSol: 0.1,
      txCostSol: 0,
      slippageBps: 100,
      prioritySol: 0,
      bribeSol: 0,
      status: 'open',
      createdAtMs: now,
    };
    useTradingStore.setState({
      quickPositionsByTokenId: { [held]: position },
      quickLimitOrdersById: { [limit.id]: limit },
    });
    useTokenStore.getState().setActiveToken(selected);

    let maxSize = registry.size;
    for (let i = 0; i < 4 * 60; i++) {
      now += 1_000;
      registry.advance(1_000);
      if (registry.size > maxSize) maxSize = registry.size;
    }

    check(registry.hasToken(held), 'registry/keeps-position');
    check(registry.hasToken(ordered), 'registry/keeps-open-order');
    check(registry.hasToken(selected), 'registry/keeps-selected');
    check(!registry.hasToken(control), 'registry/evicts-unpinned-dormant');
    check(useTokenStore.getState().tokensById[held] != null, 'store/keeps-position');
    check(useTokenStore.getState().tokensById[control] == null, 'store/drops-evicted');
    check(maxSize <= MAX_REGISTRY_TOKENS, `registry/size-cap max=${maxSize}`);
    check(registry.freshSpawnCount > 100, `registry/flood spawned=${registry.freshSpawnCount}`);
    console.log(
      `registry pins: spawned ${registry.freshSpawnCount}, max size ${maxSize}, final size ${registry.size}, control evicted=${!registry.hasToken(control)}`,
    );
  } finally {
    registry.stop();
    Date.now = previous;
    resetStores();
  }
}

runPurePlan();
runRegistryPins();

for (const failure of failures) console.error(`FAIL ${failure}`);
console.log(`Eviction QA: ${checks - failures.length}/${checks} checks passed`);
if (failures.length > 0) {
  throw new Error(`Eviction QA: ${failures.length} failures`);
}
