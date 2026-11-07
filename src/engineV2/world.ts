import { AGENT_VERSION, SELL_FEE_RESERVE, decideTrade, newAgent, observe, type Agent } from './agents';
import { SOL, SUPPLY, assertSimTime, type Envelope, type Manifest, type Message } from './contracts';
import type { Ack, Command, FactMap, Launch, Link, Post, PublicMarket, TaskMap } from './events';
import { Kernel, type Committed, type KernelState } from './kernel';
import { Ledger, posting, type LedgerState } from './ledger';
import { DORMANT_AFTER_MS, LIFECYCLE_VERSION, QUIET_AFTER_MS } from './lifecycle';
import { CURVE_TOKENS, ESCROW_TOKENS, PROFILE_VERSION, curveAccount, escrowAccount, initialMarket, progressPpm, reserves, spot, type Market } from './marketRules';
import { OrderBook } from './orders';
import { RNG_VERSION, RngStreams } from './rng';
import { canonical, checksum, readCanonical } from './snapshot';
import { SOCIAL_CATALOG, SOCIAL_VERSION, publish, type SocialState } from './social';
import type { Order } from './contracts';

export const USER = 'user:player';
const TREASURY = 'system:launch-fees';
const LISTING_DESK = 'world:listing-desk';
const LAUNCH_FEE = SOL / 10n;
export const BOUNDED_REACTIVE_MS = 2_000;

export type WorldConfig = {
  seed: string;
  epochUtcMs: number;
  agents: number;
  social: boolean;
  agentDecisions: boolean;
  userSol: number;
  latencyMs: number;
  launchUntilMs: number;
  socialLaunches: boolean;
  // Omit OFF so existing recordings keep their config and manifest hashes.
  sellFeeReserve?: true;
  boundedReactive?: true;
};
export const DEFAULT_WORLD: WorldConfig = {
  seed: 'MEMEX-V2', epochUtcMs: 1_792_918_800_000, agents: 100,
  social: true, agentDecisions: true, userSol: 100, latencyMs: 350,
  launchUntilMs: 3_600_000, socialLaunches: true,
};
export type Ingress = { id: string; receivedAt: number; acceptedAt: number; beforeFirstAdvance: boolean; flush: boolean; command: Command };
type State = {
  ledger: LedgerState;
  markets: Record<string, Market>;
  agents: Record<string, Agent>;
  social: SocialState;
  orders: Record<string, Order>;
  ingress: Ingress[];
  commandResults: Record<string, Ack>;
  sessionOverride: 'quiet' | 'busy' | null;
  lastFeedback: Record<string, number>;
};
type Checkpoint = { state: State; kernel: KernelState<TaskMap>; rng: Record<string, bigint>; config: WorldConfig };
export type Snapshot = {
  schemaVersion: 1;
  manifest: Manifest;
  now: number;
  nextSequence: string;
  lastCommittedEventId: string | null;
  stateHash: string;
  logPrefixHash: string;
  chunks: { owner: 'world' | 'log'; version: 1; hash: string; data: string }[];
};
type Cause = Pick<Envelope<string, unknown>, 'id' | 'rootId'>;

function makeManifest(config: WorldConfig): Manifest {
  return {
    engineVersion: '2.0.0-slice.1', schedulerVersion: 'round-heap-1',
    rngVersion: RNG_VERSION, arithmeticVersion: PROFILE_VERSION, seed: config.seed, epochUtcMs: config.epochUtcMs,
    catalogHash: checksum(canonical(SOCIAL_CATALOG)), configHash: checksum(canonical(config)),
    policyVersions: { agents: AGENT_VERSION, social: SOCIAL_VERSION, lifecycle: LIFECYCLE_VERSION, fee: 'fixed-1' },
  };
}

export class World {
  readonly kernel: Kernel<TaskMap, FactMap>;
  readonly ledger: Ledger;
  readonly state: State;
  private readonly rng: RngStreams;
  private readonly orders: OrderBook;
  private readonly commandById = new Map<string, Ingress>();
  private readonly marketAudience = new Map<string, Set<string>>();
  private hasAdvanced = false;
  private readonly linksByNarrative = new Map<string, Link[]>();

