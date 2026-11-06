import { BASE_FEE, SOL, minAtoms, type Intent } from './contracts';
import type { PublicMarket } from './events';
import type { Ledger } from './ledger';
import type { RngStreams } from './rng';

export const AGENT_VERSION = 'bounded-rotation-2';
export const SELL_FEE_RESERVE = 1000n * BASE_FEE;
export type Agent = {
  id: string;
  strategy: 'momentum' | 'contrarian' | 'creator';
  known: Record<string, { view: PublicMarket; evidence: string; prior: PublicMarket | null }>;
  narratives: Record<string, { postId: string; evidence: string; attention: number; fatigue: number; at: number }>;
  ordinal: number;
  generation: number;
  nextAt: number | null;
  launches: number;
};

export function newAgent(id: string, index: number): Agent {
  return {
    id, strategy: index < 3 ? 'creator' : index % 2 ? 'momentum' : 'contrarian',
    known: {}, narratives: {}, ordinal: 0, generation: 0, nextAt: null, launches: 0,
  };
}

export function observe(agent: Agent, view: PublicMarket, evidence: string) {
  const old = agent.known[view.tokenId];
  if (old && view.observedAt < old.view.observedAt) return;
  if (!old && Object.keys(agent.known).length >= 16) {
    const [oldest] = Object.entries(agent.known).sort(([idA, a], [idB, b]) =>
      a.view.observedAt - b.view.observedAt || (idA < idB ? -1 : idA > idB ? 1 : 0));
    delete agent.known[oldest[0]];
  }
  agent.known[view.tokenId] = { view, evidence, prior: old?.view ?? null };
}

export function decideTrade(agent: Agent, now: number, ledger: Ledger, rng: RngStreams,
  narrativeOf: (tokenId: string) => string | undefined, protectedBuySol = 0n): Intent | null {
  const draw = (exclusive: number) => rng.int('agent/decision', agent.id, AGENT_VERSION, exclusive);
  const candidates = Object.values(agent.known).filter(item => item.view.tradable);
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
  for (const item of candidates.sort((a, b) => a.view.tokenId < b.view.tokenId ? -1 : 1)) {
    const id = narrativeOf(item.view.tokenId);
    const pressure = id ? Math.floor((interestByNarrative.get(id) ?? 0) * 60 / (Math.max(60, interestTotal) * counts.get(id)!)) : 0;
    const score = draw(60) + pressure;
    if (score > best) { best = score; selected = item; }
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
  const size = minAtoms(cash - protectedBuySol, SOL * BigInt(1 + draw(15)) / 10n);
  if (size <= 0n) return null;
  return { ...base, side: 'BUY', maxInputSol: size, minOutputTokens: null };
}
