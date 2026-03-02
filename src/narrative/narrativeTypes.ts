export type AuthorTone = 'degen' | 'analyst' | 'sniper' | 'skeptic' | 'builder' | 'news';
export type Topic = 'launch' | 'buy' | 'sell' | 'migration' | 'rug' | 'chart' | 'meta';
export type Importance = 'minor' | 'major';

export type NarrativeEvent =
  | {
    kind: 'TOKEN_LAUNCH';
    tokenId: string;
    simNowMs: number;
    tokenName?: string;
    tokenSymbol?: string;
    priceUsd: number;
    mcapUsd: number;
  }
  | {
    kind: 'BIG_BUY' | 'BIG_SELL';
    tokenId: string;
    simNowMs: number;
    tokenName?: string;
    tokenSymbol?: string;
    usd: number;
    priceUsd: number;
    mcapUsd: number;
    impact: number;
  }
  | {
    kind: 'TOKEN_MIGRATION';
    tokenId: string;
    simNowMs: number;
    tokenName?: string;
    tokenSymbol?: string;
    mcapUsd: number;
  }
  | {
    kind: 'TOKEN_RUG';
    tokenId: string;
    simNowMs: number;
    tokenName?: string;
    tokenSymbol?: string;
    mcapUsd: number;
  };

export type AuthorProfile = {
  id: string;
  name: string;
  handle: string;
  avatar: string;
  tone: AuthorTone;
  topics: Topic[];
  riskLevel: number;
  vocab: {
    hype: string[];
    caution: string[];
    slang: string[];
  };
};

export type NarrativePost = {
  id: string;
  tokenId: string;
  simNowMs: number;
  kind: 'SYSTEM' | 'TRADE';
  tone: 'neutral' | 'buy' | 'sell' | 'warn';
  authorId: string;
  authorName: string;
  authorHandle: string;
  authorAvatar: string;
  topic: Topic;
  importance: Importance;
  text: string;
  tags?: string[];
};

export type TokenNarrativeState = {
  tokenId: string;
  authorIds: string[];
  lastPostMs: number;
  lastAuthorId?: string;
  lastTopic?: Topic;
  cooldownUntilMs: number;
  usedTemplateIds: string[];
  seq: number;
};