  constructor(readonly config: WorldConfig = DEFAULT_WORLD, checkpoint?: Checkpoint,
    log: readonly Committed<FactMap>[] = []) {
    config = this.config = Object.freeze({ ...config });
    for (const value of [config.agents, config.userSol, config.latencyMs, config.launchUntilMs, config.epochUtcMs]) assertSimTime(value);
    if (config.latencyMs < 1) throw new Error('Execution latency must be positive');
    this.kernel = new Kernel(makeManifest(config), checkpoint?.kernel, log);
    this.ledger = new Ledger(checkpoint?.state.ledger, this.kernel.rememberProperty);
    this.state = checkpoint?.state ?? {
      ledger: this.ledger.state, markets: {}, agents: {},
      social: { graph: { nodes: {}, edges: [] }, posts: {}, links: {}, delivered: {}, interpreted: {} },
      orders: {}, ingress: [], commandResults: {}, sessionOverride: null, lastFeedback: {},
    };
    this.rng = new RngStreams(config.seed, checkpoint?.rng, this.kernel.rememberProperty);
    this.orders = new OrderBook(this.kernel, this.ledger, this.state.orders, this.state.markets, config.latencyMs,
      (market, traded) => this.activate(market, traded), id => id === USER || !!this.state.agents[id]);
    if (checkpoint) {
      for (const ingress of this.state.ingress) this.commandById.set(ingress.id, ingress);
      for (const link of Object.values(this.state.social.links)) this.indexLink(link);
      for (const agent of Object.values(this.state.agents)) for (const tokenId of Object.keys(agent.known)) this.watch(agent.id, tokenId);
      this.hasAdvanced = checkpoint.kernel.cursor !== null;
    } else {
      const funding: Record<string, number> = { [USER]: config.userSol, [LISTING_DESK]: 1 + Math.ceil(config.launchUntilMs / 250_000) };
      for (let i = 0; i < config.agents; i++) {
        const id = 'agent:' + i.toString().padStart(5, '0');
        this.state.agents[id] = newAgent(id, i);
        funding[id] = 4 + this.rng.int('world/funding', id, '1', 16);
      }
      this.kernel.schedule(0, 0, 'Genesis', { funding });
      this.kernel.schedule(0, 20, 'Launch', {
        tokenId: 'tok_baseline_0', creatorId: LISTING_DESK, name: 'Orbit', ticker: 'ORBIT', narrativeId: null, sourcePostId: null,
      });
      if (config.social) {
        this.kernel.schedule(1000, 10, 'Publish', { post: SOCIAL_CATALOG[0], audience: true });
      }
    }
  }

  get now() { return this.kernel.now; }

  advanceTo(target: number, shouldStop?: () => boolean) {
    this.kernel.advanceTo(target, event => this.process(event), shouldStop);
    this.hasAdvanced = true;
  }

  enqueue(commandId: string, command: Command, acceptedAt = this.now, flush = false) {
    assertSimTime(acceptedAt);
    if (acceptedAt < this.now || !/^[\w:/.-]{1,160}$/.test(commandId)) throw new Error('Invalid command ingress');
    const existing = this.commandById.get(commandId);
    if (existing) {
      if (canonical(existing.command) !== canonical(command)) throw new Error('Conflicting command ID');
      return this.state.commandResults['command:' + commandId];
    }
    const item = { id: commandId, command: structuredClone(command), receivedAt: this.now, acceptedAt, beforeFirstAdvance: !this.hasAdvanced, flush };
    this.commandById.set(commandId, item);
    this.state.ingress.push(item);
    const phase = command.kind === 'submit' ? 50 : command.kind === 'close' ? 20 : command.kind === 'post' ? 10 : 0;
    this.kernel.schedule(acceptedAt, phase, 'Ingress', { commandId, command: item.command });
    return undefined;
  }

  submit(commandId: string, command: Command) {
    const old = this.enqueue(commandId, command, this.now, true);
    if (old) return old;
    this.advanceTo(this.now);
    return this.state.commandResults['command:' + commandId];
  }

