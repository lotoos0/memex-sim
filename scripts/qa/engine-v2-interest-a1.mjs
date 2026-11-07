import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { analyze, newResult } from './engine-v2-market-persistence-metrics.mjs';

const baselineDir = resolve(process.argv[2] ?? 'output/engine-v2-real-c-baseline');
const out = resolve(process.argv[3] ?? 'output/engine-v2-interest-a1');
const requestedSeed = process.argv[4];
const baseline = JSON.parse(readFileSync(join(baselineDir, 'v2-runs.json'), 'utf8'));
const [realMetrics] = JSON.parse(readFileSync(join(baselineDir, 'metrics.json'), 'utf8'));
const controls = JSON.parse(readFileSync('output/engine-v2-sell-fee-reserve/summary.json', 'utf8'));
const boundedReference = JSON.parse(readFileSync('output/engine-v2-bounded-reactive/summary.json', 'utf8'));
const realAudit = JSON.parse(readFileSync('output/engine-v2-persistence-audit/summary.json', 'utf8')).real;
const temp = mkdtempSync(join(tmpdir(), 'memex-interest-a1-'));
const json = (value) => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const bump = (bag, key) => { bag[key] = (bag[key] ?? 0) + 1; };
const sampleMinutes = new Set([0, 5, 10, 15, 20, 30, 45, 60, 90]);
const band = (ms) => ms < 120_000 ? 0 : ms < 600_000 ? 1 : ms < 1_200_000 ? 2 : 3;

