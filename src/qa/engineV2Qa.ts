import { SELL_FEE_RESERVE, TOKEN_INTEREST_MS, TOKEN_INTEREST_VERSION, decideTrade, newAgent, observe, renewTokenInterest } from '../engineV2/agents';
import { BASE_FEE, SOL, decimalAtoms, type Intent, type Policy } from '../engineV2/contracts';
import type { Command } from '../engineV2/events';
import { SWAP_COLLECTOR, TX_COLLECTOR, posting } from '../engineV2/ledger';
import { curveAccount, escrowAccount, residualAccount, reserves, spot } from '../engineV2/marketRules';
import { RecordedPlayback } from '../engineV2/projections';
import { RngStreams } from '../engineV2/rng';
import { SOCIAL_CATALOG } from '../engineV2/social';
import { canonical } from '../engineV2/snapshot';
import { BOUNDED_REACTIVE_MS, DEFAULT_WORLD, USER, World, type WorldConfig } from '../engineV2/world';

const FIRST = 'tok_baseline_0';
const SECOND = 'tok_qa_competitor';
const config: WorldConfig = { ...DEFAULT_WORLD, seed: 'V2-QA', agents: 0, social: false,
  userSol: 210, launchUntilMs: 1, agentDecisions: false };
const IOC: Policy = { kind: 'MARKET_IOC', slippageBps: 10_000 };

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) throw new Error(message + ' (actual ' + String(actual) + ', expected ' + String(expected) + ')');
}

function fixture(overrides: Partial<WorldConfig> = {}) {
  const world = new World({ ...config, ...overrides });
  world.kernel.schedule(0, 20, 'Launch', {
    tokenId: SECOND, creatorId: USER, name: 'QA competitor', ticker: 'QA', narrativeId: null, sourcePostId: null,
  });
  world.advanceTo(0);
  return world;
}

function buy(world: World, input: bigint, tokenId = FIRST, minOutputTokens: bigint | null = null,
  policy: Policy = IOC): Command {
  return { kind: 'submit', intent: {
    agentId: USER, tokenId, side: 'BUY', maxInputSol: input, minOutputTokens, decidedAt: world.now,
    expiresAt: world.now + 50_000, maxTransactionFeeSol: BASE_FEE, priorityFeeSol: 0n, bribeFeeSol: 0n, evidence: [],
  }, policy };
}

function sell(world: World, inputTokens: bigint): Command {
  const intent = (buy(world, SOL) as Extract<Command, { kind: 'submit' }>).intent;
  return { kind: 'submit', policy: IOC, intent: { ...intent, side: 'SELL', inputTokens, minOutputSol: null } as Intent };
}

function submit(world: World, id: string, command: Command) {
  const ack = world.submit(id, command);
  check(ack.ok && ack.orderId, id + ' admission failed');
  return ack.orderId;
}

function same(a: World, b: World, context: string) {
  const one = a.snapshot();
  const two = b.snapshot();
  equal(one.stateHash, two.stateHash, context + ' state hash');
  equal(one.logPrefixHash, two.logPrefixHash, context + ' log hash');
}

function verifyLedger(world: World) {
  world.ledger.assertConservation();
  const reserved = new Map<string, bigint>();
  for (const order of Object.values(world.state.orders)) {
    if (order.status !== 'OPEN' && order.status !== 'QUEUED') continue;
    const intent = order.intent;
    const solKey = intent.agentId + '/SOL';
    reserved.set(solKey, (reserved.get(solKey) ?? 0n) + order.fee + (intent.side === 'BUY' ? intent.maxInputSol : 0n));
    if (intent.side === 'SELL') {
      const key = intent.agentId + '/' + intent.tokenId;
      reserved.set(key, (reserved.get(key) ?? 0n) + intent.inputTokens);
    }
  }
  for (const [account, assets] of Object.entries(world.ledger.state.balances)) {
    for (const [asset, balance] of Object.entries(assets)) {
      const key = account + '/' + asset;
      equal(balance.reserved, reserved.get(key) ?? 0n, 'Reservation reconciliation');
      reserved.delete(key);
    }
  }
  equal(reserved.size, 0, 'Every order has ledger escrow');
}

