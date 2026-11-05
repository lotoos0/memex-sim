/** Experimental P1 parameters, fixed before cohort measurement. No directional signal. */
export const CONDITIONAL_ACTIVITY = Object.freeze({
  decaySec: 8,
  excitationPerTrade: 0.075,
  maxExtraPerSec: 2,
  maxRateMultiplier: 6,
});

export class ConditionalActivity {
  private rate = 0;
  private committedMs = 0;

  private decayed(nowSimMs: number): number {
    return this.rate * Math.exp(-Math.max(0, nowSimMs - this.committedMs) / (1000 * CONDITIONAL_ACTIVITY.decaySec));
  }

  extraPerSec(nowSimMs: number, organicPerSec: number): number {
    return Math.min(this.decayed(nowSimMs), Math.max(0, organicPerSec) * (CONDITIONAL_ACTIVITY.maxRateMultiplier - 1));
  }

  /** Commit only after the tick's executed prints are known; queries never mutate state. */
  commit(nowSimMs: number, executedTrades: number): void {
    if (!Number.isFinite(nowSimMs) || nowSimMs < this.committedMs
      || !Number.isSafeInteger(executedTrades) || executedTrades < 0) {
      throw new Error('Invalid conditional activity observation');
    }
    this.rate = Math.min(CONDITIONAL_ACTIVITY.maxExtraPerSec,
      this.decayed(nowSimMs) + executedTrades * CONDITIONAL_ACTIVITY.excitationPerTrade);
    this.committedMs = nowSimMs;
  }
}
