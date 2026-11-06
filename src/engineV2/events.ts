import type { Fill, Intent, Order, Policy, Spot } from './contracts';
import type { Position, Posting } from './ledger';
import type { Market, Reserves } from './marketRules';

export type Post = {
  id: string;
  authorId: string;
  narrativeId: string;
  kind: 'ORIGINAL' | 'REPOST' | 'QUOTE' | 'CORRECTION' | 'REPLY';
  parentPostId: string | null;
  parentNarrativeId: string | null;
  publishedAt: number;
  body: string;
  simulated: true;
};

export type Launch = {
  tokenId: string;
  creatorId: string;
  name: string;
  ticker: string;
  narrativeId: string | null;
  sourcePostId: string | null;
};
export type Link = {
  tokenId: string;
  narrativeId: string;
  sourcePostId: string;
  relation: 'ORIGINAL' | 'COPYCAT' | 'FORK';
  createdAt: number;
  relevancePpm: number;
};
export type PublicMarket = {
  tokenId: string;
  spot: Spot;
  progressPpm: number;
  observedAt: number;
  epoch: number;
  tradable: boolean;
};
export type Command =
  | { kind: 'submit'; intent: Intent; policy: Policy }
  | { kind: 'cancel'; orderId: string; agentId: string }
  | { kind: 'close'; tokenId: string }
  | { kind: 'post'; tokenId: string; body: string }
  | { kind: 'session'; override: 'quiet' | 'busy' | null };
export type Ack = { ok: boolean; orderId?: string; reason?: string };
export type TaskMap = {
  Genesis: { funding: Record<string, number> };
  Ingress: { commandId: string; command: Command };
  Launch: Launch;
  Publish: { post: Omit<Post, 'publishedAt'>; audience: boolean };
  Exposure: { agentId: string; postId: string; publishedFactId: string };
  Discover: { agentId: string; postId: string; exposureId: string };
  Observe: { agentId: string; market: PublicMarket; evidence: string };
  Decide: { agentId: string; generation: number };
  Admit: { intentId: string; intent: Intent; policy: Policy };
  Execute: { orderId: string };
  Expire: { orderId: string };
  Idle: { tokenId: string; generation: number; stage: 'QUIET' | 'DORMANT' };
};
export type FactMap = {
  LedgerChanged: {
    postings: readonly Posting[];
    issuance: { asset: string; amount: bigint } | null;
    position: { account: string; tokenId: string; value: Position } | null;
  };
  CommandResolved: { commandId: string; ack: Ack };
  OrderChanged: { order: Order };
  AdmissionRejected: { intentId: string; agentId: string; tokenId: string; reason: string };
  TokenLaunched: { market: Market; link: Link | null };
  LaunchRejected: { tokenId: string; creatorId: string; reason: string };
  MarketUpdated: { market: Market };
  TradeExecuted: {
    fill: Fill; before: Reserves; after: Reserves; progressBefore: number; progressAfter: number;
  };
  MarketMigrated: { tokenId: string; fromEpoch: number; toEpoch: number; reference: Spot; pool: Reserves };
  SocialPublished: { post: Post; tokenId: string | null };
  ExposureDelivered: { agentId: string; postId: string; interpretationAt: number };
  NarrativeDiscovered: { agentId: string; postId: string; narrativeId: string };
  AgentDecided: { agentId: string; ordinal: number; decision: 'WAIT' | 'TRADE' | 'LAUNCH' };
  SessionChanged: { override: 'quiet' | 'busy' | null };
};
