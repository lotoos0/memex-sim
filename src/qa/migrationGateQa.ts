import { TokenSim, type SimTapeTrade } from '../tokens/tokenSim';
import {
  MIN_MIGRATION_AGE_SEC,
  MIN_MIGRATION_HOLDERS,
  MIN_MIGRATION_REAL_BASE_USD,
  MIN_MIGRATION_READY_PROGRESS,
  MIN_MIGRATION_TX_IN_WINDOW,
} from '../tokens/tokenMarketRegimes';
import { SUPPLY, type TokenFate, type TokenMeta } from '../tokens/types';

// The migration gate is an earned-raise check, not a 60-second print quota.
// Curve completion still latches the handoff; these cases only cover readiness.
const failures: string[] = [];
let checks = 0;

function check(condition: boolean, label: string): void {
  checks += 1;
  if (!condition) failures.push(label);
}

function create(id: string, fate: TokenFate): TokenSim {
  const meta: TokenMeta = {
    id, name: 'Gate', ticker: 'GATE', logoColor: '#ffffff', imageUrl: null,
    supply: SUPPLY, createdAtSimMs: 0, fate,
    metrics: {
      topHoldersPct: 12, devHoldingsPct: 2, snipersPct: 4,
      lpBurnedPct: 100, insidersPct: 1, bundlersPct: 1,
    },
  };
  return new TokenSim(meta, 2_000, 6 * 60 * 60_000);
}

function arm(sim: TokenSim, input: {
  ageSec: number;
  progress: number;
  realBaseUsd: number;
  holders: number;
  trades: number;
  silent?: boolean;
}): boolean {
  const ageMs = input.ageSec * 1000;
  sim['simTimeMs'] = ageMs;
  sim['flowSilentAfterSimMs'] = input.silent ? ageMs - 1_000 : Number.POSITIVE_INFINITY;
  sim['curveRealBase'] = input.realBaseUsd;
  const initial = sim['curveInitialRealToken'] as number;
  sim['curveRealToken'] = initial * (1 - input.progress);
  sim['bondingProgress'] = input.progress;
  sim['ledger'].clear();
  for (let i = 0; i < input.holders; i++) sim['ledger'].set(`h_${i}`, 5_000_000);
  const now = sim['spawnRealMs'] + ageMs;
  const tape = sim['tape'];
  tape.length = 0;
  for (let i = 0; i < input.trades; i++) {
    const row: SimTapeTrade = {
      id: `g${i}`, tMs: now - 2_000, side: 'BUY', walletId: `h_${i % Math.max(1, input.holders)}`,
      tokenAmount: 1, notionalUsd: 20, priceUsd: sim.getLastPriceUsd(), mcapUsd: sim.getLastMcapUsd(),
    };
    tape.push(row);
  }
  return sim['isMigrationRuntimeReady'](now);
}

const earned = {
  ageSec: MIN_MIGRATION_AGE_SEC + 30,
  progress: Math.max(0.86, MIN_MIGRATION_READY_PROGRESS + 0.1),
  realBaseUsd: MIN_MIGRATION_REAL_BASE_USD + 500,
  holders: MIN_MIGRATION_HOLDERS + 2,
  trades: MIN_MIGRATION_TX_IN_WINDOW + 4,
};

let now = 1_700_000_000_000;
const previous = Date.now;
Date.now = () => now;
try {
  const runner = create('gate-runner', 'LONG_RUNNER');
  check(arm(runner, earned), 'long-runner/earned-raise-is-ready');
  check(!arm(runner, { ...earned, ageSec: MIN_MIGRATION_AGE_SEC - 15 }), 'long-runner/too-young');
  check(!arm(runner, { ...earned, progress: MIN_MIGRATION_READY_PROGRESS - 0.05 }), 'long-runner/curve-not-banked');
  check(!arm(runner, { ...earned, realBaseUsd: MIN_MIGRATION_REAL_BASE_USD - 500 }), 'long-runner/quote-not-raised');
  check(!arm(runner, { ...earned, holders: MIN_MIGRATION_HOLDERS - 1 }), 'long-runner/holders-short');
  check(!arm(runner, { ...earned, trades: MIN_MIGRATION_TX_IN_WINDOW - 1 }), 'long-runner/window-quiet');
  check(!arm(runner, { ...earned, silent: true }), 'long-runner/silent-not-ready');

  const rug = create('gate-rug', 'QUICK_RUG');
  check(!arm(rug, earned), 'quick-rug/never-ready');

  const normal = create('gate-normal', 'NORMAL');
  check(arm(normal, earned), 'normal/earned-raise-is-ready');

  // Emptying the real reserve still migrates in the same fill. Readiness does not latch it.
  now += 1_000;
  const handoff = create('gate-handoff', 'LONG_RUNNER');
  handoff['curveRealToken'] = 1_000;
  handoff['curveRealBase'] = 8_000;
  const events: string[] = [];
  const bought = handoff['executeSimBuyTrade'](50_000, now);
  check(bought, 'handoff/buy-filled');
  const snap = handoff.getCurveDebugSnapshot();
  check(snap.rTok === 0 && snap.hasMigrated && snap.phase === 'MIGRATED',
    `handoff/curve-completion-migrates rTok=${snap.rTok} phase=${snap.phase}`);
  void events;
} finally {
  Date.now = previous;
}

for (const failure of failures) console.error(`FAIL ${failure}`);
console.log(`Migration gate QA: ${checks - failures.length}/${checks} checks passed`);
if (failures.length > 0) throw new Error(`Migration gate QA: ${failures.length} failures`);
