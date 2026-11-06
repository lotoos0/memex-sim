import { BPS, FEE_BPS, SOL, SUPPLY, TOKEN, ceilDiv, minAtoms, type Intent, type Spot } from './contracts';
import { type Ledger, posting } from './ledger';

export const CURVE_TOKENS = 793_100_000n * TOKEN;
export const ESCROW_TOKENS = SUPPLY - CURVE_TOKENS;
export const PROFILE_VERSION = 'standard-1';
export type Activity = 'ACTIVE' | 'QUIET' | 'DORMANT';
export type Market = {
  tokenId: string;
  creatorId: string;
  launchedAt: number;
  name: string;
  ticker: string;
  epoch: number;
  mechanism: { kind: 'CURVE'; virtualSol: bigint; virtualTokens: bigint } | { kind: 'POOL' };
  reference: Spot | null;
  migratedAt: number | null;
  activity: Activity;
  lastActivityAt: number;
  activityGeneration: number;
  terminalReason: 'MARKET_CLOSED' | 'RUG_CLOSED' | null;
};
export type Reserves = { sol: bigint; tokens: bigint };
export type Quote = {
  tokenAtoms: bigint;
  gross: bigint;
  net: bigint;
  swapFee: bigint;
  output: bigint;
  partial: boolean;
  spotAfter: Spot;
  reservesAfter: Reserves;
};

export const curveAccount = (id: string) => 'curve:' + id;
export const poolAccount = (id: string) => 'pool:' + id;
export const escrowAccount = (id: string) => 'migration:' + id;
export const residualAccount = (id: string) => 'residual:' + id;

export function initialMarket(tokenId: string, creatorId: string, launchedAt: number, name: string, ticker: string): Market {
  return {
    tokenId, creatorId, launchedAt, name, ticker, epoch: 0,
    mechanism: { kind: 'CURVE', virtualSol: 30n * SOL, virtualTokens: 1_073_000_000n * TOKEN },
    reference: null, migratedAt: null, activity: 'ACTIVE', lastActivityAt: launchedAt,
    activityGeneration: 0, terminalReason: null,
  };
}

export function reserveAccount(market: Market) {
  return market.mechanism.kind === 'CURVE' ? curveAccount(market.tokenId) : poolAccount(market.tokenId);
}

export function reserves(ledger: Ledger, market: Market): Reserves {
  const account = reserveAccount(market);
  return { sol: ledger.balance(account).available, tokens: ledger.balance(account, market.tokenId).available };
}

export function spot(market: Market, real: Reserves): Spot {
  return market.mechanism.kind === 'CURVE'
    ? { quoteAtoms: market.mechanism.virtualSol, tokenAtoms: market.mechanism.virtualTokens }
    : { quoteAtoms: real.sol, tokenAtoms: real.tokens };
}

export function progressPpm(market: Market, real: Reserves) {
  return market.mechanism.kind === 'POOL' ? 1_000_000 : Number((CURVE_TOKENS - real.tokens) * 1_000_000n / CURVE_TOKENS);
}

const swapFee = (gross: bigint) => ceilDiv(gross * FEE_BPS, BPS);

export function quote(market: Market, real: Reserves, intent: Intent): Quote | null {
  if (market.terminalReason) return null;
  const { quoteAtoms: x, tokenAtoms: y } = spot(market, real);
  if (x <= 0n || y <= 0n) throw new Error('Invalid mechanism reserves');
  let gross: bigint;
  let tokens: bigint;
  if (intent.side === 'BUY') {
    gross = intent.maxInputSol;
    const net = gross - swapFee(gross);
    tokens = y * net / (x + net);
    if (tokens >= real.tokens && market.mechanism.kind === 'CURVE') {
      tokens = real.tokens;
      const required = ceilDiv(x * tokens, y - tokens);
      gross = ceilDiv(required * BPS, BPS - FEE_BPS);
      if (gross > intent.maxInputSol || gross - swapFee(gross) !== required) throw new Error('Invalid completion quote');
    }
  } else {
    tokens = intent.inputTokens;
    if (market.mechanism.kind === 'CURVE') {
      const circulating = CURVE_TOKENS - real.tokens;
      tokens = minAtoms(tokens, circulating);
      if (x * tokens / (y + tokens) > real.sol) {
        // floor(x*t/(y+t)) <= Q iff (x-Q-1)*t < (Q+1)*y.
        tokens = minAtoms(tokens, ((real.sol + 1n) * y - 1n) / (x - real.sol - 1n));
      }
    }
    gross = x * tokens / (y + tokens);
  }
  const fee = swapFee(gross);
  const net = gross - fee;
  if (tokens <= 0n || net <= 0n) return null;
  const deltaSol = intent.side === 'BUY' ? net : -gross;
  const deltaTokens = intent.side === 'BUY' ? -tokens : tokens;
  const reservesAfter = { sol: real.sol + deltaSol, tokens: real.tokens + deltaTokens };
  const spotAfter = { quoteAtoms: x + deltaSol, tokenAtoms: y + deltaTokens };
  if (reservesAfter.sol < 0n || reservesAfter.tokens < 0n || spotAfter.quoteAtoms * spotAfter.tokenAtoms < x * y) {
    throw new Error('Swap violated reserve invariants');
  }
  return {
    tokenAtoms: tokens, gross, net, swapFee: fee, spotAfter, reservesAfter,
    output: intent.side === 'BUY' ? tokens : net,
    partial: intent.side === 'BUY' ? gross < intent.maxInputSol : tokens < intent.inputTokens,
  };
}

export function handoff(ledger: Ledger, market: Market, completing: Quote) {
  const id = market.tokenId;
  const { quoteAtoms: a, tokenAtoms: b } = completing.spotAfter;
  const availableSol = completing.reservesAfter.sol;
  const availableTokens = ledger.balance(escrowAccount(id), id).available;
  const tokens = availableTokens * a / b <= availableSol ? availableTokens : availableSol * b / a;
  const sol = tokens * a / b;
  if (market.epoch !== 0 || market.mechanism.kind !== 'CURVE' || completing.reservesAfter.tokens !== 0n
    || sol <= 0n || tokens <= 0n || sol > availableSol || tokens > availableTokens) {
    throw new Error('Unfunded migration');
  }
  return {
    reserves: { sol, tokens },
    postings: [
      posting(curveAccount(id), 'SOL', -availableSol),
      posting(escrowAccount(id), id, -availableTokens),
      posting(poolAccount(id), 'SOL', sol),
      posting(poolAccount(id), id, tokens),
      posting(residualAccount(id), 'SOL', availableSol - sol),
      posting(residualAccount(id), id, availableTokens - tokens),
    ],
  };
}
