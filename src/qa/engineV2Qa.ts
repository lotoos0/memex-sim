import { BASE_FEE, SOL, decimalAtoms, type Intent, type Policy } from '../engineV2/contracts';
import type { Command } from '../engineV2/events';
import { SWAP_COLLECTOR, TX_COLLECTOR, posting } from '../engineV2/ledger';
import { curveAccount, escrowAccount, residualAccount, reserves, spot } from '../engineV2/marketRules';
import { RecordedPlayback } from '../engineV2/projections';
import { canonical } from '../engineV2/snapshot';
import { DEFAULT_WORLD, USER, World, type WorldConfig } from '../engineV2/world';

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
orderAndMigrationGate();
priceCrossingGate();
expiryAndFaultGate();
export const deterministicHashes = determinismGate();
console.log(JSON.stringify(deterministicHashes));
socialGate();
