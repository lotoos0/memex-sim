import { getSessionBucket } from '../market/session';
import { RNG } from '../engine/rng';
import { generateToken, getFateTimeoutSimMs, getStartingMcapUsd } from '../tokens/generator';
import { pickFreshLaunchFate, rollStillbornLaunch, STILLBORN_LAUNCH_SHARE } from '../tokens/freshLaunch';
import { TokenSim } from '../tokens/tokenSim';

// Stillborn launches are the coins whose creator never traded (~20% on 2026-10-15).
// They must not take the dev buy, and they must stay on the curve start mcap.
const N = 400;
const failures: string[] = [];
let checks = 0;

function check(condition: boolean, label: string): void {
  checks += 1;
  if (!condition) failures.push(label);
}

const startMs = Date.UTC(2026, 9, 15, 8, 0, 0);
let now = startMs;
const previous = Date.now;
Date.now = () => now;

let stillborn = 0;
let stillbornMoved = 0;
let stillbornBought = 0;
let alive = 0;
let aliveBought = 0;

try {
  for (let i = 0; i < N; i++) {
    const rng = new RNG(`stillborn-qa:${i}`);
    const fate = pickFreshLaunchFate(rng);
    const meta = generateToken(rng, 0, fate);
    const sim = new TokenSim(meta, getStartingMcapUsd(fate, rng), getFateTimeoutSimMs(fate, rng));
    const isStillborn = rollStillbornLaunch(rng);
    if (isStillborn) sim.markStillbornLaunch();
    sim.enableDormantFastPath();
    const startMcap = sim.getLastMcapUsd();
    let devBuy = false;
    for (let step = 0; step < 5; step++) {
      now += 200;
      const events = sim.tick(0.2, getSessionBucket(now));
      if (events.some((event) => event.type === 'DEV_BUY')) devBuy = true;
    }
    const moved = Math.abs(sim.getLastMcapUsd() - startMcap) / startMcap;
    if (isStillborn) {
      stillborn += 1;
      if (devBuy) stillbornBought += 1;
      if (moved > 0.001) stillbornMoved += 1;
    } else {
      alive += 1;
      if (devBuy) aliveBought += 1;
    }
  }
} finally {
  Date.now = previous;
}

const share = stillborn / N;
check(Math.abs(STILLBORN_LAUNCH_SHARE - 0.22) < 1e-9, `share/constant ${STILLBORN_LAUNCH_SHARE}`);
check(share > 0.15 && share < 0.30, `share/sample ${(share * 100).toFixed(1)}% (${stillborn}/${N})`);
check(stillbornBought === 0, `stillborn/dev-buy ${stillbornBought}`);
check(stillbornMoved === 0, `stillborn/mcap-moved ${stillbornMoved}`);
check(alive > 0 && aliveBought / alive > 0.95, `alive/dev-buy ${(aliveBought / Math.max(1, alive) * 100).toFixed(1)}%`);

console.log(
  `stillborn launch: share ${(share * 100).toFixed(1)}% (${stillborn}/${N}), dev buys ${stillbornBought}, mcap moved ${stillbornMoved}, alive dev buys ${aliveBought}/${alive}`,
);

for (const failure of failures) console.error(`FAIL ${failure}`);
console.log(`Stillborn launch QA: ${checks - failures.length}/${checks} checks passed`);
if (failures.length > 0) throw new Error(`Stillborn launch QA: ${failures.length} failures`);
