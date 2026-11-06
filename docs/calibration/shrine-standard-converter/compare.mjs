import { groupBy, key, stage, states } from './normalize.mjs';

const weak = (t) => key(t.slot, t.mint, t.wallet, t.side);
const exact = (t) => key(weak(t), t.sol.toString(), t.tokens.toString());
const validAmounts = (t) => t.sol !== null && t.tokens !== null;
const abs = (a) => a < 0n ? -a : a;

function size(sol) {
  if (sol < 10_000_000n) return '<0.01';
  if (sol < 100_000_000n) return '0.01–<0.1';
  if (sol < 1_000_000_000n) return '0.1–<1';
  return '>=1';
}

function add(bins, label, trade, status) {
  const bin = bins[label] ??= { rows: 0, solLamports: 0n, outcomes: {} };
  const outcome = bin.outcomes[status] ??= { rows: 0, solLamports: 0n };
  bin.rows++;
  bin.solLamports += trade.sol ?? 0n;
  outcome.rows++;
  outcome.solLamports += trade.sol ?? 0n;
}

function addTrade(bins, trade, outcome) {
  add(bins, 'all', trade, outcome);
  add(bins, `side/${trade.side}`, trade, outcome);
  const preStage = trade.r2 === null || trade.tokens === null ? 'unknown' : stage(statesForStage(trade));
  add(bins, `stage/${preStage}`, trade, outcome);
  add(bins, `stage-side/${preStage}/${trade.side}`, trade, outcome);
  add(bins, `size-sol/${trade.sol === null ? 'unknown' : size(trade.sol)}`, trade, outcome);
}

function statesForStage(trade) {
  return trade.r2 + (trade.side === 'buy' ? trade.tokens : -trade.tokens);
}

