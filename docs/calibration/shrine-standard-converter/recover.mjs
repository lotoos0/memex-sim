import { atomic, groupBy, isSwap, key, SOL, stage } from './normalize.mjs';

const MAX_ANCHORS = 12;
const MAX_SEARCH_STEPS = 10_000;
const groupKey = (row) => key(row.slot ?? row.block, row.mint);
const sourceKey = (row) => key(row.file, row.line);
const provenance = ({ file, line, signature }) => ({ file, line, signature });

function legAmounts(row) {
  if (!Array.isArray(row.breakdown) || row.breakdown.length !== 2) return null;
  const [first, second] = row.breakdown;
  if (!first || !second || !isSwap(row.action) ||
    typeof first.trader !== 'string' || !first.trader || first.trader !== second.trader) return null;
  const legs = [first, second];
  if (legs.some((leg) => leg.action !== row.action || (leg.mint != null && leg.mint !== row.mint) ||
    (leg.stage != null && leg.stage !== 'curve'))) return null;
  const amounts = legs.map((leg) => ({ wallet: leg.trader, sol: atomic(leg.quoteAmount, 9),
    tokens: atomic(leg.tokenAmount, 6) }));
  return amounts.every(({ sol, tokens }) => sol !== null && tokens !== null && tokens > 0n) ? amounts : null;
}

const stateKey = (sol, tokens) => `${sol}:${tokens}`;
const edge = (trade) => ({ from: stateKey(trade.preSol, trade.preTokens), to: stateKey(trade.r1, trade.r2) });

function candidateEdges(anchors, leg, sign, observed) {
  const states = new Map();
  for (const trade of anchors) {
    states.set(stateKey(trade.r1, trade.r2), [trade.r1, trade.r2]);
    // A chain with the candidate first still competes with any bracketed interpretation.
    const sol = trade.preSol - sign * leg.sol;
    const tokens = trade.preTokens + sign * leg.tokens;
    states.set(stateKey(sol, tokens), [sol, tokens]);
  }
  const candidates = [];
  for (const [preSol, preTokens] of states.values()) {
    const r1 = preSol + sign * leg.sol;
    const r2 = preTokens - sign * leg.tokens;
    if (preSol <= 0n || preTokens <= 0n || r1 <= 0n || r2 <= 0n) continue;
    if ((observed.r1 > 0n && r1 !== observed.r1) || (observed.r2 > 0n && r2 !== observed.r2)) continue;
    candidates.push({ ...leg, preSol, preTokens, r1, r2 });
  }
  return candidates;
}

export function proveRecovery(row, anchors) {
  if (anchors.length < 2) return 'insufficient_anchors';
  if (anchors.length > MAX_ANCHORS) return 'search_limit';
  const legs = legAmounts(row);
  if (!legs) return 'unsupported_legs';
  const observed = { r1: atomic(row.quoteInPool, 9), r2: atomic(row.tokensInPool, 6) };
  if ((row.quoteInPool != null && observed.r1 === null) || (row.tokensInPool != null && observed.r2 === null)) {
    return 'invalid_observed_reserves';
  }
  const anchorEdges = anchors.map(edge);
  const candidateIndex = anchors.length;
  const sign = row.action === 'buy' ? 1n : -1n;
  let steps = 0;
  let solution = null;
  let conflict = false;
  for (const [legIndex, leg] of legs.entries()) {
    for (const trade of candidateEdges(anchors, leg, sign, observed)) {
      const edges = [...anchorEdges, edge(trade)];
      const byStart = groupBy(edges.map((part, index) => ({ ...part, index })), (part) => part.from);
      const visit = (part, used, path) => {
        if (conflict || steps >= MAX_SEARCH_STEPS) return;
        steps++;
        const nextPath = [...path, part.index];
        if (nextPath.length === edges.length) {
          if (solution) conflict = true;
          else solution = { trade, legIndex, path: nextPath };
          return;
        }
        const nextUsed = used | (1 << part.index);
        for (const next of byStart.get(part.to) ?? []) {
          if (!(nextUsed & (1 << next.index))) visit(next, nextUsed, nextPath);
        }
      };
      for (const starts of byStart.values()) {
        for (const start of starts) visit(start, 0, []);
      }
      if (conflict) return 'ambiguous_chain';
      if (steps >= MAX_SEARCH_STEPS) return 'search_limit';
    }
  }
  if (!solution) return 'no_exact_chain';
  const index = solution.path.indexOf(candidateIndex);
  if (index === 0 || index === candidateIndex) return 'unbracketed_chain';
  return { ...solution, index, observed, legs };
}

export function recoverMultiLeg(rows, converted) {
  const rawByGroup = groupBy(rows.filter((row) => row.protocol === 'PUMPFUN'), groupKey);
  const orderByGroup = new Map(converted.orderGroups.map((group) => [groupKey(group.rows[0]), group]));
  const rejected = [];
  const recovered = [];
  const replacementGroups = new Map();
  const outcomes = {};
  for (const [id, excluded] of groupBy(converted.rejected, groupKey)) {
    const candidates = excluded.filter((row) => row.reason === 'multiple_legs' && row.legCount === 2);
    if (!candidates.length) {
      rejected.push(...excluded);
      continue;
    }
    let result = 'other_rejected_record';
    const group = orderByGroup.get(id);
    const raw = rawByGroup.get(id) ?? [];
    const source = raw.find((row) => sourceKey(row) === sourceKey(candidates[0]));
    if (excluded.length === 1) {
      const anchors = group?.rows ?? [];
      result = source && raw.length === anchors.length + 1 && raw.every((row) => row.quoteMint === SOL && isSwap(row.action))
        ? proveRecovery(source, anchors) : 'other_source_record';
    }
    if (typeof result === 'string') {
      outcomes[result] = (outcomes[result] ?? 0) + candidates.length;
      rejected.push(...excluded);
      continue;
    }
    const { trade, legIndex, path, index, observed, legs } = result;
    const anchors = group.rows;
    const swap = { ...provenance(source), ts: source.timestamp, slot: source.block, mint: source.mint,
      side: source.action, legCount: 2, ...trade, preStage: stage(trade.preTokens), postStage: stage(trade.r2),
      orderStatus: 'resolved', orderInSlot: index,
      recovery: { method: 'exact_bracketed_reserve_chain', selectedLegIndex: legIndex, observedPost: observed,
        sourceLegs: legs, preceding: provenance(anchors[path[index - 1]]), following: provenance(anchors[path[index + 1]]) } };
    recovered.push(swap);
    outcomes.recovered = (outcomes.recovered ?? 0) + 1;
    const ordered = path.map((anchorIndex, rank) => rank === index ? swap :
      { ...anchors[anchorIndex], orderStatus: 'resolved', orderInSlot: rank });
    replacementGroups.set(id, { rows: ordered, ordered, status: 'resolved' });
  }
  const orderGroups = converted.orderGroups.map((group) => replacementGroups.get(groupKey(group.rows[0])) ?? group);
  const after = { ...converted, rejected, orderGroups, trades: orderGroups.flatMap((group) => group.rows) };
  return { after, recovered, outcomes };
}
