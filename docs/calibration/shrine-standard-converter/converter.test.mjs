import assert from 'node:assert/strict';
import test from 'node:test';
import { compare, compareLifecycle } from './compare.mjs';
import { atomic, convert, lifecycle, parseAmounts, SOL, stage, uniqueOrder } from './normalize.mjs';

function row(fields = {}) {
  return { protocol: 'PUMPFUN', action: 'buy', quoteMint: SOL, mint: 'mint', block: 10,
    timestamp: 20, signature: 'sig', quoteInPool: '30.01', tokensInPool: '1072999999.000001',
    breakdown: [{ action: 'buy', quoteAmount: '0.01', tokenAmount: '0.999999', trader: 'wallet' }],
    ...fields };
}

test('converts source numeric lexemes exactly, including unsafe integers and exponent notation', () => {
  const decoded = parseAmounts('{"tokenAmount":9007199254.740993,"quoteAmount":1e-9,"timestamp":20}');
  assert.equal(atomic(decoded.tokenAmount, 6), 9_007_199_254_740_993n);
  assert.equal(atomic(decoded.quoteAmount, 9), 1n);
  assert.equal(decoded.timestamp, 20);
  assert.equal(atomic('1.0000000001', 9), null);
  assert.equal(atomic('-1', 9), null);
  assert.equal(atomic(undefined, 9), null);
});

test('normalizes fee-exclusive legs and reverses reserve moves for both sides', () => {
  const sell = row({ signature: 'sell', action: 'sell', quoteInPool: '30', tokensInPool: '1073000000',
    breakdown: [{ action: 'sell', quoteAmount: '0.01', tokenAmount: '0.999999', trader: 'wallet' }] });
  const { trades } = convert([row({ quoteAmount: '0.010125' }), { ...sell, block: 11 }], new Set());
  assert.equal(trades[0].sol, 10_000_000n);
  assert.equal(trades[0].tokens, 999_999n);
  assert.equal(trades[0].preSol, 30_000_000_000n);
  assert.equal(trades[0].preTokens, 1_073_000_000_000_000n);
  assert.equal(trades[1].preSol, 30_010_000_000n);
  assert.equal(trades[1].preTokens, 1_072_999_999_000_001n);
});

test('keeps a dust sale with zero quote and a positive token movement', () => {
  const dust = row({ action: 'sell', breakdown: [{ action: 'sell', quoteAmount: '0',
    tokenAmount: '0.000001', trader: 'wallet' }] });
  const { trades } = convert([dust], new Set());
  assert.equal(trades[0].sol, 0n);
  assert.equal(trades[0].preSol, trades[0].r1);
  assert.equal(trades[0].preTokens, trades[0].r2 - 1n);
});

test('quarantines all legs of unresolved records and blocks order for their neighbors', () => {
  const first = row();
  const multi = row({ signature: 'multi', breakdown: [...first.breakdown, ...first.breakdown] });
  const repeated = row({ signature: 'repeat', mint: 'another' });
  const report = convert([first, multi, repeated, { ...repeated }, row({ mint: 'mayhem' }),
    row({ mint: 'non-sol', quoteMint: 'USDC' }), row({ protocol: 'PUMPSWAP' })], new Set(['mayhem']));
  assert.equal(report.trades.length, 1);
  assert.equal(report.trades[0].orderInSlot, null);
  assert.equal(report.trades[0].orderStatus, 'rejected_neighbor');
  assert.deepEqual(report.rejected.map((r) => [r.reason, r.legCount]), [
    ['multiple_legs', 2], ['repeated_signature', 1], ['repeated_signature', 1],
  ]);
  assert.deepEqual(report.separate, { mayhemRows: 1, nonSolRows: 1 });
});

test('assigns order only for an unambiguous chain using both reserves', () => {
  const a = { preSol: 1n, preTokens: 4n, r1: 2n, r2: 3n };
  const b = { preSol: 2n, preTokens: 3n, r1: 3n, r2: 2n };
  const c = { preSol: 3n, preTokens: 2n, r1: 4n, r2: 1n };
  assert.deepEqual(uniqueOrder([c, a, b]), [a, b, c]);
  assert.equal(uniqueOrder([a, b, { ...c, preSol: 8n }]), null);
  assert.equal(uniqueOrder([a, b, { ...c, preSol: 2n, preTokens: 3n }]), null);
  assert.equal(uniqueOrder([a, { preSol: 2n, preTokens: 3n, r1: 1n, r2: 4n }]), null);
});

test('uses the benchmark’s exact stage boundaries and isolates completion from pool creation', () => {
  const at80 = 1_073_000_000_000_000n - 793_100_000_000_000n * 8n / 10n;
  const at90 = 1_073_000_000_000_000n - 793_100_000_000_000n * 9n / 10n;
  assert.deepEqual([at80 + 1n, at80, at90 + 1n, at90].map(stage), ['0_80', '80_90', '80_90', '90_100']);
  const events = lifecycle([row({ action: 'curveComplete' }), row({ protocol: 'PUMPSWAP',
    action: 'createPool', mint: SOL, quoteMint: 'mint', pool: 'pool' })], new Set(['mint']));
  const report = compareLifecycle(events, [{ kind: 'migrate', mint: 'mint', slot: 10, ts: 20, pool: 'pool' }]);
  assert.equal(report.complete.exactUnique, 0);
  assert.equal(report.migrate.exactUnique, 1);
});

test('reports an excluded candidate once per Real C row and never assigns ambiguous identities', () => {
  const multi = row({ block: 11, signature: 'multi', breakdown: [...row().breakdown, ...row().breakdown] });
  const converted = convert([row(), multi], new Set());
  const real = { ...converted.trades[0], idx: 0, seq: 0 };
  const result = compare(converted, [real, { ...real, seq: 1 }, { ...real, slot: 11 }]);
  assert.equal(result.pairs.exactUnique, 0);
  assert.deepEqual(result.realBins.all.outcomes, {
    exact_ambiguous: { rows: 2, solLamports: 20_000_000n },
    excluded_exact_candidate: { rows: 1, solLamports: 10_000_000n },
  });
  assert.equal(result.counts.shrineRejectedLegs, 2);
  assert.equal(result.counts.realTransactions, 2);
  assert.equal(compare(converted, [real]).pairs.reservesExact, 1);
  const competing = convert([row(), { ...multi, block: 10 }], new Set());
  assert.equal(compare(competing, [real]).realBins.all.outcomes.exact_ambiguous.rows, 1);
});