export function compare(converted, reference) {
  const { trades, rejected, orderGroups, standardMints } = converted;
  const shrineExact = groupBy(trades, exact);
  const realExact = groupBy(reference.filter(validAmounts), exact);
  const shrineWeak = groupBy(trades, weak);
  const rejectedCandidates = rejected.flatMap((row) => row.candidates);
  const rejectedWeak = new Set(rejectedCandidates.map(weak));
  const rejectedExact = new Set(rejectedCandidates.filter(validAmounts).map(exact));
  const realByShrine = new Map();
  const realBins = {};
  const shrineBins = {};
  const pairs = { exactUnique: 0, reserveComparable: 0, reservesExact: 0, reservesWithinOne: 0,
    sameTimestamp: 0, timestampDeltaSeconds: {}, exactPairsWithRealPoolLeg: 0,
    preStageComparable: 0, preStageEqual: 0, postStageEqual: 0 };
  for (const row of reference) {
    const id = validAmounts(row) ? exact(row) : null;
    const candidates = shrineExact.get(id) ?? [];
    let status;
    if (candidates.length === 1 && realExact.get(id).length === 1 && !rejectedExact.has(id)) {
      status = 'exact_unique';
      const trade = candidates[0];
      realByShrine.set(trade, row);
      pairs.exactUnique++;
      if (row.ts === trade.ts) pairs.sameTimestamp++;
      const delta = trade.ts - row.ts;
      pairs.timestampDeltaSeconds[delta] = (pairs.timestampDeltaSeconds[delta] ?? 0) + 1;
      if (row.pool_sol != null || row.pool_tokens != null) pairs.exactPairsWithRealPoolLeg++;
      if (row.r1 !== null && row.r2 !== null) {
        pairs.reserveComparable++;
        const solDifference = abs(row.r1 - trade.r1);
        const tokenDifference = abs(row.r2 - trade.r2);
        if (solDifference === 0n && tokenDifference === 0n) pairs.reservesExact++;
        if (solDifference <= 1n && tokenDifference <= 1n) pairs.reservesWithinOne++;
      }
      if (row.r2 !== null) {
        pairs.preStageComparable++;
        if (stage(statesForStage(row)) === trade.preStage) pairs.preStageEqual++;
        if (stage(row.r2) === trade.postStage) pairs.postStageEqual++;
      }
    } else if (candidates.length > 0) status = 'exact_ambiguous';
    else if (rejectedExact.has(id)) status = 'excluded_exact_candidate';
    else if (shrineWeak.has(weak(row))) status = 'retained_weak_only';
    else if (rejectedWeak.has(weak(row))) status = 'excluded_weak_candidate';
    else status = 'no_candidate';
    addTrade(realBins, row, status);
    if (!standardMints.has(row.mint)) add(realBins, 'unlabelled_mint', row, status);
  }
  for (const trade of trades) addTrade(shrineBins, trade, realByShrine.has(trade) ? 'exact_unique' : 'unpaired');

  const order = { groups: orderGroups.length, multiGroups: 0, resolved: 0, resolvedMulti: 0,
    rejectedNeighbor: 0, ambiguousOrGap: 0, fullyPairedMulti: 0, sameOrderMulti: 0 };
  for (const group of orderGroups) {
    const multi = group.rows.length > 1;
    if (multi) order.multiGroups++;
    if (group.status === 'rejected_neighbor') order.rejectedNeighbor++;
    else if (group.status === 'ambiguous_or_gap') order.ambiguousOrGap++;
    else {
      order.resolved++;
      if (!multi) continue;
      order.resolvedMulti++;
      const rows = group.ordered.map((trade) => realByShrine.get(trade));
      if (!rows.every(Boolean)) continue;
      order.fullyPairedMulti++;
      if (rows.every((row, index) => index === 0 || row.idx > rows[index - 1].idx ||
        (row.idx === rows[index - 1].idx && row.seq > rows[index - 1].seq))) order.sameOrderMulti++;
    }
  }
  const rejectsByReason = {};
  for (const row of rejected) rejectsByReason[row.reason] = (rejectsByReason[row.reason] ?? 0) + 1;
  const retainedSignatures = new Set(trades.map((row) => row.signature));
  const rejectedSignatures = new Set(rejected.map((row) => row.signature).filter(Boolean));
  const realTransactions = groupBy(reference, (row) => key(row.slot, row.idx));
  const pairedTransactions = new Set([...realByShrine.values()].map((row) => key(row.slot, row.idx)));
  return {
    counts: { shrineRetainedRows: trades.length, shrineRejectedRows: rejected.length,
      shrineRetainedSignatures: retainedSignatures.size, shrineRejectedSignatures: rejectedSignatures.size,
      shrineRejectedWithoutSignature: rejected.filter((row) => !row.signature).length,
      shrineRejectedLegs: rejected.reduce((sum, row) => sum + row.legCount, 0),
      realRows: reference.length, realTransactions: realTransactions.size,
      realTransactionsWithExactPair: pairedTransactions.size,
      realMultirowTransactionsInScope: [...realTransactions.values()].filter((rows) => rows.length > 1).length },
    pairs, order, rejectsByReason, shrineBins, realBins,
  };
}

export function compareLifecycle(shrine, real) {
  const counts = {};
  for (const kind of ['complete', 'migrate']) {
    const expected = real.filter((event) => event.kind === kind);
    const observed = shrine.filter((event) => event.kind === (kind === 'migrate' ? 'pool' : 'complete'));
    const eventKey = (event) => kind === 'complete' ? key(event.mint, event.slot, event.ts) :
      key(event.mint, event.slot, event.ts, event.pool);
    const fromShrine = groupBy(observed, eventKey);
    const fromReal = groupBy(expected, eventKey);
    const shared = [...fromReal].filter(([id, rows]) => rows.length === 1 && fromShrine.get(id)?.length === 1);
    counts[kind] = { realEvents: expected.length, shrineEventsOrPoolCandidates: observed.length,
      exactUnique: shared.length, realWithoutExactUnique: expected.length - shared.length,
      shrineWithoutExactUnique: observed.length - shared.length };
  }
  return counts;
}

export function transitions(reference) {
  let comparable = 0;
  let equal = 0;
  for (const rows of groupBy(reference, (row) => row.mint).values()) {
    rows.sort((a, b) => a.slot - b.slot || a.idx - b.idx || a.seq - b.seq);
    for (let i = 1; i < rows.length; i++) {
      const previous = rows[i - 1];
      const row = rows[i];
      if (!validAmounts(row) || row.r1 === null || row.r2 === null || previous.r1 === null || previous.r2 === null) continue;
      comparable++;
      const before = states(row);
      if (previous.r1 === before.preSol && previous.r2 === before.preTokens) equal++;
    }
  }
  return { comparable, equal };
}
