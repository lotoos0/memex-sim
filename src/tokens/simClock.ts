import { SIM_TIME_MULTIPLIER } from './types';

/**
 * The only conversion between wall time and simulation time.
 * `SIM_TIME_MULTIPLIER` in tokens/types.ts is the scale: simulation
 * milliseconds advanced per wall-clock millisecond. 1 means real time.
 * Do not multiply by that constant anywhere else.
 */
export function toSimDtMs(wallDtMs: number): number {
  return wallDtMs * SIM_TIME_MULTIPLIER;
}

/** Wall seconds required to advance the simulation by `simDtMs`. */
export function wallSecForSimMs(simDtMs: number): number {
  return simDtMs / (SIM_TIME_MULTIPLIER * 1000);
}
