import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const out = resolve(process.argv[2] ?? 'output/engine-v2-bounded-reactive');
const inputs = [...'ABCDEF'].map((letter) => JSON.parse(readFileSync(join(out, `V2-PILOT-${letter}.json`), 'utf8')));
for (const input of inputs) {
  assert.deepEqual(input.fingerprints, inputs[0].fingerprints);
  assert.equal(input.timerReferenceSha256, inputs[0].timerReferenceSha256);
}
const runs = inputs.flatMap((input) => input.runs);
const sum = (rows, get) => rows.reduce((total, row) => total + get(row), 0);
const mergeCounts = (bags) => {
  const result = {};
  for (const bag of bags) for (const [key, count] of Object.entries(bag ?? {})) result[key] = (result[key] ?? 0) + count;
  return result;
};
const quantiles = (samples) => [0.1, 0.5, 0.9, 0.99].map((q) => {
  const rank = (samples.length - 1) * q;
  const lo = Math.floor(rank);
  return samples[lo] + (samples[Math.ceil(rank)] - samples[lo]) * (rank - lo);
});
const weighted = (bag) => {
  const n = Object.values(bag).reduce((a, b) => a + b, 0);
  const ordered = Object.entries(bag).map(([value, count]) => [Number(value), count]).sort((a, b) => a[0] - b[0]);
  return [0.1, 0.5, 0.9, 0.99].map((q) => {
    let count = 0;
    return ordered.find(([, frequency]) => (count += frequency) >= Math.ceil(q * n))?.[0] ?? null;
  });
};
const pooled = {};
for (const mode of ['control', 'timer', 'bounded']) {
  const rows = runs.map((run) => run[mode]);
  const common = {};
  for (const key of ['paths', 'trades', 'activeBins', 'exposure', 'earlyExposure', 'buy', 'first80', 'first90', 'completions']) {
    common[key] = sum(rows, (row) => row.common[key]);
  }
  common.ages = [0, 1, 2, 3].map((index) => sum(rows, (row) => row.common.ages[index]));
  for (const key of ['buySol', 'sellSol']) common[key] = rows.reduce((n, row) => n + BigInt(row.common[key]), 0n).toString();
  const sizeValues = new Float64Array(common.trades);
  let offset = 0;
  for (const row of rows) {
    const directory = mode === 'timer' ? resolve('output/engine-v2-timer-only') : out;
    const bytes = readFileSync(join(directory, `${row.seed}-${mode}-sizes.bin`));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sizeSamplesSha256);
    const samples = new Float64Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 8);
    sizeValues.set(samples, offset);
    offset += samples.length;
  }
  assert.equal(offset, common.trades);
  sizeValues.sort();
  const counters = Object.fromEntries(['scheduled', 'executed', 'stale', 'queued', 'rejects', 'attempts', 'pendingOrders']
    .map((key) => [key, mergeCounts(rows.map((row) => row.counters[key]))]));
  for (const key of ['impulses', 'coalescedReactive', 'coalescedPeriodic']) counters[key] = sum(rows, (row) => row.counters[key] ?? 0);
  if (mode === 'bounded') assert.equal(counters.impulses,
    counters.coalescedReactive + counters.coalescedPeriodic + counters.scheduled.reactive);
  const gaps = mergeCounts(rows.map((row) => row.counters.gaps));
  pooled[mode] = { common, decisions: sum(rows, (row) => row.decisions), fills: mergeCounts(rows.map((row) => row.fills)),
    first120: common.ages[0] / common.earlyExposure, empty: 1 - common.activeBins / common.exposure,
    activeIntensity: common.trades / common.activeBins, intensity: common.trades / common.exposure,
    ageShares: common.ages.map((n) => n / common.trades), buyShare: common.buy / common.trades,
    buySolShare: Number(common.buySol) / (Number(common.buySol) + Number(common.sellSol)),
    sizesSol: quantiles(sizeValues).map((n) => n / 1e9), counters, gapsMs: weighted(gaps),
    minGapMs: Math.min(...Object.keys(gaps).map(Number)),
    periodicGapsMs: weighted(mergeCounts(rows.map((row) => row.counters.periodicGaps))),
    availableSol: rows[0].counters.samples.map(({ minute }, i) => ({ minute,
      available: sum(rows, (row) => Number(row.counters.samples[i].available)) / 1e9 })),
    lastSwapMs: rows.map((row) => row.lastFill.at),
    socialLaunches: rows.map((row) => row.socialLaunches),
    firstMarketMs: quantiles(rows.flatMap((row) => row.firstMarket).sort((a, b) => a - b)),
    firstNarrativeMs: quantiles(rows.flatMap((row) => row.firstNarrative).sort((a, b) => a - b)),
  };
}
const summary = { ...inputs[0], runs, pooled };
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
const results = { baseRevision: summary.revision, fingerprints: summary.fingerprints, defaults: summary.defaults,
  cooldownMs: summary.cooldownMs, timerReferenceRevision: summary.timerReferenceRevision,
  timerReferenceSha256: summary.timerReferenceSha256,
  real: Object.fromEntries(Object.entries(summary.real).filter(([, rows]) => Array.isArray(rows))
    .map(([key, rows]) => [key, rows.filter((row) => row.dataset === 'Real C')])), pooled,
  hashes: runs.map((run) => Object.fromEntries(Object.entries(run).map(([mode, row]) => [mode, {
    seed: row.seed, manifest: row.manifest, tapeSha256: row.tapeSha256, fullTapeSha256: row.fullTapeSha256,
  }]))),
};
writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(pooled, null, 2));
