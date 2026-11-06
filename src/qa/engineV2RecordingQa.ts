import { SOL } from '../engineV2/contracts';
import { IndexedRecording } from '../engineV2/indexedRecording';
import { RecordedPlayback } from '../engineV2/projections';
import { Recording, recordedFrames, rerunRecording, type RecordingBlock, type RecordingHead, type RecordingStore } from '../engineV2/recording';
import { canonical, checksum } from '../engineV2/snapshot';
import { DEFAULT_WORLD, USER } from '../engineV2/world';

class MemoryArchive implements RecordingStore {
  frames = new Map<number, RecordingBlock>();
  saved?: RecordingHead;
  state?: RecordingBlock;
  failWrite = false;
  async head() { return this.saved; }
  async count() { return this.frames.size; }
  async frame(index: number) { return this.frames.get(index); }
  async checkpoint(index: number) { return this.state?.index === index ? this.state : undefined; }
  async append(expected: RecordingHead | undefined, head: RecordingHead, frame: RecordingBlock, checkpoint?: RecordingBlock) {
    if (this.failWrite) throw new DOMException('Injected quota failure', 'QuotaExceededError');
    if (this.saved?.hash !== expected?.hash) throw new Error('Archive writer conflict');
    this.frames.set(frame.index, frame);
    this.state = checkpoint ?? this.state;
    this.saved = head;
  }
}

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function reject(work: () => Promise<unknown>, message: string) {
  let rejected = false;
  try { await work(); } catch { rejected = true; }
  check(rejected, message);
}

const config = { ...DEFAULT_WORLD, agents: 0, userSol: 200, launchUntilMs: 0 };
const token = 'tok_baseline_0';

export async function exerciseRecording(store: RecordingStore) {
  let session = await Recording.open(store, config);
  session.world.advanceTo(0);
  session.world.submit('ui:' + ++session.ordinal, {
    kind: 'submit', policy: { kind: 'MARKET_IOC', slippageBps: 100 },
    intent: { side: 'BUY', tokenId: token, agentId: USER, maxInputSol: 100n * SOL,
      minOutputTokens: null, maxTransactionFeeSol: 5000n, priorityFeeSol: 0n, bribeFeeSol: 0n,
      expiresAt: 10_000, decidedAt: 0, evidence: [] },
  });
  await session.save();
  session = await Recording.open(store, config);
  check(Object.values(session.world.state.orders)[0]?.status === 'QUEUED', 'Pending order missing after checkpoint');
  check(session.world.kernel.pendingCount > 1 && session.ordinal === 1, 'Queue or ingress ordinal missing');
  session.world.advanceTo(350);
  await session.save();
  session = await Recording.open(store, config);
  check(session.world.state.markets[token].epoch === 1, 'Migration missing after suffix rerun');
  check(session.playback.markets[token].events.filter(event => event.type === 'MIGRATION').length === 1, 'Migration duplicated');
  session.world.advanceTo(40_000);
  await session.save();
  session = await Recording.open(store, config);
  check(session.world.state.markets[token].activity === 'DORMANT', 'Dormant state not restored');
  check(!!session.world.state.social.posts['post:root'] && !session.world.state.social.posts['post:repost'], 'Social schedule mismatch');
  session.world.advanceTo(125_000);
  await session.save();
  const head = session.head!;
  check(head.checkpoint.index === head.index, 'Periodic checkpoint did not replace the restart cache');
  const restored = await Recording.open(store, config);
  check(!!restored.world.state.social.posts['post:repost'], 'Scheduled repost lost');
  check(restored.world.checkpointData() === session.world.checkpointData(), 'Checkpoint state differs');
  check(canonical(restored.playback.hotCheckpoint()) === canonical(session.playback.hotCheckpoint()), 'Hot view differs');
  const playback = new RecordedPlayback(config.epochUtcMs);
  let fills = 0;
  for await (const frame of recordedFrames(store, head)) {
    playback.append(frame.facts, frame.now);
    fills += frame.facts.filter(fact => fact.kind === 'TradeExecuted').length;
  }
  check(fills === 1 && canonical(playback.ledger.state) === canonical(restored.world.ledger.state), 'Recorded playback differs');
  const rerun = await rerunRecording(store, head, config);
  check(rerun.checkpointData() === restored.world.checkpointData(), 'Full archive rerun differs');
  const lines: string[] = [];
  await restored.exportTo(async line => { lines.push(line); });
  check(lines.length === head.index + 2 && checksum(lines[lines.length - 1].trimEnd()) === head.hash,
    'Streaming export lost its head or final frame');
  const competing = await Recording.open(store, config);
  restored.world.advanceTo(126_000);
  competing.world.advanceTo(127_000);
  await restored.save();
  await reject(() => competing.save(), 'Stale writer overwrote the archive');
  check((await store.head())?.now === 126_000, 'Stale writer changed persisted state');
  return { frames: head.index + 1, fills, now: head.now };
}

export async function runIndexedRecordingQa() {
  const store = await IndexedRecording.open('memex-v2-qa-' + crypto.randomUUID());
  try { return await exerciseRecording(store); }
  finally { store.close(); }
}

export async function runRecordingQa() {
  const store = new MemoryArchive();
  await exerciseRecording(store);
  const saved = await Recording.open(store, config);
  const head = saved.head!;
  saved.world.advanceTo(128_000);
  store.failWrite = true;
  await reject(() => saved.save(), 'Quota failure was swallowed');
  await reject(() => saved.save(), 'Failed recording was allowed to continue');
  store.failWrite = false;
  const recovered = await Recording.open(store, config);
  check(recovered.world.now === 126_000 && recovered.head?.hash === head.hash, 'Quota failure changed the durable prefix');
  const checkpoint = store.state;
  store.state = undefined;
  await reject(() => Recording.open(store, config), 'Missing checkpoint was accepted');
  store.state = checkpoint;
  const genesis = store.frames.get(0)!;
  store.frames.set(0, { ...genesis, data: new Blob(['invalid historical block']) });
  await reject(() => recovered.exportTo(async () => {}), 'Corrupt historical data was exported');
  store.frames.set(0, genesis);
  const frame = store.frames.get(head.index)!;
  store.frames.set(head.index, { ...frame, data: new Blob(['invalid gzip']) });
  await reject(() => Recording.open(store, config), 'Damaged suffix was accepted');
  store.frames.delete(head.index);
  await reject(() => Recording.open(store, config), 'Missing block was accepted');
  console.log('PASS archive restore, tail replay, migration, dormant, social timers, quota, corruption and competing writer');
}
