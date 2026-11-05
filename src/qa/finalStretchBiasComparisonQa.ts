import { defaultBaselineConfig, runMarketBehaviorBaseline } from './marketBehaviorBaseline';
import { compareFinalStretchBias } from './finalStretchBiasComparison';

const a = runMarketBehaviorBaseline({ ...defaultBaselineConfig, seeds: ['paired-fixture'], tokensPerSeed: 3, horizonSec: 3 });
const b = JSON.parse(JSON.stringify(a)) as typeof a;
// Hand-defined outcomes exercise censoring and transitions independently of rare natural graduates.
for (const result of [a, b]) {
  for (const token of result.tokens) {
    token.first80Sec = 1;
    token.from80 = { ...token.preMigration };
    token.migratedAtSec = null;
  }
}
a.tokens[0]!.migratedAtSec = 2;
b.tokens[1]!.migratedAtSec = 2.5;
a.tokens[2]!.migratedAtSec = 2;
b.tokens[2]!.migratedAtSec = 2.5;
b.tokens[0]!.from80!.maxDrawdownPct = a.tokens[0]!.from80!.maxDrawdownPct + 10;
b.tokens[1]!.returnedBelow80 = true;
b.tokens.reverse();
const report = compareFinalStretchBias(a, b);
const outcomes = report.pairedInitial.migrationOutcomes;
if (outcomes.both !== 1 || outcomes.onlyA !== 1 || outcomes.onlyB !== 1 || outcomes.neither !== 0) {
  throw new Error('Incorrect paired migration outcomes');
}
if (report.pairedInitial.migrationTimeSec.n !== 1 || report.pairedInitial.migrationTimeSec.p50 !== 0.5) {
  throw new Error('Censored tokens were treated as migration times');
}
if (report.pairedFirst80.from80DrawdownPp.increased !== 1 || report.cohortB.returnedBelow80ShareOfEntrants !== 1 / 3) {
  throw new Error('Incorrect paired delta or return denominator');
}
let rejected = false;
b.tokens[0]!.first80Sec = 0;
try { compareFinalStretchBias(a, b); } catch { rejected = true; }
if (!rejected) throw new Error('Accepted divergence before treatment');
console.log('Final Stretch comparison QA: PASS (id pairing, deltas, censoring, denominators, pre-treatment equality)');