function sellFeeReserveGate() {
  class DecisionDraws extends RngStreams {
    constructor(private readonly draws: number[]) { super('reserve-qa'); }
    override int(_namespace: string, _entityId: string, _policyVersion: string, exclusive: number) {
      const value = this.draws.shift();
      check(value !== undefined && value >= 0 && value < exclusive, 'Expected scripted draw');
      return value;
    }
  }
  const world = new World({ ...config, agents: 1, sellFeeReserve: true });
  world.advanceTo(0);
  const agent = world.state.agents['agent:00000'];
  observe(agent, world.publicMarket(world.state.markets[FIRST]), 'reserve-qa');
  const intent = (draws: number[], protection = SELL_FEE_RESERVE) =>
    decideTrade(agent, world.now, world.ledger, new DecisionDraws(draws), () => undefined, protection);
  const nominal = intent([99, 0, 14]);
  check(nominal?.side === 'BUY', 'Funded agent creates a buy');
  equal(nominal.maxInputSol, 15n * SOL / 10n, 'Nominal size draw is unchanged');
  const setCash = (cash: bigint) => {
    const delta = cash - world.ledger.balance(agent.id).available;
    world.ledger.commit([posting(USER, 'SOL', -delta), posting(agent.id, 'SOL', delta)]);
  };
  setCash(SELL_FEE_RESERVE + BASE_FEE + 1n);
  const capped = intent([99, 0, 14]);
  check(capped?.side === 'BUY', 'One spendable lamport creates a buy');
  equal(capped.maxInputSol, 1n, 'Capped BUY preserves reserve and current fee');
  setCash(SELL_FEE_RESERVE + BASE_FEE);
  equal(intent([99, 0, 14]), null, 'Zero spendable lamports produce WAIT');
  const unprotected = intent([99, 0, 14], 0n);
  check(unprotected?.side === 'BUY', 'OFF keeps the old behavior');
  equal(unprotected.maxInputSol, SELL_FEE_RESERVE, 'OFF can spend up to the current fee');

  setCash(2n * SOL);
  const buyCommand = buy(world, SOL) as Extract<Command, { kind: 'submit' }>;
  submit(world, 'reserve-setup', { ...buyCommand, intent: { ...buyCommand.intent, agentId: agent.id } });
  world.advanceTo(350);
  setCash(SELL_FEE_RESERVE);
  equal(intent([99, 0, 99, 14]), null, 'A blocked BUY does not become a SELL');
  const sale = intent([99, 0, 0, 0]);
  check(sale?.side === 'SELL', 'Standard side selection permits a sale from the protected balance');
  const saleId = submit(world, 'reserve-sell', { kind: 'submit', intent: sale, policy: IOC });
  equal(world.ledger.balance(agent.id).available, SELL_FEE_RESERVE - BASE_FEE, 'SELL can use protected SOL');
  verifyLedger(world);
  world.advanceTo(700);
  equal(world.state.orders[saleId].status, 'FILLED', 'Protected SELL settles');
  equal(world.state.orders[saleId].chargedFee, BASE_FEE, 'SELL pays the standard fee');
  verifyLedger(world);

  const off = new World({ ...DEFAULT_WORLD, agents: 8 });
  const on = new World({ ...off.config, sellFeeReserve: true });
  check(on.kernel.manifest.configHash !== off.kernel.manifest.configHash, 'ON has a distinct manifest');
  on.advanceTo(3_000);
  const restored = World.restore(on.snapshot());
  equal(restored.config.sellFeeReserve, true, 'ON is retained at restore');
  on.advanceTo(7_000);
  restored.advanceTo(7_000);
  same(on, restored, 'ON checkpoint replay');
  same(on, World.rerun(on.config, [], 7_000), 'ON deterministic rerun');
  console.log('PASS opt-in SELL fee reserve, BUY boundary, standard SELL fee and ON restore');
}

function boundedReactiveGate() {
  const world = fixture({ boundedReactive: true, agentDecisions: true, sellFeeReserve: true });
  const id = 'agent:00000';
  world.state.agents[id] = newAgent(id, 0);
  const observeAt = (candidate: World, at: number) => candidate.kernel.schedule(at, 30, 'Observe', {
    agentId: id, market: { ...candidate.publicMarket(candidate.state.markets[FIRST]), observedAt: at }, evidence: 'qa:bounded',
  });
  observeAt(world, 1);
  world.advanceTo(2);
  const agent = world.state.agents[id];
  equal(agent.ordinal, 1, 'First discovery bootstraps one decision');
  const due = agent.nextAt;
  const periodicGeneration = agent.generation;
  check(due !== null && due >= 4_502 && due <= 9_501, 'Bootstrap creates the ordinary periodic timer');
  observeAt(world, 100);
  observeAt(world, 200);
  const post = { ...SOCIAL_CATALOG[0], id: 'qa:bounded-narrative' };
  world.kernel.schedule(250, 10, 'Publish', { post, audience: false });
  world.kernel.schedule(300, 30, 'Discover', { agentId: id, postId: post.id, exposureId: 'qa:bounded-exposure' });
  world.advanceTo(300);
  equal(agent.nextAt, due, 'Information leaves the periodic deadline unchanged');
  equal(agent.boundedWake?.reactiveAt, 2 + BOUNDED_REACTIVE_MS, 'Reaction waits for the fixed cooldown');
  equal(agent.boundedWake?.reactiveGeneration, 1, 'Repeated Observe and Discover coalesce');
  check(agent.known[FIRST].view.observedAt === 200 && agent.narratives.signal, 'Information continues updating');
  const tasks = world.kernel.snapshot().pending.filter((event) => event.kind === 'Decide');
  equal(tasks.length, 2, 'One periodic and one reactive task are pending');
  const restored = World.restore(world.snapshot());
  equal(restored.config.boundedReactive, true, 'Bounded mode survives checkpoint');
  world.advanceTo(2 + BOUNDED_REACTIVE_MS);
  restored.advanceTo(2 + BOUNDED_REACTIVE_MS);
  same(world, restored, 'Pending reaction and periodic timer restore');
  equal(agent.ordinal, 2, 'One coalesced reaction executes');
  equal(agent.nextAt, due, 'Reactive execution leaves the periodic deadline unchanged');
  equal(agent.generation, periodicGeneration, 'Reactive execution does not replace the periodic generation');
  observeAt(world, due - 1_000);
  world.advanceTo(due - 999);
  equal(agent.boundedWake?.reactiveAt, null, 'Nearby information is serviced by the periodic deadline');
  world.advanceTo(due);
  equal(agent.ordinal, 3, 'Periodic deadline still executes');
  check(agent.nextAt !== null && agent.nextAt - due >= 4_500 && agent.nextAt - due <= 9_499,
    'Periodic cadence retains its original interval draw');
  verifyLedger(world);

  const collision = World.restore(restored.snapshot());
  const actor = collision.state.agents[id];
  const at = collision.now + BOUNDED_REACTIVE_MS;
  check(actor.boundedWake, 'Checkpoint contains bounded wake state');
  actor.boundedWake.reactiveAt = at;
  actor.boundedWake.reactiveGeneration++;
  collision.kernel.schedule(at, 40, 'Decide', { agentId: id,
    generation: actor.boundedWake.reactiveGeneration, reactive: true });
  actor.nextAt = at;
  actor.generation++;
  collision.kernel.schedule(at, 40, 'Decide', { agentId: id, generation: actor.generation });
  const collisionCopy = World.restore(collision.snapshot());
  collision.advanceTo(at);
  collisionCopy.advanceTo(at);
  same(collision, collisionCopy, 'Collision priority survives checkpoint');
  equal(collision.kernel.log.filter((fact) => fact.kind === 'AgentDecided' && fact.key.at === at).length,
    1, 'Periodic wins even when the reactive task was scheduled first');

  const options = { ...DEFAULT_WORLD, agents: 8, sellFeeReserve: true, boundedReactive: true } as const;
  const normal = new World(options);
  normal.advanceTo(3_000);
  const copy = World.restore(normal.snapshot());
  normal.advanceTo(30_000);
  copy.advanceTo(30_000);
  same(normal, copy, 'Bounded full-world restore');
  same(normal, World.rerun(options, [], 30_000), 'Bounded deterministic replay');
  verifyLedger(normal);
  console.log('PASS bounded cooldown, coalescing, periodic priority and checkpoint/replay');
}

