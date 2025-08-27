// src/engine/price.ts
import type { EnginesConfig, Regime } from './types';
import { RNG } from './rng';

type VolumeCfg = {
  base: number;        // stała baza wolumenu
  sigmaScale: number;  // wkład od bieżącej zmienności (sigmaEff)
  retScale: number;    // wkład od EWMA(|dLog|)
  ewmaAlpha: number;   // wygładzanie zmienności [0..1]
  noiseStd: number;    // lognormal: exp(noiseStd * N(0,1))
  min: number;         // clamp dolny
  max: number;         // clamp górny
  driftStd?: number;   // odchylenie dryfu AR(1)
  seasonAmp?: number;  // amplituda sezonowości [0..1]
  seasonSec?: number;  // okres sezonowości w sekundach
};

export class PriceEngine {
  private cfg: EnginesConfig;
  private rng: RNG;

  private regime: Regime = 'range';
  private price: number;

  // skale sterowane z UI
  private volScale = 1;       // skala zmienności ceny
  private volUserScale = 1;   // skala wolumenu

  // czas i tranzycje
  private nextTransitionCheck = 0; // ms
  private simTimeMs = 0;

  // mean-reversion kotwica (EMA po log-cenie)
  private mrAnchor = 0;

  // model wolumenu
  private volCfg: VolumeCfg;
  private volEwma = 0;     // EWMA(|dLog|)
  private volDrift = 0;    // powolny dryf AR(1)

  constructor(cfg: EnginesConfig, rng: RNG) {
    this.cfg = cfg;
    this.rng = rng;
    this.price = cfg.startPrice ?? cfg.initial.price;
    this.mrAnchor = this.price;

    // domyślne + nadpisania z config.json (pole optional: { volume: {...} })
    const v = (cfg as { volume?: Partial<VolumeCfg> }).volume || {};
    this.volCfg = {
      base: 120,
      sigmaScale: 2500,
      retScale: 8000,
      ewmaAlpha: 0.15,
      noiseStd: 0.35,
      min: 5,
      max: 50000,
      driftStd: 25,
      seasonAmp: 0.15,
      seasonSec: 300,
      ...v,
    };
  }

  reset() {
    this.price = this.cfg.startPrice ?? this.cfg.initial.price;
    this.regime = 'range';
    this.nextTransitionCheck = 0;
    this.simTimeMs = 0;

    this.mrAnchor = this.price;
    this.volEwma = 0;
    this.volDrift = 0;
  }

  setVolatility(mult: number) { this.volScale = Math.max(0.2, mult); }
  setVolumeScale(mult: number) { this.volUserScale = Math.max(0.1, Math.min(5, mult)); }

  setRegime(r: Regime) { this.regime = r; }
  getRegime(): Regime { return this.regime; }
  getPrice(): number { return this.price; }

  // główny krok symulacji
  nextTick(
    dtSec: number,
    effects: { muBoost: number; volBoost: number; priceJumpMul: number },
    //_nowMs: number
  ): { price: number; volume: number } {
    const rCfg = this.cfg.regimes[this.regime];
    const sigmaEff = rCfg.sigma * this.volScale * effects.volBoost;
    const muEff = rCfg.mu + effects.muBoost;

    // skoki Poissona
    const nJumps = this.rng.poisson(Math.max(0, rCfg.lambda * dtSec));
    let jump = 0;
    for (let i = 0; i < nJumps; i++) jump += this.rng.normal() * rCfg.kappa;

    // dyfuzja log-return
    const dLog =
      muEff * dtSec +
      sigmaEff * Math.sqrt(Math.max(1e-6, dtSec)) * this.rng.normal() +
      jump;

    // mean-reversion (łagodny)
    const tau = Math.max(5, (this.cfg as any).mrTauSec ?? 60);
    const w = Math.min(1, Math.max(0, dtSec / tau));
    // aktualizuj kotwicę po log-cenie
    this.mrAnchor = Math.exp(
      (1 - w) * Math.log(this.mrAnchor || this.price) + w * Math.log(this.price)
    );
    const mrK = Math.max(0, (this.cfg as any).mrK ?? 0); // 0 = wyłącz
    const dev = Math.log(this.price / this.mrAnchor);
    const dLogTotal = dLog + (-mrK * dev * dtSec);

    // aktualizacja ceny: dyfuzja+MR, potem natychmiastowy skok eventowy
    this.price *= Math.exp(dLogTotal);
    this.price *= Math.max(0.01, effects.priceJumpMul);

    // --- wolumen ---
    // EWMA(|dLog|)
    const a = this.volCfg.ewmaAlpha;
    this.volEwma = a * Math.abs(dLog) + (1 - a) * this.volEwma;

    // powolny dryf AR(1)
    this.volDrift = 0.95 * this.volDrift + (this.volCfg.driftStd ?? 25) * this.rng.normal();

    // sezonowość (sinus czasu symulacji)
    const tSec = this.simTimeMs / 1000;
    const season =
      1 + (this.volCfg.seasonAmp ?? 0.15) * Math.sin((2 * Math.PI * tSec) / (this.volCfg.seasonSec ?? 300));

    // deterministyczna część
    const volDet =
      this.volCfg.base +
      this.volCfg.sigmaScale * sigmaEff +
      this.volCfg.retScale * this.volEwma +
      this.volDrift;

    // lognormalny mnożnik szumu
    const noiseMul = Math.exp(this.volCfg.noiseStd * this.rng.normal());

    // końcowy wolumen
    let vol = volDet * season * noiseMul * effects.volBoost * this.volUserScale;

    // łagodna zależność od dt, żeby przy mniejszych krokach wolumen nie eksplodował
    vol *= Math.max(0.5, Math.sqrt(dtSec) * 2);

    // clamp
    vol = Math.max(this.volCfg.min, Math.min(this.volCfg.max, vol));

    // tranzycje reżimów co transitionCheckSec
    this.simTimeMs += dtSec * 1000;
    if (this.simTimeMs >= this.nextTransitionCheck) {
      this.nextTransitionCheck = this.simTimeMs + this.cfg.transitionCheckSec * 1000;
      this.regime = this.sampleTransition(this.regime);
    }

    return { price: this.price, volume: vol };
  }

  private sampleTransition(from: Regime): Regime {
    const edges = this.cfg.transitions[from] ?? [];
    if (edges.length === 0) return from;
    const sum = edges.reduce((s, e) => s + (e.p ?? 0), 0) || 1;
    let u = this.rng.next() * sum;
    for (const e of edges) { u -= e.p; if (u <= 0) return e.to; }
    return edges[edges.length - 1]!.to;
  }
}
