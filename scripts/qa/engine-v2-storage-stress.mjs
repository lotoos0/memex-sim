import { build } from 'esbuild';
import { mkdir, mkdtemp, readFile, rename, rm, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const hours = process.argv.slice(2).map(Number);
if (!hours.length) hours.push(1, 6, 12);
if (hours.some((value, index) => !Number.isSafeInteger(value) || value <= (hours[index - 1] ?? 0))) {
  throw new Error('Provide strictly increasing positive whole simulated hours');
}
const tmp = await mkdtemp(join(tmpdir(), 'memex-storage-'));
const modulePath = join(tmp, 'runtime.mjs');
const output = resolve('output/engine-v2-storage');
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(output, 'stress-'));

async function optional(path) {
  try { return await readFile(path); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}

class DiskArchive {
  records = 0;
  frameBytes = 0;
  checkpointBytes = 0;

  async head() {
    const data = await optional(join(directory, 'head.json'));
    return data && JSON.parse(data);
  }

  async count() { return this.records; }

  async block(type, index) {
    const prefix = join(directory, type + '-' + index);
    const metadata = await optional(prefix + '.json');
    if (!metadata) return undefined;
    return { ...JSON.parse(metadata), data: new Blob([await readFile(prefix + '.gz')]) };
  }

  frame(index) { return this.block('frame', index); }
  checkpoint(index) { return this.block('checkpoint', index); }

  async put(type, block) {
    const { data, ...metadata } = block;
    const prefix = join(directory, type + '-' + block.index);
    await writeFile(prefix + '.gz', Buffer.from(await data.arrayBuffer()));
    await writeFile(prefix + '.json', JSON.stringify(metadata));
  }

  async append(expected, head, frame, checkpoint) {
    if (head.index !== this.records || expected?.index !== (this.records ? this.records - 1 : undefined)) {
      throw new Error('Archive writer conflict');
    }
    await this.put('frame', frame);
    if (checkpoint) await this.put('checkpoint', checkpoint);
    const headPath = join(directory, 'head.json');
    await writeFile(headPath + '.next', JSON.stringify(head));
    await rename(headPath + '.next', headPath);
    this.records++;
    this.frameBytes += frame.data.size;
    if (checkpoint) {
      this.checkpointBytes = checkpoint.data.size;
      if (expected) {
        await unlink(join(directory, 'checkpoint-' + expected.checkpoint.index + '.gz'));
        await unlink(join(directory, 'checkpoint-' + expected.checkpoint.index + '.json'));
      }
    }
  }
}

function p95(values) {
  return values.slice().sort((a, b) => a - b)[Math.floor(values.length * 0.95)];
}

try {
  await build({
    stdin: {
      contents: "export * from './src/engineV2/recording'; export * from './src/engineV2/world'; export * from './src/engineV2/snapshot';",
      resolveDir: process.cwd(),
    },
    bundle: true, format: 'esm', platform: 'node', outfile: modulePath,
  });
  const { Recording, DEFAULT_WORLD, canonical, checksum } = await import(pathToFileURL(modulePath));
  const store = new DiskArchive();
  const config = { ...DEFAULT_WORLD, seed: 'V2-STORAGE-STRESS' };
  let session = await Recording.open(store, config);
  const started = performance.now();
  const timings = [];
  const advances = [];
  const checkpoints = [];
  let fills = 0;
  let facts = 0;
  let maxHeap = 0;
  let maxRss = 0;
  let maxQueue = 0;
  let maxFrameFacts = 0;
  let maxHotTrades = 0;
  let sample = 0;
  const results = [];
  const targets = hours.map(hour => hour * 3_600_000);
  const step = 5000;
  for (let now = 0; now <= targets[targets.length - 1]; now += step) {
    const advancing = performance.now();
    session.world.advanceTo(now);
    advances.push(performance.now() - advancing);
    const log = session.world.kernel.log;
    facts += log.length;
    maxFrameFacts = Math.max(maxFrameFacts, log.length);
    for (const fact of log) if (fact.kind === 'TradeExecuted') fills++;
    const writing = performance.now();
    const write = await session.save();
    const elapsed = performance.now() - writing;
    if (write.checkpointBytes) checkpoints.push(elapsed);
    else timings.push(elapsed);
    if (now % 60_000 === 0) {
      const memory = process.memoryUsage();
      maxHeap = Math.max(maxHeap, memory.heapUsed);
      maxRss = Math.max(maxRss, memory.rss);
      maxQueue = Math.max(maxQueue, session.world.kernel.pendingCount);
      maxHotTrades = Math.max(maxHotTrades, Object.values(session.playback.markets)
        .reduce((sum, view) => sum + view.trades.length, 0));
    }
    if (now !== targets[sample]) continue;
    const state = checksum(session.world.checkpointData());
    const view = checksum(canonical(session.playback.hotCheckpoint()));
    const beforeRestore = performance.now();
    session = await Recording.open(store, config);
    const restoreMs = performance.now() - beforeRestore;
    if (checksum(session.world.checkpointData()) !== state || checksum(canonical(session.playback.hotCheckpoint())) !== view) {
      throw new Error('Long-run checkpoint mismatch');
    }
    session.world.ledger.assertConservation();
    global.gc?.();
    const metrics = {
      hours: hours[sample++], elapsedMs: Math.round(performance.now() - started), restoreMs,
      state, view, head: session.head.hash, checkpointAgeMs: now - session.head.checkpoint.now,
      facts, fills, frames: store.records, frameBytes: store.frameBytes, checkpointBytes: store.checkpointBytes,
      headBytes: (await stat(join(directory, 'head.json'))).size,
      p95SaveMs: p95(timings), p95CheckpointSaveMs: p95(checkpoints), p95AdvanceMs: p95(advances),
      maxHeap, maxRss, heapAfterGc: process.memoryUsage().heapUsed, maxQueue, maxFrameFacts, maxHotTrades,
    };
    results.push(metrics);
    console.log(JSON.stringify(metrics));
    await writeFile(join(output, 'stress.json'), JSON.stringify({ step, directory, node: process.version, config, results }, null, 2));
  }
} finally {
  await rm(modulePath, { force: true });
  await rmdir(tmp);
}