function tokenInterestGate() {
  class Draws extends RngStreams {
    constructor(private readonly values: number[]) { super('interest-qa'); }
    override int(_namespace: string, _id: string, _version: string, exclusive: number) {
      const value = this.values.shift();
      check(value !== undefined && value >= 0 && value < exclusive, 'A1 uses only the expected policy draws');
      return value;
    }
    assertConsumed() { equal(this.values.length, 0, 'A1 does not add or skip the scripted branch draws'); }
  }
  const options = { ...config, agents: 1, boundedReactive: true, sellFeeReserve: true, tokenInterestA1: true } as const;
  const world = new World(options);
  world.advanceTo(0);
  const agent = world.state.agents['agent:00000'];
  const view = world.publicMarket(world.state.markets[FIRST]);
  observe(agent, view, 'qa:first', 0);
  const interest = agent.tokenInterest![FIRST];
  equal(interest.buyUntil, TOKEN_INTEREST_MS, 'First receipt starts the fixed five-minute lease');
  const decide = (at: number, values: number[]) => {
    const rng = new Draws(values);
    const intent = decideTrade(agent, at, world.ledger, rng, () => undefined, SELL_FEE_RESERVE, true);
    rng.assertConsumed();
    return intent;
  };
  check(decide(TOKEN_INTEREST_MS - 1, [99, 0, 14])?.side === 'BUY', 'BUY remains eligible before expiry');
  equal(decide(TOKEN_INTEREST_MS, []), null, 'Unheld market is excluded exactly at expiry');
  observe(agent, { ...view, observedAt: TOKEN_INTEREST_MS }, 'qa:ordinary-feedback', TOKEN_INTEREST_MS);
  equal(interest.buyUntil, TOKEN_INTEREST_MS, 'Ordinary feedback does not renew');
  delete agent.known[FIRST];
  observe(agent, { ...view, observedAt: TOKEN_INTEREST_MS + 1 }, 'qa:rediscovery', TOKEN_INTEREST_MS + 1);
  equal(interest.buyUntil, TOKEN_INTEREST_MS, 'Rediscovery after eviction does not renew');
  const late = newAgent('qa:late', 5);
  observe(late, view, 'qa:late-first', 900_000);
  equal(late.tokenInterest![FIRST].buyUntil, 1_200_000, 'Old token can receive first interest from another agent');

  const source = { ...SOCIAL_CATALOG[0], id: 'qa:fresh-source', publishedAt: TOKEN_INTEREST_MS };
  check(renewTokenInterest(agent, FIRST, source, TOKEN_INTEREST_MS + 1), 'Fresh independent source renews');
  const until = interest.buyUntil;
  check(!renewTokenInterest(agent, FIRST, source, TOKEN_INTEREST_MS + 2), 'Duplicate source cannot renew');
  check(!renewTokenInterest(agent, FIRST, { ...source, id: 'qa:repost', kind: 'REPOST', publishedAt: source.publishedAt + 1 },
    TOKEN_INTEREST_MS + 2), 'Repost cannot renew');
  check(!renewTokenInterest(agent, FIRST, { ...source, id: 'qa:delayed', publishedAt: source.publishedAt + 1 },
    2 * TOKEN_INTEREST_MS + 1), 'Stale independent message cannot renew');
  check(!renewTokenInterest(agent, FIRST, { ...source, id: 'qa:future', publishedAt: source.publishedAt + 10 },
    TOKEN_INTEREST_MS + 2), 'Future message cannot renew');
  equal(interest.buyUntil, until, 'Rejected sources preserve expiry');
  check(renewTokenInterest(agent, FIRST, { ...SOCIAL_CATALOG[1], id: 'qa:new-fork', publishedAt: source.publishedAt + 2 },
    TOKEN_INTEREST_MS + 3), 'New-narrative quote can renew');
  check(!renewTokenInterest(agent, FIRST, { ...source, id: 'qa:old-after-new', publishedAt: source.publishedAt + 1 },
    TOKEN_INTEREST_MS + 4), 'Out-of-order independent message cannot renew');

  agent.known[FIRST] = { view, evidence: 'qa:position-view', prior: null };
  const command = buy(world, SOL) as Extract<Command, { kind: 'submit' }>;
  submit(world, 'interest-position', { ...command, intent: { ...command.intent, agentId: agent.id } });
  check(interest.exit, 'Pending BUY retains a local exit observation');
  world.advanceTo(350);
  world.kernel.schedule(350, 30, 'Observe', { agentId: agent.id,
    market: world.publicMarket(world.state.markets[FIRST]), evidence: 'qa:latest-position-view' });
  world.advanceTo(350);
  const quantity = world.ledger.balance(agent.id, FIRST).available;
  check(quantity > 0n, 'Position exists in atom balances');
  interest.buyUntil = 350;
  equal(decide(350, [99, 0, 99]), null, 'Expired selected BUY returns WAIT without a forced SELL or reroll');
  const sale = decide(350, [99, 0, 0, 0]);
  check(sale?.side === 'SELL', 'Expired interest permits the ordinary SELL branch');
  equal(sale.inputTokens, quantity / 4n || quantity, 'SELL size rule is unchanged');
  for (let i = 0; i < 16; i++) {
    const market = { ...view, tokenId: `qa:evict:${i}`, observedAt: 351 + i, tradable: false };
    world.kernel.schedule(351 + i, 30, 'Observe', { agentId: agent.id, market, evidence: 'qa:evict' });
  }
  world.advanceTo(367);
  equal(Object.keys(agent.known).length, 16, 'Known limit stays sixteen');
  check(!agent.known[FIRST] && interest.exit, 'Eviction retains only the position exit memory');
  world.kernel.schedule(367, 30, 'Observe', { agentId: agent.id, market: view, evidence: 'qa:stale-after-eviction' });
  world.advanceTo(367);
  check(!agent.known[FIRST], 'Delayed older observation cannot replace the retained position view');
  check(decide(367, [99, 0, 0, 0])?.side === 'SELL', 'Position outside known remains SELL eligible');
  const cash = world.ledger.balance(agent.id).available;
  const transfer = cash - (BASE_FEE - 1n);
  world.ledger.commit([posting(agent.id, 'SOL', -transfer), posting(USER, 'SOL', transfer)]);
  const unfundedSale = decide(367, [99, 0, 0]);
  check(unfundedSale?.side === 'SELL', 'Insufficient fee funds do not rewrite side selection');
  const rejected = world.submit('interest-no-sell-fee', { kind: 'submit', intent: unfundedSale, policy: IOC });
  check(!rejected.ok && rejected.reason === 'INSUFFICIENT_FUNDS', 'Exit memory cannot bypass the standard upfront fee');
  world.ledger.commit([posting(agent.id, 'SOL', transfer), posting(USER, 'SOL', -transfer)]);
  // Even a renewed lease cannot turn an exit-only observation into BUY discovery.
  interest.buyUntil = 1_000_000;
  equal(decide(367, [99, 0, 99]), null, 'Exit-only view cannot create BUY');
  const fullSale = { ...sale, inputTokens: quantity, decidedAt: world.now, expiresAt: world.now + 3000 };
  const orderId = submit(world, 'interest-full-exit', { kind: 'submit', intent: fullSale, policy: IOC });
  equal(world.ledger.balance(agent.id, FIRST).available, 0n, 'Reserved atoms are not available to a second SELL');
  check(interest.exit, 'Reserved inventory keeps exit memory');
  equal(decide(367, []), null, 'Reserved-only position cannot be sold twice');
  const checkpoint = World.restore(world.snapshot());
  world.advanceTo(717);
  checkpoint.advanceTo(717);
  same(world, checkpoint, 'Pending outside-known SELL checkpoint');
  equal(world.state.orders[orderId].chargedFee, BASE_FEE, 'SELL retains the standard upfront transaction fee');
  equal(world.ledger.balance(agent.id, FIRST).available, 0n, 'Full exit clears token balance');
  check(!interest.exit, 'Full exit releases the view cache');
  check(agent.tokenInterest![FIRST], 'Full exit preserves the interest tombstone');
  verifyLedger(world);
  world.pruneRecordedHistory(world.kernel.log);
  world.advanceTo(50_001);
  verifyLedger(world);

  const pending = new World(options);
  pending.advanceTo(0);
  const pendingAgent = pending.state.agents[agent.id];
  observe(pendingAgent, pending.publicMarket(pending.state.markets[FIRST]), 'qa:pending', 0);
  const pendingCommand = buy(pending, SOL) as Extract<Command, { kind: 'submit' }>;
  const pendingId = submit(pending, 'interest-trigger', { ...pendingCommand,
    intent: { ...pendingCommand.intent, agentId: agent.id },
    policy: { kind: 'TRIGGER_MARKET', trigger: 'LTE', price: { quoteAtoms: 1n, tokenAtoms: 1_000_000_000_000_000n }, slippageBps: 700 },
  });
  pendingAgent.tokenInterest![FIRST].buyUntil = 1;
  pending.advanceTo(2);
  equal(pending.state.orders[pendingId].status, 'OPEN', 'Interest expiry does not cancel an existing order');
  check(pendingAgent.tokenInterest![FIRST].exit, 'Pending BUY keeps its observation after interest expires');
  const pendingCopy = World.restore(pending.snapshot());
  pending.advanceTo(50_000);
  pendingCopy.advanceTo(50_000);
  same(pending, pendingCopy, 'Expired interest and pending BUY restore');
  equal(pending.state.orders[pendingId].status, 'EXPIRED', 'Existing order follows its original expiry');
  check(!pendingAgent.tokenInterest![FIRST].exit, 'Unfilled BUY expiry releases its observation');
  verifyLedger(pending);

  const discovery = fixture({ ...options, agents: 0 });
  discovery.state.agents[agent.id] = newAgent(agent.id, 0);
  discovery.kernel.schedule(1, 10, 'Publish', { post: { ...SOCIAL_CATALOG[0], id: 'qa:source' }, audience: false });
  discovery.kernel.schedule(2, 20, 'Launch', { tokenId: 'tok_qa_interest', creatorId: USER, name: 'QA linked', ticker: 'QA',
    narrativeId: 'signal', sourcePostId: 'qa:source' });
  discovery.advanceTo(2);
  discovery.kernel.schedule(3, 30, 'Observe', { agentId: agent.id,
    market: discovery.publicMarket(discovery.state.markets.tok_qa_interest), evidence: 'qa:initial' });
  discovery.advanceTo(TOKEN_INTEREST_MS + 3);
  const entry = discovery.state.agents[agent.id].tokenInterest!.tok_qa_interest;
  equal(entry.buyUntil, TOKEN_INTEREST_MS + 3, 'Initial discovery expiry');
  discovery.kernel.schedule(TOKEN_INTEREST_MS + 4, 10, 'Publish', {
    post: { ...SOCIAL_CATALOG[0], id: 'qa:new-content' }, audience: false,
  });
  discovery.advanceTo(TOKEN_INTEREST_MS + 4);
  equal(entry.buyUntil, TOKEN_INTEREST_MS + 3, 'Publication alone does not renew an agent');
  discovery.kernel.schedule(TOKEN_INTEREST_MS + 5, 30, 'Exposure', {
    agentId: agent.id, postId: 'qa:new-content', publishedFactId: 'qa:new-content-fact',
  });
  discovery.advanceTo(TOKEN_INTEREST_MS + 1000);
  check(entry.buyUntil > 2 * TOKEN_INTEREST_MS, 'Delivered and interpreted linked original renews');
  const renewed = entry.buyUntil;
  discovery.kernel.schedule(discovery.now + 1, 30, 'Discover', {
    agentId: agent.id, postId: 'qa:new-content', exposureId: 'qa:duplicate',
  });
  discovery.advanceTo(discovery.now + 1);
  equal(entry.buyUntil, renewed, 'Discover deduplication prevents repeat renewal');

  const normalOptions = { ...DEFAULT_WORLD, agents: 8, boundedReactive: true, sellFeeReserve: true, tokenInterestA1: true } as const;
  const normal = new World(normalOptions);
  normal.advanceTo(299_999);
  const copy = World.restore(normal.snapshot());
  normal.advanceTo(310_000);
  copy.advanceTo(300_000);
  copy.advanceTo(310_000);
  same(normal, copy, 'A1 expiry boundary checkpoint and different advance steps');
  same(normal, World.rerun(normalOptions, [], 310_000), 'A1 deterministic full rerun');
  equal(normal.kernel.manifest.policyVersions.tokenInterest, TOKEN_INTEREST_VERSION, 'A1 has a versioned manifest');
  verifyLedger(normal);
  console.log('PASS A1 lease, trusted renewal, expired BUY WAIT, outside-known SELL, reservations and replay');
}

