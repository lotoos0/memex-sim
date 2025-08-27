import { useEffect, useRef } from 'react';
import { RNG } from '../engine/rng';
import { PriceEngine } from '../engine/price';
import EventEngine from '../engine/events';
import { CandleAggregator } from '../engine/aggregator';
import { Clock } from '../engine/clock';
import type { EnginesConfig } from '../engine/types';
import cfgRaw from '../../config/config.json?raw'; // <- surowy tekst
import cfg from '../../config/config.json'; 
import { useTradingStore } from '../store/tradingStore';


const CONFIG: EnginesConfig = JSON.parse(cfgRaw) as EnginesConfig;

export default function usePriceFeed() {
  const didInit = useRef(false)
  const tfSec = useTradingStore((s) => s.tfSec);
  const setTfLeft = useTradingStore((s) => s.setTfLeft);
  const onPriceTick = useTradingStore((s) => s.onPriceTick);

  const engines = useRef<{
    rng: RNG;
    price: PriceEngine;
    events: EventEngine;
    aggr: CandleAggregator;
    clock: Clock;
    ticks: Array<{ t: number; p: number; v: number }>;
    lastCandleSec: number;
  } | null>(null);

  // start
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;

    // supply jednorazowo
    useTradingStore.setState({ supply: cfg.initial?.supply ?? 1_000_000_000 });

    // init silnikow
    const rng = new RNG(1337);
    const price = new PriceEngine(CONFIG, rng);
    const events = new EventEngine(CONFIG, rng, new EventTarget());
    const aggr = new CandleAggregator(tfSec || 1);
    const ticks: Array<{ t: number; p: number; v: number }> = [];

    let lastCandleSec = 0;
    
    // zegrar 
    const clock = new Clock(100, (dtSec) => {
      const nowMs = Date.now();
      events.setRegime(price.getRegime());
      const eff = events.onTick(dtSec, nowMs);
      const { price: p, volume: v } = price.nextTick(dtSec, eff, nowMs);

      ticks.push({ t: nowMs, p, v });
      const r = aggr.pushTick(nowMs, p, v);
      lastCandleSec = r.candle.time;

      const curSec = Math.floor(nowMs / 1000);
      const left = Math.max(0, (tfSec || 1) - (curSec - lastCandleSec)); // bez getTfSec
      setTfLeft(left);

      onPriceTick({ t: nowMs, p, v }, r);
    });

    engines.current = { rng, price, events, aggr, clock, ticks, lastCandleSec };
    clock.start();

    return () => { clock.stop(); engines.current = null; };
  }, []); // mount once

  // TF zmiana → re-agregacja z historii
  useEffect(() => {
    const e = engines.current;
    if (!e) return;
    e.aggr = new CandleAggregator(tfSec || 1);
    e.lastCandleSec = 0;

    for (const t of e.ticks) {
      const r = e.aggr.pushTick(t.t, t.p, t.v);
      useTradingStore.getState().onPriceTick({ t: t.t, p: t.p, v: t.v }, r);
      e.lastCandleSec = r.candle.time;
    }
  }, [tfSec]);
}
