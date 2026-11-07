import type { Spot } from './contracts';
import type { Post, PublicMarket } from './events';

// A2 opportunity attention (experimental, opt-in). Per agent x token interest in BUYing a token, derived only
// from the agent's own observations and the posts it discovered. All arithmetic is integer; decay is evaluated
// lazily at read time, so no timers or RNG draws are involved.
export const ATTENTION_VERSION = 'opportunity-attention-1';
export const ATTENTION_MAX = 1_000_000;
export const ATTENTION_H_MS = 35_000;
export const ATTENTION_R_MS = 4 * ATTENTION_H_MS;
export const ATTENTION_THETA_BPS = 700n;
// Pre-registered experiment assumptions (not validated against Real C): the weight of a fully interesting
// token equals the odds of the other known - 1 = 15 tokens combined. Tests patch this to 0 for the zero-bonus check.
export const ATTENTION_WEIGHT_MAX = 15;
export const ATTENTION_STRIKES_MAX = 4;
// News-derived levels by strike index; a table instead of a shift because JS shifts wrap modulo 32.
export const ATTENTION_FLOW_LEVELS = [500_000, 250_000, 125_000, 62_500, 31_250] as const;

export type AttentionRef = { quoteAtoms: bigint; tokenAtoms: bigint; at: number; epoch: number };
export type Attention = {
  level: number;
  at: number;
  strikes: number;
  strikeAt: number;
  ref: AttentionRef | null;
  impulsePostId: string | null;
  impulsePublishedAt: number;
};

const refOf = (view: PublicMarket): AttentionRef => ({
  quoteAtoms: view.spot.quoteAtoms, tokenAtoms: view.spot.tokenAtoms, at: view.observedAt, epoch: view.epoch,
});

export function decayLevel(level: number, elapsedMs: number) {
  return Math.floor(level * ATTENTION_H_MS / (ATTENTION_H_MS + Math.max(0, elapsedMs)));
}

export function effectiveStrikes(record: Attention, now: number) {
  return Math.max(0, record.strikes - Math.floor(Math.max(0, now - record.strikeAt) / ATTENTION_R_MS));
}

export function attentionWeight(record: Attention | undefined, now: number) {
  if (!record) return 1;
  return 1 + Math.floor(decayLevel(record.level, now - record.at) * ATTENTION_WEIGHT_MAX / ATTENTION_MAX);
}

// Cumulative displacement from the reference of at least THETA, compared without division.
export function movedBeyondTheta(ref: AttentionRef, spot: Spot) {
  const delta = spot.quoteAtoms * ref.tokenAtoms - ref.quoteAtoms * spot.tokenAtoms;
  return (delta < 0n ? -delta : delta) * 10_000n >= ATTENTION_THETA_BPS * ref.quoteAtoms * spot.tokenAtoms;
}

const independent = (post: Post) => post.kind === 'ORIGINAL' || post.kind === 'QUOTE'
  && post.parentNarrativeId !== null && post.parentNarrativeId !== post.narrativeId;

function fresh(now: number, impulsePostId: string | null, impulsePublishedAt: number): Attention {
  return { level: ATTENTION_MAX, at: now, strikes: 0, strikeAt: now, ref: null, impulsePostId, impulsePublishedAt };
}

export type LaunchSource = { postId: string; publishedAt: number } | null;

// Called only for views the agent's own observe() accepted (not stale against its known/exit memory).
export function observeAttention(agent: { attention?: Record<string, Attention> }, view: PublicMarket, now: number,
  launch: boolean, source: LaunchSource) {
  const book = agent.attention ??= {};
  const record = book[view.tokenId];
  if (!record) {
    // A token first seen through its launch is an exogenous impulse; anything else carries no interest.
    const created = launch ? fresh(now, source?.postId ?? null, source?.publishedAt ?? 0)
      : { ...fresh(now, null, 0), level: 0, strikes: 0 };
    created.ref = refOf(view);
    book[view.tokenId] = created;
    return;
  }
  if (!record.ref) { record.ref = refOf(view); return; }
  // A snapshot not newer than the reference (for example one overtaken by the agent's own fill) is not evaluated.
  if (view.observedAt <= record.ref.at) return;
  if (view.epoch !== record.ref.epoch) { record.ref = refOf(view); return; }
  if (!movedBeyondTheta(record.ref, view.spot)) return;
  const strikes = effectiveStrikes(record, now);
  const granted = ATTENTION_FLOW_LEVELS[strikes];
  if (granted > decayLevel(record.level, now - record.at)) { record.level = granted; record.at = now; }
  record.strikes = Math.min(strikes + 1, ATTENTION_STRIKES_MAX);
  record.strikeAt = now;
  record.ref = refOf(view);
}

// An own execution is not news to the agent that made it: absorb its price impact into the reference.
export function absorbOwnFill(agent: { attention?: Record<string, Attention> }, tokenId: string, spot: Spot,
  at: number, epoch: number) {
  const record = agent.attention?.[tokenId];
  if (!record || (record.ref && at < record.ref.at)) return;
  record.ref = { quoteAtoms: spot.quoteAtoms, tokenAtoms: spot.tokenAtoms, at, epoch };
}

// Post-derived impulse; the world calls it from discover(), once per agent and post.
export function postImpulse(agent: { attention?: Record<string, Attention> }, tokenId: string, post: Post, now: number) {
  const book = agent.attention ??= {};
  const record = book[tokenId];
  if (!independent(post) || post.publishedAt > now) return false;
  if (record && (post.id === record.impulsePostId || post.publishedAt <= record.impulsePublishedAt)) return false;
  if (!record) { book[tokenId] = fresh(now, post.id, post.publishedAt); return true; }
  Object.assign(record, { level: ATTENTION_MAX, at: now, strikes: 0, strikeAt: now,
    impulsePostId: post.id, impulsePublishedAt: post.publishedAt });
  return true;
}

export function pruneAttention(agent: { attention?: Record<string, Attention> }, tokenId: string, now: number) {
  const record = agent.attention?.[tokenId];
  if (record && effectiveStrikes(record, now) === 0 && attentionWeight(record, now) === 1) delete agent.attention![tokenId];
}

// Exponential race on the existing decision draw: P(i wins) ~ w_i / sum(w). Keys are u_i^(1/w_i) with
// u_i = (2d + 1) / 120 for d in [0, 60); compared exactly via BigInt. Equal weights reduce to comparing d.
export function raceBeats(drawA: number, weightA: number, drawB: number, weightB: number) {
  return BigInt(2 * drawA + 1) ** BigInt(weightB) * 120n ** BigInt(weightA)
    > BigInt(2 * drawB + 1) ** BigInt(weightA) * 120n ** BigInt(weightB);
}
