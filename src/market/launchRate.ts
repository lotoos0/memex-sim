/**
 * Pump.fun launches per minute by UTC hour.
 * Sample: pumpdatafun/pump-fun-trades-sample, 2026-10-15 (phase-1 calibration).
 * The 24-hour mean is 32.3. SOL-quoted prints in that sample were ~25/min;
 * this table is the launch count, which is what the New Pairs column should track.
 *
 * Session profiles in session.ts still scale trade tempo inside a coin.
 * Births use this table alone so the UTC hour is not applied a second time
 * through tempoMul.
 */
export const LAUNCHES_PER_MIN_BY_UTC_HOUR: readonly number[] = [
  28.7, 31.1, 23.5, 22.7, 20.4, 20.5,
  21.5, 21.0, 17.9, 21.9, 20.7, 23.5,
  31.9, 40.1, 35.7, 38.3, 50.6, 39.5,
  44.0, 56.7, 44.5, 46.1, 40.2, 35.1,
];

export function launchesPerMinute(nowMs: number): number {
  const hour = new Date(nowMs).getUTCHours();
  return LAUNCHES_PER_MIN_BY_UTC_HOUR[hour] ?? LAUNCHES_PER_MIN_BY_UTC_HOUR[0]!;
}

/** Expected birth count over `simDtSec` at the civil UTC hour of `nowMs`. */
export function expectedLaunches(nowMs: number, simDtSec: number): number {
  if (!Number.isFinite(simDtSec) || simDtSec <= 0) return 0;
  return (launchesPerMinute(nowMs) / 60) * simDtSec;
}
