import { BASE_FEE, SOL, minAtoms, type Intent } from './contracts';
import type { Post, PublicMarket } from './events';
import type { Ledger } from './ledger';
import type { RngStreams } from './rng';

export const AGENT_VERSION = 'bounded-rotation-2';
export const SELL_FEE_RESERVE = 1000n * BASE_FEE;
export const TOKEN_INTEREST_MS = 300_000;
export const TOKEN_INTEREST_VERSION = 'buy-lease-300s-exit-1';
export type KnownMarket = { view: PublicMarket; evidence: string; prior: PublicMarket | null };
export type TokenInterest = {
  buyUntil: number;
  impulseId: string;
  impulsePublishedAt: number;
  exit?: KnownMarket;
};
export type Agent = {
  id: string;
  strategy: 'momentum' | 'contrarian' | 'creator';
  known: Record<string, KnownMarket>;
  narratives: Record<string, { postId: string; evidence: string; attention: number; fatigue: number; at: number }>;
  ordinal: number;
  generation: number;
  nextAt: number | null;
  launches: number;
  boundedWake?: { lastAt: number | null; reactiveAt: number | null; reactiveGeneration: number };
  tokenInterest?: Record<string, TokenInterest>;
  exitMemory?: Record<string, KnownMarket>;
};

export function newAgent(id: string, index: number): Agent {
  return {
    id, strategy: index < 3 ? 'creator' : index % 2 ? 'momentum' : 'contrarian',
    known: {}, narratives: {}, ordinal: 0, generation: 0, nextAt: null, launches: 0,
  };
}

export function observe(agent: Agent, view: PublicMarket, evidence: string, interestAt?: number, exitOnly = false) {
  const old = agent.known[view.tokenId];
  const cached = exitOnly ? agent.exitMemory?.[view.tokenId]
    : interestAt === undefined ? undefined : agent.tokenInterest?.[view.tokenId]?.exit;
  const previous = old ?? cached;
  if (previous && view.observedAt < previous.view.observedAt) return;
  if (!old && Object.keys(agent.known).length >= 16) {
    const [oldest] = Object.entries(agent.known).sort(([idA, a], [idB, b]) =>
      a.view.observedAt - b.view.observedAt || (idA < idB ? -1 : idA > idB ? 1 : 0));
    delete agent.known[oldest[0]];
  }
  const item = { view, evidence, prior: previous?.view ?? null };
  agent.known[view.tokenId] = item;
  if (interestAt !== undefined) {
    const interests = agent.tokenInterest ??= {};
    // Keep expired entries even after eviction; observing again is not new interest.
    const interest = interests[view.tokenId] ??= {
      buyUntil: interestAt + TOKEN_INTEREST_MS, impulseId: evidence, impulsePublishedAt: interestAt,
    };
    if (interest.exit) interest.exit = item;
  }
  if (exitOnly && agent.exitMemory?.[view.tokenId]) agent.exitMemory[view.tokenId] = item;
}

export function renewTokenInterest(agent: Agent, tokenId: string, post: Post, now: number) {
  const interest = agent.tokenInterest?.[tokenId];
  const independent = post.kind === 'ORIGINAL' || post.kind === 'QUOTE'
    && post.parentNarrativeId !== null && post.parentNarrativeId !== post.narrativeId;
  if (!interest || !independent || post.id === interest.impulseId
    || post.publishedAt <= interest.impulsePublishedAt || post.publishedAt > now
    || now - post.publishedAt >= TOKEN_INTEREST_MS) return false;
  interest.buyUntil = now + TOKEN_INTEREST_MS;
  interest.impulseId = post.id;
  interest.impulsePublishedAt = post.publishedAt;
  return true;
}

