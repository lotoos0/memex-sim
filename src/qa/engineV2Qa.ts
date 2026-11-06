import { SELL_FEE_RESERVE, decideTrade, observe } from '../engineV2/agents';
import { BASE_FEE, SOL, decimalAtoms, type Intent, type Policy } from '../engineV2/contracts';
import type { Command } from '../engineV2/events';
import { SWAP_COLLECTOR, TX_COLLECTOR, posting } from '../engineV2/ledger';
import { curveAccount, escrowAccount, residualAccount, reserves, spot } from '../engineV2/marketRules';
import { RecordedPlayback } from '../engineV2/projections';
import { RngStreams } from '../engineV2/rng';
import { canonical } from '../engineV2/snapshot';
import { COHORT_INTERVAL_MS, COHORT_SIZE, DEFAULT_WORLD, USER, World, type WorldConfig } from '../engineV2/world';

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

function cohortRotationGate() {
  const control = new World({ ...DEFAULT_WORLD, sellFeeReserve: true, agentDecisions: false });
  const world = new World({ ...control.config, cohortRotation: true });
  control.advanceTo(0);
  world.advanceTo(0);
  const ids = Object.keys(world.state.agents);
  const balances = (candidate: World) => canonical(ids.map((id) => candidate.ledger.balance(id)));
  const initial = balances(world);
  equal(initial, balances(control), 'Same deterministic funding for every agent');
  check(world.kernel.manifest.configHash !== control.kernel.manifest.configHash, 'Cohort rotation has a distinct manifest');
  equal(ids.filter((id) => world.isAgentActive(id)).length, COHORT_SIZE, 'First cohort is active at genesis');
  const late = ids[COHORT_SIZE];
  const command = buy(world, SOL) as Extract<Command, { kind: 'submit' }>;
  const blocked = world.submit('inactive-cohort-buy', { ...command, intent: { ...command.intent, agentId: late } });
  check(!blocked.ok, 'Inactive agent cannot admit a buy');
  equal(balances(world), initial, 'Inactive admission leaves funding intact');
  world.advanceTo(COHORT_INTERVAL_MS - 1);
  check(!world.isAgentActive(late), 'Inactive before the boundary');
  equal(Object.keys(world.state.agents[late].known).length, 0, 'Inactive agent receives no discoveries');
  equal(Object.keys(world.state.agents[late].narratives).length, 0, 'Inactive agent receives no social exposure');
  const restored = World.restore(world.snapshot());
  equal(restored.config.cohortRotation, true, 'Cohort mode survives checkpoint');
  world.advanceTo(COHORT_INTERVAL_MS);
  check(world.isAgentActive(late), 'Activates at the exact boundary');
  equal(balances(world), initial, 'Activation does not add, transfer or reserve SOL');
  equal(Object.keys(world.state.agents[late].known).length, 0, 'No discovery backfill on activation');
  const target = COHORT_INTERVAL_MS + 90_000;
  world.advanceTo(target);
  restored.advanceTo(target);
  same(world, restored, 'Cohort checkpoint across activation');
  same(world, World.rerun(world.config, world.state.ingress, target), 'Cohort ingress replay');
  const known = ids.slice(COHORT_SIZE, 2 * COHORT_SIZE).flatMap((id) => Object.keys(world.state.agents[id].known));
  check(known.length > 0, 'The new cohort discovers ordinary launches');
  check(known.every((id) => world.state.markets[id].launchedAt >= COHORT_INTERVAL_MS), 'Discovery uses later launch events');
  equal(ids.filter((id) => world.isAgentActive(id)).length, 2 * COHORT_SIZE, 'Only two cohorts are active');
  world.advanceTo(3 * COHORT_INTERVAL_MS);
  equal(ids.filter((id) => world.isAgentActive(id)).length, 4 * COHORT_SIZE, 'All cohorts activate by minute 45');
  verifyLedger(world);
  console.log('PASS cohort funding, admission, discovery, activation boundaries and checkpoint replay');
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
cohortRotationGate();
orderAndMigrationGate();
priceCrossingGate();
expiryAndFaultGate();
lateSettlementFaultGate();
recordingBoundaryGate();
export const deterministicHashes = determinismGate();
console.log(JSON.stringify(deterministicHashes));
socialGate();
