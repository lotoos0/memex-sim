import { SOL, SUPPLY } from './contracts';

export const SWAP_COLLECTOR = 'system:swap-fees';
export const TX_COLLECTOR = 'system:transaction-fees';
export type Balance = { available: bigint; reserved: bigint };
export type Position = { basis: bigint; realized: bigint; bought: bigint; sold: bigint };
export type Posting = { account: string; asset: string; available: bigint; reserved: bigint };
export type LedgerState = {
  balances: Record<string, Record<string, Balance>>;
  positions: Record<string, Record<string, Position>>;
  issued: Record<string, bigint>;
};
const EMPTY: Balance = { available: 0n, reserved: 0n };
const EMPTY_POSITION: Position = { basis: 0n, realized: 0n, bought: 0n, sold: 0n };

export function posting(account: string, asset: string, available: bigint, reserved = 0n): Posting {
  return { account, asset, available, reserved };
}

export class Ledger {
  constructor(
    readonly state: LedgerState = { balances: {}, positions: {}, issued: {} },
    private readonly remember?: (target: object, key: string) => void,
  ) {}

  balance(account: string, asset = 'SOL'): Readonly<Balance> {
    return Object.prototype.hasOwnProperty.call(this.state.balances, account)
      ? this.state.balances[account][asset] ?? EMPTY
      : EMPTY;
  }

  position(account: string, tokenId: string): Readonly<Position> {
    return this.state.positions[account]?.[tokenId] ?? EMPTY_POSITION;
  }

  genesis(funding: Readonly<Record<string, number>>) {
    if (this.state.issued.SOL !== undefined) throw new Error('Duplicate genesis');
    this.commit(Object.keys(funding).sort().map(account => {
      const value = funding[account];
      if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid genesis endowment');
      return posting(account, 'SOL', BigInt(value) * SOL);
    }), { asset: 'SOL', amount: Object.values(funding).reduce((sum, value) => sum + BigInt(value) * SOL, 0n) });
  }

  issueToken(asset: string, postings: Posting[]) {
    this.commit(postings, { asset, amount: SUPPLY });
  }

  commit(postings: readonly Posting[], issuance?: { asset: string; amount: bigint }) {
    if (issuance && Object.prototype.hasOwnProperty.call(this.state.issued, issuance.asset)) {
      throw new Error('Duplicate issuance');
    }
    const totals = new Map<string, bigint>();
    const staged = new Map<string, Map<string, Balance>>();
    for (const entry of postings) {
      totals.set(entry.asset, (totals.get(entry.asset) ?? 0n) + entry.available + entry.reserved);
      let account = staged.get(entry.account);
      if (!account) {
        account = new Map();
        staged.set(entry.account, account);
      }
      const old = account.get(entry.asset) ?? this.balance(entry.account, entry.asset);
      account.set(entry.asset, { available: old.available + entry.available, reserved: old.reserved + entry.reserved });
    }
    if (issuance && totals.get(issuance.asset) !== issuance.amount) throw new Error('Issuance amount mismatch');
    for (const [asset, amount] of totals) {
      if (amount !== (issuance?.asset === asset ? issuance.amount : 0n)) throw new Error('Unbalanced transaction');
    }
    for (const account of staged.values()) {
      for (const value of account.values()) {
        if (value.available < 0n || value.reserved < 0n) throw new Error('Insufficient ledger balance');
      }
    }
    for (const [account, assets] of staged) {
      const balances = Object.prototype.hasOwnProperty.call(this.state.balances, account)
        ? this.state.balances[account]
        : Object.fromEntries([]);
      for (const [asset, value] of assets) {
        this.remember?.(balances, asset);
        if (value.available === 0n && value.reserved === 0n) delete balances[asset];
        else Object.defineProperty(balances, asset, { value, configurable: true, enumerable: true, writable: true });
      }
      this.remember?.(this.state.balances, account);
      Object.defineProperty(this.state.balances, account, {
        value: balances, configurable: true, enumerable: true, writable: true,
      });
    }
    if (issuance) {
      this.remember?.(this.state.issued, issuance.asset);
      this.state.issued[issuance.asset] = issuance.amount;
    }
  }

  recordCost(account: string, tokenId: string, side: 'BUY' | 'SELL', fee: bigint,
    quantity = 0n, swapQuote = 0n, previousQuantity = 0n) {
    const old = this.position(account, tokenId);
    const released = side === 'SELL' && quantity > 0n ? old.basis * quantity / previousQuantity : 0n;
    const next = {
      basis: old.basis + (side === 'BUY' ? swapQuote : -released),
      realized: old.realized - fee + (side === 'SELL' ? swapQuote - released : 0n),
      bought: old.bought + (side === 'BUY' ? swapQuote : 0n),
      sold: old.sold + (side === 'SELL' ? swapQuote : 0n),
    };
    if (!this.state.positions[account]) this.remember?.(this.state.positions, account);
    const positions = this.state.positions[account] ??= {};
    this.remember?.(positions, tokenId);
    positions[tokenId] = next;
  }

  assertConservation() {
    const totals = new Map<string, bigint>();
    for (const account of Object.values(this.state.balances)) {
      for (const [asset, balance] of Object.entries(account)) {
        if (balance.available < 0n || balance.reserved < 0n) throw new Error('Negative balance');
        totals.set(asset, (totals.get(asset) ?? 0n) + balance.available + balance.reserved);
      }
    }
    for (const [asset, amount] of Object.entries(this.state.issued)) {
      if ((totals.get(asset) ?? 0n) !== amount) throw new Error('Supply mismatch for ' + asset);
      totals.delete(asset);
    }
    if (totals.size) throw new Error('Unissued asset');
  }
}
