export const SOL = 'So11111111111111111111111111111111111111112';
const INITIAL_VIRTUAL_ATOMS = 1_073_000_000_000_000n;
const INITIAL_REAL_ATOMS = 793_100_000_000_000n;
const amountFields = new Set(['quoteAmount', 'tokenAmount', 'quoteInPool', 'tokensInPool']);

export function parseAmounts(line) {
  return JSON.parse(line, (key, value, context) =>
    amountFields.has(key) && typeof value === 'number' ? context.source : value);
}

export function atomic(decimal, places) {
  if (typeof decimal !== 'string') return null;
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(decimal);
  if (!match) return null;
  const [, whole, fraction = '', exponent = '0'] = match;
  const shift = places + Number(exponent) - fraction.length;
  if (Math.abs(shift) > 100) return null;
  const digits = BigInt(whole + fraction);
  const scale = 10n ** BigInt(Math.abs(shift));
  if (shift >= 0) return digits * scale;
  return digits % scale === 0n ? digits / scale : null;
}

export function stage(atoms) {
  const used = INITIAL_VIRTUAL_ATOMS - atoms;
  if (used * 10n < INITIAL_REAL_ATOMS * 8n) return '0_80';
  if (used * 10n < INITIAL_REAL_ATOMS * 9n) return '80_90';
  return '90_100';
}

export function key(...fields) {
  return JSON.stringify(fields);
}

export function groupBy(items, getKey) {
  const groups = new Map();
  for (const item of items) {
    const id = getKey(item);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(item);
  }
  return groups;
}

export function isSwap(side) {
  return side === 'buy' || side === 'sell';
}

export function states(trade) {
  const sign = trade.side === 'buy' ? 1n : -1n;
  return {
    preSol: trade.r1 - sign * trade.sol,
    preTokens: trade.r2 + sign * trade.tokens,
  };
}

function legCandidate(row, leg) {
  const sol = atomic(leg?.quoteAmount, 9);
  const tokens = atomic(leg?.tokenAmount, 6);
  if (!isSwap(leg?.action) || typeof leg.trader !== 'string' || !leg.trader) return null;
  return { slot: row.block, mint: row.mint, wallet: leg.trader, side: leg.action, sol, tokens };
}

function normalizeSwap(row, candidate) {
  if (!candidate || row.action !== candidate.side) return 'invalid_leg';
  if (candidate.sol === null || candidate.tokens === null) return 'non_atomic_amount';
  if (candidate.tokens <= 0n) return 'nonpositive_token_amount';
  const r1 = atomic(row.quoteInPool, 9);
  const r2 = atomic(row.tokensInPool, 6);
  if (r1 === null || r2 === null) return 'non_atomic_or_missing_reserves';
  if (r1 <= 0n || r2 <= 0n) return 'nonpositive_reserves';
  const trade = { ...candidate, r1, r2 };
  const before = states(trade);
  if (before.preSol <= 0n || before.preTokens <= 0n) return 'invalid_pre_reserves';
  return { ...trade, ...before, preStage: stage(before.preTokens), postStage: stage(r2) };
}

export function uniqueOrder(trades) {
  const endings = groupBy(trades, (t) => key(t.r1.toString(), t.r2.toString()));
  const next = new Map();
  const incoming = new Set();
  for (const trade of trades) {
    const previous = (endings.get(key(trade.preSol.toString(), trade.preTokens.toString())) ?? [])
      .filter((entry) => entry !== trade);
    if (previous.length > 1) return null;
    if (previous.length === 0) continue;
    if (next.has(previous[0])) return null;
    next.set(previous[0], trade);
    incoming.add(trade);
  }
  const roots = trades.filter((trade) => !incoming.has(trade));
  if (roots.length !== 1 || next.size !== trades.length - 1) return null;
  const ordered = [];
  for (let trade = roots[0]; trade; trade = next.get(trade)) ordered.push(trade);
  return ordered.length === trades.length ? ordered : null;
}

export function convert(rows, mayhem) {
  const trades = [];
  const rejected = [];
  const separate = { mayhemRows: 0, nonSolRows: 0 };
  const eligible = [];
  for (const row of rows) {
    if (!isSwap(row.action) || row.protocol !== 'PUMPFUN') continue;
    if (mayhem.has(row.mint)) separate.mayhemRows++;
    else if (row.quoteMint !== SOL) separate.nonSolRows++;
    else eligible.push(row);
  }
  const groups = groupBy(eligible, (row) => row.signature || key(row.file, row.line));
  for (const group of groups.values()) {
    for (const row of group) {
      const legs = Array.isArray(row.breakdown) ? row.breakdown : [];
      const candidates = legs.map((leg) => legCandidate(row, leg)).filter(Boolean);
      const source = { file: row.file, line: row.line, signature: row.signature ?? null,
        ts: row.timestamp, slot: row.block, mint: row.mint, legCount: legs.length };
      let result;
      if (!row.signature || !row.mint || !Number.isSafeInteger(row.block)) result = 'invalid_identity';
      else if (group.length > 1) result = 'repeated_signature';
      else if (legs.length > 1) result = 'multiple_legs';
      else result = normalizeSwap(row, candidates[0]);
      if (typeof result === 'string') rejected.push({ ...source, reason: result, candidates });
      else trades.push({ ...source, ...result, orderInSlot: null, orderStatus: null });
    }
  }
  const blockers = new Set(rejected.map((row) => key(row.slot, row.mint)));
  const orderGroups = [];
  for (const [id, group] of groupBy(trades, (row) => key(row.slot, row.mint))) {
    const ordered = blockers.has(id) ? null : uniqueOrder(group);
    const status = blockers.has(id) ? 'rejected_neighbor' : ordered ? 'resolved' : 'ambiguous_or_gap';
    if (ordered) ordered.forEach((row, index) => { row.orderInSlot = index; });
    for (const row of group) row.orderStatus = status;
    orderGroups.push({ rows: group, ordered, status });
  }
  const standardMints = new Set(rows.filter((row) => row.protocol === 'PUMPFUN' && row.quoteMint === SOL &&
    row.mint && !mayhem.has(row.mint)).map((row) => row.mint));
  return { trades, rejected, orderGroups, separate, standardMints };
}

export function lifecycle(rows, standardMints) {
  const events = [];
  for (const row of rows) {
    let mint;
    let kind;
    if (row.protocol === 'PUMPFUN' && row.quoteMint === SOL && row.action === 'curveComplete') {
      mint = row.mint;
      kind = 'complete';
    } else if (row.protocol === 'PUMPSWAP' && row.action === 'createPool' && row.mint === SOL) {
      mint = row.quoteMint;
      kind = 'pool';
    } else if (row.protocol === 'PUMPSWAP' && row.action === 'createPool' && row.quoteMint === SOL) {
      mint = row.mint;
      kind = 'pool';
    }
    if (standardMints.has(mint)) events.push({ kind, mint, pool: row.pool ?? null,
      ts: row.timestamp, slot: row.block, signature: row.signature ?? null });
  }
  return events;
}