export function decideTrade(agent: Agent, now: number, ledger: Ledger, rng: RngStreams,
  narrativeOf: (tokenId: string) => string | undefined, protectedBuySol = 0n,
  tokenInterest = false, exitOnly = false, leaseOnly = false, exitFallthrough = false): Intent | null {
  const leaseEnabled = tokenInterest || leaseOnly;
  const exitEnabled = tokenInterest || exitOnly;
  const draw = (exclusive: number) => rng.int('agent/decision', agent.id, AGENT_VERSION, exclusive);
  const candidates = Object.values(agent.known).filter(item => item.view.tradable && (!leaseEnabled
    || now < (agent.tokenInterest?.[item.view.tokenId]?.buyUntil ?? 0)
    || ledger.balance(agent.id, item.view.tokenId).available > 0n));
  if (exitEnabled) {
    const exits = exitOnly ? Object.entries(agent.exitMemory ?? {})
      : Object.entries(agent.tokenInterest ?? {}).flatMap(([id, interest]) => interest.exit ? [[id, interest.exit] as const] : []);
    for (const [id, item] of exits) {
      if (!agent.known[id] && item.view.tradable && ledger.balance(agent.id, id).available > 0n) {
        candidates.push(item);
      }
    }
  }
  if (!candidates.length || draw(100) < 45) return null;
  const counts = new Map<string, number>();
  for (const { view } of candidates) {
    const narrative = narrativeOf(view.tokenId);
    if (narrative) counts.set(narrative, (counts.get(narrative) ?? 0) + 1);
  }
  const interestByNarrative = new Map<string, number>();
  for (const id of counts.keys()) {
    const interest = agent.narratives[id];
    if (interest) interestByNarrative.set(id,
      Math.max(0, interest.attention - interest.fatigue - Math.floor((now - interest.at) / 1000)));
  }
  const interestTotal = [...interestByNarrative.values()].reduce((sum, value) => sum + value, 0);
  let selected = candidates[0];
  let best = -Infinity;
  // Best BUY-eligible (known) candidate of the same contest; no extra draw is taken for it.
  let fallback: KnownMarket | null = null;
  let bestKnown = -Infinity;
  for (const item of candidates.sort((a, b) => a.view.tokenId < b.view.tokenId ? -1 : 1)) {
    const id = narrativeOf(item.view.tokenId);
    const pressure = id ? Math.floor((interestByNarrative.get(id) ?? 0) * 60 / (Math.max(60, interestTotal) * counts.get(id)!)) : 0;
    const score = draw(60) + pressure;
    if (score > best) { best = score; selected = item; }
    if (exitFallthrough && agent.known[item.view.tokenId] && score > bestKnown) { bestKnown = score; fallback = item; }
  }
  const { view, prior, evidence } = selected;
  const tokens = ledger.balance(agent.id, view.tokenId).available;
  const cash = ledger.balance(agent.id).available - BASE_FEE;
  const wentUp = prior && view.spot.quoteAtoms * prior.spot.tokenAtoms > prior.spot.quoteAtoms * view.spot.tokenAtoms;
  const sellBias = agent.strategy === 'contrarian' && wentUp ? 65 : view.epoch > 0 ? 55 : 35;
  const base = {
    agentId: agent.id, tokenId: view.tokenId, decidedAt: now, evidence: [evidence],
    expiresAt: now + 3000, maxTransactionFeeSol: BASE_FEE, priorityFeeSol: 0n, bribeFeeSol: 0n,
  };
  if (tokens > 0n && (cash <= 0n || draw(100) < sellBias)) {
    return { ...base, side: 'SELL', inputTokens: tokens * BigInt(1 + draw(4)) / 4n || tokens, minOutputSol: null };
  }
  if (cash <= 0n) return null;
  // An exit-only winner that did not SELL must not turn into WAIT while a BUY candidate exists:
  // fall through to the best known candidate of the same contest (no second SELL draw).
  const buyBase = exitFallthrough && exitEnabled && !agent.known[view.tokenId] && fallback
    ? { ...base, tokenId: fallback.view.tokenId, evidence: [fallback.evidence] } : base;
  if (exitEnabled && !agent.known[buyBase.tokenId]
    || leaseEnabled && now >= (agent.tokenInterest?.[buyBase.tokenId]?.buyUntil ?? 0)) return null;
  // A fallthrough that cannot fund a BUY stays a plain WAIT and must not consume a size draw.
  if (buyBase !== base && cash - protectedBuySol <= 0n) return null;
  const size = minAtoms(cash - protectedBuySol, SOL * BigInt(1 + draw(15)) / 10n);
  if (size <= 0n) return null;
  return { ...buyBase, side: 'BUY', maxInputSol: size, minOutputTokens: null };
}