  private process(event: Message<TaskMap>) {
    const { kind, payload } = event;
    switch (kind) {
      case 'Genesis': {
        this.ledger.genesis(payload.funding);
        this.kernel.fact('LedgerChanged', {
          postings: Object.keys(payload.funding).sort().map(id => posting(id, 'SOL', BigInt(payload.funding[id]) * SOL)),
          issuance: { asset: 'SOL', amount: this.ledger.state.issued.SOL }, position: null,
        });
        break;
      }
      case 'Ingress': {
        const ack = this.command(payload.commandId, payload.command, event.key.seq);
        this.kernel.rememberProperty(this.state.commandResults, 'command:' + payload.commandId);
        this.state.commandResults['command:' + payload.commandId] = ack;
        this.kernel.fact('CommandResolved', { commandId: payload.commandId, ack });
        break;
      }
      case 'Launch': this.launch(payload, event); break;
      case 'Publish': this.publish(payload.post, payload.audience, null, event); break;
      case 'Exposure': {
        const key = payload.agentId + '/' + payload.postId;
        if (this.state.social.delivered[key]) break;
        this.state.social.delivered[key] = true;
        const interpretationAt = this.now + 80 + this.rng.int('exposure/interpret', key, SOCIAL_VERSION, 500);
        const delivered = this.kernel.fact('ExposureDelivered', {
          agentId: payload.agentId, postId: payload.postId, interpretationAt,
        });
        this.kernel.schedule(interpretationAt, 30, 'Discover', {
          agentId: payload.agentId, postId: payload.postId, exposureId: delivered.id,
        }, delivered);
        break;
      }
      case 'Discover': this.discover(payload.agentId, payload.postId); break;
      case 'Observe': {
        const agent = this.state.agents[payload.agentId];
        this.observe(agent, payload.market, payload.evidence);
        this.wake(agent, this.now + 1);
        break;
      }
      case 'Decide': this.decide(payload.agentId, payload.generation, payload.reactive); break;
      case 'Admit': this.orders.admit(payload.intentId, payload.intent, payload.policy, event.key.seq); break;
      case 'Execute': {
        const fact = this.orders.execute(payload.orderId);
        if (fact && (fact.kind === 'TradeExecuted' || fact.kind === 'MarketMigrated')) {
          const id = fact.kind === 'TradeExecuted' ? fact.payload.fill.tokenId : fact.payload.tokenId;
          const last = this.state.lastFeedback[id];
          if (last === undefined || this.now - last >= 1500 || fact.kind === 'MarketMigrated') {
            this.kernel.rememberProperty(this.state.lastFeedback, id);
            this.state.lastFeedback[id] = this.now;
            this.feedback(this.state.markets[id], [...(this.marketAudience.get(id) ?? [])].sort(), fact, 200);
          }
        }
        break;
      }
      case 'Expire': this.orders.expire(payload.orderId); break;
      case 'Idle': {
        const market = this.state.markets[payload.tokenId];
        if (market?.activityGeneration === payload.generation && !market.terminalReason) {
          const threshold = payload.stage === 'QUIET' ? QUIET_AFTER_MS : DORMANT_AFTER_MS;
          const deadline = market.lastActivityAt + threshold;
          if (deadline > this.now) this.kernel.schedule(deadline, 0, 'Idle', payload);
          else {
            this.updateMarket({ ...market, activity: payload.stage });
            if (payload.stage === 'QUIET') this.kernel.schedule(market.lastActivityAt + DORMANT_AFTER_MS, 0, 'Idle', {
              ...payload, stage: 'DORMANT',
            });
          }
        }
        break;
      }
    }
  }

