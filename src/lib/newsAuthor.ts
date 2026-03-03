import { getTokenAvatarUrl } from './tokenAvatar';

export interface NewsAuthorProfile {
  name: string;
  handle: string;
  followers: string;
  joinedLabel: string;
  avatarUrl: string;
}

function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function compactFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

const PREFIX = ['Dig', 'Moon', 'Kit', 'Nova', 'Pump', 'Flux', 'Giga', 'Rune', 'Meme', 'Ape'] as const;
const SUFFIX = ['Labs', 'Watch', 'Runner', 'Desk', 'Wire', 'Vision', 'Scope', 'Post', 'Cast', 'Byte'] as const;

export function getNewsAuthorProfile(tokenId: string, ticker: string, overrideAuthor?: string): NewsAuthorProfile {
  if (overrideAuthor === 'you') {
    return {
      name: 'you',
      handle: 'you',
      followers: '0',
      joinedLabel: 'Joined now',
      avatarUrl: getTokenAvatarUrl('user:you'),
    };
  }

  const hash = fnv1a(`${tokenId}:${ticker}`);
  const p = PREFIX[hash % PREFIX.length]!;
  const s = SUFFIX[(hash >>> 7) % SUFFIX.length]!;
  const num = ((hash >>> 16) % 900) + 100;
  const monthIdx = ((hash >>> 11) % 12) + 1;
  const year = 2022 + ((hash >>> 4) % 5);
  const followers = 500 + (hash % 32_000);

  return {
    name: `${p} ${s}`,
    handle: `${ticker.toLowerCase()}${num}`,
    followers: compactFollowers(followers),
    joinedLabel: `Joined ${monthIdx.toString().padStart(2, '0')}/${year}`,
    avatarUrl: getTokenAvatarUrl(`${tokenId}:news-author`),
  };
}

export function deriveNewsStats(seed: string): { replies: number; reposts: number; likes: number } {
  const h = fnv1a(seed);
  return {
    replies: (h % 28) + 1,
    reposts: ((h >>> 7) % 54) + 2,
    likes: ((h >>> 13) % 240) + 8,
  };
}
