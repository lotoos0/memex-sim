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
const causal = process.argv.includes('--causal');
const fallthrough = process.argv.includes('--fallthrough');
// --fallthrough needs no local reference outputs: BOUNDED/EXIT_ONLY are anchored to the committed compact results.
const committed = fallthrough ? JSON.parse(readFileSync('docs/calibration/engine-v2-a1-causal-separation-results.json', 'utf8')) : null;
const baseline = fallthrough ? { defaults: committed.defaults, variant: 'on', seeds: committed.hashes.map((row) => row.bounded.seed),
  runs: committed.hashes.map((row) => ({ seed: row.bounded.seed })) }
  : JSON.parse(readFileSync(join(baselineDir, 'v2-runs.json'), 'utf8'));
const [realMetrics] = fallthrough ? [committed.real] : JSON.parse(readFileSync(join(baselineDir, 'metrics.json'), 'utf8'));
const controls = fallthrough ? null : JSON.parse(readFileSync('output/engine-v2-sell-fee-reserve/summary.json', 'utf8'));
const boundedReference = fallthrough ? null : JSON.parse(readFileSync('output/engine-v2-bounded-reactive/summary.json', 'utf8'));
const a1Reference = causal ? JSON.parse(readFileSync('output/engine-v2-interest-a1-final/summary.json', 'utf8')) : null;
const realAudit = fallthrough ? committed.real : JSON.parse(readFileSync('output/engine-v2-persistence-audit/summary.json', 'utf8')).real;
const temp = mkdtempSync(join(tmpdir(), 'memex-interest-a1-'));
const json = (value) => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const bump = (bag, key) => { bag[key] = (bag[key] ?? 0) + 1; };
const fnv = (text) => {
  let a = 0x811c9dc5, b = 0x9747b28c;
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193) >>> 0; b = Math.imul(b ^ c, 0x85ebca6b) >>> 0; }
  return a * 0x200000 + (b >>> 11);
};
let lastChain = null;
const sampleMinutes = new Set([0, 5, 10, 15, 20, 30, 45, 60, 90]);
const band = (ms) => ms < 120_000 ? 0 : ms < 600_000 ? 1 : ms < 1_200_000 ? 2 : 3;

