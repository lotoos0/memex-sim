import { ConditionalActivity, CONDITIONAL_ACTIVITY } from '../tokens/conditionalActivity';
import { TokenSim } from '../tokens/tokenSim';
import { RNG } from '../engine/rng';
import { generateToken } from '../tokens/generator';

function assert(ok: boolean, label: string): void { if (!ok) throw new Error(label); }
function near(a: number, b: number, label: string): void { assert(Math.abs(a - b) < 1e-10, label); }

const memory = new ConditionalActivity();
near(memory.extraPerSec(1000, 1), 0, 'no spontaneous interest');
memory.commit(1000, 1);
near(memory.extraPerSec(1000, 1), 0.075, 'actual executed print');
near(memory.extraPerSec(9000, 1), 0.075 / Math.E, 'exponential decay');
near(memory.extraPerSec(1000, 1), 0.075, 'queries do not advance memory');
near(memory.extraPerSec(1000, 0), 0, 'zero organic rate stays zero');
const split = new ConditionalActivity();
split.commit(1000, 1);
for (let t = 1200; t <= 9000; t += 200) split.commit(t, 0);
near(split.extraPerSec(9000, 1), memory.extraPerSec(9000, 1), 'fixed-event tick partition invariance');
for (let t = 10000; t < 1000000; t += 100) {
  memory.commit(t, 100000);
  assert(memory.extraPerSec(t, 100) <= CONDITIONAL_ACTIVITY.maxExtraPerSec, 'long-series absolute bound');
  assert(memory.extraPerSec(t, 0.001) <= 0.005, 'long-series relative bound');
}
assert(memory.extraPerSec(2000000, 1) < 1e-30, 'long silence extinguishes interest');
let rejected = false;
try { memory.commit(0, 1); } catch { rejected = true; }
assert(rejected, 'backward observation rejected');

const originalNow = Date.now;
let now = Date.parse('2026-10-15T08:00:00Z');
Date.now = () => now;
try {
  const rng = new RNG('P1-qa');
  const meta = { ...generateToken(rng, 0, 'NORMAL'), id: 'p1-end-tick' };
  const sim = new TokenSim(meta, 2000, 1000000);
  const commit = sim['conditionalActivity'].commit.bind(sim['conditionalActivity']);
  let commits = 0;
  sim['conditionalActivity'].commit = (time, count) => {
    near(sim['conditionalActivity'].extraPerSec(time, 1), 0, 'current tick cannot excite itself');
    assert(count === sim['lifetimeTrades'] && count > 0, 'only recorded executions reach commit');
    assert(sim['pendingActivityTrades'] === count, 'commit after recording tick');
    commits++;
    commit(time, count);
  };
  now += 200;
  sim.tick(0.2);
  assert(commits === 1 && sim['pendingActivityTrades'] === 0, 'one end-tick commit and cleared buffer');
  assert(sim['conditionalActivity'].extraPerSec(sim['simTimeMs'], 1) > 0, 'next tick can observe completed prints');
  sim.markStillbornLaunch();
  const withMemory = sim['organicArrivalPerSec'](1, now);
  sim['conditionalActivity'].extraPerSec = () => 1e9;
  near(sim['organicArrivalPerSec'](1, now), withMemory, 'stillborn ignores memory');
  sim['stillbornLaunch'] = false;
  sim['flowSilentAfterSimMs'] = 0;
  near(sim['organicArrivalPerSec'](1, now), withMemory, 'silenced ignores memory');
  const before = sim['pendingActivityTrades'];
  assert(!sim['executeSimBuyTrade'](0, now), 'failed fill fixture');
  assert(sim['pendingActivityTrades'] === before, 'failed fill does not excite');
} finally { Date.now = originalNow; }
console.log('Conditional activity QA: PASS');
