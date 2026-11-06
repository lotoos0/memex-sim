import { assertSimTime, type Envelope, type Key, type Manifest, type Message, type Phase } from './contracts';
import { canonical, checksum } from './snapshot';
import { SimulationClock } from './simulationClock';

export type Committed<M> = Message<M> & { commitId: string; factOrdinal: number };
export type KernelState<Q> = { now: number; cursor: Key | null; nextSequence: bigint; pending: Message<Q>[] };

function compare(a: Key, b: Key) {
  return a.at - b.at || a.round - b.round || a.phase - b.phase || (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0);
}

class EventQueue<Q> {
  private readonly heap: Message<Q>[] = [];

  push(event: Message<Q>) {
    const heap = this.heap;
    let index = heap.length;
    heap.push(event);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (compare(heap[parent].key, event.key) <= 0) break;
      heap[index] = heap[parent];
      index = parent;
    }
    heap[index] = event;
  }

  peek() {
    return this.heap[0];
  }

  pop() {
    const heap = this.heap;
    const first = heap[0];
    const last = heap.pop();
    if (!last || heap.length === 0) return first;
    let index = 0;
    while (index * 2 + 1 < heap.length) {
      let child = index * 2 + 1;
      if (child + 1 < heap.length && compare(heap[child + 1].key, heap[child].key) < 0) child++;
      if (compare(last.key, heap[child].key) <= 0) break;
      heap[index] = heap[child];
      index = child;
    }
    heap[index] = last;
    return first;
  }

  snapshot() {
    return [...this.heap].sort((a, b) => compare(a.key, b.key));
  }

  get size() { return this.heap.length; }
}

export class Kernel<Q, F> {
  readonly log: Committed<F>[] = [];
  private readonly queue = new EventQueue<Q>();
  private readonly runId: string;
  private cursor: Key | null = null;
  private sequence = 0n;
  readonly clock: SimulationClock;
  private current: Message<Q> | null = null;
  private staged: Committed<F>[] = [];
  private scheduled: Message<Q>[] = [];
  private undo: (() => void)[] = [];
  private fault: unknown = null;

  constructor(readonly manifest: Manifest, state?: KernelState<Q>, log: readonly Committed<F>[] = []) {
    this.runId = checksum(canonical(manifest));
    this.clock = new SimulationClock(manifest.epochUtcMs, state?.now);
    if (state) {
      this.sequence = state.nextSequence;
      this.cursor = state.cursor;
      for (const event of state.pending) this.queue.push(event);
    }
    this.log = [...log];
  }

  get now() { return this.current?.key.at ?? this.clock.now; }
  get pendingCount() { return this.queue.size; }

  onRollback(undo: () => void) {
    if (this.current) this.undo.push(undo);
  }

  rememberProperty = (target: object, key: string) => {
    if (!this.current) return;
    const previous = Object.getOwnPropertyDescriptor(target, key);
    this.onRollback(() => {
      if (previous) Object.defineProperty(target, key, previous);
      else Reflect.deleteProperty(target, key);
    });
  };

  schedule<K extends keyof Q & string>(
    at: number, phase: Phase, kind: K, payload: Q[K], cause?: Pick<Envelope<string, unknown>, 'id' | 'rootId'>,
  ) {
    if (this.fault) throw this.fault;
    assertSimTime(at);
    if (at < this.now) throw new Error('Cannot schedule in the past');
    const active = this.current?.key;
    const cursor = active ?? this.cursor;
    const round = cursor?.at === at ? cursor.round + (!active || phase <= cursor.phase ? 1 : 0) : 0;
    if (round >= 128) throw new Error('Event round limit exceeded');
    const seq = this.sequence++;
    const id = this.runId + '/e/' + seq;
    const parent = cause ?? this.current;
    const event = {
      id, kind, payload, schemaVersion: 1, key: { at, round, phase, seq },
      causeIds: parent ? [parent.id] : [], rootId: parent?.rootId ?? id,
    } as Message<Q>;
    if (this.current) this.scheduled.push(event);
    else this.queue.push(event);
    return event;
  }

  fact<K extends keyof F & string>(
    kind: K, payload: F[K], cause?: Pick<Envelope<string, unknown>, 'id' | 'rootId'>,
  ) {
    const task = this.current;
    if (!task) throw new Error('Facts require an active commit');
    const factOrdinal = this.staged.length;
    const fact = {
      id: task.id + '/f/' + factOrdinal, commitId: task.id, factOrdinal,
      schemaVersion: 1, kind, key: task.key, payload,
      causeIds: [cause?.id ?? task.id], rootId: cause?.rootId ?? task.rootId,
    } as Committed<F>;
    this.staged.push(fact);
    return fact;
  }

  advanceTo(target: number, process: (event: Message<Q>) => void, shouldStop?: () => boolean) {
    if (this.fault) throw this.fault;
    assertSimTime(target);
    assertSimTime(this.clock.epochUtcMs + target);
    if (target < this.clock.now || this.current) throw new Error('Invalid advance');
    while (this.queue.peek()?.key.at <= target) {
      if (shouldStop?.()) return;
      const event = this.queue.pop();
      const sequence = this.sequence;
      const logLength = this.log.length;
      this.current = event;
      try {
        process(event);
        for (const fact of this.staged) this.log.push(fact);
        for (const task of this.scheduled) this.queue.push(task);
        this.clock.moveTo(event.key.at);
        const next = this.queue.peek();
        const closesRound = next?.key.at !== event.key.at || next.key.round !== event.key.round;
        this.cursor = closesRound ? { ...event.key, phase: 60 } : event.key;
      } catch (error) {
        for (let i = this.undo.length - 1; i >= 0; i--) this.undo[i]();
        this.log.length = logLength;
        this.sequence = sequence;
        this.queue.push(event);
        this.fault = error;
        throw error;
      } finally {
        this.staged = [];
        this.scheduled = [];
        this.undo = [];
        this.current = null;
      }
    }
    if (!shouldStop?.()) this.clock.moveTo(target);
  }

  snapshot(): KernelState<Q> {
    if (this.fault) throw this.fault;
    if (this.current) throw new Error('Cannot snapshot during a commit');
    return { now: this.clock.now, cursor: this.cursor, nextSequence: this.sequence, pending: this.queue.snapshot() };
  }
}
