export type Atoms = bigint;
export type Side = 'BUY' | 'SELL';
export type Phase = 0 | 10 | 20 | 30 | 40 | 50 | 60;
export type Spot = { quoteAtoms: Atoms; tokenAtoms: Atoms };
export type Key = { at: number; round: number; phase: Phase; seq: bigint };
export type Envelope<K extends string, P> = {
  id: string;
  kind: K;
  schemaVersion: 1;
  key: Key;
  causeIds: readonly string[];
  rootId: string;
  payload: P;
};
export type Message<M> = {
  [K in keyof M & string]: Envelope<K, M[K]>
}[keyof M & string];
export type Manifest = {
  engineVersion: string;
  schedulerVersion: string;
  rngVersion: string;
  arithmeticVersion: string;
  seed: string;
  epochUtcMs: number;
  catalogHash: string;
  configHash: string;
  policyVersions: Readonly<Record<string, string>>;
};

export type Intent = {
  agentId: string;
  tokenId: string;
  decidedAt: number;
  evidence: readonly string[];
  expiresAt: number;
  maxTransactionFeeSol: Atoms;
  priorityFeeSol: Atoms;
  bribeFeeSol: Atoms;
} & (
  | { side: 'BUY'; maxInputSol: Atoms; minOutputTokens: Atoms | null }
  | { side: 'SELL'; inputTokens: Atoms; minOutputSol: Atoms | null }
);
export type Policy =
  | { kind: 'MARKET_IOC'; slippageBps?: number }
  | { kind: 'TRIGGER_MARKET'; trigger: 'LTE' | 'GTE'; price: Spot; slippageBps: number };

export type Status = 'OPEN' | 'QUEUED' | 'FILLED' | 'PARTIAL_CLOSED' | 'CANCELLED' | 'REJECTED' | 'EXPIRED';
export type Order = {
  id: string;
  intentId: string;
  reservationId: string;
  intent: Intent;
  policy: Policy;
  status: Status;
  acceptedAt: number;
  acceptedSeq: bigint;
  eligibleAt: number | null;
  finalizedAt: number | null;
  epochAtAdmission: number;
  expectedOut: Atoms | null;
  fee: Atoms;
  feeScheduleVersion: 'fixed-1';
  chargedFee: Atoms;
  consumed: Atoms;
  refunded: Atoms;
  reason: string | null;
};
export type Fill = {
  orderId: string;
  intentId: string;
  agentId: string;
  tokenId: string;
  side: Side;
  at: number;
  tokenAtoms: Atoms;
  quoteAtomsExFee: Atoms;
  walletSwapQuoteSol: Atoms;
  swapFeeSol: Atoms;
  transactionFeeSol: Atoms;
  marketEpoch: number;
  spotAfter: Spot;
  evidence: readonly string[];
};
export const SOL = 1_000_000_000n;
export const TOKEN = 1_000_000n;
export const BPS = 10_000n;
export const SUPPLY = 1_000_000_000n * TOKEN;
export const BASE_FEE = 5_000n;
export const FEE_BPS = 125n;

export function minAtoms(a: bigint, b: bigint) {
  return a < b ? a : b;
}

export function ceilDiv(a: bigint, b: bigint) {
  return (a + b - 1n) / b;
}

export function decimalAtoms(value: string, decimals: number): bigint | null {
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(value.trim());
  if (!match) return null;
  const fractional = match[2] ?? '';
  const exponent = Number(match[3] ?? 0);
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 100) return null;
  const scale = decimals + exponent - fractional.length;
  if (scale < 0) return null;
  return BigInt(match[1] + fractional) * 10n ** BigInt(scale);
}

export function outputFloor(intent: Intent) {
  return intent.side === 'BUY' ? intent.minOutputTokens : intent.minOutputSol;
}

export function withOutputFloor(intent: Intent, output: Atoms): Intent {
  return intent.side === 'BUY'
    ? { ...intent, minOutputTokens: output }
    : { ...intent, minOutputSol: output };
}

export function assertSimTime(at: number) {
  if (!Number.isSafeInteger(at) || at < 0) throw new Error('Invalid simulation time');
}