try {
  const expiredBuyGuard = 'if (tokenInterest && (!agent.known[view.tokenId] || now >= (agent.tokenInterest?.[view.tokenId]?.buyUntil ?? 0))) return null;';
  const bundle = join(temp, 'runner.mjs');
  const built = await build({ stdin: { contents: `
    export { measure } from './src/qa/engineV2Benchmark';
    export { World, DEFAULT_WORLD, BOUNDED_REACTIVE_MS } from './src/engineV2/world';`, resolveDir: process.cwd() },
    platform: 'node', format: 'esm', bundle: true, metafile: true, outfile: bundle,
    plugins: [{ name: 'a1-read-only-diagnostics', setup(builder) {
      builder.onLoad({ filter: /engineV2[\\/]agents\.ts$/ }, ({ path }) => {
        const source = readFileSync(path, 'utf8');
        assert.equal(source.split(expiredBuyGuard).length, 2, 'One explicit BUY-only interest guard');
        return { loader: 'ts', contents: source.replace(expiredBuyGuard,
          expiredBuyGuard.replace('return null;', '{ globalThis.__a1ExpiredBuy(agent, view, now); return null; }')) };
      });
    } }],
  });
  const { measure, World, DEFAULT_WORLD, BOUNDED_REACTIVE_MS } = await import(pathToFileURL(bundle));
  assert.deepEqual(DEFAULT_WORLD, baseline.defaults);
  assert.equal(baseline.variant, 'on');
  assert.deepEqual(baseline.seeds, [...'ABCDEF'].map((letter) => `V2-PILOT-${letter}`));
  assert.ok(requestedSeed === undefined || baseline.seeds.includes(requestedSeed), 'Unknown pilot seed');
  const fingerprints = Object.fromEntries(Object.keys(built.metafile.inputs).filter((path) => path !== '<stdin>')
    .map((path) => [path, hash(readFileSync(path))]));
  let audit;
  globalThis.__a1ExpiredBuy = (agent, view, now) => {
    if (!agent.known[view.tokenId]) audit.a1.exitOnlyBuyWait++;
    else audit.a1.expiredBuyWait++;
    if (Object.values(agent.known).some((item) => item.view.tradable
      && now < (agent.tokenInterest[item.view.tokenId]?.buyUntil ?? 0))) audit.a1.blockedWithInterestedAlternative++;
  };
  const channelKey = (task) => `${task.payload.agentId}:${task.payload.reactive ? 'reactive' : 'periodic'}`;
  const wake = World.prototype.wake;
  World.prototype.wake = function (agent, at, periodic) {
    const count = this.config.boundedReactive && !periodic && agent.ordinal > 0;
    const pending = agent.boundedWake?.reactiveAt;
    const result = wake.call(this, agent, at, periodic);
    if (count) {
      audit.impulses++;
      if (pending != null) audit.coalescedReactive++;
      else if (agent.boundedWake.reactiveAt === null) audit.coalescedPeriodic++;
    }
    return result;
  };
  const processTask = World.prototype.process;
  World.prototype.process = function (event) {
    const { kind, payload, key: { at } } = event;
    const agentId = payload.agentId;
    const actor = agentId ? this.state.agents[agentId] : null;
    const previousLease = kind === 'Observe' ? actor?.tokenInterest?.[payload.market.tokenId]?.buyUntil : undefined;
    const previousInterests = kind === 'Discover' ? Object.fromEntries(Object.entries(actor?.tokenInterest ?? {}).map(([id,v])=>[id,v.buyUntil])) : null;
    const nextPeriodic = actor?.nextAt;
    const ordinal = actor?.ordinal;
    const valid = kind === 'Decide' && (payload.reactive ?
      actor.boundedWake?.reactiveGeneration === payload.generation && actor.boundedWake.reactiveAt === at :
      actor.generation === payload.generation);
    const origin = kind === 'Decide' ? audit.origins.get(event) : null;
    if (kind === 'Decide') {
      assert.ok(origin, 'Every decision task has a recorded scheduling source');
      if (valid) {
        assert.equal(audit.pending.get(channelKey(event)), event);
        audit.pending.delete(channelKey(event));
      }
    }
    const result = processTask.call(this, event);
    if (kind === 'Decide') {
      const committed = this.kernel.staged.find((fact) => fact.kind === 'AgentDecided');
      const collision = valid && payload.reactive && nextPeriodic === at;
      assert.equal(Boolean(committed), valid && !collision);
      bump(committed ? audit.executed : audit.stale, origin);
      if (committed) {
        if (this.config.tokenInterestA1 && committed.payload.decision === 'WAIT') {
          const eligibleKnown = Object.values(actor.known).some((item) => item.view.tradable &&
            (at < (actor.tokenInterest[item.view.tokenId]?.buyUntil ?? 0) || this.ledger.balance(agentId,item.view.tokenId).available > 0n));
          const eligibleExit = Object.entries(actor.tokenInterest ?? {}).some(([id,v]) => !actor.known[id]
            && v.exit?.view.tradable && this.ledger.balance(agentId,id).available > 0n);
          if (!eligibleKnown && !eligibleExit) audit.a1.noEligibleMarketWait++;
        }
        const previous = audit.lastDecision.get(agentId);
        if (previous !== undefined) {
          const gap = at - previous;
          bump(audit.gaps, gap);
          if (this.config.boundedReactive) assert.ok(gap >= BOUNDED_REACTIVE_MS, 'Bounded decision interval');
        }
        audit.lastDecision.set(agentId, at);
        if (this.config.boundedReactive && !payload.reactive) {
          const previousPeriodic = audit.lastPeriodic.get(agentId);
          if (previousPeriodic !== undefined) {
            const gap = at - previousPeriodic;
            assert.ok(gap >= 4_500 && gap <= 9_499, 'Periodic schedule remains independent');
            bump(audit.periodicGaps, gap);
          }
          audit.lastPeriodic.set(agentId, at);
        }
      }
    } else if (kind === 'Admit') {
      bump(audit.attempts, payload.intent.side);
      for (const fact of this.kernel.staged) {
        if (fact.kind === 'AdmissionRejected') bump(audit.rejects, `${payload.intent.side}:admission:${fact.payload.reason}`);
      }
    } else if (kind === 'Observe' && !audit.firstMarket.has(agentId)) audit.firstMarket.set(agentId, at);
    else if (kind === 'Discover' && !audit.firstNarrative.has(agentId)) {
      if (this.kernel.staged.some((fact) => fact.kind === 'NarrativeDiscovered')) audit.firstNarrative.set(agentId, at);
    }
    if (previousLease !== undefined) assert.equal(actor.tokenInterest[payload.market.tokenId].buyUntil, previousLease,
      'Ordinary Observe does not renew interest');
    if (previousInterests) for (const [id, until] of Object.entries(previousInterests)) {
      if (actor.tokenInterest[id].buyUntil > until) audit.a1.renewals++;
    }
    if (kind === 'Decide') for (const task of this.kernel.scheduled) if (task.kind === 'Admit') {
      const intent = task.payload.intent;
      const entry = actor.tokenInterest?.[intent.tokenId];
      const meta = { at, buyUntil: entry?.buyUntil ?? null, exitOnly: !actor.known[intent.tokenId] };
      if (this.config.tokenInterestA1 && intent.side === 'BUY') {
        assert.equal(meta.exitOnly, false);
        assert.ok(at < meta.buyUntil, 'No new BUY after interest expiry');
      }
      audit.orderMeta.set(task.payload.intentId, meta);
    }
    if (kind === 'Execute') for (const fact of this.kernel.staged) if (fact.kind === 'TradeExecuted') {
      const fill = fact.payload.fill;
      const meta = audit.orderMeta.get(fill.intentId);
      assert.ok(meta);
      if (this.config.tokenInterestA1) {
        if (fill.side === 'SELL' && meta.exitOnly) audit.a1.exitOnlySellFills++;
        if (fill.side === 'SELL' && meta.at >= meta.buyUntil) audit.a1.expiredSellFills++;
        if (fill.side === 'BUY' && fill.at >= meta.buyUntil) audit.a1.inflightBuyAfterExpiry++;
      }
      audit.orderMeta.delete(fill.intentId);
    }
    if (this.config.boundedReactive && ((kind === 'Observe' || kind === 'Discover') && ordinal > 0 || kind === 'Decide' && payload.reactive)) {
      assert.equal(actor.nextAt, nextPeriodic, 'Information and reactive decisions preserve periodic deadline');
    }
    if (kind === 'Decide' || kind === 'Observe' || kind === 'Discover') {
      for (const task of this.kernel.scheduled) {
        if (task.kind !== 'Decide') continue;
        const id = task.payload.agentId;
        const source = task.payload.reactive ? 'reactive' : kind === 'Decide' ? 'periodic' :
          this.state.agents[id].ordinal === 0 ? `bootstrap:${kind}` : `reactive:${kind}`;
        if (this.config.boundedReactive) assert.equal(audit.pending.has(channelKey(task)), false, 'One task per decision channel');
        audit.pending.set(channelKey(task), task);
        audit.origins.set(task, source);
        bump(audit.scheduled, source);
      }
    }
    return result;
  };
  const advance = World.prototype.advanceTo;
  World.prototype.advanceTo = function (target, ...args) {
    const result = advance.call(this, target, ...args);
    if (target % 60_000 === 0 && sampleMinutes.has(target / 60_000)) {
      let available = 0n;
      let reserved = 0n;
      for (const id of Object.keys(this.state.agents)) {
        const balance = this.ledger.balance(id);
        available += balance.available;
        reserved += balance.reserved;
      }
      let holders = 0, positions = 0, outsideKnown = 0, expiredPositions = 0, missingExit = 0;
      for (const agent of Object.values(this.state.agents)) {
        const held = Object.entries(this.ledger.state.balances[agent.id] ?? {}).filter(([id,b])=> id !== 'SOL' && b.available+b.reserved>0n);
        if (held.length) holders++;
        positions += held.length;
        for (const [id] of held) {
          if (!agent.known[id]) {
            outsideKnown++;
            if (!agent.tokenInterest?.[id]?.exit) missingExit++;
          }
          if (agent.tokenInterest?.[id] && target >= agent.tokenInterest[id].buyUntil) expiredPositions++;
        }
      }
      this.ledger.assertConservation();
      audit.samples.push({ minute: target / 60_000, available: available.toString(), reserved: reserved.toString(),
        holders, positions, outsideKnown, expiredPositions, missingExit,
        transactionFees: this.ledger.balance('system:transaction-fees').available.toString(),
        swapFees: this.ledger.balance('system:swap-fees').available.toString() });
    }
    if (target === 5_400_000) {
      for (const task of this.kernel.snapshot().pending) {
        if (task.kind !== 'Decide') continue;
        bump(audit.queued, audit.origins.get(task));
        if (this.config.boundedReactive) {
          const agent = this.state.agents[task.payload.agentId];
          assert.equal(task.payload.generation, task.payload.reactive ? agent.boundedWake.reactiveGeneration : agent.generation);
        }
      }
      for (const order of Object.values(this.state.orders)) {
        if (order.status === 'OPEN' || order.status === 'QUEUED') bump(audit.pendingOrders, order.intent.side);
      }
    }
    return result;
  };

  function run(seed, mode, saveSizes = true) {
    audit = { origins: new WeakMap(), pending: new Map(), scheduled: {}, executed: {}, stale: {}, queued: {},
      lastDecision: new Map(), gaps: {}, firstMarket: new Map(), firstNarrative: new Map(), samples: [],
      attempts: {}, rejects: {}, pendingOrders: {}, lastPeriodic: new Map(), periodicGaps: {},
      impulses: 0, coalescedReactive: 0, coalescedPeriodic: 0 };
    audit.orderMeta = new Map();
    audit.a1 = { expiredBuyWait: 0, exitOnlyBuyWait: 0, blockedWithInterestedAlternative: 0,
      noEligibleMarketWait: 0, renewals: 0, exitOnlySellFills: 0, expiredSellFills: 0, inflightBuyAfterExpiry: 0 };
    const tape = createHash('sha256');
    const fullTape = createHash('sha256');
    const paths = new Map();
    const socialLaunches = [];
    const fills = {};
    let lastFill;
    const measured = measure(seed, 'on', (row) => {
      fullTape.update(json(row) + '\n');
      if (row.kind === 'birth') {
        paths.set(row.tokenId, { birth: row.launchAt, ages: [0, 0, 0, 0], trades: 0, activeBins: 0, sizes: [], buy: 0,
          buySol: 0n, sellSol: 0n, first80: false, first90: false, rows: [], token: row.tokenId });
        if (row.source === 'social') socialLaunches.push({ tokenId: row.tokenId, at: row.launchAt });
        tape.update(json({ kind: row.kind, token: row.tokenId, at: row.launchAt, source: row.source }) + '\n');
      } else if (row.kind === 'attempt-rejected') bump(audit.rejects, `${row.intent.side}:execution:${row.reason}`);
      else if (row.kind === 'fill') {
        bump(fills, row.side);
        lastFill = { at: row.at, side: row.side, marketEpoch: row.marketEpoch };
        if (row.marketEpoch !== 0) return;
        tape.update(json({ kind: row.kind, token: row.tokenId, at: row.at, seq: row.globalSeq.toString(),
          quote: row.quoteAtomsExFee.toString(), price: row.priceSol, progress: row.progressAfter,
          side: row.side, completion: row.completion }) + '\n');
        const path = paths.get(row.tokenId);
        const age = row.at - path.birth;
        if (age >= 1_800_000) return;
        path.trades++;
        path.ages[band(age)]++;
        const second = Math.floor(age / 1000);
        if (path.lastSecond !== second) path.activeBins++;
        path.lastSecond = second;
        path.sizes.push(Number(row.quoteAtomsExFee));
        path.rows.push({ ms: age, quote: Number(row.quoteAtomsExFee) / 1e9, side: row.side,
          post: row.progressAfter / 1e6, pre: row.progressBefore / 1e6 });
        if (row.progressAfter >= 800_000) path.first80 = true;
        if (row.progressAfter >= 900_000) path.first90 = true;
        if (row.completion) { path.completeAt = age; path.completeMs = age; }
        if (row.side === 'BUY') { path.buy++; path.buySol += row.quoteAtomsExFee; }
        else path.sellSol += row.quoteAtomsExFee;
      }
    }, { streamFacts: true, ...(mode !== 'off' ? { sellFeeReserve: true } : {}),
      ...(['bounded','a1'].includes(mode) ? { boundedReactive: true } : {}), ...(mode === 'a1' ? { tokenInterestA1: true } : {}) });
    for (const [source, count] of Object.entries(audit.scheduled)) {
      assert.equal(count, (audit.executed[source] ?? 0) + (audit.stale[source] ?? 0) + (audit.queued[source] ?? 0));
    }
    assert.equal(Object.values(audit.executed).reduce((sum, value) => sum + value, 0), measured.decisions);
    for (const side of ['BUY', 'SELL']) {
      const rejects = Object.entries(audit.rejects).filter(([key]) => key.startsWith(side + ':')).reduce((n, [, count]) => n + count, 0);
      assert.equal(audit.attempts[side] ?? 0, (fills[side] ?? 0) + rejects + (audit.pendingOrders[side] ?? 0));
    }
    const common = { paths: 0, trades: 0, ages: [0, 0, 0, 0], activeBins: 0, exposure: 0, earlyExposure: 0,
      buy: 0, buySol: 0n, sellSol: 0n, first80: 0, first90: 0, completions: 0 };
    const samples = [];
    const marketAudit = newResult();
    for (const path of paths.values()) {
      analyze(path, marketAudit);
      if (!path.trades || path.completeAt <= 1_000) continue;
      common.paths++;
      common.trades += path.trades;
      path.ages.forEach((count, i) => { common.ages[i] += count; });
      common.activeBins += path.activeBins;
      const duration = path.completeAt === undefined ? 1_800 : Math.min(1_800, Math.floor(path.completeAt / 1000) + 1);
      common.exposure += duration;
      common.earlyExposure += Math.min(120, duration);
      common.buy += path.buy;
      common.buySol += path.buySol;
      common.sellSol += path.sellSol;
      if (path.first80) common.first80++;
      if (path.first90) common.first90++;
      if (path.completeAt !== undefined) common.completions++;
      for (const size of path.sizes) samples.push(size);
    }
    const bytes = Buffer.from(Float64Array.from(samples).buffer);
    if (saveSizes && mode !== 'off') writeFileSync(join(out, `${seed}-${mode}-sizes.bin`), bytes, { flag: 'wx' });
    assert.equal(marketAudit.paths, common.paths);
    assert.equal(marketAudit.cells.all.trades, common.trades);
    const { origins, pending, lastDecision, lastPeriodic, firstMarket, firstNarrative, orderMeta, ...counters } = audit;
    const result = { seed, mode, manifest: measured.manifest, decisions: measured.decisions, facts: measured.facts,
      all: measured.all, poolFills: measured.poolFills, simulatedMs: measured.simulatedMs, baselineSchedule: measured.baselineSchedule,
      tapeSha256: tape.digest('hex'), fullTapeSha256: fullTape.digest('hex'), sizeSamplesSha256: hash(bytes),
      socialLaunches, lastFill, fills, common, counters, marketAudit,
      allLaunches: paths.size, quietLaunches: [...paths.values()].filter(p=>!p.trades).length,
      allLaunchExposure: common.exposure + [...paths.values()].filter(p=>!p.trades).length*1800,
      firstMarket: [...firstMarket.values()], firstNarrative: [...firstNarrative.values()] };
    return JSON.parse(json(result));
  }

  mkdirSync(out, { recursive: true });
  const runs = [];
  for (const expected of baseline.runs.filter((row) => requestedSeed === undefined || row.seed === requestedSeed)) {
    const off = run(expected.seed, 'off');
    for (const key of ['manifest', 'tapeSha256', 'all', 'decisions', 'facts', 'poolFills', 'baselineSchedule', 'simulatedMs']) {
      assert.deepEqual(off[key], expected[key], `${expected.seed} OFF ${key}`);
    }
    const control = run(expected.seed, 'control');
    const previous = controls.runs.find((row) => row.on.seed === expected.seed).on;
    for (const key of ['manifest', 'tapeSha256', 'fullTapeSha256', 'all']) assert.deepEqual(control[key], previous[key], key);
    const bounded = run(expected.seed, 'bounded');
    const savedBounded = boundedReference.runs.find(row=>row.bounded.seed===expected.seed).bounded;
    for (const key of ['manifest','tapeSha256','fullTapeSha256','all','decisions','baselineSchedule']) assert.deepEqual(bounded[key], savedBounded[key], `${expected.seed} BOUNDED ${key}`);
    const a1 = run(expected.seed, 'a1');
    assert.notEqual(a1.manifest.configHash, bounded.manifest.configHash);
    assert.deepEqual(a1.baselineSchedule, bounded.baselineSchedule);
    assert.deepEqual(run(expected.seed, 'a1', false), a1, `${expected.seed} A1 repeat`);
    runs.push({ off, control, bounded, a1 });
    console.log(expected.seed, 'BOUNDED', bounded.common.trades, 'A1', a1.common.trades, 'swaps; all regression hashes and A1 repeat match');
  }
  const result = { revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), fingerprints,
    defaults: DEFAULT_WORLD, cooldownMs: BOUNDED_REACTIVE_MS, interestMs: 300000,
    instrumentationGuardSha256: hash(expiredBuyGuard), real: realMetrics,
    realAudit: { ...realAudit, bursts: { ...realAudit.bursts, perPath: undefined } }, runs };
  writeFileSync(join(out, requestedSeed ? `${requestedSeed}.json` : 'summary.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
} finally {
  delete globalThis.__a1ExpiredBuy;
  assert.equal(resolve(temp, '..'), resolve(tmpdir()), 'Cleanup stays inside the temporary directory');
  rmSync(temp, { recursive: true, force: true });
}