function causalSeparationGate() {
  class Draws extends RngStreams {
    constructor(private readonly values: number[]) { super('causal-qa'); }
    override int(_namespace: string, _id: string, _version: string, exclusive: number) {
      const value=this.values.shift();
      check(value!==undefined&&value>=0&&value<exclusive,'Expected causal policy draw');
      return value;
    }
    done() { equal(this.values.length,0,'Causal branch consumes only original policy draws'); }
  }
  const variants = [ {}, {tokenExitOnly:true}, {tokenLeaseOnly:true}, {tokenInterestA1:true} ] as const;
  for (const variant of variants) {
    const exit='tokenExitOnly' in variant||'tokenInterestA1' in variant;
    const lease='tokenLeaseOnly' in variant||'tokenInterestA1' in variant;
    const options={...config,agents:1,boundedReactive:true,sellFeeReserve:true,...variant} as const;
    const world=new World(options);
    world.advanceTo(0);
    const agent=world.state.agents['agent:00000'];
    observe(agent,world.publicMarket(world.state.markets[FIRST]),'qa:causal-first',lease?0:undefined,'tokenExitOnly' in variant);
    const command=buy(world,SOL) as Extract<Command,{kind:'submit'}>;
    submit(world,'causal-position',{...command,intent:{...command.intent,agentId:agent.id}});
    world.advanceTo(350);
    world.kernel.schedule(350,30,'Observe',{agentId:agent.id,market:world.publicMarket(world.state.markets[FIRST]),evidence:'qa:fresh'});
    world.advanceTo(350);
    const decide=(values:number[])=>{
      const rng=new Draws(values);
      const intent=decideTrade(agent,300001,world.ledger,rng,()=>undefined,SELL_FEE_RESERVE,
        'tokenInterestA1' in variant,'tokenExitOnly' in variant,'tokenLeaseOnly' in variant);
      rng.done();return intent;
    };
    const selectedBuy=decide(lease?[99,0,99]:[99,0,99,14]);
    if(lease)equal(selectedBuy,null,'LEASE retains the expired BUY guard');
    else check(selectedBuy?.side==='BUY','No lease means BUY remains allowed beyond 300s');
    for(let i=0;i<16;i++)world.kernel.schedule(351+i,30,'Observe',{agentId:agent.id,
      market:{...world.publicMarket(world.state.markets[FIRST]),tokenId:`qa:causal:${i}`,observedAt:351+i,tradable:false},evidence:'qa:evict'});
    world.advanceTo(367);
    equal(Object.keys(agent.known).length,16,'No variant changes the known limit');
    check(!agent.known[FIRST],'Position is outside known');
    if(exit)check(decide([99,0,0,0])?.side==='SELL','EXIT provides the ordinary outside-known SELL branch');
    else equal(decide([]),null,'Without EXIT positions outside known are not candidates');
    if(exit)equal(decide([99,0,99]),null,'EXIT cannot provide BUY discovery, with or without lease');
    if('tokenExitOnly' in variant) {
      equal(agent.tokenInterest,undefined,'EXIT_ONLY never creates leases');
      check(agent.exitMemory?.[FIRST],'EXIT_ONLY owns its separate exit state');
    } else equal(agent.exitMemory,undefined,'Existing variants keep their state layout');
    if('tokenLeaseOnly' in variant)check(Object.values(agent.tokenInterest??{}).every(v=>!v.exit),'LEASE_ONLY never retains exit views');
    const until=agent.tokenInterest?.[FIRST]?.buyUntil;
    world.kernel.schedule(367,30,'Observe',{agentId:agent.id,
      market:{...world.publicMarket(world.state.markets[FIRST]),observedAt:0},evidence:'qa:older-after-eviction'});
    world.advanceTo(367);
    equal(!!agent.known[FIRST],!exit,'Cached-view freshness protection belongs exclusively to EXIT');
    equal(agent.tokenInterest?.[FIRST]?.buyUntil,until,'Rediscovery never resets the lease');
    const checkpoint=World.restore(world.snapshot());
    world.advanceTo(4000);checkpoint.advanceTo(4000);
    same(world,checkpoint,'Causal matrix pending feedback restore');
    verifyLedger(world);
  }
  for(const conflicting of [{tokenInterestA1:true,tokenExitOnly:true},{tokenInterestA1:true,tokenLeaseOnly:true},
    {tokenExitOnly:true,tokenLeaseOnly:true}]) {
    let rejected=false;
    try { new World({...DEFAULT_WORLD,boundedReactive:true,sellFeeReserve:true,...conflicting} as WorldConfig); }
    catch { rejected=true; }
    check(rejected,'Conflicting policy flags must not be canonicalized silently');
  }
  for(const variant of [{tokenExitOnly:true},{tokenLeaseOnly:true}] as const) {
    const options={...DEFAULT_WORLD,agents:8,boundedReactive:true,sellFeeReserve:true,...variant} as const;
    const world=new World(options);world.advanceTo(299999);
    const copy=World.restore(world.snapshot());world.advanceTo(310000);copy.advanceTo(300000);copy.advanceTo(310000);
    same(world,copy,'Single-factor checkpoint across lease boundary');
    same(world,World.rerun(options,[],310000),'Single-factor deterministic rerun');
    verifyLedger(world);
  }
  console.log('PASS 2x2 policy isolation, exit-only BUY restriction, state layouts and replay');
}

