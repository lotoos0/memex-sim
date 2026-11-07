import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const baselineDir = resolve(process.argv[2] ?? 'output/engine-v2-real-c-baseline');
const out = resolve(process.argv[3] ?? 'output/engine-v2-timer-only');
const requestedSeed = process.argv[4];
const baseline = JSON.parse(readFileSync(join(baselineDir, 'v2-runs.json'), 'utf8'));
const [realMetrics] = JSON.parse(readFileSync(join(baselineDir, 'metrics.json'), 'utf8'));
const controls = JSON.parse(readFileSync('output/engine-v2-sell-fee-reserve/summary.json', 'utf8'));
const temp = mkdtempSync(join(tmpdir(), 'memex-timer-only-'));
const json = (value) => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const bump = (bag, key) => { bag[key] = (bag[key] ?? 0) + 1; };
const sampleMinutes = new Set([0, 5, 10, 15, 20, 30, 45, 60, 90]);
const band = (ms) => ms < 120_000 ? 0 : ms < 600_000 ? 1 : ms < 1_200_000 ? 2 : 3;

try {
  const bundle = join(temp, 'runner.mjs');
  const built = await build({ stdin: { contents: `
    export { measure } from './src/qa/engineV2Benchmark';
    export { World, DEFAULT_WORLD } from './src/engineV2/world';`, resolveDir: process.cwd() },
    platform: 'node', format: 'esm', bundle: true, metafile: true, outfile: bundle });
  const { measure, World, DEFAULT_WORLD } = await import(pathToFileURL(bundle));
  assert.deepEqual(DEFAULT_WORLD, baseline.defaults);
  assert.equal(baseline.variant, 'on');
  assert.deepEqual(baseline.seeds, [...'ABCDEF'].map((letter) => `V2-PILOT-${letter}`));
  assert.ok(requestedSeed === undefined || baseline.seeds.includes(requestedSeed), 'Unknown pilot seed');
  const fingerprints = Object.fromEntries(Object.keys(built.metafile.inputs).filter((path) => path !== '<stdin>')
    .map((path) => [path, hash(readFileSync(path))]));
  let audit;
  const processTask = World.prototype.process;
  World.prototype.process = function (event) {
    const { kind, payload, key: { at } } = event;
    const agentId = payload.agentId;
    const valid = kind === 'Decide' && this.state.agents[agentId].generation === payload.generation;
    const origin = kind === 'Decide' ? audit.origins.get(event) : null;
    if (kind === 'Decide') {
      assert.ok(origin, 'Every decision task has a recorded scheduling source');
      if (valid) {
        assert.equal(audit.pending.get(agentId), event);
        audit.pending.delete(agentId);
      }
    }
    const result = processTask.call(this, event);
    if (kind === 'Decide') {
      const committed = this.kernel.staged.find((fact) => fact.kind === 'AgentDecided');
      assert.equal(Boolean(committed), valid);
      bump(committed ? audit.executed : audit.stale, origin);
      if (committed) {
        const previous = audit.lastDecision.get(agentId);
        if (previous !== undefined) {
          const gap = at - previous;
          bump(audit.gaps, gap);
          if (this.config.timerOnly) assert.ok(gap >= 4_500 && gap <= 9_499, 'Periodic decision interval');
        }
        audit.lastDecision.set(agentId, at);
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
    if (kind === 'Decide' || kind === 'Observe' || kind === 'Discover') {
      for (const task of this.kernel.scheduled) {
        if (task.kind !== 'Decide') continue;
        const id = task.payload.agentId;
        const source = kind === 'Decide' ? 'periodic' : this.state.agents[id].ordinal === 0 ? `bootstrap:${kind}` : `reactive:${kind}`;
        if (this.config.timerOnly) {
          assert.equal(audit.pending.has(id), false, 'Only one current timer per agent');
          assert.ok(source === 'periodic' || source.startsWith('bootstrap:'), 'Only bootstrap can wake on information');
        }
        audit.pending.set(id, task);
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
      this.ledger.assertConservation();
      audit.samples.push({ minute: target / 60_000, available: available.toString(), reserved: reserved.toString() });
    }
    if (target === 5_400_000) {
      for (const task of this.kernel.snapshot().pending) {
        if (task.kind !== 'Decide') continue;
        bump(audit.queued, audit.origins.get(task));
        if (this.config.timerOnly) assert.equal(task.payload.generation, this.state.agents[task.payload.agentId].generation);
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
      attempts: {}, rejects: {}, pendingOrders: {} };
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
          buySol: 0n, sellSol: 0n, first80: false, first90: false });
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
        if (row.progressAfter >= 800_000) path.first80 = true;
        if (row.progressAfter >= 900_000) path.first90 = true;
        if (row.completion) path.completeAt = age;
        if (row.side === 'BUY') { path.buy++; path.buySol += row.quoteAtomsExFee; }
        else path.sellSol += row.quoteAtomsExFee;
      }
    }, { streamFacts: true, ...(mode !== 'off' ? { sellFeeReserve: true } : {}), ...(mode === 'timer' ? { timerOnly: true } : {}) });
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
    for (const path of paths.values()) {
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
    const { origins, pending, lastDecision, firstMarket, firstNarrative, ...counters } = audit;
    const result = { seed, mode, manifest: measured.manifest, decisions: measured.decisions, facts: measured.facts,
      all: measured.all, poolFills: measured.poolFills, simulatedMs: measured.simulatedMs, baselineSchedule: measured.baselineSchedule,
      tapeSha256: tape.digest('hex'), fullTapeSha256: fullTape.digest('hex'), sizeSamplesSha256: hash(bytes),
      socialLaunches, lastFill, fills, common, counters, firstMarket: [...firstMarket.values()], firstNarrative: [...firstNarrative.values()] };
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
    const timer = run(expected.seed, 'timer');
    assert.notEqual(timer.manifest.configHash, control.manifest.configHash);
    assert.deepEqual(timer.baselineSchedule, control.baselineSchedule);
    assert.deepEqual(run(expected.seed, 'timer', false), timer, `${expected.seed} TIMER_ONLY repeat`);
    runs.push({ off, control, timer });
    console.log(expected.seed, 'CONTROL', control.decisions, 'TIMER_ONLY', timer.decisions, 'decisions; baseline and repeat match');
  }
  const result = { revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), fingerprints,
    defaults: DEFAULT_WORLD, real: realMetrics, runs };
  writeFileSync(join(out, requestedSeed ? `${requestedSeed}.json` : 'summary.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
} finally {
  rmSync(temp, { recursive: true, force: true });
}
