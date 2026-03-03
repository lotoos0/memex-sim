import { AUTHOR_CATALOG, AUTHORS_BY_ID } from './authorCatalog';
import { eventTopic, renderPostText } from './newsTemplateEngine';
import type {
  Importance,
  NarrativeEvent,
  NarrativePost,
  TokenNarrativeState,
  Topic,
} from './narrativeTypes';

const MAX_TEMPLATE_HISTORY = 50;

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickUnique<T>(rows: T[], count: number, rng: () => number): T[] {
  const pool = rows.slice();
  const out: T[] = [];
  while (out.length < count && pool.length > 0) {
    const idx = Math.floor(rng() * pool.length);
    out.push(pool.splice(idx, 1)[0]!);
  }
  return out;
}

function baseCooldownMs(importance: Importance): number {
  return importance === 'major' ? 14_000 : 6_000;
}

function importanceOf(event: NarrativeEvent): Importance {
  if (event.kind === 'TOKEN_LAUNCH' || event.kind === 'TOKEN_MIGRATION' || event.kind === 'TOKEN_RUG') {
    return 'major';
  }
  return event.impact >= 2 ? 'major' : 'minor';
}

function tokenLabel(event: NarrativeEvent): string {
  if (event.tokenSymbol && event.tokenSymbol.trim()) return `$${event.tokenSymbol.toUpperCase()}`;
  if (event.tokenName && event.tokenName.trim()) return event.tokenName;
  return 'TOKEN';
}

function chooseAuthor(state: TokenNarrativeState, topic: Topic, rng: () => number): string {
  const preferred = state.authorIds
    .map((id) => AUTHORS_BY_ID.get(id))
    .filter((a): a is NonNullable<typeof a> => Boolean(a))
    .filter((a) => a.topics.includes(topic));
  const fallback = state.authorIds
    .map((id) => AUTHORS_BY_ID.get(id))
    .filter((a): a is NonNullable<typeof a> => Boolean(a));
  const pool = preferred.length > 0 ? preferred : fallback;
  const noRepeat = state.lastAuthorId ? pool.filter((a) => a.id !== state.lastAuthorId) : pool;
  const finalPool = noRepeat.length > 0 ? noRepeat : pool;
  const picked = finalPool[Math.floor(rng() * Math.max(1, finalPool.length))];
  return picked?.id ?? state.authorIds[0] ?? AUTHOR_CATALOG[0]?.id ?? 'a_news_01';
}

function pushTemplateHistory(state: TokenNarrativeState, templateId: string): void {
  state.usedTemplateIds.push(templateId);
  if (state.usedTemplateIds.length > MAX_TEMPLATE_HISTORY) {
    state.usedTemplateIds.splice(0, state.usedTemplateIds.length - MAX_TEMPLATE_HISTORY);
  }
}

function mapKind(event: NarrativeEvent): 'SYSTEM' | 'TRADE' {
  return event.kind === 'BIG_BUY' || event.kind === 'BIG_SELL' ? 'TRADE' : 'SYSTEM';
}

function mapTone(event: NarrativeEvent): 'neutral' | 'buy' | 'sell' | 'warn' {
  if (event.kind === 'BIG_BUY' || event.kind === 'TOKEN_MIGRATION') return 'buy';
  if (event.kind === 'BIG_SELL') return 'sell';
  if (event.kind === 'TOKEN_RUG') return 'warn';
  return 'neutral';
}

export function assignAuthorsForToken(tokenId: string, count = 3): string[] {
  const rng = mulberry32(fnv1a(`authors:${tokenId}`));
  const assigned = pickUnique(
    AUTHOR_CATALOG.map((author) => author.id),
    Math.max(2, count),
    rng
  );
  return assigned.length > 0 ? assigned : ['a_news_01'];
}

export function createTokenNarrativeState(tokenId: string): TokenNarrativeState {
  return {
    tokenId,
    authorIds: assignAuthorsForToken(tokenId, 3),
    lastPostMs: -1,
    cooldownUntilMs: 0,
    usedTemplateIds: [],
    seq: 0,
  };
}

export function applyNarrativeEvent(
  event: NarrativeEvent,
  state: TokenNarrativeState
): { state: TokenNarrativeState; posts: NarrativePost[] } {
  const topic = eventTopic(event);
  const importance = importanceOf(event);

  if (event.simNowMs < state.cooldownUntilMs) return { state, posts: [] };
  if (
    importance === 'minor'
    && state.lastTopic === topic
    && state.lastPostMs >= 0
    && (event.simNowMs - state.lastPostMs) < 12_000
  ) {
    return { state, posts: [] };
  }

  const rng = mulberry32(fnv1a(`post:${state.tokenId}:${event.simNowMs}:${state.seq}`));
  const authorId = chooseAuthor(state, topic, rng);
  const author = AUTHORS_BY_ID.get(authorId);
  if (!author) return { state, posts: [] };

  const rendered = renderPostText({
    author,
    event,
    tokenLabel: tokenLabel(event),
    rng,
  });

  const alreadyUsed = state.usedTemplateIds.includes(rendered.templateId);
  if (alreadyUsed && importance === 'minor') return { state, posts: [] };

  const post: NarrativePost = {
    id: `np_${state.tokenId}_${event.simNowMs}_${state.seq}`,
    tokenId: state.tokenId,
    simNowMs: event.simNowMs,
    kind: mapKind(event),
    tone: mapTone(event),
    authorId: author.id,
    authorName: author.name,
    authorHandle: author.handle,
    authorAvatar: author.avatar,
    topic,
    importance,
    text: rendered.text,
    tags: rendered.tags,
  };

  state.seq += 1;
  state.lastPostMs = event.simNowMs;
  state.lastAuthorId = author.id;
  state.lastTopic = topic;
  state.cooldownUntilMs = event.simNowMs + baseCooldownMs(importance);
  pushTemplateHistory(state, rendered.templateId);

  return { state, posts: [post] };
}
