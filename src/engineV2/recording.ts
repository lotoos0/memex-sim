import type { Manifest } from './contracts';
import type { FactMap } from './events';
import type { Committed } from './kernel';
import { RecordedPlayback } from './projections';
import { canonical, checksum, readCanonical } from './snapshot';
import { World, type Ingress, type WorldConfig } from './world';
import type { SessionBucket } from '../market/session';

const CHECKPOINT_INTERVAL_MS = 120_000;

export type RecordingHead = {
  version: 1;
  index: number;
  hash: string;
  now: number;
  checkpoint: { index: number; now: number; hash: string; stateHash: string };
  manifest: Manifest;
};
export type RecordingBlock = { version: 1; index: number; hash: string; data: Blob };
export type Frame = {
  previous: string | null;
  now: number;
  ordinal: number;
  override: SessionBucket | null;
  ingress: Ingress[];
  facts: Committed<FactMap>[];
};

export class ArchiveIntegrityError extends Error {}

export interface RecordingStore {
  head(): Promise<RecordingHead | undefined>;
  count(): Promise<number>;
  frame(index: number): Promise<RecordingBlock | undefined>;
  checkpoint(index: number): Promise<RecordingBlock | undefined>;
  append(expected: RecordingHead | undefined, head: RecordingHead, frame: RecordingBlock,
    checkpoint?: RecordingBlock): Promise<void>;
}

async function pack(index: number, text: string): Promise<RecordingBlock> {
  const data = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
  return { version: 1, index, hash: checksum(text), data };
}

async function unpack<T>(block: RecordingBlock | undefined, index: number, hash?: string): Promise<T> {
  if (!block || block.index !== index || block.version !== 1 || (hash !== undefined && block.hash !== hash)) {
    throw new Error('Missing or incompatible recording block ' + index);
  }
  const text = await new Response(block.data.stream().pipeThrough(new DecompressionStream('gzip'))).text();
  if (checksum(text) !== block.hash) throw new Error('Recording checksum mismatch at block ' + index);
  return readCanonical<T>(text);
}

type SavedWorld = {
  frameHash: string;
  world: string;
  projection: ReturnType<RecordedPlayback['hotCheckpoint']>;
  ordinal: number;
  override: SessionBucket | null;
};

export class Recording {
  private writing = false;
  private failed = false;
  private constructor(
    private readonly store: RecordingStore,
    readonly world: World,
    readonly playback: RecordedPlayback,
    private saved?: RecordingHead,
    public ordinal = 0,
    public override: SessionBucket | null = null,
  ) {}

  get head() { return this.saved; }

  async exportTo(write: (line: string) => Promise<unknown>) {
    const head = this.saved;
    if (!head) throw new Error('No saved recording');
    await write(JSON.stringify({ version: 1, head, config: this.world.config }) + '\n');
    for await (const frame of recordedFrames(this.store, head)) await write(canonical(frame) + '\n');
  }

  static async open(store: RecordingStore, config: WorldConfig) {
    const head = await store.head();
    if (!head) {
      if (await store.count()) throw new Error('Recording head is missing');
      const world = new World(config);
      return new Recording(store, world, new RecordedPlayback(config.epochUtcMs, true));
    }
    if (head.version !== 1 || !Number.isSafeInteger(head.index) || head.index < 0
      || head.checkpoint.index < 0 || head.checkpoint.index > head.index || await store.count() < head.index + 1) {
      throw new Error('Invalid recording head or missing archive blocks');
    }
    const anchor = head.checkpoint;
    const saved = await unpack<SavedWorld>(await store.checkpoint(anchor.index), anchor.index, anchor.stateHash);
    const anchorFrame = await unpack<Frame>(await store.frame(anchor.index), anchor.index, anchor.hash);
    if (saved.frameHash !== anchor.hash || anchorFrame.now !== anchor.now
      || saved.ordinal !== anchorFrame.ordinal || saved.override !== anchorFrame.override) {
      throw new Error('Checkpoint does not belong to the archive');
    }
    const world = World.fromCheckpoint(saved.world, head.manifest);
    if (world.now !== anchor.now) throw new Error('Checkpoint clock does not match the archive');
    const playback = new RecordedPlayback(world.config.epochUtcMs, true, structuredClone(world.ledger.state), saved.projection);
    const recording = new Recording(store, world, playback, head, saved.ordinal, saved.override);
    let previous = anchor.hash;
    for (let index = anchor.index + 1; index <= head.index; index++) {
      const block = await store.frame(index);
      const frame = await unpack<Frame>(block, index);
      if (frame.previous !== previous || frame.now < world.now) throw new Error('Broken recording chain');
      world.replayIngress(frame.ingress, frame.now);
      if (canonical(world.kernel.log) !== canonical(frame.facts)) throw new Error('Deterministic recording diverged');
      playback.append(frame.facts, frame.now);
      world.pruneRecordedHistory(frame.facts);
      recording.ordinal = frame.ordinal;
      recording.override = frame.override;
      previous = block!.hash;
    }
    if (world.now !== head.now || previous !== head.hash) throw new Error('Recording head does not match restored state');
    world.ledger.assertConservation();
    return recording;
  }

