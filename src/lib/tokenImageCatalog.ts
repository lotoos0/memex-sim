/**
 * Local themed image pool for synthetic token and author pictures.
 * Files live in public/token-images/. See public/token-images/ATTRIBUTION.md
 * for license notes and how to add another image.
 */

export interface TokenImageAsset {
  id: string;
  file: string;
  themes: readonly string[];
  tags: readonly string[];
}

export interface AuthorImageAsset {
  id: string;
  file: string;
}

export interface ThemeKeyword {
  word: string;
  theme: string;
}

export const TOKEN_IMAGE_CATALOG: readonly TokenImageAsset[] = [
  { id: 'dog-shiba', file: 'dog-shiba.webp', themes: ['dog'], tags: [] },
  { id: 'dog-puppy', file: 'dog-puppy.webp', themes: ['dog', 'smol'], tags: ['baby', 'mini', 'smol'] },
  { id: 'dog-cowboy', file: 'dog-cowboy.webp', themes: ['dog'], tags: ['chad', 'giga', 'gigachad'] },
  { id: 'dog-sleepy', file: 'dog-sleepy.webp', themes: ['dog'], tags: ['sleepy', 'lazy'] },
  { id: 'cat-orange', file: 'cat-orange.webp', themes: ['cat'], tags: [] },
  { id: 'cat-yawn', file: 'cat-yawn.webp', themes: ['cat'], tags: ['giga', 'mega'] },
  { id: 'cat-kitten', file: 'cat-kitten.webp', themes: ['cat', 'smol'], tags: ['baby', 'mini', 'smol'] },
  { id: 'frog-grin', file: 'frog-grin.webp', themes: ['frog'], tags: [] },
  { id: 'frog-hoodie', file: 'frog-hoodie.webp', themes: ['frog'], tags: ['chad'] },
  { id: 'frog-tiny', file: 'frog-tiny.webp', themes: ['frog', 'smol'], tags: ['baby', 'mini', 'smol'] },
  { id: 'ape-chain', file: 'ape-chain.webp', themes: ['ape'], tags: ['chad', 'giga', 'gigachad'] },
  { id: 'ape-baby', file: 'ape-baby.webp', themes: ['ape', 'smol'], tags: ['baby', 'smol'] },
  { id: 'rat-beanie', file: 'rat-beanie.webp', themes: ['rat'], tags: [] },
  { id: 'bear-grump', file: 'bear-grump.webp', themes: ['bear'], tags: ['angry'] },
  { id: 'bear-sleepy', file: 'bear-sleepy.webp', themes: ['bear'], tags: ['sleepy', 'lazy'] },
  { id: 'bull-gold', file: 'bull-gold.webp', themes: ['bull'], tags: [] },
  { id: 'goat-beard', file: 'goat-beard.webp', themes: ['goat'], tags: [] },
  { id: 'squirrel-peanut', file: 'squirrel-peanut.webp', themes: ['squirrel'], tags: [] },
  { id: 'robot-visor', file: 'robot-visor.webp', themes: ['ai', 'tech'], tags: [] },
  { id: 'robot-orb', file: 'robot-orb.webp', themes: ['ai', 'tech'], tags: ['baby', 'smol'] },
  { id: 'rocket-face', file: 'rocket-face.webp', themes: ['rocket', 'moon'], tags: ['turbo'] },
  { id: 'politics-corgi', file: 'politics-corgi.webp', themes: ['politics'], tags: [] },
  { id: 'politics-eagle', file: 'politics-eagle.webp', themes: ['politics'], tags: ['giga'] },
  { id: 'toon-blob', file: 'toon-blob.webp', themes: ['toon'], tags: [] },
  { id: 'toon-pickle', file: 'toon-pickle.webp', themes: ['toon'], tags: [] },
  { id: 'car-gold', file: 'car-gold.webp', themes: ['car'], tags: [] },
  { id: 'trader-hoodie', file: 'trader-hoodie.webp', themes: ['trader'], tags: [] },
  { id: 'clown-frog', file: 'clown-frog.webp', themes: ['clown'], tags: [] },
  { id: 'penguin-scarf', file: 'penguin-scarf.webp', themes: ['chill'], tags: [] },
  { id: 'food-pizza', file: 'food-pizza.webp', themes: ['food'], tags: [] },
  { id: 'food-burger', file: 'food-burger.webp', themes: ['food'], tags: [] },
  { id: 'food-ramen', file: 'food-ramen.webp', themes: ['food'], tags: [] },
  { id: 'monk-raccoon', file: 'monk-raccoon.webp', themes: ['monk'], tags: [] },
  { id: 'halo-lamb', file: 'halo-lamb.webp', themes: ['halo'], tags: [] },
  { id: 'holiday-corgi', file: 'holiday-corgi.webp', themes: ['holiday'], tags: [] },
  { id: 'royal-lion', file: 'royal-lion.webp', themes: ['royal'], tags: [] },
  { id: 'chad-helmet', file: 'chad-helmet.webp', themes: ['chad'], tags: ['giga', 'gigachad'] },
];

