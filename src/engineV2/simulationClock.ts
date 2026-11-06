import { assertSimTime } from './contracts';

export class SimulationClock {
  constructor(readonly epochUtcMs: number, private time: number = 0) {
    assertSimTime(epochUtcMs);
    assertSimTime(time);
    assertSimTime(epochUtcMs + time);
  }

  get now() { return this.time; }
  get utcNow() { return this.epochUtcMs + this.time; }

  moveTo(target: number) {
    assertSimTime(target);
    assertSimTime(this.epochUtcMs + target);
    if (target < this.time) throw new Error('Simulation clock cannot run backward');
    this.time = target;
  }
}
