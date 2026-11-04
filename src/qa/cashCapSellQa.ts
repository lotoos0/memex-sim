import { RNG } from '../engine/rng';
import { TokenSim } from '../tokens/tokenSim';
import { generateToken, getFateTimeoutSimMs, getStartingMcapUsd } from '../tokens/generator';
import type { TokenFate } from '../tokens/types';

// Diagnostic only. Observers call the original execution methods unmodified.
type State = ReturnType<TokenSim['getCurveDebugSnapshot']>;
type Tier = 'public' | 'private' | 'forced';
type Swap = { side: 'BUY' | 'SELL'; requested: number; tokens: number; quote: number;
  gross: number; capped: boolean; before: State; after: State };
const results: Array<{ label: string; tier: Tier; swaps: number; successful: number; caps: number;
  maxStepKRelative: number; maxTotalKRelative: number; minimumMargin: number | null;
  initialRealQuote: number; reachedExhaustion: boolean; retainedSellFees: number; finalPhase: string }> = [];
const failures: string[] = [];
let checks = 0;
let controlChecks = 0;
let controlFailures = 0;
let now = 1_800_000_000_000;
const f = 0.99;
const roundoff = 64 * Number.EPSILON;
const archetypes = new Set<string>();
const phases = new Set<string>();
function check(condition: boolean, label: string, control = false): void {
  if (control) controlChecks++;
  else checks++;
  if (condition) return;
  if (control) controlFailures++;
  failures.push(`${control ? 'control-guard' : 'invariant'}/${label}`);
}
function near(a: number, b: number, tolerance: number, label: string): void {
  check(Number.isFinite(a) && Math.abs(a - b) <= tolerance, `${label}: actual=${a}, expected=${b}, tol=${tolerance}`);
}
function create(seed: number, fate: TokenFate, start?: number): TokenSim {
  const rng = new RNG(`cash-cap-${seed}-${fate}-${start ?? 'spawn'}`);
  const meta = generateToken(rng, 0, fate);
  const sim = new TokenSim(meta, start ?? getStartingMcapUsd(fate, rng), getFateTimeoutSimMs(fate, rng));
  archetypes.add(sim['archetype']);
  return sim;
}
function observe(sim: TokenSim, label: string, tier: Tier) {
  const initial = sim.getCurveDebugSnapshot();
  const actions: unknown[] = [];
  const swaps: Swap[] = [];
  let sellFees = 0;
  let caps = 0;
  let successful = 0;
  let maxStepKRelative = 0;
  let maxTotalKRelative = 0;
  let minimumMargin = Infinity;
  const buy = sim['executeCurveBuy'].bind(sim);
  const sell = sim['executeCurveSell'].bind(sim);
  function record(side: Swap['side'], requested: number, tokens: number, quote: number, before: State, after: State): void {
    const inventory = before.rTok0 - before.rTok;
    const allowed = Math.min(requested, inventory);
    const gross = side === 'SELL' && allowed > 0
      ? before.vBase - before.vBase * before.vTok / (before.vTok + allowed) : 0;
    const capped = side === 'SELL' && gross * f > before.rBase;
    const row: Swap = { side, requested, tokens, quote, gross, capped, before, after };
    swaps.push(row);
    if (capped) {
      caps++;
      // Retain the complete command prefix and swap states if an unforced hit appears.
      console.log(`CASH_CAP_REPRO ${JSON.stringify({ label, tier, initial, actions, swaps })}`);
    }
    if (tier === 'forced') {
      check(tokens === 0 && quote === 0, 'cash-cap/rejected-output', true);
      check(JSON.stringify(before) === JSON.stringify(after), 'cash-cap/no-reserve-mutation', true);
      return;
    }
    if (tokens <= 0) {
      check(JSON.stringify(before) === JSON.stringify(after), `${label}/failed-helper-no-reserve-mutation`);
      return;
    }
    successful++;
    const kStep = Math.abs(after.k - before.k) / Math.max(1, Math.abs(before.k));
    const kTotal = Math.abs(after.k - initial.k) / Math.max(1, Math.abs(initial.k));
    maxStepKRelative = Math.max(maxStepKRelative, kStep);
    maxTotalKRelative = Math.max(maxTotalKRelative, kTotal);
    if (side === 'SELL') sellFees += (before.vBase - after.vBase) - quote;
    const tokenTolerance = roundoff * Math.max(1, swaps.length) * Math.max(initial.vTok, initial.rTok0);
    const quoteTolerance = roundoff * Math.max(1, swaps.length)
      * Math.max(initial.vBase, before.vBase, after.vBase, initial.rBase, after.rBase, 1);
    const allTokens = after.rTok0 - after.rTok;
    const maximumNetRedemption = after.vBase * allTokens / (after.vTok + allTokens) * f;
    const margin = after.rBase - maximumNetRedemption;
    minimumMargin = Math.min(minimumMargin, margin);
    check(!capped, `${label}/no-cash-cap`);
    check(kStep <= roundoff, `${label}/step-K-drift=${kStep}`);
    check(kTotal <= roundoff * Math.max(1, swaps.length), `${label}/cumulative-K-drift=${kTotal}`);
    near(after.vTok - after.rTok, initial.vTok - initial.rTok, tokenTolerance, `${label}/virtual-real-token-offset`);
    near(after.rBase - after.vBase, initial.rBase - initial.vBase + sellFees, quoteTolerance,
      `${label}/quote-offset-plus-retained-fees`);
    check(after.rTok >= -tokenTolerance && after.rTok <= initial.rTok0 + tokenTolerance,
      `${label}/pool-inventory-bounds`);
    check(margin >= initial.rBase - quoteTolerance, `${label}/full-redemption-covered: margin=${margin}`);
    near(Math.abs(after.rTok - before.rTok), tokens, tokenTolerance, `${label}/executed-pool-token-quantity`);
    near(Math.abs(after.vTok - before.vTok), tokens, tokenTolerance, `${label}/executed-virtual-token-quantity`);
    if (side === 'SELL') {
      check(tokens <= inventory + tokenTolerance, `${label}/SELL-no-more-than-issued`);
      near(quote, before.rBase - after.rBase, quoteTolerance, `${label}/actual-net-payout`);
      near(quote, gross * f, quoteTolerance, `${label}/net-output-with-fee`);
    } else {
      near(quote, after.rBase - before.rBase, quoteTolerance, `${label}/actual-net-input`);
    }
  }
  sim['executeCurveBuy'] = (amount) => {
    const before = sim.getCurveDebugSnapshot();
    const result = buy(amount);
    record('BUY', amount, result.tokensOut, result.baseInUsd, before, sim.getCurveDebugSnapshot());
    return result;
  };
  sim['executeCurveSell'] = (amount) => {
    const before = sim.getCurveDebugSnapshot();
    const result = sell(amount);
    record('SELL', amount, result.tokenIn, result.baseOutUsd, before, sim.getCurveDebugSnapshot());
    return result;
  };
  return {
    actions,
    swaps,
    inventory() {
      const state = sim.getCurveDebugSnapshot();
      if (!state.hasMigrated) {
        const held = [...sim['ledger'].values()].reduce((sum, value) => sum + value, 0);
        // Wallet dust <= 1e-6 may be removed while pool inventory retains it.
        const tolerance = 1e-6 * swaps.length + roundoff * Math.max(1, swaps.length) * initial.vTok;
        near(held, state.rTok0 - state.rTok, tolerance, `${label}/holder-inventory-vs-issued`);
      }
      phases.add(sim.getPhase());
    },
    finish() {
      results.push({ label, tier, swaps: swaps.length, successful, caps,
        maxStepKRelative, maxTotalKRelative, minimumMargin: Number.isFinite(minimumMargin) ? minimumMargin : null,
        initialRealQuote: initial.rBase, reachedExhaustion: swaps.some((row) => row.side === 'BUY' && row.after.rTok <= 1e-6),
        retainedSellFees: sellFees, finalPhase: sim.getPhase() });
      return { caps, successful };
    },
  };
}
function submitAndTick(sim: TokenSim, audit: ReturnType<typeof observe>, side: 'BUY' | 'SELL', amount: number): void {
  const submitted = sim.submitUserTrade({ side, amountIn: amount, slippageBps: 10_000, latencyMs: 100 });
  audit.actions.push({ submit: { side, amount }, result: submitted });
  if (!submitted.ok) return;
  now = Math.max(now + 200, submitted.execMs);
  audit.actions.push({ tick: now, dt: 0.2, session: 'OFF' });
  sim.tick(0.2, 'OFF');
  sim.drainUserTradeExecutions();
  audit.inventory();
}