function financialGate() {
  const world = fixture();
  const initial = world.ledger.balance(USER).available;
  const command = buy(world, SOL);
  const id = submit(world, 'one', command);
  equal(world.ledger.balance(USER).available, initial - SOL - BASE_FEE, 'Admission debit');
  equal(world.submit('one', command).orderId, id, 'Admission dedup');
  world.advanceTo(350);
  verifyLedger(world);
  equal(world.state.orders[id].status, 'FILLED', 'Normal buy fills');
  equal(world.ledger.balance(curveAccount(FIRST)).available, 987_500_000n, 'Fee-exclusive buy reserve');
  equal(world.ledger.balance(SWAP_COLLECTOR).available, 12_500_000n, 'Swap collector');
  equal(world.ledger.balance(TX_COLLECTOR).available, BASE_FEE, 'Transaction collector');
  equal(world.ledger.position(USER, FIRST).basis, SOL, 'Gross cost basis');
  equal(world.ledger.position(USER, FIRST).realized, -BASE_FEE, 'Buy tx fee is realized');
  const quantity = world.ledger.balance(USER, FIRST).available;
  check(!world.submit('oversell', sell(world, quantity + 1n)).ok, 'Oversell must be rejected at admission');
  const sellId = submit(world, 'sell', sell(world, quantity / 2n));
  world.advanceTo(700);
  const fill = world.kernel.log.find(fact => fact.kind === 'TradeExecuted' && fact.payload.fill.orderId === sellId);
  check(fill?.kind === 'TradeExecuted', 'Sell fill exists');
  equal(world.ledger.position(USER, FIRST).basis, SOL - SOL * (quantity / 2n) / quantity, 'Weighted cost basis');
  equal(world.ledger.position(USER, FIRST).realized,
    fill.payload.fill.walletSwapQuoteSol - SOL * (quantity / 2n) / quantity - 2n * BASE_FEE, 'Sell realized');
  const failed = submit(world, 'slippage', buy(world, SOL, FIRST, 100_000_000_000_000n));
  const dust = submit(world, 'dust', buy(world, 1n));
  const cash = world.ledger.balance(USER).available;
  world.advanceTo(1050);
  equal(world.ledger.balance(USER).available, cash + SOL + 1n, 'Paid failures refund swap input');
  equal(world.state.orders[failed].reason, 'SLIPPAGE', 'Slippage failure');
  equal(world.state.orders[dust].chargedFee, BASE_FEE, 'Dust costs exactly one attempt fee');
  verifyLedger(world);
  console.log('PASS ledger, inventory, cost basis, fee rounding, admission dedup, paid failures and refunds');
}

