import type { Link, Post } from './events';

export const SOCIAL_VERSION = 'scenario-1';
export const SOCIAL_CATALOG = [
  { id: 'post:root', authorId: 'SignalDesk', narrativeId: 'signal', kind: 'ORIGINAL',
    parentPostId: null, parentNarrativeId: null, body: 'The observatory is picking up a strange signal tonight.', simulated: true },
  { id: 'post:fork', authorId: 'NightArchive', narrativeId: 'echo', kind: 'QUOTE',
    parentPostId: 'post:root', parentNarrativeId: 'signal', body: 'What if the signal is an echo from our own telescope?', simulated: true },
  { id: 'post:repost', authorId: 'NightArchive', narrativeId: 'signal', kind: 'REPOST',
    parentPostId: 'post:root', parentNarrativeId: null, body: 'The observatory picked up the signal again.', simulated: true },
] as const satisfies readonly Omit<Post, 'publishedAt'>[];

export type NarrativeGraph = {
  nodes: Record<string, { id: string; createdAt: number }>;
  edges: { parent: string; child: string; kind: 'FORK'; causeId: string }[];
};
export type SocialState = {
  graph: NarrativeGraph;
  posts: Record<string, Post>;
  links: Record<string, Link>;
  delivered: Record<string, true>;
  interpreted: Record<string, true>;
};

export function publish(state: SocialState, post: Post, causeId: string) {
  if (state.posts[post.id]) return false;
  if (post.parentPostId && !state.posts[post.parentPostId]) throw new Error('Missing parent post');
  const parent = post.parentNarrativeId;
  if (parent && (!state.graph.nodes[parent] || state.graph.nodes[post.narrativeId] || parent === post.narrativeId)) {
    throw new Error('Invalid narrative fork');
  }
  state.graph.nodes[post.narrativeId] ??= { id: post.narrativeId, createdAt: post.publishedAt };
  if (parent) state.graph.edges.push({ parent, child: post.narrativeId, kind: 'FORK', causeId });
  state.posts[post.id] = post;
  return true;
}
