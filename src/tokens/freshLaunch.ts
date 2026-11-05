import type { RNG } from '../engine/rng';
import type { TokenFate } from './types';

/**
 * Fresh-launch fate mix. Arrival decay is unchanged for coins that are allowed
 * to trade. A stillborn share never opens crowd flow and does not take the dev
 * launch buy, so those coins stay at the curve start mcap.
 *
 * 0.22 matches the launches with no creator trade on 2026-10-15: 23,184 / 29,117
 * (79.6%) of the lifecycle cohort had a creator who traded, and 99.7% of those
 * bought in block 0 (docs/calibration/faza1/metrics.json `dev`, raport-faza1 §2.5).
 */
export const STILLBORN_LAUNCH_SHARE = 0.22;

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
