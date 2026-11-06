import assert from 'node:assert/strict';
import test from 'node:test';
import { compare } from './compare.mjs';
import { convert, SOL } from './normalize.mjs';
import { proveRecovery, recoverMultiLeg } from './recover.mjs';

const leg = (quoteAmount = '20e-9', tokenAmount = '40e-6', fields = {}) =>
  ({ trader: 'wallet', action: 'buy', quoteAmount, tokenAmount, ...fields });

function raw(signature, line, breakdown, fields = {}) {
  return { file: 'shrine.jsonl.zst', line, signature, mint: 'mint', block: 10, timestamp: 42,
    protocol: 'PUMPFUN', quoteMint: SOL, action: 'buy', breakdown, ...fields };
}

const prior = raw('prior', 3, [leg('10e-9', '20e-6')], { quoteInPool: '1000e-9', tokensInPool: '9000e-6' });
const later = raw('later', 1, [leg('30e-9', '60e-6')], { quoteInPool: '1050e-9', tokensInPool: '8900e-6' });
const multi = raw('multi', 2, [leg('21e-9'), leg()], { quoteInPool: '0', tokensInPool: '0' });
const anchors = convert([later, prior], new Set()).trades;

test('recovers only the leg bracketed by independent exact states, even when its source arrived out of order', () => {
  const rows = [later, multi, prior];
  const before = convert(rows, new Set());
  const { recovered, after, outcomes } = recoverMultiLeg(rows, before);
  assert.deepEqual(outcomes, { recovered: 1 });
  assert.equal(before.trades.length, 2);
  assert.equal(before.trades[0].orderInSlot, null);
  assert.equal(before.rejected.length, 1);
  assert.equal(after.rejected.length, 0);
  assert.deepEqual(after.orderGroups[0].ordered.map((row) => row.signature), ['prior', 'multi', 'later']);
  assert.deepEqual([recovered[0].sol, recovered[0].tokens, recovered[0].preSol, recovered[0].r1,
    recovered[0].preTokens, recovered[0].r2], [20n, 40n, 1000n, 1020n, 9000n, 8960n]);
  assert.deepEqual(recovered[0].recovery, { method: 'exact_bracketed_reserve_chain', selectedLegIndex: 1,
    observedPost: { r1: 0n, r2: 0n }, sourceLegs: [{ wallet: 'wallet', sol: 21n, tokens: 40n },
      { wallet: 'wallet', sol: 20n, tokens: 40n }],
    preceding: { file: prior.file, line: prior.line, signature: prior.signature },
    following: { file: later.file, line: later.line, signature: later.signature } });

  const reference = [{ ...recovered[0], idx: 2, seq: 0 }];
  assert.equal(compare(after, reference).recoveredPairs.reservesExact, 1);
  assert.equal(compare(after, [{ ...reference[0], sol: 21n }]).recoveredPairs.exactUnique, 0);
  assert.equal(recovered[0].sol, 20n);
});

test('checks exact atomic amounts, leg identity, and every positive observed reserve', () => {
  const withReserves = { ...multi, quoteInPool: '1020e-9', tokensInPool: '8960e-6' };
  assert.equal(proveRecovery(withReserves, anchors).legIndex, 1);
  assert.equal(proveRecovery({ ...withReserves, quoteInPool: '1021e-9' }, anchors), 'no_exact_chain');
  assert.equal(proveRecovery({ ...withReserves, tokensInPool: '8961e-6' }, anchors), 'no_exact_chain');
  assert.equal(proveRecovery({ ...withReserves, quoteInPool: '1020.1e-9' }, anchors), 'invalid_observed_reserves');
  assert.equal(proveRecovery({ ...multi, breakdown: [leg('21e-9'), leg(undefined, undefined, { mint: 'other' })] },
    anchors), 'unsupported_legs');
  assert.equal(proveRecovery({ ...multi, breakdown: [leg('21e-9'), leg(undefined, undefined, { trader: 'other' })] },
    anchors), 'unsupported_legs');
  assert.equal(proveRecovery({ ...multi, breakdown: [leg('21e-9'), leg(undefined, undefined, { action: 'sell' })] },
    anchors), 'unsupported_legs');
});

test('checks both reserve deltas for a SELL', () => {
  const sell = raw('sell', 2, [leg('21e-9', '40e-6', { action: 'sell' }), leg('20e-9', '40e-6', { action: 'sell' })],
    { action: 'sell' });
  const sellLater = { ...later, breakdown: [leg('40e-9', '70e-6')], quoteInPool: '1020e-9', tokensInPool: '8970e-6' };
  const sameSlot = convert([sellLater, prior], new Set()).trades;
  const result = proveRecovery(sell, sameSlot);
  assert.equal(result.legIndex, 1);
  assert.deepEqual([result.trade.r1, result.trade.r2], [980n, 9040n]);
});

test('rejects a duplicate candidate, an unbridged reserve gap and an additional unresolved record', () => {
  assert.equal(proveRecovery({ ...multi, breakdown: [leg(), leg()] }, anchors), 'ambiguous_chain');
  assert.equal(proveRecovery(multi, [{ ...anchors[0], preTokens: 8959n }, anchors[1]]), 'no_exact_chain');
  const other = { ...multi, line: 4, signature: 'other' };
  const rows = [prior, multi, later, other];
  assert.deepEqual(recoverMultiLeg(rows, convert(rows, new Set())).outcomes, { other_rejected_record: 2 });
  const withEvent = [prior, multi, later, { ...other, action: 'curveComplete' }];
  assert.deepEqual(recoverMultiLeg(withEvent, convert(withEvent, new Set())).outcomes, { other_source_record: 1 });
  const withOtherSlot = [prior, multi, { ...later, block: 11 }];
  assert.deepEqual(recoverMultiLeg(withOtherSlot, convert(withOtherSlot, new Set())).outcomes, { insufficient_anchors: 1 });
});

test('does not recover a candidate at an endpoint or when an endpoint is a competing interpretation', () => {
  const contiguous = [anchors[1], { ...anchors[0], preSol: 1000n, preTokens: 9000n, r1: 1030n, r2: 8940n }];
  const observed = { ...multi, quoteInPool: '1000e-9', tokensInPool: '9000e-6' };
  assert.equal(proveRecovery(observed, contiguous), 'no_exact_chain');
  const last = { ...multi, quoteInPool: '1050e-9', tokensInPool: '8900e-6' };
  assert.equal(proveRecovery(last, contiguous), 'unbracketed_chain');
  const cycle = [anchors[1], { ...anchors[0], preSol: 1020n, preTokens: 8960n, r1: 990n, r2: 9020n }];
  assert.equal(proveRecovery(multi, cycle), 'ambiguous_chain');
});