function orderAndMigrationGate() {
  const world = fixture();
  const first = submit(world, 'completionA', buy(world, 100n * SOL));
  const second = submit(world, 'completionB', buy(world, 100n * SOL));
  check(!world.submit('other-token', buy(world, 20n * SOL, SECOND)).ok, 'Same cash cannot be reserved on another token');
  const restored = World.restore(world.snapshot());
  world.advanceTo(350);
  restored.advanceTo(350);
  same(world, restored, 'Pending completion restore');
  equal(world.state.orders[first].status, 'PARTIAL_CLOSED', 'Finishing buy closes partially');
  check(world.state.orders[first].refunded > 0n, 'Unspent input must return');
  equal(world.state.orders[second].status, 'FILLED', 'Second order executes on pool');
  const migrations = world.kernel.log.filter(fact => fact.kind === 'MarketMigrated');
  equal(migrations.length, 1, 'Exactly one migration');
  const tape = world.kernel.log.filter(fact => fact.kind === 'TradeExecuted');
  check(tape[0].kind === 'TradeExecuted' && tape[1].kind === 'TradeExecuted', 'Two fills');
  equal(tape[0].payload.fill.marketEpoch, 0, 'Completing fill prints on curve');
  equal(tape[1].payload.fill.marketEpoch, 1, 'Next fill prints on pool');
  equal(migrations[0].causeIds[0], tape[0].id, 'Migration causality');
  equal(world.ledger.balance(curveAccount(FIRST)).available, 0n, 'Curve cash moved to pool/residual');
  const postMigrationSell = submit(world, 'pool-sell', sell(world, 100_000_000n));
  world.advanceTo(700);
  equal(world.state.orders[postMigrationSell].status, 'FILLED', 'Pool sell executes');
  const pool = world.state.markets[FIRST];
  const price = spot(pool, reserves(world.ledger, pool));
  const trigger: Policy = { kind: 'TRIGGER_MARKET', trigger: 'LTE', price: { ...price, quoteAtoms: price.quoteAtoms / 2n }, slippageBps: 500 };
  const open = submit(world, 'open', buy(world, SOL, FIRST, null, trigger));
  equal(world.state.orders[open].status, 'OPEN', 'Below-market trigger stays open');
  const openCopy = World.restore(world.snapshot());
  const cancel: Command = { kind: 'cancel', agentId: USER, orderId: open };
  world.submit('cancel-open', cancel);
  openCopy.submit('cancel-open', cancel);
  same(world, openCopy, 'Open trigger restore and cancel');
  const queued = submit(world, 'race', buy(world, SOL, SECOND));
  world.enqueue('cancel-race', { kind: 'cancel', agentId: USER, orderId: queued }, 1050);
  world.advanceTo(1050);
  equal(world.state.orders[queued].status, 'CANCELLED', 'Same-time cancel wins over fill');
  equal(world.state.orders[queued].chargedFee, 0n, 'Cancel fee');
  const triggerNow: Policy = { ...trigger, trigger: 'GTE' };
  const triggered = submit(world, 'trigger-now', buy(world, SOL, FIRST, null, triggerNow));
  equal(world.state.orders[triggered].status, 'QUEUED', 'Trigger queues original order');
  const terminal = world.submit('terminal', { kind: 'close', tokenId: FIRST });
  check(terminal.ok, 'Explicit terminal command');
  world.advanceTo(1400);
  equal(world.state.orders[triggered].status, 'CANCELLED', 'Terminal refunds pending order');
  equal(world.state.orders[triggered].chargedFee, 0n, 'Terminal charges no fee');
  check(!world.submit('after-close', buy(world, SOL)).ok, 'Terminal cannot be traded');
  verifyLedger(world);
  const playback = new RecordedPlayback(world.config.epochUtcMs);
  playback.read(world.kernel.log, world.now);
  playback.read(world.kernel.log, world.now);
  equal(canonical(playback.ledger.state), canonical(world.ledger.state), 'Playback ledger and cost basis');
  equal(canonical(playback.orders), canonical(world.state.orders), 'Playback orders');
  equal(playback.markets[FIRST].events.filter(event => event.type === 'MIGRATION').length, 1, 'Playback migration marker');
  const candles = playback.candles(FIRST, 1, 'mcap');
  check(candles.every(bar => bar.low <= bar.open && bar.high >= bar.open), 'Candle continuity extremes');
  console.log('PASS shared cash, finishing partial, pool buy/sell, migration causality, trigger/cancel/terminal, recorded playback');
}

