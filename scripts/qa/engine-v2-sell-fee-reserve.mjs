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
const requestedSeed = process.argv[4];
const baseline = JSON.parse(readFileSync(join(baselineDir, 'v2-runs.json'), 'utf8'));
const [reference] = JSON.parse(readFileSync(join(baselineDir, 'metrics.json'), 'utf8'));
const tmp = mkdtempSync(join(tmpdir(), 'memex-v2-fee-reserve-'));
const bundle = join(tmp, 'runner.mjs');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const json = (value) => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item);
const bump = (counts, key) => { counts[key] = (counts[key] ?? 0) + 1; };
const minutes = new Set([0, 5, 10, 15, 20, 30, 45, 60, 90]);

try {
  const built = await build({ stdin: { contents: `
    export { measure } from './src/qa/engineV2Benchmark';
    export { World, DEFAULT_WORLD } from './src/engineV2/world';
    export { SELL_FEE_RESERVE } from './src/engineV2/agents';`, resolveDir: process.cwd() },
    platform: 'node', format: 'esm', bundle: true, outfile: bundle, metafile: true });
  const { measure, World, DEFAULT_WORLD, SELL_FEE_RESERVE } = await import(pathToFileURL(bundle));
  assert.deepEqual(DEFAULT_WORLD, baseline.defaults);
  assert.equal(baseline.variant, 'on');
  assert.deepEqual(baseline.seeds, ['A', 'B', 'C', 'D', 'E', 'F'].map((letter) => `V2-PILOT-${letter}`));
  assert.ok(requestedSeed === undefined || baseline.seeds.includes(requestedSeed), 'Unknown pilot seed');
  const inputs = Object.keys(built.metafile.inputs).filter((file) => file !== '<stdin>');
  const fingerprints = Object.fromEntries(inputs.map((file) => [file, hash(readFileSync(file))]));
  let sample;
  let counts;
  const advance = World.prototype.advanceTo;
  World.prototype.advanceTo = function (target, ...args) {
    const result = advance.call(this, target, ...args);
    if (target % 60_000 === 0 && minutes.has(target / 60_000)) {
      let available = 0n;
      let reserved = 0n;
      for (const agent of Object.values(this.state.agents)) {
        const cash = this.ledger.balance(agent.id);
        available += cash.available;
        reserved += cash.reserved;
      }
      this.ledger.assertConservation();
      sample.push({ minute: target / 60_000, available: available.toString(), reserved: reserved.toString() });
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
    const result = processTask.call(this, event);
    if (event.kind === 'Admit') {
      const side = event.payload.intent.side;
      bump(counts.attempt, side);
      for (const fact of this.kernel.staged) {
        if (fact.kind === 'AdmissionRejected') bump(counts.rejected, `${side}:admission:${fact.payload.reason}`);
      }
    }
    return result;
  };

  function run(seed, enabled) {
    sample = [];
    counts = { attempt: {}, fill: {}, rejected: {}, pending: {} };
    const tape = createHash('sha256');
    const fullTape = createHash('sha256');
    const paths = new Map();
    let lastFill;
    let lastCurveAt;
    const result = measure(seed, baseline.variant, (row) => {
      fullTape.update(json(row) + '\n');
      if (row.kind === 'birth') {
        paths.set(row.tokenId, { birth: row.launchAt, trades: 0, early: 0, late: 0, buy: 0, buySol: 0n, sellSol: 0n });
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
        if (row.completion) path.completeAt = age;
        if (row.side === 'BUY') {
          path.buy++;
          path.buySol += row.quoteAtomsExFee;
        } else path.sellSol += row.quoteAtomsExFee;
      }
    }, enabled ? { sellFeeReserve: true, streamFacts: true } : { streamFacts: true });
    const tapeSha256 = tape.digest('hex');
    const fullTapeSha256 = fullTape.digest('hex');
    const common = { paths: 0, trades: 0, early: 0, earlyExposure: 0, late: 0, buy: 0, completions: 0, buySol: 0n, sellSol: 0n };
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
    }
    for (const side of ['BUY', 'SELL']) {
      const rejects = Object.entries(counts.rejected).filter(([key]) => key.startsWith(`${side}:`));
      assert.equal(counts.attempt[side], (counts.fill[side] ?? 0) + (counts.pending[side] ?? 0) +
        rejects.reduce((n, [, value]) => n + value, 0));
    }
    return { seed, manifest: result.manifest, decisions: result.decisions, facts: result.facts,
      all: result.all, poolFills: result.poolFills, baselineSchedule: result.baselineSchedule, simulatedMs: result.simulatedMs,
      sample, counts, common: JSON.parse(json(common)), lastFill, lastCurveAt, tapeSha256, fullTapeSha256 };
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
    if (fullOnRepeat) assert.deepEqual(run(expected.seed, true), on, `${expected.seed} ON repeat`);
    runs.push({ off, on, fullOnRepeat });
    console.log(expected.seed, 'OFF', off.lastFill.at, 'ON', on.lastFill.at, 'ms; OFF baseline matches');
  }
  const real = {
    lifecycle: reference.lifecycle.find((row) => row.dataset === 'Real C'),
    flow: reference.flow.filter((row) => row.dataset === 'Real C' && row.band === null),
    first120: reference.first120_common.find((row) => row.dataset === 'Real C'),
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
