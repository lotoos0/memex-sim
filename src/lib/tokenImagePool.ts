import { getTokenAvatarUrl } from './tokenAvatar';
import {
  AUTHOR_IMAGE_CATALOG,
  IMAGE_MODIFIERS,
  THEME_KEYWORDS,
  TOKEN_IMAGE_CATALOG,
  type ThemeKeyword,
  type TokenImageAsset,
} from './tokenImageCatalog';

const TOKEN_IMAGE_ROOT = '/token-images';

function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function tokenSrc(file: string): string {
  return `${TOKEN_IMAGE_ROOT}/${file}`;
}

function authorSrc(file: string): string {
  return `${TOKEN_IMAGE_ROOT}/authors/${file}`;
}

function chooseStable<T extends { id: string }>(group: readonly T[], seed: string): T {
  // Highest-random-weight: hash the token with each image id and keep the max.
  // Adding an image only moves tokens that prefer the new file.
  let best = group[0]!;
  let bestScore = -1;
  for (const item of group) {
    const score = fnv1a(`${seed}\0${item.id}`);
    if (score > bestScore || (score === bestScore && item.id < best.id)) {
      best = item;
      bestScore = score;
    }
  }
  return best;
}

function matchTheme(name: string): ThemeKeyword | null {
  let best: ThemeKeyword | null = null;
  for (const keyword of THEME_KEYWORDS) {
    if (!name.includes(keyword.word)) continue;
    if (!best) {
      best = keyword;
      continue;
    }
    const bestSuffix = name.endsWith(best.word);
    const nextSuffix = name.endsWith(keyword.word);
    if (nextSuffix !== bestSuffix) {
      if (nextSuffix) best = keyword;
      continue;
    }
    if (keyword.word.length > best.word.length) best = keyword;
  }
  return best;
}

function matchModifier(remainder: string): string | null {
  let best: string | null = null;
  for (const modifier of IMAGE_MODIFIERS) {
    if (!remainder.includes(modifier)) continue;
    if (!best || modifier.length > best.length) best = modifier;
  }
  return best ? best.toLowerCase() : null;
}

function groupForLabel(label: string): readonly TokenImageAsset[] | null {
  const theme = matchTheme(label);
  if (!theme) return null;
  const themed = TOKEN_IMAGE_CATALOG.filter((image) => image.themes.includes(theme.theme));
  if (themed.length === 0) return null;
  const remainder = label.endsWith(theme.word)
    ? label.slice(0, -theme.word.length)
    : label.replace(theme.word, '');
  const modifier = matchModifier(remainder);
  if (!modifier) return themed;
  const tagged = themed.filter((image) => image.tags.includes(modifier));
  return tagged.length > 0 ? tagged : themed;
}

export function pickTokenImageUrl(input: { id: string; name: string; ticker?: string }): string | null {
  const name = (input.name || '').toUpperCase();
  const ticker = (input.ticker || '').toUpperCase();
  const seed = input.id || name || ticker;
  const fromName = name ? groupForLabel(name) : null;
  if (fromName && fromName.length > 0) return tokenSrc(chooseStable(fromName, seed).file);
  if (!ticker || ticker === name) return null;
  const fromTicker = groupForLabel(ticker);
  if (!fromTicker || fromTicker.length === 0) return null;
  return tokenSrc(chooseStable(fromTicker, seed).file);
}

export function getAuthorAvatarUrl(key: string): string {
  if (AUTHOR_IMAGE_CATALOG.length === 0) return getTokenAvatarUrl(key || 'author');
  const picked = chooseStable(AUTHOR_IMAGE_CATALOG, key || 'author');
  return authorSrc(picked.file);
}
