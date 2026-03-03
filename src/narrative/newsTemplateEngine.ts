import type { AuthorProfile, NarrativeEvent, Topic } from './narrativeTypes';

type RenderContext = {
  author: AuthorProfile;
  event: NarrativeEvent;
  tokenLabel: string;
  rng: () => number;
};

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

function fmtUsdCompact(v: number): string {
  if (!Number.isFinite(v)) return '$0';
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function fmtPrice(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '$0';
  if (v >= 1) return `$${v.toFixed(4)}`;
  if (v >= 0.01) return `$${v.toFixed(6)}`;
  return `$${v.toExponential(3)}`;
}

export function eventTopic(event: NarrativeEvent): Topic {
  switch (event.kind) {
    case 'TOKEN_LAUNCH':
      return 'launch';
    case 'BIG_BUY':
      return 'buy';
    case 'BIG_SELL':
      return 'sell';
    case 'TOKEN_MIGRATION':
      return 'migration';
    case 'TOKEN_RUG':
      return 'rug';
  }
}

export function renderPostText(
  context: RenderContext
): { templateId: string; text: string; tags: string[] } {
  const { author, event, tokenLabel, rng } = context;

  if (event.kind === 'TOKEN_LAUNCH') {
    const opener = pick(
      author.tone === 'degen'
        ? ['fresh pair', 'new launch', 'new ticker live']
        : author.tone === 'analyst'
          ? ['launch detected', 'new market opened', 'listing observed']
          : ['heads up', 'new token online', 'watchlist candidate'],
      rng
    );
    return {
      templateId: `launch-${author.tone}-1`,
      text: `${opener}: ${tokenLabel} ${fmtPrice(event.priceUsd)} with MC ${fmtUsdCompact(event.mcapUsd)}.`,
      tags: ['launch'],
    };
  }

  if (event.kind === 'BIG_BUY' || event.kind === 'BIG_SELL') {
    const side = event.kind === 'BIG_BUY' ? 'BUY' : 'SELL';
    const intensity = event.impact >= 3 ? 'monster' : event.impact >= 2 ? 'big' : 'sized';
    if (author.tone === 'analyst') {
      return {
        templateId: `flow-${author.tone}-${side}-1`,
        text: `${tokenLabel} ${intensity} ${side}: ${fmtUsdCompact(event.usd)} at ${fmtPrice(event.priceUsd)} (MC ${fmtUsdCompact(event.mcapUsd)}).`,
        tags: [side.toLowerCase(), 'flow'],
      };
    }
    if (author.tone === 'skeptic') {
      return {
        templateId: `flow-${author.tone}-${side}-1`,
        text: `${tokenLabel} ${side} spike ${fmtUsdCompact(event.usd)}. Watch follow-through before chasing.`,
        tags: [side.toLowerCase(), 'risk'],
      };
    }
    const hype = pick(author.vocab.hype, rng);
    const slang = pick(author.vocab.slang, rng);
    return {
      templateId: `flow-${author.tone}-${side}-1`,
      text: `${tokenLabel} ${intensity} ${side} ${fmtUsdCompact(event.usd)}. ${hype}. ${slang}.`,
      tags: [side.toLowerCase()],
    };
  }

  if (event.kind === 'TOKEN_MIGRATION') {
    return {
      templateId: `migration-${author.tone}-1`,
      text: `${tokenLabel} migrated. New phase unlocked at MC ${fmtUsdCompact(event.mcapUsd)}.`,
      tags: ['migration'],
    };
  }

  return {
    templateId: `rug-${author.tone}-1`,
    text: `${tokenLabel} rugged. Capital protection first.`,
    tags: ['rug'],
  };
}