function priceCrossingGate() {
  const world = fixture();
  const market = world.state.markets[FIRST];
  const initial = spot(market, reserves(world.ledger, market));
  submit(world, 'raise', buy(world, SOL));
  world.advanceTo(350);
  const policy: Policy = {
    kind: 'TRIGGER_MARKET', trigger: 'LTE',
    price: { ...initial, quoteAtoms: initial.quoteAtoms * 101n / 100n }, slippageBps: 500,
  };
  const order = submit(world, 'below-spot', buy(world, SOL, FIRST, null, policy));
  equal(world.state.orders[order].status, 'OPEN', 'Below-spot trigger starts open');
  submit(world, 'lower', sell(world, world.ledger.balance(USER, FIRST).available));
  world.advanceTo(700);
  equal(world.state.orders[order].status, 'QUEUED', 'Price crossing queues original order');
  equal(world.ledger.balance(USER).reserved, SOL + BASE_FEE, 'Crossing reuses the original reservation');
  world.advanceTo(1050);
  equal(world.state.orders[order].status, 'FILLED', 'Crossed trigger settles at eligibility');
  equal(world.kernel.log.filter(fact => fact.kind === 'TradeExecuted' && fact.payload.fill.orderId === order).length,
    1, 'Crossed trigger fills once');
  verifyLedger(world);
  console.log('PASS below-spot trigger crosses on a committed trade without a second reservation');
}

function lateSettlementFaultGate() {
  for (const failAt of ['TradeExecuted', 'MarketUpdated', 'log append'] as const) {
    const world = fixture();
    const order = submit(world, 'late-fault', buy(world, 100n * SOL));
    const before = canonical({ state: world.state, log: world.kernel.log });
    const pending = world.kernel.pendingCount;
    const fact = world.kernel.fact.bind(world.kernel);
    const error = new Error('Injected fault after ' + failAt);
    world.kernel.fact = (...args) => {
      const staged = fact(...args);
      if (args[0] === failAt) {
        equal(world.state.orders[order].status, 'PARTIAL_CLOSED', 'Injection follows settlement');
        if (failAt === 'MarketUpdated') equal(world.state.markets[FIRST].epoch, 1, 'Market mutation is already visible inside commit');
        throw error;
      }
      return staged;
    };
    if (failAt === 'log append') {
      const push = world.kernel.log.push.bind(world.kernel.log);
      world.kernel.log.push = (...facts) => {
        push(...facts);
        equal(world.state.markets[FIRST].epoch, 1, 'Log append follows market update');
        throw error;
      };
    }
    let caught: unknown;
    try { world.advanceTo(350); }
    catch (failure) { caught = failure; }
    equal(caught, error, 'Fault reaches the host');
    check(canonical({ state: world.state, log: world.kernel.log }) === before,
      failAt + ' left a financial or market mutation without its commit');
    equal(world.kernel.pendingCount, pending, 'Queue restored after a failed settlement');
    equal(world.now, 0, 'Fault leaves the clock at its last committed boundary');
    verifyLedger(world);
  }
  console.log('PASS late settlement faults roll back ledger, cost basis, order, market and staged facts');
}

