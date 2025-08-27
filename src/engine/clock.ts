export type TickHandler = (dtSec: number, nowMs: number) => void;

export class Clock {
  private tickMs: number;
  private onTick: TickHandler;
  private handle: number | null = null;
  private speed = 1;

  constructor(tickMs: number, onTick: TickHandler) {
    this.tickMs = tickMs;
    this.onTick = onTick;
  }

  start() {
    if (this.handle !== null) return;
    this.handle = window.setInterval(() => {
      this.onTick((this.tickMs * this.speed) / 1000, performance.now());
    }, this.tickMs);
  }

  stop() {
    if (this.handle !== null) {
      clearInterval(this.handle);
      this.handle = null;
    }
  }

  setSpeed(mult: number) {
    this.speed = Math.max(0.1, mult);
  }
}