  private command(id: string, command: Command, seq: bigint): Ack {
    switch (command.kind) {
      case 'submit': return this.orders.admit('order:command:' + id, command.intent, command.policy, seq);
      case 'cancel': return this.orders.cancel(command.orderId, command.agentId);
      case 'close': {
        const market = this.state.markets[command.tokenId];
        if (!market || market.terminalReason) return { ok: false, reason: 'MARKET_UNAVAILABLE' };
        this.orders.close(market.tokenId);
        const terminal = { ...market, terminalReason: 'MARKET_CLOSED' as const };
        const fact = this.updateMarket(terminal);
        this.feedback(terminal, [...(this.marketAudience.get(market.tokenId) ?? [])].sort(), fact, 200);
        return { ok: true };
      }
      case 'post': {
        const market = this.state.markets[command.tokenId];
        if (!market || !command.body.trim() || command.body.length > 500) return { ok: false, reason: 'INVALID_POST' };
        this.publish({
          id: 'post:command:' + id, authorId: 'Player', narrativeId: 'user:' + command.tokenId,
          kind: 'ORIGINAL', parentPostId: null, parentNarrativeId: null, body: command.body.trim(), simulated: true,
        }, false, command.tokenId);
        return { ok: true };
      }
      case 'session':
        this.state.sessionOverride = command.override;
        this.kernel.fact('SessionChanged', { override: command.override });
        return { ok: true };
    }
  }

  private launch(payload: Launch, cause: Cause) {
    const { tokenId, creatorId, name, ticker, narrativeId, sourcePostId } = payload;
    const reject = (reason: string) => this.kernel.fact('LaunchRejected', { tokenId, creatorId, reason });
    if (!/^tok_[a-zA-Z0-9_-]+$/.test(tokenId)) return reject('INVALID_TOKEN_ID');
    if (this.state.markets[tokenId]) return reject('DUPLICATE_TOKEN');
    // The first ordinary listing is funded by its creator at the same rate as social listings.
    if (this.ledger.balance(creatorId).available < LAUNCH_FEE) return reject('INSUFFICIENT_LAUNCH_FUNDS');
    const market = initialMarket(tokenId, creatorId, this.now, name, ticker);
    const postings = [
      posting(creatorId, 'SOL', -LAUNCH_FEE), posting(TREASURY, 'SOL', LAUNCH_FEE),
      posting(curveAccount(tokenId), tokenId, CURVE_TOKENS), posting(escrowAccount(tokenId), tokenId, ESCROW_TOKENS),
    ];
    this.ledger.issueToken(tokenId, postings);
    this.kernel.fact('LedgerChanged', { postings, issuance: { asset: tokenId, amount: SUPPLY }, position: null });
    const link: Link | null = narrativeId && sourcePostId ? {
      tokenId, narrativeId, sourcePostId, createdAt: this.now, relevancePpm: 1_000_000,
      relation: this.state.social.graph.edges.some(edge => edge.child === narrativeId) ? 'FORK'
        : this.linksByNarrative.get(narrativeId)?.length ? 'COPYCAT' : 'ORIGINAL',
    } : null;
    if (link) {
      this.state.social.links[tokenId] = link;
      this.indexLink(link);
    }
    const launched = this.kernel.fact('TokenLaunched', { market, link }, cause);
    this.activate(market, true);
    const audience = Object.keys(this.state.agents).sort().filter(id =>
      link ? !!this.state.agents[id].narratives[link.narrativeId] : this.rng.int('world/discovery', id + '/' + tokenId, '1', 100) < 60);
    this.feedback(market, audience, launched, 250);
    const index = /^tok_baseline_(\d+)$/.exec(tokenId);
    if (index) {
      const next = this.now + 25_000 + this.rng.int('world/calendar', tokenId, '1', 20_000);
      if (next < this.config.launchUntilMs) {
        const ordinal = Number(index[1]) + 1;
        this.kernel.schedule(next, 20, 'Launch', {
          tokenId: 'tok_baseline_' + ordinal, creatorId: LISTING_DESK,
          name: 'Orbit ' + ordinal, ticker: 'ORB' + ordinal, narrativeId: null, sourcePostId: null,
        }, launched);
      }
    }
  }

  private indexLink(link: Link) {
    const links = this.linksByNarrative.get(link.narrativeId) ?? [];
    links.push(link);
    links.sort((a, b) => a.createdAt - b.createdAt || (a.tokenId < b.tokenId ? -1 : 1));
    this.linksByNarrative.set(link.narrativeId, links);
  }

