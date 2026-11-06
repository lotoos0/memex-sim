import { checksum } from './snapshot';

export const RNG_VERSION = 'mulberry32-counter-1';

export class RngStreams {
  constructor(
    private readonly seed: string,
    private readonly counters: Record<string, bigint> = {},
    private readonly remember?: (target: object, key: string) => void,
  ) {}

  uint32(namespace: string, entityId: string, policyVersion: string): number {
    const key = JSON.stringify([namespace, entityId, policyVersion]);
    const ordinal = this.counters[key] ?? 0n;
    this.remember?.(this.counters, key);
    this.counters[key] = ordinal + 1n;
    const base = BigInt('0x' + checksum(JSON.stringify([this.seed, key, (ordinal >> 32n).toString()])));
    let word = Number(BigInt.asUintN(32, base + ordinal * 0x6d2b79f5n));
    word = Math.imul(word ^ (word >>> 15), word | 1);
    word ^= word + Math.imul(word ^ (word >>> 7), word | 61);
    return (word ^ (word >>> 14)) >>> 0;
  }

  int(namespace: string, entityId: string, policyVersion: string, exclusive: number) {
    return Math.floor(this.uint32(namespace, entityId, policyVersion) / 0x1_0000_0000 * exclusive);
  }

  snapshot() {
    return { ...this.counters };
  }
}