function recordingBoundaryGate() {
  const world = fixture();
  const first = submit(world, 'budget-first', buy(world, SOL));
  const second = submit(world, 'budget-second', buy(world, SOL, SECOND));
  const limit = world.kernel.log.length + 1;
  world.advanceTo(1000, () => world.kernel.log.length >= limit);
  equal(world.now, 350, 'Budget freezes time at the complete settlement');
  equal(world.state.orders[first].status, 'FILLED', 'The boundary settlement is complete');
  equal(world.state.orders[second].status, 'QUEUED', 'Remaining due tasks stay queued');
  const checkpoint = world.snapshot();
  const restored = World.restore(checkpoint);
  same(world, restored, 'Budget checkpoint retains the full prefix and queue');
  verifyLedger(restored);
  world.advanceTo(1000);
  restored.advanceTo(1000);
  same(world, restored, 'Deterministic continuation from a budget checkpoint');
  console.log('PASS recording cutoff at commit boundary with lossless checkpoint and continuation');
}

function expiryAndFaultGate() {
  const world = fixture();
  const buyCommand = buy(world, 100n * SOL) as Extract<Command, { kind: 'submit' }>;
  const deadline = submit(world, 'deadline', { ...buyCommand, intent: { ...buyCommand.intent, expiresAt: 350 } });
  world.advanceTo(350);
  equal(world.state.orders[deadline].status, 'EXPIRED', 'Expiry wins at the exact due time');
  equal(world.state.orders[deadline].chargedFee, 0n, 'Expiry is free');
  const bad = submit(world, 'bad-handoff', buy(world, 100n * SOL));
  const escrow = world.ledger.balance(escrowAccount(FIRST), FIRST).available;
  world.ledger.commit([
    posting(escrowAccount(FIRST), FIRST, -escrow), posting(residualAccount(FIRST), FIRST, escrow),
  ]);
  const balance = canonical(world.ledger.state);
  let failed = false;
  try { world.advanceTo(700); }
  catch (error) { failed = error instanceof Error && error.message === 'Unfunded migration'; }
  check(failed, 'Unfunded handoff faults the run');
  equal(canonical(world.ledger.state), balance, 'Failed handoff rolls back the entire attempt');
  equal(world.state.orders[bad].status, 'QUEUED', 'Fault does not finalize order');
  check(!world.kernel.log.some(fact => fact.kind === 'TradeExecuted'), 'Fault publishes no fill');
  verifyLedger(world);
  console.log('PASS expiry priority and atomic rollback on unfunded migration');
}

function determinismGate() {
  const options = { ...DEFAULT_WORLD, seed: 'V2-QA', agents: 18, launchUntilMs: 100_000 };
  const reference = new World(options);
  reference.advanceTo(0);
  const command = buy(reference, SOL / 10n);
  reference.submit('user-buy', command);
  reference.advanceTo(120_000);
  for (const step of [100, 200, 1000]) {
    const candidate = new World(options);
    candidate.advanceTo(0);
    candidate.submit('user-buy', command);
    for (let now = step; now <= 120_000; now += step) candidate.advanceTo(now);
    same(reference, candidate, 'Host step ' + step);
  }
  const fresh = new World(options);
  fresh.advanceTo(0);
  fresh.submit('user-buy', command);
  fresh.advanceTo(1750);
  const restored = World.restore(fresh.snapshot());
  restored.advanceTo(120_000);
  same(reference, restored, 'Delayed discovery checkpoint');
  const rerun = World.rerun(options, reference.state.ingress, reference.now);
  same(reference, rerun, 'Recorded ingress rerun');
  check(Object.keys(reference.state.social.links).length >= 2, 'Competing social launches observed');
  equal(Object.values(reference.state.social.posts).filter(post => post.kind === 'REPOST').length, 1, 'One repost entity');
  verifyLedger(reference);
  const snapshot = reference.snapshot();
  console.log('PASS deterministic 100/200/1000 ms, delayed restore and recorded ingress rerun');
  return { state: snapshot.stateHash, log: snapshot.logPrefixHash };
}

function socialGate() {
  const withSocial = fixture({ social: true, agents: 4 });
  const withoutSocial = fixture({ social: false, agents: 4 });
  withSocial.advanceTo(1000);
  withSocial.kernel.schedule(2000, 20, 'Launch', {
    tokenId: 'tok_repost_fixture', creatorId: USER, name: 'Signal', ticker: 'SIGN', narrativeId: 'signal', sourcePostId: 'post:root',
  });
  withoutSocial.kernel.schedule(2000, 20, 'Launch', {
    tokenId: 'tok_repost_fixture', creatorId: USER, name: 'Signal', ticker: 'SIGN', narrativeId: null, sourcePostId: null,
  });
  withSocial.advanceTo(80_000);
  withoutSocial.advanceTo(80_000);
  const id = 'tok_repost_fixture';
  equal(withSocial.state.markets[id].activity, 'DORMANT', 'Fixture reaches dormant');
  const recovered = World.restore(withSocial.snapshot());
  withSocial.advanceTo(92_000);
  recovered.advanceTo(92_000);
  withoutSocial.advanceTo(92_000);
  same(withSocial, recovered, 'Dormant checkpoint with pending repost');
  equal(withSocial.state.markets[id].activity, 'ACTIVE', 'Repost discovery wakes dormant token');
  equal(canonical(withSocial.ledger.state), canonical(withoutSocial.ledger.state), 'Social by itself has no financial effect');
  check(!withSocial.kernel.log.some(fact => fact.kind === 'TradeExecuted'), 'Social by itself generates no fills');
  verifyLedger(withSocial);
  console.log('PASS second wave, dormant restore and wake, social-only no reserve or price mutation');
}

equal(decimalAtoms('0.100000000', 9), SOL / 10n, 'Decimal SOL');
equal(decimalAtoms('0.1000000001', 9), null, 'Excess precision rejected');
equal(decimalAtoms('1e-9', 9), 1n, 'One lamport');
financialGate();
sellFeeReserveGate();
boundedReactiveGate();
tokenInterestGate();
causalSeparationGate();
orderAndMigrationGate();
priceCrossingGate();
expiryAndFaultGate();
lateSettlementFaultGate();
recordingBoundaryGate();
export const deterministicHashes = determinismGate();
console.log(JSON.stringify(deterministicHashes));
socialGate();