  private watch(agentId: string, tokenId: string) {
    let audience = this.marketAudience.get(tokenId);
    if (!audience) this.marketAudience.set(tokenId, audience = new Set());
    audience.add(agentId);
  }

  private observe(agent: Agent, view: PublicMarket, evidence: string) {
    const previous = Object.keys(agent.known);
    observe(agent, view, evidence);
    this.watch(agent.id, view.tokenId);
    for (const id of previous) if (!agent.known[id]) this.marketAudience.get(id)?.delete(agent.id);
  }

  publicMarket(market: Market): PublicMarket {
    const real = reserves(this.ledger, market);
    return {
      tokenId: market.tokenId, spot: spot(market, real), progressPpm: progressPpm(market, real),
      observedAt: this.now, epoch: market.epoch, tradable: !market.terminalReason,
    };
  }

  private feedback(market: Market, audience: string[], cause: Cause, latency: number) {
    const view = this.publicMarket(market);
    for (const id of audience) {
      this.kernel.schedule(this.now + latency + this.rng.int('market/feedback', id + '/' + market.tokenId, '1', 500),
        30, 'Observe', { agentId: id, market: view, evidence: cause.id }, cause);
    }
  }

  private publish(data: Omit<Post, 'publishedAt'>, audience: boolean, tokenId: string | null, cause?: Cause) {
    const post: Post = { ...data, publishedAt: this.now };
    if (!publish(this.state.social, post, cause?.id ?? post.id)) return;
    const fact = this.kernel.fact('SocialPublished', { post, tokenId }, cause);
    if (!audience) return;
    if (post.id === SOCIAL_CATALOG[0].id) {
      this.kernel.schedule(this.now + 4000, 10, 'Publish', { post: SOCIAL_CATALOG[1], audience: true }, fact);
      this.kernel.schedule(this.now + 84_000, 10, 'Publish', { post: SOCIAL_CATALOG[2], audience: true }, fact);
    }
    for (const id of Object.keys(this.state.agents).sort()) {
      const key = id + '/' + post.id;
      if (this.state.agents[id].strategy !== 'creator' && this.rng.int('exposure/recipient', key, SOCIAL_VERSION, 100) >= 65) continue;
      const delay = 50 + this.rng.int('exposure/delivery', key, SOCIAL_VERSION, post.kind === 'ORIGINAL' ? 9500 : 6000);
      this.kernel.schedule(this.now + delay, 30, 'Exposure', { agentId: id, postId: post.id, publishedFactId: fact.id }, fact);
    }
  }

  private discover(agentId: string, postId: string) {
    const key = agentId + '/' + postId;
    if (this.state.social.interpreted[key]) return;
    this.state.social.interpreted[key] = true;
    const agent = this.state.agents[agentId];
    const post = this.state.social.posts[postId];
    const found = this.kernel.fact('NarrativeDiscovered', { agentId, postId, narrativeId: post.narrativeId });
    const previous = agent.narratives[post.narrativeId];
    const fatigue = previous ? Math.max(0, previous.fatigue - Math.floor((this.now - previous.at) / 2000)) + 12 : 0;
    agent.narratives[post.narrativeId] = { postId, evidence: found.id, attention: 60, fatigue, at: this.now };
    const links = this.linksByNarrative.get(post.narrativeId) ?? [];
    for (const link of links) {
      const market = this.state.markets[link.tokenId];
      if (!market.terminalReason && market.activity === 'DORMANT') this.activate(market, true);
      this.feedback(market, [agentId], found, 1);
    }
    this.wake(agent, this.now + 1);
  }

  private wake(agent: Agent, at: number, periodic = false) {
    if (!this.config.agentDecisions) return;
    if (this.config.boundedReactive) {
      const state = agent.boundedWake ??= { lastAt: null, reactiveAt: null, reactiveGeneration: 0 };
      if (!periodic) {
        if (agent.ordinal === 0) {
          if (agent.nextAt !== null) return;
        } else {
          if (state.reactiveAt !== null) return;
          const due = Math.max(at, (state.lastAt ?? at) + BOUNDED_REACTIVE_MS);
          // Leave enough room for the unchanged periodic deadline to execute.
          if (agent.nextAt !== null && agent.nextAt - due < BOUNDED_REACTIVE_MS) return;
          state.reactiveAt = due;
          this.kernel.schedule(due, 40, 'Decide', {
            agentId: agent.id, generation: ++state.reactiveGeneration, reactive: true,
          });
          return;
        }
      }
    }
    if (agent.nextAt !== null && agent.nextAt <= at) return;
    agent.nextAt = at;
    this.kernel.schedule(at, 40, 'Decide', { agentId: agent.id, generation: ++agent.generation });
  }

