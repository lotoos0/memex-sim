// Deterministic PRNG with Box-Muller normal and Knuth Poisson.
export class RNG {
  private state: number;
  private spare: number | null = null;

  constructor(seed: number | string) {
    this.state = RNG.hashToSeed(seed);
  }

  static hashToSeed(s: number | string): number {
    let x = typeof s === 'number' ? Math.floor(s) : 0;
    if (typeof s === 'string') {
      for (let i = 0; i < s.length; i++) {
        x = (x ^ s.charCodeAt(i)) >>> 0;
        x = (x + 0x9e3779b9 + ((x << 6) >>> 0) + (x >>> 2)) >>> 0;
      }
    }
    if (x === 0) x = 0x6d2b79f5;
    return x >>> 0;
  }

  // Mulberry32
  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Standard normal via Box-Muller with caching.
  normal(): number {
    if (this.spare !== null) {
      const z = this.spare;
      this.spare = null;
      return z;
    }
    let u = 0, v = 0, s = 0;
    do {
      u = this.next() * 2 - 1;
      v = this.next() * 2 - 1;
      s = u * u + v * v;
    } while (s === 0 || s >= 1);
    const m = Math.sqrt(-2 * Math.log(s) / s);
    this.spare = v * m;
    return u * m;
  }

  // Poisson via Knuth for small mean, otherwise transformed rejection.
  poisson(lambda: number): number {
    if (lambda <= 0) return 0;
    if (lambda < 30) {
      const L = Math.exp(-lambda);
      let p = 1, k = 0;
      do { k++; p *= this.next(); } while (p > L);
      return k - 1;
    }
    // Atkinson algorithm (approx) for larger lambda
    const c = 0.767 - 3.36 / lambda;
    const beta = Math.PI / Math.sqrt(3 * lambda);
    const alpha = beta * lambda;
    const kConst = Math.log(c) - lambda - Math.log(beta);
    while (true) {
      const u = this.next();
      const x = (alpha - Math.log((1 - u) / u)) / beta;
      const n = Math.floor(x + 0.5);
      if (n < 0) continue;
      const v = this.next();
      const y = alpha - beta * x;
      const lhs = y + Math.log(v / (1 + Math.exp(y)) ** 2);
      const rhs = kConst + n * Math.log(lambda) - RNG.logFactorial(n);
      if (lhs <= rhs) return n;
    }
  }

  private static logFactorial(n: number): number {
    // Stirling
    if (n < 2) return 0;
    return n * Math.log(n) - n + 0.5 * Math.log(2 * Math.PI * n);
  }
}