const originalNow = Date.now;
try {
  Date.now = () => now;
  // Public TokenSim API, including genesis flow, pending orders and lifecycle.
  const fates: TokenFate[] = ['QUICK_RUG', 'SHORT', 'NORMAL', 'LONG_RUNNER'];
  for (let seed = 0; seed < 32; seed++) for (const fate of fates) {
    const sim = create(seed, fate);
    const audit = observe(sim, `public/lifecycle/${seed}/${fate}`, 'public');
    check(sim['tape'].length === 0 && sim.getCandles(1)[0]!.volume === 0, 'genesis/no-unbacked-tokens-or-volume');
    submitAndTick(sim, audit, 'BUY', 0.1);
    const owned = sim['ledger'].get('you') ?? 0;
    if (!sim.getCurveDebugSnapshot().hasMigrated && owned > 0) submitAndTick(sim, audit, 'SELL', owned);
    for (let step = 0; step < 500 && !sim.getCurveDebugSnapshot().hasMigrated; step++) {
      if (step % 50 === 0) {
        const balance = sim['ledger'].get('you') ?? 0;
        submitAndTick(sim, audit, balance > 0 ? 'SELL' : 'BUY', balance > 0 ? balance : 0.05);
      } else {
        now += 200;
        audit.actions.push({ tick: now, dt: 0.2, session: 'OFF' });
        sim.tick(0.2, 'OFF');
        audit.inventory();
      }
    }
    audit.finish();
  }
  // Public exhaustion may migrate immediately; a later migrated SELL is not curve evidence.
  for (let seed = 0; seed < 16; seed++) {
    const sim = create(seed + 100, 'NORMAL');
    const audit = observe(sim, `public/exhaustion/${seed}`, 'public');
    const state = sim.getCurveDebugSnapshot();
    const net = state.vBase * state.rTok / (state.vTok - state.rTok);
    submitAndTick(sim, audit, 'BUY', Math.min(100, net * 2 / f / 150));
    if (!sim.getCurveDebugSnapshot().hasMigrated) {
      const balance = sim['ledger'].get('you') ?? 0;
      if (balance > 0) submitAndTick(sim, audit, 'SELL', balance);
    }
    audit.finish();
  }
  // Private curve helpers: real initialized reserves, no writes or fake replenishment.
  for (let seed = 0; seed < 16; seed++) for (const start of [2_000, 5_000, 10_000]) {
    for (const scenario of ['round-trips', 'split-sells', 'exhaustion', 'alternating', 'tiny'] as const) {
      const sim = create(seed + 200, 'NORMAL', start);
      const audit = observe(sim, `private/${scenario}/${seed}/${start}`, 'private');
      const rng = new RNG(`sequence-${seed}`);
      const initial = sim.getCurveDebugSnapshot();
      const buy = (gross: number) => {
        audit.actions.push({ helper: 'executeCurveBuy', gross });
        sim['executeCurveBuy'](gross);
      };
      const sell = (tokens: number) => {
        audit.actions.push({ helper: 'executeCurveSell', tokens });
        const quoted = sim['estimateCurveSellOut'](tokens);
        const result = sim['executeCurveSell'](tokens);
        near(result.tokenIn, quoted.tokenIn, 1e-6, 'private/quote-fill-tokens');
        near(result.baseOutUsd, quoted.baseOutUsd, 1e-8, 'private/quote-fill-output');
      };
      if (scenario === 'exhaustion' || scenario === 'split-sells') {
        const requiredNet = initial.vBase * initial.rTok / (initial.vTok - initial.rTok);
        buy(requiredNet / f * (scenario === 'exhaustion' ? 3 : 0.8));
        if (scenario === 'exhaustion') near(sim.getCurveDebugSnapshot().rTok, 0, 1e-6, 'private/exhaustion-achieved');
        for (let step = 0; step < 20; step++) {
          const state = sim.getCurveDebugSnapshot();
          sell((state.rTok0 - state.rTok) / (20 - step));
        }
      } else {
        const count = scenario === 'alternating' ? 1_000 : 100;
        for (let step = 0; step < count; step++) {
          buy(scenario === 'tiny' ? 1e-8 : initial.vBase * (0.0001 + rng.next() * 0.02));
          const state = sim.getCurveDebugSnapshot();
          sell((state.rTok0 - state.rTok) * (scenario === 'round-trips' ? 1 : 0.1 + rng.next() * 0.9));
        }
      }
      audit.finish();
    }
  }
  // The existing forced cash-cap state is a separate positive control, never reachability evidence.
  const forced = create(999, 'NORMAL', 10_000);
  forced['curveVirtualBase'] = 1_000;
  forced['curveVirtualToken'] = 100_000_000;
  forced['curveInitialRealToken'] = 100_000_000;
  forced['curveRealToken'] = 90_000_000;
  forced['curveRealBase'] = 1;
  const audit = observe(forced, 'forced/cash-cap', 'forced');
  const before = forced.getCurveDebugSnapshot();
  const estimate = forced['estimateCurveSellOut'](1_000_000);
  check(estimate.tokenIn === 0 && estimate.baseOutUsd === 0, 'control/estimate-rejected');
  check(JSON.stringify(before) === JSON.stringify(forced.getCurveDebugSnapshot()), 'control/estimate-no-mutation');
  audit.actions.push({ helper: 'executeCurveSell', tokens: 1_000_000 });
  const result = forced['executeCurveSell'](1_000_000);
  check(result.tokenIn === estimate.tokenIn && result.baseOutUsd === estimate.baseOutUsd, 'control/estimate-execution-agree');
  check(audit.finish().caps === 1, 'control/observer-detects-cap');
  check(archetypes.size === 4, `coverage/all-archetypes: ${[...archetypes]}`);
} finally {
  Date.now = originalNow;
}
// Keep default output below pipe buffers so diagnostic exceptions do not lose summaries.
const groups = new Map<string, typeof results>();
for (const row of results) {
  const parts = row.label.split('/');
  const key = row.tier === 'private' ? `${parts[0]}/${parts[1]}/${parts[3]}` : `${parts[0]}/${parts[1]}`;
  const group = groups.get(key) ?? [];
  group.push(row);
  groups.set(key, group);
}
console.log(`SCENARIOS ${JSON.stringify([...groups].map(([label, rows]) => ({
  label, tier: rows[0]!.tier, scenarios: rows.length,
  swaps: rows.reduce((sum, row) => sum + row.swaps, 0),
  successful: rows.reduce((sum, row) => sum + row.successful, 0),
  caps: rows.reduce((sum, row) => sum + row.caps, 0),
  exhaustion: rows.filter((row) => row.reachedExhaustion).length,
  maxStepKRelative: Math.max(...rows.map((row) => row.maxStepKRelative)),
  maxTotalKRelative: Math.max(...rows.map((row) => row.maxTotalKRelative)),
  minimumMargin: Math.min(...rows.map((row) => row.minimumMargin ?? Infinity)),
})))}`);
console.log(`COVERAGE ${JSON.stringify({ archetypes: [...archetypes], phases: [...phases] })}`);
for (const failure of failures) console.error(`FAIL ${failure}`);
console.log(`Cash-cap reachability: ${checks - (failures.length - controlFailures)}/${checks} invariant checks passed`);
console.log(`Forced guard policy: ${controlChecks - controlFailures}/${controlChecks} passed; ${controlFailures} diagnostic discrepancies`);
if (failures.length) throw new Error(`Cash-cap diagnostic: ${failures.length} discrepancies (not a CI gate)`);
