import type { RNG } from '../engine/rng';
import type { TokenFate } from './types';

/**
 * Fresh-launch fate mix. Arrival decay and the per-fate silence draw are unchanged
 * for the coins that are allowed to trade. A stillborn share never opens crowd flow,
 * so Pulse is mostly a dev buy and a flat print. The alive share can still graduate.
 */
export const STILLBORN_LAUNCH_SHARE = 0.48;

export const FRESH_LAUNCH_FATE_WEIGHTS: readonly (readonly [TokenFate, number])[] = [
  ['QUICK_RUG', 0.30],
  ['SHORT', 0.40],
  ['NORMAL', 0.20],
  ['LONG_RUNNER', 0.10],
];

export function pickFreshLaunchFate(rng: RNG): TokenFate {
  const roll = rng.next();
  let cursor = 0;
  for (let i = 0; i < FRESH_LAUNCH_FATE_WEIGHTS.length; i++) {
    const entry = FRESH_LAUNCH_FATE_WEIGHTS[i]!;
    cursor += entry[1];
    if (roll < cursor) return entry[0];
  }
  return 'SHORT';
}

export function rollStillbornLaunch(rng: RNG): boolean {
  return rng.next() < STILLBORN_LAUNCH_SHARE;
}