try {
  const expiredBuyGuard = 'if (exitEnabled && !agent.known[buyBase.tokenId]\n    || leaseEnabled && now >= (agent.tokenInterest?.[buyBase.tokenId]?.buyUntil ?? 0)) return null;';
  const bundle = join(temp, 'runner.mjs');
  const built = await build({ stdin: { contents: `
    export { measure } from './src/qa/engineV2Benchmark';
    export { decideTrade, newAgent, observe } from './src/engineV2/agents';
    export { RngStreams } from './src/engineV2/rng';
    export { BASE_FEE, SOL } from './src/engineV2/contracts';
    export { posting } from './src/engineV2/ledger';
    export { World, DEFAULT_WORLD, BOUNDED_REACTIVE_MS } from './src/engineV2/world';`, resolveDir: process.cwd() },
    platform: 'node', format: 'esm', bundle: true, metafile: true, outfile: bundle,
    plugins: [{ name: 'a1-read-only-diagnostics', setup(builder) {
      builder.onLoad({ filter: /engineV2[\\/]agents\.ts$/ }, ({ path }) => {
        let source = readFileSync(path, 'utf8').replaceAll('\r\n','\n');
        const replaceOnce = (old, replacement) => {
          assert.equal(source.split(old).length,2,'One diagnostic anchor: '+old);
          source=source.replace(old,replacement);
        };
        replaceOnce("const draw = (exclusive: number) => rng.int('agent/decision', agent.id, AGENT_VERSION, exclusive);",
          "const trace = (reason, selection = null, detail = null) => globalThis.__a1PolicyTrace(agent, now, ledger, protectedBuySol, leaseEnabled, exitEnabled, candidates, selection, reason, detail);\n  const draw = (exclusive: number) => rng.int('agent/decision', agent.id, AGENT_VERSION, exclusive);");
        replaceOnce('if (!candidates.length || draw(100) < 45) return null;',
          "if (!candidates.length) { trace('NO_CANDIDATE'); return null; }\n  if (draw(100) < 45) { trace('POLICY_WAIT'); return null; }");
        replaceOnce('const { view, prior, evidence } = selected;',
          'const { view, prior, evidence } = selected;\n  trace(null, selected);\n  globalThis.__a1Pressure(agent, now, candidates, rawScores, narrativeOf);');
        replaceOnce('let bestKnown = -Infinity;','let bestKnown = -Infinity;\n  const rawScores = new Map();');
        replaceOnce('const score = draw(60) + pressure;','const rawDraw = draw(60);\n    const score = rawDraw + pressure;\n    rawScores.set(item.view.tokenId, [rawDraw, score]);');
        replaceOnce('if (cash <= 0n) return null;',"if (cash <= 0n) { trace('BUY_BUDGET', selected, 'NO_CASH'); return null; }");
        replaceOnce('if (buyBase !== base && cash - protectedBuySol <= 0n) return null;',
          "if (buyBase !== base && cash - protectedBuySol <= 0n) { trace('BUY_BUDGET', selected, 'RESERVE'); return null; }");
        replaceOnce('if (size <= 0n) return null;',"if (size <= 0n) { trace('BUY_BUDGET', selected, 'RESERVE'); return null; }");
        assert.equal(source.split(expiredBuyGuard).length, 2, 'One explicit BUY-only interest guard');
        return { loader: 'ts', contents: source.replace(expiredBuyGuard,
          "if (buyBase !== base) globalThis.__a1Fallthrough(agent, now, ledger, protectedBuySol, selected, buyBase.tokenId);\n  "
          + expiredBuyGuard.replace('return null;', "{ trace('BUY_RESTRICTION', selected, exitEnabled && !agent.known[buyBase.tokenId] ? 'EXIT_VIEW' : 'LEASE_EXPIRED'); globalThis.__a1ExpiredBuy(agent, view, now); return null; }")) };
      });
    } }],
  });
  const { measure, World, DEFAULT_WORLD, BOUNDED_REACTIVE_MS, BASE_FEE, SOL, posting,
    decideTrade, newAgent, observe, RngStreams } = await import(pathToFileURL(bundle));
  assert.deepEqual(DEFAULT_WORLD, baseline.defaults);
  assert.equal(baseline.variant, 'on');
  assert.deepEqual(baseline.seeds, [...'ABCDEF'].map((letter) => `V2-PILOT-${letter}`));
  assert.ok(requestedSeed === undefined || baseline.seeds.includes(requestedSeed), 'Unknown pilot seed');
  const fingerprints = Object.fromEntries(Object.keys(built.metafile.inputs).filter((path) => path !== '<stdin>')
    .map((path) => [path, hash(readFileSync(path))]));
  let audit;
  globalThis.__a1PolicyTrace = (agent, now, ledger, protection, lease, exit, candidates, selection, reason, detail) => {
    if (reason) assert.equal(audit.trace?.reason ?? null,null,'One primary WAIT reason per policy call');
    const selectedId=selection?.view.tokenId ?? null;
    const cash=ledger.balance(agent.id).available;
    const otherBuy=Object.values(agent.known).some(item=>item.view.tokenId!==selectedId && item.view.tradable
      && (!lease || now < (agent.tokenInterest?.[item.view.tokenId]?.buyUntil ?? 0)) && cash-BASE_FEE-protection>0n);
    const otherSell=candidates.some(item=>item.view.tokenId!==selectedId && item.view.tradable
      && ledger.balance(agent.id,item.view.tokenId).available>0n && cash>=BASE_FEE);
    audit.trace={selectedId,reason,detail,otherBuy,otherSell,exitOnly:!!selectedId&&!agent.known[selectedId],
      expired:!!selectedId&&lease&&now>=(agent.tokenInterest?.[selectedId]?.buyUntil??0),
      noBuyBudget:cash-BASE_FEE-protection<=0n};
  };
  globalThis.__a1ExpiredBuy = (agent, view, now) => {
    if (!agent.known[view.tokenId]) audit.a1.exitOnlyBuyWait++;
    else audit.a1.expiredBuyWait++;
    if (Object.values(agent.known).some((item) => item.view.tradable
      && (!audit.flags.lease || now < (agent.tokenInterest?.[item.view.tokenId]?.buyUntil ?? 0)))) audit.a1.blockedWithInterestedAlternative++;
  };
  globalThis.__a1Fallthrough = (agent, now, ledger, protection, selected, targetId) => {
    audit.ft = { selectedId: selected.view.tokenId, targetId, at: now };
    bump(audit.causal, 'ft:decisions');
    if (audit.cf && audit.cf.best !== targetId) bump(audit.causal, 'pressure:fallthroughTargetDiffers');
  };
  // Counterfactual only: would known-only narrative counts change the scores of BUY-eligible candidates?
  globalThis.__a1Pressure = (agent, now, candidates, scores, narrativeOf) => {
    const known = candidates.filter((item) => agent.known[item.view.tokenId]);
    const exit = candidates.filter((item) => !agent.known[item.view.tokenId]);
    if (!exit.length) { bump(audit.causal, 'pressure:decisionsWithoutExit'); return; }
    bump(audit.causal, 'pressure:decisionsWithExit');
    if (candidates.some((item) => scores.get(item.view.tokenId)[1] > scores.get(item.view.tokenId)[0])) bump(audit.causal, 'pressure:nonzeroActual');
    if (!known.length) { bump(audit.causal, 'pressure:noKnown'); return; }
    const counts = new Map();
    for (const { view } of known) { const n = narrativeOf(view.tokenId); if (n) counts.set(n, (counts.get(n) ?? 0) + 1); }
    const interest = new Map();
    for (const id of counts.keys()) {
      const x = agent.narratives[id];
      if (x) interest.set(id, Math.max(0, x.attention - x.fatigue - Math.floor((now - x.at) / 1000)));
    }
    const total = [...interest.values()].reduce((sum, value) => sum + value, 0);
    let nonzeroCf = false;
    let differs = false, bestActual = null, bestActualScore = -Infinity, bestCf = null, bestCfScore = -Infinity;
    for (const item of known) {
      const id = narrativeOf(item.view.tokenId);
      const cf = id ? Math.floor((interest.get(id) ?? 0) * 60 / (Math.max(60, total) * counts.get(id))) : 0;
      const [raw, actual] = scores.get(item.view.tokenId);
      if (actual - raw !== cf) differs = true;
      if (cf > 0) nonzeroCf = true;
      if (actual > bestActualScore) { bestActualScore = actual; bestActual = item.view.tokenId; }
      if (raw + cf > bestCfScore) { bestCfScore = raw + cf; bestCf = item.view.tokenId; }
    }
    if (exit.some((item) => counts.has(narrativeOf(item.view.tokenId)))) bump(audit.causal, 'pressure:exitSharesKnownNarrative');
    if (differs) bump(audit.causal, 'pressure:knownPressureDiffers');
    if (nonzeroCf) bump(audit.causal, 'pressure:nonzeroKnownOnly');
    if (bestActual !== bestCf) bump(audit.causal, 'pressure:bestKnownDiffers');
    audit.cf = { best: bestCf };
  };
  function waitClassificationGate() {
    class Draws extends RngStreams {
      constructor(values) { super('causal-classification'); this.values=[...values]; }
      int(_namespace,_entity,_version,exclusive) {
        const value=this.values.shift();
        assert.ok(value!==undefined&&value>=0&&value<exclusive,'Only expected RNG draws');
        return value;
      }
    }
    const world=new World({...DEFAULT_WORLD,agents:1,agentDecisions:false,social:false,socialLaunches:false});
    world.advanceTo(0);
    const agent=newAgent('agent:00000',0),id='tok_baseline_0';
    const view=world.publicMarket(world.state.markets[id]);
    observe(agent,view,'qa:first',0);
    const setCash=(n)=>{
      const delta=n-world.ledger.balance(agent.id).available;
      world.ledger.commit([posting(agent.id,'SOL',delta),posting('user:player','SOL',-delta)]);
    };
    const run=(at,values,exit=false,lease=true)=>{
      audit={trace:null,causal:{},flags:{exit,lease},a1:{expiredBuyWait:0,exitOnlyBuyWait:0,blockedWithInterestedAlternative:0}};
      const rng=new Draws(values);
      const intent=decideTrade(agent,at,world.ledger,rng,()=>undefined,5_000_000n,exit&&lease,exit&&!lease,lease&&!exit);
      assert.equal(rng.values.length,0);
      return {intent,trace:audit.trace};
    };
    assert.equal(run(300000,[]).trace.reason,'NO_CANDIDATE');
    assert.equal(run(0,[0]).trace.reason,'POLICY_WAIT');
    setCash(BASE_FEE);
    assert.equal(run(0,[99,0]).trace.reason,'BUY_BUDGET');
    setCash(5_000_000n+BASE_FEE-1n);
    assert.equal(run(0,[99,0,14]).trace.detail,'RESERVE');
    world.ledger.commit([posting('curve:'+id,id,-100n),posting(agent.id,id,100n)]);
    const overlapping=run(300000,[99,0,99]);
    assert.equal(overlapping.trace.reason,'BUY_RESTRICTION');
    assert.equal(overlapping.trace.detail,'LEASE_EXPIRED');
    assert.equal(overlapping.trace.noBuyBudget,true);
    setCash(SOL);
    const item=agent.known[id];
    delete agent.known[id];
    agent.tokenInterest[id].exit=item;
    observe(agent,{...view,tokenId:'tok_z_alternative'},'qa:other',300000);
    const exitWait=run(300001,[99,59,0,99],true,true);
    assert.equal(exitWait.intent,null);
    assert.equal(exitWait.trace.reason,'BUY_RESTRICTION');
    assert.equal(exitWait.trace.detail,'EXIT_VIEW');
    assert.equal(exitWait.trace.expired,true);
    assert.equal(exitWait.trace.otherBuy,true);
    const exitSell=run(300001,[99,59,0,0,0],true,true);
    assert.equal(exitSell.intent.side,'SELL');
    assert.equal(exitSell.trace.reason,null);
    assert.equal(exitSell.trace.exitOnly,true);
    console.log('PASS four disjoint WAIT reasons, overlap precedence, exit choices and exact RNG draws');
  }
  waitClassificationGate();
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
    if (kind === 'Decide') { audit.trace=null; audit.ft=null; audit.cf=null; }
    const executedIntent=kind==='Execute'?this.state.orders[payload.orderId]?.intent:null;
    const heldBefore=executedIntent ? this.ledger.balance(executedIntent.agentId,executedIntent.tokenId):null;
    const atomsBefore=heldBefore ? heldBefore.available+heldBefore.reserved:0n;
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
        const trace=audit.trace;
        if (committed.payload.decision==='LAUNCH') assert.equal(trace,null);
        else {
          assert.ok(trace,'Actual policy decisions have a diagnostic trace');
          const intent=this.kernel.scheduled.find(task=>task.kind==='Admit')?.payload.intent;
          if (committed.payload.decision==='WAIT') {
            assert.ok(['NO_CANDIDATE','POLICY_WAIT','BUY_BUDGET','BUY_RESTRICTION'].includes(trace.reason));
            bump(audit.causal,`wait:${trace.reason}`);
            if (trace.detail) bump(audit.causal,`waitDetail:${trace.detail}`);
            if(trace.otherBuy) bump(audit.causal,`waitOtherBuy:${trace.reason}`);
            if(trace.otherSell) bump(audit.causal,`waitOtherSell:${trace.reason}`);
            if(trace.expired)bump(audit.causal,'waitSecondary:expired');
            if(trace.exitOnly)bump(audit.causal,'waitSecondary:exitOnly');
            if(trace.noBuyBudget)bump(audit.causal,'waitSecondary:noBuyBudget');
          } else { assert.equal(trace.reason,null); assert.ok(intent); }
          if(trace.selectedId) {
            const origin=trace.exitOnly?'EXIT':'KNOWN';
            bump(audit.causal,`selected:${origin}`);
            bump(audit.causal,`selected:${origin}:${intent?.side??'WAIT'}`);
            if(!intent&&trace.otherBuy)bump(audit.causal,`selected:${origin}:WAIT_OTHER_BUY`);
          }
          bump(audit.causal,`decision:${committed.payload.decision}`);
        }
        {
          const d = this.kernel.scheduled.find((task) => task.kind === 'Admit')?.payload.intent;
          if (audit.ft) {
            bump(audit.causal, d ? 'ft:buyIntent' : 'ft:wait');
            if (d && audit.chain.firstChange === null) { audit.chain.firstChange = audit.chain.decisions.length; audit.chain.firstChangeAt = at; }
          }
          audit.chain.decisions.push(fnv(JSON.stringify([at, agentId, committed.payload.ordinal, committed.payload.decision,
            d?.tokenId ?? null, d?.side ?? null, String(d?.maxInputSol ?? d?.inputTokens ?? '')])));
        }
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
        if (fact.kind === 'AdmissionRejected') {
          bump(audit.rejects, `${payload.intent.side}:admission:${fact.payload.reason}`);
          if (audit.orderMeta.get(payload.intentId)?.fallthrough) bump(audit.causal, 'ft:admitReject');
          audit.orderMeta.delete(payload.intentId);
        }
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
      const meta = { at, buyUntil: entry?.buyUntil ?? null, exitOnly: !actor.known[intent.tokenId], fallthrough: !!audit.ft && intent.side === 'BUY' };
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
      if (audit.flags.exit && fill.side==='SELL' && meta.exitOnly) bump(audit.causal,'fill:EXIT:SELL');
      if (meta.fallthrough) {
        bump(audit.causal, 'ft:fill:' + fill.side);
        audit.causal['ft:buyLamports'] = (audit.causal['ft:buyLamports'] ?? 0) + Number(fill.quoteAtomsExFee);
        bump(audit.causal, `ft:fillAgeBand:${band(fill.at - this.state.markets[fill.tokenId].launchedAt)}`);
      }
      if (fill.side==='SELL') {
        if(!this.state.agents[fill.agentId].known[fill.tokenId])bump(audit.causal,'fillOutsideKnownAtExecution');
        const after=this.ledger.balance(fill.agentId,fill.tokenId);
        if(atomsBefore>0n&&after.available+after.reserved===0n) {
          bump(audit.causal,'flatExits');
          if(meta.exitOnly)bump(audit.causal,'flatExits:EXIT');
        }
      }
      if (this.config.tokenInterestA1 || this.config.tokenExitOnly || this.config.tokenLeaseOnly) {
        if (fill.side === 'SELL' && meta.exitOnly) audit.a1.exitOnlySellFills++;
        if (audit.flags.lease && fill.side === 'SELL' && meta.at >= meta.buyUntil) audit.a1.expiredSellFills++;
        if (audit.flags.lease && fill.side === 'BUY' && fill.at >= meta.buyUntil) audit.a1.inflightBuyAfterExpiry++;
      }
      audit.orderMeta.delete(fill.intentId);
    }
    if(kind==='Execute') for(const fact of this.kernel.staged) if(fact.kind==='OrderChanged'&&fact.payload.order.status==='REJECTED') {
      const order=fact.payload.order,meta=audit.orderMeta.get(order.intentId);
      bump(audit.causal,`executionReject:${meta?.exitOnly?'EXIT':'KNOWN'}:${order.intent.side}:${order.reason}`);
      if (meta?.fallthrough) bump(audit.causal, 'ft:execReject');
      audit.orderMeta.delete(order.intentId);
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
            if (!(this.config.tokenExitOnly?agent.exitMemory?.[id]:agent.tokenInterest?.[id]?.exit)) missingExit++;
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
    audit.flags={lease:['a1','lease'].includes(mode),exit:['a1','exit','ft'].includes(mode)};
    audit.causal={}; audit.trace=null; audit.ft=null; audit.cf=null;
    audit.chain={ decisions: [], rows: [], rowTimes: [], firstChange: null, firstChangeAt: null };
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
      // Fact ids embed the run's config hash, which differs by design between variants; compare behavior, not ids.
      audit.chain.rows.push(fnv(json(row).replace(/[0-9a-f]{16}\/e\//g, 'RUN/e/')));
      audit.chain.rowTimes.push(row.at ?? row.launchAt ?? 0);
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
      ...(['bounded','a1','exit','lease','ft'].includes(mode) ? { boundedReactive: true } : {}),
      ...(mode === 'a1' ? { tokenInterestA1: true } : {}),
      ...(mode === 'exit' || mode === 'ft' ? { tokenExitOnly: true } : {}), ...(mode === 'lease' ? { tokenLeaseOnly: true } : {}),
      ...(mode === 'ft' ? { exitFallthrough: true } : {}) });
    audit.causal['ft:pending'] = [...audit.orderMeta.values()].filter((meta) => meta.fallthrough).length;
    lastChain = audit.chain;
    for (const [source, count] of Object.entries(audit.scheduled)) {
      assert.equal(count, (audit.executed[source] ?? 0) + (audit.stale[source] ?? 0) + (audit.queued[source] ?? 0));
    }
    assert.equal(Object.values(audit.executed).reduce((sum, value) => sum + value, 0), measured.decisions);
    assert.equal(Object.entries(audit.causal).filter(([k])=>k.startsWith('wait:')).reduce((n,[,v])=>n+v,0),audit.causal['decision:WAIT']??0);
    for (const origin of ['KNOWN','EXIT']) assert.equal(audit.causal[`selected:${origin}`]??0,
      ['BUY','SELL','WAIT'].reduce((n,side)=>n+(audit.causal[`selected:${origin}:${side}`]??0),0));
    const ftBuy = audit.causal['ft:buyIntent'] ?? 0;
    assert.equal(audit.causal['selected:EXIT:BUY'] ?? 0, mode === 'ft' ? ftBuy : 0, 'Exit-only BUY exists only as fallthrough');
    if (mode === 'ft') {
      assert.equal(audit.causal['ft:decisions'] ?? 0, ftBuy + (audit.causal['ft:wait'] ?? 0));
      assert.equal(ftBuy, ['ft:fill:BUY', 'ft:execReject', 'ft:admitReject', 'ft:pending'].reduce((n, key) => n + (audit.causal[key] ?? 0), 0),
        'Every fallthrough BUY intent is filled, rejected or pending');
      assert.equal(audit.causal['selected:EXIT:WAIT_OTHER_BUY'] ?? 0, 0, 'No exit-only WAIT leaves an eligible BUY unused');
    } else assert.equal(audit.causal['ft:decisions'] ?? 0, 0);
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
    const { origins, pending, lastDecision, lastPeriodic, firstMarket, firstNarrative, orderMeta, trace, flags, chain, ft, cf, ...counters } = audit;
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
    if (fallthrough) {
      const saved = committed.hashes.find((row) => row.bounded.seed === expected.seed);
      const anchored = (row, ref, name) => { for (const key of ['manifest', 'tapeSha256', 'fullTapeSha256']) assert.deepEqual(row[key], ref[key], `${expected.seed} ${name} anchor ${key}`); };
      const bounded = run(expected.seed, 'bounded'); anchored(bounded, saved.bounded, 'BOUNDED');
      const exit = run(expected.seed, 'exit'); const exitChain = lastChain; anchored(exit, saved.exit, 'EXIT_ONLY');
      const ft = run(expected.seed, 'ft'); const ftChain = lastChain;
      const firstDiff = (a, b) => { const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i; return a.length === b.length ? -1 : n; };
      const decisionDiff = firstDiff(exitChain.decisions, ftChain.decisions);
      const rowDiff = firstDiff(exitChain.rows, ftChain.rows);
      if (ftChain.firstChange === null) { assert.equal(decisionDiff, -1); assert.equal(rowDiff, -1); }
      else {
        assert.equal(decisionDiff, ftChain.firstChange, `${expected.seed} decision tapes diverge exactly at the first changed fallthrough`);
        assert.notEqual(rowDiff, -1);
        assert.ok(Math.min(exitChain.rowTimes[rowDiff], ftChain.rowTimes[rowDiff]) >= ftChain.firstChangeAt, `${expected.seed} no trade-tape difference before the first changed decision (row ${rowDiff}, exit t=${exitChain.rowTimes[rowDiff]}, ft t=${ftChain.rowTimes[rowDiff]}, first change ${ftChain.firstChangeAt}, rows ${exitChain.rows.length}/${ftChain.rows.length})`);
      }
      ft.prefix = { decisionDiff, firstChange: ftChain.firstChange, firstChangeAt: ftChain.firstChangeAt, rowDiff,
        rowDiffAt: rowDiff < 0 ? null : Math.min(exitChain.rowTimes[rowDiff], ftChain.rowTimes[rowDiff]),
        exitDecisions: exitChain.decisions.length, ftDecisions: ftChain.decisions.length };
      runs.push({ bounded, exit, ft });
      console.log(expected.seed, 'swaps', bounded.common.trades, exit.common.trades, ft.common.trades, 'anchors match; first change at decision', decisionDiff, 'ms', ftChain.firstChangeAt);
      continue;
    }
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
    if(causal) {
      const saved=a1Reference.runs.find(row=>row.a1.seed===expected.seed).a1;
      for(const key of ['manifest','tapeSha256','fullTapeSha256','all','common','decisions','facts','baselineSchedule'])assert.deepEqual(a1[key],saved[key],`${expected.seed} A1 anchor ${key}`);
      const exit=run(expected.seed,'exit'),lease=run(expected.seed,'lease');
      runs.push({off,control,bounded,exit,lease,a1});
      console.log(expected.seed,'2x2 swaps',bounded.common.trades,exit.common.trades,lease.common.trades,a1.common.trades,'all anchors match');
    } else {
      assert.deepEqual(run(expected.seed, 'a1', false), a1, `${expected.seed} A1 repeat`);
      runs.push({ off, control, bounded, a1 });
      console.log(expected.seed, 'BOUNDED', bounded.common.trades, 'A1', a1.common.trades, 'swaps; all regression hashes and A1 repeat match');
    }
  }
  const result = { revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), fingerprints,
    defaults: DEFAULT_WORLD, cooldownMs: BOUNDED_REACTIVE_MS, interestMs: 300000, causal,
    instrumentationGuardSha256: hash(expiredBuyGuard), real: realMetrics,
    realAudit: { ...realAudit, bursts: { ...realAudit.bursts, perPath: undefined } }, runs };
  writeFileSync(join(out, requestedSeed ? `${requestedSeed}.json` : 'summary.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
} finally {
  delete globalThis.__a1ExpiredBuy;
  delete globalThis.__a1PolicyTrace;
  assert.equal(resolve(temp, '..'), resolve(tmpdir()), 'Cleanup stays inside the temporary directory');
  rmSync(temp, { recursive: true, force: true });
}
