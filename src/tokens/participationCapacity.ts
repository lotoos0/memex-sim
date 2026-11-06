const WINDOW_MS = 5_000;
const WINDOW_COUNT = 12;
const TTL_MS = 120_000;
const MAX_CREDIT = 12;
const DECAY = Math.exp(-5 / 60);

type CreditLot = { expiresAt: number; mass: number };

/** A token-local budget of expected arrivals, measured on the simulation clock. */
export class ParticipationCapacity {
  private readonly activity = new Map<number, number>();
  private readonly lots: CreditLot[] = [];
  private closed = 0;
  private capacity = 0;
  private pending: { start: number; end: number; reserve: number; release: number } | undefined;
  private settledUntil = 0;

  private advance(start: number): void {
    const boundary = Math.floor(start / WINDOW_MS);
    while (this.closed < boundary) {
      // After the trailing window empties, the remaining gap is pure decay.
      if (this.activity.size === 0) {
        this.capacity *= DECAY ** (boundary - this.closed);
        this.closed = boundary;
        break;
      }
      this.closed++;
      const first = this.closed - WINDOW_COUNT;
      this.activity.delete(first - 1);
      let active = 0, buy = 0, sell = 0;
      for (const [index, flags] of this.activity) {
        if (index >= this.closed) continue;
        active++;
        if (flags & 1) buy++;
        if (flags & 2) sell++;
      }
      const target = this.closed >= WINDOW_COUNT && buy >= 2 && sell >= 2
        ? Math.min(1, Math.max(0, (active - 3) / 5)) : 0;
      this.capacity = target + (this.capacity - target) * DECAY;
    }
  }

  begin(start: number, end: number, reference: number, eligible: boolean): number {
    if (this.pending || start < this.settledUntil || end <= start) {
      throw new Error('Invalid participation interval');
    }
    this.advance(start);
    while (this.lots.length && this.lots[0]!.expiresAt <= end) this.lots.shift();
    const dt = (end - start) / 1000;
    const enabled = eligible && reference > 0 && start >= 60_000;
    const credit = this.lots.reduce((sum, lot) => sum + lot.mass, 0);
    const reserve = enabled ? 0.2 * (1 - 0.5 * this.capacity) * reference * dt : 0;
    const factor = Math.min(1, Math.max(0, (this.capacity - 0.4) / 0.6));
    const release = enabled ? Math.min(0.2 * factor * dt, credit / 60 * dt, credit) : 0;
    this.pending = { start, end, reserve, release };
    return reference + (release - reserve) / dt;
  }

  observe(ageMs: number, side: 'BUY' | 'SELL'): void {
    if (!this.pending) return;
    const index = Math.floor(ageMs / WINDOW_MS);
    if (index < this.closed) return;
    this.activity.set(index, (this.activity.get(index) ?? 0) | (side === 'BUY' ? 1 : 2));
  }

  settle(): void {
    const tick = this.pending;
    if (!tick) return;
    let debit = tick.release;
    while (debit > 0 && this.lots.length) {
      const lot = this.lots[0]!;
      const amount = Math.min(debit, lot.mass);
      lot.mass -= amount;
      debit -= amount;
      if (lot.mass === 0) this.lots.shift();
    }
    const remaining = this.lots.reduce((sum, lot) => sum + lot.mass, 0);
    const stored = Math.min(Math.max(0, MAX_CREDIT - remaining), tick.reserve);
    if (stored > 0) {
      const expiresAt = Math.floor(tick.start / WINDOW_MS) * WINDOW_MS + TTL_MS;
      const last = this.lots[this.lots.length - 1];
      if (last?.expiresAt === expiresAt) last.mass += stored;
      else this.lots.push({ expiresAt, mass: stored });
    }
    this.settledUntil = tick.end;
    this.pending = undefined;
  }

  clear(): void {
    this.activity.clear();
    this.lots.length = 0;
    this.pending = undefined;
    this.capacity = 0;
  }
}