export const AUTHOR_IMAGE_CATALOG: readonly AuthorImageAsset[] = [
  { id: 'author-hoodie', file: 'author-hoodie.webp' },
  { id: 'author-glasses', file: 'author-glasses.webp' },
  { id: 'author-cap', file: 'author-cap.webp' },
  { id: 'author-beanie', file: 'author-beanie.webp' },
  { id: 'author-bob', file: 'author-bob.webp' },
  { id: 'author-curly', file: 'author-curly.webp' },
];

/** Longer words are preferred when several keywords hit the same name. */
export const THEME_KEYWORDS: readonly ThemeKeyword[] = [
  { word: 'POPCAT', theme: 'cat' },
  { word: 'HARAMBE', theme: 'ape' },
  { word: 'COPIUM', theme: 'trader' },
  { word: 'HOPIUM', theme: 'trader' },
  { word: 'BURGER', theme: 'food' },
  { word: 'CHILLY', theme: 'chill' },
  { word: 'PIZZA', theme: 'food' },
  { word: 'RAMEN', theme: 'food' },
  { word: 'PATRICK', theme: 'toon' },
  { word: 'MORTY', theme: 'toon' },
  { word: 'SPONGE', theme: 'toon' },
  { word: 'FLOKI', theme: 'dog' },
  { word: 'NEIRO', theme: 'dog' },
  { word: 'MAGA', theme: 'politics' },
  { word: 'TRUMP', theme: 'politics' },
  { word: 'MICHI', theme: 'cat' },
  { word: 'WOJAK', theme: 'trader' },
  { word: 'CLOWN', theme: 'clown' },
  { word: 'SANTA', theme: 'holiday' },
  { word: 'LAMBO', theme: 'car' },
  { word: 'QUANT', theme: 'ai' },
  { word: 'SIGMA', theme: 'chad' },
  { word: 'ELON', theme: 'tech' },
  { word: 'GROK', theme: 'ai' },
  { word: 'JESUS', theme: 'halo' },
  { word: 'BILLY', theme: 'toon' },
  { word: 'HOMER', theme: 'toon' },
  { word: 'ELMO', theme: 'toon' },
  { word: 'BART', theme: 'toon' },
  { word: 'RICK', theme: 'toon' },
  { word: 'PNUT', theme: 'squirrel' },
  { word: 'BONK', theme: 'dog' },
  { word: 'SHIB', theme: 'dog' },
  { word: 'BOME', theme: 'dog' },
  { word: 'DOGE', theme: 'dog' },
  { word: 'PEPE', theme: 'frog' },
  { word: 'FROG', theme: 'frog' },
  { word: 'KEKE', theme: 'frog' },
  { word: 'GOAT', theme: 'goat' },
  { word: 'BEAR', theme: 'bear' },
  { word: 'BOBO', theme: 'bear' },
  { word: 'BULL', theme: 'bull' },
  { word: 'MONK', theme: 'monk' },
  { word: 'KING', theme: 'royal' },
  { word: 'BOZO', theme: 'clown' },
  { word: 'SMOL', theme: 'smol' },
  { word: 'SEND', theme: 'moon' },
  { word: 'MOON', theme: 'moon' },
  { word: 'TURBO', theme: 'rocket' },
  { word: 'WIF', theme: 'dog' },
  { word: 'INU', theme: 'dog' },
  { word: 'APE', theme: 'ape' },
  { word: 'CAT', theme: 'cat' },
  { word: 'DOG', theme: 'dog' },
  { word: 'RAT', theme: 'rat' },
];

export const IMAGE_MODIFIERS: readonly string[] = [
  'GIGACHAD',
  'SLEEPY',
  'ANGRY',
  'BABY',
  'MINI',
  'SMOL',
  'LAZY',
  'ULTRA',
  'SUPER',
  'GIGA',
  'MEGA',
  'CHAD',
  'TURBO',
  'SIGMA',
];