  async save() {
    if (this.writing || this.failed) throw new Error('Recording is already writing or has stopped');
    this.writing = true;
    try {
      return await this.write();
    } catch (error) {
      this.failed = true;
      throw error;
    } finally {
      this.writing = false;
    }
  }

  private async write() {
    const previous = this.saved;
    const index = (previous?.index ?? -1) + 1;
    const now = this.world.now;
    const facts = this.world.kernel.log;
    const payload = canonical({ previous: previous?.hash ?? null, now, ordinal: this.ordinal,
      override: this.override, ingress: this.world.state.ingress, facts } satisfies Frame);
    this.playback.append(facts, now);
    this.world.pruneRecordedHistory(facts);
    const takeCheckpoint = !previous || now - previous.checkpoint.now >= CHECKPOINT_INTERVAL_MS;
    const frame = await pack(index, payload);
    const state = takeCheckpoint ? canonical({ frameHash: frame.hash, world: this.world.checkpointData(),
      projection: this.playback.hotCheckpoint(), ordinal: this.ordinal, override: this.override } satisfies SavedWorld) : null;
    const checkpoint = state === null ? undefined : await pack(index, state);
    const head: RecordingHead = {
      version: 1, index, hash: frame.hash, now, manifest: this.world.kernel.manifest,
      checkpoint: checkpoint ? { index, now, hash: frame.hash, stateHash: checkpoint.hash } : previous!.checkpoint,
    };
    await this.store.append(previous, head, frame, checkpoint);
    this.saved = head;
    return { frameBytes: frame.data.size, checkpointBytes: checkpoint?.data.size ?? 0 };
  }
}

// Each frame is independently verified so consumers can stream playback or benchmark
// exports without retaining the archive. The caller pins a head before iteration.
export async function* recordedFrames(store: RecordingStore, head: RecordingHead) {
  if (head.version !== 1) throw new ArchiveIntegrityError('Incompatible recording version');
  let previous: string | null = null;
  let now = 0;
  for (let index = 0; index <= head.index; index++) {
    let block: RecordingBlock | undefined;
    let frame: Frame;
    try {
      block = await store.frame(index);
      frame = await unpack<Frame>(block, index, index === head.index ? head.hash : undefined);
    } catch (error) {
      throw new ArchiveIntegrityError('Cannot verify archive frame ' + index + ': ' +
        (error instanceof Error ? error.message : String(error)));
    }
    if (frame.previous !== previous || frame.now < now || (index === head.index && frame.now !== head.now)) {
      throw new ArchiveIntegrityError('Broken recording chain at frame ' + index);
    }
    previous = block!.hash;
    now = frame.now;
    yield frame;
  }
}

export async function rerunRecording(store: RecordingStore, head: RecordingHead, config: WorldConfig) {
  const world = new World(config);
  if (canonical(world.kernel.manifest) !== canonical(head.manifest)) throw new Error('Incompatible rerun manifest');
  for await (const frame of recordedFrames(store, head)) {
    world.replayIngress(frame.ingress, frame.now);
    if (canonical(world.kernel.log) !== canonical(frame.facts)) throw new Error('Deterministic recording diverged');
    world.pruneRecordedHistory(frame.facts);
  }
  return world;
}
