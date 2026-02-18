import { RNG } from '../engine/rng';
import type { TokenFate, TokenMeta, TokenMetrics } from './types';
import { SUPPLY } from './types';

const ADJECTIVES = [
  'BABY', 'MEGA', 'SUPER', 'ULTRA', 'MINI', 'BASED', 'DEGEN', 'ALPHA', 'SIGMA',
  'TURBO', 'CHAD', 'GIGACHAD', 'COPE', 'WAGMI', 'NGMI', 'MOON', 'PUMP', 'SHILL',
  'BLESSED', 'CURSED', 'REKT', 'GIGA', 'DANK', 'LAZY', 'SLEEPY', 'ANGRY',
];

const NOUNS = [
  'PEPE', 'DOGE', 'FROG', 'CAT', 'DOG', 'APE', 'MONK', 'RAT', 'BEAR', 'BULL',
  'WOJAK', 'BONK', 'WIF', 'FLOKI', 'SHIB', 'INU', 'ELMO', 'HOMER', 'BART',
  'RICK', 'MORTY', 'SPONGE', 'PATRICK', 'PNUT', 'GOAT', 'MICHI', 'TRUMP',
  'MAGA', 'POPCAT', 'BOME', 'BILLY', 'JESUS', 'ELON', 'GROK', 'TURBO',
  'SANTA', 'LAMBO', 'SEND', 'QUANT', 'NEIRO', 'CHILLY', 'KING', 'SIGMA',
  'HARAMBE', 'SMOL', 'BOZO', 'CLOWN', 'COPIUM', 'HOPIUM', 'BOBO', 'KEKE',
];

const LOGO_COLORS = [
  '#ff6b35', '#ff4d6a', '#f5c542', '#00d4a1', '#6c63ff',
  '#ff77a9', '#00c2ff', '#ff9f43', '#a29bfe', '#fd79a8',
  '#00cec9', '#e17055', '#74b9ff', '#55efc4', '#fdcb6e',
  '#d63031', '#0984e3', '#00b894', '#e84393', '#f39c12',
];

let _counter = 0;

export function generateToken(rng: RNG, simTimeMs: number): TokenMeta {
  const id = `tok_${++_counter}_${(rng.next() * 0xFFFFFF | 0).toString(16)}`;

  const useAdj = rng.next() < 0.35;
  const adj = ADJECTIVES[Math.floor(rng.next() * ADJECTIVES.length)]!;
  const noun = NOUNS[Math.floor(rng.next() * NOUNS.length)]!;
  const name = useAdj ? `${adj}${noun}` : noun;
  const ticker = name.slice(0, 9);

  const logoColor = LOGO_COLORS[Math.floor(rng.next() * LOGO_COLORS.length)]!;

  const fateRoll = rng.next();
  let fate: TokenFate;
  if (fateRoll < 0.20)      fate = 'QUICK_RUG';
  else if (fateRoll < 0.60) fate = 'SHORT';
  else if (fateRoll < 0.90) fate = 'NORMAL';
  else                       fate = 'LONG_RUNNER';

  return {
    id, name, ticker, logoColor,
    supply: SUPPLY,
    createdAtSimMs: simTimeMs,
    fate,
    metrics: generateMetrics(rng, fate),
  };
}

function generateMetrics(rng: RNG, fate: TokenFate): TokenMetrics {
  const isSketch = fate === 'QUICK_RUG';
  return {
    topHoldersPct:  Math.round((isSketch ? 45 : 18) + rng.next() * 25),
    devHoldingsPct: Math.round(rng.next() * (isSketch ? 18 : 7)),
    snipersPct:     Math.round(rng.next() * (isSketch ? 28 : 12)),
    lpBurnedPct:    Math.round(isSketch ? rng.next() * 15 : 55 + rng.next() * 45),
    insidersPct:    Math.round(rng.next() * 8),
    bundlersPct:    Math.round(rng.next() * 5),
  };
}

export function getFateTimeoutSimMs(fate: TokenFate, rng: RNG): number {
  switch (fate) {
    case 'QUICK_RUG':   return (5  + rng.next() * 25)  * 60_000;
    case 'SHORT':       return (30 + rng.next() * 150) * 60_000;
    case 'NORMAL':      return (180 + rng.next() * 540) * 60_000;
    case 'LONG_RUNNER': return (720 + rng.next() * 2160) * 60_000;
  }
}

export function getStartingMcapUsd(fate: TokenFate, rng: RNG): number {
  switch (fate) {
    case 'QUICK_RUG':   return 2_000 + rng.next() * 8_000;
    case 'SHORT':       return 2_000 + rng.next() * 15_000;
    case 'NORMAL':      return 3_000 + rng.next() * 20_000;
    case 'LONG_RUNNER': return 5_000 + rng.next() * 30_000;
  }
}

export type InitialRegime = 'bull' | 'bear' | 'range' | 'mania' | 'rugRisk';

export function getInitialRegime(fate: TokenFate): InitialRegime {
  switch (fate) {
    case 'QUICK_RUG':   return 'rugRisk';
    case 'SHORT':       return 'range';
    case 'NORMAL':      return 'bull';
    case 'LONG_RUNNER': return 'bull';
  }
}
