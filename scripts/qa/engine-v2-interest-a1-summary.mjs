import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { quantileHist } from './engine-v2-market-persistence-metrics.mjs';

const out = resolve(process.argv[2] ?? 'output/engine-v2-interest-a1');
const inputs = [...'ABCDEF'].map((letter) => JSON.parse(readFileSync(join(out, `V2-PILOT-${letter}.json`), 'utf8')));
for (const input of inputs) {
  assert.deepEqual(input.fingerprints, inputs[0].fingerprints);
  assert.equal(input.instrumentationGuardSha256, inputs[0].instrumentationGuardSha256);
}
const runs = inputs.flatMap((input) => input.runs);
for (const { bounded, a1 } of runs) {
  assert.deepEqual(a1.counters.samples.slice(0,2),bounded.counters.samples.slice(0,2),'Economics before first expiry remain identical');
  assert.equal(a1.counters.executed.periodic,bounded.counters.executed.periodic,'Periodic execution count remains unchanged');
  assert.deepEqual(a1.counters.periodicGaps,bounded.counters.periodicGaps,'Periodic cadence remains unchanged');
}
for (const [path, expected] of Object.entries(inputs[0].fingerprints)) {
  assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), expected, 'Measured engine input must remain unchanged');
}
const cleanDir = mkdtempSync(join(tmpdir(),'memex-a1-clean-'));
try {
  const cleanBundle = join(cleanDir, 'runner.mjs');
  await build({ stdin:{ contents:"export { measure } from './src/qa/engineV2Benchmark';",resolveDir:process.cwd()},
    platform:'node',format:'esm',bundle:true,outfile:cleanBundle });
  const { measure } = await import(pathToFileURL(cleanBundle));
  for (const { a1 } of runs) {
    const full = createHash('sha256'), compact = createHash('sha256');
    const json = (v) => JSON.stringify(v,(_,v)=>typeof v==='bigint'?v.toString():v);
    const result = measure(a1.seed,'on',row=>{
      full.update(json(row)+'\n');
      if(row.kind==='birth') compact.update(json({kind:row.kind,token:row.tokenId,at:row.launchAt,source:row.source})+'\n');
      if(row.kind==='fill'&&row.marketEpoch===0) compact.update(json({kind:row.kind,token:row.tokenId,at:row.at,
        seq:row.globalSeq.toString(),quote:row.quoteAtomsExFee.toString(),price:row.priceSol,progress:row.progressAfter,
        side:row.side,completion:row.completion})+'\n');
    },{sellFeeReserve:true,boundedReactive:true,tokenInterestA1:true,streamFacts:true});
    for (const key of ['manifest','all','decisions','facts','poolFills','baselineSchedule','simulatedMs']) assert.deepEqual(result[key],a1[key]);
    assert.equal(full.digest('hex'),a1.fullTapeSha256);
    assert.equal(compact.digest('hex'),a1.tapeSha256);
    console.log('PASS',a1.seed,'uninstrumented A1 matches both tapes and summaries');
  }
} finally {
  assert.equal(resolve(cleanDir,'..'),resolve(tmpdir()),'Cleanup stays inside the temporary directory');
  rmSync(cleanDir,{recursive:true,force:true});
}
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
for (const mode of ['bounded', 'a1']) {
  const rows = runs.map((run) => run[mode]);
  if (mode === 'a1') for (const row of rows) for (const sample of row.counters.samples) {
    assert.equal(sample.missingExit,0,'Every sampled outside-known position retains an exit observation');
  }
  const common = {};
  for (const key of ['paths', 'trades', 'activeBins', 'exposure', 'earlyExposure', 'buy', 'first80', 'first90', 'completions']) {
    common[key] = sum(rows, (row) => row.common[key]);
  }
  common.ages = [0, 1, 2, 3].map((index) => sum(rows, (row) => row.common.ages[index]));
  for (const key of ['buySol', 'sellSol']) common[key] = rows.reduce((n, row) => n + BigInt(row.common[key]), 0n).toString();
  const sizeValues = new Float64Array(common.trades);
  let offset = 0;
  for (const row of rows) {
    const bytes = readFileSync(join(out, `${row.seed}-${mode}-sizes.bin`));
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
  counters.a1 = mergeCounts(rows.map(row=>row.counters.a1));
  assert.equal(counters.impulses,
    counters.coalescedReactive + counters.coalescedPeriodic + counters.scheduled.reactive);
  const cells = {};
  for (const row of rows) for (const [key,c] of Object.entries(row.marketAudit.cells)) {
    const cell = cells[key] ??= {};
    for (const [metric,value] of Object.entries(c)) cell[metric]=(cell[metric]??0)+value;
  }
  for (const c of Object.values(cells)) Object.assign(c,{emptyPct:100*(1-c.active/c.exposure),
    rate:c.trades/c.exposure,activeRate:c.trades/c.active,buyPct:100*c.buy/c.trades,
    buySolPct:100*c.buySol/(c.buySol+c.sellSol),meanSol:(c.buySol+c.sellSol)/c.trades});
  for (const axis of ['age:','progress:','idle:','cross:']) for (const metric of ['trades','exposure','active','buy']) {
    assert.equal(Object.entries(cells).filter(([key])=>key.startsWith(axis)).reduce((n,[,c])=>n+c[metric],0),cells.all[metric]);
  }
  const burstHistogram = mergeCounts(rows.map(row=>row.marketAudit.bursts));
  const gapHistogram = mergeCounts(rows.map(row=>row.marketAudit.gaps));
  const windows = {};
  for (const key of Object.keys(rows[0].marketAudit.windows)) {
    const histogram=mergeCounts(rows.map(row=>row.marketAudit.windows[key]));
    const n=Object.values(histogram).reduce((a,b)=>a+b,0);
    windows[key]={n,emptyPct:100*(histogram[0]??0)/n,countQuantiles:quantileHist(histogram),
      activeQuantiles:quantileHist(Object.fromEntries(Object.entries(histogram).filter(([k])=>k!=='0')))};
  }
  const pathStats=rows.flatMap(row=>row.marketAudit.pathStats.map(p=>({...p,seed:row.seed})));
  const progression={};
  for (const row of rows) for(const [threshold,p]of Object.entries(row.marketAudit.progression)) {
    const group=progression[threshold]??={};
    for(const [key,v]of Object.entries(p)){
      if(typeof v==='number')group[key]=(group[key]??0)+v;
      else group[key]=mergeCounts([group[key]??{},v]);
    }
  }
  const gaps = mergeCounts(rows.map((row) => row.counters.gaps));
  pooled[mode] = { common, decisions: sum(rows, (row) => row.decisions), fills: mergeCounts(rows.map((row) => row.fills)),
    first120: common.ages[0] / common.earlyExposure, empty: 1 - common.activeBins / common.exposure,
    activeIntensity: common.trades / common.activeBins, intensity: common.trades / common.exposure,
    ageShares: common.ages.map((n) => n / common.trades), buyShare: common.buy / common.trades,
    buySolShare: Number(common.buySol) / (Number(common.buySol) + Number(common.sellSol)),
    sizesSol: quantiles(sizeValues).map((n) => n / 1e9), counters, gapsMs: weighted(gaps),
    minGapMs: Math.min(...Object.keys(gaps).map(Number)),
    periodicGapsMs: weighted(mergeCounts(rows.map((row) => row.counters.periodicGaps))),
    cells, windows, progression,
    bursts:{ seriesQuantiles:quantileHist(burstHistogram),gapQuantiles:quantileHist(gapHistogram),
      pathsTail300Pct:100*pathStats.filter(p=>p.trailingGap>=300).length/pathStats.length,
      pathsReturn35Pct:100*pathStats.filter(p=>p.returns35>0).length/pathStats.length },
    allLaunches:sum(rows,row=>row.allLaunches),quietLaunches:sum(rows,row=>row.quietLaunches),
    allLaunchExposure:sum(rows,row=>row.allLaunchExposure),
    availableSol: rows[0].counters.samples.map(({ minute }, i) => ({ minute,
      available: sum(rows, (row) => Number(row.counters.samples[i].available)) / 1e9,
      reserved:sum(rows,row=>Number(row.counters.samples[i].reserved))/1e9,
      transactionFees:sum(rows,row=>Number(row.counters.samples[i].transactionFees))/1e9,
      swapFees:sum(rows,row=>Number(row.counters.samples[i].swapFees))/1e9,
      ...Object.fromEntries(['holders','positions','outsideKnown','expiredPositions','missingExit'].map(key=>[key,sum(rows,row=>row.counters.samples[i][key])])) })),
    lastSwapMs: rows.map((row) => row.lastFill.at),
    socialLaunches: rows.map((row) => row.socialLaunches),
    firstMarketMs: quantiles(rows.flatMap((row) => row.firstMarket).sort((a, b) => a - b)),
    firstNarrativeMs: quantiles(rows.flatMap((row) => row.firstNarrative).sort((a, b) => a - b)),
  };
}
const summary = { ...inputs[0], runs, pooled };
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
const results = { baseRevision: summary.revision, fingerprints: summary.fingerprints, defaults: summary.defaults,
  cooldownMs: summary.cooldownMs, interestMs:summary.interestMs,
  instrumentationGuardSha256:summary.instrumentationGuardSha256, uninstrumentedParity:true,
  real: summary.realAudit, pooled,
  hashes: runs.map((run) => Object.fromEntries(Object.entries(run).map(([mode, row]) => [mode, {
    seed: row.seed, manifest: row.manifest, tapeSha256: row.tapeSha256, fullTapeSha256: row.fullTapeSha256,
  }]))),
};
writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(pooled, null, 2));