  private decide(id: string, generation: number, reactive?: true) {
    const agent = this.state.agents[id];
    const bounded = this.config.boundedReactive ? agent.boundedWake : undefined;
    if (reactive) {
      if (!bounded || bounded.reactiveGeneration !== generation || bounded.reactiveAt !== this.now) return;
      bounded.reactiveAt = null;
      if (agent.nextAt === this.now) return;
    } else {
      if (agent.generation !== generation) return;
      agent.nextAt = null;
    }
    if (bounded) {
      if (bounded.lastAt !== null && this.now - bounded.lastAt < BOUNDED_REACTIVE_MS) {
        throw new Error('Bounded decision interval violated');
      }
      bounded.lastAt = this.now;
      if (!reactive && bounded.reactiveAt !== null) {
        bounded.reactiveAt = null;
        bounded.reactiveGeneration++;
      }
    }
    agent.ordinal++;
    const interest = Object.entries(agent.narratives).sort(([keyA, a], [keyB, b]) => b.at - a.at || (keyA < keyB ? -1 : 1))[0];
    const canLaunch = this.config.socialLaunches && agent.strategy === 'creator' && agent.launches === 0 && interest
      && this.now < this.config.launchUntilMs && this.ledger.balance(id).available >= LAUNCH_FEE
      && this.rng.int('launch/creator', id, AGENT_VERSION, 100) < 78;
    if (canLaunch) {
      const [narrativeId, info] = interest;
      agent.launches++;
      const decision = this.kernel.fact('AgentDecided', { agentId: id, ordinal: agent.ordinal, decision: 'LAUNCH' });
      const suffix = id.slice(-2);
      this.kernel.schedule(this.now + 100, 20, 'Launch', {
        tokenId: 'tok_social_' + suffix, creatorId: id, name: (narrativeId === 'signal' ? 'Signal ' : 'Echo ') + suffix,
        ticker: (narrativeId === 'signal' ? 'SIGN' : 'ECHO') + suffix, narrativeId, sourcePostId: info.postId,
      }, decision);
    } else {
      const intent = decideTrade(agent, this.now, this.ledger, this.rng, tokenId => this.state.social.links[tokenId]?.narrativeId,
        this.config.sellFeeReserve ? SELL_FEE_RESERVE : 0n);
      const decision = this.kernel.fact('AgentDecided', {
        agentId: id, ordinal: agent.ordinal, decision: intent ? 'TRADE' : 'WAIT',
      });
      if (intent) this.kernel.schedule(this.now, 50, 'Admit', {
        intentId: 'order:' + id + '/' + agent.ordinal, intent, policy: { kind: 'MARKET_IOC', slippageBps: 700 },
      }, decision);
    }
    if (!reactive) {
      const delay = this.state.sessionOverride === 'busy' ? 2000 : this.state.sessionOverride === 'quiet' ? 8500 : 4500;
      this.wake(agent, this.now + delay + this.rng.int('agent/timer', id, AGENT_VERSION, 5000), true);
    }
  }

  private updateMarket(market: Market) {
    this.kernel.rememberProperty(this.state.markets, market.tokenId);
    this.state.markets[market.tokenId] = market;
    return this.kernel.fact('MarketUpdated', { market });
  }

  private activate(market: Market, traded: boolean) {
    if (market.terminalReason || (!traded && market.activity === 'ACTIVE')) return;
    const needsTimer = market.activity !== 'ACTIVE' || market.activityGeneration === 0;
    const generation = market.activityGeneration + (needsTimer ? 1 : 0);
    const next: Market = { ...market, activity: 'ACTIVE', activityGeneration: generation, lastActivityAt: this.now };
    this.updateMarket(next);
    if (needsTimer) this.kernel.schedule(this.now + QUIET_AFTER_MS, 0, 'Idle', {
      tokenId: market.tokenId, generation, stage: 'QUIET',
    });
  }

