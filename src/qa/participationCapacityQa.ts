import { ParticipationCapacity } from '../tokens/participationCapacity';
import { TokenSim } from '../tokens/tokenSim';
import { RNG } from '../engine/rng';
import { generateToken } from '../tokens/generator';

function check(condition: boolean, label: string): void {
  if (!condition) throw new Error(label);
}

function warm(step: number): ParticipationCapacity {
  const capacity = new ParticipationCapacity();
  for (let start = 0; start < 100_000; start += step) {
    capacity.begin(start, start + step, 0, true);
    for (const age of [Math.ceil(start / 5000) * 5000 + 1, Math.ceil(start / 5000) * 5000 + 2]) {
      if (age < start + step) capacity.observe(age, age % 5000 === 1 ? 'BUY' : 'SELL');
    }
    capacity.settle();
  }
  return capacity;
}

const state = warm(200);
check(state['capacity'] > 0.4, 'persistent two-sided activity qualifies');
check(state['capacity'] === warm(1000)['capacity'], 'fixed-event time partition');
const first = state.begin(100_000, 100_200, 10, true);
check(state['pending']!.release === 0 && first < 10, 'current tick deposit is unavailable');
let duplicateRejected = false;
try { state.begin(100_000, 100_200, 10, true); } catch { duplicateRejected = true; }
check(duplicateRejected, 'duplicate begin rejected');
state.settle();
const initialCredit = state['lots'][0]!.mass;
state.settle();
check(state['lots'][0]!.mass === initialCredit, 'settlement is idempotent');
state.begin(100_200, 100_400, 1, true);
check(state['pending']!.release > 0, 'prior funds available');
state.settle();
state.begin(219_800, 220_000, 1, true);
check(state['lots'].length === 0 && state['pending']!.release === 0, 'expiry includes tick end');
state.settle();
const later = state.begin(10_000_000, 10_000_200, 1, true);
check(later < 1 && state['capacity'] < 1e-20, 'long gap expires credit and decays capacity');
state.clear();
check(state['lots'].length === 0 && state['activity'].size === 0 && !state['pending'], 'terminal reset');
state.settle();
check(state.begin(10_000_200, 10_000_400, 1, false) === 1, 'protected interval uses reference rate');
state.settle();
check(state['lots'].length === 0, 'protected interval accrues no funds');

const burst = new ParticipationCapacity();
check(burst.begin(0, 200, 1, true) === 1, 'warm-up preserves arrivals');
for (let i = 0; i < 1000; i++) burst.observe(100, i % 2 ? 'BUY' : 'SELL');
burst.settle();
burst.begin(60_000, 60_200, 1, true);
check(burst['capacity'] === 0, 'one burst cannot qualify');
burst.settle();

const now = Date.now;
try {
  let clock = 1_800_000_000_000;
  Date.now = () => clock;
  for (const terminal of ['stillborn', 'dead', 'silent'] as const) {
    const meta = generateToken(new RNG(terminal), 0, 'NORMAL');
    const token = new TokenSim(meta, 2_000, 1_800_000);
    const capacity = token['participation'];
    capacity.begin(60_000, 60_200, 10, true);
    capacity.settle();
    check(capacity['lots'].length > 0, 'terminal fixture has credit');
    if (terminal === 'stillborn') token.markStillbornLaunch();
    else if (terminal === 'dead') token['phase'] = 'DEAD';
    else token['flowSilentAfterSimMs'] = 0;
    clock += 200;
    token.tick(0.2);
    check(capacity['lots'].length === 0 && !capacity['pending'], `${terminal} tick clears reserve`);
  }
} finally {
  Date.now = now;
}
console.log('Participation capacity QA: PASS');
