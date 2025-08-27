import type { EnginesConfig, EventImpactSummary, EventType, SimEvent, Regime } from './types';
import { RNG } from './rng';

interface ActiveImpact {
  ev: SimEvent;
  startMs: number;
}

export default class EventEngine {
  private cfg: EnginesConfig;
  private rng: RNG;
  private bus: EventTarget;
  private active: ActiveImpact[] = [];
  private rateScale = 1;
  private lastRegime: Regime = 'range';
  private lastTickMs = 0;

  constructor(cfg: EnginesConfig, rng: RNG, bus: EventTarget) {
    this.cfg = cfg;
    this.rng = rng;
    this.bus = bus;
  }

  setRegime(r: Regime) { this.lastRegime = r; }
  setRateScale(mult: number) { this.rateScale = Math.max(0.1, mult); }

  inject(type: EventType, nowMs: number): SimEvent {
    const d = this.cfg.eventDefs[type];
    const impact = this.clamp(this.rng.normal() * d.impactStd + d.impactMean, -0.4, 0.4);
    const ev: SimEvent = {
      id: `E${nowMs}-${Math.floor(this.rng.next() * 1e6)}`,
      time: nowMs,
      type,
      text: this.describe(type),
      impact,
      volBoost: d.volBoost,
      halfLifeSec: d.halfLifeSec,
    };
    this.active.push({ ev, startMs: nowMs });
    this.emit(ev);
    return ev;
  }

  scheduleAuto(dtSec: number, nowMs: number) {
    const rate = this.cfg.regimes[this.lastRegime].eventRate * this.rateScale;
    const count = this.rng.poisson(rate * dtSec);
    for (let i = 0; i < count; i++) this.inject(this.pickType(), nowMs);
  }

  onTick(dtSec: number, nowMs: number): EventImpactSummary {
    this.lastTickMs = nowMs;
    this.scheduleAuto(dtSec, nowMs);

    const ln2 = Math.log(2);
    let muBoost = 0, volBoostMul = 1, priceJumpMul = 1;

    const still: ActiveImpact[] = [];
    for (const a of this.active) {
      const ageSec = (nowMs - a.startMs) / 1000;
      const w = Math.exp(-ln2 * ageSec / a.ev.halfLifeSec);
      if (w > 0.02) {
        muBoost += this.cfg.eventDefs[a.ev.type].muBoost * w;
        volBoostMul *= 1 + (a.ev.volBoost - 1) * w * 0.8;
        if (ageSec < dtSec + 1e-6) priceJumpMul *= 1 + a.ev.impact;
        still.push(a);
      }
    }
    this.active = still;
    return { priceJumpMul, muBoost, volBoost: volBoostMul, newEvents: [] };
  }

  private pickType(): EventType {
    const u = this.rng.next();
    if (u < 0.5) return 'CT_Hype';
    if (u < 0.8) return 'Dev_Rug_Rumor';
    return 'Listing_Tier3';
  }

  private describe(t: EventType): string {
    if (t === 'CT_Hype') return 'CT hype post virals';
    if (t === 'Dev_Rug_Rumor') return 'Dev wallet rumor spreads';
    return 'Listing on Tier-3 CEX';
  }

  private emit(ev: SimEvent) {
    this.bus.dispatchEvent(new CustomEvent('sim:event', { detail: ev }));
  }

  private clamp(x: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, x)); }
}
