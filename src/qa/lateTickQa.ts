import { CandleAggregator } from '../engine/aggregator';

// Diagnostic only. Current behavior is characterized separately from the planned
// contract; contract failures remain visible and make this standalone run fail.
const failures: string[] = [];
let currentChecks = 0;
let contractChecks = 0;
let currentFailures = 0;
let contractFailures = 0;
function check(group: 'current' | 'contract', condition: boolean, label: string): void {
  if (group === 'current') currentChecks++;
  else contractChecks++;
  if (condition) return;
  if (group === 'current') currentFailures++;
  else contractFailures++;
  failures.push(`${group}/${label}`);
}

for (const tf of [1, 15, 30, 60]) {
  const base = 1_800_000_000_000;
  const span = tf * 1000;
  const label = `${tf}s`;
  const chronological = new CandleAggregator(tf);
  const first = chronological.pushTick(base + 100, 10, 2);
  const second = chronological.pushTick(base + 300, 14, 3);
  check('contract', first.mode === 'new' && second.mode === 'update', `${label}/chronological-accepted`);
  const equal = chronological.pushTick(base + 300, 8, 4);
  const equalAgain = chronological.pushTick(base + 300, 12, 5);
  check('contract', equal.mode === 'update' && equalAgain.mode === 'update'
    && chronological.getSeries()[0]!.close === 12, `${label}/equal-time-insertion-order`);
  const sparse = chronological.pushTick(base + 5 * span + 100, 20, 6);
  check('contract', sparse.mode === 'new' && chronological.getSeries().length === 2
    && sparse.candle.time === (base / 1000) + 5 * tf, `${label}/sparse-no-synthetic-buckets`);
  check('contract', sparse.candle.open === 12 && sparse.candle.high === 20
    && sparse.candle.low === 12 && sparse.candle.close === 20, `${label}/continuity-open-preserved`);
  check('contract', chronological.getSeries().reduce((sum, c) => sum + c.volume, 0) === 20,
    `${label}/chronological-volume-once`);

  for (const previousBucket of [false, true]) {
    const aggregator = new CandleAggregator(tf);
    aggregator.pushTick(base + 100, 10, 2);
    if (previousBucket) aggregator.pushTick(base + span + 300, 20, 3);
    else aggregator.pushTick(base + 300, 20, 3);
    // getSeries copies only the array. Clone each candle before testing mutation.
    const before = aggregator.getSeries().map((c) => ({ ...c }));
    const scenario = `${label}/late-${previousBucket ? 'previous' : 'same'}-bucket`;
    const result: unknown = aggregator.pushTick(base + 200, 1, 7);
    const after = aggregator.getSeries();
    const last = after[after.length - 1]!;
    check('current', typeof result === 'object' && result !== null
      && 'mode' in result && result.mode === 'update', `${scenario}/reports-update`);
    check('current', after.length === before.length && last.close === 1 && last.low === 1
      && last.volume === before[before.length - 1]!.volume + 7, `${scenario}/mutates-latest`);
    // Planned local API recommendation, not a production type or implementation.
    check('contract', typeof result === 'object' && result !== null
      && 'mode' in result && result.mode === 'rejected'
      && 'reason' in result && result.reason === 'late', `${scenario}/explicit-rejection`);
    check('contract', JSON.stringify(after) === JSON.stringify(before), `${scenario}/all-OHLCV-unchanged`);
    // Rejection must not lower the watermark: 250 is still older than accepted 300.
    const afterFirst = JSON.stringify(after);
    aggregator.pushTick(base + 250, 2, 11);
    check('contract', JSON.stringify(aggregator.getSeries()) === afterFirst,
      `${scenario}/rejection-does-not-lower-watermark`);
  }

  chronological.reset();
  check('contract', chronological.getSeries().length === 0, `${label}/reset-clears-series`);
  const restarted = chronological.pushTick(base - span, 7, 9);
  check('contract', restarted.mode === 'new' && chronological.getSeries().length === 1
    && restarted.candle.time === base / 1000 - tf && restarted.candle.open === 7
    && restarted.candle.close === 7 && restarted.candle.volume === 9, `${label}/reset-allows-earlier-time`);
}
for (const failure of failures) console.error(`FAIL ${failure}`);
console.log(`Current behavior: ${currentChecks - currentFailures}/${currentChecks} passed`);
console.log(`Expected SIM contract: ${contractChecks - contractFailures}/${contractChecks} passed; ${contractFailures} diagnostic discrepancies`);
if (failures.length) throw new Error(`Late tick QA: ${failures.length} discrepancies (diagnostic, not a CI gate)`);
