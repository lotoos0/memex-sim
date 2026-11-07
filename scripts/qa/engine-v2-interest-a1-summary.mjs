import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { quantileHist } from './engine-v2-market-persistence-metrics.mjs';

const out = resolve(process.argv[2] ?? 'output/engine-v2-interest-a1');
const causal=process.argv.includes('--causal');
const attention=process.argv.includes('--attention');
const fallthrough=process.argv.includes('--fallthrough')||attention;
const modes=attention?['bounded','exit','ft','a2']:fallthrough?['bounded','exit','ft']:causal?['bounded','exit','lease','a1']:['bounded','a1'];
const inputs = [...'ABCDEF'].map((letter) => JSON.parse(readFileSync(join(out, `V2-PILOT-${letter}.json`), 'utf8')));
for (const input of inputs) {
  assert.equal(!!input.causal,causal,'Use the matching capture/summary mode');
  assert.deepEqual(input.fingerprints, inputs[0].fingerprints);
  assert.equal(input.instrumentationGuardSha256, inputs[0].instrumentationGuardSha256);
}
const runs = inputs.flatMap((input) => input.runs);
for (const run of runs) for(const mode of modes) {
  const row=run[mode],bounded=run.bounded;
  // Samples at minutes 0 and 5 match across variants whose first behavioral change comes later; A2 changes targets from the first launches.
  const econ=(samples)=>samples.map(({attn,...rest})=>rest);
  assert.deepEqual(econ(row.counters.samples.slice(0,mode==='a2'?1:2)),econ(bounded.counters.samples.slice(0,mode==='a2'?1:2)),'Economics before first behavioral change remain identical');
  assert.equal(row.counters.executed.periodic,bounded.counters.executed.periodic,'Periodic execution count remains unchanged');
  assert.deepEqual(row.counters.periodicGaps,bounded.counters.periodicGaps,'Periodic cadence remains unchanged');
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
  for (const run of runs) for(const mode of causal||fallthrough?modes:['a1']) {
    const a1=run[mode];
    const full = createHash('sha256'), compact = createHash('sha256');
    const json = (v) => JSON.stringify(v,(_,v)=>typeof v==='bigint'?v.toString():v);
    const result = measure(a1.seed,'on',row=>{
      full.update(json(row)+'\n');
      if(row.kind==='birth') compact.update(json({kind:row.kind,token:row.tokenId,at:row.launchAt,source:row.source})+'\n');
      if(row.kind==='fill'&&row.marketEpoch===0) compact.update(json({kind:row.kind,token:row.tokenId,at:row.at,
        seq:row.globalSeq.toString(),quote:row.quoteAtomsExFee.toString(),price:row.priceSol,progress:row.progressAfter,
        side:row.side,completion:row.completion})+'\n');
    },{sellFeeReserve:true,boundedReactive:true,streamFacts:true,
      ...(mode==='a1'?{tokenInterestA1:true}:{}),...(mode==='exit'||mode==='ft'||mode==='a2'?{tokenExitOnly:true}:{}),...(mode==='lease'?{tokenLeaseOnly:true}:{}),
      ...(mode==='ft'||mode==='a2'?{exitFallthrough:true}:{}),...(mode==='a2'?{opportunityAttention:true}:{})});
    for (const key of ['manifest','all','decisions','facts','poolFills','baselineSchedule','simulatedMs']) assert.deepEqual(result[key],a1[key]);
    assert.equal(full.digest('hex'),a1.fullTapeSha256);
    assert.equal(compact.digest('hex'),a1.tapeSha256);
    console.log('PASS',a1.seed,mode,'uninstrumented repeat matches both tapes and summaries');
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
for (const mode of modes) {
  const rows = runs.map((run) => run[mode]);
  if (mode === 'a1'||mode==='exit'||mode==='ft'||mode==='a2') for (const row of rows) for (const sample of row.counters.samples) {
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
  counters.causal=mergeCounts(rows.map(row=>row.counters.causal));
  assert.equal(Object.entries(counters.causal).filter(([key])=>key.startsWith('wait:')).reduce((n,[,v])=>n+v,0),counters.causal['decision:WAIT']);
  assert.equal(counters.causal['wait:BUY_RESTRICTION']??0,
    (counters.causal['waitDetail:EXIT_VIEW']??0)+(counters.causal['waitDetail:LEASE_EXPIRED']??0));
  if(mode==='bounded'||mode==='lease')assert.equal(counters.causal['selected:EXIT']??0,0);
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
if(causal) {
  const metric=(r,key)=>{
    if(key==='swaps')return r.common.trades;
    if(key==='buy')return r.common.buy;
    if(key==='sell')return r.common.trades-r.common.buy;
    if(key==='lateSwaps')return r.common.ages[2]+r.common.ages[3];
    if(key==='lateBuy')return r.marketAudit.cells['age:10-20'].buy+r.marketAudit.cells['age:20-30'].buy;
    if(key==='earlyRate')return r.common.ages[0]/r.common.earlyExposure;
    if(key==='cash90')return Number(r.counters.samples.at(-1).available)/1e9;
    if(key==='positions90')return r.counters.samples.at(-1).positions;
    if(key==='terminalSilencePct')return 100*r.marketAudit.pathStats.filter(p=>p.trailingGap>=300).length/r.common.paths;
    if(key==='first80'||key==='first90'||key==='completions')return r.common[key];
    if(key==='dustRejects')return r.counters.rejects['SELL:execution:DUST_OR_LIQUIDITY']??0;
    throw new Error('Unknown causal metric');
  };
  summary.contrasts={};
  for(const key of ['swaps','buy','sell','lateSwaps','lateBuy','earlyRate','cash90','positions90','terminalSilencePct','first80','first90','completions','dustRejects']) {
    const bySeed=runs.map(run=>{
      const b=metric(run.bounded,key),e=metric(run.exit,key),l=metric(run.lease,key),a=metric(run.a1,key);
      return {seed:run.a1.seed,bounded:b,exit:e,lease:l,a1:a,exitAtLeaseOff:e-b,leaseAtExitOff:l-b,
        exitAtLeaseOn:a-l,leaseAtExitOn:a-e,interaction:a-e-l+b};
    });
    summary.contrasts[key]={bySeed,summary:Object.fromEntries(['exitAtLeaseOff','leaseAtExitOff','exitAtLeaseOn','leaseAtExitOn','interaction'].map(k=>{
      const xs=bySeed.map(row=>row[k]);
      return [k,{mean:xs.reduce((a,b)=>a+b,0)/xs.length,min:Math.min(...xs),max:Math.max(...xs),positive:xs.filter(x=>x>0).length,negative:xs.filter(x=>x<0).length,zero:xs.filter(x=>x===0).length}];
    }))};
  }
}
if(fallthrough) {
  const metric=(r,key)=>{
    const cells=r.marketAudit.cells,last=r.counters.samples.at(-1),c=r.counters.causal;
    switch(key) {
      case 'swaps':return r.common.trades;
      case 'buy':return r.common.buy;
      case 'sell':return r.common.trades-r.common.buy;
      case 'buySol':return Number(r.common.buySol)/1e9;
      case 'sellSol':return Number(r.common.sellSol)/1e9;
      case 'buyAged10to30':return cells['age:10-20'].buy+cells['age:20-30'].buy;
      case 'lateSwaps':return r.common.ages[2]+r.common.ages[3];
      case 'earlyRate':return r.common.ages[0]/r.common.earlyExposure;
      case 'emptyPct':return 100*(1-r.common.activeBins/r.common.exposure);
      case 'cash90':return Number(last.available)/1e9;
      case 'positions90':return last.positions;
      case 'outsideKnown90':return last.outsideKnown;
      case 'terminalSilencePct':return 100*r.marketAudit.pathStats.filter(p=>p.trailingGap>=300).length/r.common.paths;
      case 'first80':case 'first90':case 'completions':return r.common[key];
      case 'dustRejects':return r.counters.rejects['SELL:execution:DUST_OR_LIQUIDITY']??0;
      case 'flatExits':return c.flatExits??0;
      case 'exitChoices':return c['selected:EXIT']??0;
      case 'exitChoiceSell':return c['selected:EXIT:SELL']??0;
      case 'exitChoiceWait':return c['selected:EXIT:WAIT']??0;
      case 'exitChoiceBuy':return c['selected:EXIT:BUY']??0;
      case 'waitOtherBuyExit':return c['selected:EXIT:WAIT_OTHER_BUY']??0;
      case 'fallthroughDecisions':return c['ft:decisions']??0;
      case 'fallthroughBuyFills':return c['ft:fill:BUY']??0;
      case 'fallthroughBuySol':return (c['ft:buyLamports']??0)/1e9;
      case 'attemptsBuy':return r.counters.attempts.BUY??0;
      case 'attemptsSell':return r.counters.attempts.SELL??0;
      case 'lateBuyLowProgress':return ['10-20','20-30'].flatMap(a=>['ACTIVE','QUIET','DORMANT'].map(i=>cells[`cross:${a}:0-20:${i}`]?.buy??0)).reduce((n,x)=>n+x,0);
      case 'lateBuyMidProgress':return ['10-20','20-30'].flatMap(a=>['ACTIVE','QUIET','DORMANT'].map(i=>cells[`cross:${a}:20-50:${i}`]?.buy??0)).reduce((n,x)=>n+x,0);
      case 'newEntries':return c['entry:newBuyFills']??0;
      case 'repeatEntries':return c['entry:repeatBuyFills']??0;
      case 'changedBuyFills':return c['a2:changedFill:BUY']??0;
      case 'changedBuySol':return (c['a2:changedLamports']??0)/1e9;
      case 'targetChanged':return c['a2:targetChanged']??0;
      case 'attentionRecords90':return last.attn?.records??0;
      case 'interestedPairs90':return last.attn?.w8??0;
      case 'tokensWithInterested90':return last.attn?.tokensWithInterested??0;
      case 'newsRaised':return Object.entries(c).filter(([k])=>/^attn:news:k\d:raised$/.test(k)).reduce((n,[,v])=>n+v,0);
      case 'newsNoGain':return Object.entries(c).filter(([k])=>/^attn:news:k\d:noGain$/.test(k)).reduce((n,[,v])=>n+v,0);
      case 'newsSaturated':return (c['attn:news:k4:raised']??0)+(c['attn:news:k4:noGain']??0);
      case 'launchImpulses':return c['attn:launchImpulse']??0;
      case 'ownFillAbsorbs':return c['attn:ownFillAbsorb']??0;
      case 'staleIgnored':return c['attn:staleIgnored']??0;
      case 'epochResets':return c['attn:epochReset']??0;
      case 'tradeIntents':return c['decision:TRADE']??0;
      case 'waits':return c['decision:WAIT']??0;
      case 'reactiveDecisions':return r.counters.executed.reactive??0;
      default:throw new Error('Unknown fallthrough metric '+key);
    }
  };
  const keys=['swaps','buy','sell','buySol','sellSol','buyAged10to30','lateSwaps','earlyRate','emptyPct','cash90','positions90','outsideKnown90',
    'terminalSilencePct','first80','first90','completions','dustRejects','flatExits','exitChoices','exitChoiceSell','exitChoiceWait','exitChoiceBuy',
    'waitOtherBuyExit','fallthroughDecisions','fallthroughBuyFills','fallthroughBuySol','attemptsBuy','attemptsSell',
    ...(attention?['lateBuyLowProgress','lateBuyMidProgress','newEntries','repeatEntries','changedBuyFills','changedBuySol','targetChanged','attentionRecords90','interestedPairs90','tokensWithInterested90','newsRaised','newsNoGain','newsSaturated','launchImpulses','ownFillAbsorbs','staleIgnored','epochResets','tradeIntents','waits','reactiveDecisions']:[])];
  const stat=(xs)=>({mean:xs.reduce((a,b)=>a+b,0)/xs.length,min:Math.min(...xs),max:Math.max(...xs),positive:xs.filter(x=>x>0).length,negative:xs.filter(x=>x<0).length,zero:xs.filter(x=>x===0).length});
  summary.contrasts={};
  for(const key of keys) {
    const bySeed=runs.map(run=>{
      const b=metric(run.bounded,key),e=metric(run.exit,key),f=metric(run.ft,key),a=attention?metric(run.a2,key):null;
      return {seed:run.ft.seed,bounded:b,exit:e,ft:f,...(attention?{a2:a,a2MinusFt:a-f,a2MinusExit:a-e,a2MinusBounded:a-b}:{}),ftMinusExit:f-e,ftMinusBounded:f-b,exitMinusBounded:e-b};
    });
    summary.contrasts[key]={bySeed,summary:Object.fromEntries(['ftMinusExit','ftMinusBounded','exitMinusBounded',...(attention?['a2MinusFt','a2MinusExit','a2MinusBounded']:[])].map(k=>[k,stat(bySeed.map(row=>row[k]))]))};
  }
  summary.prefix=runs.map(run=>({seed:run.ft.seed,...(attention?{a2:run.a2.prefix,zeroBonus:run.a2.zeroBonus,ftVsExit:run.ft.prefix}:run.ft.prefix)}));
}
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
const results = { baseRevision: summary.revision, fingerprints: summary.fingerprints, defaults: summary.defaults,
  cooldownMs: summary.cooldownMs, interestMs:summary.interestMs,
  instrumentationGuardSha256:summary.instrumentationGuardSha256, uninstrumentedParity:true,
  real: summary.realAudit, pooled,
  ...(causal||fallthrough?{causal:true,contrasts:summary.contrasts}:{}),
  ...(fallthrough?{fallthrough:true,prefix:summary.prefix}:{}),
  ...(attention?{attention:true}:{}),
  hashes: runs.map((run) => Object.fromEntries(Object.entries(run).map(([mode, row]) => [mode, {
    seed: row.seed, manifest: row.manifest, tapeSha256: row.tapeSha256, fullTapeSha256: row.fullTapeSha256,
  }]))),
};
writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2) + '\n', { flag: 'wx' });
if(!fallthrough)console.log(JSON.stringify(pooled, null, 2));