  snapshot(): Snapshot {
    const kernel = this.kernel.snapshot();
    const state = this.checkpointData();
    const log = canonical(this.kernel.log);
    const stateHash = checksum(state);
    const logPrefixHash = checksum(log);
    return {
      schemaVersion: 1, manifest: this.kernel.manifest, now: kernel.now, nextSequence: kernel.nextSequence.toString(),
      lastCommittedEventId: this.kernel.log[this.kernel.log.length - 1]?.id ?? null,
      stateHash, logPrefixHash,
      chunks: [{ owner: 'world', version: 1, hash: stateHash, data: state }, { owner: 'log', version: 1, hash: logPrefixHash, data: log }],
    };
  }

  checkpointData() {
    return canonical({
      state: this.state, kernel: this.kernel.snapshot(), rng: this.rng.snapshot(), config: this.config,
    } satisfies Checkpoint);
  }

  static fromCheckpoint(data: string, manifest: Manifest) {
    const checkpoint = readCanonical<Checkpoint>(data);
    if (canonical(makeManifest(checkpoint.config)) !== canonical(manifest)) {
      throw new Error('Incompatible recording engine manifest');
    }
    const world = new World(checkpoint.config, checkpoint);
    world.ledger.assertConservation();
    return world;
  }

  // The browser archives these before dropping them. It assigns unique, persisted
  // ingress IDs and only issues cancel commands for orders still open in its UI.
  pruneRecordedHistory(facts: readonly Committed<FactMap>[]) {
    for (const fact of facts) {
      if (fact.kind === 'OrderChanged' && fact.payload.order.finalizedAt !== null) {
        delete this.state.orders[fact.payload.order.id];
      }
      if (fact.kind === 'SocialPublished' && fact.payload.tokenId !== null) {
        delete this.state.social.posts[fact.payload.post.id];
      }
    }
    for (const item of this.state.ingress) delete this.state.commandResults['command:' + item.id];
    this.state.ingress.length = 0;
    this.commandById.clear();
    this.kernel.log.length = 0;
  }

  static restore(snapshot: Snapshot) {
    const state = snapshot.chunks.find(chunk => chunk.owner === 'world' && chunk.version === 1);
    const log = snapshot.chunks.find(chunk => chunk.owner === 'log' && chunk.version === 1);
    if (snapshot.schemaVersion !== 1 || !state || !log || snapshot.chunks.length !== 2
      || state.hash !== snapshot.stateHash || log.hash !== snapshot.logPrefixHash
      || checksum(state.data) !== state.hash || checksum(log.data) !== log.hash) throw new Error('Invalid checkpoint');
    const checkpoint = readCanonical<Checkpoint>(state.data);
    const facts = readCanonical<Committed<FactMap>[]>(log.data);
    if (canonical(makeManifest(checkpoint.config)) !== canonical(snapshot.manifest)
      || checkpoint.kernel.now !== snapshot.now || checkpoint.kernel.nextSequence.toString() !== snapshot.nextSequence
      || (facts[facts.length - 1]?.id ?? null) !== snapshot.lastCommittedEventId) throw new Error('Incompatible checkpoint manifest');
    const restored = new World(checkpoint.config, checkpoint, facts);
    restored.ledger.assertConservation();
    return restored;
  }

  static rerun(config: WorldConfig, ingress: readonly Ingress[], target: number) {
    const world = new World(config);
    world.replayIngress(ingress, target);
    return world;
  }

  replayIngress(ingress: readonly Ingress[], target: number) {
    for (const item of ingress) {
      if (item.receivedAt > this.now || (!this.hasAdvanced && !item.beforeFirstAdvance)) this.advanceTo(item.receivedAt);
      this.enqueue(item.id, item.command, item.acceptedAt, item.flush);
      if (item.flush) this.advanceTo(item.receivedAt);
    }
    this.advanceTo(target);
  }
}
