import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const baselineDir = resolve(process.argv[2] ?? 'output/engine-v2-real-c-baseline');
const out = resolve(process.argv[3] ?? 'output/engine-v2-sell-fee-reserve');
const cohortExperiment = process.argv.includes('--cohorts');
const requestedSeed = process.argv[4] === '--cohorts' ? undefined : process.argv[4];
const baseline = JSON.parse(readFileSync(join(baselineDir, 'v2-runs.json'), 'utf8'));
const [reference] = JSON.parse(readFileSync(join(baselineDir, 'metrics.json'), 'utf8'));
const control = cohortExperiment ? JSON.parse(readFileSync('output/engine-v2-sell-fee-reserve/summary.json', 'utf8')) : null;
const tmp = mkdtempSync(join(tmpdir(), 'memex-v2-fee-reserve-'));
const bundle = join(tmp, 'runner.mjs');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const json = (value) => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item);
const bump = (counts, key) => { counts[key] = (counts[key] ?? 0) + 1; };
const minutes = new Set([0, 5, 10, 15, 20, 30, 45, 60, 90]);

try {
  const built = await build({ stdin: { contents: `
    export { measure } from './src/qa/engineV2Benchmark';
    export { World, DEFAULT_WORLD, COHORT_SIZE, COHORT_INTERVAL_MS } from './src/engineV2/world';
    export { SELL_FEE_RESERVE } from './src/engineV2/agents';`, resolveDir: process.cwd() },
    platform: 'node', format: 'esm', bundle: true, outfile: bundle, metafile: true });
  const { measure, World, DEFAULT_WORLD, COHORT_SIZE, COHORT_INTERVAL_MS, SELL_FEE_RESERVE } = await import(pathToFileURL(bundle));
  assert.deepEqual(DEFAULT_WORLD, baseline.defaults);
  assert.equal(baseline.variant, 'on');
  assert.deepEqual(baseline.seeds, ['A', 'B', 'C', 'D', 'E', 'F'].map((letter) => `V2-PILOT-${letter}`));
  assert.ok(requestedSeed === undefined || baseline.seeds.includes(requestedSeed), 'Unknown pilot seed');
  const inputs = Object.keys(built.metafile.inputs).filter((file) => file !== '<stdin>');
  const fingerprints = Object.fromEntries(inputs.map((file) => [file, hash(readFileSync(file))]));
  let sample;
  let counts;
  let discovery;
  let initialFunding;
  const cohort = (id) => Math.floor(Number(id.slice('agent:'.length)) / COHORT_SIZE);
  const advance = World.prototype.advanceTo;
  World.prototype.advanceTo = function (target, ...args) {
    const result = advance.call(this, target, ...args);
    if (target % 60_000 === 0 && minutes.has(target / 60_000)) {
      let available = 0n;
      let reserved = 0n;
      let inactiveSol = 0n;
      let activeAgents = 0;
      for (const agent of Object.values(this.state.agents)) {
        const cash = this.ledger.balance(agent.id);
        available += cash.available;
        reserved += cash.reserved;
        if (cohortExperiment) {
          if (this.isAgentActive(agent.id)) activeAgents++;
          else inactiveSol += cash.available;
          if (target === 0) initialFunding.push(cash.available.toString());
        }
      }
      this.ledger.assertConservation();
      sample.push({ minute: target / 60_000, available: available.toString(), reserved: reserved.toString(),
        ...(cohortExperiment ? { activeAgents, inactiveSol: inactiveSol.toString() } : {}) });
      if (target === 5_400_000) {
        for (const order of Object.values(this.state.orders)) {
          if (order.status === 'OPEN' || order.status === 'QUEUED') bump(counts.pending, order.intent.side);
        }
      }
    }
    return result;
  };
  // Admission facts omit side. Observe the original Admit task without replaying it.
  const processTask = World.prototype.process;
  World.prototype.process = function (event) {
    if (cohortExperiment && this.config.cohortRotation) {
      const { kind, payload } = event;
      const id = kind === 'Admit' ? payload.intent.agentId : kind === 'Execute' ? this.state.orders[payload.orderId]?.intent.agentId :
        ['Decide', 'Observe', 'Exposure', 'Discover'].includes(kind) ? payload.agentId : undefined;
      if (id) assert.ok(this.isAgentActive(id), `Pre-activation ${kind} for ${id}`);
    }
    const result = processTask.call(this, event);
    if (event.kind === 'Admit') {
      const side = event.payload.intent.side;
      bump(counts.attempt, side);
      for (const fact of this.kernel.staged) {
        if (fact.kind === 'AdmissionRejected') bump(counts.rejected, `${side}:admission:${fact.payload.reason}`);
      }
    }
    if (cohortExperiment && event.kind === 'Observe') {
      const { agentId, market } = event.payload;
      const group = discovery[cohort(agentId)];
      if (!group.agents.has(agentId)) {
        group.agents.set(agentId, new Set());
        group.firstObservationMs.push(event.key.at);
      }
      group.agents.get(agentId).add(market.tokenId);
      group.tokens.add(market.tokenId);
    } else if (cohortExperiment && event.kind === 'Exposure') {
      for (const fact of this.kernel.staged) {
        if (fact.kind === 'ExposureDelivered') discovery[cohort(fact.payload.agentId)].socialExposures++;
      }
    }
    return result;
  };

  function run(seed, enabled, rotated = false, writeSizes = true) {
    sample = [];
    counts = { attempt: {}, fill: {}, rejected: {}, pending: {} };
    initialFunding = [];
    discovery = Array.from({ length: 4 }, () => ({ agents: new Map(), tokens: new Set(), firstObservationMs: [], socialExposures: 0 }));
    const tape = createHash('sha256');
    const fullTape = createHash('sha256');
    const paths = new Map();
    const socialLaunches = [];
    let lastFill;
    let lastCurveAt;
    const result = measure(seed, baseline.variant, (row) => {
      fullTape.update(json(row) + '\n');
      if (row.kind === 'birth') {
        paths.set(row.tokenId, { birth: row.launchAt, trades: 0, early: 0, late: 0, buy: 0, buySol: 0n, sellSol: 0n,
          activeBins: 0, ageBands: [0, 0, 0, 0], sizes: cohortExperiment && enabled ? [] : null });
        if (row.source === 'social') socialLaunches.push({ tokenId: row.tokenId, at: row.launchAt });
        tape.update(json({ kind: row.kind, token: row.tokenId, at: row.launchAt, source: row.source }) + '\n');
      } else if (row.kind === 'attempt-rejected') {
        bump(counts.rejected, `${row.intent.side}:execution:${row.reason}`);
      } else if (row.kind === 'fill') {
        bump(counts.fill, row.side);
        lastFill = { at: row.at, side: row.side, marketEpoch: row.marketEpoch };
        if (row.marketEpoch !== 0) return;
        lastCurveAt = row.at;
        tape.update(json({ kind: row.kind, token: row.tokenId, at: row.at, seq: row.globalSeq.toString(),
          quote: row.quoteAtomsExFee.toString(), price: row.priceSol, progress: row.progressAfter,
          side: row.side, completion: row.completion }) + '\n');
        const path = paths.get(row.tokenId);
        const age = row.at - path.birth;
        if (age >= 1_800_000) return;
        path.trades++;
        if (age < 120_000) path.early++;
        if (age >= 600_000) path.late++;
        path.ageBands[age < 120_000 ? 0 : age < 600_000 ? 1 : age < 1_200_000 ? 2 : 3]++;
        const second = Math.floor(age / 1000);
        if (path.lastSecond !== second) path.activeBins++;
        path.lastSecond = second;
        if (path.sizes) path.sizes.push(Number(row.quoteAtomsExFee));
        if (row.completion) path.completeAt = age;
        if (row.side === 'BUY') {
          path.buy++;
          path.buySol += row.quoteAtomsExFee;
        } else path.sellSol += row.quoteAtomsExFee;
      }
    }, { streamFacts: true, ...(enabled ? { sellFeeReserve: true } : {}), ...(rotated ? { cohortRotation: true } : {}) });
    const tapeSha256 = tape.digest('hex');
    const fullTapeSha256 = fullTape.digest('hex');
    const common = { paths: 0, trades: 0, early: 0, earlyExposure: 0, late: 0, buy: 0, completions: 0, buySol: 0n, sellSol: 0n };
    const native = { exposure: 0, activeBins: 0, ageBands: [0, 0, 0, 0] };
    for (const path of paths.values()) {
      if (!path.trades || path.completeAt <= 1_000) continue;
      common.paths++;
      common.trades += path.trades;
      common.early += path.early;
      common.earlyExposure += path.completeAt === undefined ? 120 : Math.min(120, Math.floor(path.completeAt / 1_000) + 1);
      common.late += path.late;
      common.buy += path.buy;
      common.buySol += path.buySol;
      common.sellSol += path.sellSol;
      if (path.completeAt !== undefined) common.completions++;
      native.exposure += path.completeAt === undefined ? 1_800 : Math.floor(path.completeAt / 1_000) + 1;
      native.activeBins += path.activeBins;
      path.ageBands.forEach((count, i) => { native.ageBands[i] += count; });
    }
    for (const side of ['BUY', 'SELL']) {
      const rejects = Object.entries(counts.rejected).filter(([key]) => key.startsWith(`${side}:`));
      assert.equal(counts.attempt[side], (counts.fill[side] ?? 0) + (counts.pending[side] ?? 0) +
        rejects.reduce((n, [, value]) => n + value, 0));
    }
    const extra = {};
    if (cohortExperiment) {
      assert.equal(native.ageBands.reduce((sum, count) => sum + count, 0), common.trades);
      const observed = new Set(discovery.flatMap((group) => [...group.tokens]));
      extra.native = native;
      extra.socialLaunches = socialLaunches;
      extra.observedMarkets = observed.size;
      extra.initialFunding = initialFunding;
      extra.discovery = discovery.map((group, i) => ({ startMs: rotated ? i * COHORT_INTERVAL_MS : 0,
        agents: group.agents.size, tokens: group.tokens.size, socialExposures: group.socialExposures,
        agentTokenPairs: [...group.agents.values()].reduce((sum, tokens) => sum + tokens.size, 0),
        firstObservationMs: group.firstObservationMs }));
      if (enabled) {
        const samples = new Float64Array(common.trades);
        let offset = 0;
        for (const path of paths.values()) {
          if (path.completeAt <= 1_000) continue;
          samples.set(path.sizes, offset);
          offset += path.sizes.length;
        }
        assert.equal(offset, samples.length);
        const bytes = Buffer.from(samples.buffer);
        extra.sizeSamplesSha256 = hash(bytes);
        if (writeSizes) writeFileSync(join(out, `${seed}-${rotated ? 'cohorts' : 'control'}-sizes.bin`), bytes, { flag: 'wx' });
      }
    }
    return { seed, manifest: result.manifest, decisions: result.decisions, facts: result.facts,
      all: result.all, poolFills: result.poolFills, baselineSchedule: result.baselineSchedule, simulatedMs: result.simulatedMs,
      sample, counts, common: JSON.parse(json(common)), lastFill, lastCurveAt, tapeSha256, fullTapeSha256, ...extra };
  }

  mkdirSync(out, { recursive: true });
  const runs = [];
  for (const expected of baseline.runs.filter((run) => requestedSeed === undefined || run.seed === requestedSeed)) {
    const off = run(expected.seed, false);
    for (const field of ['manifest', 'tapeSha256', 'facts', 'decisions', 'all', 'poolFills', 'baselineSchedule', 'simulatedMs']) {
      assert.deepEqual(off[field], expected[field], `${expected.seed} OFF ${field}`);
    }
    const on = run(expected.seed, true);
    assert.notEqual(on.manifest.configHash, off.manifest.configHash);
    assert.deepEqual(on.baselineSchedule, off.baselineSchedule);
    const fullOnRepeat = expected.seed === baseline.seeds[0];
    if (cohortExperiment) {
      const previous = control.runs.find((run) => run.on.seed === expected.seed).on;
      for (const field of ['manifest', 'tapeSha256', 'fullTapeSha256', 'all']) assert.deepEqual(on[field], previous[field]);
      const cohorts = run(expected.seed, true, true);
      assert.notEqual(cohorts.manifest.configHash, on.manifest.configHash);
      assert.deepEqual(cohorts.baselineSchedule, on.baselineSchedule);
      assert.deepEqual(cohorts.initialFunding, off.initialFunding);
      assert.deepEqual(cohorts.initialFunding, on.initialFunding);
      assert.deepEqual(cohorts.sample.map((point) => point.activeAgents), [25, 25, 25, 50, 50, 75, 100, 100, 100]);
      if (fullOnRepeat) assert.deepEqual(run(expected.seed, true, true, false), cohorts, `${expected.seed} COHORTS repeat`);
      runs.push({ off, control: on, cohorts, fullCohortRepeat: fullOnRepeat });
      console.log(expected.seed, 'CONTROL', on.lastFill.at, 'COHORTS', cohorts.lastFill.at, 'ms; OFF and CONTROL match');
      continue;
    }
    if (fullOnRepeat) assert.deepEqual(run(expected.seed, true), on, `${expected.seed} ON repeat`);
    runs.push({ off, on, fullOnRepeat });
    console.log(expected.seed, 'OFF', off.lastFill.at, 'ON', on.lastFill.at, 'ms; OFF baseline matches');
  }
  const real = {
    lifecycle: reference.lifecycle.find((row) => row.dataset === 'Real C'),
    flow: reference.flow.filter((row) => row.dataset === 'Real C' && row.band === null),
    first120: reference.first120_common.find((row) => row.dataset === 'Real C'),
    native: reference.native_rates.find((row) => row.dataset === 'Real C' && row.band === 'all'),
    age: reference.activity_age.filter((row) => row.dataset === 'Real C'),
  };
  const output = { head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    node: process.version, baselineMain: baseline.main, defaults: DEFAULT_WORLD, reserveLamports: SELL_FEE_RESERVE.toString(),
    fingerprints, realMetricsSha256: hash(readFileSync(join(baselineDir, 'metrics.json'))), runs, real };
  writeFileSync(join(out, requestedSeed ? `${requestedSeed}.json` : 'summary.json'),
    JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
